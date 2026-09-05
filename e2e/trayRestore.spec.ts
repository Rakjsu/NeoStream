import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * 🪟 Fechar pra bandeja e voltar — o percurso que deixava a janela cinza.
 *
 * O X zerava a opacidade do body como "animação de saída" e assumia que o
 * processo ia morrer; o main só escondia (trayMode → hide()), e o mesmo
 * webContents voltava da bandeja invisível. É o único teste que exercita o
 * attachCloseToTray de verdade: clica no X real, espera a janela ESCONDER
 * (poll, não sleep), reexibe pelo Electron e cobra a interface visível.
 */

const GREETING = /Bom dia|Boa tarde|Boa noite/;

let server: Awaited<ReturnType<typeof startMockServer>>;
let launched: LaunchedApp | null = null;

test.beforeAll(async () => { server = await startMockServer(); });
test.afterAll(async () => { await server.close(); });
test.afterEach(async () => { await launched?.close(); launched = null; });

async function launchWithTray(): Promise<Page> {
    launched = await launchApp({
        serverUrl: server.url,
        // Explícito, pra não depender do default do trayMode.
        extraStores: { 'system-config': { system: { closeToTray: true, openAtLogin: false } } },
    });
    await seedProfiles(launched.page);
    await expect(launched.page.getByText(GREETING)).toBeVisible();
    return launched.page;
}

function mainWindowVisible(): Promise<boolean> {
    return launched!.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.isVisible()));
}

test('fechar no X esconde na bandeja e a janela volta com a interface visível', async () => {
    const page = await launchWithTray();

    await page.locator('.window-control-btn.close').click();
    await expect.poll(mainWindowVisible, { timeout: 5_000 }).toBe(false);

    // Volta pelo mesmo caminho que a bandeja/second-instance usam: show().
    await launched!.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find(w => !w.isDestroyed())?.show();
    });
    await expect.poll(mainWindowVisible, { timeout: 5_000 }).toBe(true);

    // O bug: body ficava em opacity 0 / scale(0.9) para sempre.
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).opacity)).toBe('1');
    expect(await page.evaluate(() => getComputedStyle(document.body).transform)).toBe('none');
    await expect(page.getByText(GREETING)).toBeVisible();
});
