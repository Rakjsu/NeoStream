import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 18 features: live player mini-EPG (now/next from the provider xmltv)
 * and new-episode detection on followed series (last_modified vs baseline).
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

test('mini-EPG: player ao vivo mostra agora/a seguir do xmltv do provedor', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await page.getByText('Globo São Paulo HD').first().click();

    // Side panel resolves the current program from the mock guide
    // (globo-sp grid: now-1h..now+3h → "Jornal Nacional" is on now).
    await expect(page.getByText('Jornal Nacional').first()).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: /Assistir Agora/ }).click();
    await expect(page.locator('.video-player-container')).toBeVisible();

    // Mini-EPG card under the title (visible with the controls).
    await page.mouse.move(400, 400);
    await expect(page.locator('.live-epg-bar')).toBeVisible();
    await expect(page.locator('.live-epg-bar')).toContainText('Jornal Nacional');
    await expect(page.locator('.live-epg-bar')).toContainText('Novela das Nove');
    await expect(page.locator('.live-epg-progress-fill')).toBeVisible();
});

test('novos episódios: baseline antigo marca a série seguida e abrir consome', async () => {
    const page = await boot();

    // Follow "Cidade Invisível" (series_id 301, last_modified 1700000201 in the
    // fixture) and seed a STALE baseline so the bump reads as a new episode.
    await page.evaluate(async () => {
        const result = await window.ipcRenderer.invoke('playlists:get-active-id') as { id: string | null };
        const playlistId = result.id ?? 'default';
        localStorage.setItem(
            `neostream_series_seen_e2e-adult__pl_${playlistId}`,
            JSON.stringify({ '301': 1600000000 })
        );
        localStorage.setItem(
            `neostream_profile_e2e-adult__pl_${playlistId}`,
            JSON.stringify({
                favorites: [{ id: '301', type: 'series', title: 'Cidade Invisível', poster: '', addedAt: new Date().toISOString() }]
            })
        );
    });
    await page.reload();
    await expect(page.getByText(GREETING)).toBeVisible();

    // Home row lists the updated series.
    await expect(page.getByText(/Novos episódios nas suas séries/)).toBeVisible({ timeout: 20000 });

    // Series page shows the badge on the card…
    await page.locator('button.nav-item[title="Séries"]').click();
    await expect(page.getByText('🆕 Novos eps')).toBeVisible();

    // …and opening the series consumes it.
    await page.getByText('Cidade Invisível').first().click();
    await page.keyboard.press('Escape'); // close the detail modal
    await expect(page.getByText('🆕 Novos eps')).toHaveCount(0);
});
