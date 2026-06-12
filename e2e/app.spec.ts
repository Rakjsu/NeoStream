import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Main app flows against the mock Xtream server, with credentials pre-seeded
 * in electron-store (the app boots authenticated).
 *
 * Mock catalog: 7 live channels (1 in "CANAIS | ADULTOS", 2 in
 * "CANAIS | INFANTIS"), 8 movies (1 adult: "Desejos Proibidos XXX"),
 * 4 series.
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

async function openSearch(page: Page): Promise<void> {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.gsearch-input')).toBeVisible();
}

test('autenticado sem perfil ativo: seletor de perfis + criação de perfil', async () => {
    const page = await launchAuthed();

    // First run creates a default Kids profile (profileService.initialize)
    await expect(page.getByText('Quem está assistindo?')).toBeVisible();
    await expect(page.getByText('Kids', { exact: true })).toBeVisible();

    // Create a regular profile through the modal
    await page.getByText('Adicionar Perfil').click();
    await page.locator('input[placeholder="Digite o nome"]').fill('Maria');
    await page.getByRole('button', { name: 'Criar Perfil' }).click();
    await expect(page.getByText('Maria', { exact: true })).toBeVisible();

    // Selecting it lands on Home
    await page.getByText('Maria', { exact: true }).click();
    await expect(page.getByText(GREETING)).toBeVisible();
});

test('Home: saudação e contadores refletem o catálogo mock', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });

    await expect(page.getByText(GREETING)).toBeVisible();

    // Stat cards (anchors to the section pages) show the mock counts
    await expect(page.locator('a[href="#/dashboard/live"]').getByText('7', { exact: true })).toBeVisible();
    await expect(page.locator('a[href="#/dashboard/vod"]').getByText('8', { exact: true })).toBeVisible();
    await expect(page.locator('a[href="#/dashboard/series"]').getByText('4', { exact: true })).toBeVisible();
});

test('navegação: TV ao Vivo, Filmes e Séries renderizam os itens do mock', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();
    await expect(page.getByText('Record TV HD').first()).toBeVisible();

    await page.locator('button.nav-item[title="Filmes"]').click();
    await expect(page.getByText('Cidade de Deus').first()).toBeVisible();
    await expect(page.getByText('O Auto da Compadecida').first()).toBeVisible();

    await page.locator('button.nav-item[title="Séries"]').click();
    await expect(page.getByText('Cidade Invisível').first()).toBeVisible();
    await expect(page.getByText('Coisa Mais Linda').first()).toBeVisible();
});

test('busca global (Ctrl+K) encontra um filme e navega filtrado', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await openSearch(page);
    await page.locator('.gsearch-input').fill('Bacurau');
    await expect(page.locator('.gsearch-item', { hasText: 'Bacurau' })).toBeVisible();

    await page.keyboard.press('Enter');

    // Lands on VOD with the term applied — only the match is in the grid
    await expect(page.getByText('Bacurau').first()).toBeVisible();
    await expect(page.getByText('Tropa de Elite')).toHaveCount(0);
    expect(await page.evaluate(() => window.location.hash)).toContain('/dashboard/vod');
});

test('busca global: perfil adulto vê conteúdo adulto (contraste do gating)', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await openSearch(page);
    await page.locator('.gsearch-input').fill('Desejos');
    await expect(page.locator('.gsearch-item', { hasText: 'Desejos Proibidos XXX' })).toBeVisible();
});

test('perfil Kids: busca não mostra categoria/filme adulto', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'kids' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await openSearch(page);

    // Allowed kids channel is searchable...
    await page.locator('.gsearch-input').fill('Cartoon');
    await expect(page.locator('.gsearch-item', { hasText: 'Cartoon Kids Brasil' })).toBeVisible();

    // ...the adult movie is not (category "FILMES | ADULTOS" + name backstop)
    await page.locator('.gsearch-input').fill('Desejos');
    await expect(page.getByText('Nenhum resultado encontrado')).toBeVisible();
    await expect(page.locator('.gsearch-item')).toHaveCount(0);

    // ...and neither is the adult live channel ("CANAIS | ADULTOS")
    await page.locator('.gsearch-input').fill('Privê');
    await expect(page.getByText('Nenhum resultado encontrado')).toBeVisible();
});

test('página de histórico renderiza o estado vazio', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Histórico"]').click();
    await expect(page.getByText('Nenhum histórico ainda')).toBeVisible();
    await expect(page.getByText('Explorar Filmes')).toBeVisible();
});

test('guia de TV: seletor de categoria e linhas de canais', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Guia de TV"]').click();

    const select = page.locator('select');
    await expect(select).toBeVisible();
    await expect(select.locator('option', { hasText: 'CANAIS | ABERTOS' })).toHaveCount(1);

    // Channel rows from the mock render (EPG itself may be "Sem programação")
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();
    await expect(page.getByText('SBT HD').first()).toBeVisible();
});

test('configurações: página renderiza título e seções', async () => {
    const page = await launchAuthed();
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await expect(page.locator('h1', { hasText: 'Configurações' })).toBeVisible();
});
