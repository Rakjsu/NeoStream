import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 16: statistics dashboard (seeded usage_stats) + player sleep timer.
 * The dashboard renders purely from localStorage, so the data is seeded
 * before navigating; the sleep timer is exercised in the live player (the
 * gear menu shows it even without quality variants).
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

async function bootToDashboard(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();
    return page;
}

/** Seeds usage stats for the e2e-adult profile and reloads the renderer. */
async function seedUsageStats(page: Page): Promise<void> {
    await page.evaluate(() => {
        const today = new Date().toISOString().split('T')[0];
        const stats = {
            totalWatchTimeSeconds: 7200,
            totalWatchTimeThisMonth: 7200,
            sessionsThisMonth: [
                { contentId: 'm1', contentType: 'movie', contentName: 'Matrix E2E', watchedSeconds: 4000, date: today, genre: 'Ação', hourBucket: 'evening' },
                { contentId: 's1', contentType: 'series', contentName: 'Dark E2E', watchedSeconds: 2000, date: today, genre: 'Drama', hourBucket: 'evening' },
                { contentId: 'l1', contentType: 'live', contentName: 'Globo E2E', watchedSeconds: 1200, date: today, hourBucket: 'morning' }
            ],
            contentBreakdown: { movies: 4000, series: 2000, live: 1200 },
            watchStreak: 3,
            longestStreak: 5,
            dailyStats: [
                { date: today, totalSeconds: 7200, movies: 4000, series: 2000, live: 1200 }
            ],
            lastWatchDate: today
        };
        localStorage.setItem('usage_stats_e2e-adult', JSON.stringify(stats));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(GREETING)).toBeVisible();
}

async function openStatsSection(page: Page): Promise<void> {
    await page.locator('button.nav-item[title="Configurações"]').click();
    await expect(page.locator('h1', { hasText: 'Configurações' })).toBeVisible();
    await page.locator('.settings-nav .nav-item', { hasText: 'Estatísticas' }).click();
}

test('stats: dashboard mostra gráficos e tops com dados semeados', async () => {
    const page = await bootToDashboard();
    await seedUsageStats(page);
    await openStatsSection(page);

    // Section cards from the seeded data.
    await expect(page.getByText('Últimos 30 Dias')).toBeVisible();
    await expect(page.getByText('Distribuição por Tipo')).toBeVisible();
    await expect(page.getByText('Mais Assistidos do Mês')).toBeVisible();
    await expect(page.getByText('Gêneros Favoritos do Mês')).toBeVisible();
    await expect(page.getByText('Dia mais ativo')).toBeVisible();

    // Top content ranks the seeded sessions.
    await expect(page.getByText('🎬 Matrix E2E')).toBeVisible();
    await expect(page.getByText('📺 Dark E2E')).toBeVisible();

    // Type share percentages (4000/7200≈56%, 2000/7200≈28%, 1200/7200≈17%).
    await expect(page.getByText('56%')).toBeVisible();
    await expect(page.getByText('28%')).toBeVisible();
    await expect(page.getByText('17%')).toBeVisible();

    // Streak card from the seeded stats.
    await expect(page.getByText('3 dias')).toBeVisible();
});

test('stats: sem dados mostra a dica de estado vazio', async () => {
    const page = await bootToDashboard();
    await openStatsSection(page);

    await expect(page.getByText(/Sem dados ainda/)).toBeVisible();
    // Ranked cards don't render without sessions.
    await expect(page.getByText('Mais Assistidos do Mês')).toHaveCount(0);
});

async function openLivePlayer(): Promise<Page> {
    const page = await bootToDashboard();

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();
    await page.getByText('Globo São Paulo HD').first().click();
    await page.getByRole('button', { name: /Assistir Agora/ }).click();
    await expect(page.locator('.video-player-container')).toBeVisible();
    return page;
}

test('sleep timer: armar 30 min mostra o chip 🌙 e "Desligado" remove', async () => {
    const page = await openLivePlayer();

    // Gear menu → sleep timer section (visible on live since round 15).
    await page.mouse.move(400, 400);
    await page.locator('.settings-btn').click();
    await expect(page.getByText('Timer de desligamento')).toBeVisible();

    await page.getByRole('button', { name: '30 min', exact: true }).click();

    // Countdown chip appears at ~30:00 (tabular countdown, minutes ticking).
    await expect(page.locator('.sleep-timer-chip')).toBeVisible();
    await expect(page.locator('.sleep-timer-chip')).toContainText(/(29|30):/);

    // Menu marks the armed option as active.
    await page.locator('.settings-btn').click();
    await expect(page.locator('.settings-option.active', { hasText: '30 min' })).toBeVisible();

    // "Desligado" cancels and removes the chip.
    await page.getByRole('button', { name: 'Desligado', exact: true }).click();
    await expect(page.locator('.sleep-timer-chip')).toHaveCount(0);
});
