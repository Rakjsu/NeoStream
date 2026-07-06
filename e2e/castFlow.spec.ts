import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * The phone-driven cast flow added in #180: `requestDevices` asks the app to
 * discover cast targets (Chromecast + DLNA + AirPlay) and pushes them back as a
 * `devices` message; casting a movie reports back a `castResult`. There are no
 * real cast devices in CI, so discovery returns an empty list and a cast reports
 * `no-device` — either way the full loop (server → media:control → bridge →
 * server → client) is exercised over a real WebSocket.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => { server = await startMockServer(); });
test.afterAll(async () => { await server.close(); });
test.afterEach(async () => { await launched?.close(); launched = null; });

async function boot(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();
    return page;
}

function maskedTextFrame(text: string): Buffer {
    const payload = Buffer.from(text, 'utf-8');
    const mask = [0x12, 0x34, 0x56, 0x78];
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
    return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length, ...mask]), masked]);
}

interface FlowResult {
    devices: { items: unknown[] };
    catalog: { items: { id: string }[] };
    castResult: { status: string };
}

/**
 * Handshake, then: requestDevices → devices; requestCatalog → catalog; cast the
 * first movie → castResult. Resolves once all three messages have arrived.
 */
function runCastFlow(port: number, pin: string): Promise<FlowResult> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
            socket.write(
                `GET /?pin=${pin} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
                'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
            );
        });
        socket.setTimeout(10000, () => { socket.destroy(); reject(new Error('timeout')); });
        let buf = Buffer.alloc(0);
        let upgraded = false;
        const got: Partial<FlowResult> = {};
        const done = () => got.devices && got.catalog && got.castResult;
        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (!upgraded) {
                const end = buf.indexOf('\r\n\r\n');
                if (end === -1) return;
                if (!buf.slice(0, end).toString().includes('101')) { socket.destroy(); reject(new Error('sem 101')); return; }
                upgraded = true;
                buf = buf.slice(end + 4);
                socket.write(maskedTextFrame(JSON.stringify({ action: 'requestDevices' })));
                socket.write(maskedTextFrame(JSON.stringify({ action: 'requestCatalog' })));
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
                    if (msg.type === 'devices' && !got.devices) got.devices = msg as FlowResult['devices'];
                    else if (msg.type === 'catalog' && !got.catalog) {
                        got.catalog = msg as FlowResult['catalog'];
                        // Kick off a cast of the first movie to get a castResult back.
                        const id = got.catalog.items[0]?.id;
                        if (id) socket.write(maskedTextFrame(JSON.stringify({ action: 'castMovie', movieId: id })));
                        else { socket.destroy(); reject(new Error('catálogo vazio')); return; }
                    } else if (msg.type === 'castResult' && !got.castResult) {
                        got.castResult = msg as FlowResult['castResult'];
                    }
                    if (done()) { socket.destroy(); resolve(got as FlowResult); return; }
                } catch { /* keep reading */ }
            }
        });
        socket.on('error', reject);
    });
}

test('controle web: pede dispositivos e transmite, recebendo o resultado', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Rede' }).click();
    await page.locator('.setting-item', { hasText: 'Controle pelo celular' })
        .locator('.toggle-slider').click();

    const box = page.locator('.certificate-warning').filter({ hasText: 'PIN de pareamento' });
    await expect(box).toBeVisible({ timeout: 10000 });
    const url = await box.locator('a[href^="http://"]').getAttribute('href');
    const port = Number(new URL(url!).port);
    const pin = (await box.locator('strong').first().innerText()).trim();

    const { devices, catalog, castResult } = await runCastFlow(port, pin);

    // requestDevices always answers (empty list in CI — no real cast targets).
    expect(Array.isArray(devices.items)).toBe(true);
    // The mock seeds VOD, so the catalog is non-empty and gives a movie to cast.
    expect(catalog.items.length).toBeGreaterThan(0);
    // No Chromecast on the CI LAN → the cast reports 'no-device' (loop proven).
    expect(castResult.status).toBe('no-device');
});
