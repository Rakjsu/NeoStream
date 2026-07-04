import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 26: Stalker/MAC portals — add a portal by URL+MAC in Settings →
 * Playlists, channels land in Live TV with genres as categories, and playback
 * resolves the channel cmd via create_link.
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

test('stalker: adicionar portal por URL+MAC leva os canais pra TV ao Vivo', async () => {
    test.setTimeout(90000);
    const page = await boot();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await page.getByRole('button', { name: /\+ / }).click(); // "+ Adicionar"

    await page.getByRole('button', { name: 'Stalker/MAC', exact: true }).click();
    await page.locator('.playlists-add-form input[type="text"]').nth(0).fill('Portal E2E');
    await page.locator('.playlists-add-form input[type="text"]').nth(1).fill(server.url);
    await page.locator('.playlists-add-form input[type="text"]').nth(2).fill('00:1A:79:AB:CD:EF');
    await page.locator('.playlists-add-form button[type="submit"]').click();

    // Adding switches + reloads into the dashboard.
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 20000 });

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Canal STK Um').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Canal STK Esporte').first()).toBeVisible();

    // Genres became categories.
    await page.locator('.toggle-btn').click();
    await expect(page.getByText('Abertos STK')).toBeVisible();
    await expect(page.getByText('Esportes STK')).toBeVisible();
    await page.getByText('Esportes STK').click();
    await expect(page.getByText('Canal STK Esporte').first()).toBeVisible();
    await expect(page.getByText('Canal STK Um')).toHaveCount(0);

    // Settings list shows the portal identity (host + MAC).
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await expect(page.getByText('Portal E2E')).toBeVisible();
    await expect(page.getByText(/Stalker · .*00:1A:79:AB:CD:EF/)).toBeVisible();
});
