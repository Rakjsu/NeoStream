import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * M3U phase 3: SxxEyy items in series groups become a real series catalog
 * (grouped by base name, seasons/episodes in the detail view).
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

test('m3u fase 3: episódios SxxEyy viram série agrupada na página Séries', async () => {
    test.setTimeout(90000);
    const page = await boot();

    // Add the mock M3U playlist via settings.
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await page.getByRole('button', { name: /\+ / }).click();
    await page.getByRole('button', { name: 'M3U', exact: true }).click();
    await page.locator('.playlists-add-form input[type="text"]').first().fill('Lista Séries E2E');
    await page.locator('.playlists-add-form input').nth(1).fill(`${server.url}/lista.m3u`);
    await page.locator('.playlists-add-form button[type="submit"]').click();
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 45000 });

    // The three SxxEyy items collapse into ONE series called "Serie Mock".
    await page.locator('button.nav-item[title="Séries"]').click();
    await expect(page.getByText('Serie Mock').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Serie Mock S01E01')).toHaveCount(0);
});
