/**
 * Scheduled automatic backups (main process, works with the app in the tray).
 *
 * The backup PAYLOAD lives in the renderer (localStorage + playlists), so the
 * flow is a round trip: the hourly clock decides a backup is due → main asks
 * the renderer ('backup:auto-collect') → the renderer builds the same payload
 * as the manual export and hands it back ('backup:auto-save') → main strips
 * the credentials (`semCredenciais` — this file is written unattended, often
 * into a cloud-synced folder) and writes `neostream-backup-YYYY-MM-DD.json`
 * into the chosen folder, pruning old files (keeps the newest KEEP_FILES).
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import Store from 'electron-store'
import log from './logger'
import { getErrorMessage } from './errorMessage'

interface AutoBackupConfig {
    enabled: boolean
    dirPath: string
    intervalDays: number
    lastBackupAt: number
}

const store = new Store<{ autoBackup: AutoBackupConfig }>({ name: 'auto-backup' })

const DEFAULTS: AutoBackupConfig = { enabled: false, dirPath: '', intervalDays: 7, lastBackupAt: 0 }
const CHECK_EVERY_MS = 60 * 60 * 1000
/** Mesmo fôlego de boot do syncFolder.ts, pelo mesmo motivo. */
const BOOT_DELAY_MS = 20 * 1000
const KEEP_FILES = 8
const FILE_PREFIX = 'neostream-backup-'

/**
 * Chave de `data` cujo próprio NOME diz que ela guarda segredo
 * (`neostream_tmdb_api_key`, `neostream_trakt_token`, `neostream_trakt_creds`).
 * Regra pelo nome, e não lista fechada, para que a chave secreta de amanhã já
 * nasça de fora do backup desatendido em vez de esperar alguém se lembrar.
 */
const CHAVE_DE_SEGREDO = /(^|_)(token|creds|secret|api_key|password|senha)(_|$)/i

function getConfig(): AutoBackupConfig {
    return { ...DEFAULTS, ...(store.get('autoBackup') as Partial<AutoBackupConfig> | undefined) }
}

function setConfig(partial: Partial<AutoBackupConfig>): AutoBackupConfig {
    const next = { ...getConfig(), ...partial }
    store.set('autoBackup', next)
    return next
}

/** Pure-ish: is a backup due? (exported for tests via protocol split not needed — trivial) */
export function isBackupDue(config: AutoBackupConfig, nowMs: number): boolean {
    if (!config.enabled || !config.dirPath) return false
    return nowMs - config.lastBackupAt >= config.intervalDays * 24 * 3600_000
}

/**
 * ☁️ Pastas locais dos provedores de nuvem instalados (o cliente de sync do
 * provedor faz o upload sozinho — o app só grava o arquivo lá dentro).
 */
export function detectCloudDirs(): { provider: string; path: string }[] {
    const home = app.getPath('home')
    const candidates = [
        { provider: 'OneDrive', path: process.env.OneDrive || path.join(home, 'OneDrive') },
        { provider: 'Dropbox', path: path.join(home, 'Dropbox') },
        { provider: 'Google Drive', path: path.join(home, 'Google Drive') },
    ]
    return candidates.filter(c => {
        try { return fs.existsSync(c.path) } catch { return false }
    })
}

/**
 * 🔒 O backup que sai SOZINHO não leva credencial.
 *
 * O payload que o renderer entrega é o mesmo do export manual: `playlists[]`
 * com `passwordB64`, o bloco `openSubtitles` e, dentro de `data`, as chaves de
 * API do usuário (TMDB e Trakt — esta com o clientSecret e o par de tokens
 * OAuth). Base64 é ofuscação, não cifra: o cabeçalho do `backupService.ts` diz
 * isso com todas as letras. No export manual a troca é justa — a pessoa
 * escolhe a pasta na hora e pode cifrar o arquivo inteiro com senha
 * (`encryptBackup`, prefixo NEOENC2). Aqui não há nem uma coisa nem outra: o
 * agendador grava sem ninguém na frente da tela, e o atalho "salvar na nuvem"
 * (`backup:cloud-use`) aponta a pasta pro OneDrive/Dropbox/Drive e LIGA o
 * agendamento no mesmo clique. Daí em diante o segredo sai da máquina em 8
 * cópias rotativas, para todo aparelho logado naquela conta.
 *
 * Como não dá pra pedir senha a quem não está na frente da tela, o que não
 * pode vazar não viaja. O resto (perfis, favoritos, progresso, estatísticas,
 * preferências) continua inteiro, e o export manual continua levando tudo.
 *
 * O corte fica no main, e não no coletor do renderer, de propósito: é o único
 * ponto onde o arquivo de fato nasce, então um chamador futuro do canal não
 * reintroduz o vazamento sem passar por aqui. E o mesmo coletor serve o
 * `sync:save`, que PRECISA levar a credencial (é o que ele existe para fazer).
 *
 * `null` = payload que não sabemos ler; o que não se entende não vira arquivo
 * numa pasta sincronizada.
 */
