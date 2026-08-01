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
    // First-load IPC (content fetch over the mock server) can take a moment
    timeout: 60_000,
    expect: { timeout: 15_000 },
    // No CI o html também é gerado: o ci.yml sobe playwright-report/ quando o
    // job falha — sem este reporter o passo de upload nunca achava nada (foi o
    // que deixou a investigação do remoteRecord sem error-context/stdout).
    reporter: process.env.CI
        ? [['list'], ['github'], ['html', { open: 'never' }]]
        : [['list'], ['html', { open: 'never' }]],
});
