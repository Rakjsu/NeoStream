import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { LiveTV } from './LiveTV'
import { resetStorageJsonCache } from '../services/storageJsonCache'
import { favoritesService } from '../services/favoritesService'
import { FAV_CHECK_MSG_MS } from '../hooks/useFavoritesHealthCheck'

/**
 * 🩺 (#D028) O selo "⚠ FORA DO AR" nunca saía, e o botão "Verificar
 * favoritos" ficava congelado no último resultado.
 *
 * A sonda dos favoritos gravava os ids fora do ar num estado da página que
 * ninguém limpava — nem ao trocar de categoria, nem ao refazer a busca. Como o
 * selo é desenhado em QUALQUER card cujo id esteja no conjunto, depois de
 * verificar os favoritos e voltar pra "Todos os canais" o canal seguia marcado
 * fora do ar (mesmo que já tivesse voltado) até sair da página. E o botão,
 * quando a pessoa voltava pros favoritos, ainda mostrava o resultado velho.
 *
 * Os casos montam a TV ao vivo DE VERDADE (jsdom, só o IPC do preload
 * dublado) e fazem o caminho da pessoa: ⭐ Favoritos → 🩺 Verificar → Todos.
 */

const PERFIL = 'p1'

const CANAIS = [1, 2, 3].map(i => ({
    num: i, name: `Canal Teste ${i}`, stream_type: 'live', stream_id: i, stream_icon: '',
    epg_channel_id: '', added: '1600000000', category_id: '1', custom_sid: '',
    tv_archive: 0, direct_source: '', tv_archive_duration: 0,
}))

const SELO = '⚠ FORA DO AR'
const TODOS = ['Todos os Canais', 'All Channels', 'Todos los Canales']
const FAVORITOS = ['Canais favoritos', 'Favorite Channels', 'Canales favoritos']

let invoke: ReturnType<typeof vi.fn>

function semear() {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('neostream_active_playlist_id', 'pl1')
    localStorage.setItem('neostream_profiles', JSON.stringify({
        activeProfileId: PERFIL,
        profiles: [{ id: PERFIL, name: 'Dono', avatar: '🙂', isKids: false, createdAt: 1 }],
    }))
    resetStorageJsonCache()
    // Só os canais 1 e 2 são favoritos: o 3 fica fora da lista sondada.
    for (const c of CANAIS.slice(0, 2)) {
        favoritesService.add({ id: String(c.stream_id), type: 'channel', title: c.name, poster: '' })
    }
}

/** O canal 2 está fora do ar; os outros no ar. */
function dublarIpc() {
    invoke = vi.fn((canal: string, arg?: { targets?: { id: string }[] }) => {
        if (canal === 'streams:get-live') return Promise.resolve({ success: true, data: CANAIS })
        if (canal === 'categories:get-live') {
            return Promise.resolve({ success: true, data: [{ category_id: '1', category_name: 'Abertos', parent_id: 0 }] })
        }
        if (canal === 'auth:get-credentials') {
            return Promise.resolve({ success: true, credentials: { url: 'http://prov.example', username: 'u', password: 'p' } })
        }
        if (canal === 'diagnostics:probe-urls') {
            return Promise.resolve({
                success: true,
                results: (arg?.targets ?? []).map(t => ({ id: t.id, alive: t.id !== '2' })),
            })
        }
        return Promise.resolve({ success: true, data: [] })
    })
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke, send: vi.fn(), on: vi.fn(), off: vi.fn(),
    }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

/**
 * Espera a CONDIÇÃO, com teto de tempo real (Date.now não é falsificado). Com
 * o relógio falso ligado (`shouldAdvanceTime`), o setTimeout de 10 ms daqui
 * anda junto com o relógio de verdade.
 */
