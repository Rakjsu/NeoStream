/**
 * Que falha de login Xtream foi esta — independente do idioma da mensagem.
 *
 * Por que existe: `electron/xtreamClient.ts` REESCREVE o erro de rede em
 * português antes de devolvê-lo ('Servidor não encontrado: …', 'Conexão
 * recusada: …', 'Tempo esgotado ao conectar em: …', 'Usuário ou senha
 * incorretos'), e a ponte do IPC achata tudo em `{ success, error: string }`
 * (`auth:login` devolve `getErrorMessage(error)`, que é só `error.message`).
 * A única coisa que atravessa é o texto — não existe campo `code`.
 *
 * Então a tela de Login precisa reconhecer o texto para poder traduzi-lo. Ela
 * tentava isso procurando 'ENOTFOUND' / 'ECONNREFUSED' / 'timeout' na
 * mensagem, tokens que NENHUMA das frases reescritas contém: o resultado era
 * a frase em português na cara de quem usa o app em inglês ou espanhol.
 *
 * Aqui ficam as frases do main em um lugar só, e o par
 * `electron/mensagemDoErroDeAutenticacao.test.ts` roda o `authenticate()` de
 * verdade e confere que o que ele escreve continua caindo no código certo —
 * é esse teste que impede as duas pontas de divergirem em silêncio.
 *
 * Módulo puro de propósito: sem DOM, sem React, sem Node. Ele é lido tanto
 * pelo renderer quanto por um teste que vive em `electron/`.
 */

/** O que deu errado, independente do idioma da mensagem. */
export type XtreamLoginErrorCode =
    | 'auth'      // credencial recusada pelo provedor (auth=0 ou HTTP 401)
    | 'dns'       // host não resolve
    | 'refused'   // host resolve mas recusa a conexão
    | 'timeout'   // servidor não respondeu a tempo
    | 'offline'   // requisição saiu e não voltou (rede indisponível)
    | 'tls'       // certificado do provedor não é confiável
    | 'url'       // a URL digitada não é uma URL

/**
 * Começo EXATO da mensagem que `electron/xtreamClient.ts` escreve em cada
 * caso. Mudar a frase lá sem mudar aqui quebra
 * `electron/mensagemDoErroDeAutenticacao.test.ts` — é para isso que ele serve.
 *
 * `tls` e `url` ficam de fora: aquelas mensagens não são escritas pelo
 * xtreamClient (vêm do certificatePolicy e do próprio `new URL`), e são
 * reconhecidas por token abaixo.
 */
export const XTREAM_LOGIN_ERROR_MARKERS: Record<Exclude<XtreamLoginErrorCode, 'tls' | 'url'>, string> = {
    auth: 'Usuário ou senha incorretos',
    dns: 'Servidor não encontrado:',
    refused: 'Conexão recusada:',
    timeout: 'Tempo esgotado ao conectar em:',
    offline: 'Falha na conexão com:',
}

/** Ordem determinística de teste dos marcadores (não a do objeto literal). */
const ORDEM_DOS_MARCADORES: ReadonlyArray<Exclude<XtreamLoginErrorCode, 'tls' | 'url'>> =
    ['auth', 'dns', 'refused', 'timeout', 'offline']

/**
 * Tokens crus, para o que o main NÃO reescreveu: o `HTTP 401: Unauthorized`
 * do próprio `authenticate()`, o erro do axios que escapa pelo `throw error`
 * final, o guia de certificado do `certificatePolicy`, e o `Invalid URL` que
 * o `new URL()` lança antes de qualquer requisição.
 *
 * Testados nesta ordem, e só depois dos marcadores acima.
 */
const TOKENS_CRUS: ReadonlyArray<readonly [XtreamLoginErrorCode, readonly string[]]> = [
    ['url', ['invalid url']],
    ['tls', ['certificado inválido', 'certificado invalido', 'certificate', 'self-signed', 'self signed']],
    ['dns', ['enotfound', 'eai_again']],
    ['refused', ['econnrefused']],
    ['timeout', ['etimedout', 'econnaborted', 'timeout']],
    ['auth', ['http 401', 'status code 401', 'unauthorized', 'authentication']],
    ['offline', ['enetunreach', 'ehostunreach', 'network error', 'fetch']],
]

/**
 * Mensagem de erro de login (venha ela do main ou de um throw do renderer) →
 * código. `null` quando nada casa: aí a mensagem crua é o melhor que existe e
 * quem chama decide o que mostrar.
 */
export function classifyXtreamLoginError(message: string): XtreamLoginErrorCode | null {
    const texto = typeof message === 'string' ? message : ''
    if (!texto) return null
    const minusculo = texto.toLowerCase()

    for (const code of ORDEM_DOS_MARCADORES) {
        if (texto.includes(XTREAM_LOGIN_ERROR_MARKERS[code])) return code
    }

    for (const [code, tokens] of TOKENS_CRUS) {
        if (tokens.some(token => minusculo.includes(token))) return code
    }

    return null
}
