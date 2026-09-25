import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { isContentGateOff } from '../src/services/contentGate'

/**
 * 🖱️ Clique num pôster da Home: sem restrição nenhuma, abre NA HORA (#D173).
 *
 * O `handleContentClick` da Home esperava `getCachedMovie` e, no cache frio,
 * uma busca por nome na TMDB ANTES de abrir o modal — mesmo num perfil adulto
 * com parental desligado, onde o veredito não decide nada (só o ramo infantil
 * o usa). Com a chave TMDB vazia (o padrão desde a R45) a espera não servia
 * pra nada de ponta a ponta. O desenho certo é o do `handleItemClick` de
 * `useContentFiltering`: portão desligado (a regra `isContentGateOff` do
 * contentGate, a mesma que poupa a Home de carregar o portão) abre e aquece a
 * classificação em segundo plano, sem await.
 *
 * Montar a Home sai mais caro que o conserto (~2200 linhas, react-router, uma
 * dúzia de canais IPC, IndexedDB) — ver `electron/portaoDaHome.test.ts`. Então,
 * como lá, a função é RECORTADA do fonte, transpilada e EXECUTADA com
 * dependências falsas: o teste mede o que o clique faz, não o texto que ele
 * tem. A regra do portão entra a VERDADEIRA (`isContentGateOff`), não uma
 * cópia. Se a lógica sair da Home para um helper, o recorte falha dizendo
 * "não achei ... em Home.tsx" e o teste vira teste de unidade do helper.
 */
const HOME = path.join(__dirname, '..', 'src', 'pages', 'Home.tsx')
const fonte = fs.readFileSync(HOME, 'utf-8').replace(/\r\n/g, '\n')

/** Recorta `async (...) => { ... }` do handleContentClick, chaves balanceadas. */
function recortarClique(): string {
    const marca = 'const handleContentClick = '
    const ini = fonte.indexOf(marca)
    expect(ini, 'não achei `const handleContentClick = ` em Home.tsx').toBeGreaterThan(-1)
    const inicioExpr = ini + marca.length
    const abre = fonte.indexOf('=> {', inicioExpr)
    expect(abre, 'não achei o corpo do handleContentClick').toBeGreaterThan(-1)
    let i = abre + 3
    let nivel = 0
    for (; i < fonte.length; i++) {
        if (fonte[i] === '{') nivel++
        else if (fonte[i] === '}') {
            nivel--
            if (nivel === 0) break
        }
    }
    expect(i, 'as chaves do handleContentClick não fecharam').toBeLessThan(fonte.length)
    return fonte.slice(inicioExpr, i + 1)
}

const DEPENDENCIAS = [
    'isKidsProfile', 'hiddenItems', 'setBlockMessage', 't', 'indexedDBCache', 'normalizeContentName',
    'isKidsFriendly', 'searchMovieByName', 'searchSeriesByName', 'setHiddenItems', 'setSelectedContent',
    'parentalService', 'isContentGateOff', 'infantilPodeAbrir', 'console',
] as const

