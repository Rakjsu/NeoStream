import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Series } from './Series'
import { VOD } from './VOD'
import { resetStorageJsonCache } from '../services/storageJsonCache'
import { parentalService } from '../services/parentalService'
import { indexedDBCache } from '../services/indexedDBCache'

/**
 * 🔒 (#D049) A verificação do controle parental não dava sinal nenhum na tela.
 *
 * Com o controle parental ativo (ou perfil Kids), clicar num card de Filmes ou
 * Séries marca `checkingItem` e vai ao IndexedDB/TMDB antes de abrir a ficha —
 * pode levar uma ida de rede. A página punha `className="checking"` no <div>
 * de FORA do card, mas o CSS exigia `.movie-card.checking` /
 * `.series-card.checking` — classes que nenhum elemento da grade tem desde que
 * o card virou o HoverPreviewCard. Resultado: nem esmaecer, nem girar, nem o
 * `pointer-events: none` que impedia o segundo clique; clicar de novo (ou
 * apertar Enter) durante a verificação disparava OUTRA verificação do mesmo
 * título.
 *
 * Os casos montam a página DE VERDADE (jsdom, só o IPC do preload dublado e a
 * ida ao cache de classificação segurada num adiamento que o teste solta) e
 * carregam a folha de estilo real do card (`HoverPreviewCard.css`, lida do
 * disco), para que o estilo seja conferido pela cascata, não pelo nome da
 * classe:
 *  (a) durante a verificação o card clicado — e só ele — fica marcado
 *      (`aria-busy`), esmaecido, sem receber ponteiro e com o spinner no
 *      pôster;
 *  (b) clicar de novo ou apertar Enter no card durante a verificação NÃO
 *      dispara uma segunda verificação;
 *  (c) quando a verificação libera, a ficha abre e a marca some.
 */

const PERFIL = 'p1'
const TITULOS = ['Titulo 01', 'Titulo 02', 'Titulo 03', 'Titulo 04']

const CATEGORIAS = [{ category_id: '1', category_name: 'Cat Um', parent_id: 0 }]

const SERIES = TITULOS.map((name, i) => ({
    num: i + 1, name, series_id: 1000 + i, stream_icon: '', cover: 'img.example/c.jpg',
    plot: '', cast: '', director: '', genre: '', release_date: '2020-01-01',
    last_modified: '1600000000', rating: '7', rating_5based: 3.5, backdrop_path: [],
    youtube_trailer: '', episode_run_time: '', category_id: '1',
}))

const FILMES = TITULOS.map((name, i) => ({
    num: i + 1, name, stream_type: 'movie', stream_id: 2000 + i, stream_icon: 'img.example/p.jpg',
    container_extension: 'mp4', custom_sid: '', direct_source: '', added: '1600000000',
    category_id: '1', rating: '7', rating_5based: 3.5, backdrop_path: [], youtube_trailer: '',
    episode_run_time: '',
}))

function semearLocalStorage() {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('neostream_active_playlist_id', 'pl1')
    localStorage.setItem('neostream_profiles', JSON.stringify({
        activeProfileId: PERFIL,
        profiles: [{ id: PERFIL, name: 'Dono', avatar: '🙂', isKids: false, createdAt: 1 }],
    }))
    resetStorageJsonCache()
}

/** O preload não existe no jsdom: só as listas e as categorias voltam cheias. */
function dublarIpc() {
    const invoke = vi.fn((canal: string) => {
        if (canal === 'streams:get-series') return Promise.resolve({ success: true, data: SERIES })
        if (canal === 'streams:get-vod') return Promise.resolve({ success: true, data: FILMES })
        if (canal === 'categories:get-series' || canal === 'categories:get-vod') {
            return Promise.resolve({ success: true, data: CATEGORIAS })
        }
        return Promise.resolve({ success: true, data: [] })
    })
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke, send: vi.fn(), on: vi.fn(), off: vi.fn(),
    }
}

