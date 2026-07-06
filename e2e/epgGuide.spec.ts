import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * EPG guide grid — structure & navigation. The scheduledDvr spec covers acting
 * on program blocks (schedule/remind); this covers the grid itself: the sticky
 * time header renders, channels list, the "now" line shows, and time paging
 * (◀/▶) shifts the window while "Hoje / Agora" resets it.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => { server = await startMockServer(); });
test.afterAll(async () => { await server.close(); });
test.afterEach(async () => { await launched?.close(); launched = null; });

async function openGuide(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();
    await page.locator('button.nav-item[title="Guia de TV"]').click();
    // The lazily-loaded EPG has this future block; once it's up the grid is ready.
    await expect(page.getByText('Novela das Nove').first()).toBeVisible({ timeout: 20000 });
    return page;
}

test('guia: a grade renderiza cabeçalho de tempo, canais e a linha "Agora"', async () => {
    const page = await openGuide();

    // Sticky timeline header + at least one HH:MM tick.
    await expect(page.getByTestId('guide-timeline-header')).toBeVisible();
    await expect(page.getByTestId('guide-tick-first')).toHaveText(/^\d{1,2}:\d{2}$/);

    // Channel count chip ("N canais") proves rows were built.
    await expect(page.getByText(/\d+\s+canais/)).toBeVisible();

    // The "Agora" marker line is present (now is within the default window).
    await expect(page.getByText('Agora', { exact: true }).first()).toBeVisible();
});

test('guia: ◀/▶ deslocam a janela de tempo e "Hoje / Agora" volta ao padrão', async () => {
    const page = await openGuide();

    const firstTick = page.getByTestId('guide-tick-first');
    const original = (await firstTick.textContent())?.trim() ?? '';
    expect(original).toMatch(/^\d{1,2}:\d{2}$/);

    // Paging later shifts the window, so the first visible tick changes.
    await page.locator('button[aria-label="Mais tarde"]').click();
    await expect(firstTick).not.toHaveText(original);
    const later = (await firstTick.textContent())?.trim() ?? '';

    // "Hoje / Agora" resets back to the default window (original first tick).
    await page.locator('button[title="Hoje / Agora"]').click();
    await expect(firstTick).toHaveText(original);
    expect(later).not.toBe(original);
});
