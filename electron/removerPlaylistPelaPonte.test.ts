/**
 * D088 — a PONTE de verdade: remover a playlist apaga o estado dela no
 * renderer, e o sync seguinte não traz o escopo de volta.
 *
 * O teste do renderer (src/pages/settings/removerPlaylistLevaOsDados.test.tsx)
 * finge a resposta do main. Aqui o `window.ipcRenderer.invoke` chama os
 * handlers REAIS (`setupIpcHandlers()`, com `electron` mockado e o
 * playlistManager real sobre store em memória — molde de
 * catalogoM3uServeFilmesESeries.test.ts): a faxina do renderer depende do
 * `success` que o `playlists:remove` devolve, e a do sync depende de o
 * `backup:import-playlists` NÃO devolver par para a playlist apagada. Mudar
 * qualquer um dos dois retornos deixava o teste do renderer verde.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown

const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }))

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

import { setupIpcHandlers } from './ipcHandlers'
import { saveAndActivatePlaylist } from './playlistManager'
import { playlistService } from '../src/services/playlistService'
import { playlistScopedKeyFor } from '../src/services/activePlaylistService'
import { semEscopoDasRecusadas } from '../src/services/playlistIdRemap'

/** O estado de uma playlist do jeito que os serviços do renderer gravam. */
function semearEstado(playlistId: string): string[] {
    const chaves = [
        playlistScopedKeyFor('neostream_profile', 'p1', playlistId),
        playlistScopedKeyFor('movie_watch_progress', 'p1', playlistId),
        playlistScopedKeyFor('neostream_hidden_channels', 'p2', playlistId),
    ]
    for (const k of chaves) localStorage.setItem(k, '[]')
    return chaves
}

const presentes = (chaves: string[]) => chaves.filter(k => localStorage.getItem(k) !== null)

beforeAll(() => {
    setupIpcHandlers()
})

beforeEach(() => {
    localStorage.clear()
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke: async (canal: string, payload?: unknown) => {
            const fn = h.handlers.get(canal)
            if (!fn) throw new Error(`canal ${canal} não registrado`)
            return fn({}, payload)
        },
    }
})

afterEach(() => {
    delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer
})

describe('D088 — remover playlist pelo handler de verdade', () => {
    it('o main remove, o renderer apaga o escopo dela, e o sync de outra máquina não o devolve', async () => {
        const casa = saveAndActivatePlaylist({ name: 'Casa', url: 'http://a.exemplo', username: 'u', password: 'p' })
        const outra = saveAndActivatePlaylist({ name: 'Outra', url: 'http://b.exemplo', username: 'v', password: 'p' })
        const daCasa = semearEstado(casa.id)
        const daOutra = semearEstado(outra.id)

        const res = await playlistService.remove(casa.id)

        expect(res.success).toBe(true)
        expect(presentes(daCasa)).toEqual([])
        expect(presentes(daOutra)).toEqual(daOutra)

        // A outra máquina ainda lista a MESMA playlist, com o id de lá.
        const deLa = playlistScopedKeyFor('neostream_profile', 'p1', 'pl_la_1')
        const playlistsDeLa = [{ id: 'pl_la_1', name: 'Casa', url: 'http://a.exemplo', username: 'u', password: 'p' }]
        const importou = await window.ipcRenderer.invoke('backup:import-playlists', { playlists: playlistsDeLa }) as
            { success: boolean; idMap?: Record<string, string> }

        expect(importou.success).toBe(true)
        expect(importou.idMap).toEqual({}) // a apagada fica sem par...
        expect(semEscopoDasRecusadas({ [deLa]: '[]' }, playlistsDeLa, importou.idMap)).toEqual({}) // ...e o escopo dela não entra
    })

    it('playlist que o main não conhece: nada é apagado', async () => {
        const chaves = semearEstado('pl_inexistente_0')

        const res = await playlistService.remove('pl_inexistente_0')

        expect(res.success).toBe(false)
        expect(presentes(chaves)).toEqual(chaves)
    })
})
