import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { LiveTV } from './LiveTV'
import { resetStorageJsonCache } from '../services/storageJsonCache'
import { favoritesService } from '../services/favoritesService'
import { FAV_CHECK_LIMIT } from '../hooks/useFavoritesHealthCheck'
import pt from '../locales/ui/pt.json'

/**
 * 🩺 (#D175) "Verificar favoritos" disparava até 30 `create_link` seguidos no
 * portal Stalker antes de sondar qualquer coisa.
 *
 * A sonda montava a URL de cada favorito com o MESMO construtor do player
 * (`buildLiveStreamUrl`), um canal por vez: cada canal custava um
 * `auth:get-credentials` e, em portal Stalker, um `stalker:create-link` — que
 * no main é handshake + `create_link` DE VERDADE no portal. `create_link` não
 * é consulta, é efeito colateral: conta no limite de conexões do portal, e a
 * pessoa podia derrubar a própria reprodução (ou tomar bloqueio temporário)
 * só por conferir os favoritos.
 *
 * O botão só existe na categoria ⭐ (`selectedCategory === 'FAVORITES'`), então
 * a lista sondada é a dos favoritos filtrados pela busca — não a grade toda.
 *
 * Os casos montam a TV ao vivo DE VERDADE (jsdom, só o IPC do preload
 * dublado) e fazem o caminho da pessoa: ⭐ Favoritos → 🩺 Verificar.
 */

const PERFIL = 'p1'
const FAVORITOS = ['Canais favoritos', 'Favorite Channels', 'Canales favoritos']

type Credenciais = { url: string; username: string; password: string }

const XTREAM: Credenciais = { url: 'http://prov.example', username: 'u', password: 'p' }
const STALKER: Credenciais = { url: 'http://portal.example/stalker_portal/c/', username: 'AA:BB:CC:DD:EE:FF', password: 'stalker' }
/** Lista M3U: usuário/senha-sentinela 'm3u'; a URL de reprodução vem no canal. */
const M3U: Credenciais = { url: 'http://lista.example/tv.m3u', username: 'm3u', password: 'm3u' }

/** O que cada canal traz em `direct_source`. */
type Fonte = (i: number) => string
const COM_CMD: Fonte = i => `ffrt http://localhost/ch/${i}`
const SEM_FONTE: Fonte = () => ''
const URL_NO_CANAL: Fonte = i => `https://cdn.example/${i}.m3u8`

function canais(fonte: Fonte) {
    return [1, 2, 3].map(i => ({
        num: i, name: `Canal Teste ${i}`, stream_type: 'live', stream_id: i, stream_icon: '',
        epg_channel_id: '', added: '1600000000', category_id: '1', custom_sid: '',
        tv_archive: 0, direct_source: fonte(i), tv_archive_duration: 0,
    }))
}

let invoke: ReturnType<typeof vi.fn>
let root: Root | null = null
let container: HTMLDivElement | null = null
/** O que `auth:get-credentials` devolve agora (null = "Not authenticated"). */
let credenciaisAtuais: Credenciais | null = null

function semear(favoritos: number[]) {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('neostream_active_playlist_id', 'pl1')
    localStorage.setItem('neostream_profiles', JSON.stringify({
        activeProfileId: PERFIL,
        profiles: [{ id: PERFIL, name: 'Dono', avatar: '🙂', isKids: false, createdAt: 1 }],
    }))
    resetStorageJsonCache()
    for (const id of favoritos) {
        favoritesService.add({ id: String(id), type: 'channel', title: `Canal Teste ${id}`, poster: '' })
    }
}

function dublarIpc(credenciais: Credenciais, fonte: Fonte) {
    credenciaisAtuais = credenciais
    invoke = vi.fn((canal: string, arg?: { targets?: { id: string }[]; cmd?: string }) => {
        if (canal === 'streams:get-live') return Promise.resolve({ success: true, data: canais(fonte) })
        if (canal === 'categories:get-live') {
            return Promise.resolve({ success: true, data: [{ category_id: '1', category_name: 'Abertos', parent_id: 0 }] })
        }
        if (canal === 'auth:get-credentials') {
            return Promise.resolve(credenciaisAtuais
                ? { success: true, credentials: credenciaisAtuais }
                : { success: false, error: 'Not authenticated' })
        }
        if (canal === 'stalker:create-link') {
            return Promise.resolve({ success: true, url: `http://portal.example/play/${encodeURIComponent(arg?.cmd ?? '')}` })
        }
        if (canal === 'diagnostics:probe-urls') {
            return Promise.resolve({
                success: true,
                results: (arg?.targets ?? []).map(t => ({ id: t.id, alive: true })),
            })
        }
        return Promise.resolve({ success: true, data: [] })
    })
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke, send: vi.fn(), on: vi.fn(), off: vi.fn(),
    }
}

