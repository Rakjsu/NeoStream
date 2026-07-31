import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The repo is "type": "module"; the dependency-free mock server stays CJS so
// it can also be run standalone (node e2e/mock-server.cjs for manual poking).
const require = createRequire(import.meta.url);
const { startMockServer, USERNAME, PASSWORD } = require('./mock-server.cjs') as {
    startMockServer: () => Promise<{ url: string; port: number; close: () => Promise<void> }>;
    USERNAME: string;
    PASSWORD: string;
};

export { startMockServer, USERNAME, PASSWORD };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LaunchedApp {
    app: ElectronApplication;
    page: Page;
    userDataDir: string;
    close: () => Promise<void>;
}

const ROOT = path.resolve(__dirname, '..');
const MAIN_JS = path.join(ROOT, 'dist-electron', 'main.js');

/** Espera `ms` sem segurar o worker vivo (timer unref'd). */
function delay(ms: number): Promise<false> {
    return new Promise<false>((resolve) => setTimeout(resolve, ms, false).unref());
}

/**
 * Mata os ffmpeg de DVR que o app registrou em dvr-pids.txt (dvrHandlers.ts
 * escreve quando NEOSTREAM_E2E_USER_DATA está setado). Escopado aos PIDs que
 * ESTE app iniciou — nunca um taskkill global em ffmpeg.exe, que pegaria
 * processos alheios do runner.
 */
function killTrackedFfmpeg(userDataDir: string): void {
    let raw: string;
    try {
        raw = readFileSync(path.join(userDataDir, 'dvr-pids.txt'), 'utf-8');
    } catch {
        return; // o teste não gravou nada
    }
    for (const line of raw.split(/\r?\n/)) {
        const pid = Number(line.trim());
        if (!Number.isInteger(pid) || pid <= 0) continue;
        try { process.kill(pid, 'SIGKILL'); } catch { /* já morreu */ }
    }
}

/**
 * Launches the BUILT app (dist/ + dist-electron/main.js) with an isolated,
 * throwaway userData dir (electron/e2eUserData.ts hook).
 *
 * When `serverUrl` is given, electron-store's config.json is pre-seeded with
 * credentials for the mock Xtream server, so the app boots authenticated
 * (lands on the profile selector).
 */
export async function launchApp(options: {
    serverUrl?: string;
    /** Extra electron-store files to pre-seed: store name (sans .json) → contents. */
    extraStores?: Record<string, object>;
} = {}): Promise<LaunchedApp> {
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'neostream-e2e-'));

    for (const [name, contents] of Object.entries(options.extraStores ?? {})) {
        writeFileSync(path.join(userDataDir, `${name}.json`), JSON.stringify(contents), 'utf-8');
    }

    if (options.serverUrl) {
        const config = {
            auth: {
                url: options.serverUrl,
                username: USERNAME,
                password: PASSWORD,
                userInfo: { username: USERNAME, auth: 1, status: 'Active' },
            },
        };
        writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify(config), 'utf-8');
    }

    const app = await electron.launch({
        args: [MAIN_JS],
        cwd: ROOT,
        env: {
            ...(process.env as Record<string, string>),
            NEOSTREAM_E2E_USER_DATA: userDataDir,
        },
    });

    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    return {
        app,
        page,
        userDataDir,
        close: async () => {
            // Teardown com teto de tempo: um ffmpeg de DVR órfão no Windows
            // herda os pipes do Electron e o app.close() nunca resolve — foi
            // isso que estourava o worker teardown do remoteRecord no CI. Se
            // o close não terminar em 15s, mata os ffmpeg registrados e a
            // árvore inteira do Electron (taskkill /T precisa do PID raiz
            // ainda vivo, por isso roda antes de desistir de esperar).
            const electronProc = app.process();
            const closed = app.close().then(() => true, () => true);
            if (!await Promise.race([closed, delay(15_000)])) {
                killTrackedFfmpeg(userDataDir);
                if (electronProc.pid) {
                    if (process.platform === 'win32') {
                        spawnSync('taskkill', ['/PID', String(electronProc.pid), '/T', '/F'], { windowsHide: true });
                    } else {
                        try { electronProc.kill('SIGKILL'); } catch { /* já saiu */ }
                    }
                }
                await Promise.race([closed, delay(10_000)]);
            }
            // Best effort: Electron may still hold locks on Windows for a moment
            try {
                rmSync(userDataDir, { recursive: true, force: true });
            } catch {
                /* leftover temp dirs are fine */
            }
        },
    };
}

interface SeedProfileOptions {
    /** Which profile becomes active: 'adult' (default), 'kids', or null (selector shown) */
    active?: 'adult' | 'kids' | null;
}

/**
 * Seeds the app's localStorage with one adult + one kids profile and reloads,
 * so the renderer boots straight into the Dashboard (or the profile selector
 * when `active: null`). Mirrors src/services/profileService.ts storage shape.
 */
export async function seedProfiles(page: Page, options: SeedProfileOptions = {}): Promise<void> {
    const active = options.active === undefined ? 'adult' : options.active;
    await page.evaluate((activeKind) => {
        const now = new Date().toISOString();
        const data = {
            profiles: [
                {
                    id: 'e2e-adult', name: 'Tester', avatar: '👤', isKids: false,
                    watchLater: [], continueWatching: [], createdAt: now, lastUsed: now,
                },
                {
                    id: 'e2e-kids', name: 'Kids', avatar: '👶', isKids: true,
                    watchLater: [], continueWatching: [], createdAt: now, lastUsed: now,
                },
            ],
            activeProfileId:
                activeKind === 'adult' ? 'e2e-adult' : activeKind === 'kids' ? 'e2e-kids' : null,
        };
        localStorage.setItem('neostream_profiles', JSON.stringify(data));
    }, active);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
}
