import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Feature flows shipped in rounds 7-8, all deterministic against the mock
 * Xtream server (no real network/streams):
 *   - Themes (accent + AMOLED background) → CSS custom properties on <html>
 *   - Playlists settings (active playlist listing + add a second one)
 *   - EPG guide search + time paging (mock xmltv.php)
 *   - Home "Porque você assistiu" recommendation row (seeded movie history)
 *
 * Mock catalog: 7 live channels, 8 movies, 4 series. The first live category
 * "CANAIS | ABERTOS" holds Globo/SBT/Record/Band; xmltv.php serves a tiny
 * "now"-relative guide for globo-sp/sbt/record (see e2e/mock-server.cjs).
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

async function launchAuthed(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    return launched.page;
}

/** Read a CSS custom property off <html> (the theme service writes here). */
function cssVar(page: Page, name: string): Promise<string> {
    return page.evaluate(
        (varName) => getComputedStyle(document.documentElement).getPropertyValue(varName).trim(),
        name
    );
}

async function openSettings(page: Page): Promise<void> {
    await page.locator('button.nav-item[title="Configurações"]').click();
    await expect(page.locator('h1', { hasText: 'Configurações' })).toBeVisible();
}

// ---------------------------------------------------------------------------
// 1) Themes — Aparência: accent swatch + AMOLED background
// ---------------------------------------------------------------------------
test('aparência: trocar destaque para Azul e fundo para AMOLED altera as variáveis CSS', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Default theme: roxo accent.
    expect(await cssVar(page, '--ns-accent')).toBe('#a855f7');

    await openSettings(page);
    await page.locator('.settings-nav .nav-item', { hasText: 'Aparência' }).click();
    await expect(page.getByRole('heading', { name: 'Aparência' })).toBeVisible();

    // Click the "Azul" accent swatch → --ns-accent becomes the azul hex.
    await page.getByRole('button', { name: 'Azul' }).click();
    await expect.poll(() => cssVar(page, '--ns-accent')).toBe('#3b82f6');

    // Click the AMOLED background card → --ns-bg-deep becomes pure black.
    await page.getByRole('button', { name: /AMOLED/ }).click();
    await expect.poll(() => cssVar(page, '--ns-bg-deep')).toBe('#000000');
});

// ---------------------------------------------------------------------------
// 2) Playlists — list the seeded active playlist, then add a second one
// ---------------------------------------------------------------------------
test('playlists: lista a playlist ativa e adiciona uma segunda', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await openSettings(page);
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();

    // The seeded mock playlist (migrated from the legacy auth on startup) shows
    // as the active one.
    const activeItem = page.locator('.playlists-item.active');
    await expect(activeItem).toHaveCount(1);
    await expect(activeItem.locator('.playlists-badge')).toHaveText('Ativa');

    // Add a second playlist via the inline form. The mock authenticates the
    // same valid credentials, so we use a trailing-slash URL variant: the
    // XtreamClient strips it before the request (auth still succeeds), but the
    // stored URL string differs from the active playlist's, so the dedup
    // (url + username) treats it as a new entry instead of an update.
    await page.getByRole('button', { name: /Adicionar playlist/ }).click();
    await page.locator('.playlists-add-form input[placeholder="Nome da playlist (opcional)"]').fill('Playlist Dois');
    await page.locator('.playlists-add-form input[placeholder="http://example.com:8080"]').fill(`${server.url}/`);
    await page.locator('.playlists-add-form input[placeholder="Usuário"]').fill('e2euser');
    await page.locator('.playlists-add-form input[type="password"]').fill('e2epass');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();

    // Adding switches the active provider and reloads into the dashboard.
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 30_000 });

    // Back in Settings → Playlists, both playlists are now listed.
    await openSettings(page);
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await expect(page.locator('.playlists-item')).toHaveCount(2);
    // The new playlist's name renders in a .playlists-item-name (which may also
    // hold the "Ativa" badge, so match the name node, not an exact item string).
    await expect(
        page.locator('.playlists-item-name', { hasText: 'Playlist Dois' })
    ).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3) EPG guide — program search + time paging (mock xmltv.php)
// ---------------------------------------------------------------------------
test('guia de TV: busca encontra um programa e a paginação muda o primeiro tick', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Guia de TV"]').click();

    // Default category "CANAIS | ABERTOS" → globo-sp/sbt/record EPG loads from
    // xmltv.php. "Jornal Nacional" airs around "now" on Globo.
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();
    await expect.poll(async () => {
        const search = page.locator('input[aria-label="Buscar na programação carregada..."]');
        await search.fill('');
        await search.fill('Jornal Nacional');
        return page.locator('.guide-search-result', { hasText: 'Jornal Nacional' }).count();
    }, { timeout: 20_000 }).toBeGreaterThan(0);

    // Clear the search overlay before testing paging.
    await page.locator('input[aria-label="Buscar na programação carregada..."]').fill('');

    // Paging: ◀ "Mais cedo" shifts the visible window back 2h → first tick label changes.
    const firstTick = page.getByTestId('guide-tick-first');
    const before = (await firstTick.textContent())?.trim();
    await page.getByRole('button', { name: 'Mais cedo' }).click();
    await expect.poll(async () => (await firstTick.textContent())?.trim()).not.toBe(before);

    // ▶ "Mais tarde" shifts forward again → label changes back.
    const afterEarlier = (await firstTick.textContent())?.trim();
    await page.getByRole('button', { name: 'Mais tarde' }).click();
    await expect.poll(async () => (await firstTick.textContent())?.trim()).not.toBe(afterEarlier);
});

// ---------------------------------------------------------------------------
// 4) Recommendations — "Porque você assistiu X" on Home from seeded history
// ---------------------------------------------------------------------------
test('home: histórico semeado gera a fileira "Porque você assistiu"', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Seed movie history for the active profile (movieProgressService shape).
    // "Bacurau" (stream_id 204) is in VOD category "10" alongside three other
    // movies, so category-match scoring yields a >=3-item recommendation group.
    await page.evaluate(() => {
        const entry = {
            movieId: '204',
            movieName: 'Bacurau',
            profileId: 'e2e-adult',
            currentTime: 600,
            duration: 6000,
            progress: 10,
            watchedAt: Date.now(),
            completed: false
        };
        localStorage.setItem('movie_watch_progress', JSON.stringify([entry]));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Recommendations build from local history (no network needed — genre
    // lookups fail gracefully against the mock; category match is enough).
    // The row is titled "💡 Porque você assistiu Bacurau".
    await expect(page.getByRole('heading', { name: /Porque você assistiu Bacurau/ }))
        .toBeVisible({ timeout: 20_000 });
});
