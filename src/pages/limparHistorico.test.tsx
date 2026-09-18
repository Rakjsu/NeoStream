import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { History } from './History'
import { resetStorageJsonCache } from '../services/storageJsonCache'

/**
 * A tela Historico listava tudo que a pessoa assistiu e NAO tinha como apagar
 * — nem a lista inteira, nem uma linha. Os dois `clearAllProgress()` e os
 * `clearMovieProgress` / `clearEpisodeProgress` ja existiam nos servicos, e
 * nenhum dos dois `clearAllProgress` tinha um unico chamador na interface.
 *
 * O invariante preso aqui e de COMPORTAMENTO, com a tela montada de verdade,
 * o localStorage real do jsdom e um roteador com telas vizinhas de mentira:
 *  - existe um caminho pela interface que apaga o historico inteiro, e ele
 *    passa por uma confirmacao que da pra sair por tres portas (Cancelar, Esc
 *    e o fundo) sem apagar nada;
 *  - o foco pousa no CANCELAR, nunca no botao destrutivo, e o dialogo se
 *    declara bloqueante pra navegacao por setas/controle;
 *  - existe um caminho que apaga UMA linha sem levar as VIZINHAS junto E sem
 *    mandar a pessoa pra outra tela (a linha inteira navega).
 * Nada aqui casa string de codigo-fonte.
 *
 * A semeadura tem DOIS filmes e DOIS episodios DA MESMA SERIE de proposito.
 * Com um item de cada, "apagar este episodio" e "apagar a serie inteira" dao
 * exatamente o mesmo resultado, e trocar `clearEpisodeProgress` por
 * `clearSeriesProgress` passava despercebido — o vizinho e quem prova que o
 * apagar e cirurgico.
 */

const PERFIL = 'p1'
const PLAYLIST = 'pl1'
const CHAVE_FILMES = `movie_watch_progress_${PERFIL}__pl_${PLAYLIST}`
const CHAVE_SERIES = `series_watch_progress_${PERFIL}__pl_${PLAYLIST}`

const AGORA = Date.now()
const H = 60 * 60 * 1000

/** Telas vizinhas de mentira: e por elas que o teste ve se houve navegacao. */
const TELA_FILMES = 'TELA-VOD'
const TELA_SERIES = 'TELA-SERIES'

interface FilmeGravado { movieId: string }
interface EpisodioGravado { seriesId: string; seasonNumber: number; episodeNumber: number }

function semearLocalStorage() {
    localStorage.clear()
    localStorage.setItem('neostream_active_playlist_id', PLAYLIST)
    localStorage.setItem('neostream_profiles', JSON.stringify({
        activeProfileId: PERFIL,
        profiles: [{ id: PERFIL, name: 'Dono', avatar: '🙂', isKids: false, createdAt: 1 }],
    }))
    localStorage.setItem(CHAVE_FILMES, JSON.stringify([
        {
            movieId: '777', movieName: 'Filme Semeado', profileId: PERFIL,
            currentTime: 600, duration: 6000, progress: 10,
            watchedAt: AGORA - 1 * H, completed: false,
        },
        {
            movieId: '888', movieName: 'Filme Vizinho', profileId: PERFIL,
            currentTime: 300, duration: 6000, progress: 5,
            watchedAt: AGORA - 2 * H, completed: false,
        },
    ]))
    localStorage.setItem(CHAVE_SERIES, JSON.stringify([
        {
            seriesId: '42', seasonNumber: 1, episodeNumber: 3, profileId: PERFIL,
            watchedAt: AGORA - 3 * H, completed: true,
        },
        // Mesma serie, episodio vizinho: a testemunha de que o apagar e cirurgico.
        {
            seriesId: '42', seasonNumber: 1, episodeNumber: 4, profileId: PERFIL,
            watchedAt: AGORA - 4 * H, completed: true,
        },
    ]))
    resetStorageJsonCache()
}

