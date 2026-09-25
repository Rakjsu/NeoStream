import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Login } from './Login'
import { PlaylistsSection } from './settings/PlaylistsSection'
import { playlistService } from '../services/playlistService'
import { languageService } from '../services/languageService'

/**
 * D086 — `playlistService.rename` não tinha um único chamador no app.
 *
 * As duas telas que renomeiam uma playlist (Configurações → Playlists e o
 * passo "nome da playlist" do Login) chamavam `playlists:rename` direto no
 * `window.ipcRenderer`, pulando a camada que concentra a superfície IPC das
 * playlists (`list`/`add`/`switchTo`/`remove`/`update` já passam por ela). O
 * caso de `rename` em playlistService.test.ts só provava que o wrapper morto
 * continuava morto.
 *
 * O teste é comportamental e ponta a ponta no renderer: monta as duas telas de
 * verdade, faz o gesto de renomear e confere que
 *   - o pedido passou pelo serviço (o espião REPASSA pro método real — não
 *     finge a resposta), e
 *   - o canal saiu UMA vez só, com o payload certo — ou seja, pela ponte do
 *     serviço, e não pela ponte do serviço MAIS uma chamada na mão;
 *   - a tela reage ao que o handler do main devolve (ok → recarrega a lista;
 *     falha ou rejeição → aviso, sem recarregar).
 */

type Invoke = ReturnType<typeof vi.fn>
type Resposta = unknown | ((payload: unknown) => unknown)

/** `window.ipcRenderer` só com o que as duas telas usam. */
function mockIpc(respostas: Record<string, Resposta>): Invoke {
    const invoke = vi.fn(async (canal: string, payload?: unknown) => {
        if (!(canal in respostas)) return { success: false }
        const r = respostas[canal]
        return typeof r === 'function' ? (r as (p: unknown) => unknown)(payload) : r
    })
    const fake = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() }
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = fake
    return invoke
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montar(no: React.ReactNode) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root!.render(no) })
}

async function desmontar() {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
}