type ItemDoCache = { name: string; certification: string | null; genres: string[]; cachedAt: number }

/**
 * A ida ao cache de classificação é o primeiro `await` da verificação: segurá-la
 * deixa a verificação "em andamento" pelo tempo que o teste quiser.
 */
function segurarCacheDeClassificacao() {
    const pendentes: Array<(v: ItemDoCache | null) => void> = []
    const segurar = () => new Promise<ItemDoCache | null>(resolve => { pendentes.push(resolve) })
    const filme = vi.spyOn(indexedDBCache, 'getCachedMovie').mockImplementation(segurar)
    const serie = vi.spyOn(indexedDBCache, 'getCachedSeries').mockImplementation(segurar)
    vi.spyOn(indexedDBCache, 'getAllCachedMovies').mockResolvedValue(new Map())
    vi.spyOn(indexedDBCache, 'getAllCachedSeries').mockResolvedValue(new Map())
    return {
        chamadas: () => filme.mock.calls.length + serie.mock.calls.length,
        /** Solta todas as verificações seguradas com uma classificação livre. */
        liberar: () => {
            for (const r of pendentes.splice(0)) {
                r({ name: 'x', certification: 'L', genres: [], cachedAt: Date.now() })
            }
        },
    }
}

/**
 * A folha real do card, lida do disco. O Vitest esvazia todo `.css` importado
 * (até com `?raw`/`?inline`) e o tsconfig do app não traz os tipos do Node —
 * daí o import dinâmico com o nome montado. O caminho é relativo à raiz do
 * projeto, de onde o Vitest roda.
 */
async function lerCssDoCard(): Promise<string> {
    const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':')) as {
        readFileSync: (caminho: string, codificacao: 'utf8') => string
    }
    const css = fs.readFileSync('src/components/HoverPreviewCard.css', 'utf8')
    if (!css.includes('.hover-preview-card')) throw new Error('não achei a folha do HoverPreviewCard')
    return css
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let folhaDoCard: HTMLStyleElement | null = null

