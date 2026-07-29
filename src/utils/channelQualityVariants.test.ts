import { describe, it, expect } from 'vitest'
import { buildChannelVariantIndex, extractChannelInfo, findQualityVariants } from './channelQualityVariants'

interface Stream { stream_id: number; name: string }

/**
 * Oráculo: a implementação ANTIGA, copiada da LiveTV, que varria a lista
 * inteira a cada chamada. O índice só vale se der exatamente o mesmo
 * resultado — inclusive na ordem.
 */
function naiveVariants(streams: Stream[], channel: Stream) {
    const stateAbbreviations = new Set([
        'sp', 'rj', 'mg', 'rs', 'pr', 'sc', 'ba', 'pe', 'ce', 'pa',
        'go', 'ma', 'pb', 'am', 'rn', 'pi', 'al', 'mt', 'ms', 'se',
        'ro', 'to', 'ac', 'ap', 'rr', 'es', 'df'
    ])

    const extractInfo = (name: string) => {
        const workingName = name.trim()
        let quality = ''
        let codec = ''
        let priority = 2

        if (/\[4K\]|\(4K\)|2160p/i.test(workingName)) { quality = '4K'; priority = 0 }
        else if (/\[UHD\]|\(UHD\)/i.test(workingName)) { quality = 'UHD'; priority = 0 }
        else if (/\[FHD\]|\(FHD\)|1080p/i.test(workingName)) { quality = 'FHD'; priority = 1 }
        else if (/\[HD\]|\(HD\)|720p/i.test(workingName)) { quality = 'HD'; priority = 2 }
        else if (/\[SD\]|\(SD\)|480p/i.test(workingName)) { quality = 'SD'; priority = 3 }

        if (/\[H\.?265\]|\(H\.?265\)|HEVC/i.test(workingName)) {
            codec = 'H.265'
            priority = Math.max(0, priority - 0.5)
        }

        let label = quality || 'HD'
        if (codec) label = quality ? `${quality} ${codec}` : codec

        const baseName = workingName
            .replace(/\s*\[(?:FHD|HD|SD|4K|UHD|H\.?265|HEVC)\]\s*/gi, ' ')
            .replace(/\s*\((?:FHD|HD|SD|4K|UHD|H\.?265|HEVC)\)\s*/gi, ' ')
            .replace(/\s*(?:2160|1080|720|480)p?\s*/gi, ' ')
            .replace(/\s+FHD\s+/gi, ' ')
            .replace(/\s+HD\s+/gi, ' ')
            .replace(/\s+SD\s+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        const hasOnlyQuality = !!(quality || codec) && baseName.length < workingName.length * 0.7
        const words = baseName.split(' ')
        const lastWord = words[words.length - 1]?.toLowerCase() || ''
        const regionSuffix = stateAbbreviations.has(lastWord) ? lastWord : ''

        return { baseName, quality, codec, label, priority, hasOnlyQuality, regionSuffix }
    }

    const currentInfo = extractInfo(channel.name)
    const { baseName } = currentInfo
    const variants: Array<{ channel: Stream; quality: string; priority: number; label: string }> = []

    for (const stream of streams) {
        const info = extractInfo(stream.name)
        const streamBaseLower = info.baseName.toLowerCase()
        const currentBaseLower = baseName.toLowerCase()
        const isExactMatch = streamBaseLower === currentBaseLower

        let isQualityVariant = false
        if (currentInfo.hasOnlyQuality && currentBaseLower.length >= 3) {
            if (info.regionSuffix) {
                const streamCoreWords = info.baseName.toLowerCase().split(' ')
                streamCoreWords.pop()
                isQualityVariant = streamCoreWords.join(' ') === currentBaseLower
            }
        }

        let isCurrentRegionalVariant = false
        if (currentInfo.regionSuffix && !currentInfo.hasOnlyQuality) {
            if (info.hasOnlyQuality) {
                const currentCoreWords = currentBaseLower.split(' ')
                currentCoreWords.pop()
                isCurrentRegionalVariant = info.baseName.toLowerCase() === currentCoreWords.join(' ')
            }
        }

        if (isExactMatch || isQualityVariant || isCurrentRegionalVariant) {
            const label = (info.quality || info.codec) ? info.label : 'SD'
            const priority = (info.quality || info.codec) ? info.priority : 4
            variants.push({ channel: stream, quality: info.quality || 'SD', priority, label })
        }
    }

    variants.sort((a, b) => a.priority - b.priority)
    return variants.length > 1 ? variants : []
}

const NAMES = [
    'Globo SP', 'Globo SP [FHD]', 'Globo SP [HD]', 'Globo SP [SD]', 'Globo [4K]',
    'Globo RJ', 'Globo RJ [FHD]', 'Globo News', 'Globo Minas', 'Globo [UHD]',
    'SBT HD', 'SBT [FHD]', 'SBT SD', 'SBT [H.265]', 'SBT',
    'Record TV HD', 'Record TV', 'Band HD', 'Band [4K]', 'Band',
    'ESPN 1080p', 'ESPN 720p', 'ESPN 480p', 'ESPN', 'ESPN 2 HEVC',
    'Telecine Premium (FHD)', 'Telecine Premium (HD)', 'Telecine Premium',
    'Cartoon Kids Brasil', 'Desenhos 24 Horas', 'Canal Privê +18',
    'HD', 'FHD', '  Globo SP  ', 'Premiere Clubes MG', 'Premiere Clubes [4K]',
    'Discovery H.265', 'Discovery', 'Discovery [HD]', 'A&E [FHD]', 'A&E'
]

const STREAMS: Stream[] = NAMES.map((name, i) => ({ stream_id: i + 1, name }))

describe('findQualityVariants (indexado)', () => {
    it('dá exatamente o mesmo resultado da varredura antiga, para TODO canal da lista', () => {
        const index = buildChannelVariantIndex(STREAMS)
        for (const stream of STREAMS) {
            expect(findQualityVariants(stream, index)).toEqual(naiveVariants(STREAMS, stream))
        }
    })

    it('agrupa as variantes do mesmo canal da melhor pra pior', () => {
        const index = buildChannelVariantIndex(STREAMS)
        const variants = findQualityVariants({ name: 'Telecine Premium (HD)' }, index)

        expect(variants.map(v => v.channel.name))
            .toEqual(['Telecine Premium (FHD)', 'Telecine Premium (HD)', 'Telecine Premium'])
        expect(variants[0].priority).toBeLessThanOrEqual(variants[1].priority)
    })

    it('canal sem irmão não vira lista de qualidade', () => {
        const index = buildChannelVariantIndex(STREAMS)
        expect(findQualityVariants({ name: 'Cartoon Kids Brasil' }, index)).toEqual([])
    })

    it('não mistura canais de nomes parecidos ("Globo News" fora de "Globo [4K]")', () => {
        const index = buildChannelVariantIndex(STREAMS)
        const names = findQualityVariants({ name: 'Globo [4K]' }, index).map(v => v.channel.name)
        expect(names).not.toContain('Globo News')
        expect(names).not.toContain('Globo Minas')
        expect(names).toContain('Globo SP')
    })

    it('o índice é construído UMA vez: N consultas não custam N varreduras', () => {
        // Cada canal conta quantas vezes o nome dele foi lido — a versão antiga
        // lia a lista INTEIRA por consulta (era o custo pago em todo render).
        let nameReads = 0
        const big: Stream[] = []
        for (let i = 0; i < 3000; i++) {
            const name = `Canal ${i % 500} ${['HD', '[FHD]', 'SD'][i % 3]}`
            big.push({ stream_id: i, get name() { nameReads++; return name } })
        }

        const index = buildChannelVariantIndex(big)
        const afterBuild = nameReads
        expect(afterBuild).toBe(3000)

        for (let i = 0; i < 50; i++) findQualityVariants({ name: 'Canal 1 HD' }, index)
        expect(nameReads).toBe(afterBuild)
    })
})

describe('extractChannelInfo', () => {
    it('lê qualidade, codec e sufixo de UF', () => {
        expect(extractChannelInfo('Globo SP [FHD]')).toMatchObject({ baseName: 'Globo SP', quality: 'FHD', regionSuffix: 'sp' })
        expect(extractChannelInfo('SBT [H.265]')).toMatchObject({ codec: 'H.265', label: 'H.265' })
        expect(extractChannelInfo('ESPN 1080p')).toMatchObject({ baseName: 'ESPN', quality: 'FHD' })
    })
})
