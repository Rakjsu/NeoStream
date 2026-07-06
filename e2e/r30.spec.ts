import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 30 — the phone web remote: pairing PIN (#150), QR of the URL (#151)
 * and the second-screen guide page (#154). We enable it from Settings → Rede
 * and check the settings UI plus the page the server actually serves on the
 * LAN. The WS/PIN handshake logic itself is covered by unit tests.
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

async function boot(): Promise<Page> {
    launched = await launchApp({ serverUrl: server.url });
    const page = launched.page;
    await seedProfiles(page, { active: 'adult' });
    await expect(page.getByText(GREETING)).toBeVisible();
    return page;
}

test('controle web: ativar mostra URL, PIN e QR, e serve a página com PIN + Guia', async () => {
    const page = await boot();

    // Settings → Rede
    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Rede' }).click();

    // Enable the phone web remote (custom toggle: click the slider).
    await page.locator('.setting-item', { hasText: 'Controle pelo celular' })
        .locator('.toggle-slider').click();

    // The info box shows the URL, a 4-digit PIN and a QR (inline SVG).
    const box = page.locator('.certificate-warning').filter({ hasText: 'PIN de pareamento' });
    await expect(box).toBeVisible({ timeout: 10000 });

    const url = await box.locator('a[href^="http://"]').getAttribute('href');
    expect(url).toMatch(/^http:\/\/[\d.]+:\d+\/$/);

    const pin = (await box.locator('strong').first().innerText()).trim();
    expect(pin).toMatch(/^\d{4}$/);

    await expect(box.locator('svg')).toHaveCount(1); // the QR code

    // The server actually serves the self-contained control page on the LAN.
    const res = await page.request.get(url!);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('Neo<span>Stream</span>'); // brand
    expect(html).toContain('Digite o PIN');           // PIN gate (#150)
    expect(html).toContain('data-view="guide"');      // second-screen guide tab (#154)
});
