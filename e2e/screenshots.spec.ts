import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * 📸 Screenshots automáticos do app (viram artefato do CI): navega pelas
 * telas principais com o provedor mock e salva um PNG de cada uma. Cada tela
 * é best-effort — uma tela indisponível não derruba as outras.
 */

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => {
    server = await startMockServer();
    mkdirSync('screenshots', { recursive: true });
});

test.afterAll(async () => {
    await server.close();
});

test.afterEach(async () => {
    await launched?.close();
    launched = null;
});

test('captura as telas principais pro artefato do CI', async () => {
    test.setTimeout(120000);
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await page.getByText(/Bom dia|Boa tarde|Boa noite/).waitFor({ timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/01-inicio.png' });

    const screens: [string, string][] = [
        ['TV ao Vivo', '02-tv-ao-vivo.png'],
        ['Filmes', '03-filmes.png'],
        ['Séries', '04-series.png'],
        ['Configurações', '05-configuracoes.png'],
    ];
    for (const [title, file] of screens) {
        try {
            await page.locator(`button.nav-item[title="${title}"]`).click({ timeout: 10000 });
            await page.waitForTimeout(2000);
            await page.screenshot({ path: `screenshots/${file}` });
        } catch { /* tela indisponível nesse build — segue pras outras */ }
    }
});
