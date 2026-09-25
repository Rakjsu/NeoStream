import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Login } from './Login'
import { languageService } from '../services/languageService'
import { XTREAM_LOGIN_ERROR_MARKERS, classifyXtreamLoginError } from '../services/xtreamLoginError'

/**
 * D083 — todo erro de login aparecia em PORTUGUÊS, mesmo com o app em inglês
 * ou espanhol.
 *
 * O `XtreamClient` reescreve a falha de rede em português antes de devolver
 * ('Servidor não encontrado: …', 'Conexão recusada: …', 'Tempo esgotado ao
 * conectar em: …', 'Usuário ou senha incorretos'), e o Login decidia a
 * tradução procurando 'ENOTFOUND' / 'ECONNREFUSED' / 'timeout' na mensagem —
 * tokens que nenhuma dessas frases contém. Caía sempre no
 * `setError(errorMessage)`, e as chaves login.connectionError / authError /
 * timeoutError, escritas nos TRÊS idiomas, quase nunca eram usadas.
 *
 * O teste é comportamental: monta a tela de Login de verdade, com o app em
 * inglês, responde ao `auth:login` com a mensagem que o main escreve HOJE e
 * lê o que apareceu na tela. Sem a correção, o que aparece é a frase em
 * português. O par que prende a outra ponta (a mensagem que o main realmente
 * escreve) é `electron/mensagemDoErroDeAutenticacao.test.ts`.
 */

/** `window.ipcRenderer` só com o que o Login usa (invoke + send do idioma). */
function mockIpc(resposta: unknown) {
    const invoke = vi.fn((canal: string) => {
        if (canal === 'auth:login') return Promise.resolve(resposta)
        return Promise.resolve({ success: false })
    })
    const fake = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() }
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = fake
    return invoke
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montarLogin() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(<MemoryRouter><Login /></MemoryRouter>)
    })
}

async function desmontarLogin() {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
}

/** Dispara o submit do formulário de credenciais e espera o IPC responder. */
async function enviarCredenciais() {
    const form = container!.querySelector('form')
    if (!form) throw new Error('formulário de credenciais não está na tela')
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

/** O texto que a tela mostra no aviso de erro. */
function textoDoErro(): string {
    const aviso = container!.querySelector('.login-error')
    return aviso?.textContent?.replace('❌', '').trim() ?? ''
}

/**
 * `window.ipcRenderer` cujo `auth:login` REJEITA — o outro ramo do
 * componente (o `catch` do `handleCredentialsSubmit`), que a resposta
 * `{ success:false }` nunca exercita.
 */
function mockIpcQueRejeita(erro: Error) {
    const invoke = vi.fn((canal: string) => {
        if (canal === 'auth:login') return Promise.reject(erro)
        return Promise.resolve({ success: false })
    })
    const fake = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() }
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = fake
    return invoke
}

/** Monta, envia, lê e desmonta — um caso inteiro. */
async function erroMostradoPara(resposta: unknown): Promise<string> {
    mockIpc(resposta)
    await montarLogin()
    await enviarCredenciais()
    const mostrado = textoDoErro()
    await desmontarLogin()
    return mostrado
}

beforeAll(async () => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // en.json entra por import dinâmico (code-split por idioma): trocar o
    // idioma não é síncrono, então esperamos o dicionário chegar de verdade.
    languageService.setLanguage('en')
    await vi.waitFor(() => {
        expect(languageService.t('login', 'authError')).toBe('Incorrect username or password')
    })
})

beforeEach(() => {
    expect(languageService.getLanguage()).toBe('en')
})

afterEach(async () => {
    await desmontarLogin()
    vi.restoreAllMocks()
})

// Cada caso é a mensagem EXATA que electron/xtreamClient.ts escreve hoje,
// montada a partir da tabela compartilhada — o teste em electron/ confere que
// o main continua escrevendo exatamente isto.
const URL_DO_PROVEDOR = 'http://exemplo:8080'
const CASOS: ReadonlyArray<readonly [string, string, string]> = [
    ['credencial recusada (auth=0)',
        XTREAM_LOGIN_ERROR_MARKERS.auth,
        'Incorrect username or password'],
    ['host não resolve',
        `${XTREAM_LOGIN_ERROR_MARKERS.dns} ${URL_DO_PROVEDOR}\n\nVerifique se a URL está correta.`,
        'Could not connect to server'],
    ['conexão recusada',
        `${XTREAM_LOGIN_ERROR_MARKERS.refused} ${URL_DO_PROVEDOR}\n\nO servidor pode estar offline.`,
        'Could not connect to server'],
    ['tempo esgotado',
        `${XTREAM_LOGIN_ERROR_MARKERS.timeout} ${URL_DO_PROVEDOR}\n\nO servidor demorou muito para responder.`,
        'Timeout. Server took too long to respond.'],
    ['rede fora',
        `${XTREAM_LOGIN_ERROR_MARKERS.offline} ${URL_DO_PROVEDOR}\n\nVerifique sua internet e se o servidor está acessível.`,
        'Could not connect to server'],
    ['HTTP 401 cru do provedor', 'HTTP 401: Unauthorized', 'Incorrect username or password'],
]

