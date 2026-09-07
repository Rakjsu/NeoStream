import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Guarda da CSP do renderer (plugin `neostream:renderer-csp`, vite.config.ts).
 *
 * É o único portão que enxerga a política: ela é injetada apenas no build
 * (`apply: 'build'`), então `npm run dev`, `tsc -b` e o vitest não veem nada.
 * Este spec roda contra o app empacotado, por file://, que é onde ela existe.
 *
 * O que ele NÃO cobre — dito aqui pra ninguém confiar numa rede que não
 * existe:
 * - `frame-src`: o trailer do YouTube depende do TMDB; o CI injeta uma chave
 *   fictícia e o mock não tem rota de trailer, então o <iframe> nunca monta.
 * - `connect-src ws:`: o controle remoto entre PCs precisa de um segundo PC.
 * - `media-src file:`: reprodução de gravação local de verdade.
 * - `worker-src blob:`: o mock devolve 404 no manifesto HLS, então o hls.js
 *   para antes de montar o worker de demuxagem. Conferido na marra — tirar o
 *   `blob:` da política NÃO derruba este spec (tirar o `'unsafe-inline'` do
 *   `style-src`, sim). O worker só aparece com stream de verdade.
 * - Multi-view e PiP, que carregam o MESMO index.html em outra janela.
 * Essas cinco seguem sob teste manual.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;
/** Como o Chromium anuncia um recurso barrado por diretiva. */
const VIOLACAO = /Content Security Policy|Refused to (load|execute|connect|apply|create|run)/i;

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

test('a política existe no build e nenhuma tela esbarra nela', async () => {
    launched = await launchApp({ serverUrl: server.url });
    const page: Page = launched.page;

    // O ouvinte entra ANTES do seedProfiles, que recarrega a página: assim o
    // boot inteiro (inclusive o carregamento do bundle) acontece sob vigia.
    const mensagens: string[] = [];
    page.on('console', msg => mensagens.push(msg.text()));
    await seedProfiles(page, { active: 'adult' });

    // Se `script-src` tivesse barrado o bundle, a tela ficaria em branco e
    // esta espera falharia — é a asserção mais importante do arquivo.
    await expect(page.getByText(GREETING)).toBeVisible();

    // Falso verde nº 1: a política sumir do artefato. O spec passaria feliz.
    const politica = await page.locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content');
    expect(politica).toContain("script-src 'self'");
    expect(politica).toContain('worker-src');
    expect(politica).toContain("object-src 'none'");

    // Capas do provedor (img-src http:) e o placeholder em data:.
    await expect(page.locator('img').first()).toBeVisible();

    // TV ao Vivo com canal selecionado: monta a prévia, que instancia o
    // hls.js vindo do bundle — era este o caminho que baixava `hls.js@latest`
    // de um CDN e que, sozinho, obrigava a abrir `script-src`.
    await page.locator('button.nav-item[title="TV ao Vivo"]').click();
    await expect(page.getByText('Globo São Paulo HD').first()).toBeVisible();
    await page.getByText('Globo São Paulo HD').first().click();
    await expect(page.locator('#preview-video')).toBeVisible();
    await page.waitForTimeout(1500); // tempo de a prévia reclamar, se for reclamar

    // Filmes e Baixados: mais capas, miniaturas e a folha de estilo inline de
    // outros 20 componentes (style-src 'unsafe-inline').
    await page.locator('button.nav-item[title="Filmes"]').click();
    await expect(page.locator('img').first()).toBeVisible();
    await page.locator('button.nav-item[title="Baixados"]').click();
    await page.waitForTimeout(500);

    // Asserção sobre a LISTA, não sobre o tamanho dela: quando falha, o relato
    // já diz qual diretiva quebrou — a diferença entre consertar em um minuto
    // e reabrir a investigação.
    expect(mensagens.filter(texto => VIOLACAO.test(texto))).toEqual([]);
});
