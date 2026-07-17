import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 20 features: unified agenda (reminders + scheduled recordings with
 * in-place cancel), player aspect-ratio modes and the new-episode
 * notification toggle.
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

test('agenda: lembrete e gravação futuros aparecem em Hoje e cancelam no lugar', async () => {
    const page = await boot();

    // Seed one reminder (+2h) and one scheduled recording (+3h..+4h) for the
    // active profile (both services key by profile id only).
    await page.evaluate(() => {
        const inH = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
        localStorage.setItem('program_reminders_e2e-adult', JSON.stringify([
            { id: 'rem-1', channelName: 'Globo São Paulo HD', streamId: 1, title: 'Lembrete E2E', startIso: inH(2) }
        ]));
        localStorage.setItem('scheduled_recordings_e2e-adult', JSON.stringify([
            { id: 'rec-1', channelName: 'SBT HD', streamId: 2, title: 'Gravação E2E', startIso: inH(3), endIso: inH(4) }
        ]));
    });
    await page.reload();
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Baixados"]').click();
    await page.getByRole('button', { name: /🗓️ Agenda/ }).click();

    // Perto da meia-noite (fuso do runner) os itens de +2h/+3h caem em "Amanhã".
    await expect(page.getByText(/Hoje|Amanhã/).first()).toBeVisible();
    await expect(page.getByText('Lembrete E2E')).toBeVisible();
    await expect(page.getByText('Gravação E2E')).toBeVisible();

    // Cancel the reminder: its row disappears, the recording stays.
    await page.locator('button[title="Cancelar lembrete"]').click();
    await expect(page.getByText('Lembrete E2E')).toHaveCount(0);
    await expect(page.getByText('Gravação E2E')).toBeVisible();
});

test('proporção: menu de engrenagem aplica Esticar no elemento de vídeo', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await page.getByText('Globo São Paulo HD').first().click();
    await page.getByRole('button', { name: /Assistir Agora/ }).click();
    await expect(page.locator('.video-player-container')).toBeVisible();

    await page.mouse.move(400, 400);
    await page.locator('.settings-btn').click();
    await expect(page.getByText('Proporção')).toBeVisible();

    // Default mode is Preencher (cover) — the player's historical rendering.
    await expect(page.locator('.video-fullwidth')).toHaveCSS('object-fit', 'cover');

    await page.getByRole('button', { name: 'Esticar', exact: true }).click();
    await expect(page.locator('.video-fullwidth')).toHaveCSS('object-fit', 'fill');

    // Back to original restores contain (the gear menu stays open).
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await expect(page.locator('.video-fullwidth')).toHaveCSS('object-fit', 'contain');
});

test('notificação de novos episódios: toggle persiste a preferência', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Reprodução' }).click();

    const row = page.locator('.setting-item', { hasText: 'Notificar novos episódios' });
    await expect(row).toBeVisible();
    await row.locator('.toggle-slider').click();

    await expect.poll(async () =>
        page.evaluate(() => localStorage.getItem('neostream_notify_new_episodes'))
    ).toBe('1');

    await row.locator('.toggle-slider').click();
    await expect.poll(async () =>
        page.evaluate(() => localStorage.getItem('neostream_notify_new_episodes'))
    ).toBe('0');
});
