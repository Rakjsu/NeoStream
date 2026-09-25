/**
 * Confinamento dos caminhos da pasta de downloads — puro, sem I/O.
 *
 * O nome da série vem do CATÁLOGO DO PROVEDOR e chega até o main sem passar
 * por lugar nenhum que o valide. `path.join(downloads, nome)` com um nome como
 * `..\..\..\Documents` resolve para fora do sandbox do app, e o handler apaga
 * recursivamente. Aqui tudo o que vem de fora vira um NOME DE BASE saneado e
 * é reancorado sob a raiz de downloads, com a checagem de prefixo como rede
 * de segurança final.
 */

import path from 'path'

/**
 * Mesma regra que o `download:start` usa para criar a pasta — precisa ser
 * literalmente a mesma função, senão criar e apagar divergem e o botão de
 * excluir série vira no-op (era o caso antes desta correção).
 */
export function sanitizeDownloadName(name: string): string {
    return String(name ?? '').replace(/[<>:"/\\|?*]/g, '_').substring(0, 200)
}

/**
 * Comparação de prefixo tolerante a caixa no Windows (C:\ vs c:\).
 *
 * Exportada porque o confinamento nas pastas do app deixou de ser assunto só
 * do download: o `mpv:play` usa a MESMA regra pra decidir se um arquivo do
 * disco é nosso (gravação do DVR ou download) antes de entregá-lo ao processo
 * externo. Uma segunda cópia da regra é exatamente o que este arquivo existe
 * pra evitar.
 */
export function isInside(root: string, target: string): boolean {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep
    if (path.sep === '\\') {
        return target.toLowerCase().startsWith(prefix.toLowerCase())
    }
    return target.startsWith(prefix)
}

/**
 * Pasta de uma série sob `<downloads>/series/<nome saneado>`.
 * Devolve `null` quando o nome não sobra nada utilizável (vazio, só pontos)
 * ou quando o resultado escaparia da raiz.
 */
export function resolveSeriesFolder(downloadsRoot: string, folderName: unknown): string | null {
    if (typeof folderName !== 'string') return null

    const safe = sanitizeDownloadName(folderName).trim()
    // `.` e `..` sobrevivem ao saneamento (ponto não é caractere proibido em
    // nome de arquivo) e são exatamente os que sobem de diretório.
    if (!safe || /^\.+$/.test(safe)) return null

    const seriesRoot = path.resolve(downloadsRoot, 'series')
    const target = path.resolve(seriesRoot, safe)

    return isInside(seriesRoot, target) ? target : null
}

/** O que identifica um download no disco — é o que o renderer tem do item. */
export interface DescritorDeDownload {
    name: string
    type: string
    seriesName?: string
    season?: number
    episode?: number
}

/**
 * Onde o `download:start` grava o arquivo final (as partes do caminho
 * paralelo ficam ao lado, em `<arquivo>.partN`).
 *
 * Uma função só para quem CRIA e quem APAGA, pelo mesmo motivo do
 * `sanitizeDownloadName`: o cancelamento de um download que o main já
 * esqueceu (pausado, falhou, app reaberto) recalcula o caminho a partir do
 * descritor — se a regra divergir, a limpeza vira no-op em silêncio.
 *
 * Não confina: `type` chega do renderer e `..` sobe de diretório. Quem apaga
 * passa o resultado por `resolveDownloadFile`.
 */
export function caminhoDoDownload(downloadsRoot: string, d: DescritorDeDownload): string {
    if (d.type === 'episode' && d.seriesName && d.season !== undefined && d.episode !== undefined) {
        // Series/SeriesName/Temporada X/EpY.mp4
        return path.join(downloadsRoot, 'series', sanitizeDownloadName(d.seriesName), `Temporada ${d.season}`, `Ep${d.episode}.mp4`)
    }
    if (d.type === 'movie') {
        return path.join(downloadsRoot, 'movies', sanitizeDownloadName(`${d.name}.mp4`))
    }
    return path.join(downloadsRoot, d.type, sanitizeDownloadName(`${d.name}.mp4`))
}

/**
 * Arquivo dentro da pasta de downloads. Aceita caminho absoluto (é o que o
 * renderer guarda), mas só se cair mesmo debaixo da raiz — caminho relativo
 * com `..`, outra pasta do usuário e UNC (`\\host\share`) são recusados.
 */
export function resolveDownloadFile(downloadsRoot: string, filePath: unknown): string | null {
    if (typeof filePath !== 'string' || !filePath.trim()) return null

    const root = path.resolve(downloadsRoot)
    const target = path.resolve(root, filePath)

    return isInside(root, target) ? target : null
}
