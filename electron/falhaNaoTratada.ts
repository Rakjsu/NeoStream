/**
 * 🧯 O que escrever no log quando o processo principal quebra sozinho.
 *
 * O renderer tem rede desde sempre (`src/main.tsx` escuta `error` e
 * `unhandledrejection`, manda para o main e ainda tem teto de 20 mensagens).
 * O main — que roda o ffmpeg do DVR e do timeshift, o servidor do controle
 * web, os sockets de cast e os streams de download — não tinha nada: grep por
 * `uncaughtException`, `unhandledRejection` e `errorHandler` no diretório
 * inteiro não devolvia uma linha. Qualquer throw assíncrono fora de um
 * `.on('error')` — o EPIPE de `stream.write()` é o caso conhecido — subia até
 * o Electron, que abria o diálogo nativo de erro e derrubava o app **sem
 * deixar rastro** no arquivo que a pessoa exporta em Diagnósticos.
 *
 * Este módulo é a parte que dá para testar: como descrever o motivo (que pode
 * ser qualquer coisa, não só Error) e quando parar de escrever, para um laço
 * de falhas não encher o disco.
 */

/** Teto de mensagens por execução — o mesmo do renderer. */
export const LIMITE_DE_FALHAS = 20

/**
 * Texto de uma falha para o log.
 *
 * `reason` de uma promessa rejeitada é literalmente qualquer valor: Error,
 * string, objeto do provedor, `undefined`. Sem tratar os três casos, a linha
 * mais importante do arquivo seria "[object Object]".
 */
export function descreverFalha(motivo: unknown): string {
    if (motivo instanceof Error) {
        return motivo.stack || `${motivo.name}: ${motivo.message}`
    }
    if (typeof motivo === 'string') return motivo
    if (motivo === undefined) return 'undefined'
    if (motivo === null) return 'null'
    try {
        return JSON.stringify(motivo)
    } catch {
        // Referência circular, BigInt, getter que lança: o que importa é não
        // trocar a falha real por uma falha ao descrever a falha.
        return String(motivo)
    }
}

/**
 * Contador com teto: devolve `true` enquanto vale escrever, e avisa uma única
 * vez que passou do limite.
 *
 * Um laço de exceções (um `setInterval` que quebra a cada tick, por exemplo)
 * encheria o main.log em minutos — e o arquivo que a pessoa manda no relatório
 * de bug é justamente esse.
 */
export function criarLimitador(maximo: number = LIMITE_DE_FALHAS) {
    let vistas = 0
    return function podeRegistrar(): 'sim' | 'ultima' | 'nao' {
        vistas += 1
        if (vistas < maximo) return 'sim'
        if (vistas === maximo) return 'ultima'
        return 'nao'
    }
}
