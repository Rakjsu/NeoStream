import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 27 features: type-aware provider health (M3U download/parse, Stalker
 * handshake/channels) and the near-realtime sync folder watcher.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => {
    server = await startMockServer();
});

test.afterAll(async () => {
    await server.close();
});

test.afterEach(async () => {
    await launched?.close();
    launched = null;
});

async function boot(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();
    return page;
}

async function addPlaylist(page: Page, kind: 'M3U' | 'Stalker/MAC'): Promise<void> {
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await page.getByRole('button', { name: /\+ / }).click();
    await page.getByRole('button', { name: kind, exact: true }).click();
    if (kind === 'M3U') {
        await page.locator('.playlists-add-form input[type="text"]').first().fill('Lista Saúde');
        await page.locator('.playlists-add-form input').nth(1).fill(`${server.url}/lista.m3u`);
    } else {
        await page.locator('.playlists-add-form input[type="text"]').nth(0).fill('Portal Saúde');
        await page.locator('.playlists-add-form input[type="text"]').nth(1).fill(server.url);
        await page.locator('.playlists-add-form input[type="text"]').nth(2).fill('00:1A:79:AB:CD:EF');
    }
    await page.locator('.playlists-add-form button[type="submit"]').click();
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 20000 });
}

async function runHealthCheck(page: Page): Promise<void> {
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Diagnóstico' }).click();
    await page.getByRole('button', { name: /Testar agora/ }).click();
}

test('saúde: playlist M3U testa download e parse da lista', async () => {
    test.setTimeout(90000);
    const page = await boot();
    await addPlaylist(page, 'M3U');

    await runHealthCheck(page);
    await expect(page.getByText('Download da lista M3U')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Leitura dos canais da lista')).toBeVisible();
    // The Xtream-only probes must NOT run for an M3U playlist.
    await expect(page.getByText('API (player_api.php)')).toHaveCount(0);
});

test('saúde: portal Stalker testa handshake e lista de canais', async () => {
    test.setTimeout(90000);
    const page = await boot();
    await addPlaylist(page, 'Stalker/MAC');

    await runHealthCheck(page);
    await expect(page.getByText('Handshake do portal Stalker')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Lista de canais do portal')).toBeVisible();
    await expect(page.getByText('API (player_api.php)')).toHaveCount(0);
});

test('sync: watcher detecta arquivo novo na pasta e mescla sem run-now', async () => {
    test.setTimeout(120000);

    const syncDir = mkdtempSync(path.join(tmpdir(), 'neostream-watch-e2e-'));
    launched = await launchApp({
        serverUrl: server.url,
        extraStores: {
            'sync-folder': {
                syncFolder: { enabled: true, dirPath: syncDir, machineId: 'e2e-local', lastSyncAt: 0 },
            },
        },
    });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Re-enable via IPC so the watcher arms NOW (the boot timer waits 20s).
    await page.evaluate(() => window.ipcRenderer.invoke('sync:config-set', { enabled: true }));

    // Another machine drops its file — the watcher (5s debounce) must pick it
    // up and merge WITHOUT any manual sync:run-now.
    writeFileSync(path.join(syncDir, 'neostream-sync-remota-w1.json'), JSON.stringify({
        version: 2,
        exportedAt: new Date().toISOString(),
        app: 'neostream',
        data: { neostream_theme: JSON.stringify({ accent: 'watcher-e2e' }) },
    }), 'utf-8');

    await expect.poll(async () =>
        page.evaluate(() => localStorage.getItem('neostream_theme')), { timeout: 30000 }
    ).toContain('watcher-e2e');

    rmSync(syncDir, { recursive: true, force: true });
});
