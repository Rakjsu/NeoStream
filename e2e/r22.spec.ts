import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 22 features: M3U playlists (add by URL → channels in Live TV with
 * groups as categories), remembered aspect mode and the auto-backup pipeline.
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

test('m3u: adicionar lista por URL leva os canais pra TV ao Vivo com grupos', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await page.getByRole('button', { name: /\+ / }).click(); // "+ Adicionar"

    await page.getByRole('button', { name: 'M3U', exact: true }).click();
    await page.locator('.playlists-add-form input[type="text"]').first().fill('Lista M3U E2E');
    await page.locator('.playlists-add-form input').nth(1).fill(`${server.url}/lista.m3u`);
    await page.locator('.playlists-add-form button[type="submit"]').click();

    // Adding switches + reloads into the dashboard.
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 45000 });

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Canal M3U Um').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Canal M3U Esporte').first()).toBeVisible();

    // Groups became categories.
    await page.locator('.toggle-btn').click();
    await expect(page.getByText('Abertos M3U')).toBeVisible();
    await expect(page.getByText('Esportes M3U')).toBeVisible();
    await page.getByText('Esportes M3U').click();
    await expect(page.getByText('Canal M3U Esporte').first()).toBeVisible();
    await expect(page.getByText('Canal M3U Um')).toHaveCount(0);
});

test('proporção lembrada: escolher Original persiste pro mesmo canal', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await page.getByText('Globo São Paulo HD').first().click();
    await page.getByRole('button', { name: /Assistir Agora/ }).click();
    await expect(page.locator('.video-player-container')).toBeVisible();

    await page.mouse.move(400, 400);
    await page.locator('.settings-btn').click();
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await expect(page.locator('.video-fullwidth')).toHaveCSS('object-fit', 'contain');

    // Close the player, reopen the same channel: mode restored from prefs.
    await page.keyboard.press('Escape');
    await page.getByText('Globo São Paulo HD').first().click();
    await page.getByRole('button', { name: /Assistir Agora/ }).click();
    await expect(page.locator('.video-player-container')).toBeVisible();
    await expect(page.locator('.video-fullwidth')).toHaveCSS('object-fit', 'contain');
});

test('backup automático: auto-save grava o arquivo datado na pasta escolhida', async () => {
    const page = await boot();
    const backupDir = path.join(launched!.userDataDir, 'auto-backups');

    // Configure without the native folder dialog, then exercise the save path
    // exactly as the renderer's auto-collect listener does.
    const saved = await page.evaluate(async (dir) => {
        await window.ipcRenderer.invoke('backup:auto-config-set', { enabled: true });
        // dirPath goes through the same setter the dialog uses.
        await window.ipcRenderer.invoke('backup:auto-config-set', { enabled: true, dirPath: dir });
        return await window.ipcRenderer.invoke('backup:auto-save', {
            json: JSON.stringify({ app: 'neostream', version: 2, data: {} })
        }) as { success: boolean; path?: string };
    }, backupDir);

    expect(saved.success).toBe(true);
    expect(saved.path).toBeTruthy();
    expect(fs.existsSync(saved.path!)).toBe(true);
    expect(path.basename(saved.path!)).toMatch(/^neostream-backup-\d{4}-\d{2}-\d{2}\.json$/);

    // Config round-trips (lastBackupAt stamped).
    const config = await page.evaluate(async () =>
        (await window.ipcRenderer.invoke('backup:auto-config-get') as { config: { enabled: boolean; lastBackupAt: number } }).config);
    expect(config.enabled).toBe(true);
    expect(config.lastBackupAt).toBeGreaterThan(0);
});
