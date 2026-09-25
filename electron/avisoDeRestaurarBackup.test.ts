/**
 * D114 — o que o aviso de "Restaurar backup?" promete tem de ser o que o
 * restore faz.
 *
 * O aviso diz que perfis, favoritos, progresso e configurações "serão
 * sobrescritos pelos dados do backup". Para esses dados é verdade: cada um
 * mora numa chave-JSON inteira (`neostream_profile_<perfil>__pl_<playlist>`
 * guarda TODOS os favoritos daquele perfil naquela playlist), e o
 * `applyBackup` troca a chave inteira — o favorito marcado depois do backup
 * some. Por isso o texto NÃO pode dizer que "o que só existe aqui é mantido".
 *
 * O que o aviso calava: as playlists. O import do main só faz upsert
 * (`importPlaylistsFromBackup`), nunca apaga; a playlist cadastrada depois do
 * backup continua aqui, com os favoritos dela. Quem restaura "pra voltar ao
 * estado de antes" precisa saber disso ANTES de confirmar.
 *
 * O teste percorre o caminho do usuário: monta a seção de verdade, clica em
 * Importar, lê o aviso que APARECEU no diálogo e confirma. O IPC dublê entrega
 * `backup:import-playlists` ao `importPlaylistsFromBackup` REAL do main (store
 * em memória), do mesmo jeito que o handler entrega (o repasse do handler já é
 * guardado pela fonte em restaurarBackupNoPrimeiroAcesso.test.ts).
 *
 * Mora em electron/ (e sem JSX) porque importa o manager do main: em src/ o
 * `tsc -b` do app arrastaria o logger (`process`) e o `node:fs` pro typecheck.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Store em memória (mesmo molde de electron/playlistManager.test.ts).
vi.mock('./store', () => {
    const data = new Map<string, unknown>()
    return {
        default: {
            get: (key: string) => data.get(key),
            set: (key: string, value: unknown) => { data.set(key, value) },
            delete: (key: string) => { data.delete(key) },
        },
    }
})
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import store from './store'
import { importPlaylistsFromBackup, listPublicPlaylists, saveAndActivatePlaylist } from './playlistManager'
import type { PlaylistBackupEntry } from './playlistManager'
import { BackupSection } from '../src/pages/settings/BackupSection'
import { BACKUP_APP, BACKUP_VERSION, toBackupPlaylist } from '../src/services/backupService'
import { languageService } from '../src/services/languageService'
import pt from '../src/locales/ui/pt.json'
import en from '../src/locales/ui/en.json'
import es from '../src/locales/ui/es.json'

type Secao = Record<string, string>

const CASA = { name: 'Casa', url: 'http://provedor-a.example:8080', username: 'ana', password: 'segredo' }
const NOVA = { name: 'Nova', url: 'http://provedor-b.example:8080', username: 'bia', password: 'outra' }

const favoritos = (id: string) => JSON.stringify({ favorites: [{ id }] })

let container: HTMLDivElement
let root: Root
let pedidos: unknown[]
const ipcOriginal = (window as unknown as { ipcRenderer?: unknown }).ipcRenderer

/**
 * IPC dublê: só a propriedade `ipcRenderer` (nunca o `window` inteiro).
 * `backup:import-playlists` faz o que o handler faz: repassa ao manager real.
 */
function instalarIpc(backupJson: string) {
    const invoke = vi.fn(async (canal: string, args?: unknown) => {
        if (canal === 'backup:load-file') return { success: true, json: backupJson }
        if (canal === 'backup:import-playlists') {
            pedidos.push(args)
            const { playlists, activateIfNone } = args as { playlists: PlaylistBackupEntry[]; activateIfNone?: boolean }
            const { imported, idMap } = importPlaylistsFromBackup(
                Array.isArray(playlists) ? playlists : [],
                { activateIfNone: activateIfNone === true }
            )
            return { success: true, imported, idMap }
        }
        return { success: false }
    })
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke, on: vi.fn(), off: vi.fn(), send: vi.fn() }
}