/** O preload nao existe no jsdom: as duas listas de metadados voltam vazias. */
function mockIpcVazio() {
    const fake = {
        invoke: vi.fn(() => Promise.resolve({ success: true, data: [] })),
        send: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    }
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = fake
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(
            <MemoryRouter initialEntries={['/dashboard/history']}>
                <Routes>
                    <Route path="/dashboard/history" element={<History />} />
                    <Route path="/dashboard/vod" element={<div>{TELA_FILMES}</div>} />
                    <Route path="/dashboard/series" element={<div>{TELA_SERIES}</div>} />
                </Routes>
            </MemoryRouter>
        )
    })
    // O efeito de metadados resolve dois invokes; um tick real da conta.
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

function botoes(raiz: ParentNode = container!) {
    return Array.from(raiz.querySelectorAll('button')) as HTMLButtonElement[]
}

function botaoComTexto(texto: string, raiz: ParentNode = container!) {
    const alvo = botoes(raiz).find(b => (b.textContent ?? '').includes(texto))
    if (!alvo) {
        throw new Error(
            `nenhum botao com "${texto}". Botoes na tela: ` +
            botoes(raiz).map(b => JSON.stringify(b.textContent)).join(' | ')
        )
    }
    return alvo
}

function linhas() {
    return Array.from(container!.querySelectorAll('.history-row')) as HTMLElement[]
}

/** Os titulos que a tela esta MOSTRANDO agora (nao o que esta no disco). */
function titulosNaTela() {
    return linhas().map(l => (l.querySelector('.history-row-title')?.textContent ?? '').trim())
}

/** O X de uma linha, achado pelo rotulo acessivel (nao pela classe). */
function botaoRemoverDaLinha(trechoDoTitulo: string) {
    const alvo = botoes().find(b => (b.getAttribute('aria-label') ?? '').includes(trechoDoTitulo))
    if (!alvo) {
        throw new Error(
            `nenhum botao de remover para "${trechoDoTitulo}". aria-labels: ` +
            botoes().map(b => JSON.stringify(b.getAttribute('aria-label'))).join(' | ')
        )
    }
    return alvo
}

function dialogo(): HTMLElement | null {
    return container!.querySelector('[role="dialog"]')
}

async function clicar(el: HTMLElement) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

async function teclar(key: string) {
    await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
}

async function abrirConfirmacao() {
    await clicar(botaoComTexto('Limpar Tudo'))
    const alvo = dialogo()
    if (!alvo) throw new Error('o botao de limpar tudo nao abriu confirmacao nenhuma')
    return alvo
}

function lerJson<T>(chave: string): T[] | null {
    const cru = localStorage.getItem(chave)
    return cru === null ? null : JSON.parse(cru) as T[]
}

/** O que sobrou NO DISCO, na forma que da pra comparar item a item. */
function filmesGravados() {
    return (lerJson<FilmeGravado>(CHAVE_FILMES) ?? []).map(f => f.movieId)
}
function episodiosGravados() {
    return (lerJson<EpisodioGravado>(CHAVE_SERIES) ?? [])
        .map(e => `${e.seriesId}-T${e.seasonNumber}E${e.episodeNumber}`)
}

function nadaFoiApagado() {
    expect(filmesGravados()).toEqual(['777', '888'])
    expect(episodiosGravados()).toEqual(['42-T1E3', '42-T1E4'])
}

beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    semearLocalStorage()
    mockIpcVazio()
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    localStorage.clear()
    resetStorageJsonCache()
    vi.restoreAllMocks()
})

