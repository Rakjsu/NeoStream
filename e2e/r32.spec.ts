import { test, expect, type Page } from '@playwright/test';
import https from 'node:https';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 32 — the web remote's opt-in HTTPS mode (#166). Enabling it makes the
 * server serve the control page over https with the hand-rolled self-signed
 * cert; we fetch it over a real TLS connection (accepting the self-signed cert,
 * as the phone does) and confirm the page comes back.
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

/** GET over HTTPS accepting the self-signed cert; resolves {status, body, cert}. */
function httpsGet(url: string): Promise<{ status: number; body: string; peerCN: string }> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { rejectUnauthorized: false }, (res) => {
            const cert = (res.socket as import('node:tls').TLSSocket).getPeerCertificate();
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                body: data,
                peerCN: cert.subject?.CN ?? '',
            }));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
    });
}

test('controle web: modo HTTPS serve a página sobre TLS self-signed', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Rede' }).click();

    // Turn the remote on (http first), then flip HTTPS.
    await page.locator('.setting-item', { hasText: 'Controle pelo celular' })
        .locator('.toggle-slider').click();
    const box = page.locator('.certificate-warning').filter({ hasText: 'PIN de pareamento' });
    await expect(box).toBeVisible({ timeout: 10000 });

    await box.locator('label', { hasText: 'Conexão criptografada' }).locator('input[type="checkbox"]').check();

    // The URL becomes https:// once the server restarts in secure mode.
    const link = box.locator('a[href^="https://"]');
    await expect(link).toBeVisible({ timeout: 10000 });
    const url = await link.getAttribute('href');
    expect(url).toMatch(/^https:\/\/[\d.]+:\d+\/$/);

    // Fetch the served page over a real TLS connection (self-signed accepted).
    const res = await httpsGet(url!);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Neo<span>Stream</span>');
    expect(res.body).toContain('Digite o PIN');
    expect(res.peerCN).toBeTruthy(); // the hand-rolled cert has a subject CN
});