/** Espera uma CONDIÇÃO, não um número de microtasks. */
async function esperarAte<T>(achar: () => T | null | undefined, oQue: string): Promise<T> {
    const limite = Date.now() + 5000
    for (;;) {
        const achado = achar()
        if (achado) return achado
        if (Date.now() > limite) throw new Error(`esperei demais: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    }
}

async function clicar(el: Element) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

function botaoComTexto(raiz: ParentNode, texto: string): HTMLButtonElement {
    const achado = Array.from(raiz.querySelectorAll('button')).find(b => (b.textContent ?? '').includes(texto))
    if (!achado) throw new Error(`não achei o botão "${texto}"`)
    return achado
}

beforeEach(async () => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    languageService.setLanguage('pt')
    await vi.waitFor(() => {
        expect(languageService.t('backup', 'confirmImportTitle')).toBe(pt.backup.confirmImportTitle)
    })
    localStorage.clear()
    store.set('auth', {})
    store.set('playlists', [])
    store.delete('activePlaylistId')
    store.delete('removedPlaylists')
    pedidos = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
    ;(window as unknown as { ipcRenderer?: unknown }).ipcRenderer = ipcOriginal
    localStorage.clear()
})

afterAll(() => {
    languageService.setLanguage('pt')
})

/**
 * HOJE, nesta máquina: a Casa (que o backup conhece) com um favorito marcado
 * DEPOIS do backup, e a Nova, cadastrada depois do backup, com o favorito dela.
 */
function estadoDeHoje() {
    const casa = saveAndActivatePlaylist(CASA)
    const nova = saveAndActivatePlaylist(NOVA)
    localStorage.setItem(`neostream_profile_p1__pl_${casa.id}`, favoritos('novo'))
    localStorage.setItem(`neostream_profile_p1__pl_${nova.id}`, favoritos('da-nova'))
    return { casa, nova }
}

/** O arquivo de um mês atrás: só conhecia a Casa (com o id que ela tinha ONDE foi feito). */
function arquivoDeUmMesAtras(idDaCasaNaOrigem: string): string {
    return JSON.stringify({
        version: BACKUP_VERSION,
        exportedAt: '2026-08-25T12:00:00.000Z',
        app: BACKUP_APP,
        data: { [`neostream_profile_p1__pl_${idDaCasaNaOrigem}`]: favoritos('antigo') },
        playlists: [toBackupPlaylist({ id: idDaCasaNaOrigem, ...CASA })],
    })
}

/** Importar -> lê o aviso do diálogo -> Restaurar. Devolve o aviso que o usuário leu. */
async function restaurarPelaTela(arquivo: string): Promise<string> {
    instalarIpc(arquivo)
    await act(async () => { root.render(createElement(BackupSection)) })
    await clicar(botaoComTexto(container, pt.backup.importButton))

    const titulo = await esperarAte(
        () => Array.from(container.querySelectorAll('h2')).find(h => h.textContent === pt.backup.confirmImportTitle),
        'o diálogo de confirmação não abriu',
    )
    const dialogo = titulo.parentElement!.parentElement!
    const aviso = dialogo.querySelector('p')?.textContent ?? ''

    await clicar(botaoComTexto(dialogo, pt.backup.confirmImportConfirm))
    await esperarAte(
        () => (container.textContent ?? '').includes(pt.backup.importSuccess),
        'o restore não terminou',
    )
    expect(pedidos).toHaveLength(1)
    return aviso
}

/** O aviso tem de contar os dois lados, e cada lado tem de ser o que aconteceu. */
function conferirAvisoContraOEstado(aviso: string, casa: { id: string }, nova: { id: string }) {
    expect(aviso.includes(pt.backup.confirmImportMessage)).toBe(true)
    expect(aviso.includes((pt.backup as Secao).confirmImportKeepsPlaylists)).toBe(true)

    // "Sobrescritos" é verdade: o favorito marcado depois do backup SUMIU (a
    // chave inteira veio do arquivo). Por isso o texto NÃO pode dizer que "o
    // que só existe aqui é mantido".
    expect(localStorage.getItem(`neostream_profile_p1__pl_${casa.id}`)).toBe(favoritos('antigo'))
    // E o que o aviso agora conta: a playlist daqui não foi apagada, nem os
    // favoritos dela.
    expect(listPublicPlaylists().map(p => p.name).sort()).toEqual(['Casa', 'Nova'])
    expect(localStorage.getItem(`neostream_profile_p1__pl_${nova.id}`)).toBe(favoritos('da-nova'))
}

describe('D114 — aviso de restaurar backup', () => {
    it('backup feito NOUTRA máquina: o aviso lido bate com o restore (favoritos trocados, playlist daqui mantida)', async () => {
        const { casa, nova } = estadoDeHoje()
        const aviso = await restaurarPelaTela(arquivoDeUmMesAtras('pl-origem-casa'))
        conferirAvisoContraOEstado(aviso, casa, nova)
    })

    it('backup feito NESTA máquina (mesmo id de playlist): o aviso lido bate com o restore', async () => {
        const { casa, nova } = estadoDeHoje()
        const aviso = await restaurarPelaTela(arquivoDeUmMesAtras(casa.id))
        conferirAvisoContraOEstado(aviso, casa, nova)
    })

    it('os três idiomas têm o aviso das playlists', () => {
        for (const [idioma, secao] of [['pt', pt.backup], ['en', en.backup], ['es', es.backup]] as const) {
            const msg = (secao as Secao).confirmImportKeepsPlaylists
            expect(typeof msg, `${idioma}: confirmImportKeepsPlaylists`).toBe('string')
            expect(msg.trim().length, `${idioma}: confirmImportKeepsPlaylists vazio`).toBeGreaterThan(0)
            // A promessa é SÓ sobre playlists: favoritos e perfis novos são
            // trocados pelo restore, então um "nada é apagado" genérico mentiria.
            expect(/playlist/i.test(msg), `${idioma}: o aviso não fala das playlists`).toBe(true)
        }
    })
})
