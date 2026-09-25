import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { LiveTV } from './LiveTV'
import { ChannelZapOverlay, type PlayerChannel } from '../components/VideoPlayer/ChannelZapOverlay'
import { ChannelHoverMiniGuide } from '../components/ChannelHoverMiniGuide'
import { FAV_CHECK_LIMIT, favCheckMessage, favCheckFailedMessage } from '../hooks/useFavoritesHealthCheck'
import { resetStorageJsonCache } from '../services/storageJsonCache'
import { favoritesService } from '../services/favoritesService'
import { languageService } from '../services/languageService'
import { epgService } from '../services/epgService'
import en from '../locales/ui/en.json'
import es from '../locales/ui/es.json'
import pt from '../locales/ui/pt.json'

/**
 * 🔤 (#D025) A TV ao vivo, o overlay de zapping do player e o mini-guia do
 * hover tinham textos em português cravados no JSX: quem usa o app em inglês
 * ou espanhol via "🔲 Multi-view: assista até 4 canais…", "🩺 Verificar
 * favoritos", "⚠ FORA DO AR", "Nenhum canal encontrado", "📺 Canais",
 * "Buscar canal ou número...", "● AO VIVO", "Carregando guia…" — e o
 * resultado da sonda dos favoritos ("⚠ 1 de 2 fora do ar") também.
 *
 * Os casos montam os três componentes DE VERDADE com o app em INGLÊS e leem o
 * que foi pra tela (texto, `title` e `placeholder`). Os textos esperados vêm
 * do en.json — nada de string repetida aqui. Onde o inglês coincide com o
 * português ("Multi-view") o caso roda em espanhol; e o overlay e o mini-guia
 * também precisam acompanhar a troca de idioma com a tela já aberta.
 */

/** Chave do en.json que o conserto precisa ter (falha legível se faltar). */
function textoEn(secao: string, chave: string): string {
    const valor = (en as unknown as Record<string, Record<string, string>>)[secao]?.[chave]
    if (!valor) throw new Error(`falta a chave en.${secao}.${chave}`)
    return valor
}

/** Pedaços do português que existiam cravados — nenhum pode vazar em inglês. */
const PORTUGUES_CRAVADO = [
    'assista até 4 canais',
    'Sonda os favoritos',
    'Verificar favoritos',
    'Verificando',
    'Agrupar variantes',
    'Nenhum canal encontrado',
    'Tente buscar',
    'FORA DO AR',
    'fora do ar',
    'no ar',
    'sonda falhou',
    'verificados',
    'perfis infantis',
    'Só favoritos',
    'Buscar canal ou número',
    'Recentes',
    'AO VIVO',
    'Carregando guia',
    'Sem programação',
    'Agora',
]

/** Todo texto visível + `title`/`placeholder`/`aria-label` do que foi montado. */
function tudoQueAparece(raiz: HTMLElement): string {
    const atributos = Array.from(raiz.querySelectorAll('[title],[placeholder],[aria-label]'))
        .flatMap(el => ['title', 'placeholder', 'aria-label'].map(a => el.getAttribute(a) ?? ''))
    return [raiz.textContent ?? '', ...atributos].join('\n')
}

function vazamentos(raiz: HTMLElement): string[] {
    const tela = tudoQueAparece(raiz)
    return PORTUGUES_CRAVADO.filter(pt => tela.includes(pt))
}

/** en.json entra por import dinâmico: trocar o idioma não é síncrono. */
async function idiomaIngles() {
    languageService.setLanguage('en')
    await vi.waitFor(() => {
        expect(languageService.t('liveTV', 'watchNow')).toBe(en.liveTV.watchNow)
    })
}

/**
 * Espera a CONDIÇÃO, com teto de tempo real — nunca um número fixo de voltas
 * (IPC, timers e o import do en.json não assentam em microtask).
 */
