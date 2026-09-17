/**
 * Verify the electron-updater feed(s) before they're attached to a release.
 *
 * Each OS job emits a `latest*.yml` in release/ (latest.yml = Windows,
 * latest-mac.yml, latest-linux.yml). The feed lists every artifact with its
 * sha512 + size; auto-update refuses a download whose hash doesn't match. If a
 * later build step (e.g. the custom Windows installer) rewrote or truncated an
 * artifact after the feed was generated, the feed silently goes stale and
 * Windows updates fail with "checksum mismatch" in users' hands.
 *
 * This script recomputes the hash/size of every referenced file and fails the
 * job on any mismatch or missing file — so we catch it in CI, not on a desktop.
 *
 * Dependency-free (same spirit as the rest of build/): a tiny line parser for
 * the fixed electron-builder YAML shape instead of pulling js-yaml.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const RELEASE_DIR = path.join(__dirname, '..', 'release')

/** Parse the `files:` entries (url/sha512/size) out of an electron-updater yml. */
function parseFeed(text) {
    const entries = []
    let current = null
    for (const rawLine of text.split(/\r?\n/)) {
        const urlMatch = rawLine.match(/^\s*-\s*url:\s*(.+?)\s*$/)
        if (urlMatch) {
            current = { url: decodeURIComponent(stripQuotes(urlMatch[1])) }
            entries.push(current)
            continue
        }
        if (!current) continue
        const shaMatch = rawLine.match(/^\s+sha512:\s*(.+?)\s*$/)
        if (shaMatch) { current.sha512 = stripQuotes(shaMatch[1]); continue }
        const sizeMatch = rawLine.match(/^\s+size:\s*(\d+)\s*$/)
        if (sizeMatch) { current.size = Number(sizeMatch[1]); continue }
    }
    return entries
}

