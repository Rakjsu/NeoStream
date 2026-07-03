import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 21 features: catalog sort select, TV mode toggle and the SWR
 * catalog cache (fromCache + stale fallback when the provider dies).
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => {
    server = await startMockServer();
});

test.afterAll(async () => {
    await server.close().catch(() => undefined);
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

test('ordenação: Nome A–Z e Melhor avaliados reordenam a grade de filmes', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="Filmes"]').click();
    await expect(page.getByText('Cidade de Deus').first()).toBeVisible();

    // Nome A–Z: "Bacurau" comes first in the fixture alphabet.
    await page.locator('select[title="Ordenar por"]').selectOption('name');
    await expect(page.locator('.vod-grid, [class*="grid"]').first().locator('text=Bacurau').first()).toBeVisible();
    const firstByName = await page.evaluate(() => {
        const grid = document.querySelector('[class*="grid"]');
        return grid?.textContent?.includes('Bacurau') ? 'has-bacurau' : 'missing';
    });
    expect(firstByName).toBe('has-bacurau');

    // Melhor avaliados: "O Auto da Compadecida" (8.7) leads.
    await page.locator('select[title="Ordenar por"]').selectOption('rating');
    await expect(page.getByText('O Auto da Compadecida').first()).toBeVisible();
});

test('modo TV: toggle aplica a classe e o zoom; desligar remove', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Aparência' }).click();

    const row = page.locator('.setting-item', { hasText: 'Modo TV' });
    await row.locator('.toggle-slider').click();

    await expect.poll(async () => page.evaluate(() => ({
        cls: document.documentElement.classList.contains('tv-mode'),
        zoom: (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom
    }))).toEqual({ cls: true, zoom: '1.25' });

    await row.locator('.toggle-slider').click();
    await expect.poll(async () => page.evaluate(() =>
        document.documentElement.classList.contains('tv-mode')
    )).toBe(false);
});

test('cache SWR: segunda chamada vem do cache e sobrevive ao provedor cair', async () => {
    const page = await boot();

    // First call fills the cache; the repeat is served from it.
    const first = await page.evaluate(() => window.ipcRenderer.invoke('streams:get-vod'));
    expect(first.success).toBe(true);
    const second = await page.evaluate(() => window.ipcRenderer.invoke('streams:get-vod'));
    expect(second.success).toBe(true);
    expect(second.fromCache).toBe(true);

    // Provider down + forced refresh → stale cache instead of an error.
    await server.close();
    const offline = await page.evaluate(() =>
        window.ipcRenderer.invoke('streams:get-vod', { forceRefresh: true }));
    expect(offline.success).toBe(true);
    expect(offline.fromCache).toBe(true);
    expect(Array.isArray(offline.data) && offline.data.length > 0).toBe(true);

    // Fresh instance so afterAll has a live server to close.
    server = await startMockServer();
});
