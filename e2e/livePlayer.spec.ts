import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Live player chrome (rounds 12–13): zapping overlay (📺), REC button (⏺).
 * The mock serves no actual video — the stream errors out — but the player UI
 * mounts fully, which is exactly the surface these tests pin down.
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

async function openLivePlayer(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();

    // Channel card → side panel → "Assistir Agora" mounts the full player.
    await page.getByText('Globo São Paulo HD').first().click();
    await page.getByRole('button', { name: /Assistir Agora/ }).click();

    // Player chrome up (controls bar with the live-only buttons).
    await expect(page.locator('.video-player-container')).toBeVisible();
    return page;
}

test('player live: botões de zapping (📺) e gravação (⏺) presentes', async () => {
    const page = await openLivePlayer();

    // Keep the controls visible.
    await page.mouse.move(400, 400);
    await expect(page.locator('button[title*="Lista de canais"]')).toBeVisible();
    await expect(page.locator('button[title="Gravar canal"]')).toBeVisible();
});

test('player live: overlay de canais abre com a lista do mock e fecha no Esc', async () => {
    const page = await openLivePlayer();

    await page.mouse.move(400, 400);
    await page.locator('button[title*="Lista de canais"]').click();

    // Overlay: header + other channels from the mock list (scoped to the
    // overlay rows — the channel grid behind the player also shows names).
    await expect(page.getByText('📺 Canais')).toBeVisible();
    await expect(page.locator('.zap-row', { hasText: 'SBT HD' }).first()).toBeVisible();

    // Esc closes the overlay but keeps the player open.
    await page.keyboard.press('Escape');
    await expect(page.getByText('📺 Canais')).toHaveCount(0);
    await expect(page.locator('.video-player-container')).toBeVisible();
});

test('player live: clicar num canal do overlay troca o canal em reprodução', async () => {
    const page = await openLivePlayer();

    await page.mouse.move(400, 400);
    await page.locator('button[title*="Lista de canais"]').click();
    await expect(page.getByText('📺 Canais')).toBeVisible();

    // Switch to SBT — the overlay closes and the player title updates.
    await page.locator('.zap-row', { hasText: 'SBT HD' }).first().click();
    await expect(page.getByText('📺 Canais')).toHaveCount(0);
    await expect(page.locator('.video-player-container')).toContainText('SBT HD');
});