/** Troca o valor de um input controlado do jeito que o React enxerga. */
async function digitar(input: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(input, valor)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function chamadasDoCanal(invoke: Invoke, canal: string): unknown[][] {
    return invoke.mock.calls.filter(c => c[0] === canal)
}

const LISTA = [
    { id: 'p1', name: 'Casa', url: 'http://x', username: 'u', active: true, type: 'xtream' as const },
]

/** Monta Configurações → Playlists e entra no modo de edição do nome. */
async function abrirEdicaoDoNome(): Promise<HTMLInputElement> {
    await montar(<PlaylistsSection />)
    await vi.waitFor(() => {
        expect(container!.querySelector('.playlists-item')).not.toBeNull()
    })
    const lapis = container!.querySelector<HTMLButtonElement>('.playlists-item-name button')
    if (!lapis) throw new Error('botão de renomear não está na tela')
    await act(async () => { lapis.click() })
    const input = container!.querySelector<HTMLInputElement>('.playlists-item-name input')
    if (!input) throw new Error('campo de renomear não abriu')
    return input
}

async function confirmarEdicao(input: HTMLInputElement) {
    // onBlur do React escuta `focusout`.
    await act(async () => {
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
}

const avisoDeFalha = () => languageService.t('playlists', 'renameFailed')

beforeAll(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
    localStorage.clear()
})

afterEach(async () => {
    await desmontar()
    vi.restoreAllMocks()
})

describe('Configurações → Playlists: renomear passa pelo playlistService', () => {
    it('confirmar o nome novo vai pelo serviço, sai UMA vez no canal e recarrega a lista', async () => {
        const invoke = mockIpc({
            'playlists:list': { success: true, playlists: LISTA },
            'playlists:rename': { success: true },
        })
        const rename = vi.spyOn(playlistService, 'rename')

        const input = await abrirEdicaoDoNome()
        await digitar(input, '  Sala  ')
        await confirmarEdicao(input)

        // ok do handler → a lista é recarregada (list na montagem + list depois).
        await vi.waitFor(() => {
            expect(chamadasDoCanal(invoke, 'playlists:list').length).toBe(2)
        })
        expect(rename).toHaveBeenCalledTimes(1)
        expect(rename).toHaveBeenCalledWith('p1', 'Sala')
        expect(chamadasDoCanal(invoke, 'playlists:rename')).toEqual([
            ['playlists:rename', { id: 'p1', name: 'Sala' }],
        ])
        expect(container!.querySelector('.playlists-error')).toBeNull()
    })

    it('o handler do main responder falha → aviso na tela e a lista NÃO é recarregada', async () => {
        const invoke = mockIpc({
            'playlists:list': { success: true, playlists: LISTA },
            'playlists:rename': { success: false, error: 'Playlist not found or invalid name' },
        })
        const rename = vi.spyOn(playlistService, 'rename')

        const input = await abrirEdicaoDoNome()
        await digitar(input, 'Sala')
        await confirmarEdicao(input)

        await vi.waitFor(() => {
            expect(container!.querySelector('.playlists-error')?.textContent).toBe(avisoDeFalha())
        })
        expect(rename).toHaveBeenCalledWith('p1', 'Sala')
        expect(chamadasDoCanal(invoke, 'playlists:rename').length).toBe(1)
        expect(chamadasDoCanal(invoke, 'playlists:list').length).toBe(1)
    })

    it('o IPC rejeitar (preload fora) → aviso de falha, sem derrubar a tela', async () => {
        const invoke = mockIpc({
            'playlists:list': { success: true, playlists: LISTA },
            'playlists:rename': () => Promise.reject(new Error('preload fora')),
        })
        const rename = vi.spyOn(playlistService, 'rename')

        const input = await abrirEdicaoDoNome()
        await digitar(input, 'Sala')
        await confirmarEdicao(input)

        await vi.waitFor(() => {
            expect(container!.querySelector('.playlists-error')?.textContent).toBe(avisoDeFalha())
        })
        expect(rename).toHaveBeenCalledWith('p1', 'Sala')
        expect(chamadasDoCanal(invoke, 'playlists:rename').length).toBe(1)
        expect(container!.querySelector('.playlists-item')).not.toBeNull()
    })

    it('nome igual (ou só espaços) não chama o serviço nem o canal', async () => {
        const invoke = mockIpc({ 'playlists:list': { success: true, playlists: LISTA } })
        const rename = vi.spyOn(playlistService, 'rename')

        for (const valor of ['Casa', '   ']) {
            const input = await abrirEdicaoDoNome()
            await digitar(input, valor)
            await confirmarEdicao(input)
            await vi.waitFor(() => {
                expect(container!.querySelector('.playlists-item-name input')).toBeNull()
            })
            await desmontar()
        }

        expect(rename).not.toHaveBeenCalled()
        expect(chamadasDoCanal(invoke, 'playlists:rename').length).toBe(0)
    })
})

describe('Login: o nome da primeira playlist passa pelo playlistService', () => {
    /** Faz o login (auth:login ok) e grava o nome no passo seguinte. */
    async function loginEGravarNome(nome: string) {
        await montar(<MemoryRouter><Login /></MemoryRouter>)

        const credenciais = container!.querySelector('form')
        if (!credenciais) throw new Error('formulário de credenciais não está na tela')
        await act(async () => {
            credenciais.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        await vi.waitFor(() => {
            expect(container!.querySelector('.login-playlist form')).not.toBeNull()
        })

        const campoNome = container!.querySelector<HTMLInputElement>('.login-playlist input')!
        await digitar(campoNome, nome)
        const formNome = container!.querySelector('.login-playlist form')!
        await act(async () => {
            formNome.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
    }

    const respostasDoLogin = {
        'auth:login': { success: true, playlistId: 'pl-nova' },
        'content:get-counts': { success: true, counts: { live: 1, vod: 2, series: 3 } },
    }

    it('o passo "nome da playlist" grava via playlistService.rename, UMA vez no canal', async () => {
        const invoke = mockIpc({ ...respostasDoLogin, 'playlists:rename': { success: true } })
        const rename = vi.spyOn(playlistService, 'rename')
        // O Login termina recarregando a janela; no jsdom isso é "not implemented".
        vi.spyOn(console, 'error').mockImplementation(() => {})

        await loginEGravarNome('Minha lista')

        await vi.waitFor(() => {
            expect(rename).toHaveBeenCalledWith('pl-nova', 'Minha lista')
        })
        expect(rename).toHaveBeenCalledTimes(1)
        expect(chamadasDoCanal(invoke, 'playlists:rename')).toEqual([
            ['playlists:rename', { id: 'pl-nova', name: 'Minha lista' }],
        ])
    })

    it('nome em branco → grava o nome padrão da playlist pelo serviço', async () => {
        const invoke = mockIpc({ ...respostasDoLogin, 'playlists:rename': { success: true } })
        const rename = vi.spyOn(playlistService, 'rename')
        vi.spyOn(console, 'error').mockImplementation(() => {})

        await loginEGravarNome('')

        const padrao = languageService.t('playlists', 'defaultName')
        expect(padrao).not.toBe('')
        await vi.waitFor(() => {
            expect(rename).toHaveBeenCalledWith('pl-nova', padrao)
        })
        expect(chamadasDoCanal(invoke, 'playlists:rename')).toEqual([
            ['playlists:rename', { id: 'pl-nova', name: padrao }],
        ])
    })

    it('renomear falhar no IPC não trava o login: loga e segue pro onboarding', async () => {
        // Sem chave TMDB (nem a do ambiente): o fim do fluxo marca o onboarding.
        localStorage.setItem('neostream_tmdb_ignore_env', '1')
        mockIpc({
            ...respostasDoLogin,
            'playlists:rename': () => Promise.reject(new Error('preload fora')),
        })
        const rename = vi.spyOn(playlistService, 'rename')
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {})

        await loginEGravarNome('Minha lista')

        await vi.waitFor(() => {
            expect(erro.mock.calls.some(c => c[0] === 'Failed to rename playlist:')).toBe(true)
        })
        expect(rename).toHaveBeenCalledWith('pl-nova', 'Minha lista')
        // O reload vem logo depois — o fluxo chegou ao fim mesmo com a falha.
        expect(localStorage.getItem('neostream_tmdb_onboarding')).not.toBeNull()
    })
})
