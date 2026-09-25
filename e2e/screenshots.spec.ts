import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * 📸🖼️ Telas principais do app: cada captura vira PNG do artefato
 * app-screenshots do CI E é comparada com a baseline versionada em
 * e2e/baselines (o snapshotPathTemplate do playwright.config.ts aponta pra lá;
 * o limiar também mora lá).
 *
 * Quem compara é o toHaveScreenshot do próprio Playwright — vem no
 * @playwright/test e roda em qualquer runner. Antes era um bash chamando o
 * `compare` do ImageMagick: o passo saía 1 em TODO run, nunca gerou um diff, e
 * o continue-on-error escondia isso (#D145).
 *
 * Sem espera fixa: o toHaveScreenshot aceita de primeira a tela que já bate
 * com a baseline e, se não bate, fotografa até a tela PARAR de mudar (duas
 * capturas seguidas iguais) antes de comparar. A antiga espera fixa de 2 s
 * só servia enquanto a captura não reprovava nada — logo depois do clique a TV
 * ao Vivo ainda difere ~3,5% da baseline, carregando.
 *
 * Mudança visual INTENCIONAL: o teste reprova e o relatório HTML (artefato
 * playwright-report) traz expected/actual/diff da tela. Troque o PNG de
 * e2e/baselines pelo `*-actual.png` desse run do CI (windows-latest,
 * 1024x720) — gravar na máquina local mistura fonte/emoji de outro Windows.
 */

/**
 * A captura só é comparável se sair do MESMO tamanho em qualquer máquina. A
 * janela nasce 1200x800 e o runner (tela 1024x768) a espreme para 1024x720 —
 * foi assim que as baselines saíram. Num PC com tela maior e escala de 125%
 * ela vinha 1503x1003 e reprovava por dimensão. Por isso: escala 1 forçada no
 * Chromium e a área de conteúdo cravada no tamanho das baselines.
 */
const LARGURA = 1024;
const ALTURA = 720;

const BASELINES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'baselines');

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

const TELAS: [string, string][] = [
    ['TV ao Vivo', '02-tv-ao-vivo.png'],
    ['Filmes', '03-filmes.png'],
    ['Séries', '04-series.png'],
    ['Configurações', '05-configuracoes.png'],
];

/**
 * Compara a tela com a baseline e guarda o PNG do artefato. `expect.soft`: uma
 * tela diferente não esconde as outras — o teste reprova no fim, com todas
 * listadas.
 */
async function capturarEComparar(page: Page, arquivo: string, comparadas: string[]): Promise<void> {
    await expect.soft(page, `${arquivo} x e2e/baselines/${arquivo}`).toHaveScreenshot(arquivo);
    await page.screenshot({ path: `screenshots/${arquivo}` });
    comparadas.push(arquivo);
}

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

test('as telas principais batem com as baselines de e2e/baselines', async () => {
    test.setTimeout(120000);
    launched = await launchApp({ serverUrl: server.url, electronArgs: ['--force-device-scale-factor=1'] });
    const page = launched.page;
    const janela = await launched.app.browserWindow(page);
    await janela.evaluate((w, [largura, altura]) => w.setContentSize(largura, altura), [LARGURA, ALTURA] as const);
    await expect
        .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight, window.devicePixelRatio]))
        .toEqual([LARGURA, ALTURA, 1]);
    await seedProfiles(page, { active: 'adult' });
    await page.getByText(/Bom dia|Boa tarde|Boa noite/).waitFor({ timeout: 45000 });

    const comparadas: string[] = [];
    await capturarEComparar(page, '01-inicio.png', comparadas);

    // Sem engolir erro: uma tela que não abre é regressão, não "indisponível".
    for (const [title, file] of TELAS) {
        await page.locator(`button.nav-item[title="${title}"]`).click({ timeout: 10000 });
        await capturarEComparar(page, file, comparadas);
    }

    // Toda baseline versionada foi comparada — nenhuma fica de enfeite na pasta.
    const versionadas = readdirSync(BASELINES).filter((f) => f.endsWith('.png')).sort();
    expect(comparadas.sort()).toEqual(versionadas);
});
