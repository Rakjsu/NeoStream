import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Recomendações no controle web (#220): with a watched movie in the history,
 * the phone sends `requestRecommended` and the WebRemoteBridge runs the Home
 * recommendation engine (category/franchise match over the mock catalog) and
 * pushes the groups back as a `recommended` message.
 *
 * Fixture: watching "Cidade de Deus" (201, category 10) must recommend the
 * other category-10 movies (202/203/204) under its "porque você assistiu" seed.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;
const WATCHED_ID = '201'; // "Cidade de Deus"

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

interface RecommendedMsg {
    type: string;
    groups: { seed: string; items: { kind: string; id: string; name: string; cover: string }[] }[];
}

function fetchRecommendedOverWs(port: number, pin: string): Promise<RecommendedMsg> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
            socket.write(
                `GET /?pin=${pin} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
                'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
            );
        });
        socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('timeout')); });
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
                socket.write(maskedTextFrame(JSON.stringify({ action: 'requestRecommended' })));
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
                    if (msg.type === 'recommended') { socket.destroy(); resolve(msg); return; }
                } catch { /* keep reading */ }
            }
        });
        socket.on('error', reject);
    });
}

test('controle web: recomendações "porque você assistiu" a partir do histórico', async () => {
    const page = await boot();

    // Seed one watched movie under the exact profile+playlist-scoped key the
    // app reads (movie_watch_progress_<profileId>__pl_<playlistId>).
    await page.evaluate((movieId) => {
        const profileId = 'e2e-adult';
        const plId = localStorage.getItem('neostream_active_playlist_id') || 'default';
        const key = `movie_watch_progress_${profileId}__pl_${plId}`;
        const entry = {
            movieId, movieName: 'Cidade de Deus', profileId,
            currentTime: 3400, duration: 3600, progress: 95, watchedAt: 1700000999000, completed: true,
        };
        localStorage.setItem(key, JSON.stringify([entry]));
    }, WATCHED_ID);

    // Seed the seed's genre cache in IndexedDB so resolveSeedGenres skips the
    // real TMDB lookup (11s+ in this env) and the flow stays local and fast.
    await page.evaluate(() => new Promise<void>((resolve) => {
        const open = indexedDB.open('iptv_kids_filter', 1);
        open.onupgradeneeded = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('movies_cache')) db.createObjectStore('movies_cache', { keyPath: 'name' });
            if (!db.objectStoreNames.contains('series_cache')) db.createObjectStore('series_cache', { keyPath: 'name' });
            if (!db.objectStoreNames.contains('hidden_items')) db.createObjectStore('hidden_items', { keyPath: 'id' });
        };
        open.onsuccess = () => {
            const tx = open.result.transaction('movies_cache', 'readwrite');
            // Same normalized key shape the cache uses (lowercase, sem pontuação).
            tx.objectStore('movies_cache').put({
                name: 'cidade de deus', certification: '16', genres: ['Crime', 'Drama'], cachedAt: Date.now(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        };
        open.onerror = () => resolve();
    }));

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Rede' }).click();
    await page.locator('.setting-item', { hasText: 'Controle pelo celular' })
        .locator('.toggle-slider').click();

    const box = page.locator('.certificate-warning').filter({ hasText: 'PIN de pareamento' });
    await expect(box).toBeVisible({ timeout: 10000 });
    const url = await box.locator('a[href^="http://"]').getAttribute('href');
    const port = Number(new URL(url!).port);
    const pin = (await box.locator('strong').first().innerText()).trim();

    const rec = await fetchRecommendedOverWs(port, pin);

    expect(rec.type).toBe('recommended');
    expect(rec.groups.length, 'ao menos um grupo de recomendação').toBeGreaterThan(0);

    const group = rec.groups.find(g => g.seed === 'Cidade de Deus');
    expect(group, 'grupo semeado pelo filme assistido').toBeTruthy();

    // Os outros filmes da mesma categoria (10) entram; o assistido fica fora.
    const ids = group!.items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining(['202', '203', '204']));
    expect(ids).not.toContain(WATCHED_ID);
    for (const item of group!.items) {
        expect(item.kind === 'movie' || item.kind === 'series').toBe(true);
        expect(item.name.length).toBeGreaterThan(0);
    }
});
