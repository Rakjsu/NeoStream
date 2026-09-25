/**
 * D081 — portal Stalker/MAC e lista M3U de ARQUIVO no primeiro acesso.
 *
 * O backend dos dois já existia (`playlists:add-stalker` e
 * `playlists:add-m3u-file`) e a tela também — só que em Configurações →
 * Playlists, que mora debaixo de /dashboard. Numa instalação nova a rota
 * /dashboard faz `<Navigate to="/login">` (App.tsx), e o Welcome só oferecia
 * conta Xtream, M3U por URL e restaurar backup. Quem tem portal MAC ou um
 * arquivo .m3u no computador não tinha por onde entrar.
 *
 * O teste percorre o caminho do usuário: monta o Welcome de verdade, clica em
 * Continuar e na porta nova. O IPC dublê faz o que o handler faz depois da
 * rede/diálogo — `saveAndActivatePlaylist` do manager REAL (store em memória),
 * com os mesmos campos — e o que se afirma é o estado que o boot lê
 * (`auth:check`). O elo que o dublê imita (o handler chamar
 * `saveAndActivatePlaylist`) é preso lendo a fonte, no molde do D079.
 *
 * Mora em electron/ (e sem JSX) porque importa o manager do main: em src/ o
 * `tsc -b` do app arrastaria o logger (`process`) e o `node:fs` pro typecheck.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'

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
import { saveAndActivatePlaylist, getActivePlaylist } from './playlistManager'
import { normalizeMac, STALKER_SENTINEL } from './stalkerProtocol'
import { Welcome } from '../src/pages/Welcome'
import { playlistService } from '../src/services/playlistService'
import { languageService } from '../src/services/languageService'

const RAIZ = path.join(__dirname, '..')

/** Os fontes são CRLF; normalizar antes de procurar. */
function ler(rel: string): string {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf-8').split('\r\n').join('\n')
}

/** O mesmo critério do handler `auth:check` (electron/ipcHandlers.ts). */
function authCheck(): { authenticated: boolean } {
    const auth = (store.get('auth') ?? {}) as { url?: string; username?: string; password?: string }
    return { authenticated: Boolean(auth.url && auth.username && auth.password) }
}

function maquinaNova() {
    store.set('auth', {})
    store.set('playlists', [])
    store.delete('activePlaylistId')
    store.delete('removedPlaylists')
}

const PORTAL = 'http://portal.exemplo/c/'
const MAC_DIGITADO = '00-1a-79-ab-cd-ef'
const ARQUIVO = 'C:\\listas\\minha-lista.m3u'
const CAMPO_URL = 'http://portal.tv/c/'
const CAMPO_MAC = '00:1A:79:XX:XX:XX'

type RespostaDoArquivo = 'escolheu' | 'cancelou' | 'ilegivel'
type RespostaDoPortal = 'aceita' | 'recusa' | 'main-caiu'

let container: HTMLDivElement
let root: Root
let pedidos: Array<{ canal: string; args: unknown }>
let recarregou: boolean
let respostaDoArquivo: RespostaDoArquivo
let respostaDoPortal: RespostaDoPortal
const ipcOriginal = (window as unknown as { ipcRenderer?: unknown }).ipcRenderer

/**
 * IPC dublê: só a propriedade `ipcRenderer` (nunca o `window` inteiro). Os
 * dois canais fazem o que o handler faz depois da parte que depende de rede
 * (portal) ou do diálogo do sistema (arquivo). Canal desconhecido FALHA — um
 * Welcome que chamasse o canal errado não pode parecer que deu certo.
 */
