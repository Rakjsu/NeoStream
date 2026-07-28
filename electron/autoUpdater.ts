import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import store from './store';
import log from './logger';
import { checkUpdateArtifacts, checkUpdateFeedConfig, type PolicyVerdict } from './updatePolicy';

interface UpdateConfig {
    checkFrequency: 'on-open' | '1-day' | '1-week' | '1-month';
    autoInstall: boolean;
    lastCheck: number;
    skippedVersion?: string;
}

const DEFAULT_CONFIG: UpdateConfig = {
    checkFrequency: 'on-open',
    autoInstall: false,
    lastCheck: 0
};

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/** Release oficial — qualquer outro destino de feed é recusado. */
const EXPECTED_FEED = { owner: 'Rakjsu', repo: 'NeoStream' };

/** `app-update.yml` empacotado ao lado do app: é ele que define o feed. */
function readPackagedFeedConfig(): string | null {
    try {
        return fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf-8');
    } catch {
        return null;
    }
}

export function initializeAutoUpdater(mainWindow: BrowserWindow) {
    // Get or initialize config
    const getConfig = (): UpdateConfig => {
        const stored = store.get('updateConfig');
        return stored ? { ...DEFAULT_CONFIG, ...stored } : DEFAULT_CONFIG;
    };

    // Save config
    const saveConfig = (config: Partial<UpdateConfig>) => {
        const current = getConfig();
        store.set('updateConfig', { ...current, ...config });
    };

    // Update last check timestamp
    const updateLastCheck = () => {
        saveConfig({ lastCheck: Date.now() });
    };

    // Check if should check for updates based on frequency
    const shouldCheckForUpdates = (): boolean => {
        const config = getConfig();
        const now = Date.now();
        const lastCheck = config.lastCheck || 0;

        const intervals = {
            'on-open': 0, // Always check on app open
            '1-day': 24 * 60 * 60 * 1000,
            '1-week': 7 * 24 * 60 * 60 * 1000,
            '1-month': 30 * 24 * 60 * 60 * 1000
        };

        const interval = intervals[config.checkFrequency];
        return (now - lastCheck) >= interval;
    };

    // Configure autoUpdater
    autoUpdater.autoDownload = false; // Manual download control
    autoUpdater.autoInstallOnAppQuit = true;
    // `forceDevUpdateConfig` NÃO desliga verificação de assinatura (isso é
    // `verifyUpdateCodeSignature`, no package.json): ele só fazia o updater
    // rodar fora do pacote, buscando um `dev-app-update.yml` qualquer da pasta
    // do projeto. No app empacotado era inócuo; em dev, transformava um arquivo
    // solto no repo num feed de atualização. Removido.
    autoUpdater.allowDowngrade = false;   // um latest.yml antigo não empurra versão vulnerável
    autoUpdater.disableWebInstaller = true; // web installer não passa por verificação de assinatura
    // (allowPrerelease fica como o electron-updater deduziu da versão atual —
    // mexer nele quebraria um eventual canal beta e não protege de nada.)

    // Sem certificado de código não há como verificar a assinatura do
    // instalador (ver updatePolicy.ts). O que sobra — e é o que aplicamos aqui
    // — é: (a) o feed tem que ser o do GitHub oficial por https e (b) todo
    // artefato tem que trazer sha512, senão o download não é conferido contra
    // nada e o .exe roda com elevação.
    const feedVerdict: PolicyVerdict = app.isPackaged
        ? checkUpdateFeedConfig(readPackagedFeedConfig(), EXPECTED_FEED)
        // Fora do pacote o electron-updater já fica inativo por conta própria.
        : { ok: true };
    if (!feedVerdict.ok) {
        log.error('[update] feed de atualização não confiável:', feedVerdict.reason);
    }

    // Vira true quando o feed da versão anunciada passou na checagem de sha512.
    let artifactsTrusted = false;
    // Vira true só quando um download verificado terminou NESTE processo.
    let downloadedThisSession = false;

    const guardedCheck = async () => {
        if (!feedVerdict.ok) {
            log.error('[update] checagem cancelada:', feedVerdict.reason);
            return null;
        }
        return autoUpdater.checkForUpdates();
    };

    // Setup event handlers
    autoUpdater.on('checking-for-update', () => {
        log.info('Checking for updates...');
        mainWindow.webContents.send('update:checking');
    });

    autoUpdater.on('update-available', (info) => {
        log.info('Update available:', info.version);

        const artifacts = checkUpdateArtifacts(info);
        artifactsTrusted = artifacts.ok;
        if (!artifacts.ok) {
            log.error('[update] atualização recusada:', artifacts.reason);
            mainWindow.webContents.send('update:error', {
                message: `Atualização recusada por falta de verificação de integridade (${artifacts.reason}).`
            });
            return;
        }

        const config = getConfig();

        // Skip if user marked this version to skip
        if (config.skippedVersion === info.version) {
            log.info('Skipping version:', info.version);
            return;
        }

        mainWindow.webContents.send('update:available', info);

        // Auto-download if configured
        if (config.autoInstall) {
            log.info('Auto-downloading update...');
            autoUpdater.downloadUpdate();
        }
    });

    autoUpdater.on('update-not-available', () => {
        log.info('No updates available');
        mainWindow.webContents.send('update:not-available');
        updateLastCheck();
    });

    autoUpdater.on('download-progress', (progress) => {
        log.info(`Download progress: ${progress.percent}%`);
        mainWindow.webContents.send('update:download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
        log.info('Update downloaded:', info.version);
        downloadedThisSession = true;
        mainWindow.webContents.send('update:downloaded', info);

        const config = getConfig();
        if (config.autoInstall) {
            // Give user 5 seconds before auto-installing
            setTimeout(() => {
                log.info('Auto-installing update...');
                // isSilent=true: never show the NSIS wizard — the in-app
                // update UI is the only thing the user sees.
                autoUpdater.quitAndInstall(true, true);
            }, 5000);
        }
    });

    autoUpdater.on('error', (error) => {
        log.error('Auto-updater error:', error);
        mainWindow.webContents.send('update:error', {
            message: error.message,
            stack: error.stack
        });
    });

    // IPC Handlers
    ipcMain.handle('update:check-now', async () => {
        try {
            if (!feedVerdict.ok) {
                return {
                    updateAvailable: false,
                    currentVersion: autoUpdater.currentVersion.version,
                    error: `Feed de atualização não confiável: ${feedVerdict.reason}`
                };
            }
            const result = await autoUpdater.checkForUpdates();
            updateLastCheck();

            if (result) {
                return {
                    updateAvailable: result.updateInfo.version !== autoUpdater.currentVersion.version,
                    currentVersion: autoUpdater.currentVersion.version,
                    latestVersion: result.updateInfo.version,
                    updateInfo: result.updateInfo
                };
            }

            return {
                updateAvailable: false,
                currentVersion: autoUpdater.currentVersion.version
            };
        } catch (error: unknown) {
            log.error('Error checking for updates:', error);
            return {
                updateAvailable: false,
                currentVersion: autoUpdater.currentVersion.version,
                error: getErrorMessage(error)
            };
        }
    });

    ipcMain.handle('update:download', async () => {
        try {
            if (!feedVerdict.ok) return { success: false, error: feedVerdict.reason };
            if (!artifactsTrusted) {
                return { success: false, error: 'Nenhuma atualização com sha512 publicado foi anunciada' };
            }
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (error: unknown) {
            log.error('Error downloading update:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('update:install', () => {
        try {
            // O instalador NSIS é perMachine + allowElevation e roda em silêncio:
            // é o único caminho de execução elevada do produto. Só liberamos
            // depois de um download que o próprio processo principal validou —
            // uma chamada avulsa deste canal não dispara instalador nenhum.
            if (!downloadedThisSession) {
                log.warn('[update] install recusado: nenhuma atualização verificada nesta sessão');
                return { success: false, error: 'Nenhuma atualização verificada foi baixada nesta sessão' };
            }
            // Quit and install immediately, silently (no NSIS wizard)
            autoUpdater.quitAndInstall(true, true);
            return { success: true };
        } catch (error: unknown) {
            log.error('Error installing update:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('update:get-config', () => {
        return getConfig();
    });

    ipcMain.handle('update:set-config', (_, config: Partial<UpdateConfig>) => {
        saveConfig(config);
        return { success: true };
    });

    ipcMain.handle('update:skip-version', (_, version: string) => {
        saveConfig({ skippedVersion: version });
        return { success: true };
    });

    // Check for updates on app ready if configured
    if (shouldCheckForUpdates()) {
        // Wait 5 seconds after app starts to check for updates
        setTimeout(() => {
            log.info('Checking for updates (scheduled)...');
            guardedCheck().catch(err => {
                log.error('Scheduled update check failed:', err);
            });
        }, 5000);
    }

    // Set up periodic checking (every hour)
    setInterval(() => {
        if (shouldCheckForUpdates()) {
            log.info('Checking for updates (periodic)...');
            guardedCheck().catch(err => {
                log.error('Periodic update check failed:', err);
            });
        }
    }, 60 * 60 * 1000); // Every hour

    log.info('Auto-updater initialized');
}
