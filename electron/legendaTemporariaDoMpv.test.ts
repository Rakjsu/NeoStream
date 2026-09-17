import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

/**
 * 🧹 O .vtt que a busca de legenda deixa no %TEMP%.
 *
 * O mpv só aceita legenda externa por CAMINHO em disco, então
 * `mpv:add-subtitle` grava o VTT baixado num temporário novo a cada clique.
 * Ninguém mais no app conhecia esse arquivo: um grep por `neostream-sub` no
 * repositório inteiro só achava a linha que ESCREVE. Cada busca de legenda —
 * e são várias por filme, trocando de idioma — deixava dezenas a centenas de
 * KB no disco do usuário, para sempre.
 *
 * O teste é COMPORTAMENTAL: usa o %TEMP% de verdade (um `mkdtemp` próprio) e
 * confere o que sobra no disco depois de cada momento do ciclo de vida. Não
 * olha o fonte e não sabe o nome da função que faz a limpeza.
 */
type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const estado = vi.hoisted(() => ({
    temp: '',
    handlers: new Map<string, IpcHandler>(),
    quit: [] as (() => void)[],
}))

vi.mock('electron', () => ({
    app: {
        getPath: (nome: string) => (nome === 'temp' ? estado.temp : estado.temp),
        on: (evento: string, fn: () => void) => { if (evento === 'will-quit') estado.quit.push(fn) },
        isReady: () => true,
        whenReady: () => Promise.resolve(),
    },
    ipcMain: { handle: (canal: string, fn: IpcHandler) => estado.handlers.set(canal, fn) },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    net: { request: () => new EventEmitter() },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./store', () => ({ default: { get: () => undefined, set: () => undefined } }))

const legendas = () => fs.readdirSync(estado.temp).filter(n => n.endsWith('.vtt'))

describe('legenda temporária do mpv', () => {
    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.quit.length = 0
        estado.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-mpvsub-'))
    })

    afterEach(() => {
        fs.rmSync(estado.temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('a legenda buscada nao fica no %TEMP% depois que o app sai', async () => {
        const mod = await import('./mpvPlayer')
        mod.setupMpvHandlers()

        const addSubtitle = estado.handlers.get('mpv:add-subtitle')
        expect(addSubtitle, 'o canal mpv:add-subtitle sumiu').toBeDefined()
        // Sem sessão viva o handler recusa, mas o arquivo JÁ foi escrito — que
        // é exatamente o caminho que deixava lixo (buscar legenda com o mpv
        // fechado). Se um dia ele passar a recusar antes de escrever, o teste
        // vira vacuamente verde: por isso a asserção de que o arquivo existiu.
        await addSubtitle!(null, { content: 'WEBVTT\n\n00:00.000 --> 00:01.000\noi\n' }).catch(() => undefined)
        expect(legendas().length, 'o handler nem chegou a escrever o .vtt').toBe(1)

        // O app fecha.
        for (const aoSair of estado.quit) aoSair()

        expect(legendas(), 'sobrou legenda no %TEMP% depois do quit').toEqual([])
    })

    it('a varredura do boot leva embora o que uma execucao anterior deixou', async () => {
        // Resíduo de antes: app fechado com o mpv ainda vivo, crash, kill — ou
        // simplesmente tudo o que já se acumulou até hoje na máquina.
        const velha = path.join(estado.temp, 'neostream-sub-1700000000000.vtt')
        fs.writeFileSync(velha, 'WEBVTT')
        const alheio = path.join(estado.temp, 'outro-app.vtt')
        fs.writeFileSync(alheio, 'WEBVTT')

        const mod = await import('./mpvPlayer')
        mod.setupMpvHandlers()
        await new Promise(r => setTimeout(r, 50)) // a varredura é assíncrona e solta

        expect(fs.existsSync(velha), 'a legenda da execucao anterior continuou no disco').toBe(false)
        // E só as nossas: arquivo de outro programa não é da nossa conta.
        expect(fs.existsSync(alheio), 'a varredura apagou arquivo que nao e nosso').toBe(true)
    })
})
