/**
 * IPC handlers for the opt-in diagnostics / error-report feature.
 *
 *   - diagnostics:export-report  → gathers app/system info + the tail of
 *       main.log, assembles a redacted .txt report (see diagnosticsProtocol),
 *       prompts for a save location and writes it.
 *   - diagnostics:open-logs      → opens the logs folder in the OS file manager.
 *
 * The pure assembly + secret redaction lives in diagnosticsProtocol.ts so it
 * can be unit-tested without Electron.
 */
import { ipcMain, app, dialog, shell } from 'electron'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import log from './logger'
import { buildReportText, type ReportSystemInfo } from './diagnosticsProtocol'

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

/** Read at most the last `maxBytes` of main.log (best effort). */
async function readLogTail(maxBytes: number): Promise<string> {
    try {
        const logFile = path.join(app.getPath('logs'), 'main.log')
        const stat = await fs.stat(logFile)
        const start = Math.max(0, stat.size - maxBytes)

        const handle = await fs.open(logFile, 'r')
        try {
            const length = stat.size - start
            const buf = Buffer.alloc(length)
            await handle.read(buf, 0, length, start)
            let text = buf.toString('utf-8')
            // If we truncated mid-file, drop the partial first line.
            if (start > 0) {
                const nl = text.indexOf('\n')
                if (nl >= 0) text = text.slice(nl + 1)
            }
            return text
        } finally {
            await handle.close()
        }
    } catch (error) {
        log.warn('[Diagnostics] Could not read main.log tail:', getErrorMessage(error))
        return ''
    }
}

function gatherSystemInfo(): ReportSystemInfo {
    let locale: string | undefined
    try {
        locale = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
        locale = undefined
    }
    return {
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        osRelease: os.release(),
        osVersion: typeof os.version === 'function' ? os.version() : undefined,
        locale,
    }
}

/** Filename-friendly local timestamp: YYYY-MM-DD-HHmm. */
function timestampForFilename(d = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `-${pad(d.getHours())}${pad(d.getMinutes())}`
}

const LOG_TAIL_BYTES = 200 * 1024 // ~200KB

export function setupDiagnosticsHandlers() {
    // Assemble and save the error report. `breadcrumbs` is only supplied by the
    // renderer when the opt-in is enabled — otherwise the report is system info
    // + the main.log tail only.
    ipcMain.handle('diagnostics:export-report', async (_, payload: { breadcrumbs?: string } = {}) => {
        try {
            const logTail = await readLogTail(LOG_TAIL_BYTES)
            const report = buildReportText({
                version: app.getVersion(),
                timestamp: new Date().toISOString(),
                system: gatherSystemInfo(),
                breadcrumbs: typeof payload?.breadcrumbs === 'string' ? payload.breadcrumbs : undefined,
                logTail,
            })

            const result = await dialog.showSaveDialog({
                title: 'Salvar relatório de diagnóstico',
                defaultPath: `neostream-relatorio-${timestampForFilename()}.txt`,
                filters: [{ name: 'Text', extensions: ['txt'] }],
            })

            if (result.canceled || !result.filePath) {
                return { success: false, canceled: true }
            }

            await fs.writeFile(result.filePath, report, 'utf-8')
            log.info('[Diagnostics] Report saved to', result.filePath)
            return { success: true, path: result.filePath }
        } catch (error: unknown) {
            log.error('[Diagnostics] Export error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    // Open the logs folder in the OS file manager.
    ipcMain.handle('diagnostics:open-logs', async () => {
        try {
            const logsDir = app.getPath('logs')
            const result = await shell.openPath(logsDir)
            // openPath returns '' on success, or an error string.
            if (result) {
                log.warn('[Diagnostics] openPath returned:', result)
                return { success: false, error: result }
            }
            return { success: true }
        } catch (error: unknown) {
            log.error('[Diagnostics] Open logs error:', getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    log.info('Diagnostics handlers initialized')
}
