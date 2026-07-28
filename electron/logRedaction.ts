/**
 * Redator central de credenciais — função pura: sem Electron, sem fs, sem rede.
 *
 * É o único lugar que sabe como uma credencial se parece neste app, e todo
 * caminho que grava texto em disco passa por aqui:
 *   - logger.ts pluga `redactLogLine` no FIM da cadeia de transforms do
 *     transporte de arquivo do electron-log, então TUDO que qualquer módulo
 *     logar (string, objeto, stderr do ffmpeg, erro de rede do axios) é
 *     redigido antes de tocar o main.log;
 *   - diagnosticsProtocol/diagnosticsHandlers usam `redactSecrets` no relatório
 *     e na exportação do log.
 *
 * O ponto que quebrava antes: o Xtream põe usuário e senha no CAMINHO da URL
 * (`/live/USER/SENHA/123.ts`), não em query string — um redator que só olha
 * `?password=` deixa passar o vazamento mais comum do app.
 */

export const REDACTED = '***REDACTED***'

/**
 * Chaves que carregam segredo em JSON e na saída do `util.inspect` (formato que
 * o electron-log usa no arquivo: chave SEM aspas, valor entre aspas simples).
 * `username` entra junto porque a credencial do provedor é o par usuário+senha,
 * e o redator antigo já mascarava `username=` na query — a assimetria entre os
 * dois formatos era justamente o buraco.
 */
const SECRET_KEY = 'password|passwd|pwd|senha|username|user_name|usuario|api[-_]?key|access[-_]?token|auth[-_]?token'

/**
 * Parâmetros de query que carregam segredo (Xtream, TMDB, controle web).
 * `token` ficou DE FORA de propósito: o log do proxy DLNA usa `token=` como
 * campo de diagnóstico (já truncado em 8 caracteres) e mascará-lo cegaria o
 * suporte sem fechar nenhum dos vazamentos desta correção.
 */
const SECRET_PARAM = 'username|password|api_key|apikey|pin'

/** `http://usuario:senha@host` — credencial no userinfo da URL. */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi

/**
 * Credencial no CAMINHO do Xtream: `/live|movie|series|timeshift/USER/PASS/…`.
 *
 * O lookahead exige um terceiro segmento com cara de id de stream (numérico ou
 * com extensão) de propósito: sem ele, caminhos legítimos de terceiros como
 * `/movie/550/videos` (TMDB) teriam o id e o recurso mascarados, e o log
 * perderia informação útil pro suporte sem fechar vazamento nenhum.
 */
const XTREAM_PATH =
    /(\/(?:live|movie|series|timeshift)\/)[^/\s?#'"]+\/[^/\s?#'"]+(?=\/(?:\d+|[A-Za-z0-9_-]+\.[a-z0-9]{2,5})(?![A-Za-z0-9_.-]))/gi

/** `?username=…&password=…`, `?api_key=…`, `?pin=…`. Valor para no `&`. */
const QUERY_PARAM = new RegExp(`\\b(${SECRET_PARAM})=[^&\\s"']*`, 'gi')

/** `Authorization: Bearer <token>` / `Basic <base64>`. */
const AUTH_SCHEME = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi

/** `"password":"x"`, `password: 'x'`, `'Api-Key': 'x'` — valor entre aspas. */
const QUOTED_KV = new RegExp(`(["']?)\\b(${SECRET_KEY})\\b\\1(\\s*[:=]\\s*)(["'])[^"'\\n\\r]*\\4`, 'gi')

/** `password=x`, `senha: x`, `Api-Key: x` — valor sem aspas, para no separador. */
const UNQUOTED_KV = new RegExp(`\\b(${SECRET_KEY})\\b(\\s*[:=]\\s*)[^\\s,;&}\\])"'<>]+`, 'gi')

/**
 * Mascara credenciais em um texto qualquer (linha de log, relatório, stderr).
 *
 * Conservador por construção: cada regra tem o valor delimitado (nunca cruza
 * quebra de linha, `&`, aspas ou fim de segmento), para que uma mensagem normal
 * de diagnóstico chegue intacta ao suporte.
 */
export function redactSecrets(text: string): string {
    if (!text) return text

    return text
        .replace(URL_USERINFO, '$1***:***@')
        .replace(XTREAM_PATH, '$1***/***')
        .replace(QUERY_PARAM, `$1=${REDACTED}`)
        .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
        .replace(QUOTED_KV, `$1$2$1$3$4${REDACTED}$4`)
        .replace(UNQUOTED_KV, `$1$2${REDACTED}`)
}

/**
 * Transform final do transporte de arquivo do electron-log. Nesse ponto da
 * cadeia o `toString` já devolveu a linha formatada, então basta redigir a
 * string — objeto, Error e stderr do ffmpeg já viraram texto.
 */
export function redactLogLine({ data }: { data: unknown }): string {
    return redactSecrets(typeof data === 'string' ? data : String(data))
}
