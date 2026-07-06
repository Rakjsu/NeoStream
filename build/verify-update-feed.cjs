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

function sha512Base64(filePath) {
    return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64')
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

    // electron-builder names mac artifacts on disk with a space/dot in the
    // product name ("NeoStream IPTV-…") but lists them in latest-mac.yml with a
    // dash ("NeoStream-IPTV-…"). Match by a separator-insensitive key so the
    // feed still resolves to the real file (content — hence sha512 — is equal).
    const normalize = (s) => s.toLowerCase().replace(/[\s._-]+/g, '-')
    const byNorm = new Map(releaseFiles.map(f => [normalize(f), f]))
    const resolveFile = (url) => {
        if (fs.existsSync(path.join(RELEASE_DIR, url))) return url
        return byNorm.get(normalize(url)) ?? null
    }

    let problems = 0
    for (const feed of feeds) {
        const entries = parseFeed(fs.readFileSync(path.join(RELEASE_DIR, feed), 'utf-8'))
        if (entries.length === 0) {
            console.error(`[verify-update-feed] ${feed}: sem entradas em files:`)
            problems++
            continue
        }
        for (const entry of entries) {
            const resolved = resolveFile(entry.url)
            if (!resolved) {
                console.error(`[verify-update-feed] ${feed}: arquivo ausente → ${entry.url}`)
                problems++
                continue
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

main()
