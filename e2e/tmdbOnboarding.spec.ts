import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Onboarding da chave TMDB (#225): adding a playlist WITHOUT a configured key
 * must land the user (once) on Configurações → APIs with the explainer banner;
 * with a key already configured, adding a playlist changes nothing.
 *
 * The `neostream_tmdb_ignore_env` hook simulates the packaged app: local dev
 * builds bake the .env fallback key, which would otherwise mask the flow.
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

/** Settings → Playlists → add the mock M3U (same flow as the m3u specs). */
async function addM3uPlaylist(page: Page): Promise<void> {
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await page.getByRole('button', { name: /\+ / }).click();
    await page.getByRole('button', { name: 'M3U', exact: true }).click();
    await page.locator('.playlists-add-form input[type="text"]').first().fill('Lista Onboarding E2E');
    await page.locator('.playlists-add-form input').nth(1).fill(`${server.url}/lista.m3u`);
    await page.locator('.playlists-add-form button[type="submit"]').click();
}

test('adicionar playlist SEM chave TMDB redireciona pra Configurações → APIs com o banner', async () => {
    const page = await boot();

    // Simula o app instalado: sem chave própria e sem fallback de .env.
    await page.evaluate(() => localStorage.setItem('neostream_tmdb_ignore_env', '1'));

    await addM3uPlaylist(page);

    // Depois do reload, o Home consome a flag e leva pra seção APIs.
    await expect(page.getByText('Playlist adicionada! Só falta um passo…')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('APIs de metadados')).toBeVisible();
    await expect(page.getByText('TMDB (The Movie Database)')).toBeVisible();

    // A flag é de consumo único: sair e voltar pro Home não redireciona de novo.
    await page.locator('button.nav-item[title="Início"]').click();
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(800);
    await expect(page.getByText('APIs de metadados')).toHaveCount(0);
});

test('adicionar playlist COM chave TMDB configurada não redireciona', async () => {
    const page = await boot();

    await page.evaluate(() => {
        localStorage.setItem('neostream_tmdb_ignore_env', '1');
        localStorage.setItem('neostream_tmdb_api_key', 'chave-e2e-configurada');
    });

    await addM3uPlaylist(page);

    // Fica no dashboard normal — sem banner, sem seção APIs.
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 45000 });
    await page.waitForTimeout(800);
    await expect(page.getByText('Playlist adicionada! Só falta um passo…')).toHaveCount(0);
    await expect(page.getByText('APIs de metadados')).toHaveCount(0);
});
