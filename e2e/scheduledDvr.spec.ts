import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Scheduled DVR from the EPG guide (round 13): pick a FUTURE program →
 * "Gravar este programa" → ⏺ indicator on the block → cancel removes it.
 * The mock guide always has "Novela das Nove" as a future block on
 * Globo São Paulo HD (now+1h..now+2h), so no clock games are needed —
 * and nothing actually records (the schedule fires an hour from now).
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

async function openGuideWithEpg(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Guia de TV"]').click();
    // EPG rows load lazily; the future block is what the tests act on.
    await expect(page.getByText('Novela das Nove').first()).toBeVisible({ timeout: 20000 });
    return page;
}

test('guia: agendar gravação de programa futuro marca o bloco com ⏺', async () => {
    const page = await openGuideWithEpg();

    await page.getByText('Novela das Nove').first().click();
    await expect(page.getByRole('menuitem', { name: /Gravar este programa/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /Gravar este programa/ }).click();

    // Red dot indicator lands on the scheduled block.
    await expect(page.locator('span[title="Cancelar gravação"]')).toBeVisible();
});

test('guia: cancelar gravação agendada remove o indicador', async () => {
    const page = await openGuideWithEpg();

    // Schedule...
    await page.getByText('Novela das Nove').first().click();
    await page.getByRole('menuitem', { name: /Gravar este programa/ }).click();
    await expect(page.locator('span[title="Cancelar gravação"]')).toBeVisible();

    // ...then the same popover offers cancel.
    await page.getByText('Novela das Nove').first().click();
    await expect(page.getByRole('menuitem', { name: /Cancelar gravação/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /Cancelar gravação/ }).click();

    await expect(page.locator('span[title="Cancelar gravação"]')).toHaveCount(0);
});

test('guia: lembrete e gravação convivem no mesmo programa', async () => {
    const page = await openGuideWithEpg();

    await page.getByText('Novela das Nove').first().click();
    await page.getByRole('menuitem', { name: /Lembrar deste programa/ }).click();

    await page.getByText('Novela das Nove').first().click();
    await page.getByRole('menuitem', { name: /Gravar este programa/ }).click();

    // Both indicators on the block (🔔 shifts left to make room for ⏺).
    await expect(page.locator('span[title="Remover lembrete"]')).toBeVisible();
    await expect(page.locator('span[title="Cancelar gravação"]')).toBeVisible();
});
