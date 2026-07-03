import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 19 features: favorite channels (star → virtual category), the
 * multi-view v2 layouts/swap and the "?" shortcuts overlay.
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

test('favoritos: estrela no painel alimenta a categoria ⭐ Canais favoritos', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();

    // Star the channel from its side panel.
    await page.getByText('Globo São Paulo HD').first().click();
    await page.locator('button[title="Favoritar canal"]').click();
    await expect(page.locator('button[title="Remover dos favoritos"]')).toBeVisible();
    await page.getByRole('button', { name: /✕ Fechar/ }).click();

    // Virtual category filters the grid down to the favorite.
    await page.locator('.toggle-btn').click();
    await page.getByText('Canais favoritos').click();
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();
    await expect(page.getByText('SBT HD')).toHaveCount(0);
});

test('multi-view v2: layouts mudam a grade e 🔄 troca canal de célula ocupada', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();
    await page.locator('button[title*="Multi-view"]').click();

    // 2x2 default: 4 tiles ("+ Adicionar canal" on all empty slots).
    await expect(page.getByText('Clique num quadro para levar o áudio')).toBeVisible();
    await expect(page.getByText('+ Adicionar canal')).toHaveCount(4);

    // 1+2 layout: 3 tiles; side-by-side: 2.
    await page.locator('button[title="1 grande + 2"]').click();
    await expect(page.getByText('+ Adicionar canal')).toHaveCount(3);
    await page.locator('button[title="2 lado a lado"]').click();
    await expect(page.getByText('+ Adicionar canal')).toHaveCount(2);
    await page.locator('button[title="4 canais (2×2)"]').click();

    // Fill a slot, then 🔄 reopens the picker on the occupied tile.
    await page.getByText('+ Adicionar canal').first().click();
    await page.getByPlaceholder('Buscar canal...').fill('SBT');
    // .last() = the picker row (the channel grid behind the mosaic also matches)
    await page.getByText('SBT HD').last().click();
    await expect(page.locator('button[title="Trocar canal"]')).toBeVisible();
    await page.locator('button[title="Trocar canal"]').click();
    await expect(page.getByPlaceholder('Buscar canal...')).toBeVisible();
    await page.keyboard.press('Escape'); // close picker
    await page.keyboard.press('Escape'); // close mosaic
});

test('overlay ?: cheatsheet abre com os grupos de atalhos e fecha no Esc', async () => {
    const page = await boot();

    await page.keyboard.press('Shift+?');
    await expect(page.getByText('Atalhos de teclado')).toBeVisible();
    await expect(page.getByText('Busca global')).toBeVisible();
    await expect(page.getByText('Canal anterior / próximo')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('Atalhos de teclado')).toHaveCount(0);
});
