/**
 * EXPERIMENTAL — MPV auto-download engine (main process).
 *
 * Downloads the latest mpv Windows build from GitHub (zhongfly/mpv-winbuild,
 * see mpvDownloaderProtocol.ts for the asset choice) into a caller-provided
 * directory, extracts it with Windows' bundled bsdtar (tar.exe handles both
 * .zip and .7z), and returns the path of the extracted mpv.exe.
 *
 * Deliberately Electron-free: the install dir, progress callback and abort
 * signal are injected, so the exact same code path can be exercised by a
 * plain Node script (and was, during development). The IPC wiring
 * (mpv:download-start / mpv:download-cancel) lives in mpvPlayer.ts.
 */

import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import {
    MPV_RELEASE_API_URL,
    buildExtractArgs,
    computeDownloadProgress,
    parseMpvVersionFromAssetName,
    pickMpvAsset,
    type MpvDownloadProgress,
    type MpvRelease,
} from './mpvDownloaderProtocol'

const DOWNLOAD_USER_AGENT = 'NeoStream-IPTV (mpv auto-download)'
const PROGRESS_MIN_INTERVAL_MS = 250
const EXTRACT_TIMEOUT_MS = 120_000
/** The zip/7z may root files directly or inside one wrapper folder. */
const EXE_SEARCH_MAX_DEPTH = 2

export type MpvInstallFailureReason =
    | 'network'
    | 'no-asset'
    | 'download-failed'
    | 'extract-failed'
    | 'exe-not-found'
    | 'disk'
    | 'cancelled'
    | 'in-progress'

export interface MpvInstallResult {
    success: boolean
    /** Absolute path of the installed mpv.exe (success only). */
    path?: string
    /** Build version parsed from the asset name, e.g. "20260612-git-7d245fd100". */
    version?: string
    reason?: MpvInstallFailureReason
}

export interface MpvInstallOptions {
    /** Directory owned by the downloader (e.g. {userData}/mpv). Created if missing. */
    installDir: string
    signal?: AbortSignal
    onProgress?: (progress: MpvDownloadProgress) => void
    /** Injectable for tests/scripts; defaults to the global fetch. */
    fetchImpl?: typeof fetch
}

class InstallError extends Error {
    constructor(readonly reason: MpvInstallFailureReason, message: string) {
        super(message)
    }
}

const throwIfAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new InstallError('cancelled', 'download cancelled')
}