const codigoDoClique = ts.transpileModule(`const __clique = ${recortarClique()};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText

type Clique = (id: string, tipo: 'movie' | 'series', nome: string, capa: string, nota?: string) => Promise<void>

function adiado<T>() {
    let resolver!: (v: T) => void
    const promessa = new Promise<T>(res => { resolver = res })
    return { promessa, resolver }
}

interface Cenario {
    kids?: boolean
    parentalLigado?: boolean
    sessaoLiberada?: boolean
    /** Classificação já em cache, por `tipo:nome` — filme e série são tabelas diferentes. */
    cache?: Record<string, string>
    tmdb?: (nome: string) => Promise<unknown>
}

function montar(c: Cenario = {}) {
    const doCache = (tipo: string) => async (nome: string) => {
        const cert = c.cache?.[`${tipo}:${nome}`]
        return cert ? { certification: cert } : null
    }
    const deps = {
        isKidsProfile: c.kids ?? false,
        hiddenItems: new Set<string>(),
        setBlockMessage: vi.fn(),
        t: (_ns: string, chave: string) => chave,
        indexedDBCache: {
            isItemHidden: vi.fn(async () => false),
            getCachedMovie: vi.fn(doCache('movie')),
            getCachedSeries: vi.fn(doCache('series')),
            setCacheMovie: vi.fn(async () => {}),
            setCacheSeries: vi.fn(async () => {}),
            hideItem: vi.fn(async () => {}),
        },
        normalizeContentName: (s: string) => s.toLowerCase(),
        // Só "L" é livre neste teste: basta para separar o que passa do que não.
        isKidsFriendly: (cert: string | null) => cert === 'L',
        searchMovieByName: vi.fn(c.tmdb ?? (async () => null)),
        searchSeriesByName: vi.fn(c.tmdb ?? (async () => null)),
        setHiddenItems: vi.fn(),
        setSelectedContent: vi.fn(),
        parentalService: {
            getConfig: () => ({ enabled: c.parentalLigado ?? false, blockAdultCategories: false }),
            isSessionUnlocked: () => c.sessaoLiberada ?? false,
        },
        isContentGateOff,
        // Regra do infantil (D115): livre OU liberado pelo responsável. Aqui
        // nada foi liberado, então vale o mesmo corte do isKidsFriendly.
        infantilPodeAbrir: async (_tipo: string, _nome: string, cert: string | null) => cert === 'L',
        console: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
    }
    const fabricar = new Function(...DEPENDENCIAS, `${codigoDoClique}\nreturn __clique;`)
    const clique = fabricar(...DEPENDENCIAS.map(nome => deps[nome])) as Clique
    return { deps, clique }
}

describe('clique num card da Home (#D173)', () => {
    it('adulto sem parental: abre antes da TMDB responder e o clique não fica pendurado nela', async () => {
        const tmdb = adiado<unknown>()
        const { deps, clique } = montar({ tmdb: () => tmdb.promessa })

        let terminou = false
        void clique('10', 'movie', 'Filme X', 'capa.jpg', '7.1').then(() => { terminou = true })

        // A TMDB NUNCA respondeu até aqui: se abriu, abriu sem esperar por ela.
        await vi.waitFor(() => expect(deps.setSelectedContent).toHaveBeenCalledWith(
            { id: '10', type: 'movie', name: 'Filme X', cover: 'capa.jpg', rating: '7.1' }))
        await vi.waitFor(() => expect(terminou).toBe(true))

        // O aquecimento continua valendo para os outros perfis: a busca sai em
        // segundo plano e o que a TMDB disser fica gravado (e o título
        // não-infantil, escondido) — como no useContentFiltering.
        await vi.waitFor(() => expect(deps.searchMovieByName).toHaveBeenCalledWith('Filme X'))
        tmdb.resolver({ certification: '16', genres: [{ id: 1, name: 'Ação' }] })
        await vi.waitFor(() => expect(deps.indexedDBCache.hideItem).toHaveBeenCalledWith('movie', 'Filme X'))
        expect(deps.indexedDBCache.setCacheMovie).toHaveBeenCalledWith('Filme X', '16', ['Ação'])
        expect(deps.setSelectedContent).toHaveBeenCalledTimes(1)
        expect(deps.setBlockMessage).not.toHaveBeenCalled()
    })

    it('série no mesmo caso: abre na hora e aquece pela busca de séries', async () => {
        const tmdb = adiado<unknown>()
        const { deps, clique } = montar({ tmdb: () => tmdb.promessa })

        void clique('77', 'series', 'Série Y', 'c.jpg')
        await vi.waitFor(() => expect(deps.setSelectedContent).toHaveBeenCalledTimes(1))
        await vi.waitFor(() => expect(deps.searchSeriesByName).toHaveBeenCalledWith('Série Y'))
        expect(deps.searchMovieByName).not.toHaveBeenCalled()
        tmdb.resolver({ certification: 'L', genres: [] })
        await vi.waitFor(() => expect(deps.indexedDBCache.setCacheSeries).toHaveBeenCalledWith('Série Y', 'L', []))
        expect(deps.indexedDBCache.hideItem).not.toHaveBeenCalled()
    })

    it('aquecimento que falha em segundo plano não vira rejeição solta nem fecha o modal', async () => {
        const { deps, clique } = montar({ tmdb: async () => { throw new Error('TMDB fora') } })

        await clique('10', 'movie', 'Filme X', 'capa.jpg')
        expect(deps.setSelectedContent).toHaveBeenCalledTimes(1)
        // A condição de "tratado": a falha foi registrada por quem a pegou.
        await vi.waitFor(() => expect(
            deps.console.warn.mock.calls.length + deps.console.error.mock.calls.length,
        ).toBeGreaterThan(0))
        expect(deps.setSelectedContent).toHaveBeenCalledTimes(1)
    })

    it('com cache quente não vai à TMDB — e lê a tabela do tipo certo', async () => {
        const { deps, clique } = montar({
            cache: { 'movie:Filme X': '12', 'series:Série Y': '14' },
            tmdb: async () => null,
        })

        await clique('10', 'movie', 'Filme X', 'capa.jpg')
        await clique('77', 'series', 'Série Y', 'c.jpg')
        // Um terceiro clique, frio, é o SINAL de que os aquecimentos anteriores
        // já passaram do ponto em que iriam à TMDB: os três seguem o mesmo
        // caminho de promessas e rodam em ordem de chegada.
        await clique('11', 'movie', 'Filme Frio', 'f.jpg')
        await vi.waitFor(() => expect(deps.searchMovieByName).toHaveBeenCalledWith('Filme Frio'))

        expect(deps.setSelectedContent).toHaveBeenCalledTimes(3)
        expect(deps.searchMovieByName).toHaveBeenCalledTimes(1)
        expect(deps.searchSeriesByName).not.toHaveBeenCalled()
        expect(deps.indexedDBCache.getCachedSeries).toHaveBeenCalledWith('Série Y')
    })

    it('perfil infantil continua ESPERANDO o veredito e barra o que não é livre', async () => {
        const tmdb = adiado<unknown>()
        const { deps, clique } = montar({ kids: true, tmdb: () => tmdb.promessa })

        const fim = clique('10', 'movie', 'Filme X', 'capa.jpg')
        await vi.waitFor(() => expect(deps.searchMovieByName).toHaveBeenCalledWith('Filme X'))
        expect(deps.setSelectedContent).not.toHaveBeenCalled()

        tmdb.resolver({ certification: '16', genres: [] })
        await fim
        expect(deps.setSelectedContent).not.toHaveBeenCalled()
        expect(deps.setBlockMessage).toHaveBeenCalledWith('"Filme X" notSuitableForKids')
        expect(deps.indexedDBCache.hideItem).toHaveBeenCalledWith('movie', 'Filme X')
        expect(deps.indexedDBCache.setCacheMovie).toHaveBeenCalledWith('Filme X', '16', [])
    })

    it('perfil infantil abre depois do veredito quando o título é livre', async () => {
        const tmdb = adiado<unknown>()
        const { deps, clique } = montar({ kids: true, tmdb: () => tmdb.promessa })

        const fim = clique('10', 'movie', 'Filme X', 'capa.jpg')
        await vi.waitFor(() => expect(deps.searchMovieByName).toHaveBeenCalled())
        expect(deps.setSelectedContent).not.toHaveBeenCalled()
        tmdb.resolver({ certification: 'L', genres: [] })
        await fim
        expect(deps.setSelectedContent).toHaveBeenCalledTimes(1)
        expect(deps.setBlockMessage).not.toHaveBeenCalled()
        expect(deps.indexedDBCache.hideItem).not.toHaveBeenCalled()
    })

    it('parental valendo num perfil adulto mantém o caminho que decide antes de abrir', async () => {
        const tmdb = adiado<unknown>()
        const { deps, clique } = montar({ parentalLigado: true, tmdb: () => tmdb.promessa })

        const fim = clique('10', 'movie', 'Filme X', 'capa.jpg')
        await vi.waitFor(() => expect(deps.searchMovieByName).toHaveBeenCalled())
        expect(deps.setSelectedContent).not.toHaveBeenCalled()
        tmdb.resolver(null)
        await fim
        expect(deps.setSelectedContent).toHaveBeenCalledTimes(1)
    })

    it('parental ligado mas com a sessão liberada pelo PIN conta como sem restrição', async () => {
        const tmdb = adiado<unknown>()
        const { deps, clique } = montar({ parentalLigado: true, sessaoLiberada: true, tmdb: () => tmdb.promessa })

        void clique('10', 'movie', 'Filme X', 'capa.jpg')
        await vi.waitFor(() => expect(deps.setSelectedContent).toHaveBeenCalledTimes(1))
        tmdb.resolver(null)
    })
})
