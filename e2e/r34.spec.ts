import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 34 — séries no controle web (#179). Over a real WebSocket the phone
 * drills down: `requestSeries` → the WebRemoteBridge pushes the series list;
 * `requestSeriesInfo <id>` → it fetches series:get-info, flattens the seasons
 * into ordered `T{s}E{e} · título` episodes and pushes them back. We drive a raw
 * WS client to prove the full loop: server → media:control → bridge → server → client.
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

interface SeriesMsg { type: string; items: { id: string; name: string; cover: string }[] }
interface SeriesInfoMsg { type: string; seriesId: string; episodes: { id: string; label: string }[] }

/**
 * Handshake with the PIN, then drill down: request the series list, pick the
 * first series, request its info, and resolve both messages.
 */
function drillDownSeriesOverWs(port: number, pin: string): Promise<{ series: SeriesMsg; info: SeriesInfoMsg }> {
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
        let series: SeriesMsg | null = null;
        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (!upgraded) {
                const end = buf.indexOf('\r\n\r\n');
                if (end === -1) return;
                if (!buf.slice(0, end).toString().includes('101')) { socket.destroy(); reject(new Error('sem 101')); return; }
                upgraded = true;
                buf = buf.slice(end + 4);
                socket.write(maskedTextFrame(JSON.stringify({ action: 'requestSeries' })));
            }
            // Parse server frames (unmasked text): 0x81, len7 (<126) or 16-bit, payload.
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
                    if (msg.type === 'series' && !series) {
                        series = msg as SeriesMsg;
                        if (!series.items.length) { socket.destroy(); reject(new Error('lista de séries vazia')); return; }
                        socket.write(maskedTextFrame(JSON.stringify({ action: 'requestSeriesInfo', seriesId: series.items[0].id })));
                    } else if (msg.type === 'seriesInfo' && series) {
                        socket.destroy();
                        resolve({ series, info: msg as SeriesInfoMsg });
                        return;
                    }
                } catch { /* not a full JSON frame; keep reading */ }
            }
        });
        socket.on('error', reject);
    });
}

test('controle web: o celular navega séries → episódios (drill-down)', async () => {
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

    const { series, info } = await drillDownSeriesOverWs(port, pin);

    // The mock seeds series, so the list comes back non-empty.
    expect(series.type).toBe('series');
    expect(series.items.length).toBeGreaterThan(0);

    // Drilling into the first series returns its episodes, flattened and labeled.
    expect(info.type).toBe('seriesInfo');
    expect(info.seriesId).toBe(series.items[0].id);
    expect(info.episodes.length).toBeGreaterThan(0);
    // Labels follow the `T{season}E{ep} · título` shape built by the bridge.
    expect(info.episodes[0].label).toMatch(/^T\d+E\d+/);
    expect(info.episodes.every(e => e.id && e.label)).toBe(true);
});
