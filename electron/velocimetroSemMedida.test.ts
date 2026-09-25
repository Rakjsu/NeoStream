/**
 * D204 — o velocímetro do provedor dava "erro" garantido em portal Stalker e
 * em lista M3U de arquivo, do lado do MAIN.
 *
 * O `diagnostics:provider-health` está certo em não medir Mbps nesses dois
 * casos (portal Stalker não tem endpoint de volume; arquivo no disco não passa
 * pela rede). Só que a única coisa que ele devolvia era `speed: null` — a
 * mesma resposta de "o provedor não mandou dados suficientes" — e a tela só
 * sabia pintar isso de vermelho.
 *
 * O handler sobe de verdade (`setupIpcHandlers()`, `electron`/`axios`
 * mockados, playlistManager REAL sobre store em memória). Afirma-se:
 *  - `speedSupported`/`speedUnsupportedReason` dizem QUAL playlist não tem o
 *    que medir, e `{ speedSupportOnly: true }` responde isso sem tocar a rede
 *    (a tela pergunta ao abrir a aba);
 *  - pedir o teste de velocidade numa playlist sem medida não gasta
 *    handshake + lista de canais do portal pra devolver `null`;
 *  - Xtream e M3U por URL continuam medindo de verdade (só a lista de
 *    ARQUIVO fica sem medida, não toda M3U).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type Resposta = {
    success: boolean
    speed?: { mbps: number; bytes: number; seconds: number } | null
    speedSupported?: boolean
    speedUnsupportedReason?: string
    results?: unknown[]
    error?: string
}

const h = vi.hoisted(() => ({
    handlers: new Map<string, Handler>(),
    /** URLs que o handler pediu à "rede". */
    pedidas: [] as string[],
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Handler) => { h.handlers.set(canal, fn) },
        on: () => undefined,
        removeHandler: () => undefined,
    },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    dialog: {},
    screen: {},
    shell: {},
    app: { getPath: () => '', getVersion: () => '0.0.0', getName: () => 'neostream' },
}))

vi.mock('./store', () => {
    const dados = new Map<string, unknown>([['auth', {}], ['playlists', []]])
    return {
        default: {
            get: (chave: string) => dados.get(chave),
            set: (chave: string, valor: unknown) => { dados.set(chave, valor) },
            delete: (chave: string) => { dados.delete(chave) },
        },
    }
})
vi.mock('./logger', () => ({
    default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}))
vi.mock('./mpvPlayer', () => ({ esconderMpvParaDialogo: () => undefined }))
vi.mock('./providerEpg', () => ({
    ensureProviderEpgLoaded: () => undefined,
    getProviderUtcOffsetMinutes: () => 0,
    resetProviderEpgState: () => undefined,
    setupProviderEpgHandlers: () => undefined,
}))
vi.mock('./catalogCache', () => ({
    cachedCatalogFetch: async (_id: string, _kind: string, fetcher: () => Promise<unknown>) =>
        ({ data: await fetcher(), fromCache: false }),
    invalidatePlaylistCache: () => undefined,
}))
vi.mock('./certificatePolicy', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./certificatePolicy')>()),
    resolveProviderHttpsAgent: async () => undefined,
}))
// Toda "rede" devolve 128 KB em stream: acima do piso de 64 KB do
// velocímetro, então um Xtream mede de verdade.
vi.mock('axios', () => {
    const get = async (url: string) => {
        h.pedidas.push(url)
        return { status: 200, data: Readable.from([Buffer.alloc(128 * 1024)]) }
    }
    return { default: { get, post: get, head: get, isAxiosError: () => false } }
})

import { setupIpcHandlers } from './ipcHandlers'
import { saveAndActivatePlaylist } from './playlistManager'

const ARQUIVO = path.join(os.tmpdir(), 'neostream-d204-lista-que-nao-existe.m3u')

async function saude(opts?: Record<string, unknown>): Promise<Resposta> {
    const fn = h.handlers.get('diagnostics:provider-health')
    expect(fn, 'canal diagnostics:provider-health não registrado').toBeTruthy()
    return (await fn!({}, opts)) as Resposta
}

