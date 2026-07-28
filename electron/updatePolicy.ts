/**
 * Política de confiança do auto-update — funções puras, sem electron.
 *
 * CONTEXTO (por que não dá simplesmente para "ligar a verificação"):
 * o NeoStream não é assinado com certificado de código. `signExecutable` e
 * `verifyUpdateCodeSignature` estão em `false` no package.json porque não há
 * certificado nenhum para assinar o instalador; se `verifyUpdateCodeSignature`
 * fosse `true`, o electron-updater rodaria `Get-AuthenticodeSignature` no .exe
 * baixado, não acharia assinatura válida e RECUSARIA 100% das atualizações.
 * Ou seja: ligar a verificação de assinatura só é possível comprando um
 * certificado de code signing (EV/OV) — não é uma mudança de código.
 *
 * O QUE DÁ PARA FAZER SEM CERTIFICADO: sem Authenticode, o único vínculo entre
 * o que a release publicou e o .exe que roda com elevação (nsis perMachine +
 * allowElevation) é o `sha512` que o `latest.yml` traz. E o electron-updater só
 * confere esse hash SE ele existir no feed — em `builder-util-runtime` o
 * DigestTransform só entra no pipe quando `options.sha512 != null`; sem sha512
 * o instalador é baixado e executado sem conferência alguma. Estas funções
 * fecham essa porta: o feed tem que ser o do GitHub oficial por https, e todo
 * artefato listado tem que trazer um sha512 no formato certo — caso contrário a
 * atualização é recusada em vez de instalada às cegas.
 */

export type PolicyVerdict = { ok: true } | { ok: false; reason: string }

export interface FeedFileEntry {
    url?: string
    sha512?: string
    size?: number
}

export interface FeedUpdateInfo {
    version?: string
    path?: string
    sha512?: string
    files?: FeedFileEntry[]
}

/** sha512 em base64 do electron-builder: 64 bytes → 86 chars + '=='. */
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/
/** Alguns feeds antigos usam hex de 128 chars — o próprio updater aceita. */
const SHA512_HEX = /^[a-fA-F0-9]{128}$/

export function isValidSha512(value: unknown): boolean {
    if (typeof value !== 'string') return false
    const trimmed = value.trim()
    return SHA512_BASE64.test(trimmed) || SHA512_HEX.test(trimmed)
}

/**
 * Recusa uma atualização cujo feed não publica hash verificável dos artefatos.
 * Sem sha512 o download não é conferido contra nada, e o instalador roda
 * elevado — é exatamente o caso em que a atualização tem que parar.
 */
export function checkUpdateArtifacts(info: FeedUpdateInfo | null | undefined): PolicyVerdict {
    if (!info || typeof info.version !== 'string' || info.version.trim() === '') {
        return { ok: false, reason: 'feed sem versão' }
    }

    const files = Array.isArray(info.files) ? info.files : []
    if (files.length === 0) {
        // Formato antigo: um único artefato em `path` + `sha512` na raiz.
        if (!isValidSha512(info.sha512)) {
            return { ok: false, reason: 'feed sem sha512 dos artefatos' }
        }
        return { ok: true }
    }

    for (const file of files) {
        if (!isValidSha512(file?.sha512)) {
            return { ok: false, reason: `artefato sem sha512 válido: ${file?.url ?? '(sem url)'}` }
        }
    }
    return { ok: true }
}

/** Pares `chave: valor` do topo do app-update.yml (formato fixo do electron-builder). */
function parseTopLevelYaml(raw: string): Record<string, string> {
    const result: Record<string, string> = {}
    for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/)
        if (!match) continue
        result[match[1].toLowerCase()] = match[2].trim().replace(/^['"]|['"]$/g, '')
    }
    return result
}

const GITHUB_FEED_HOSTS = new Set(['github.com', 'api.github.com'])

/**
 * Confere o `app-update.yml` que fica ao lado do app: é ele que diz de onde o
 * feed é buscado. Um arquivo trocado (instalação por-usuário, pasta gravável,
 * pacote adulterado) redireciona o updater para o servidor de quem escreveu —
 * e a partir daí o sha512 confere com o do atacante. Exigimos o provedor
 * github, o owner/repo esperados e nada que rebaixe o transporte para http.
 */
export function checkUpdateFeedConfig(
    raw: string | null | undefined,
    expected: { owner: string; repo: string },
): PolicyVerdict {
    if (!raw || raw.trim() === '') return { ok: false, reason: 'app-update.yml ausente ou vazio' }

    const config = parseTopLevelYaml(raw)
    if (config.provider !== 'github') {
        return { ok: false, reason: `provedor inesperado: ${config.provider || '(vazio)'}` }
    }
    if ((config.owner || '').toLowerCase() !== expected.owner.toLowerCase()) {
        return { ok: false, reason: `owner inesperado: ${config.owner || '(vazio)'}` }
    }
    if ((config.repo || '').toLowerCase() !== expected.repo.toLowerCase()) {
        return { ok: false, reason: `repo inesperado: ${config.repo || '(vazio)'}` }
    }
    if (config.protocol && config.protocol.toLowerCase() !== 'https') {
        return { ok: false, reason: `transporte rebaixado: ${config.protocol}` }
    }
    if (config.host && !GITHUB_FEED_HOSTS.has(config.host.toLowerCase())) {
        return { ok: false, reason: `host de feed inesperado: ${config.host}` }
    }
    // `url:` é do provedor genérico — num feed github ele só aparece se alguém
    // reescreveu o arquivo para apontar noutra direção.
    if (config.url) return { ok: false, reason: `url de feed sobrescrita: ${config.url}` }

    return { ok: true }
}