async function esperar(condicao: () => boolean, oQue: string, limiteMs = 3000) {
    const inicio = Date.now()
    while (!condicao()) {
        if (Date.now() - inicio > limiteMs) throw new Error(`nunca aconteceu: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
}

function botoes(): HTMLButtonElement[] {
    return Array.from(container!.querySelectorAll('button'))
}

function botaoComTexto(textos: string[]): HTMLButtonElement | undefined {
    return botoes().find(b => textos.some(t => (b.textContent ?? '').includes(t)))
}

function botaoVerificar(): HTMLButtonElement | undefined {
    return botoes().find(b => (b.getAttribute('title') ?? '').startsWith('Sonda os favoritos'))
}

async function digitarNaBusca(texto: string) {
    const input = container!.querySelector('input') as HTMLInputElement | null
    if (!input) throw new Error('a página não tem campo de busca')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(input, texto)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function alvosSondados(): string[][] {
    return invoke.mock.calls
        .filter(c => c[0] === 'diagnostics:probe-urls')
        .map(c => (c[1] as { targets: { id: string }[] }).targets.map(t => t.id))
}

function selos(): number {
    return (container!.textContent ?? '').split(SELO).length - 1
}

async function escolherCategoria(rotulos: string[]) {
    const menu = container!.querySelector('button.toggle-btn') as HTMLButtonElement | null
    if (!menu) throw new Error('sem o botão do menu de categorias')
    await act(async () => { menu.click() })
    await esperar(() => !!botaoComTexto(rotulos), `o item "${rotulos[0]}" aparecer no menu`)
    await act(async () => { botaoComTexto(rotulos)!.click() })
}

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(<MemoryRouter><LiveTV /></MemoryRouter>)
    })
    await esperar(() => (container!.textContent ?? '').includes('Canal Teste 3'), 'a grade aparecer')
}

/** Favoritos → Verificar → espera o selo aparecer no canal 2. */
async function verificarFavoritos() {
    await escolherCategoria(FAVORITOS)
    await esperar(() => !!botaoVerificar(), 'o botão de verificar aparecer')
    await act(async () => { botaoVerificar()!.click() })
    await esperar(() => selos() === 1, 'o selo aparecer no canal fora do ar')
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    semear()
    dublarIpc()
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    document.body.innerHTML = ''
    localStorage.clear()
    sessionStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('TV ao vivo: o selo "fora do ar" vale só pros favoritos verificados', () => {
    it('voltar pra "Todos os canais" tira o selo dos cards', async () => {
        await montar()
        await verificarFavoritos()
        expect(botaoVerificar()!.textContent).toContain('1 de 2 fora do ar')
        // A sonda vai só pros canais da lista ⭐ (a filtrada), não pro catálogo.
        expect(alvosSondados()).toEqual([['1', '2']])

        await escolherCategoria(TODOS)
        await esperar(() => !botaoVerificar(), 'o botão de verificar sumir fora dos favoritos')

        expect((container!.textContent ?? '').includes('Canal Teste 2')).toBe(true)
        expect(selos()).toBe(0)
    })

    it('voltar pros favoritos mostra o botão pronto pra verificar de novo, sem o resultado velho', async () => {
        await montar()
        await verificarFavoritos()

        await escolherCategoria(TODOS)
        await escolherCategoria(FAVORITOS)
        await esperar(() => !!botaoVerificar(), 'o botão de verificar voltar')

        expect(botaoVerificar()!.textContent).toContain('Verificar favoritos')
        expect(selos()).toBe(0)
    })

    it('refazer a busca dentro dos favoritos também tira o selo', async () => {
        await montar()
        await verificarFavoritos()

        // A busca deixa só o canal fora do ar na grade — e ele segue na tela.
        await digitarNaBusca('Teste 2')
        await esperar(() => !(container!.textContent ?? '').includes('Canal Teste 1'), 'a busca filtrar a grade')

        expect((container!.textContent ?? '').includes('Canal Teste 2')).toBe(true)
        expect(selos()).toBe(0)
        expect(botaoVerificar()!.textContent).toContain('Verificar favoritos')
    })

    it('o rótulo do botão volta sozinho depois de alguns segundos (o selo fica)', async () => {
        await montar()
        await escolherCategoria(FAVORITOS)
        await esperar(() => !!botaoVerificar(), 'o botão de verificar aparecer')

        // Relógio falso só pro setTimeout, andando junto com o de verdade: as
        // esperas por condição seguem funcionando e o salto de 6 s é na mão.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
        await act(async () => { botaoVerificar()!.click() })
        await esperar(() => selos() === 1, 'o selo aparecer no canal fora do ar')
        expect(botaoVerificar()!.textContent).toContain('1 de 2 fora do ar')

        await act(async () => { vi.advanceTimersByTime(FAV_CHECK_MSG_MS) })

        expect(botaoVerificar()!.textContent).toContain('Verificar favoritos')
        expect(selos()).toBe(1)
    })
})
