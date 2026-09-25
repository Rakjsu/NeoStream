/**
 * 📁 Pasta IRMÃ que só compartilha o prefixo não é a pasta de gravações.
 *
 * Cinco dos seis handlers de arquivo do DVR confinavam o caminho com
 * `source.startsWith(dir)` — sem separador. `...\NeoStream\Gravacoes Antigas\`
 * e `...\NeoStream\Gravacoes.bak\` (pastas que o próprio usuário cria ao
 * arquivar) começam com o texto `...\NeoStream\Gravacoes` e passavam: o
 * `dvr:rename-file` MOVIA o arquivo de fora para dentro das gravações, o
 * `convert-mp4` rodava o ffmpeg e escrevia o .mp4 ao lado do original, o
 * `thumbnail` abria o arquivo no ffmpeg, o `export-file` copiava e o
 * `show-in-folder` revelava. Só o `delete-file` exigia o separador — e esse
 * comparava com caixa, então no Windows recusava `c:\...` contra `C:\...`.
 *
 * Os seis agora usam a regra do `isInside` (downloadPaths.ts), a mesma do
 * download e do mpv.
 *
 * O teste chama os handlers de verdade, com pastas de verdade; só `electron`,
 * o `spawn` e o caminho do ffmpeg são de mentira — e o que se amarra é o
 * efeito (arquivo movido, processo aberto, diálogo mostrado), não a string da
 * checagem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
type Resultado = { success: boolean; error?: string; path?: string; canceled?: boolean }

const h = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')

    /** Processo do ffmpeg de mentira: o `close` vem logo depois de nascer. */
    class FakeProc extends EventEmitter {
        stderr = new EventEmitter()
    }

    return {
        FakeProc,
        videos: '',
        handlers: new Map<string, IpcHandler>(),
        spawn: vi.fn(),
        showItemInFolder: vi.fn(),
        showSaveDialog: vi.fn(async () => ({ canceled: true as boolean, filePath: undefined as string | undefined })),
    }
})

