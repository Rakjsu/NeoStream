import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Series } from './Series'
import { VOD } from './VOD'
import { resetStorageJsonCache } from '../services/storageJsonCache'
import { indexedDBCache } from '../services/indexedDBCache'

/**
 * 🧹 (#D050) As grades de Filmes e Séries injetavam, num `<style>` GLOBAL, ~450
 * linhas descrevendo o layout antigo (`.movie-card`, `.series-card`, painel de
 * detalhes, abas de temporada, lista de episódios, `.btn-*`, `.modal-*`, telas
 * de erro com classe) — nada disso é renderizado desde que o card virou o
 * HoverPreviewCard e a ficha virou o ContentDetailModal. Mas o CSS morto não
 * era inofensivo: por vir DEPOIS da folha do card na cascata, ele
 *  - sobrescrevia o próprio card: `.card-info`, `.card-title` e `.card-overlay`
 *    da página ganhavam da `HoverPreviewCard.css` — e cada página com um valor
 *    (o título tinha margem embaixo em Séries e não em Filmes);
 *  - redefinia `@keyframes` dos componentes que a página monta: `cardFadeIn`
 *    (do card) e `pulse` (do player — o "Carregando..." pulsava em ESCALA só na
 *    tela de Séries, em vez de pulsar a opacidade);
 *  - vazava para vizinhos montados junto: os botões `.btn-primary` /
 *    `.btn-secondary` do aviso de atualização, o `.error-icon` e o
 *    `.loading-text` do AsyncVideoPlayer.
 * E a folha do card, por sua vez, estilizava `.card-info`/`.card-title`/
 * `.card-overlay` soltos — nomes que Minha lista e Downloads também usam.
 *
 * Os casos montam a página DE VERDADE (jsdom, só o IPC do preload dublado),
 * carregam as folhas reais do card e do player (lidas do disco) e conferem a
 * cascata pelo `matches`/`getComputedStyle`.
 */

const PERFIL = 'p1'
const TITULOS = ['Titulo 01', 'Titulo 02', 'Titulo 03']

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

type Pagina = 'series' | 'vod'

/** Onde mora cada página e a classe-raiz que identifica o `<style>` dela. */
const PAGINAS: Record<Pagina, { fonte: string; constante: string; raiz: string }> = {
    series: { fonte: 'src/pages/Series.tsx', constante: 'seriesStyles', raiz: '.series-page' },
    vod: { fonte: 'src/pages/VOD.tsx', constante: 'vodStyles', raiz: '.vod-page' },
}

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

/**
 * Um arquivo do projeto, lido do disco. O Vitest esvazia todo `.css` importado
 * e o tsconfig do app não traz os tipos do Node — daí o import dinâmico com o
 * nome montado. O caminho é relativo à raiz do projeto, de onde o Vitest roda.
 */
async function lerArquivo(caminho: string, marca: string): Promise<string> {
    const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':')) as {
        readFileSync: (caminho: string, codificacao: 'utf8') => string
    }
    const texto = fs.readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n')
    if (!texto.includes(marca)) throw new Error(`não achei ${marca} em ${caminho}`)
    return texto
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let folhaDoCard: HTMLStyleElement | null = null
let folhaDoPlayer: HTMLStyleElement | null = null