async function fetchLatestRelease(fetchImpl: typeof fetch, signal?: AbortSignal): Promise<MpvRelease> {
    let response: Response
    try {
        response = await fetchImpl(MPV_RELEASE_API_URL, {
            signal,
            headers: {
                'User-Agent': DOWNLOAD_USER_AGENT,
                Accept: 'application/vnd.github+json',
            },
        })
    } catch (error) {
        throwIfAborted(signal)
        throw new InstallError('network', `release lookup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
        throw new InstallError('network', `release lookup failed: HTTP ${response.status}`)
    }
    try {
        return await response.json() as MpvRelease
    } catch {
        throw new InstallError('network', 'release lookup returned invalid JSON')
    }
}

async function downloadToFile(
    url: string,
    filePath: string,
    expectedBytes: number,
    fetchImpl: typeof fetch,
    onProgress?: (progress: MpvDownloadProgress) => void,
    signal?: AbortSignal,
): Promise<void> {
    let response: Response
    try {
        response = await fetchImpl(url, {
            signal,
            headers: { 'User-Agent': DOWNLOAD_USER_AGENT },
        })
    } catch (error) {
        throwIfAborted(signal)
        throw new InstallError('network', `download failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok || !response.body) {
        throw new InstallError('download-failed', `download failed: HTTP ${response.status}`)
    }

    const headerLength = Number(response.headers.get('content-length'))
    const totalBytes = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : expectedBytes

    const file = createWriteStream(filePath)
    const reader = response.body.getReader()
    let transferred = 0
    let lastEmit = 0

    const emit = (force: boolean) => {
        if (!onProgress) return
        const now = Date.now()
        if (!force && now - lastEmit < PROGRESS_MIN_INTERVAL_MS) return
        lastEmit = now
        onProgress(computeDownloadProgress(transferred, totalBytes))
    }

    try {
        emit(true)
        for (;;) {
            throwIfAborted(signal)
            const { done, value } = await reader.read()
            if (done) break
            transferred += value.byteLength
            await new Promise<void>((resolve, reject) => {
                file.write(value, (error) => (error ? reject(new InstallError('disk', `write failed: ${error.message}`)) : resolve()))
            })
            emit(false)
        }
        await new Promise<void>((resolve, reject) => {
            file.end((error?: Error | null) => (error ? reject(new InstallError('disk', `write failed: ${error.message}`)) : resolve()))
        })
        emit(true)
    } catch (error) {
        file.destroy()
        try { reader.cancel() } catch { /* stream already done */ }
        throwIfAborted(signal)
        if (error instanceof InstallError) throw error
        throw new InstallError('network', `download interrupted: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/** Extract with Windows' bundled bsdtar (auto-detects zip and 7z). */
function extractArchive(archivePath: string, destDir: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false
        const done = (error?: InstallError) => {
            if (settled) return
            settled = true
            signal?.removeEventListener('abort', onAbort)
            clearTimeout(timer)
            if (error) reject(error)
            else resolve()
        }

        let child: ReturnType<typeof spawn>
        try {
            child = spawn('tar', buildExtractArgs(archivePath, destDir), { windowsHide: true, stdio: 'ignore' })
        } catch (error) {
            done(new InstallError('extract-failed', `tar spawn failed: ${error instanceof Error ? error.message : String(error)}`))
            return
        }

        const onAbort = () => {
            try { child.kill() } catch { /* already gone */ }
            done(new InstallError('cancelled', 'download cancelled'))
        }
        const timer = setTimeout(() => {
            try { child.kill() } catch { /* already gone */ }
            done(new InstallError('extract-failed', 'tar timed out'))
        }, EXTRACT_TIMEOUT_MS)

        signal?.addEventListener('abort', onAbort)
        child.on('error', (error) => done(new InstallError('extract-failed', `tar not available: ${error.message}`)))
        child.on('exit', (code) => {
            if (code === 0) done()
            else done(new InstallError('extract-failed', `tar exited with code ${code}`))
        })
    })
}

/**
 * Find mpv.exe under `dir`, descending at most `maxDepth` levels — the
 * archive may root its files directly or inside one wrapper folder.
 */
export async function findMpvExe(dir: string, maxDepth: number = EXE_SEARCH_MAX_DEPTH): Promise<string | null> {
    let entries
    try {
        entries = await readdir(dir, { withFileTypes: true })
    } catch {
        return null
    }
    for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === 'mpv.exe') {
            return path.join(dir, entry.name)
        }
    }
    if (maxDepth <= 1) return null
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const found = await findMpvExe(path.join(dir, entry.name), maxDepth - 1)
            if (found) return found
        }
    }
    return null
}

/**
 * Download + extract + locate mpv.exe. Never throws — inspect `success`.
 * Layout inside installDir:
 *   download.<ext>   transient archive (always removed)
 *   extract-tmp/     transient extraction target (removed on failure)
 *   bin/             final install (replaced atomically via rename)
 */
export async function installMpv(options: MpvInstallOptions): Promise<MpvInstallResult> {
    const { installDir, signal, onProgress } = options
    const fetchImpl = options.fetchImpl ?? fetch
    const tmpDir = path.join(installDir, 'extract-tmp')
    const binDir = path.join(installDir, 'bin')
    let archivePath: string | null = null

    try {
        throwIfAborted(signal)
        try {
            await mkdir(installDir, { recursive: true })
        } catch (error) {
            throw new InstallError('disk', `cannot create install dir: ${error instanceof Error ? error.message : String(error)}`)
        }

        const release = await fetchLatestRelease(fetchImpl, signal)
        const asset = pickMpvAsset(release.assets)
        if (!asset) {
            throw new InstallError('no-asset', 'no suitable mpv-x86_64 asset in the latest release')
        }
        const extension = asset.name.toLowerCase().endsWith('.zip') ? 'zip' : '7z'
        archivePath = path.join(installDir, `download.${extension}`)

        throwIfAborted(signal)
        await downloadToFile(asset.browser_download_url, archivePath, asset.size, fetchImpl, onProgress, signal)

        // Sanity-check the file actually landed with content.
        const archiveStat = await stat(archivePath).catch(() => null)
        if (!archiveStat || archiveStat.size === 0) {
            throw new InstallError('download-failed', 'downloaded archive is empty')
        }

        throwIfAborted(signal)
        await rm(tmpDir, { recursive: true, force: true })
        await mkdir(tmpDir, { recursive: true })
        await extractArchive(archivePath, tmpDir, signal)

        const extractedExe = await findMpvExe(tmpDir)
        if (!extractedExe) {
            throw new InstallError('exe-not-found', 'mpv.exe not found in the extracted archive')
        }

        // Swap the new build in (a running mpv.exe would block the rm — surface as disk error).
        try {
            await rm(binDir, { recursive: true, force: true })
            await rename(tmpDir, binDir)
        } catch (error) {
            throw new InstallError('disk', `cannot move install into place: ${error instanceof Error ? error.message : String(error)}`)
        }

        const exePath = path.join(binDir, path.relative(tmpDir, extractedExe))
        return {
            success: true,
            path: exePath,
            version: parseMpvVersionFromAssetName(asset.name) ?? undefined,
        }
    } catch (error) {
        const reason = error instanceof InstallError ? error.reason : 'download-failed'
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
        return { success: false, reason }
    } finally {
        if (archivePath) {
            await rm(archivePath, { force: true }).catch(() => undefined)
        }
    }
}
