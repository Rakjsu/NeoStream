// @vitest-environment node
/**
 * 🧹 D067 — o main não registra handler de download que nenhuma tela alcança.
 *
 * O `download:get-files` estava registrado no main e FORA da whitelist
 * `invokeChannels` do preload: nenhuma tela conseguia chamá-lo (o preload
 * recusa com `Blocked IPC channel`) e nenhuma chamava. Além de morto, ele
 * lia pastas que o próprio app não cria — varria `movie`, mas os filmes vão
 * para `movies` (downloadPaths.ts) — e devolvia as PASTAS de série como se
 * fossem arquivos. A lista da tela vem do IndexedDB; a única leitura de disco
 * que a página faz é o `download:get-storage-info`, que continua.
 *
 * O guarda do preload (preloadChannels.test.ts) cobra o sentido
 * usado-mas-não-declarado e declarado-mas-sem-consumidor; handler registrado
 * no main sem porta no preload passava pelos dois. Aqui o teste registra os
 * handlers de verdade (setupDownloadHandlers com um ipcMain de mentira) e
 * cobra os dois lados da ponte no namespace `download:`: todo canal
 * registrado tem porta no preload, e toda porta tem handler (a limpeza não
 * pode levar junto um handler vivo).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const h = vi.hoisted(() => {
    const handlers = new Map<string, IpcHandler>()
    const registrar = (canal: string, fn: IpcHandler) => {
        handlers.set(canal, fn)
    }
    return { handlers, registrar }
})

vi.mock('electron', () => ({
    // handleOnce também: um handler de uso único continua sendo porta do main.
    ipcMain: { handle: h.registrar, handleOnce: h.registrar },
    app: { getPath: () => path.join(__dirname, '__nunca_usado__') },
    BrowserWindow: { getAllWindows: () => [] },
    shell: { openPath: () => undefined, showItemInFolder: () => undefined },
    Notification: Object.assign(function NotificacaoFalsa() { /* nunca instanciada */ },
        { isSupported: () => false }),
}))
vi.mock('./winIntegration', () => ({ setTaskbarProgress: () => undefined }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupDownloadHandlers } from './downloadHandlers'

/** Nomes literais da `const invokeChannels = new Set([...])` do preload. */
function invokeChannels(): Set<string> {
    const preload = fs.readFileSync(path.join(__dirname, 'preload.ts'), 'utf-8')
    const match = /const invokeChannels = new Set\(\[([\s\S]*?)\]\)/.exec(preload)
    if (!match) throw new Error('lista invokeChannels não encontrada no preload')
    return new Set([...match[1].matchAll(/'([^']+)'/g)].map(entry => entry[1]))
}

/** Todos os .ts do main (electron/), menos os testes. */
function arquivosDoMain(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) arquivosDoMain(full, out)
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full)
    }
    return out
}

describe('handlers de download registrados no main', () => {
    beforeAll(() => {
        h.handlers.clear()
        setupDownloadHandlers()
    })

    it('registra os handlers (sanidade do ipcMain de mentira)', () => {
        expect(h.handlers.size).toBeGreaterThan(0)
        // A leitura de disco que a página de downloads usa de verdade continua.
        expect(h.handlers.has('download:get-storage-info')).toBe(true)
    })

    it('não registra o download:get-files, que nenhuma tela alcança', () => {
        expect(h.handlers.has('download:get-files')).toBe(false)
    })

    it('todo canal registrado tem porta no invokeChannels do preload', () => {
        const permitidos = invokeChannels()
        const inalcancaveis = [...h.handlers.keys()].filter(canal => !permitidos.has(canal))
        expect(inalcancaveis).toEqual([])
    })

    it('toda porta download:* do preload tem handler registrado', () => {
        const portas = [...invokeChannels()].filter(canal => canal.startsWith('download:'))
        expect(portas.length).toBeGreaterThan(0)
        const semHandler = portas.filter(canal => !h.handlers.has(canal))
        expect(semHandler).toEqual([])
    })

    it('nenhum outro arquivo do main registra canal download:* sem porta no preload', () => {
        const permitidos = invokeChannels()
        const padrao = /ipcMain\.(?:handle|handleOnce)\(\s*['"`](download:[^'"`]+)['"`]/g
        const inalcancaveis: string[] = []
        for (const arquivo of arquivosDoMain(__dirname)) {
            const fonte = fs.readFileSync(arquivo, 'utf-8')
            for (const achado of fonte.matchAll(padrao)) {
                if (!permitidos.has(achado[1])) {
                    inalcancaveis.push(`${path.basename(arquivo)}: ${achado[1]}`)
                }
            }
        }
        expect(inalcancaveis).toEqual([])
    })
})
