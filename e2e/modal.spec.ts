import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * ContentDetailModal flows (reworked in v3.17.6–v3.18.0): click a card →
 * centered modal with the trailer hero on top; series get the season tabs +
 * episode list BESIDE the hero, keyboard navigation and per-episode state.
 * TMDB is unreachable in E2E, so the hero falls back to the poster — the
 * structure is what these tests pin down.
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

test('filme: clique no card abre o modal com título e botão Assistir; Esc fecha', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Filmes"]').click();
    await expect(page.getByText('Cidade de Deus').first()).toBeVisible();

    await page.getByText('Cidade de Deus').first().click();

    // Modal: title (h2 — the card title is an h4) + primary play button
    await expect(page.locator('h2', { hasText: 'Cidade de Deus' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Assistir Filme/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('h2', { hasText: 'Cidade de Deus' })).toHaveCount(0);
});

test('série: modal lista temporadas e episódios ao lado do hero', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Séries"]').click();
    await expect(page.getByText('Cidade Invisível').first()).toBeVisible();

    await page.getByText('Cidade Invisível').first().click();

    // Episodes column: season tabs + cleaned episode titles from the fixture.
    // Exact match dodges the page's own detail panel, which shows the raw
    // "Episódio 1 - Encontro" string behind the modal.
    await expect(page.getByRole('button', { name: 'T1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'T2', exact: true })).toBeVisible();
    await expect(page.getByText('Encontro', { exact: true })).toBeVisible();
    await expect(page.getByText('Rastros', { exact: true })).toBeVisible();

    // Play button reflects the selected episode
    await expect(page.getByRole('button', { name: /Assistir T1 E1/ })).toBeVisible();

    // Season switch swaps the episode list
    await page.getByRole('button', { name: 'T2', exact: true }).click();
    await expect(page.getByText('Retorno', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Assistir T2 E1/ })).toBeVisible();
});

test('série: setas do teclado trocam o episódio selecionado', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Séries"]').click();
    await page.getByText('Cidade Invisível').first().click();
    await expect(page.getByRole('button', { name: /Assistir T1 E1/ })).toBeVisible();
    // Keyboard navigation needs the episode list loaded — wait for a row.
    await expect(page.getByText('Encontro', { exact: true })).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: /Assistir T1 E2/ })).toBeVisible();

    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('button', { name: /Assistir T1 E1/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Assistir T1 E1/ })).toHaveCount(0);
});