function instalarIpc() {
    const invoke = vi.fn(async (canal: string, args?: unknown) => {
        pedidos.push({ canal, args })
        if (canal === 'playlists:add-stalker') {
            if (respostaDoPortal === 'main-caiu') throw new Error('No handler registered')
            if (respostaDoPortal === 'recusa') return { success: false, error: 'Portal não respondeu' }
            const { name, url, mac } = args as { name?: string; url: string; mac: string }
            const normalizado = normalizeMac(String(mac ?? ''))
            if (!normalizado) return { success: false, error: 'MAC inválido (esperado AA:BB:CC:DD:EE:FF)' }
            const entry = saveAndActivatePlaylist({
                name: typeof name === 'string' && name.trim() ? name.trim() : 'Stalker (3 canais)',
                url: String(url),
                username: normalizado,
                password: STALKER_SENTINEL,
                type: 'stalker',
            })
            return { success: true, playlistId: entry.id, channelCount: 3 }
        }
        if (canal === 'playlists:add-m3u-file') {
            if (respostaDoArquivo === 'cancelou') return { success: false, canceled: true }
            if (respostaDoArquivo === 'ilegivel') return { success: false, error: 'Arquivo vazio ou sem canais' }
            const entry = saveAndActivatePlaylist({
                name: 'minha-lista.m3u',
                url: ARQUIVO,
                username: 'm3u',
                password: 'm3u',
                type: 'm3u',
            })
            return { success: true, playlistId: entry.id, channelCount: 10, fileName: 'minha-lista.m3u' }
        }
        return { success: false, error: `canal inesperado: ${canal}` }
    })
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke, on: vi.fn(), off: vi.fn(), send: vi.fn() }
    return invoke
}

