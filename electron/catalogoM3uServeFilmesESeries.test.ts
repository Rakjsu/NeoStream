/**
 * D087 — o roteador de catálogo dizia que lista M3U só tem TV ao vivo.
 *
 * O comentário em cima do desvio de M3U do `catalogListHandler`
 * (electron/ipcHandlers.ts) afirmava que "os outros kinds são simplesmente
 * vazios (a fase 1 cobre TV ao vivo)" — e quatro linhas abaixo o mesmo bloco
 * desestrutura `{ live, vod, series }` e responde os seis kinds. A mesma
 * afirmação se repetia no `playlists:add-m3u` ("live channels only") e no
 * `catalogCounts.ts` ("o M3U, que na fase 1 só traz canais").
 *
 * Duas partes:
 *  1. COMPORTAMENTO: o handler sobe de verdade (`setupIpcHandlers()`, com
 *     `electron` e `axios` mockados, playlistManager REAL sobre store em
 *     memória) e é chamado pelos canais do renderer. Uma lista M3U com canais,
 *     grupo de filmes e episódios SxxEyy responde os SEIS kinds, cada um com o
 *     pedaço certo do documento. É o fato que o comentário tem que descrever.
 *  2. O COMENTÁRIO: nenhum dos três lugares pode continuar dizendo que M3U é
 *     só canal ao vivo. Esta é a parte que reprova o código de hoje.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type Resposta = { success: boolean; data?: Array<Record<string, unknown>>; error?: string }

const h = vi.hoisted(() => ({
    handlers: new Map<string, Handler>(),
    /** URLs que o handler pediu à "rede". */
    pedidas: [] as string[],
    /**
     * 4 canais, 3 filmes e 2 séries, cada tipo num grupo só: os seis kinds
     * têm tamanhos que não se confundem (4 / 3 / 2 itens, 1 categoria), então
     * servir o pedaço errado do documento aparece até na contagem.
     */
    lista: [
        '#EXTM3U',
        ...['Canal 1', 'Canal 2', 'Canal 3', 'Canal 4'].flatMap((nome, i) =>
            [`#EXTINF:-1 group-title="Abertos",${nome}`, `http://provedor.exemplo/live/${i}.ts`]),
        ...['Filme 1', 'Filme 2', 'Filme 3'].flatMap((nome, i) =>
            [`#EXTINF:-1 group-title="Filmes | Ação",${nome}`, `http://provedor.exemplo/movie/${i}.mp4`]),
        ...['Serie A S01E01', 'Serie B S01E01'].flatMap((nome, i) =>
            [`#EXTINF:-1 group-title="Séries",${nome}`, `http://provedor.exemplo/series/${i}.mp4`]),
        '',
    ].join('\n'),
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

// Store de mentira em memória: o `setupIpcHandlers` roda a migração de
// playlists na primeira linha, e ela espera `auth`/`playlists` de verdade.
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
// O cache em disco (SQLite + userData) não é o assunto: passa direto pro fetcher.
vi.mock('./catalogCache', () => ({
    cachedCatalogFetch: async (_id: string, _kind: string, fetcher: () => Promise<unknown>) =>
        ({ data: await fetcher(), fromCache: false }),
    invalidatePlaylistCache: () => undefined,
}))
vi.mock('./certificatePolicy', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./certificatePolicy')>()),
    resolveProviderHttpsAgent: async () => undefined,
}))
vi.mock('axios', () => {
    const get = async (url: string) => {
        h.pedidas.push(url)
        return { data: h.lista, status: 200 }
    }
    return { default: { get, post: get, head: get, isAxiosError: () => false } }
})

import { setupIpcHandlers } from './ipcHandlers'
import { saveAndActivatePlaylist } from './playlistManager'

const RAIZ = path.join(__dirname, '..')

/** Os fontes são CRLF; normalizar antes de procurar. */
function ler(rel: string): string {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf-8').split('\r\n').join('\n')
}

