/**
 * Lista M3U lida de um arquivo do computador.
 *
 * Vive fora do `ipcHandlers.ts` de propósito: sem importar `electron`, este
 * módulo entra no `vitest run` (o `vitest.config.ts` só roda testes de módulos
 * puros do `electron/`). Sem essa separação, o teto de tamanho, a mensagem de
 * arquivo sumido e a decodificação cp1252 nasceriam sem um único teste.
 *
 * O `fs` é injetável pelo mesmo motivo — dá para exercitar cada caminho sem
 * escrever nada em disco.
 */
import { decodeM3uBytes, looksLikeM3u, parseM3u } from './m3uProtocol'
import { M3U_MAX_BYTES } from './httpLimits'

export interface LeitorDeArquivo {
    stat: (caminho: string) => Promise<{ size: number }>
    readFile: (caminho: string) => Promise<Uint8Array>
}

/** Mesmas mensagens do caminho de rede, mais uma própria para o arquivo sumido. */
export const ERRO_LISTA_INVALIDA = 'A URL não devolveu uma lista M3U válida'
export const ERRO_LISTA_VAZIA = 'Lista M3U sem canais'
export const ERRO_ARQUIVO_SUMIDO = 'Arquivo da lista não encontrado — ele foi movido ou apagado?'

/**
 * Canais de uma lista no disco.
 *
 * O `stat` vem ANTES do `readFile`, e não é detalhe: sem ele, um arquivo de
 * vários GB entra inteiro na memória do processo principal antes de qualquer
 * checagem. O teto é o mesmo do caminho de rede (`M3U_MAX_BYTES`) — uma lista
 * não fica maior por estar no disco.
 */
export async function lerCanaisM3uDoDisco(caminho: string, fs: LeitorDeArquivo) {
    let tamanho: number
    try {
        tamanho = (await fs.stat(caminho)).size
    } catch {
        throw new Error(ERRO_ARQUIVO_SUMIDO)
    }
    if (tamanho > M3U_MAX_BYTES) {
        throw new Error(`Lista grande demais (${Math.round(tamanho / 1024 / 1024)} MB)`)
    }

    let bytes: Uint8Array
    try {
        bytes = await fs.readFile(caminho)
    } catch {
        throw new Error(ERRO_ARQUIVO_SUMIDO)
    }

    const texto = decodeM3uBytes(bytes)
    if (!looksLikeM3u(texto)) throw new Error(ERRO_LISTA_INVALIDA)
    const canais = parseM3u(texto)
    if (canais.length === 0) throw new Error(ERRO_LISTA_VAZIA)
    return canais
}