export function semCredenciais(json: string): string | null {
    let payload: unknown
    try {
        payload = JSON.parse(json)
    } catch {
        return null
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
    const resto = { ...(payload as Record<string, unknown>) }
    delete resto.playlists
    delete resto.openSubtitles
    const data: unknown = resto.data
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        const semSegredo: Record<string, unknown> = {}
        for (const [chave, valor] of Object.entries(data as Record<string, unknown>)) {
            if (!CHAVE_DE_SEGREDO.test(chave)) semSegredo[chave] = valor
        }
        resto.data = semSegredo
    }
    return JSON.stringify(resto, null, 2)
}

async function pruneOldBackups(dirPath: string): Promise<void> {
    try {
        const entries = await fsp.readdir(dirPath)
        const backups = entries
            .filter(name => name.startsWith(FILE_PREFIX) && name.endsWith('.json'))
            .sort() // date-stamped names sort chronologically
        const doomed = backups.slice(0, Math.max(0, backups.length - KEEP_FILES))
        for (const name of doomed) {
            await fsp.rm(path.join(dirPath, name), { force: true })
        }
    } catch (error) {
        log.warn('[AutoBackup] prune failed:', error)
    }
}

export function setupAutoBackup(getWin: () => BrowserWindow | null) {
    ipcMain.handle('backup:auto-config-get', () => ({ success: true, config: getConfig() }))

    ipcMain.handle('backup:auto-config-set', (_e, partial: Partial<AutoBackupConfig>) => {
        const next = setConfig({
            enabled: partial?.enabled === true,
            ...(typeof partial?.dirPath === 'string' ? { dirPath: partial.dirPath } : {})
        })
        return { success: true, config: next }
    })

    ipcMain.handle('backup:cloud-dirs', () => ({ success: true, dirs: detectCloudDirs() }))

    // Atalho "salvar na nuvem": subpasta própria na pasta sincronizada + liga o auto-backup.
    ipcMain.handle('backup:cloud-use', (_e, { dirPath }: { dirPath: string }) => {
        const valid = detectCloudDirs().some(c => c.path === dirPath)
        if (!valid) return { success: false, error: 'unknown cloud dir' }
        const config = setConfig({ dirPath: path.join(dirPath, 'NeoStream Backups'), enabled: true })
        return { success: true, config }
    })

    ipcMain.handle('backup:choose-dir', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Pasta dos backups automáticos',
            defaultPath: app.getPath('documents'),
            properties: ['openDirectory', 'createDirectory']
        })
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true }
        }
        const config = setConfig({ dirPath: result.filePaths[0] })
        return { success: true, config }
    })

    // Renderer hands back the collected payload; main writes + prunes.
    ipcMain.handle('backup:auto-save', async (_e, { json }: { json: string }) => {
        try {
            const config = getConfig()
            if (!config.dirPath) return { success: false, error: 'no dirPath' }
            const seguro = semCredenciais(json)
            if (seguro === null) return { success: false, error: 'unreadable payload' }
            await fsp.mkdir(config.dirPath, { recursive: true })
            const date = new Date().toISOString().slice(0, 10)
            const filePath = path.join(config.dirPath, `${FILE_PREFIX}${date}.json`)
            await fsp.writeFile(filePath, seguro, 'utf-8')
            setConfig({ lastBackupAt: Date.now() })
            await pruneOldBackups(config.dirPath)
            log.info('[AutoBackup] saved', filePath)
            return { success: true, path: filePath }
        } catch (error) {
            log.error('[AutoBackup] save failed:', error)
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Hourly clock: when due, ask the renderer to collect the payload.
    const checkDue = () => {
        if (!isBackupDue(getConfig(), Date.now())) return
        const win = getWin()
        if (win && !win.isDestroyed()) {
            win.webContents.send('backup:auto-collect')
        }
    }

    // ⏰ O primeiro tique do intervalo só chega uma hora depois. Quem abre o
    // app pra ver um episódio e fecha — que é a sessão típica — nunca chegava
    // lá: o backup automático estava ligado, com prazo vencido, e nunca
    // acontecia. É o mesmo par "disparo no boot + cadência" do syncFolder, e
    // os 20 s existem pra não competir com o boot: o coletor do renderer varre
    // o localStorage inteiro, exporta as playlists e lê a config do
    // OpenSubtitles.
    //
    // `getWin()` continua sendo chamado DENTRO do checkDue, e não capturado
    // aqui: no macOS o `activate` recria a janela, e uma referência presa
    // apontaria pra webContents morta.
    setTimeout(checkDue, BOOT_DELAY_MS)
    setInterval(checkDue, CHECK_EVERY_MS)

    log.info('[AutoBackup] initialized')
}