async function esperar(condicao: () => boolean, oQue: string, limiteMs = 3000) {
    const inicio = Date.now()
    while (!condicao()) {
        if (Date.now() - inicio > limiteMs) throw new Error(`nunca aconteceu: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
}

/** Digita num input controlado do React (setter nativo + evento input). */
async function digitar(input: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(input, valor)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montar(no: React.ReactNode) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root!.render(no) })
    return container
}

beforeAll(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await idiomaIngles()
})

afterAll(() => {
    languageService.setLanguage('pt')
})

beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    await idiomaIngles()
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    document.body.innerHTML = ''
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

// ─── TV ao vivo (a página) ──────────────────────────────────────────────────

const PERFIL = 'p1'

const CANAIS = [1, 2, 3].map(i => ({
    num: i, name: `Canal Teste ${i}`, stream_type: 'live', stream_id: i, stream_icon: '',
    epg_channel_id: '', added: '1600000000', category_id: '1', custom_sid: '',
    tv_archive: 0, direct_source: '', tv_archive_duration: 0,
}))

/** O menu de categorias também está em inglês: o rótulo vem do en.json. */
const FAVORITOS = [en.categories.favoriteChannels]

function semearTv() {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('neostream_active_playlist_id', 'pl1')
    // Um perfil infantil existe (o botão 🧒 dos cards só aparece assim), mas
    // quem está usando é o dono.
    localStorage.setItem('neostream_profiles', JSON.stringify({
        activeProfileId: PERFIL,
        profiles: [
            { id: PERFIL, name: 'Dono', avatar: '🙂', isKids: false, createdAt: 1 },
            { id: 'k1', name: 'Kid', avatar: '🧒', isKids: true, createdAt: 2 },
        ],
    }))
    resetStorageJsonCache()
    for (const c of CANAIS.slice(0, 2)) {
        favoritesService.add({ id: String(c.stream_id), type: 'channel', title: c.name, poster: '' })
    }
}

type Sonda = (arg?: { targets?: { id: string }[] }) => Promise<unknown>

/** Por padrão o canal 2 está fora do ar e os outros no ar. */
const SONDA_CANAL_2_CAIU: Sonda = arg => Promise.resolve({
    success: true,
    results: (arg?.targets ?? []).map(t => ({ id: t.id, alive: t.id !== '2' })),
})

function dublarIpcDaTv(sonda: Sonda) {
    const invoke = vi.fn((canal: string, arg?: { targets?: { id: string }[] }) => {
        if (canal === 'streams:get-live') return Promise.resolve({ success: true, data: CANAIS })
        if (canal === 'categories:get-live') {
            return Promise.resolve({ success: true, data: [{ category_id: '1', category_name: 'Abertos', parent_id: 0 }] })
        }
        if (canal === 'auth:get-credentials') {
            return Promise.resolve({ success: true, credentials: { url: 'http://prov.example', username: 'u', password: 'p' } })
        }
        if (canal === 'diagnostics:probe-urls') return sonda(arg)
        return Promise.resolve({ success: true, data: [] })
    })
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke, send: vi.fn(), on: vi.fn(), off: vi.fn(),
    }
}

function botoes(): HTMLButtonElement[] {
    return Array.from(container!.querySelectorAll('button'))
}

function botaoComTexto(textos: string[]): HTMLButtonElement | undefined {
    return botoes().find(b => textos.some(t => (b.textContent ?? '').includes(t)))
}

function botaoComTitulo(titulo: string): HTMLButtonElement | undefined {
    return botoes().find(b => b.getAttribute('title') === titulo)
}

async function escolherCategoria(rotulos: string[]) {
    const menu = container!.querySelector('button.toggle-btn') as HTMLButtonElement | null
    if (!menu) throw new Error('sem o botão do menu de categorias')
    await act(async () => { menu.click() })
    await esperar(() => !!botaoComTexto(rotulos), `o item "${rotulos[0]}" aparecer no menu`)
    await act(async () => { botaoComTexto(rotulos)!.click() })
}

async function montarTv(sonda: Sonda = SONDA_CANAL_2_CAIU) {
    semearTv()
    dublarIpcDaTv(sonda)
    await montar(<MemoryRouter><LiveTV /></MemoryRouter>)
    await esperar(() => (container!.textContent ?? '').includes('Canal Teste 3'), 'a grade aparecer')
    return container!
}

describe('TV ao vivo em inglês: a barra, os cards e o estado vazio', () => {
    it('Multi-view, agrupar variantes e o botão infantil dos cards saem no idioma do app', async () => {
        const c = await montarTv()

        const multiView = botaoComTitulo(textoEn('liveTV', 'multiViewHint'))
        expect(multiView, 'botão Multi-view com a dica em inglês').toBeDefined()
        expect(multiView!.textContent).toContain(textoEn('liveTV', 'multiView'))
        expect(botaoComTitulo(textoEn('liveTV', 'groupVariantsHint'))).toBeDefined()
        expect(botoes().filter(b => b.getAttribute('title') === textoEn('liveTV', 'kidsToggleHint'))).toHaveLength(3)

        expect(vazamentos(c)).toEqual([])
    })

    it('o verificador de favoritos: dica, rótulo, resultado e o selo do card', async () => {
        const c = await montarTv()
        await escolherCategoria(FAVORITOS)

        const dica = textoEn('liveTV', 'favCheckHint').replace('{n}', String(FAV_CHECK_LIMIT))
        await esperar(() => !!botaoComTitulo(dica), 'o botão de verificar aparecer com a dica em inglês')
        expect(botaoComTitulo(dica)!.textContent).toContain(textoEn('liveTV', 'favCheck'))
        expect(vazamentos(c)).toEqual([])

        await act(async () => { botaoComTitulo(dica)!.click() })
        const selo = textoEn('liveTV', 'offAir')
        await esperar(() => (c.textContent ?? '').includes(selo), 'o selo aparecer no canal fora do ar')

        const esperado = textoEn('liveTV', 'favCheckSomeDead').replace('{dead}', '1').replace('{probed}', '2')
        expect(botaoComTitulo(dica)!.textContent).toContain(esperado)
        expect(vazamentos(c)).toEqual([])
    })

    it('busca sem resultado: o estado vazio sai no idioma do app', async () => {
        const c = await montarTv()
        const busca = c.querySelector('input') as HTMLInputElement | null
        if (!busca) throw new Error('a página não tem campo de busca')

        await digitar(busca, 'zzzz sem canal')
        await esperar(() => !(c.textContent ?? '').includes('Canal Teste 1'), 'a busca esvaziar a grade')

        expect((c.textContent ?? '').includes(textoEn('liveTV', 'noChannelsFound'))).toBe(true)
        expect((c.textContent ?? '').includes(textoEn('liveTV', 'noChannelsHint'))).toBe(true)
        expect(vazamentos(c)).toEqual([])
    })

    it('enquanto a sonda roda, o botão diz que está verificando no idioma do app', async () => {
        let soltar: (resposta: unknown) => void = () => {}
        const c = await montarTv(() => new Promise(r => { soltar = r }))
        await escolherCategoria(FAVORITOS)
        const dica = textoEn('liveTV', 'favCheckHint').replace('{n}', String(FAV_CHECK_LIMIT))
        await esperar(() => !!botaoComTitulo(dica), 'o botão de verificar aparecer')

        await act(async () => { botaoComTitulo(dica)!.click() })
        const verificando = `⏳ ${textoEn('liveTV', 'favChecking')}`
        await esperar(
            () => (botaoComTitulo(dica)?.textContent ?? '').includes(verificando),
            'o botão mostrar que a sonda está rodando',
        )
        expect(vazamentos(c)).toEqual([])

        await act(async () => { soltar({ success: true, results: [] }) })
    })

    it.each<[string, Sonda]>([
        ['a sonda responde sem sucesso', () => Promise.resolve({ success: false })],
        ['a ponte da sonda rejeita', () => Promise.reject(new Error('ipc caiu'))],
    ])('%s: o botão avisa a falha no idioma do app', async (_caso, sonda) => {
        const c = await montarTv(sonda)
        await escolherCategoria(FAVORITOS)
        const dica = textoEn('liveTV', 'favCheckHint').replace('{n}', String(FAV_CHECK_LIMIT))
        await esperar(() => !!botaoComTitulo(dica), 'o botão de verificar aparecer')

        await act(async () => { botaoComTitulo(dica)!.click() })
        const falhou = `✖ ${textoEn('liveTV', 'favCheckFailed')}`
        await esperar(
            () => (botaoComTitulo(dica)?.textContent ?? '').includes(falhou),
            'o botão avisar que a sonda falhou',
        )
        expect(vazamentos(c)).toEqual([])
    })
})

/**
 * Em inglês "Multi-view" é a MESMA palavra do português — só o espanhol
 * ("Multivista") prova que o rótulo do botão passa pelo dicionário.
 */
describe('TV ao vivo em espanhol', () => {
    it('o rótulo e a dica do Multi-view saem do dicionário', async () => {
        languageService.setLanguage('es')
        await vi.waitFor(() => {
            expect(languageService.t('liveTV', 'watchNow')).toBe(es.liveTV.watchNow)
        })
        await montarTv()

        const multiView = botaoComTitulo(es.liveTV.multiViewHint)
        expect(multiView, 'botão Multi-view com a dica em espanhol').toBeDefined()
        expect(multiView!.textContent).toContain(es.liveTV.multiView)
        expect(multiView!.textContent!.includes('Multi-view')).toBe(false)
    })
})

// ─── Overlay de zapping do player ───────────────────────────────────────────

const LISTA_ZAP: PlayerChannel[] = [
    { id: 1, name: 'Canal A', num: 1, favorite: true },
    { id: 2, name: 'Canal B', num: 2, recentRank: 0 },
    { id: 3, name: 'Canal C', num: 3 },
]

describe('overlay de zapping em inglês', () => {
    it('cabeçalho, filtro ⭐, busca, Recentes e o selo do canal atual', async () => {
        const c = await montar(
            <ChannelZapOverlay channels={LISTA_ZAP} currentId={1} visible onSelect={() => {}} onClose={() => {}} />
        )

        expect((c.textContent ?? '').includes(textoEn('liveTV', 'zapChannels'))).toBe(true)
        expect(c.querySelector(`button[title="${textoEn('liveTV', 'onlyFavorites')}"]`)).not.toBeNull()
        expect((c.querySelector('input') as HTMLInputElement).placeholder).toBe(textoEn('liveTV', 'zapSearchPlaceholder'))
        expect((c.textContent ?? '').includes(textoEn('liveTV', 'recentChannels'))).toBe(true)
        const atual = c.querySelector('[data-ch="1"]')
        expect(atual?.textContent ?? '').toContain(en.liveTV.live)
        expect(vazamentos(c)).toEqual([])
    })

    it('busca sem resultado no overlay', async () => {
        const c = await montar(
            <ChannelZapOverlay channels={LISTA_ZAP} currentId={1} visible onSelect={() => {}} onClose={() => {}} />
        )
        await digitar(c.querySelector('input') as HTMLInputElement, 'zzzz')

        expect((c.textContent ?? '').includes(textoEn('liveTV', 'noChannelsFound'))).toBe(true)
        expect(vazamentos(c)).toEqual([])
    })
})

// ─── Mini-guia do hover ─────────────────────────────────────────────────────

type Programa = Awaited<ReturnType<typeof epgService.fetchChannelEPG>>[number]

const PROGRAMA: Programa = {
    id: 'x', start: '2026-09-25 20:00:00', end: '2026-09-25 21:00:00', title: 'Jornal', channel_id: 'c',
}

describe('mini-guia do hover em inglês', () => {
    it('carregando', async () => {
        vi.spyOn(epgService, 'fetchChannelEPG').mockImplementation(() => new Promise(() => {}))
        const c = await montar(<ChannelHoverMiniGuide streamId={9101} epgChannelId="" channelName="A" x={0} y={0} />)

        expect((c.textContent ?? '').includes(en.guide.loading)).toBe(true)
        expect(vazamentos(c)).toEqual([])
    })

    it('sem programação', async () => {
        vi.spyOn(epgService, 'fetchChannelEPG').mockResolvedValue([])
        const c = await montar(<ChannelHoverMiniGuide streamId={9102} epgChannelId="" channelName="B" x={0} y={0} />)

        await esperar(() => (c.textContent ?? '').includes(en.liveTV.noScheduleInfo), 'o aviso de guia vazio aparecer')
        expect(vazamentos(c)).toEqual([])
    })

    it('o programa atual vem marcado com o "agora" do idioma do app', async () => {
        vi.spyOn(epgService, 'fetchChannelEPG').mockResolvedValue([PROGRAMA])
        vi.spyOn(epgService, 'getCurrentProgram').mockReturnValue(PROGRAMA)
        vi.spyOn(epgService, 'getUpcomingPrograms').mockReturnValue([])
        const c = await montar(<ChannelHoverMiniGuide streamId={9103} epgChannelId="" channelName="C" x={0} y={0} />)

        await esperar(() => (c.textContent ?? '').includes('Jornal'), 'o programa aparecer')
        expect((c.textContent ?? '').includes(`▶ ${en.guide.now}`)).toBe(true)
        expect(vazamentos(c)).toEqual([])
    })
})

// ─── Trocar o idioma com a tela aberta ──────────────────────────────────────

describe('trocar o idioma com o overlay e o mini-guia já abertos', () => {
    it('o overlay acompanha — inclusive o selo da linha memoizada do canal atual', async () => {
        languageService.setLanguage('pt')
        const c = await montar(
            <ChannelZapOverlay channels={LISTA_ZAP} currentId={1} visible onSelect={() => {}} onClose={() => {}} />
        )
        const linhaAtual = () => c.querySelector('[data-ch="1"]')?.textContent ?? ''
        expect(linhaAtual()).toContain(pt.liveTV.live)
        expect((c.textContent ?? '').includes(pt.liveTV.zapChannels)).toBe(true)

        await act(async () => { languageService.setLanguage('en') })
        await esperar(
            () => linhaAtual().includes(en.liveTV.live) && (c.textContent ?? '').includes(en.liveTV.zapChannels),
            'o overlay aberto trocar pro inglês',
        )
        expect(vazamentos(c)).toEqual([])
    })

    it('o mini-guia acompanha', async () => {
        vi.spyOn(epgService, 'fetchChannelEPG').mockImplementation(() => new Promise(() => {}))
        languageService.setLanguage('pt')
        const c = await montar(<ChannelHoverMiniGuide streamId={9104} epgChannelId="" channelName="D" x={0} y={0} />)
        expect((c.textContent ?? '').includes(pt.guide.loading)).toBe(true)

        await act(async () => { languageService.setLanguage('en') })
        await esperar(() => (c.textContent ?? '').includes(en.guide.loading), 'o mini-guia aberto trocar pro inglês')
        expect(vazamentos(c)).toEqual([])
    })
})

// ─── Rótulo do resultado da sonda (montado fora do render) ──────────────────

describe('resultado da sonda dos favoritos em inglês', () => {
    it('todos no ar, alguns fora, lista maior que o limite e sonda que falhou', () => {
        const noAr = textoEn('liveTV', 'favCheckAllAlive').replace('{probed}', '12')
        const foraDoAr = textoEn('liveTV', 'favCheckSomeDead').replace('{dead}', '1').replace('{probed}', '29')
        const parcial = textoEn('liveTV', 'favCheckPartial').replace('{limit}', String(FAV_CHECK_LIMIT)).replace('{total}', '80')

        expect(favCheckMessage(0, 12, 12)).toBe(`✓ ${noAr}`)
        expect(favCheckMessage(1, 29, 80)).toBe(`⚠ ${foraDoAr} · ${parcial}`)
        expect(favCheckFailedMessage()).toBe(`✖ ${textoEn('liveTV', 'favCheckFailed')}`)
    })
})
