import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * "Continuar assistindo" no controle web (#183): with a movie left in progress,
 * the phone sends `requestContinue` and the WebRemoteBridge builds the list from
 * movieProgressService (localStorage) and pushes it back as a `continue` message.
 * We seed one in-progress movie, then drive a raw WS client to prove the loop.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;
const MOVIE_ID = '201'; // "Cidade de Deus" — seeded in the mock VOD fixture

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

interface ContinueMsg { type: string; items: { kind: string; castId: string; name: string; pct: number }[] }

function fetchContinueOverWs(port: number, pin: string): Promise<ContinueMsg> {
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
        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (!upgraded) {
                const end = buf.indexOf('\r\n\r\n');
                if (end === -1) return;
                if (!buf.slice(0, end).toString().includes('101')) { socket.destroy(); reject(new Error('sem 101')); return; }
                upgraded = true;
                buf = buf.slice(end + 4);
                socket.write(maskedTextFrame(JSON.stringify({ action: 'requestContinue' })));
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
                    if (msg.type === 'continue') { socket.destroy(); resolve(msg); return; }
                } catch { /* keep reading */ }
            }
        });
        socket.on('error', reject);
    });
}

test('controle web: "Continuar assistindo" lista o filme em progresso', async () => {
    const page = await boot();

    // Seed one in-progress movie under the exact profile+playlist-scoped key the
    // app reads (movie_watch_progress_<profileId>__pl_<playlistId>).
    await page.evaluate((movieId) => {
        const profileId = 'e2e-adult';
        const plId = localStorage.getItem('neostream_active_playlist_id') || 'default';
        const key = `movie_watch_progress_${profileId}__pl_${plId}`;
        const entry = {
            movieId, movieName: 'Cidade de Deus', profileId,
            currentTime: 1800, duration: 3600, progress: 50, watchedAt: 1700000999000, completed: false,
        };
        localStorage.setItem(key, JSON.stringify([entry]));
    }, MOVIE_ID);

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Rede' }).click();
    await page.locator('.setting-item', { hasText: 'Controle pelo celular' })
        .locator('.toggle-slider').click();

    const box = page.locator('.certificate-warning').filter({ hasText: 'PIN de pareamento' });
    await expect(box).toBeVisible({ timeout: 10000 });
    const url = await box.locator('a[href^="http://"]').getAttribute('href');
    const port = Number(new URL(url!).port);
    const pin = (await box.locator('strong').first().innerText()).trim();

    const cont = await fetchContinueOverWs(port, pin);

    expect(cont.type).toBe('continue');
    const movie = cont.items.find(i => i.kind === 'movie' && i.castId === MOVIE_ID);
    expect(movie, 'o filme semeado deve aparecer em Continuar').toBeTruthy();
    expect(movie!.name).toContain('Cidade de Deus');
    expect(movie!.pct).toBe(50);
});
