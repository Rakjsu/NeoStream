import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 33 — the phone catalog second-screen (#172). Over a real WebSocket the
 * phone sends `requestCatalog`; the WebRemoteBridge (app root) fetches the movie
 * list and pushes it back as a `catalog` message. We drive a tiny raw WS client
 * to prove the full loop: server → media:control → bridge → server → client.
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

/** A masked client→server text frame (browsers always mask). */
function maskedTextFrame(text: string): Buffer {
    const payload = Buffer.from(text, 'utf-8');
    const mask = [0x12, 0x34, 0x56, 0x78];
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
    return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length, ...mask]), masked]);
}

/** Connect, handshake with the PIN, send requestCatalog, resolve the catalog msg. */
function fetchCatalogOverWs(port: number, pin: string): Promise<{ type: string; items: unknown[] }> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
            socket.write(
                `GET /?pin=${pin} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
                'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
            );
        });
        socket.setTimeout(8000, () => { socket.destroy(); reject(new Error('timeout')); });
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
                socket.write(maskedTextFrame(JSON.stringify({ action: 'requestCatalog' })));
            }
            // Parse server frames (unmasked text): 0x81, len7 (<126), payload.
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
                    if (msg.type === 'catalog') { socket.destroy(); resolve(msg); return; }
                } catch { /* not a full JSON frame; keep reading */ }
            }
        });
        socket.on('error', reject);
    });
}

test('controle web: o celular pede o catálogo e recebe a lista de filmes', async () => {
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

    const catalog = await fetchCatalogOverWs(port, pin);
    expect(catalog.type).toBe('catalog');
    expect(Array.isArray(catalog.items)).toBe(true);
    // The mock server seeds VOD, so the movie catalog comes back non-empty.
    expect(catalog.items.length).toBeGreaterThan(0);
});
