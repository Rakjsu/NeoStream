import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Series } from './Series'
import { VOD } from './VOD'
import { resetStorageJsonCache } from '../services/storageJsonCache'
import { GLOBAL_SEARCH_TERM_KEY, GLOBAL_SEARCH_OPEN_KEY, GLOBAL_SEARCH_EVENT } from '../components/GlobalSearch'

/**
 * 🪟 Redimensionar a janela fechava a ficha aberta (Filmes e Séries).
 *
 * As duas páginas tinham um efeito "Reset on filter change" com deps
 * `[searchQuery, selectedCategory, itemsPerPage]` que fazia
 * `setSelected(null)` + scroll ao topo. `itemsPerPage` NÃO é filtro: sai do
 * `calculateGrid()`, que roda na montagem, de novo 200 ms depois e a cada
 * `resize`. Maximizar a janela com a ficha aberta a fechava; clicar numa série
 * logo ao entrar (antes dos 200 ms) abria e fechava a ficha — o e2e
 * `modal.spec.ts > série: setas do teclado...` piscava por isso.
 *
 * Os casos montam a página DE VERDADE (jsdom, localStorage real, só o IPC do
 * preload dublado) e provam as pontas:
 *  (a) o recálculo da grade (resize) com a ficha aberta NÃO a fecha nem
 *      rola a grade de volta ao topo;
 *  (b) mudar a busca AINDA fecha e volta ao topo — senão o conserto seria só
 *      apagar o reset;
 *  (c) a busca global que grava termo + ficha juntos, com a lista já na tela,
 *      abre a ficha e ela fica (o reset do termo não pode engolir a abertura);
 *  (d) a ficha pedida de outra página (antes da montagem) abre e sobrevive;
 *  (e) trocar de CATEGORIA continua fechando a ficha e voltando ao topo.
 */

const PERFIL = 'p1'

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

/** 30 itens: mais que qualquer "página" da grade nos dois tamanhos de janela. */
const TITULOS = Array.from({ length: 30 }, (_, i) => `Titulo ${String(i + 1).padStart(2, '0')}`)

/** Os 5 últimos ("Titulo 26".."Titulo 30") ficam na categoria "Cat Dois". */
const categoriaDo = (i: number) => (i >= 25 ? '2' : '1')
const DA_CAT_DOIS = TITULOS.slice(25)

const CATEGORIAS = [
    { category_id: '1', category_name: 'Cat Um', parent_id: 0 },
    { category_id: '2', category_name: 'Cat Dois', parent_id: 0 },
]

const SERIES = TITULOS.map((name, i) => ({
    num: i + 1, name, series_id: 1000 + i, stream_icon: '', cover: 'img.example/c.jpg',
    plot: '', cast: '', director: '', genre: '', release_date: '2020-01-01',
    last_modified: '1600000000', rating: '7', rating_5based: 3.5, backdrop_path: [],
    youtube_trailer: '', episode_run_time: '', category_id: categoriaDo(i),
}))

const FILMES = TITULOS.map((name, i) => ({
    num: i + 1, name, stream_type: 'movie', stream_id: 2000 + i, stream_icon: 'img.example/p.jpg',
    container_extension: 'mp4', custom_sid: '', direct_source: '', added: '1600000000',
    category_id: categoriaDo(i), rating: '7', rating_5based: 3.5, backdrop_path: [], youtube_trailer: '',
    episode_run_time: '',
}))

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

