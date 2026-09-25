import { defineConfig } from '@playwright/test';

/**
 * E2E suite for the built Electron app.
 *
 * Prerequisite: `npx vite build` (dist/ + dist-electron/main.js must exist).
 * Use `npm run test:e2e:build` to build + run in one step.
 */
export default defineConfig({
    testDir: './e2e',
    // One Electron app at a time: the suite launches/closes real app instances
    workers: 1,
    fullyParallel: false,
    retries: 1,
    // `.only` esquecido num spec faz o Playwright rodar UM teste e sair zero: a
    // suíte some e o job fica verde. No CI isso é erro; na máquina de quem está
    // depurando, `.only` continua sendo a ferramenta certa.
    forbidOnly: !!process.env.CI,
    // First-load IPC (content fetch over the mock server) can take a moment
    timeout: 60_000,
    expect: {
        timeout: 15_000,
        // 🖼️ Regressão visual (e2e/screenshots.spec.ts, #D145): até 1% dos
        // pixels, com a tolerância por pixel padrão do Playwright (YIQ 0.2).
        // Medido em 25/09 contra as baselines de 19/07: a Home de outro dia
        // (data, saudação e relógio diferentes) fica em ~0,3%; as outras
        // telas abaixo de 0,15%.
        toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
    },
    // As baselines versionadas: `toHaveScreenshot('01-inicio.png')` compara com
    // e2e/baselines/01-inicio.png. Sem sufixo de plataforma de propósito — o
    // e2e só roda no windows-latest, que foi quem gravou esses PNGs.
    snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
    // No CI o html também é gerado: o ci.yml sobe playwright-report/ SEMPRE,
    // inclusive quando o job termina verde — que é justamente onde mora o teste
    // que só passou na repetição (retries: 1). Sem este reporter o passo de
    // upload não acha nada (foi o que deixou a investigação do remoteRecord sem
    // error-context/stdout).
    reporter: process.env.CI
        ? [['list'], ['github'], ['html', { open: 'never' }]]
        : [['list'], ['html', { open: 'never' }]],
});