async function esperar(condicao: () => boolean, oQue: string, limiteMs = 3000) {
    const inicio = Date.now()
    while (!condicao()) {
        if (Date.now() - inicio > limiteMs) throw new Error(`nunca aconteceu: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
}

/** Barreira de macrotarefa: o que já estava enfileirado roda antes de afirmar um negativo. */
async function esvaziarFilas() {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

function cards(): HTMLElement[] {
    return Array.from(container!.querySelectorAll('.hover-preview-card')) as HTMLElement[]
}

function card(titulo: string): HTMLElement {
    const alvo = cards().find(c => c.getAttribute('aria-label') === titulo)
    if (!alvo) throw new Error(`nenhum card "${titulo}" na grade`)
    return alvo
}

/** A ficha (ContentDetailModal) aberta, e de qual título. */
function fichaAberta(): string | null {
    const ficha = document.querySelector('[data-overlay="modal"]')
    if (!ficha) return null
    return TITULOS.find(t => (ficha.textContent ?? '').includes(t)) ?? '(ficha sem título conhecido)'
}

function emVerificacao(el: HTMLElement): boolean {
    return el.getAttribute('aria-busy') === 'true'
}

/**
 * O jsdom não calcula estilo de pseudo-elemento, então o spinner é conferido
 * pela folha carregada: uma regra `::after` que casa com o pôster DESTE card
 * (via `matches`, não pelo texto do seletor) e gira com um `@keyframes` que
 * existe na mesma folha.
 */
function spinnerNoPoster(el: HTMLElement): boolean {
    const poster = el.querySelector('.preview-poster')
    const regras = Array.from(folhaDoCard!.sheet!.cssRules)
    const quadros = new Set(regras.filter(r => r instanceof CSSKeyframesRule).map(r => (r as CSSKeyframesRule).name))
    return !!poster && regras.some(r => {
        if (!(r instanceof CSSStyleRule) || !r.selectorText.endsWith('::after')) return false
        const base = r.selectorText.slice(0, -'::after'.length)
        const giro = r.style.getPropertyValue('animation').trim().split(/\s+/)[0]
        return poster.matches(base) && r.style.getPropertyValue('content') !== '' && quadros.has(giro)
    })
}

async function montar(pagina: 'series' | 'vod') {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(
            <MemoryRouter>
                {pagina === 'series' ? <Series /> : <VOD />}
            </MemoryRouter>
        )
    })
    await esperar(() => cards().length === TITULOS.length, 'a grade aparecer')
}

beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    semearLocalStorage()
    dublarIpc()
    // Controle parental ligado e sessão NÃO destravada: todo clique verifica.
    parentalService.setConfig({ enabled: true, maxRating: '18', blockAdultCategories: false })
    // O Vitest não injeta CSS importado no jsdom: a folha real do card entra
    // aqui para que o getComputedStyle enxergue a cascata de verdade.
    folhaDoCard = document.createElement('style')
    folhaDoCard.textContent = await lerCssDoCard()
    document.head.appendChild(folhaDoCard)
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    folhaDoCard?.remove()
    root = null
    container = null
    folhaDoCard = null
    document.body.innerHTML = ''
    parentalService.setConfig({ enabled: false })
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe.each([
    ['Séries', 'series' as const],
    ['Filmes', 'vod' as const],
])('%s: a verificação do controle parental aparece no card', (_nome, pagina) => {
    it('(a) durante a verificação o card clicado — e só ele — fica marcado, esmaecido, sem ponteiro e girando', async () => {
        const cache = segurarCacheDeClassificacao()
        await montar(pagina)

        await act(async () => { card('Titulo 03').click() })
        await esperar(() => cache.chamadas() === 1, 'a verificação começar')
        await esvaziarFilas()

        const alvo = card('Titulo 03')
        expect(emVerificacao(alvo)).toBe(true)
        expect(alvo.classList.contains('checking')).toBe(true)
        const estilo = getComputedStyle(alvo)
        expect(estilo.pointerEvents).toBe('none')
        expect(estilo.opacity).toBe('0.6')
        expect(spinnerNoPoster(alvo)).toBe(true)

        const vizinho = card('Titulo 02')
        expect(emVerificacao(vizinho)).toBe(false)
        expect(getComputedStyle(vizinho).pointerEvents).not.toBe('none')
        expect(getComputedStyle(vizinho).opacity).not.toBe('0.6')
        expect(spinnerNoPoster(vizinho)).toBe(false)
        expect(fichaAberta()).toBe(null)

        await act(async () => { cache.liberar() })
    })

    it('(b) clicar de novo ou apertar Enter durante a verificação NÃO dispara outra verificação', async () => {
        const cache = segurarCacheDeClassificacao()
        await montar(pagina)

        await act(async () => { card('Titulo 03').click() })
        await esperar(() => emVerificacao(card('Titulo 03')), 'o card entrar em verificação')

        await act(async () => { card('Titulo 03').click() })
        await act(async () => {
            card('Titulo 03').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })
        await esvaziarFilas()

        expect(cache.chamadas()).toBe(1)

        await act(async () => { cache.liberar() })
    })

    it('(c) quando a verificação libera, a ficha abre e a marca some do card', async () => {
        const cache = segurarCacheDeClassificacao()
        await montar(pagina)

        await act(async () => { card('Titulo 03').click() })
        await esperar(() => emVerificacao(card('Titulo 03')), 'o card entrar em verificação')

        await act(async () => { cache.liberar() })
        await esperar(() => fichaAberta() === 'Titulo 03', 'a ficha abrir depois de liberada')
        await esperar(() => !emVerificacao(card('Titulo 03')), 'a marca de verificação sair do card')

        expect(card('Titulo 03').classList.contains('checking')).toBe(false)
        expect(getComputedStyle(card('Titulo 03')).pointerEvents).not.toBe('none')
        expect(spinnerNoPoster(card('Titulo 03'))).toBe(false)
    })
})
