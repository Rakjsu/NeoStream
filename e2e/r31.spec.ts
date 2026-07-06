import { test, expect, type Page } from '@playwright/test';
import net from 'node:net';
import { launchApp, seedProfiles, startMockServer, type LaunchedApp } from './helpers';

/**
 * Round 31 — the phone remote's PIN lockout (#155). We enable the web remote,
 * read the PIN from the settings screen, then drive the real WebSocket
 * handshake at the raw-HTTP level: the right PIN upgrades (101), a wrong PIN is
 * refused (401), and after enough wrong tries the client is rate-limited (429).
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

/** Raw WS handshake against 127.0.0.1:port; resolves with the HTTP status line. */
function handshakeStatus(port: number, pin: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
            socket.write(
                `GET /?pin=${pin} HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${port}\r\n` +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
                'Sec-WebSocket-Version: 13\r\n\r\n',
            );
        });
        let buf = '';
        const done = (v: string) => { socket.destroy(); resolve(v); };
        socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('handshake timeout')); });
        socket.on('data', (chunk) => {
            buf += chunk.toString('utf-8');
            const nl = buf.indexOf('\r\n');
            if (nl !== -1) done(buf.slice(0, nl));
        });
        socket.on('error', reject);
    });
}

test('controle web: PIN certo faz upgrade (101), errado é 401 e trava em 429', async () => {
    const page = await boot();

    await page.locator('button.nav-item[title="Configurações"]').click();
    await page.locator('.settings-nav .nav-item', { hasText: 'Rede' }).click();
    await page.locator('.setting-item', { hasText: 'Controle pelo celular' })
        .locator('.toggle-slider').click();

    const box = page.locator('.certificate-warning').filter({ hasText: 'PIN de pareamento' });
    await expect(box).toBeVisible({ timeout: 10000 });

    const url = await box.locator('a[href^="http://"]').getAttribute('href');
    const port = Number(new URL(url!).port);
    const pin = (await box.locator('strong').first().innerText()).trim();
    expect(pin).toMatch(/^\d{4}$/);

    // Right PIN upgrades the connection (and clears any failures for this IP).
    expect(await handshakeStatus(port, pin)).toContain('101');

    // A wrong PIN is refused; the first 5 misses each return 401.
    const wrong = pin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) {
        expect(await handshakeStatus(port, wrong)).toContain('401');
    }
    // The 6th miss is rate-limited (anti brute-force cooldown).
    expect(await handshakeStatus(port, wrong)).toContain('429');
});