/** Recorta um trecho entre duas âncoras, falhando FECHADO se alguma sumir. */
function trecho(fonte: string, de: string, ate: string, oQue: string): string {
    const i = fonte.indexOf(de)
    expect(i, `não achei \`${de}\` (${oQue})`).toBeGreaterThan(-1)
    const j = fonte.indexOf(ate, i)
    expect(j, `não achei o fim de ${oQue}`).toBeGreaterThan(i)
    return fonte.slice(i, j)
}

async function chamar(canal: string): Promise<Array<Record<string, unknown>>> {
    const fn = h.handlers.get(canal)
    expect(fn, `canal ${canal} não registrado`).toBeTruthy()
    const resposta = (await fn!({}, { forceRefresh: true })) as Resposta
    expect(resposta.success, `${canal}: ${resposta.error}`).toBe(true)
    return resposta.data ?? []
}

/** Afirmações de que lista M3U só traz canal ao vivo. */
const SO_AO_VIVO = /phase 1|fase 1|simply empty|live channels only|só traz canais/i

describe('D087 — lista M3U serve filmes e séries, não só TV ao vivo', () => {
    beforeAll(() => {
        setupIpcHandlers()
        saveAndActivatePlaylist({
            name: 'Lista de teste',
            url: 'http://provedor.exemplo/lista.m3u',
            username: 'm3u',
            password: 'm3u',
            type: 'm3u',
        })
    })

    it('comportamento: os seis kinds vêm do documento M3U, cada um com o seu pedaço', async () => {
        expect((await chamar('streams:get-live')).map(c => c.name)).toEqual(['Canal 1', 'Canal 2', 'Canal 3', 'Canal 4'])
        expect((await chamar('categories:get-live')).map(c => c.category_name)).toEqual(['Abertos'])

        expect((await chamar('streams:get-vod')).map(f => f.name)).toEqual(['Filme 1', 'Filme 2', 'Filme 3'])
        expect((await chamar('categories:get-vod')).map(c => c.category_name)).toEqual(['Filmes | Ação'])

        expect((await chamar('streams:get-series')).map(s => s.name)).toEqual(['Serie A', 'Serie B'])
        expect((await chamar('categories:get-series')).map(c => c.category_name)).toEqual(['Séries'])

        // A contagem da Home (catalogCounts.ts) enxerga os três catálogos.
        const contar = h.handlers.get('content:get-counts')
        expect(contar, 'canal content:get-counts não registrado').toBeTruthy()
        expect(await contar!({})).toEqual({ success: true, counts: { live: 4, vod: 3, series: 2 } })

        // Tudo saiu da MESMA lista cadastrada — nenhuma outra fonte.
        expect(new Set(h.pedidas)).toEqual(new Set(['http://provedor.exemplo/lista.m3u']))
    })

    it('o comentário do desvio M3U do roteador aponta a classificação live/vod/series', () => {
        const bloco = trecho(
            ler('electron/ipcHandlers.ts'),
            'async function catalogListHandler(',
            "if (activeEntry?.type === 'stalker')",
            'desvio M3U do catalogListHandler',
        )
        expect(SO_AO_VIVO.test(bloco), `comentário ainda diz que M3U é só ao vivo: ${bloco.match(SO_AO_VIVO)?.[0]}`).toBe(false)
        expect(bloco.includes('classifyM3uChannels'), 'comentário deve apontar a classificação live/vod/series').toBe(true)
        // O código que o comentário descreve continua lá.
        expect(bloco.includes('const { live, vod, series }')).toBe(true)
    })

    it('nenhum outro lugar do main diz que M3U só traz canais', () => {
        for (const rel of ['electron/ipcHandlers.ts', 'electron/catalogCounts.ts']) {
            const achado = ler(rel).match(SO_AO_VIVO)?.[0]
            expect(achado, `${rel} ainda diz "${achado}"`).toBeUndefined()
        }
    })
})
