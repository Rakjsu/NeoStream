import { test, expect } from '@playwright/test';
import { launchApp, startMockServer, USERNAME, PASSWORD, type LaunchedApp } from './helpers';

/**
 * First-run flows: app boot without a configured playlist and the full
 * login flow against the mock Xtream server.
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

test('boot sem playlist mostra a tela de boas-vindas', async () => {
    launched = await launchApp();
    const { page } = launched;

    await expect(page.getByText('Nenhuma playlist configurada')).toBeVisible();
    await expect(page.getByText('Adicionar Playlist')).toBeVisible();
});

test('login contra o servidor mock leva ao seletor de perfis', async () => {
    launched = await launchApp();
    const { page } = launched;

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
