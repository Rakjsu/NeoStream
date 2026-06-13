/**
 * EXPERIMENTAL — MPV auto-download. Unit tests for the pure release-asset
 * picking and progress helpers.
 *
 * REAL_RELEASE_ASSETS is trimmed from the actual GitHub API response of
 * https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest
 * fetched on 2026-06-12 (tag 2026-06-12-7d245fd100) — names and sizes are
 * verbatim; only the asset list fields we consume were kept.
 */
import { describe, it, expect } from 'vitest'
import {
    MPV_RELEASE_API_URL,
    buildExtractArgs,
    computeDownloadProgress,
    parseMpvVersionFromAssetName,
    pickMpvAsset,
    type MpvReleaseAsset,
} from './mpvDownloaderProtocol'

const url = (name: string) =>
    `https://github.com/zhongfly/mpv-winbuild/releases/download/2026-06-12-7d245fd100/${name}`

const asset = (name: string, size: number): MpvReleaseAsset =>
    ({ name, browser_download_url: url(name), size })

const REAL_RELEASE_ASSETS: MpvReleaseAsset[] = [
    asset('ffmpeg-aarch64-git-dd9083cb8.7z', 22_122_209),
    asset('ffmpeg-lgpl-aarch64-git-dd9083cb8.7z', 19_503_438),
    asset('ffmpeg-lgpl-x86_64-git-dd9083cb8.7z', 23_700_633),
    asset('ffmpeg-lgpl-x86_64-v3-git-dd9083cb8.7z', 24_643_982),
    asset('ffmpeg-x86_64-git-dd9083cb8.7z', 27_053_854),
    asset('ffmpeg-x86_64-v3-git-dd9083cb8.7z', 28_101_337),
    asset('mpv-aarch64-20260612-git-7d245fd100.7z', 26_738_688),
    asset('mpv-debug-aarch64-20260612-git-7d245fd100.7z', 50_750_054),
    asset('mpv-debug-x86_64-20260612-git-7d245fd100.7z', 55_683_481),
    asset('mpv-debug-x86_64-v3-20260612-git-7d245fd100.7z', 55_369_134),
    asset('mpv-dev-aarch64-20260612-git-7d245fd100.7z', 26_004_685),
    asset('mpv-dev-lgpl-aarch64-20260612-git-7d245fd100.7z', 22_963_404),
    asset('mpv-dev-lgpl-x86_64-20260612-git-7d245fd100.7z', 27_577_549),
    asset('mpv-dev-lgpl-x86_64-v3-20260612-git-7d245fd100.7z', 28_730_982),
    asset('mpv-dev-x86_64-20260612-git-7d245fd100.7z', 31_236_915),
    asset('mpv-dev-x86_64-v3-20260612-git-7d245fd100.7z', 32_553_323),
    asset('mpv-x86_64-20260612-git-7d245fd100.7z', 31_989_350),
    asset('mpv-x86_64-v3-20260612-git-7d245fd100.7z', 33_271_316),
    asset('sha256.txt', 2_269),
]

describe('pickMpvAsset', () => {
    it('picks exactly the plain x86_64 player build from the real release', () => {
        const picked = pickMpvAsset(REAL_RELEASE_ASSETS)
        expect(picked?.name).toBe('mpv-x86_64-20260612-git-7d245fd100.7z')
        expect(picked?.browser_download_url).toBe(url('mpv-x86_64-20260612-git-7d245fd100.7z'))
        expect(picked?.size).toBe(31_989_350)
    })

    it('never picks v3, aarch64, dev, debug, lgpl or ffmpeg variants', () => {
        const others = REAL_RELEASE_ASSETS.filter((a) => a.name !== 'mpv-x86_64-20260612-git-7d245fd100.7z')
        expect(pickMpvAsset(others)).toBeNull()
    })

    it('prefers a .zip over a .7z when both are published', () => {
        const withZip = [
            ...REAL_RELEASE_ASSETS,
            asset('mpv-x86_64-20260612-git-7d245fd100.zip', 40_000_000),
        ]
        expect(pickMpvAsset(withZip)?.name).toBe('mpv-x86_64-20260612-git-7d245fd100.zip')
    })

    it('handles missing/empty/malformed asset lists', () => {
        expect(pickMpvAsset(undefined)).toBeNull()
        expect(pickMpvAsset(null)).toBeNull()
        expect(pickMpvAsset([])).toBeNull()
        expect(pickMpvAsset([{ name: 123, browser_download_url: null } as unknown as MpvReleaseAsset])).toBeNull()
    })
})

describe('parseMpvVersionFromAssetName', () => {
    it('extracts date+hash from the asset name', () => {
        expect(parseMpvVersionFromAssetName('mpv-x86_64-20260612-git-7d245fd100.7z'))
            .toBe('20260612-git-7d245fd100')
        expect(parseMpvVersionFromAssetName('mpv-x86_64-20260612-git-7d245fd100.zip'))
            .toBe('20260612-git-7d245fd100')
    })

    it('returns null for other names', () => {
        expect(parseMpvVersionFromAssetName('mpv-dev-x86_64-20260612-git-7d245fd100.7z')).toBeNull()
        expect(parseMpvVersionFromAssetName('sha256.txt')).toBeNull()
    })
})

describe('computeDownloadProgress', () => {
    it('computes percent and MB values', () => {
        const progress = computeDownloadProgress(15_994_675, 31_989_350)
        expect(progress.percent).toBe(50)
        expect(progress.transferredMB).toBe(15.3)
        expect(progress.totalMB).toBe(30.5)
    })

    it('floors percent so 100% is only shown when complete', () => {
        expect(computeDownloadProgress(31_989_349, 31_989_350).percent).toBe(99)
        expect(computeDownloadProgress(31_989_350, 31_989_350).percent).toBe(100)
    })

    it('clamps overshoot and handles unknown totals', () => {
        expect(computeDownloadProgress(200, 100).percent).toBe(100)
        expect(computeDownloadProgress(500, 0)).toEqual({ percent: 0, transferredMB: 0, totalMB: 0 })
        expect(computeDownloadProgress(-5, -10)).toEqual({ percent: 0, transferredMB: 0, totalMB: 0 })
    })
})

describe('buildExtractArgs', () => {
    it('builds bsdtar extract arguments', () => {
        expect(buildExtractArgs('C:\\tmp\\download.7z', 'C:\\tmp\\out'))
            .toEqual(['-xf', 'C:\\tmp\\download.7z', '-C', 'C:\\tmp\\out'])
    })
})

describe('MPV_RELEASE_API_URL', () => {
    it('points at the zhongfly/mpv-winbuild latest release endpoint', () => {
        expect(MPV_RELEASE_API_URL).toBe('https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest')
    })
})