describe('erro de login no idioma do app (D083)', () => {
    it.each(CASOS)('%s: traduz em vez de repetir a frase do main', async (_nome, mensagemDoMain, esperado) => {
        expect(await erroMostradoPara({ success: false, error: mensagemDoMain })).toBe(esperado)
    })

    it.each(CASOS)('%s: nenhum pedaço de português vaza na tela em inglês', async (_nome, mensagemDoMain) => {
        const mostrado = await erroMostradoPara({ success: false, error: mensagemDoMain })

        expect(mostrado).not.toBe(mensagemDoMain)
        expect(mostrado.includes('Verifique')).toBe(false)
        expect(mostrado.includes('Usuário')).toBe(false)
        expect(mostrado.includes('servidor')).toBe(false)
    })

    it('URL inválida continua traduzida (era o único ramo que já acertava)', async () => {
        expect(await erroMostradoPara({ success: false, error: 'Invalid URL' }))
            .toBe('Invalid URL. Check the server address.')
    })

    it('guia do certificado continua saindo cru (é instrução, não código)', async () => {
        const guia = 'Certificado invalido do provedor. O app pergunta antes de aceitar e guarda a recusa por alguns minutos; se voce recusou, tente de novo daqui a pouco.'
        expect(await erroMostradoPara({ success: false, error: guia })).toBe(guia)
    })

    it('mensagem desconhecida continua aparecendo como veio', async () => {
        const crua = 'Resposta inválida do servidor - sem informações de usuário'
        expect(await erroMostradoPara({ success: false, error: crua })).toBe(crua)
    })

    it('falha sem mensagem nenhuma cai no texto de erro inesperado', async () => {
        expect(await erroMostradoPara({ success: false })).toBe('Unexpected error. Check settings.')
    })

    // O outro ramo do componente: a promessa do IPC REJEITA (preload ausente,
    // canal derrubado). Ele também mostrava a frase do main crua.
    it.each(CASOS)('%s: também traduz quando o IPC rejeita em vez de responder', async (_nome, mensagemDoMain, esperado) => {
        mockIpcQueRejeita(new Error(mensagemDoMain))
        await montarLogin()
        await enviarCredenciais()

        expect(textoDoErro()).toBe(esperado)
    })

    it('IPC que rejeita com algo irreconhecível mostra o erro inesperado (não a mensagem crua)', async () => {
        mockIpcQueRejeita(new Error('Error invoking remote method: no handler'))
        await montarLogin()
        await enviarCredenciais()

        expect(textoDoErro()).toBe('Unexpected error. Check settings.')
    })

    it('login que dá certo não mostra erro nenhum e avança de passo', async () => {
        mockIpc({ success: true, playlistId: 'p1' })
        await montarLogin()
        await enviarCredenciais()

        expect(textoDoErro()).toBe('')
        expect(container!.querySelector('input[placeholder="My Playlist"]')).not.toBe(null)
    })
})

describe('classificador de erro de login (D083)', () => {
    it('reconhece cada frase que o main escreve', () => {
        expect(classifyXtreamLoginError(XTREAM_LOGIN_ERROR_MARKERS.auth)).toBe('auth')
        expect(classifyXtreamLoginError(`${XTREAM_LOGIN_ERROR_MARKERS.dns} http://x`)).toBe('dns')
        expect(classifyXtreamLoginError(`${XTREAM_LOGIN_ERROR_MARKERS.refused} http://x`)).toBe('refused')
        expect(classifyXtreamLoginError(`${XTREAM_LOGIN_ERROR_MARKERS.timeout} http://x`)).toBe('timeout')
        expect(classifyXtreamLoginError(`${XTREAM_LOGIN_ERROR_MARKERS.offline} http://x`)).toBe('offline')
    })

    it('reconhece também o erro cru que o main NÃO reescreve', () => {
        expect(classifyXtreamLoginError('HTTP 401: Unauthorized')).toBe('auth')
        expect(classifyXtreamLoginError('Request failed with status code 401')).toBe('auth')
        expect(classifyXtreamLoginError('getaddrinfo ENOTFOUND exemplo')).toBe('dns')
        expect(classifyXtreamLoginError('connect ECONNREFUSED 10.0.0.1:8080')).toBe('refused')
        expect(classifyXtreamLoginError('timeout of 15000ms exceeded')).toBe('timeout')
        expect(classifyXtreamLoginError('Network Error')).toBe('offline')
        expect(classifyXtreamLoginError('Invalid URL')).toBe('url')
    })

    it('certificado é código próprio e o desconhecido não vira palpite', () => {
        expect(classifyXtreamLoginError('Certificado invalido do provedor. Ligue o modo compativel.')).toBe('tls')
        expect(classifyXtreamLoginError('unable to verify the first certificate')).toBe('tls')
        expect(classifyXtreamLoginError('')).toBe(null)
        expect(classifyXtreamLoginError('Resposta inválida do servidor')).toBe(null)
    })
})