function tamanhoDaJanela(largura: number, altura: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: largura })
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: altura })
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function esperar(condicao: () => boolean, oQue: string, limiteMs = 3000) {
    const inicio = Date.now()
    while (!condicao()) {
        if (Date.now() - inicio > limiteMs) throw new Error(`nunca aconteceu: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
}

/**
 * Barreira de macrotarefa: tudo que já estava na fila de microtarefas (o
 * `queueMicrotask` do reset) e o render que ele agenda rodam antes dela.
 * É o que dá pra afirmar o NEGATIVO ("a ficha não fechou") sem contar ticks.
 */
async function esvaziarFilas() {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

function cards(): HTMLElement[] {
    return Array.from(container!.querySelectorAll('.hover-preview-card')) as HTMLElement[]
}

function rotulos(): string[] {
    return cards().map(c => c.getAttribute('aria-label') ?? '')
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
    const titulo = TITULOS.find(t => (ficha.textContent ?? '').includes(t))
    return titulo ?? '(ficha sem título conhecido)'
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
    await esperar(() => cards().length > 0, 'a grade aparecer')
}

async function abrirFichaPeloCard(titulo: string) {
    await act(async () => { card(titulo).click() })
    await esperar(() => fichaAberta() === titulo, `a ficha de "${titulo}" abrir`)
}

async function redimensionar(largura: number, altura: number) {
    tamanhoDaJanela(largura, altura)
    await act(async () => { window.dispatchEvent(new Event('resize')) })
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

/**
 * O contêiner que rola a grade (o `scrollContainerRef` da página). O jsdom não
 * tem layout, mas guarda o `scrollTop` que se escreve — basta pra ver se a
 * página mandou a grade de volta ao topo.
 */
function rolagem(): HTMLElement {
    const el = container!.querySelector('.series-scroll-container, .movies-scroll-container') as HTMLElement | null
    if (!el) throw new Error('a página não tem o contêiner de rolagem da grade')
    return el
}

async function trocarDeCategoria(nome: string) {
    const botaoDoMenu = container!.querySelector('button.toggle-btn') as HTMLButtonElement | null
    if (!botaoDoMenu) throw new Error('a página não tem o botão do menu de categorias')
    await act(async () => { botaoDoMenu.click() })
    const itemDoMenu = () => Array.from(container!.querySelectorAll('button.category-item'))
        .find(b => (b.textContent ?? '').includes(nome)) as HTMLButtonElement | undefined
    await esperar(() => itemDoMenu() !== undefined, `a categoria "${nome}" aparecer no menu`)
    await act(async () => { itemDoMenu()!.click() })
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // O jsdom não tem ResizeObserver (a grade janelada observa o próprio
    // tamanho); sem layout, ela fica no modo "sem janela" e mostra
    // `visibleCount` cards — que é justamente o que o recálculo mexe.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    semearLocalStorage()
    dublarIpc()
    // Janela "grande": 4 colunas x 5 linhas = 20 cards na primeira página.
    tamanhoDaJanela(1024, 768)
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    document.body.innerHTML = ''
    tamanhoDaJanela(1024, 768)
    vi.unstubAllGlobals()
})

describe.each([
    ['Séries', 'series' as const],
    ['Filmes', 'vod' as const],
])('%s: a ficha aberta e o recálculo da grade', (_nome, pagina) => {
    it('(a) redimensionar/maximizar a janela reajusta a grade e NÃO fecha a ficha nem volta ao topo', async () => {
        await montar(pagina)
        const antes = cards().length
        await abrirFichaPeloCard('Titulo 03')
        rolagem().scrollTop = 480

        // Janela "pequena": 2 colunas x 4 linhas = 8 cards. A contagem
        // mudando é a prova de que o calculateGrid rodou de verdade.
        await redimensionar(400, 300)
        await esperar(() => cards().length !== antes, 'a grade recalcular após o resize')
        await esvaziarFilas()

        expect(fichaAberta()).toBe('Titulo 03')
        expect(rolagem().scrollTop).toBe(480)
    })

    it('(b) mudar a busca AINDA fecha a ficha e volta a grade ao topo', async () => {
        await montar(pagina)
        await abrirFichaPeloCard('Titulo 03')
        rolagem().scrollTop = 480

        // A busca casa por token no nome achatado: "Titulo17" só casa um item.
        await digitarNaBusca('Titulo17')
        await esperar(() => fichaAberta() === null, 'a ficha fechar com a busca nova')
        // E a busca filtrou de fato (não foi outra coisa que fechou a ficha).
        await esperar(() => rotulos().join('|') === 'Titulo 17', 'a grade filtrar pela busca')
        expect(rolagem().scrollTop).toBe(0)
    })

    it('(e) trocar de categoria AINDA fecha a ficha e volta a grade ao topo', async () => {
        await montar(pagina)
        await abrirFichaPeloCard('Titulo 03')
        rolagem().scrollTop = 480

        await trocarDeCategoria('Cat Dois')
        await esperar(() => fichaAberta() === null, 'a ficha fechar com a categoria nova')
        // A categoria filtrou de fato (não foi outra coisa que fechou a ficha).
        await esperar(() => rotulos().join('|') === DA_CAT_DOIS.join('|'), 'a grade filtrar pela categoria')
        expect(rolagem().scrollTop).toBe(0)
    })

    it('(c) busca global com termo + ficha, com a lista já na tela, abre a ficha e ela fica', async () => {
        await montar(pagina)

        sessionStorage.setItem(GLOBAL_SEARCH_TERM_KEY, 'Titulo22')
        sessionStorage.setItem(GLOBAL_SEARCH_OPEN_KEY, JSON.stringify({
            kind: pagina === 'series' ? 'series' : 'vod',
            id: pagina === 'series' ? 1000 + 21 : 2000 + 21, // "Titulo 22"
        }))
        await act(async () => { window.dispatchEvent(new Event(GLOBAL_SEARCH_EVENT)) })
        await esperar(() => sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY) === null, 'a página consumir o pedido')
        await esperar(() => rotulos().join('|') === 'Titulo 22', 'a grade filtrar pelo termo da busca global')
        await esvaziarFilas()

        expect(fichaAberta()).toBe('Titulo 22')
    })

    it('(f) sair da página antes do recálculo dos 200 ms não deixa o timer rodar depois', async () => {
        // O setTimeout(calculateGrid, 200) sem clearTimeout rodava com a página
        // já desmontada — e, no fim de um teste, com o jsdom já desfeito
        // ("window is not defined" derrubou a CI da main no Linux).
        let desmontada = false
        let leiturasDepois = 0
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            get: () => { if (desmontada) leiturasDepois++; return 1024 },
        })
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
        await act(async () => { root!.unmount() })
        root = null
        desmontada = true

        await new Promise(resolve => setTimeout(resolve, 300))

        expect(leiturasDepois).toBe(0)
    })

    it('(d) ficha pedida de outra página (antes de montar) abre na montagem e sobrevive ao resize', async () => {
        sessionStorage.setItem(GLOBAL_SEARCH_TERM_KEY, 'Titulo22')
        sessionStorage.setItem(GLOBAL_SEARCH_OPEN_KEY, JSON.stringify({
            kind: pagina === 'series' ? 'series' : 'vod',
            id: pagina === 'series' ? 1000 + 21 : 2000 + 21,
        }))
        await montar(pagina)
        await esperar(() => fichaAberta() === 'Titulo 22', 'a ficha pedida de fora abrir')

        await redimensionar(1920, 1080)
        await esvaziarFilas()

        expect(fichaAberta()).toBe('Titulo 22')
    })
})
