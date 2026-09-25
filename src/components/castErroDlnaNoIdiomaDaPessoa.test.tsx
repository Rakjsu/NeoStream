import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CastDeviceSelector } from './CastDeviceSelector'
import { languageService } from '../services/languageService'
import en from '../locales/ui/en.json'
import es from '../locales/ui/es.json'

/**
 * 📺 A falha do cast DLNA aparecia em PORTUGUÊS para quem usa o app em inglês
 * ou espanhol (#D098).
 *
 * O `dlna:cast` (electron/dlnaHandlers.ts) redige em PT-BR os dois textos que
 * explicam a falha pra uma pessoa — a TV recusou o stream (UPnP 704) e o tempo
 * esgotou — e o seletor exibia esse texto cru. Pior: exibia o texto da
 * tentativa ANTERIOR. O `handleCast` lia o `dlnaError` da closure do render de
 * antes do clique, então a 1ª falha mostrava o genérico e a 2ª mostrava o
 * motivo da 1ª.
 *
 * O invariante preso aqui: o main devolve um `code` estável junto do texto, e
 * a tela traduz o código no idioma escolhido JÁ NA TENTATIVA QUE FALHOU. Código
 * desconhecido cai no texto que o main mandou (fallback de hoje); sem texto
 * nenhum, no genérico traduzido. E o texto cru do main não volta pela porta dos
 * fundos: o banner caía no `error` do useDLNA quando o seletor limpava o aviso
 * dele (ao tentar o Chromecast logo depois).
 *
 * Monta o componente de verdade; só o `window.ipcRenderer` é falso (e só ele é
 * trocado — o window continua o do jsdom).
 */

type Resposta = { success: boolean; code?: string; error?: string }

/** Roteador de canais no window.ipcRenderer (os três hooks só usam invoke). */
function mockIpc(respostaDoCast: () => Resposta | Promise<Resposta>, outros: Record<string, () => unknown> = {}) {
    const handlers: Record<string, () => unknown> = {
        'dlna:get-devices': () => ({ success: false, devices: [] }),
        'dlna:discover': () => ({ success: true, devices: [{ id: 'tv1', name: 'TV da Sala', host: '192.168.0.10' }] }),
        'airplay:discover': () => ({ success: true, devices: [] }),
        'cast:discover': () => ({ success: true, devices: [] }),
        'dlna:cast': respostaDoCast,
        ...outros,
    }
    const invoke = vi.fn((channel: string) => {
        const h = handlers[channel]
        return Promise.resolve(h ? h() : { success: false, devices: [] })
    })
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() }
    return invoke
}

/** Espera a CONDIÇÃO (import dinâmico do dicionário, IPC), nunca um número fixo de voltas. */
async function esperar(condicao: () => boolean, rotulo: string, prazoMs = 3000): Promise<void> {
    const limite = Date.now() + prazoMs
    while (!condicao()) {
        if (Date.now() > limite) throw new Error(`esperei demais por: ${rotulo}`)
        await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(<CastDeviceSelector videoUrl="http://exemplo/live/u/p/1.m3u8" videoTitle="Canal" onClose={() => { }} onDeviceSelected={() => { }} />)
    })
    await esperar(() => !!botaoDaTv(), 'a TV descoberta aparecer na lista')
}

function botao(nome: string): HTMLButtonElement | undefined {
    return (Array.from(container!.querySelectorAll('button.device-item')) as HTMLButtonElement[])
        .find(b => b.textContent?.includes(nome))
}

function botaoDaTv(): HTMLButtonElement | undefined {
    return botao('TV da Sala')
}

/** O aviso de erro da lista (o que a pessoa lê). */
function textoDoErro(): string {
    return container!.querySelector('.cast-error')?.textContent ?? ''
}