describe('Historico: apagar pela interface', () => {
    it('lista o que foi semeado (o teste esta olhando a tela certa)', async () => {
        await montar()
        expect(linhas().length).toBe(4)
        expect(titulosNaTela()).toEqual([
            'Filme Semeado', 'Filme Vizinho', 'Série — T1E3', 'Série — T1E4',
        ])
    })

    it('clicar na LINHA leva pra outra tela (a sonda de navegacao funciona)', async () => {
        await montar()

        await clicar(linhas()[0])

        expect(container!.textContent).toContain(TELA_FILMES)
        expect(linhas().length).toBe(0)
    })

    it('"limpar tudo" pede confirmacao e so entao zera os dois servicos', async () => {
        await montar()

        await abrirConfirmacao()
        // Enquanto nao confirma, nada foi apagado.
        nadaFoiApagado()

        await clicar(botaoComTexto('Limpar Tudo', dialogo()!))

        expect(localStorage.getItem(CHAVE_FILMES)).toBeNull()
        expect(localStorage.getItem(CHAVE_SERIES)).toBeNull()
        expect(linhas().length).toBe(0)
        // E a tela vira o estado vazio, sem precisar remontar.
        expect(container!.textContent).toContain('Nenhum histórico ainda')
    })

    it('a confirmacao e um dialogo bloqueante de verdade e o foco pousa no CANCELAR', async () => {
        await montar()

        const alvo = await abrirConfirmacao()

        // A convencao que useSpatialNavigation/useGamepadNavigation leem pra
        // parar de mover o foco pela pagina de tras (TV e controle).
        expect(alvo.getAttribute('aria-modal')).toBe('true')
        expect(alvo.getAttribute('data-overlay')).toBe('modal')
        expect(alvo.getAttribute('aria-label')).toBeTruthy()

        // O foco NAO pode nascer no botao destrutivo.
        const focado = document.activeElement as HTMLElement | null
        expect(alvo.contains(focado)).toBe(true)
        expect(focado?.textContent).toContain('Cancelar')
    })

    it('cancelar a confirmacao nao apaga nada', async () => {
        await montar()

        const alvo = await abrirConfirmacao()
        await clicar(botaoComTexto('Cancelar', alvo))

        expect(dialogo()).toBeNull()
        nadaFoiApagado()
        expect(linhas().length).toBe(4)
    })

    it('Esc fecha a confirmacao sem apagar nada', async () => {
        await montar()

        await abrirConfirmacao()
        await teclar('Escape')

        expect(dialogo()).toBeNull()
        nadaFoiApagado()
        expect(linhas().length).toBe(4)
    })

    it('clicar no fundo fecha a confirmacao sem apagar nada', async () => {
        await montar()

        await abrirConfirmacao()
        const fundo = container!.querySelector('.history-confirm-overlay') as HTMLElement
        await clicar(fundo)

        expect(dialogo()).toBeNull()
        nadaFoiApagado()
        expect(linhas().length).toBe(4)
    })

    it('o X do filme apaga SO aquele filme — o outro filme fica', async () => {
        await montar()

        await clicar(botaoRemoverDaLinha('Filme Semeado'))

        expect(filmesGravados()).toEqual(['888'])
        expect(episodiosGravados()).toEqual(['42-T1E3', '42-T1E4'])
        // E a tela releu os servicos: sobrou exatamente o vizinho.
        expect(titulosNaTela()).toEqual(['Filme Vizinho', 'Série — T1E3', 'Série — T1E4'])
        expect(container!.textContent).not.toContain(TELA_FILMES)
    })

    it('o X do episodio apaga SO aquele episodio — o episodio vizinho DA MESMA SERIE fica', async () => {
        await montar()

        await clicar(botaoRemoverDaLinha('T1E3'))

        // Se aqui virar [] em vez de ['42-T1E4'], quem apagou foi
        // clearSeriesProgress: levou a serie inteira junto.
        expect(episodiosGravados()).toEqual(['42-T1E4'])
        expect(filmesGravados()).toEqual(['777', '888'])
        expect(titulosNaTela()).toEqual(['Filme Semeado', 'Filme Vizinho', 'Série — T1E4'])
        expect(container!.textContent).not.toContain(TELA_SERIES)
    })

    it('apagar linha a linha ate esvaziar cai no estado vazio', async () => {
        await montar()

        for (const titulo of ['Filme Semeado', 'Filme Vizinho', 'T1E3', 'T1E4']) {
            await clicar(botaoRemoverDaLinha(titulo))
        }

        expect(filmesGravados()).toEqual([])
        expect(episodiosGravados()).toEqual([])
        expect(linhas().length).toBe(0)
        expect(container!.textContent).toContain('Nenhum histórico ainda')
    })
})