async function esperar(condicao: () => boolean, oQue: string, limiteMs = 3000) {
    const inicio = Date.now()
    while (!condicao()) {
        if (Date.now() - inicio > limiteMs) throw new Error(`nunca aconteceu: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
}

function cards(): HTMLElement[] {
    return Array.from(container!.querySelectorAll('.hover-preview-card')) as HTMLElement[]
}

async function montar(pagina: Pagina) {
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

async function desmontar() {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
}

/** A folha que a PÁGINA injeta (o `<style>` dentro da árvore dela). */
function folhaDaPagina(pagina: Pagina): CSSStyleSheet {
    const raiz = PAGINAS[pagina].raiz
    const estilo = Array.from(container!.querySelectorAll('style'))
        .find(s => (s.textContent ?? '').includes(raiz))
    if (!estilo?.sheet || estilo.sheet.cssRules.length === 0) {
        throw new Error('a página não injetou a folha dela')
    }
    return estilo.sheet
}

/** Todas as regras de estilo da folha, inclusive as de dentro de `@media`. */
function regrasDeEstilo(folha: CSSStyleSheet): CSSStyleRule[] {
    const saida: CSSStyleRule[] = []
    const visitar = (lista: CSSRuleList) => {
        for (const r of Array.from(lista)) {
            if (r instanceof CSSStyleRule) saida.push(r)
            else if ('cssRules' in r && !(r instanceof CSSKeyframesRule)) visitar((r as CSSGroupingRule).cssRules)
        }
    }
    visitar(folha.cssRules)
    return saida
}

function nomesDeKeyframes(folha: CSSStyleSheet): string[] {
    return Array.from(folha.cssRules)
        .filter(r => r instanceof CSSKeyframesRule)
        .map(r => (r as CSSKeyframesRule).name)
}

/**
 * Os nomes que as regras da folha põem em `animation`/`animation-name`. Vem
 * junto o resto do atalho (`ease`, `infinite`…), o que não atrapalha: o
 * resultado só é usado para perguntar "este @keyframes é usado?".
 */
function palavrasDeAnimacao(folha: CSSStyleSheet): Set<string> {
    const saida = new Set<string>()
    for (const r of regrasDeEstilo(folha)) {
        const valor = `${r.style.getPropertyValue('animation')} ${r.style.getPropertyValue('animation-name')}`
        for (const m of valor.matchAll(/[A-Za-z_][\w-]*/g)) saida.add(m[0])
    }
    return saida
}

/**
 * A regra alcança o elemento em ALGUM estado? `:hover`/`:active`/`:focus` e
 * pseudo-elementos saem do seletor (o jsdom não passa o mouse por cima) — o
 * que sobra diz se aquela regra mira o elemento.
 */
function alcanca(regra: CSSStyleRule, el: Element): boolean {
    return regra.selectorText.split(',').some(parte => {
        const base = parte
            .replace(/::[\w-]+/g, '')
            .replace(/:(hover|active|focus|focus-visible|focus-within|disabled)\b/g, '')
            .trim()
        if (!base) return false
        try { return el.matches(base) } catch { return false }
    })
}

function elementosDosCards(): Element[] {
    return cards().flatMap(c => [c, ...Array.from(c.querySelectorAll('*'))])
}

/**
 * As classes que o JSX da página escreve em `className` — o fonte sem o bloco
 * de CSS. (Os estados de carregando, vazio e aviso Kids não aparecem todos
 * juntos na tela, por isso a conta é feita no fonte, não no DOM montado.)
 */
async function classesDoJsx(pagina: Pagina): Promise<Set<string>> {
    const { fonte, constante } = PAGINAS[pagina]
    const texto = await lerArquivo(fonte, `const ${constante} = \``)
    const inicio = texto.indexOf(`const ${constante} = \``)
    const fim = texto.indexOf('`;', inicio)
    const jsx = texto.slice(0, inicio) + texto.slice(fim)
    const saida = new Set<string>()
    for (const m of jsx.matchAll(/className=("[^"]*"|\{[^}]*\})/g)) {
        for (const literal of m[1].matchAll(/["'`]([^"'`]*)["'`]/g)) {
            for (const c of literal[1].split(/\s+/)) if (c) saida.add(c)
        }
    }
    if (saida.size === 0) throw new Error(`não achei className nenhum em ${fonte}`)
    return saida
}

/** O visual do rodapé e do título do card, pela cascata inteira do documento. */
function visualDoCard() {
    const c = cards()[0]
    const info = c.querySelector('.card-info')!
    const titulo = c.querySelector('.card-title')!
    const capa = c.querySelector('.card-overlay')!
    const ci = getComputedStyle(info)
    const ct = getComputedStyle(titulo)
    const co = getComputedStyle(capa)
    return {
        infoFundo: ci.getPropertyValue('background-image') || ci.getPropertyValue('background'),
        infoPadding: ci.getPropertyValue('padding-top'),
        tituloMargemBaixo: ct.getPropertyValue('margin-bottom'),
        tituloMargemCima: ct.getPropertyValue('margin-top'),
        capaOpacidade: co.getPropertyValue('opacity'),
    }
}

beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    semearLocalStorage()
    dublarIpc()
    vi.spyOn(indexedDBCache, 'getAllCachedMovies').mockResolvedValue(new Map())
    vi.spyOn(indexedDBCache, 'getAllCachedSeries').mockResolvedValue(new Map())
    // O Vitest não injeta CSS importado no jsdom: as folhas reais entram no
    // <head>, como o Vite faz no app — ANTES do <style> que a página injeta.
    folhaDoCard = document.createElement('style')
    folhaDoCard.textContent = await lerArquivo('src/components/HoverPreviewCard.css', '.hover-preview-card')
    document.head.appendChild(folhaDoCard)
    folhaDoPlayer = document.createElement('style')
    folhaDoPlayer.textContent = await lerArquivo('src/components/VideoPlayer/VideoPlayer.css', '.video-player-loading')
    document.head.appendChild(folhaDoPlayer)
})

afterEach(async () => {
    await desmontar()
    folhaDoCard?.remove()
    folhaDoPlayer?.remove()
    folhaDoCard = null
    folhaDoPlayer = null
    document.body.innerHTML = ''
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe.each([
    ['Séries', 'series' as const],
    ['Filmes', 'vod' as const],
])('%s: a folha da página não mexe no que não é dela', (_nome, pagina) => {
    it('nenhuma regra da página alcança o card — o visual dele mora só na HoverPreviewCard.css', async () => {
        await montar(pagina)

        const doCard = elementosDosCards()
        const invasoras = regrasDeEstilo(folhaDaPagina(pagina))
            .filter(r => doCard.some(el => alcanca(r, el)))
            .map(r => r.selectorText)

        expect(invasoras).toEqual([])
    })

    it('a página não redefine @keyframes das folhas do card e do player que ela monta', async () => {
        await montar(pagina)

        const alheios = new Set([
            ...nomesDeKeyframes(folhaDoCard!.sheet!),
            ...nomesDeKeyframes(folhaDoPlayer!.sheet!),
        ])
        const sequestrados = nomesDeKeyframes(folhaDaPagina(pagina)).filter(n => alheios.has(n))

        expect(sequestrados).toEqual([])
    })

    it('a folha da página não vaza para os vizinhos montados junto (aviso de atualização, player)', async () => {
        await montar(pagina)

        // Os nós que o UpdateNotification (sempre montado no App) e o
        // AsyncVideoPlayer (montado pela própria página) renderizam com
        // essas classes — cada um com a sua folha.
        const vizinhos = document.createElement('div')
        vizinhos.innerHTML = [
            '<div class="update-actions"><button class="btn-primary">Instalar</button>',
            '<button class="btn-secondary">Depois</button></div>',
            '<div class="error-screen"><div class="error-icon">!</div></div>',
            '<div class="loading-content"><span class="loading-text">Preparando</span></div>',
        ].join('')
        document.body.appendChild(vizinhos)
        const nos = Array.from(vizinhos.querySelectorAll('*'))

        const vazadas = regrasDeEstilo(folhaDaPagina(pagina))
            .filter(r => nos.some(el => alcanca(r, el)))
            .map(r => r.selectorText)

        expect(vazadas).toEqual([])
    })

    it('a folha da página só carrega o que a página usa: classes do JSX dela e @keyframes que alguém anima', async () => {
        await montar(pagina)
        const folha = folhaDaPagina(pagina)

        const doJsx = await classesDoJsx(pagina)
        const classesSemDono = new Set<string>()
        for (const r of regrasDeEstilo(folha)) {
            for (const m of r.selectorText.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
                if (!doJsx.has(m[1])) classesSemDono.add(m[1])
            }
        }

        // O @keyframes pode ser usado pela própria página ou por quem ela
        // monta (o player usa `fadeIn` sem declará-lo — ver o caso de Séries).
        const animados = new Set([
            ...palavrasDeAnimacao(folha),
            ...palavrasDeAnimacao(folhaDoCard!.sheet!),
            ...palavrasDeAnimacao(folhaDoPlayer!.sheet!),
        ])
        const keyframesSemUso = nomesDeKeyframes(folha).filter(n => !animados.has(n))

        expect([...classesSemDono]).toEqual([])
        expect(keyframesSemUso).toEqual([])
    })
})

describe('Séries: a faxina não leva junto o que os vizinhos usam', () => {
    it('toda animação da folha do player tem @keyframes declarado com a tela de Séries aberta', async () => {
        await montar('series')

        // Os chips do player (.sleep-timer-chip / .live-epg-bar) e o fundo do
        // CategoryMenu animam com `fadeIn` sem declará-lo; em Séries quem o
        // declara é a folha da página. (Em Filmes ele nunca foi declarado —
        // problema anterior e à parte do #D050.)
        const declarados = new Set([
            ...nomesDeKeyframes(folhaDoCard!.sheet!),
            ...nomesDeKeyframes(folhaDoPlayer!.sheet!),
            ...nomesDeKeyframes(folhaDaPagina('series')),
        ])
        const usadosPeloPlayer = regrasDeEstilo(folhaDoPlayer!.sheet!)
            .map(r => r.style.getPropertyValue('animation').trim().split(/\s+/)[0])
            .filter(Boolean)
        const semKeyframes = [...new Set(usadosPeloPlayer)].filter(n => !declarados.has(n))

        expect(usadosPeloPlayer).toContain('fadeIn')
        expect(semKeyframes).toEqual([])
    })
})

describe('Filmes e Séries: o mesmo card, o mesmo visual', () => {
    it('o rodapé e o título do card saem iguais nas duas grades — e iguais ao que Filmes já mostrava', async () => {
        await montar('vod')
        const filmes = visualDoCard()
        await desmontar()

        await montar('series')
        const series = visualDoCard()

        expect(filmes).toEqual(series)
        // O que a grade de Filmes mostrava antes da faxina (vindo da folha da
        // página): o gradiente escuro no rodapé e o título sem margem.
        expect(filmes).toEqual({
            infoFundo: 'linear-gradient(to top, rgba(15, 15, 26, 0.98), rgba(26, 26, 46, 0.9))',
            infoPadding: '14px',
            tituloMargemBaixo: '0px',
            tituloMargemCima: '0px',
            capaOpacidade: '0',
        })
    })
})

describe('HoverPreviewCard.css: as classes genéricas ficam presas ao card', () => {
    it('.card-info/.card-title/.card-overlay de Minha lista e Downloads não pegam a folha do card', () => {
        // O mesmo desenho que Favorites, WatchLater e Downloads renderizam — com
        // as MESMAS classes, cada tela com a sua folha. A folha do card fica no
        // <head> depois que a pessoa passa por Filmes/Séries.
        const outraTela = document.createElement('div')
        outraTela.innerHTML = [
            '<div class="card"><div class="card-poster">',
            '<div class="card-overlay"><div class="play-icon">▶</div></div></div>',
            '<div class="card-info"><h3 class="card-title">Outro</h3></div></div>',
        ].join('')
        document.body.appendChild(outraTela)
        const nos = Array.from(outraTela.querySelectorAll('*'))

        const vazadas = regrasDeEstilo(folhaDoCard!.sheet!)
            .filter(r => nos.some(el => alcanca(r, el)))
            .map(r => r.selectorText)

        expect(vazadas).toEqual([])
    })
})
