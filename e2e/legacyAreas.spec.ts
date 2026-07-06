import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Coverage for mature areas that never got a dedicated spec (task R38-PR5):
 * the in-app Gravações page (DVR files on disk: list + delete) and the M3U
 * phase-2 VOD heuristic (a "FILMES ..." group lands on the Movies page).
 * Multi-view, manual REC buttons and M3U live/series are already covered by
 * r19 / livePlayer / r22 / m3uSeries.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => { server = await startMockServer(); });
test.afterAll(async () => { await server.close(); });
test.afterEach(async () => { await launched?.close(); launched = null; });

test('gravações: arquivos do DVR aparecem em Baixados e a exclusão remove da lista', async () => {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;

    // The e2e hook redirects app.getPath('videos') into the sandbox, so the
    // DVR folder lives inside the throwaway userData dir. Seed two finished
    // recordings (list shows any *.ts in the folder; content is irrelevant).
    const recDir = path.join(launched.userDataDir, 'videos', 'NeoStream', 'Gravacoes');
    fs.mkdirSync(recDir, { recursive: true });
    fs.writeFileSync(path.join(recDir, 'Globo_Jornal_E2E.ts'), Buffer.alloc(2048));
    fs.writeFileSync(path.join(recDir, 'SBT_Novela_E2E.ts'), Buffer.alloc(4096));

    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Baixados"]').click();
    await page.getByRole('button', { name: /Gravações \(2\)/ }).click();

    // Both files listed (names shown without the .ts extension).
    await expect(page.getByText('Globo_Jornal_E2E')).toBeVisible();
    await expect(page.getByText('SBT_Novela_E2E')).toBeVisible();

    // Delete one → it leaves the list AND the disk; the other survives.
    const row = page.locator('div', { hasText: /^📼/ }).filter({ hasText: 'Globo_Jornal_E2E' }).last();
    await row.getByTitle('Excluir').click();
    await expect(page.getByText('Globo_Jornal_E2E')).toHaveCount(0);
    await expect(page.getByText('SBT_Novela_E2E')).toBeVisible();
    expect(fs.existsSync(path.join(recDir, 'Globo_Jornal_E2E.ts'))).toBe(false);
    expect(fs.existsSync(path.join(recDir, 'SBT_Novela_E2E.ts'))).toBe(true);
});

test('m3u fase 2: grupo "FILMES ..." vira filme na página de Filmes', async () => {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Add the mock M3U list (same flow the r22 spec uses for live channels).
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await page.getByRole('button', { name: /\+ / }).click();
    await page.getByRole('button', { name: 'M3U', exact: true }).click();
    await page.locator('.playlists-add-form input[type="text"]').first().fill('Lista M3U E2E');
    await page.locator('.playlists-add-form input').nth(1).fill(`${server.url}/lista.m3u`);
    await page.locator('.playlists-add-form button[type="submit"]').click();
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 20000 });

    // The VOD-heuristic entry (group "FILMES M3U", no SxxEyy tag) is a movie.
    await page.locator('button.nav-item[title="Filmes"]').click();
    await expect(page.getByText('Filme Mock M3U (2024)').first()).toBeVisible({ timeout: 20000 });

    // ...and it did NOT leak into the live channel list.
    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Canal M3U Um').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Filme Mock M3U (2024)')).toHaveCount(0);
});
