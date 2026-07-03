import { test, expect } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 17 features: guest profile (leaves no trace), configurable global
 * search scope (Settings → Busca) and provider health check (Diagnostics).
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

test('convidado: sessão funciona e sai sem deixar rastro ao trocar de perfil', async () => {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: null }); // profile selector shown

    await page.getByRole('button', { name: /Entrar como convidado/ }).click();
    await expect(page.getByText(GREETING)).toBeVisible();

    // Guest generates per-profile data during the session…
    await page.evaluate(() => {
        localStorage.setItem('usage_stats_guest', '{"totalWatchTimeSeconds":123}');
    });

    // …switching to a regular profile wipes it and drops the guest entry.
    await page.locator('button[title="Trocar Perfil"]').click();
    await page.locator('.profile-popup-item', { hasText: 'Tester' }).click();
    await expect(page.getByText(GREETING)).toBeVisible();

    await expect.poll(async () => page.evaluate(() => ({
        stats: localStorage.getItem('usage_stats_guest'),
        hasGuest: (JSON.parse(localStorage.getItem('neostream_profiles') || '{}').profiles || [])
            .some((p: { id: string }) => p.id === 'guest')
    }))).toEqual({ stats: null, hasGuest: false });
});

test('busca configurável: desligar Filmes tira os filmes do Ctrl+K', async () => {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Sanity: with defaults the mock movie is searchable.
    await page.keyboard.press('Control+k');
    await expect(page.locator('.gsearch-input')).toBeVisible();
    await page.locator('.gsearch-input').fill('Bacurau');
    await expect(page.locator('.gsearch-item', { hasText: 'Bacurau' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Settings → Busca → toggle "Filmes" off.
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Busca' }).click();
    const movieToggle = page.locator('.setting-item', { hasText: 'Filmes' }).locator('.toggle-slider').first();
    await movieToggle.click();

    // Blur the checkbox (Ctrl+K is ignored while an input has focus).
    await page.locator('h1', { hasText: 'Configurações' }).click();

    // The overlay re-reads the config per open: movie no longer found.
    await page.keyboard.press('Control+k');
    await page.locator('.gsearch-input').fill('Bacurau');
    await expect(page.getByText('Nenhum resultado encontrado')).toBeVisible();
    await expect(page.locator('.gsearch-item')).toHaveCount(0);
});

test('saúde do provedor: teste contra o mock dá veredito verde com latências', async () => {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Diagnóstico' }).click();

    await page.getByRole('button', { name: /Testar agora/ }).click();

    await expect(page.getByText('Provedor respondendo normalmente')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('API (player_api.php)')).toBeVisible();
    await expect(page.getByText(/\d+ ms/).first()).toBeVisible();
});
