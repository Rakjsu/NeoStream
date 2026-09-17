/**
 * ✏️ Renomear gravação para o MESMO nome não pode ser erro.
 *
 * O campo de renomear confirma no `onBlur`: abrir e clicar fora já manda o
 * nome de volta igual. O handler montava o alvo, achava o PRÓPRIO arquivo no
 * `existsSync` e devolvia "já existe uma gravação com esse nome" — que, até
 * este PR, nem chegava à tela (a linha sumia e voltava com o nome velho, sem
 * uma palavra), e no celular virava "erro" no controle web.
 *
 * O teste chama o handler de verdade, com pasta de verdade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type Resultado = { success: boolean; error?: string; path?: string }

const state = vi.hoisted(() => ({
    videos: '',
    handlers: new Map<string, IpcHandler>(),
}))

vi.mock('electron', () => ({
    app: { getPath: () => state.videos, on: () => undefined, quit: () => undefined },
    ipcMain: { handle: (canal: string, fn: IpcHandler) => state.handlers.set(canal, fn) },
    shell: { showItemInFolder: () => undefined, openPath: async () => '' },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupDvrHandlers, recordingsDir } from './dvrHandlers'

const renomear = (caminho: string, nome: string) =>
    (state.handlers.get('dvr:rename-file') as IpcHandler)(null, { path: caminho, name: nome }) as Promise<Resultado>

/** Cria uma gravação de mentira na pasta real do DVR. */
function gravacao(nome: string): string {
    const arquivo = path.join(recordingsDir(), nome)
    fs.writeFileSync(arquivo, 'conteudo')
    return arquivo
}

describe('dvr:rename-file', () => {
    beforeEach(() => {
        state.handlers.clear()
        state.videos = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-dvr-'))
        fs.mkdirSync(recordingsDir(), { recursive: true })
        setupDvrHandlers()
    })

    afterEach(() => {
        fs.rmSync(state.videos, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('o mesmo nome de volta é sucesso, e o arquivo continua lá', async () => {
        const arquivo = gravacao('Jogo.ts')

        const resultado = await renomear(arquivo, 'Jogo')

        expect(resultado.error).toBeUndefined()
        expect(resultado.success).toBe(true)
        expect(fs.existsSync(arquivo)).toBe(true)
    })

    it('espaço nas pontas também é o mesmo nome', async () => {
        const arquivo = gravacao('Final da Copa.ts')

        const resultado = await renomear(arquivo, '  Final da Copa  ')

        expect(resultado.success).toBe(true)
        expect(fs.existsSync(arquivo)).toBe(true)
    })

    it('rename de verdade move o arquivo e preserva a extensão', async () => {
        const arquivo = gravacao('Jogo.mp4')

        const resultado = await renomear(arquivo, 'Final')

        expect(resultado.success).toBe(true)
        expect(fs.existsSync(path.join(recordingsDir(), 'Final.mp4'))).toBe(true)
        expect(fs.existsSync(arquivo)).toBe(false)
    })

    it('nome já ocupado por OUTRO arquivo continua recusado, com o motivo', async () => {
        const arquivo = gravacao('Jogo.ts')
        gravacao('Final.ts')

        const resultado = await renomear(arquivo, 'Final')

        expect(resultado.success).toBe(false)
        expect(resultado.error).toContain('já existe')
        // E nenhum dos dois se perdeu no caminho.
        expect(fs.existsSync(arquivo)).toBe(true)
        expect(fs.existsSync(path.join(recordingsDir(), 'Final.ts'))).toBe(true)
    })

    it('nome vazio (ou só caractere proibido) é recusado', async () => {
        const arquivo = gravacao('Jogo.ts')

        expect((await renomear(arquivo, '   ')).error).toBe('nome vazio')
        expect((await renomear(arquivo, '???')).error).toBe('nome vazio')
        expect(fs.existsSync(arquivo)).toBe(true)
    })

    it('arquivo fora da pasta de gravações é recusado', async () => {
        const forA = path.join(state.videos, 'qualquer.ts')
        fs.writeFileSync(forA, 'x')

        const resultado = await renomear(forA, 'Novo')

        expect(resultado.success).toBe(false)
        expect(resultado.error).toContain('fora da pasta')
    })
})
