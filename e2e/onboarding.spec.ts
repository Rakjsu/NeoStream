import { test, expect } from '@playwright/test';
import { launchApp, startMockServer, USERNAME, PASSWORD, type LaunchedApp } from './helpers';

/**
 * First-run flows: the onboarding wizard (language step → connect step) and
 * the full login flow against the mock Xtream server.
 */

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

test('boot sem playlist mostra o wizard: idioma e depois conexão', async () => {
    launched = await launchApp();
    const { page } = launched;

    // Step 1: language
    await expect(page.getByText('Bem-vindo ao NeoStream')).toBeVisible();
    // The hidden settings slide panel also lists languages — scope to the wizard cards.
    await expect(page.locator('.welcome-lang-card', { hasText: 'Português' })).toBeVisible();
    await expect(page.locator('.welcome-lang-card', { hasText: 'English' })).toBeVisible();

    await page.getByRole('button', { name: 'Continuar' }).click();

    // Step 2: connect options
    await expect(page.getByText('Nenhuma playlist configurada')).toBeVisible();
    await expect(page.getByText('Adicionar Playlist')).toBeVisible();
    await expect(page.getByText('Lista M3U')).toBeVisible();
    await expect(page.getByText('Restaurar backup')).toBeVisible();

    // Back returns to the language step.
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByText('Bem-vindo ao NeoStream')).toBeVisible();
});

test('login contra o servidor mock leva ao seletor de perfis', async () => {
    launched = await launchApp();
    const { page } = launched;

    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByText('Adicionar Playlist').click();

    // Credentials form
    await page.locator('input[placeholder="http://example.com:8080"]').fill(server.url);
    await page.locator('.login-field', { hasText: 'Usuário' }).locator('input').fill(USERNAME);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();

    // Step 2: library summary fetched from the mock server
    await expect(page.locator('.login-stats-title')).toHaveText('Biblioteca');
    await expect(page.locator('.login-stat-value').nth(0)).toHaveText('7'); // channels
    await expect(page.locator('.login-stat-value').nth(1)).toHaveText('8'); // movies
    await expect(page.locator('.login-stat-value').nth(2)).toHaveText('4'); // series

    await page.locator('.login-playlist input[type="text"]').fill('Playlist E2E');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // The app reloads itself; authenticated boot lands on the profile selector
    await expect(page.getByText('Quem está assistindo?')).toBeVisible();
});

test('wizard: adicionar lista M3U direto da tela de boas-vindas', async () => {
    launched = await launchApp();
    const { page } = launched;

    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByText('Lista M3U', { exact: true }).click();

    await page.locator('.welcome-m3u-form input[type="text"]').fill('Lista Wizard');
    await page.locator('.welcome-m3u-form input[type="url"]').fill(`${server.url}/lista.m3u`);
    await page.getByRole('button', { name: 'Adicionar lista' }).click();

    // Adding switches + reloads; authenticated boot lands on the profile selector.
    await expect(page.getByText('Quem está assistindo?')).toBeVisible({ timeout: 20000 });
});