/** Clica na TV e espera o cast responder (a lista volta a ser clicável). */
async function castarNaTv() {
    const botao = botaoDaTv()!
    await act(async () => { botao.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await esperar(() => botaoDaTv()?.disabled === false && textoDoErro() !== '', 'o cast falhar e o aviso aparecer')
}

const TEXTO_PT_HLS = 'A TV recusou este stream HLS (erro 704). Tente um filme/série (MP4) ou reproduza localmente.'
const TEXTO_PT_FORMATO = 'A TV recusou o formato deste vídeo (erro 704). O container pode não ser suportado pela TV (ex.: MKV) — tente outra versão do conteúdo.'
const TEXTO_PT_TEMPO = 'Tempo esgotado — verifique se a TV está ligada, na mesma rede e com DLNA habilitado.'

beforeEach(() => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer
    vi.restoreAllMocks()
})

afterAll(() => {
    languageService.setLanguage('pt')
})

describe.each([
    { lang: 'en' as const, D: en },
    { lang: 'es' as const, D: es },
])('falha do cast DLNA com o app em $lang (#D098)', ({ lang, D }) => {
    beforeAll(async () => {
        languageService.setLanguage(lang)
        // O dicionário chega por import dinâmico: espera ele estar lá.
        await esperar(() => languageService.t('cast', 'failedToTransmit') === D.cast.failedToTransmit, `dicionário ${lang}`)
    })

    it.each([
        ['hls-refused-704', TEXTO_PT_HLS, 'errorHlsRefused'],
        ['format-refused-704', TEXTO_PT_FORMATO, 'errorFormatRefused'],
        ['timeout', TEXTO_PT_TEMPO, 'errorTimeout'],
        ['device-not-found', 'Device not found. Please add it first.', 'errorDeviceNotFound'],
    ] as const)('código %s: a 1ª tentativa já mostra o motivo, traduzido', async (code, textoDoMain, chave) => {
        mockIpc(() => ({ success: false, code, error: textoDoMain }))
        await montar()

        await castarNaTv()

        const esperado = (D.cast as Record<string, string>)[chave]
        expect(typeof esperado, `falta a chave cast.${chave} no ${lang}.json`).toBe('string')
        expect(textoDoErro().includes(esperado)).toBe(true)
        expect(textoDoErro().includes(textoDoMain)).toBe(false)
    })

    it('a 2ª tentativa mostra o motivo DELA, não o da anterior', async () => {
        const respostas: Resposta[] = [
            { success: false, code: 'timeout', error: TEXTO_PT_TEMPO },
            { success: false, code: 'hls-refused-704', error: TEXTO_PT_HLS },
        ]
        mockIpc(() => respostas.shift()!)
        await montar()

        await castarNaTv()
        expect(textoDoErro().includes(D.cast.errorTimeout)).toBe(true)

        await castarNaTv()
        expect(textoDoErro().includes(D.cast.errorHlsRefused)).toBe(true)
        expect(textoDoErro().includes(D.cast.errorTimeout)).toBe(false)
    })

    it('a 2ª tentativa que cai no IPC não herda o motivo da 1ª: genérico traduzido', async () => {
        const respostas: Array<() => Resposta | Promise<Resposta>> = [
            () => ({ success: false, code: 'timeout', error: TEXTO_PT_TEMPO }),
            () => Promise.reject(new Error('IPC caiu')),
        ]
        mockIpc(() => respostas.shift()!())
        await montar()

        await castarNaTv()
        expect(textoDoErro().includes(D.cast.errorTimeout)).toBe(true)

        await castarNaTv()
        expect(textoDoErro().includes(D.cast.failedToTransmit)).toBe(true)
        expect(textoDoErro().includes(D.cast.errorTimeout)).toBe(false)
    })

    it('tentar o Chromecast depois da falha na TV não traz de volta o texto cru do main', async () => {
        // O seletor limpa o aviso dele ao tentar outro aparelho; o banner
        // então caía no `error` do useDLNA, que guardava o texto PT-BR do
        // main — e ficava na tela durante todo o "Conectando" (até 15 s).
        mockIpc(() => ({ success: false, code: 'timeout', error: TEXTO_PT_TEMPO }), {
            'cast:discover': () => ({ success: true, devices: [{ id: 'cc1', name: 'Chromecast do Quarto', host: '192.168.0.20', model: 'Chromecast' }] }),
            'cast:play': () => new Promise(() => { }),
        })
        await montar()
        await esperar(() => !!botao('Chromecast do Quarto'), 'o Chromecast aparecer na lista')

        await castarNaTv()
        expect(textoDoErro().includes(D.cast.errorTimeout)).toBe(true)

        await act(async () => { botao('Chromecast do Quarto')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
        await esperar(() => !!container!.querySelector('.cast-connecting'), 'o "Conectando" do Chromecast aparecer')

        expect(textoDoErro().includes(TEXTO_PT_TEMPO)).toBe(false)
        expect(textoDoErro()).toBe('')
    })

    it('código desconhecido: cai no texto que o main mandou (fallback de hoje)', async () => {
        mockIpc(() => ({ success: false, error: 'HTTP 500 from device for SetAVTransportURI' }))
        await montar()

        await castarNaTv()

        expect(textoDoErro().includes('HTTP 500 from device for SetAVTransportURI')).toBe(true)
    })

    it('sem código e sem texto: o genérico traduzido', async () => {
        mockIpc(() => ({ success: false }))
        await montar()

        await castarNaTv()

        expect(textoDoErro().includes(D.cast.failedToTransmit)).toBe(true)
    })
})
