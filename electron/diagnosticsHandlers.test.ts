/**
 * Testes dos handlers de diagnóstico com `electron` mockado.
 *
 * O que se prova aqui é que os DOIS botões de exportação redigem: o
 * `export-log` copiava o main.log byte a byte e entregava a senha do provedor
 * pra quem quer que o usuário mandasse o arquivo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type ExportResult = { success: boolean; path?: string; canceled?: boolean }

const state = vi.hoisted(() => ({
    logsDir: '',
    savePath: '' as string | undefined,
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('electron', () => ({
    ipcMain: { handle: (channel: string, fn: IpcHandler) => state.handlers.set(channel, fn) },
    app: { getPath: () => state.logsDir, getVersion: () => '4.45.0' },
    dialog: {
        showSaveDialog: async () => state.savePath
            ? { canceled: false, filePath: state.savePath }
            : { canceled: true, filePath: undefined },
    },
    shell: { openPath: async () => '' },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupDiagnosticsHandlers } from './diagnosticsHandlers'

/** main.log realista: os três formatos de vazamento que a auditoria achou. */
const LOG_COM_SEGREDO = [
    "[2026-07-28 10:00:00.000] [info] [XtreamClient] Response data: { user_info: { username: 'joao123', password: 's3nh4Secreta', auth: 1, status: 'Active' } }",
    '[2026-07-28 10:00:01.000] [info] [DLNA] casting MPEG-TS variant instead: http://prov.tv:8080/live/joao123/s3nh4Secreta/12345.ts',
    '[2026-07-28 10:00:02.000] [info] [EPG Cache] Downloading from: http://prov.tv:8080/xmltv.php?username=joao123&password=s3nh4Secreta',
    '[2026-07-28 10:00:03.000] [warn] [Catalog] 12345 canais carregados em 1.2s',
    '',
].join('\n')

const invoke = (channel: string) => (state.handlers.get(channel) as IpcHandler)(null) as Promise<ExportResult>

describe('diagnostics:export-log', () => {
    beforeEach(() => {
        state.handlers.clear()
        state.logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-diag-'))
        state.savePath = path.join(state.logsDir, 'exportado.log')
        fs.writeFileSync(path.join(state.logsDir, 'main.log'), LOG_COM_SEGREDO, 'utf-8')
        setupDiagnosticsHandlers()
    })

    afterEach(() => {
        fs.rmSync(state.logsDir, { recursive: true, force: true })
    })

    it('redige as credenciais em vez de copiar o log cru', async () => {
        const result = await invoke('diagnostics:export-log')
        expect(result.success).toBe(true)

        const exportado = fs.readFileSync(state.savePath as string, 'utf-8')
        expect(exportado).not.toContain('s3nh4Secreta')
        expect(exportado).not.toContain('joao123')
    })

    it('preserva o conteúdo útil do log pro suporte', async () => {
        await invoke('diagnostics:export-log')

        const exportado = fs.readFileSync(state.savePath as string, 'utf-8')
        expect(exportado).toContain('[Catalog] 12345 canais carregados em 1.2s')
        expect(exportado).toContain("status: 'Active'")
        expect(exportado).toContain('/live/***/***/12345.ts')
        // Uma linha por linha do original: a redação não come conteúdo.
        expect(exportado.split('\n')).toHaveLength(LOG_COM_SEGREDO.split('\n').length)
    })

    it('não escreve nada quando o usuário cancela o diálogo', async () => {
        state.savePath = undefined
        const result = await invoke('diagnostics:export-log')
        expect(result).toEqual({ success: false, canceled: true })
    })
})

describe('diagnostics:export-report', () => {
    beforeEach(() => {
        state.handlers.clear()
        state.logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-diag-'))
        state.savePath = path.join(state.logsDir, 'relatorio.txt')
        fs.writeFileSync(path.join(state.logsDir, 'main.log'), LOG_COM_SEGREDO, 'utf-8')
        setupDiagnosticsHandlers()
    })

    afterEach(() => {
        fs.rmSync(state.logsDir, { recursive: true, force: true })
    })

    it('continua redigindo o trecho do log embutido no relatório', async () => {
        const result = await invoke('diagnostics:export-report')
        expect(result.success).toBe(true)

        const relatorio = fs.readFileSync(state.savePath as string, 'utf-8')
        expect(relatorio).not.toContain('s3nh4Secreta')
        expect(relatorio).toContain('App version : 4.45.0')
    })
})
