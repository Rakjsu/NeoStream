import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 25 features: multi-machine sync (merge of another machine's file from
 * the synced folder) and the Wrapped retrospective overlay.
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

test('sync: mescla o arquivo de outra máquina e reescreve o próprio', async () => {
    test.setTimeout(90000);

    // Synced folder with ONE remote machine file: a theme we don't have
    // (adopt) and a watch-later list that must union with ours.
    const syncDir = mkdtempSync(path.join(tmpdir(), 'neostream-sync-e2e-'));
    const watchLaterKey = 'neostream_watchlater_e2e-adult__pl_default';
    writeFileSync(path.join(syncDir, 'neostream-sync-remota-x1.json'), JSON.stringify({
        version: 2,
        exportedAt: new Date().toISOString(),
        app: 'neostream',
        data: {
            neostream_theme: JSON.stringify({ accent: 'roxo-e2e' }),
            [watchLaterKey]: JSON.stringify([
                { id: 'remoto-1', type: 'movie', title: 'Filme da Remota', poster: '', addedAt: '2026-01-01' },
            ]),
        },
    }), 'utf-8');

    launched = await launchApp({
        serverUrl: server.url,
        extraStores: {
            'sync-folder': {
                syncFolder: { enabled: true, dirPath: syncDir, machineId: 'e2e-local', lastSyncAt: 0 },
            },
        },
    });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Local watch-later already has one item; the merge must union, not replace.
    await page.evaluate((key) => {
        localStorage.setItem(key, JSON.stringify([
            { id: 'local-1', type: 'movie', title: 'Filme Local', poster: '', addedAt: '2026-02-01' },
        ]));
    }, watchLaterKey);

    // Trigger a cycle now (instead of waiting for the boot timer).
    await page.evaluate(() => window.ipcRenderer.invoke('sync:run-now'));

    // Adopted key + union arrive in localStorage.
    await expect.poll(async () =>
        page.evaluate(() => localStorage.getItem('neostream_theme')), { timeout: 15000 }
    ).toContain('roxo-e2e');
    const mergedList = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? '[]') as { id: string }[],
        watchLaterKey
    );
    expect(mergedList.map(item => item.id).sort()).toEqual(['local-1', 'remoto-1']);

    // Our own machine file was (re)written with the merged state.
    await expect.poll(() =>
        existsSync(path.join(syncDir, 'neostream-sync-e2e-local.json')), { timeout: 15000 }
    ).toBe(true);

    rmSync(syncDir, { recursive: true, force: true });
});

async function bootWithStats(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Seed enough usage stats for a meaningful retrospective (per-profile key).
    await page.evaluate(() => {
        localStorage.setItem('usage_stats_e2e-adult', JSON.stringify({
            totalWatchTimeSeconds: 7200,
            totalWatchTimeThisMonth: 3600,
            sessionsThisMonth: [],
            contentBreakdown: { movies: 5400, series: 1200, live: 600 },
            watchStreak: 3,
            longestStreak: 8,
            dailyStats: [],
            lastWatchDate: null,
            contentTotals: {
                f1: { name: 'Filme Campeão', type: 'movie', seconds: 5400 },
                s1: { name: 'Série Vice', type: 'series', seconds: 1200 },
            },
        }));
    });
    await page.reload();
    await expect(page.getByText(GREETING)).toBeVisible();
    return page;
}

test('wrapped: retrospectiva abre com horas, persona e top de conteúdos', async () => {
    test.setTimeout(90000);
    const page = await bootWithStats();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Estatísticas' }).click();
    await page.getByRole('button', { name: /Retrospectiva/ }).click();

    // Slide 1: total hours from the seeded stats (7200s = 2h).
    await expect(page.locator('.wrapped-card')).toBeVisible();
    await expect(page.locator('.wrapped-big')).toHaveText('2h');

    // Slide 2: persona — movies dominate (75%) → cinephile.
    await page.locator('.wrapped-nav-btn').last().click();
    await expect(page.getByText('Cinéfilo de carteirinha')).toBeVisible();

    // Slide 3: all-time top content from contentTotals.
    await page.locator('.wrapped-nav-btn').last().click();
    await expect(page.getByText('Filme Campeão')).toBeVisible();
    await expect(page.getByText('Série Vice')).toBeVisible();

    // Slide 4: habits (longest streak) + closing the overlay.
    await page.locator('.wrapped-nav-btn').last().click();
    await expect(page.locator('.wrapped-big')).toHaveText('🔥 8');
    await page.getByRole('button', { name: 'Concluir' }).click();
    await expect(page.locator('.wrapped-card')).toHaveCount(0);
});
