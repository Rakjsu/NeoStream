import { test, expect, type Page } from '@playwright/test';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Roteamento celular → DLNA (#234): with an active DLNA session, the phone's
 * transport buttons must land as UPnP SOAP on the device (not on the local
 * player). A fake UPnP renderer runs inside the test: device description +
 * AVTransport/RenderingControl endpoints that record every action received.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

interface FakeRenderer {
    port: number;
    received: string[];
    close: () => Promise<void>;
}

/** Minimal UPnP MediaRenderer: /dmr description + SOAP endpoints that log. */
function startFakeRenderer(): Promise<FakeRenderer> {
    const received: string[] = [];
    const soapOk = (inner = '') =>
        `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${inner}</s:Body></s:Envelope>`;

    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/dmr') {
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(`<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>TV Falsa E2E</friendlyName>
    <manufacturer>NeoStream E2E</manufacturer>
    <modelName>FakeRenderer 1.0</modelName>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/av-control</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <controlURL>/rc-control</controlURL>
      </service>
    </serviceList>
  </device>
</root>`);
            return;
        }
        if (req.method === 'POST' && (req.url === '/av-control' || req.url === '/rc-control')) {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                const soapAction = String(req.headers.soapaction || '');
                const action = soapAction.split('#')[1]?.replace(/"/g, '') || 'unknown';
                // SetVolume carrega o nível — registra junto pra asserção.
                const vol = /<DesiredVolume>(\d+)<\/DesiredVolume>/.exec(body)?.[1];
                received.push(vol ? `${action}:${vol}` : action);

                res.writeHead(200, { 'Content-Type': 'text/xml' });
                if (action === 'GetTransportInfo') {
                    res.end(soapOk('<u:GetTransportInfoResponse><CurrentTransportState>PLAYING</CurrentTransportState></u:GetTransportInfoResponse>'));
                } else if (action === 'GetPositionInfo') {
                    res.end(soapOk('<u:GetPositionInfoResponse><RelTime>0:00:30</RelTime><TrackDuration>0:30:00</TrackDuration></u:GetPositionInfoResponse>'));
                } else if (action === 'GetVolume') {
                    res.end(soapOk('<u:GetVolumeResponse><CurrentVolume>40</CurrentVolume></u:GetVolumeResponse>'));
                } else {
                    res.end(soapOk());
                }
            });
            return;
        }
        res.writeHead(404); res.end();
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: (server.address() as AddressInfo).port,
                received,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}

let server: Awaited<ReturnType<typeof startMockServer>>;
let renderer: FakeRenderer;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => {
    server = await startMockServer();
    renderer = await startFakeRenderer();
});
test.afterAll(async () => { await server.close(); await renderer.close(); });
test.afterEach(async () => { await launched?.close(); launched = null; });

function maskedTextFrame(text: string): Buffer {
    const payload = Buffer.from(text, 'utf-8');
    const mask = [0x12, 0x34, 0x56, 0x78];
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
    return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length, ...mask]), masked]);
}

/** WS client that connects with the PIN and lets the test push raw commands. */
function connectWs(port: number, pin: string): Promise<{ send: (cmd: object) => void; close: () => void }> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
            socket.write(
                `GET /?pin=${pin} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
                'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
            );
        });
        socket.setTimeout(10000, () => { socket.destroy(); reject(new Error('timeout')); });
        let upgraded = false;
        socket.on('data', (chunk) => {
            if (!upgraded && chunk.toString().includes('101')) {
                upgraded = true;
                resolve({
                    send: (cmd) => socket.write(maskedTextFrame(JSON.stringify(cmd))),
                    close: () => socket.destroy(),
                });
            }
        });
        socket.on('error', reject);
    });
}

test('comandos do celular chegam como SOAP no renderer DLNA', async () => {
    test.setTimeout(120000);
    launched = await launchApp({ serverUrl: server.url });
    const page: Page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Registra o renderer falso como dispositivo manual e estabelece a sessão
    // DLNA (SetAVTransportURI + Play no fake, via proxy local do app).
    const castResult = await page.evaluate(async ({ port, videoUrl }) => {
        const add = await window.ipcRenderer.invoke('dlna:add-device', { name: 'TV Falsa E2E', ip: '127.0.0.1', port }) as
            { success: boolean; device?: { id: string } };
        if (!add.success || !add.device) return { ok: false, step: 'add' };
        const cast = await window.ipcRenderer.invoke('dlna:cast', {
            deviceId: add.device.id, url: videoUrl, title: 'Filme E2E',
        }) as { success: boolean; error?: string };
        return { ok: cast.success, step: 'cast', error: cast.error };
    }, { port: renderer.port, videoUrl: `${server.url}/movie/e2e/e2e/201.mp4` });
    expect(castResult.ok, `sessão DLNA estabelecida (${JSON.stringify(castResult)})`).toBe(true);
    expect(renderer.received).toContain('SetAVTransportURI');

    // Liga o controle web e conecta o "celular".
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Rede' }).click();
    await page.locator('.setting-item', { hasText: 'Controle pelo celular' }).locator('.toggle-slider').click();
    const box = page.locator('.certificate-warning').filter({ hasText: 'PIN de pareamento' });
    await expect(box).toBeVisible({ timeout: 10000 });
    const url = await box.locator('a[href^="http://"]').getAttribute('href');
    const port = Number(new URL(url!).port);
    const pin = (await box.locator('strong').first().innerText()).trim();
    const ws = await connectWs(port, pin);

    // Prontidão: a sessão DLNA responde GetTransportInfo antes dos comandos
    // (evita corrida entre o cast recém-estabelecido e o primeiro comando).
    await expect.poll(async () => {
        const st = await page.evaluate(() => window.ipcRenderer.invoke('dlna:get-status')) as { success: boolean };
        return st.success;
    }, { timeout: 15000 }).toBe(true);

    const marker = renderer.received.length;

    // togglePlay: consulta o estado (PLAYING) e pausa na TV — não no player local.
    ws.send({ action: 'togglePlay' });
    await expect.poll(() => renderer.received.slice(marker), { timeout: 20000 })
        .toContain('Pause');
    expect(renderer.received.slice(marker)).toContain('GetTransportInfo');

    // setVolume absoluto: 0.5 do fio vira SetVolume 50 (0..100 UPnP).
    ws.send({ action: 'setVolume', level: 0.5 });
    await expect.poll(() => renderer.received.slice(marker), { timeout: 20000 })
        .toContain('SetVolume:50');

    // stop derruba a sessão na TV.
    ws.send({ action: 'stop' });
    await expect.poll(() => renderer.received.slice(marker), { timeout: 20000 })
        .toContain('Stop');

    ws.close();
});
