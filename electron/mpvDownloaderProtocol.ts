/**
 * EXPERIMENTAL — MPV auto-download.
 *
 * Pure helpers for picking/parsing the mpv Windows build release asset and
 * for the download progress math — no Electron, no fs, no network, no state.
 * Everything here is unit-testable; the side-effectful engine (fetch, file
 * streaming, tar extraction) lives in mpvDownloader.ts.
 *
 * Source: GitHub releases of zhongfly/mpv-winbuild (daily Windows builds).
 * Verified 2026-06-12: the release ships ONLY .7z assets (no .zip), e.g.
 * mpv-x86_64-20260612-git-7d245fd100.7z (~31 MB). Windows 10+ bundles
 * bsdtar as tar.exe (libarchive), which extracts 7-Zip archives natively,
 * so .7z needs no extra tooling. The picker still prefers .zip should the
 * repo ever publish one.
 */

export const MPV_RELEASE_API_URL = 'https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest'

export interface MpvReleaseAsset {
    name: string
    browser_download_url: string
    size: number
}

export interface MpvRelease {
    tag_name?: string
    assets?: MpvReleaseAsset[]
}

/**
 * Exactly the plain x86_64 player build: `mpv-x86_64-<date>-git-<hash>.<ext>`.
 * The strict date+hash shape rules out every sibling variant — `-v3-`
 * (needs AVX2 CPUs), `aarch64`, `mpv-dev-` (libmpv SDK), `mpv-debug-` and
 * `-lgpl-` — without listing them.
 */
const ASSET_NAME_PATTERN = /^mpv-x86_64-\d{8}-git-[0-9a-f]+\.(zip|7z)$/i

/**
 * Pick the downloadable player asset from a release's asset list.
 * Prefers .zip over .7z when both exist (plain deflate, fastest extract);
 * returns null when no suitable asset is present.
 */
export function pickMpvAsset(assets: ReadonlyArray<MpvReleaseAsset> | undefined | null): MpvReleaseAsset | null {
    if (!Array.isArray(assets)) return null
    const matches = assets.filter((asset) =>
        typeof asset?.name === 'string'
        && typeof asset?.browser_download_url === 'string'
        && ASSET_NAME_PATTERN.test(asset.name))
    if (matches.length === 0) return null
    return matches.find((asset) => asset.name.toLowerCase().endsWith('.zip')) ?? matches[0]
}

/** "mpv-x86_64-20260612-git-7d245fd100.7z" -> "20260612-git-7d245fd100". */
export function parseMpvVersionFromAssetName(name: string): string | null {
    const match = /^mpv-x86_64-(\d{8}-git-[0-9a-f]+)\./i.exec(name)
    return match ? match[1] : null
}

export interface MpvDownloadProgress {
    /** 0..100 integer; 0 when the total size is unknown. */
    percent: number
    transferredMB: number
    totalMB: number
}

const toMB = (bytes: number): number => Math.round((bytes / (1024 * 1024)) * 10) / 10

/** Progress snapshot sent to the renderer (mpv:download-progress). */
export function computeDownloadProgress(transferredBytes: number, totalBytes: number): MpvDownloadProgress {
    const safeTransferred = Math.max(0, transferredBytes)
    const safeTotal = Math.max(0, totalBytes)
    const percent = safeTotal > 0
        ? Math.min(100, Math.floor((safeTransferred / safeTotal) * 100))
        : 0
    return { percent, transferredMB: toMB(safeTransferred), totalMB: toMB(safeTotal) }
}

/**
 * Arguments for Windows' bundled bsdtar (C:\Windows\System32\tar.exe).
 * bsdtar auto-detects the archive format (zip and 7z both supported).
 */
export function buildExtractArgs(archivePath: string, destDir: string): string[] {
    return ['-xf', archivePath, '-C', destDir]
}