function stripQuotes(s) {
    return s.replace(/^['"]|['"]$/g, '')
}

/** O `version:` do topo do latest*.yml — é ele que o updater compara. */
function parseFeedVersion(text) {
    const match = text.match(/^version:\s*(.+?)\s*$/m)
    return match ? stripQuotes(match[1]) : null
}

/**
 * A tag, o package.json e o feed falam da MESMA versão?
 *
 * O bump da versão é um commit manual separado ("chore(release): prepare
 * v4.49.0"). Se a tag `v4.50.0` for empurrada de um commit ainda em 4.49.0, o
 * electron-builder gera os três `latest*.yml` com `version: 4.49.0` — e o
 * updater de quem já está em 4.49.0 compara, conclui "já estou atualizado" e
 * NUNCA oferece a nova versão. Para 100% dos usuários a release simplesmente
 * não existe.
 *
 * Não é invisível de todo: os artefatos saem com o número velho no nome
 * (`NeoStream-IPTV-4.49.0-arm64.dmg` sob a tag v4.50.0), então a divergência
 * fica na página da release para quem olhar. O que falta é alguém olhar — e
 * esse alguém é este script, que já roda nos três sistemas.
 *
 * Devolve a mensagem do problema, ou null.
 */
function conferirVersao(feedVersion, pkgVersion, refName) {
    if (!feedVersion) {
        return 'o feed não declara `version:` — o updater não tem o que comparar.'
    }
    if (feedVersion !== pkgVersion) {
        return `versão do feed (${feedVersion}) difere da do package.json (${pkgVersion}).`
    }
    // Fora do CI não há tag; localmente basta o par feed↔package.json.
    const tag = String(refName || '').replace(/^v/, '')
    if (tag && tag !== pkgVersion) {
        return `a tag (${refName}) não bate com a versão publicada (${pkgVersion}). `
            + 'O bump do package.json é um commit separado: a tag saiu de um commit velho, '
            + 'e o updater de quem já está nessa versão nunca vai oferecer a nova.'
    }
    return null
}

function sha512Base64(filePath) {
    return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64')
}

// electron-builder names mac artifacts on disk with a space/dot in the product
// name ("NeoStream IPTV-…") but lists them in latest-mac.yml with a dash
// ("NeoStream-IPTV-…"). Collapse all separators so the feed url still resolves
// to the real file (content — hence sha512 — is equal).
function normalizeName(s) {
    return s.toLowerCase().replace(/[\s._-]+/g, '-')
}

/** The real filename in `releaseFiles` for a feed url, or null. */
function resolveFileName(url, releaseFiles) {
    if (releaseFiles.includes(url)) return url
    const target = normalizeName(url)
    return releaseFiles.find(f => normalizeName(f) === target) ?? null
}

/**
 * O nome do arquivo sobrevive ao upload do GitHub?
 *
 * Este guarda nasceu conferindo a pasta `release/` local, e o `normalizeName`
 * acima existe porque ali o arquivo do mac tem ESPAÇO e o feed tem hífen. O
 * que ninguém conferia era o passo seguinte: o GitHub, ao receber um asset com
 * espaço no nome, troca o espaço por PONTO. Aí o feed pede
 * `NeoStream-IPTV-4.48.0-arm64.dmg`, a release publica
 * `NeoStream.IPTV-4.48.0-arm64.dmg`, e o electron-updater baixa um 404.
 *
 * Medido na v4.48.0 e na v4.47.1: as duas saíram assim, e o Windows só escapou
 * porque o `nsis`/`portable` têm `artifactName` sem espaço. A correção de raiz
 * foi dar `artifactName` a `mac`, `dmg` e `linux` também — este guarda existe
 * para que o dia em que alguém tirar isso não passe batido de novo.
 *
 * Regra: o nome no disco tem que ser EXATAMENTE o do feed. Sem tolerância,
 * porque a tolerância é justamente o que escondeu o problema.
 */
function verificaNomePublicavel(url, real) {
    if (url === real) return null
    return `nome do feed difere do arquivo: feed="${url}" disco="${real}". `
        + 'Depois do upload o GitHub substitui espaço por ponto e o updater busca um 404. '
        + 'Defina `artifactName` sem espaço para este alvo no package.json (o nsis já faz isso).'
}

function main() {
    if (!fs.existsSync(RELEASE_DIR)) {
        console.error(`[verify-update-feed] pasta não encontrada: ${RELEASE_DIR}`)
        process.exit(1)
    }
    const releaseFiles = fs.readdirSync(RELEASE_DIR)
    const feeds = releaseFiles.filter(f => /^latest.*\.yml$/.test(f))
    if (feeds.length === 0) {
        console.error('[verify-update-feed] nenhum latest*.yml em release/ — nada pra verificar')
        process.exit(1)
    }

    const pkgVersion = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
    ).version

    let problems = 0
    for (const feed of feeds) {
        const texto = fs.readFileSync(path.join(RELEASE_DIR, feed), 'utf-8')
        const versaoRuim = conferirVersao(parseFeedVersion(texto), pkgVersion, process.env.GITHUB_REF_NAME)
        if (versaoRuim) {
            console.error(`[verify-update-feed] ${feed}: ${versaoRuim}`)
            problems++
        }
        const entries = parseFeed(texto)
        if (entries.length === 0) {
            console.error(`[verify-update-feed] ${feed}: sem entradas em files:`)
            problems++
            continue
        }
        for (const entry of entries) {
            const resolved = resolveFileName(entry.url, releaseFiles)
            if (!resolved) {
                console.error(`[verify-update-feed] ${feed}: arquivo ausente → ${entry.url}`)
                problems++
                continue
            }
            const nomeRuim = verificaNomePublicavel(entry.url, resolved)
            if (nomeRuim) {
                console.error(`[verify-update-feed] ${feed}: ${nomeRuim}`)
                problems++
            }
            const target = path.join(RELEASE_DIR, resolved)
            const actualSize = fs.statSync(target).size
            if (typeof entry.size === 'number' && actualSize !== entry.size) {
                console.error(`[verify-update-feed] ${feed}: tamanho não bate em ${entry.url} (feed ${entry.size} ≠ real ${actualSize})`)
                problems++
            }
            const actualSha = sha512Base64(target)
            if (entry.sha512 && actualSha !== entry.sha512) {
                console.error(`[verify-update-feed] ${feed}: sha512 não bate em ${entry.url}`)
                problems++
            } else {
                console.log(`[verify-update-feed] OK ${feed} → ${entry.url}`)
            }
        }
    }

    if (problems > 0) {
        console.error(`[verify-update-feed] ${problems} problema(s) — o feed de auto-update está inconsistente.`)
        process.exit(1)
    }
    console.log('[verify-update-feed] todos os feeds batem com os artefatos.')
}

// Run when invoked directly (CI); stay importable for tests.
if (require.main === module) main()

module.exports = { parseFeed, parseFeedVersion, conferirVersao, normalizeName, resolveFileName }