function ativarStalker() {
    saveAndActivatePlaylist({
        name: 'Portal', url: 'http://portal.exemplo/c/', username: '00:1A:79:AB:CD:EF',
        password: 'stalker', type: 'stalker',
    })
}
function ativarArquivo() {
    saveAndActivatePlaylist({ name: 'Arquivo', url: ARQUIVO, username: 'm3u', password: 'm3u', type: 'm3u' })
}
function ativarXtream() {
    saveAndActivatePlaylist({ name: 'Xtream', url: 'http://provedor.exemplo', username: 'u', password: 'p' })
}
function ativarM3uPorUrl() {
    saveAndActivatePlaylist({ name: 'Lista', url: 'http://lista.exemplo/lista.m3u', username: 'm3u', password: 'm3u', type: 'm3u' })
}

describe('D204 — o main diz quando a playlist ativa não tem velocidade para medir', () => {
    beforeAll(() => { setupIpcHandlers() })
    beforeEach(() => { h.pedidas.length = 0 })

    it('portal Stalker: responde "sem medida" pelo motivo certo, sem tocar a rede', async () => {
        ativarStalker()
        const r = await saude({ speedSupportOnly: true })
        expect(r).toEqual({ success: true, speed: null, speedSupported: false, speedUnsupportedReason: 'stalker' })
        expect(h.pedidas, 'a pergunta "tem o que medir?" foi à rede').toEqual([])
    })

    it('portal Stalker: o teste de velocidade não faz handshake + lista de canais pra devolver null', async () => {
        ativarStalker()
        const r = await saude({ speedTest: true })
        expect(r).toEqual({ success: true, speed: null, speedSupported: false, speedUnsupportedReason: 'stalker' })
        expect(h.pedidas, 'o velocímetro do Stalker ainda conversa com o portal à toa').toEqual([])
    })

    it('M3U de arquivo: "sem medida" pelo motivo de arquivo, e o teste nem lê a lista', async () => {
        ativarArquivo()
        const r = await saude({ speedSupportOnly: true })
        expect(r).toEqual({ success: true, speed: null, speedSupported: false, speedUnsupportedReason: 'm3u_file' })

        // Resposta exata: sem `results` = não passou pelo stat + parse do arquivo.
        const teste = await saude({ speedTest: true })
        expect(teste).toEqual({ success: true, speed: null, speedSupported: false, speedUnsupportedReason: 'm3u_file' })
    })

    it('o health check comum do Stalker continua sondando o portal', async () => {
        ativarStalker()
        const r = await saude()
        expect(r.success).toBe(true)
        expect(Array.isArray(r.results) && r.results.length).toBe(2)
        expect(h.pedidas.length, 'o health check do Stalker parou de sondar o portal').toBeGreaterThan(0)
    })

    it('M3U por URL: tem medida, e o teste baixa a própria lista', async () => {
        ativarM3uPorUrl()
        const r = await saude({ speedSupportOnly: true })
        expect(r).toEqual({ success: true, speed: null, speedSupported: true })
        expect(h.pedidas, 'a pergunta "tem o que medir?" foi à rede').toEqual([])

        const teste = await saude({ speedTest: true })
        expect(teste.success).toBe(true)
        expect(teste.speedSupported).not.toBe(false)
        expect(teste.speed?.bytes).toBe(128 * 1024)
    })

    it('Xtream: tem medida, e o teste mede de verdade', async () => {
        ativarXtream()
        const r = await saude({ speedSupportOnly: true })
        expect(r).toEqual({ success: true, speed: null, speedSupported: true })
        expect(h.pedidas, 'a pergunta "tem o que medir?" foi à rede').toEqual([])

        const teste = await saude({ speedTest: true })
        expect(teste.success).toBe(true)
        expect(teste.speedSupported).not.toBe(false)
        expect(teste.speed?.bytes).toBe(128 * 1024)
        expect(h.pedidas.some(u => u.includes('/get.php?'))).toBe(true)
    })
})
