import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Retrospectiva anual, aberta pelo aviso de dezembro.
 *
 * O aviso dispara `neostream:open-wrapped` e o único ouvinte vivia dentro do
 * StatsSection — ou seja, em Configurações → Estatísticas, num chunk que só
 * carrega quando se abre aquela seção. Clicar no aviso em QUALQUER outra tela
 * não fazia nada: a notificação era consumida e a Retrospectiva não abria.
 * Uma vez por ano, e sem segunda chance.
 *
 * Este spec fica na Home de propósito: é a tela onde o bug acontecia.
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

/** Dados de uso para o perfil e2e-adult — a Retrospectiva lê só isto. */
async function seedUsageStats(page: Page): Promise<void> {
    await page.evaluate(() => {
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem('usage_stats_e2e-adult', JSON.stringify({
            totalWatchTimeSeconds: 7200,
            totalWatchTimeThisMonth: 7200,
            sessionsThisMonth: [
                { contentId: 'm1', contentType: 'movie', contentName: 'Matrix E2E', watchedSeconds: 4000, date: today, genre: 'Ação', hourBucket: 'evening' },
                { contentId: 'l1', contentType: 'live', contentName: 'Globo E2E', watchedSeconds: 1200, date: today, hourBucket: 'morning' },
            ],
            contentBreakdown: { movies: 4000, series: 2000, live: 1200 },
            watchStreak: 3,
            longestStreak: 5,
            dailyStats: [{ date: today, totalSeconds: 7200, movies: 4000, series: 2000, live: 1200 }],
            lastWatchDate: today,
        }));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
}

test('a Retrospectiva abre a partir de qualquer tela do painel, não só das Estatísticas', async () => {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();
    await seedUsageStats(page);
    await expect(page.getByText(GREETING)).toBeVisible();

    // É o que o clique no aviso anual faz (NotificationsPanel), daqui da Home.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('neostream:open-wrapped')));

    await expect(page.locator('.wrapped-backdrop')).toBeVisible();
    await expect(page.locator('.wrapped-card')).toBeVisible();

    // E fecha, sem deixar o painel travado por trás.
    await page.locator('.wrapped-close').click();
    await expect(page.locator('.wrapped-backdrop')).toHaveCount(0);
    await expect(page.getByText(GREETING)).toBeVisible();
});

test('o botão dentro das Estatísticas continua abrindo a mesma Retrospectiva', async () => {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();
    await seedUsageStats(page);

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Estatísticas' }).click();
    await page.getByText('🎁').first().click();

    await expect(page.locator('.wrapped-backdrop')).toBeVisible();
});
