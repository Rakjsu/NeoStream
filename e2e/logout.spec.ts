import { test, expect } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * 🚪 Sair da conta solta a sessão — não apaga o usuário.
 *
 * O botão chamava `localStorage.clear()`: levava perfis, favoritos, progresso,
 * atalhos e aparência de TODOS os perfis e de TODAS as listas, sem confirmação
 * e sem volta. Este teste existe porque o dano era invisível na hora — a
 * pessoa só descobria ao voltar.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => { server = await startMockServer(); });
test.afterAll(async () => { await server.close(); });
test.afterEach(async () => { await launched?.close(); launched = null; });

test('sair da conta pede confirmação e preserva perfis, progresso e atalhos', async () => {
    test.setTimeout(90000);
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();

    // Dados que a pessoa não pode perder ao trocar de conta.
    await page.evaluate(() => {
        localStorage.setItem('neostream_keymap_v1', '{"play":"k"}');
        localStorage.setItem('neostream_theme', '{"accent":"roxo"}');
        localStorage.setItem('neostream_profile_e2e-adult__pl_qualquer', '{"favorites":[{"id":"1"}]}');
        localStorage.setItem('neostream_active_playlist_id', 'pl_qualquer');
    });

    // Primeiro clique só ARMA: continua no dashboard.
    await page.locator('.logout-btn').click();
    await expect(page.locator('.logout-btn.armado')).toBeVisible();
    await expect(page.getByText(GREETING)).toBeVisible();

    // Segundo clique sai de verdade.
    await page.locator('.logout-btn').click();
    await expect(page.getByText('Bem-vindo ao NeoStream')).toBeVisible({ timeout: 20000 });

    const depois = await page.evaluate(() => ({
        perfis: localStorage.getItem('neostream_profiles'),
        atalhos: localStorage.getItem('neostream_keymap_v1'),
        tema: localStorage.getItem('neostream_theme'),
        progresso: localStorage.getItem('neostream_profile_e2e-adult__pl_qualquer'),
        listaAtiva: localStorage.getItem('neostream_active_playlist_id'),
    }));

    expect(depois.perfis).toContain('e2e-adult');
    expect(depois.atalhos).toBe('{"play":"k"}');
    expect(depois.tema).toBe('{"accent":"roxo"}');
    expect(depois.progresso).toContain('favorites');
    // A sessão, essa sim, foi embora.
    expect(depois.listaAtiva).toBeNull();
});
