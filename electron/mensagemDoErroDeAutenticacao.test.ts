import { describe, it, expect, vi, beforeEach } from 'vitest'
import { XTREAM_LOGIN_ERROR_MARKERS, classifyXtreamLoginError } from '../src/services/xtreamLoginError'
import { getErrorMessage } from './errorMessage'

/**
 * D083 — a OUTRA ponta.
 *
 * `src/pages/erroDeLoginTraduzido.test.tsx` prova que a tela de Login traduz
 * cada código. Este aqui roda o `authenticate()` de VERDADE (axios dublado,
 * sem rede) e prova que a mensagem que o main realmente joga no IPC é a que o
 * classificador do renderer reconhece.
 *
 * Sem este par, alguém reescreve a frase em `electron/xtreamClient.ts`, o
 * Login volta a mostrar português e nenhum teste reclama — que é exatamente
 * como o defeito nasceu. (Importar `../src/...` de um teste em `electron/` é
 * o padrão daqui: veja `electron/senhaNoBackupAutomatico.test.ts`.)
 */

// certificatePolicy importa 'electron' — aqui só interessa o veredicto TLS.
const tlsState = vi.hoisted(() => ({ invalido: false }))
vi.mock('./certificatePolicy', () => ({
    isTlsCertificateError: () => tlsState.invalido,
    getInvalidCertificateGuidance: () => 'Certificado invalido do provedor. Ligue o modo compativel.',
    resolveProviderHttpsAgent: async () => undefined,
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// A retentativa real dorme entre tentativas; aqui ela não é o assunto.
vi.mock('./fetchRetry', () => ({
    fetchWithRetry: async <T>(doFetch: () => Promise<T>) => doFetch(),
}))

const axiosState = vi.hoisted(() => ({
    responder: async (): Promise<unknown> => ({ status: 200, statusText: 'OK', data: {} }),
}))
vi.mock('axios', () => ({ default: { get: async () => axiosState.responder() } }))

const { XtreamClient } = await import('./xtreamClient')

/** Erro de rede no formato que o axios entrega ao `authenticate()`. */
function erroDeRede(code: string, message = `connect ${code} 10.0.0.1:8080`) {
    return Object.assign(new Error(message), { code, request: {}, response: undefined })
}

/**
 * Roda o authenticate e devolve a string que sairia pelo IPC — passando pelo
 * MESMO `getErrorMessage` que `auth:login` / `playlists:add` usam, para que a
 * ponte inteira (throw → getErrorMessage → `{ error }`) fique presa aqui.
 */
async function mensagemDoErro(): Promise<string> {
    const client = new XtreamClient('http://exemplo:8080', 'u', 'p')
    try {
        await client.authenticate()
    } catch (error: unknown) {
        return getErrorMessage(error)
    }
    throw new Error('authenticate() não falhou — o caso não foi exercitado')
}

beforeEach(() => {
    tlsState.invalido = false
    axiosState.responder = async () => ({ status: 200, statusText: 'OK', data: {} })
})

describe('authenticate(): a mensagem que sai pelo IPC é classificável (D083)', () => {
    it('credencial recusada (auth=0) → código auth', async () => {
        axiosState.responder = async () => ({ status: 200, statusText: 'OK', data: { user_info: { auth: 0 } } })
        const mensagem = await mensagemDoErro()

        expect(mensagem).toBe(XTREAM_LOGIN_ERROR_MARKERS.auth)
        expect(classifyXtreamLoginError(mensagem)).toBe('auth')
    })

    it('HTTP 401 do provedor → código auth', async () => {
        axiosState.responder = async () => ({ status: 401, statusText: 'Unauthorized', data: {} })
        const mensagem = await mensagemDoErro()

        expect(mensagem).toBe('HTTP 401: Unauthorized')
        expect(classifyXtreamLoginError(mensagem)).toBe('auth')
    })

    it('ENOTFOUND → código dns, e a frase começa pelo marcador da tabela', async () => {
        axiosState.responder = async () => { throw erroDeRede('ENOTFOUND', 'getaddrinfo ENOTFOUND exemplo') }
        const mensagem = await mensagemDoErro()

        expect(mensagem.startsWith(XTREAM_LOGIN_ERROR_MARKERS.dns)).toBe(true)
        expect(classifyXtreamLoginError(mensagem)).toBe('dns')
    })

    it('ECONNREFUSED → código refused, e a frase começa pelo marcador da tabela', async () => {
        axiosState.responder = async () => { throw erroDeRede('ECONNREFUSED') }
        const mensagem = await mensagemDoErro()

        expect(mensagem.startsWith(XTREAM_LOGIN_ERROR_MARKERS.refused)).toBe(true)
        expect(classifyXtreamLoginError(mensagem)).toBe('refused')
    })

    it('ETIMEDOUT → código timeout, e a frase começa pelo marcador da tabela', async () => {
        axiosState.responder = async () => { throw erroDeRede('ETIMEDOUT') }
        const mensagem = await mensagemDoErro()

        expect(mensagem.startsWith(XTREAM_LOGIN_ERROR_MARKERS.timeout)).toBe(true)
        expect(classifyXtreamLoginError(mensagem)).toBe('timeout')
    })

    it('requisição sem resposta → código offline, e a frase começa pelo marcador', async () => {
        axiosState.responder = async () => { throw erroDeRede('EHOSTUNREACHX', 'Network hiccup') }
        const mensagem = await mensagemDoErro()

        expect(mensagem.startsWith(XTREAM_LOGIN_ERROR_MARKERS.offline)).toBe(true)
        expect(classifyXtreamLoginError(mensagem)).toBe('offline')
    })

    it('certificado inválido → código tls (guia do main, não marcador)', async () => {
        tlsState.invalido = true
        axiosState.responder = async () => { throw erroDeRede('DEPTH_ZERO_SELF_SIGNED_CERT', 'self signed certificate') }

        expect(classifyXtreamLoginError(await mensagemDoErro())).toBe('tls')
    })

    it('URL que não é URL → código url, sem nem chegar na rede', async () => {
        axiosState.responder = async () => { throw new Error('a rede não devia ter sido tocada') }
        const client = new XtreamClient('nao-e-url', 'u', 'p')
        let mensagem = ''
        try {
            await client.authenticate()
        } catch (error: unknown) {
            mensagem = getErrorMessage(error)
        }

        expect(classifyXtreamLoginError(mensagem)).toBe('url')
    })

    it('resposta sem user_info não é classificada (some como mensagem crua)', async () => {
        axiosState.responder = async () => ({ status: 200, statusText: 'OK', data: { server_info: {} } })
        const mensagem = await mensagemDoErro()

        expect(mensagem).toBe('Resposta inválida do servidor - sem informações de usuário')
        expect(classifyXtreamLoginError(mensagem)).toBe(null)
    })
})