/** Espera a CONDIÇÃO, com teto de tempo real — nunca um nº fixo de voltas. */
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
    const dica = pt.liveTV.favCheckHint.replace('{n}', String(FAV_CHECK_LIMIT))
    return botoes().find(b => b.getAttribute('title') === dica)
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

async function abrirFavoritos() {
    const menu = container!.querySelector('button.toggle-btn') as HTMLButtonElement | null
    if (!menu) throw new Error('sem o botão do menu de categorias')
    await act(async () => { menu.click() })
    await esperar(() => !!botaoComTexto(FAVORITOS), 'o item de favoritos aparecer no menu')
    await act(async () => { botaoComTexto(FAVORITOS)!.click() })
    await esperar(() => !!botaoVerificar(), 'o botão de verificar aparecer')
}

/**
 * Clica em 🩺 e espera a verificação ACABAR (o rótulo sai do "Verificando…" e
 * mostra um resultado). Devolve só as chamadas de IPC feitas a partir do clique.
 */
async function verificar(): Promise<unknown[][]> {
    const antes = invoke.mock.calls.length
    await act(async () => { botaoVerificar()!.click() })
    await esperar(() => {
        const rotulo = botaoVerificar()?.textContent ?? ''
        return rotulo !== '' && !rotulo.includes('⏳') && !rotulo.includes(pt.liveTV.favCheck)
    }, 'a verificação terminar')
    return invoke.mock.calls.slice(antes)
}

const doCanal = (chamadas: unknown[][], canal: string) => chamadas.filter(c => c[0] === canal)

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    credenciaisAtuais = null
    document.body.innerHTML = ''
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('TV ao vivo: "Verificar favoritos" não gasta create_link nem lê as credenciais canal a canal (#D175)', () => {
    it('portal Stalker: nenhum create_link, nada sondado, e o botão avisa que a verificação não está disponível', async () => {
        semear([1, 2])
        dublarIpc(STALKER, COM_CMD)
        await montar()
        await abrirFavoritos()

        const chamadas = await verificar()

        // O coração do item: nenhum create_link sai por causa da sonda.
        expect(doCanal(chamadas, 'stalker:create-link')).toHaveLength(0)
        // Sem URL de verdade não há o que sondar.
        expect(doCanal(chamadas, 'diagnostics:probe-urls')).toHaveLength(0)
        // E a pessoa fica sabendo por quê, no rótulo do botão.
        expect(Object.prototype.hasOwnProperty.call(pt.liveTV, 'favCheckUnavailable')).toBe(true)
        const aviso = (pt.liveTV as Record<string, string>).favCheckUnavailable
        expect((botaoVerificar()!.textContent ?? '').includes(aviso)).toBe(true)
        // Nada de selo "fora do ar" inventado.
        expect((container!.textContent ?? '').includes('⚠ FORA DO AR')).toBe(false)
    })

    it('Xtream: lê as credenciais UMA vez por verificação (não uma por canal) e sonda as mesmas URLs de antes', async () => {
        semear([1, 2, 3])
        dublarIpc(XTREAM, SEM_FONTE)
        await montar()
        await abrirFavoritos()

        const chamadas = await verificar()

        expect(doCanal(chamadas, 'auth:get-credentials')).toHaveLength(1)
        expect(doCanal(chamadas, 'stalker:create-link')).toHaveLength(0)
        const sondas = doCanal(chamadas, 'diagnostics:probe-urls')
        expect(sondas).toHaveLength(1)
        expect(sondas[0][1]).toEqual({
            targets: [1, 2, 3].map(i => ({ id: String(i), url: `http://prov.example/live/u/p/${i}.m3u8` })),
        })
        expect((botaoVerificar()!.textContent ?? '').includes('3 no ar')).toBe(true)
    })

    it('M3U: sonda a URL que vem no próprio canal, com UMA leitura de credenciais', async () => {
        semear([1, 2])
        dublarIpc(M3U, URL_NO_CANAL)
        await montar()
        await abrirFavoritos()

        const chamadas = await verificar()

        expect(doCanal(chamadas, 'auth:get-credentials')).toHaveLength(1)
        const sondas = doCanal(chamadas, 'diagnostics:probe-urls')
        expect(sondas).toHaveLength(1)
        expect(sondas[0][1]).toEqual({
            targets: [1, 2].map(i => ({ id: String(i), url: `https://cdn.example/${i}.m3u8` })),
        })
    })

    it('sem credenciais: a verificação diz que falhou (não "0 no ar") e não chama a sonda com lista vazia', async () => {
        semear([1, 2])
        dublarIpc(XTREAM, SEM_FONTE)
        await montar()
        await abrirFavoritos()
        credenciaisAtuais = null

        const chamadas = await verificar()

        expect(doCanal(chamadas, 'diagnostics:probe-urls')).toHaveLength(0)
        expect((botaoVerificar()!.textContent ?? '').includes(`✖ ${pt.liveTV.favCheckFailed}`)).toBe(true)
    })
})

