import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * ✏️ Editar uma playlist depois de cadastrada (Configurações → Playlists).
 *
 * O que está em jogo: a edição é POR ID. Favoritos e progresso são guardados
 * por id de playlist, então corrigir a URL não pode virar "outra" playlist —
 * o id de antes tem que ser o id de depois. E, quando a editada é a ativa e a
 * credencial mudou, o app recarrega e o catálogo vem do provedor novo.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

interface PlaylistRow { id: string; name: string; url: string; username: string; active: boolean; type: string }

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => { server = await startMockServer(); });
test.afterAll(async () => { await server.close(); });
test.afterEach(async () => { await launched?.close(); launched = null; });

async function boot(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();
    return page;
}

async function abrirPlaylists(page: Page): Promise<void> {
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Playlists' }).click();
    await expect(page.locator('.playlists-item').first()).toBeVisible({ timeout: 10000 });
}

/** Mesmo fluxo dos specs de M3U: a lista do mock vira a playlist ATIVA. */
async function adicionarM3u(page: Page): Promise<void> {
    await abrirPlaylists(page);
    await page.getByRole('button', { name: /\+ / }).click();
    await page.getByRole('button', { name: 'M3U', exact: true }).click();
    await page.locator('.playlists-add-form input[type="text"]').first().fill('Lista Original');
    await page.locator('.playlists-add-form input').nth(1).fill(`${server.url}/lista.m3u`);
    await page.locator('.playlists-add-form button[type="submit"]').click();
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 45000 });
}

function listar(page: Page): Promise<PlaylistRow[]> {
    return page.evaluate(async () => {
        const r = await window.ipcRenderer.invoke('playlists:list') as { playlists: PlaylistRow[] };
        return r.playlists;
    });
}

test('editar a URL da playlist ATIVA mantém o id, recarrega e refaz o catálogo', async () => {
    test.setTimeout(120000);
    const page = await boot();
    await adicionarM3u(page);

    await abrirPlaylists(page);
    const antes = await listar(page);
    const m3uAntes = antes.find(p => p.type === 'm3u');
    expect(m3uAntes?.active).toBe(true);

    await page.locator('.playlists-item.active').getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByText('Editar playlist')).toBeVisible();
    // Em edição o tipo é da entrada: sem chips de tipo, sem "Abrir arquivo…".
    await expect(page.getByRole('button', { name: 'Stalker/MAC' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Abrir arquivo/ })).toHaveCount(0);
    // Pré-preenchido com o que está salvo.
    await expect(page.locator('.playlists-add-form input').nth(1)).toHaveValue(`${server.url}/lista.m3u`);

    await page.locator('.playlists-add-form input[type="text"]').first().fill('Lista Editada');
    // Mesmo pathname no mock (continua válida), string diferente (identidade nova).
    await page.locator('.playlists-add-form input').nth(1).fill(`${server.url}/lista.m3u?v=2`);
    await page.getByRole('button', { name: 'Salvar' }).click();

    // Era a ativa e a credencial mudou → o app recarrega no dashboard.
    await expect(page.getByText(GREETING)).toBeVisible({ timeout: 45000 });

    await abrirPlaylists(page);
    await expect(page.locator('.playlists-item')).toHaveCount(2);
    await expect(page.locator('.playlists-item.active .playlists-item-name')).toContainText('Lista Editada');

    const depois = await listar(page);
    const m3uDepois = depois.find(p => p.type === 'm3u');
    expect(m3uDepois?.id).toBe(m3uAntes?.id);
    expect(m3uDepois?.url).toBe(`${server.url}/lista.m3u?v=2`);
    expect(m3uDepois?.active).toBe(true);

    // O catálogo veio do provedor "novo" (cache por id invalidado no main).
    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Canal M3U Um').first()).toBeVisible({ timeout: 20000 });
});

test('URL que o provedor recusa não grava nada e deixa o formulário aberto', async () => {
    test.setTimeout(120000);
    const page = await boot();
    await adicionarM3u(page);

    await abrirPlaylists(page);
    const antes = await listar(page);

    await page.locator('.playlists-item.active').getByRole('button', { name: 'Editar' }).click();
    await page.locator('.playlists-add-form input').nth(1).fill(`${server.url}/nao-existe.m3u`);
    await page.getByRole('button', { name: 'Salvar' }).click();

    await expect(page.locator('.playlists-error')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.playlists-add-form')).toBeVisible();
    expect(await listar(page)).toEqual(antes);
});

test('playlist Xtream NÃO ativa: senha errada é recusada; senha certa + nome novo salva sem recarregar', async () => {
    test.setTimeout(120000);
    const page = await boot();
    await adicionarM3u(page);

    await abrirPlaylists(page);
    const xtream = (await listar(page)).find(p => p.type === 'xtream');
    expect(xtream?.active).toBe(false);

    await page.locator('.playlists-item:not(.active)').getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByText('Editar playlist')).toBeVisible();
    // A senha nunca chega ao renderer: o campo abre vazio e não é obrigatório.
    const senha = page.locator('.playlists-add-form input[type="password"]');
    await expect(senha).toHaveValue('');
    await expect(senha).toHaveAttribute('placeholder', 'Deixe em branco para manter a senha atual');

    await senha.fill('senha-errada');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.locator('.playlists-error')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.playlists-add-form')).toBeVisible();

    await senha.fill('');
    await page.locator('.playlists-add-form input[type="text"]').first().fill('Conta Xtream');
    await page.getByRole('button', { name: 'Salvar' }).click();

    // Não era a ativa → sem reload: o formulário fecha e a lista se atualiza.
    await expect(page.locator('.playlists-add-form')).toHaveCount(0);
    await expect(page.locator('.playlists-item')).toHaveCount(2);
    await expect(page.locator('.playlists-item:not(.active) .playlists-item-name')).toContainText('Conta Xtream');
    const depois = (await listar(page)).find(p => p.type === 'xtream');
    expect(depois?.id).toBe(xtream?.id);
    expect(depois?.active).toBe(false);
});