vi.mock('electron', () => ({
    app: { getPath: () => h.videos, on: () => undefined, quit: () => undefined },
    ipcMain: { handle: (canal: string, fn: IpcHandler) => h.handlers.set(canal, fn) },
    shell: { showItemInFolder: h.showItemInFolder, openPath: async () => '' },
    dialog: { showSaveDialog: h.showSaveDialog },
    BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('child_process', () => ({ spawn: h.spawn, default: { spawn: h.spawn } }))
vi.mock('./ffmpegPath', () => ({ resolveFfmpegPath: () => 'ffmpeg-de-mentira', foraDoAsar: (p: string) => p }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupDvrHandlers, recordingsDir } from './dvrHandlers'

const chamar = (canal: string, dados: unknown) =>
    Promise.resolve((h.handlers.get(canal) as IpcHandler)(null, dados)) as Promise<Resultado>

/** Cria um arquivo e devolve o caminho. */
function arquivo(pasta: string, nome: string): string {
    fs.mkdirSync(pasta, { recursive: true })
    const caminho = path.join(pasta, nome)
    fs.writeFileSync(caminho, 'conteudo')
    return caminho
}

/** As irmãs que começam com o MESMO texto da pasta de gravações. */
const irmas = () => [`${recordingsDir()} Antigas`, `${recordingsDir()}.bak`]

describe('handlers de arquivo do DVR: pasta irmã com o mesmo prefixo fica de fora', () => {
    beforeEach(() => {
        h.handlers.clear()
        h.spawn.mockReset()
        h.spawn.mockImplementation(() => {
            const proc = new h.FakeProc()
            setImmediate(() => proc.emit('close', 0))
            return proc
        })
        h.showItemInFolder.mockReset()
        h.showSaveDialog.mockReset()
        h.showSaveDialog.mockImplementation(async () => ({ canceled: true, filePath: undefined }))
        h.videos = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-dvr-irma-'))
        fs.mkdirSync(recordingsDir(), { recursive: true })
        setupDvrHandlers()
    })

    afterEach(() => {
        fs.rmSync(h.videos, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('a pasta irmã existe mesmo e começa com o texto da pasta de gravações (premissa)', () => {
        for (const irma of irmas()) {
            expect(irma.startsWith(recordingsDir())).toBe(true)
            expect(path.dirname(irma)).toBe(path.dirname(recordingsDir()))
        }
    })

    it('dvr:rename-file não puxa o arquivo da irmã para dentro das gravações', async () => {
        for (const irma of irmas()) {
            const fora = arquivo(irma, 'jogo.ts')

            const r = await chamar('dvr:rename-file', { path: fora, name: 'Puxado' })

            expect(r.success).toBe(false)
            expect(r.error).toBe('arquivo fora da pasta de gravações')
            expect(fs.existsSync(fora)).toBe(true)
            expect(fs.existsSync(path.join(recordingsDir(), 'Puxado.ts'))).toBe(false)
        }
    })

    it('dvr:show-in-folder não revela arquivo da irmã', async () => {
        for (const irma of irmas()) {
            const fora = arquivo(irma, 'x.mp4')

            const r = await chamar('dvr:show-in-folder', { path: fora })

            expect(r.success).toBe(false)
        }
        expect(h.showItemInFolder).not.toHaveBeenCalled()
    })

    it('dvr:convert-mp4 não roda o ffmpeg num .ts da irmã', async () => {
        for (const irma of irmas()) {
            const fora = arquivo(irma, 'jogo.ts')

            const r = await chamar('dvr:convert-mp4', { path: fora })

            expect(r.success).toBe(false)
            expect(r.error).toBe('gravação inválida')
            expect(fs.existsSync(path.join(irma, 'jogo.mp4'))).toBe(false)
        }
        expect(h.spawn).not.toHaveBeenCalled()
    })

    it('dvr:thumbnail não abre no ffmpeg um arquivo da irmã', async () => {
        for (const irma of irmas()) {
            const fora = arquivo(irma, 'jogo.ts')

            const r = await chamar('dvr:thumbnail', { path: fora })

            expect(r.success).toBe(false)
        }
        expect(h.spawn).not.toHaveBeenCalled()
    })

    it('dvr:export-file não oferece copiar um arquivo da irmã', async () => {
        for (const irma of irmas()) {
            const fora = arquivo(irma, 'jogo.ts')

            const r = await chamar('dvr:export-file', { path: fora })

            expect(r.success).toBe(false)
            expect(r.error).toBe('fora da pasta de gravações')
        }
        expect(h.showSaveDialog).not.toHaveBeenCalled()
    })

    it('dvr:delete-file (que já exigia o separador) continua recusando a irmã', async () => {
        for (const irma of irmas()) {
            const fora = arquivo(irma, 'jogo.ts')

            const r = await chamar('dvr:delete-file', { path: fora })

            expect(r.success).toBe(false)
            expect(r.error).toBe('Caminho fora da pasta de gravações')
            expect(fs.existsSync(fora)).toBe(true)
        }
    })

    it('a própria pasta de gravações não é "uma gravação" (só a raiz, sem arquivo)', async () => {
        const raiz = recordingsDir()

        expect((await chamar('dvr:rename-file', { path: raiz, name: 'Outra' })).success).toBe(false)
        expect((await chamar('dvr:show-in-folder', { path: raiz })).success).toBe(false)
        expect((await chamar('dvr:thumbnail', { path: raiz })).success).toBe(false)
        expect((await chamar('dvr:export-file', { path: raiz })).success).toBe(false)
        expect((await chamar('dvr:delete-file', { path: raiz })).success).toBe(false)
        expect(fs.existsSync(raiz)).toBe(true)
        expect(h.spawn).not.toHaveBeenCalled()
        expect(h.showItemInFolder).not.toHaveBeenCalled()
        expect(h.showSaveDialog).not.toHaveBeenCalled()
    })

    it('gravação DE DENTRO continua passando nos seis handlers (controle)', async () => {
        const ts = arquivo(recordingsDir(), 'Jogo.ts')

        expect((await chamar('dvr:show-in-folder', { path: ts })).success).toBe(true)
        expect(h.showItemInFolder).toHaveBeenCalledWith(ts)

        await chamar('dvr:thumbnail', { path: ts })
        expect(h.spawn).toHaveBeenCalledTimes(1)

        const conv = await chamar('dvr:convert-mp4', { path: ts })
        expect(conv.success).toBe(true)
        expect(h.spawn).toHaveBeenCalledTimes(2)

        const exp = await chamar('dvr:export-file', { path: ts })
        expect(exp.canceled).toBe(true)
        expect(h.showSaveDialog).toHaveBeenCalledTimes(1)

        const ren = await chamar('dvr:rename-file', { path: ts, name: 'Final' })
        expect(ren.success).toBe(true)
        const renomeado = path.join(recordingsDir(), 'Final.ts')
        expect(fs.existsSync(renomeado)).toBe(true)

        expect((await chamar('dvr:delete-file', { path: renomeado })).success).toBe(true)
        expect(fs.existsSync(renomeado)).toBe(false)
    })

    // Só no Windows: lá o disco não distingue caixa, e `C:\...` e `c:\...` são
    // o MESMO arquivo. O delete-file comparava com caixa e recusava à toa.
    it.runIf(path.sep === '\\')('no Windows, a caixa do caminho não tira a gravação de dentro da pasta', async () => {
        const ts = arquivo(recordingsDir(), 'Jogo.ts')
        const outraCaixa = ts.toUpperCase()
        expect(outraCaixa).not.toBe(ts)

        expect((await chamar('dvr:show-in-folder', { path: outraCaixa })).success).toBe(true)
        expect((await chamar('dvr:delete-file', { path: outraCaixa })).success).toBe(true)
        expect(fs.existsSync(ts)).toBe(false)
    })
})
