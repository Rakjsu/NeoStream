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

/** Comparação de prefixo tolerante a caixa no Windows (C:\ vs c:\). */
function isInside(root: string, target: string): boolean {
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