/** Espera uma CONDIÇÃO, não um número de microtasks. */
async function esperarAte(cond: () => boolean, oQue: string) {
    const limite = Date.now() + 5000
    while (!cond()) {
        if (Date.now() > limite) throw new Error(`esperei demais: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    }
}

async function clicar(el: Element) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

function botaoComTexto(texto: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find(b => (b.textContent ?? '').includes(texto))
}

function botao(texto: string): HTMLButtonElement {
    const achado = botaoComTexto(texto)
    if (!achado) throw new Error(`não achei o botão "${texto}" no Welcome`)
    return achado
}

function campo(placeholder: string): HTMLInputElement | null {
    return container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement | null
}

/** Campo controlado do React: setter nativo + evento `input`. */
async function digitar(placeholder: string, valor: string) {
    const alvo = campo(placeholder)
    if (!alvo) throw new Error(`não achei o campo "${placeholder}"`)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(alvo, valor)
        alvo.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function botaoDeEnviar(): HTMLButtonElement {
    const b = container.querySelector('form button[type="submit"]') as HTMLButtonElement | null
    if (!b) throw new Error('formulário sem botão de enviar')
    return b
}

async function enviarFormulario() {
    const form = container.querySelector('form')
    if (!form) throw new Error('formulário não está na tela')
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
}

function textoDoErro(): string {
    return container.querySelector('.welcome-error')?.textContent?.replace('⚠️', '').trim() ?? ''
}

/** Welcome montado e já na tela das portas (depois do "Continuar"). */
async function abrirPortas() {
    instalarIpc()
    await act(async () => {
        root.render(createElement(MemoryRouter, null, createElement(Welcome)))
    })
    await clicar(botao(languageService.t('welcome', 'continue')))
}

/** Portas → portal → URL e MAC preenchidos (com o espaço que o colar traz). */
async function preencherPortal() {
    await abrirPortas()
    await clicar(botao(tituloStalker()))
    await digitar(CAMPO_URL, `  ${PORTAL}  `)
    await digitar(CAMPO_MAC, ` ${MAC_DIGITADO} `)
}

const tituloStalker = () => languageService.t('welcome', 'connectStalker')
const tituloArquivo = () => languageService.t('welcome', 'connectM3uFile')

beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('__APP_VERSION__', '0.0.0-teste')
    localStorage.clear()
    maquinaNova()
    pedidos = []
    recarregou = false
    respostaDoArquivo = 'escolheu'
    respostaDoPortal = 'aceita'
    vi.spyOn(playlistService, 'reloadIntoDashboard').mockImplementation(() => { recarregou = true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    ;(window as unknown as { ipcRenderer?: unknown }).ipcRenderer = ipcOriginal
    localStorage.clear()
})

describe('D081 — primeiro acesso com portal Stalker/MAC', () => {
    it('o Welcome oferece a porta do portal (título traduzido, não a chave crua)', async () => {
        await abrirPortas()
        expect(tituloStalker()).not.toBe('connectStalker')
        expect(botaoComTexto(tituloStalker())).toBeDefined()
    })

    it('URL + MAC pelo Welcome: o boot seguinte já encontra a sessão (não cai no /login)', async () => {
        await preencherPortal()
        await enviarFormulario()
        await esperarAte(() => recarregou, 'o Welcome não recarregou depois do portal')

        const pedido = pedidos.find(p => p.canal === 'playlists:add-stalker')
        // Sem nome digitado vai `undefined` (o main batiza "Stalker (N canais)");
        // URL e MAC vão sem o espaço do colar.
        expect(pedido?.args).toEqual({ name: undefined, url: PORTAL, mac: MAC_DIGITADO })
        // Lista nova → convite da chave TMDB (mesmo par do M3U por URL).
        expect(playlistService.reloadIntoDashboard).toHaveBeenCalledWith(true)
        expect(authCheck().authenticated).toBe(true)
        expect(getActivePlaylist()?.type).toBe('stalker')
        expect(getActivePlaylist()?.url).toBe(PORTAL)
        expect(getActivePlaylist()?.username).toBe('00:1A:79:AB:CD:EF')
    })

    it('o nome digitado chega ao main (aparado)', async () => {
        await preencherPortal()
        await digitar(languageService.t('welcome', 'm3uName'), '  Portal da sala  ')
        await enviarFormulario()
        await esperarAte(() => recarregou, 'o Welcome não recarregou depois do portal')

        expect(pedidos.find(p => p.canal === 'playlists:add-stalker')?.args)
            .toEqual({ name: 'Portal da sala', url: PORTAL, mac: MAC_DIGITADO })
        expect(getActivePlaylist()?.name).toBe('Portal da sala')
    })

    it('sem URL ou sem MAC o botão não envia', async () => {
        await abrirPortas()
        await clicar(botao(tituloStalker()))
        expect(botaoDeEnviar().disabled).toBe(true)
        // Só o MAC: falta a URL.
        await digitar(CAMPO_MAC, MAC_DIGITADO)
        expect(botaoDeEnviar().disabled).toBe(true)
        await digitar(CAMPO_URL, PORTAL)
        expect(botaoDeEnviar().disabled).toBe(false)
        // MAC só de espaços conta como vazio.
        await digitar(CAMPO_MAC, '   ')
        expect(botaoDeEnviar().disabled).toBe(true)
    })

    it('portal recusado: mostra o motivo e fica na tela, sem recarregar', async () => {
        respostaDoPortal = 'recusa'
        await preencherPortal()
        await enviarFormulario()
        await esperarAte(() => textoDoErro() !== '', 'o erro do portal não apareceu')

        expect(textoDoErro()).toBe('Portal não respondeu')
        expect(recarregou).toBe(false)
        expect(authCheck().authenticated).toBe(false)
        // O formulário continua ali, destravado, pra corrigir.
        expect(campo(CAMPO_MAC)).not.toBe(null)
        expect(campo(CAMPO_MAC)?.disabled).toBe(false)
    })

    it('main não responde: mostra o aviso traduzido, não o erro cru nem a chave', async () => {
        respostaDoPortal = 'main-caiu'
        await preencherPortal()
        await enviarFormulario()
        await esperarAte(() => textoDoErro() !== '', 'o aviso de falha não apareceu')

        expect(languageService.t('welcome', 'stalkerError')).not.toBe('stalkerError')
        expect(textoDoErro()).toBe(languageService.t('welcome', 'stalkerError'))
        expect(recarregou).toBe(false)
    })

    it('voltar do formulário devolve às portas', async () => {
        await abrirPortas()
        await clicar(botao(tituloStalker()))
        await clicar(botao(languageService.t('welcome', 'back')))
        expect(campo(CAMPO_MAC)).toBe(null)
        expect(botaoComTexto(tituloArquivo())).toBeDefined()
    })
})

describe('D081 — primeiro acesso com lista M3U de arquivo', () => {
    it('o Welcome oferece abrir um .m3u do computador', async () => {
        await abrirPortas()
        expect(tituloArquivo()).not.toBe('connectM3uFile')
        expect(botaoComTexto(tituloArquivo())).toBeDefined()
    })

    it('arquivo escolhido: entra direto, com a lista ativa', async () => {
        await abrirPortas()
        await clicar(botao(tituloArquivo()))
        await esperarAte(() => recarregou, 'o Welcome não recarregou depois do arquivo')

        const pedido = pedidos.find(p => p.canal === 'playlists:add-m3u-file')
        expect(pedido).toBeDefined()
        // O renderer NUNCA manda caminho: quem escolhe é o diálogo do main.
        expect(JSON.stringify(pedido?.args ?? {}).includes('listas')).toBe(false)
        expect(playlistService.reloadIntoDashboard).toHaveBeenCalledWith(true)
        expect(authCheck().authenticated).toBe(true)
        expect(getActivePlaylist()?.type).toBe('m3u')
        expect(getActivePlaylist()?.url).toBe(ARQUIVO)
    })

    it('diálogo cancelado: nada de erro, nada de reload, continua nas portas', async () => {
        respostaDoArquivo = 'cancelou'
        await abrirPortas()
        await clicar(botao(tituloArquivo()))
        await esperarAte(() => pedidos.some(p => p.canal === 'playlists:add-m3u-file'), 'o Welcome não pediu o arquivo')
        await esperarAte(() => !botao(tituloArquivo()).disabled, 'o card não destravou depois do cancelamento')

        expect(textoDoErro()).toBe('')
        expect(recarregou).toBe(false)
        expect(authCheck().authenticated).toBe(false)
    })

    it('arquivo ilegível: mostra o motivo do main', async () => {
        respostaDoArquivo = 'ilegivel'
        await abrirPortas()
        await clicar(botao(tituloArquivo()))
        await esperarAte(() => textoDoErro() !== '', 'o erro do arquivo não apareceu')

        expect(textoDoErro()).toBe('Arquivo vazio ou sem canais')
        expect(recarregou).toBe(false)
    })
})

describe('D081 — o elo que o dublê imita', () => {
    /** Corpo de um `ipcMain.handle(canal, ...)` até o próximo handler. */
    function corpoDoHandler(canal: string): string {
        const fonte = ler('electron/ipcHandlers.ts')
        const ini = fonte.indexOf(`ipcMain.handle('${canal}'`)
        expect(ini).toBeGreaterThan(-1)
        return fonte.slice(ini, fonte.indexOf('ipcMain.handle(', ini + 10))
    }

    // Se um dos handlers deixar de ATIVAR (mirrorAuth via saveAndActivatePlaylist),
    // o reload do Welcome volta a cair no /login — o mesmo buraco do D079.
    it('add-stalker cadastra E ativa, com o MAC normalizado e o sentinela', () => {
        const corpo = corpoDoHandler('playlists:add-stalker')
        expect(corpo.includes('saveAndActivatePlaylist(')).toBe(true)
        expect(corpo.includes('username: normalizedMac')).toBe(true)
        expect(corpo.includes('password: STALKER_SENTINEL')).toBe(true)
        // O Welcome só recarrega com `success: true` — o que o dublê devolve.
        expect(corpo.includes('return { success: true, playlistId: entry.id')).toBe(true)
    })

    it('add-m3u-file cadastra E ativa (e desfaz se o arquivo não abre)', () => {
        const corpo = corpoDoHandler('playlists:add-m3u-file')
        expect(corpo.includes('saveAndActivatePlaylist(')).toBe(true)
        expect(corpo.includes('removePlaylist(entry.id)')).toBe(true)
        expect(corpo.includes('return { success: true, playlistId: entry.id')).toBe(true)
        // Cancelar o diálogo não é erro: o Welcome depende do `canceled`.
        expect(corpo.includes('return { success: false, canceled: true }')).toBe(true)
    })

    // A ponte do renderer: o dublê responde por canal, então o service tem de
    // falar exatamente os canais que o main registra.
    it('playlistService fala os canais que o main registra', () => {
        const service = ler('src/services/playlistService.ts')
        const main = ler('electron/ipcHandlers.ts')
        const preload = ler('electron/preload.ts')
        for (const canal of ['playlists:add-stalker', 'playlists:add-m3u-file']) {
            expect(service.includes(`invoke('${canal}'`)).toBe(true)
            expect(main.includes(`ipcMain.handle('${canal}'`)).toBe(true)
            expect(preload.includes(`'${canal}'`)).toBe(true)
        }
    })
})
