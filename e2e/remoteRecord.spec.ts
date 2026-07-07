import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * REC pelo celular (#238): a phone `recordChannel` must travel the whole
 * chain — WS parse → forward → bridge resolves the live URL → dvr:start
 * (real ffmpeg spawn) → `recordResult` relayed back with the channel name.
 * The mock has no playable HLS, so the assertion targets the start/registro
 * contract (spawn-level success), not recorded bytes; cleanup stops whatever
 * ffmpeg is still holding.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => { server = await startMockServer(); });
test.afterAll(async () => { await server.close(); });
test.afterEach(async () => { await launched?.close(); launched = null; });

function maskedTextFrame(text: string): Buffer {
    const payload = Buffer.from(text, 'utf-8');
    const mask = [0x12, 0x34, 0x56, 0x78];
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
    return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length, ...mask]), masked]);
}

interface RecordResultMsg { type: string; status: string; name: string }

function recordOverWs(port: number, pin: string, channelId: string, channelName: string): Promise<RecordResultMsg> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
            socket.write(
                `GET /?pin=${pin} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
                'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
            );
        });
        socket.setTimeout(20000, () => { socket.destroy(); reject(new Error('timeout')); });
        let buf = Buffer.alloc(0);
        let upgraded = false;
        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (!upgraded) {
                const end = buf.indexOf('\r\n\r\n');
                if (end === -1) return;
                if (!buf.slice(0, end).toString().includes('101')) { socket.destroy(); reject(new Error('sem 101')); return; }
                upgraded = true;
                buf = buf.slice(end + 4);
                socket.write(maskedTextFrame(JSON.stringify({ action: 'recordChannel', channelId, channelName })));
            }
            while (buf.length >= 2) {
                if (buf[0] !== 0x81) { buf = buf.slice(1); continue; }
                let len = buf[1] & 0x7f;
                let offset = 2;
                if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); offset = 4; }
                if (buf.length < offset + len) break;
                const text = buf.slice(offset, offset + len).toString('utf-8');
                buf = buf.slice(offset + len);
                try {
                    const msg = JSON.parse(text);
                    if (msg.type === 'recordResult') { socket.destroy(); resolve(msg); return; }
                } catch { /* keep reading */ }
            }
        });
        socket.on('error', reject);
    });
}

test('recordChannel do celular inicia a gravação DVR no PC e confirma', async () => {
    test.setTimeout(120000);
    launched = await launchApp({ serverUrl: server.url });
    const page: Page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Rede' }).click();
    await page.locator('.setting-item', { hasText: 'Controle pelo celular' }).locator('.toggle-slider').click();
    const box = page.locator('.certificate-warning').filter({ hasText: 'PIN de pareamento' });
    await expect(box).toBeVisible({ timeout: 10000 });
    const url = await box.locator('a[href^="http://"]').getAttribute('href');
    const port = Number(new URL(url!).port);
    const pin = (await box.locator('strong').first().innerText()).trim();

    // Canal 101 do mock ("Globo São Paulo HD"): a cadeia inteira deve rodar e
    // o resultado voltar com o nome do canal.
    const result = await recordOverWs(port, pin, '101', 'Globo São Paulo HD');
    expect(result.status).toBe('ok');
    expect(result.name).toBe('Globo São Paulo HD');

    // Cleanup: encerra qualquer gravação que o ffmpeg ainda esteja segurando
    // (o mock não tem HLS de verdade; o processo pode já ter morrido sozinho).
    await page.evaluate(async () => {
        const active = await window.ipcRenderer.invoke('dvr:active') as
            { success: boolean; recordings?: { id: string }[] };
        for (const rec of active.recordings ?? []) {
            await window.ipcRenderer.invoke('dvr:stop', { id: rec.id }).catch(() => undefined);
        }
    });
});