/**
 * A regra de URL do PLAYER saiu de dentro do `buildLiveStreamUrl` pra
 * `urlDoCanalAoVivoSemPortal` (dividida com a sonda). Clicar num card abre a
 * prévia do painel lateral, que monta a URL pelo MESMO `buildLiveStreamUrl`
 * do player: aqui a gente confere que ela saiu igual à de antes em cada tipo
 * de lista — e que o Stalker de verdade (tocar) continua fazendo o create_link.
 */
describe('TV ao vivo: o player monta a mesma URL de antes (#D175)', () => {
    beforeEach(() => {
        // jsdom não toca mídia: sem isto a prévia desiste antes de pôr o src.
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe')
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    })

    /** Clica no card e devolve o src que a prévia recebeu + o IPC feito desde o clique. */
    async function abrirPrevia(nome: string): Promise<{ src: string; chamadas: unknown[][] }> {
        const card = Array.from(container!.querySelectorAll<HTMLDivElement>('.channels-grid > div'))
            .find(d => (d.textContent ?? '').includes(nome))
        if (!card) throw new Error(`sem o card ${nome}`)
        const antes = invoke.mock.calls.length
        await act(async () => { card.click() })
        const previa = () => container!.querySelector<HTMLVideoElement>('#preview-video')
        await esperar(() => !!previa()?.getAttribute('src'), 'a prévia receber a URL')
        return { src: previa()!.getAttribute('src')!, chamadas: invoke.mock.calls.slice(antes) }
    }

    it('Stalker: tocar o canal resolve o cmd com UM create_link e usa a URL que o portal devolveu', async () => {
        semear([])
        dublarIpc(STALKER, COM_CMD)
        await montar()

        const { src, chamadas } = await abrirPrevia('Canal Teste 2')

        expect(doCanal(chamadas, 'stalker:create-link')).toEqual([['stalker:create-link', { cmd: 'ffrt http://localhost/ch/2' }]])
        expect(src).toBe(`http://portal.example/play/${encodeURIComponent('ffrt http://localhost/ch/2')}`)
    })

    it('Xtream: a forma clássica /live/usuário/senha/id.m3u8, sem create_link', async () => {
        semear([])
        dublarIpc(XTREAM, SEM_FONTE)
        await montar()

        const { src, chamadas } = await abrirPrevia('Canal Teste 2')

        expect(src).toBe('http://prov.example/live/u/p/2.m3u8')
        expect(doCanal(chamadas, 'stalker:create-link')).toHaveLength(0)
    })

    it('M3U: a URL que vem no próprio canal', async () => {
        semear([])
        dublarIpc(M3U, URL_NO_CANAL)
        await montar()

        const { src } = await abrirPrevia('Canal Teste 2')

        expect(src).toBe('https://cdn.example/2.m3u8')
    })
})
