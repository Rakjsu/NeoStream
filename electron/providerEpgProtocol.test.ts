/**
 * Unit tests for the pure Xtream provider EPG helpers.
 */
import { describe, it, expect } from 'vitest'
import {
    buildDefaultWindow,
    normalizeEpgText,
    searchEpgIndex,
    buildSimpleDataTableUrl,
    buildXmltvUrl,
    decodeBase64Utf8,
    decodeXmlText,
    looksLikeXmltv,
    normalizeServerUrl,
    parseSimpleDataTable,
    parseXmltvIndex,
    parseXmltvIndexWithMeta,
    parseXmltvOffsetMinutes,
    parseXmltvTime,
    PROVIDER_EPG_FUTURE_WINDOW_MS,
    PROVIDER_EPG_PAST_WINDOW_MS,
} from './providerEpgProtocol'
import type { ProviderEpgProgram } from './providerEpgProtocol'

describe('normalizeServerUrl / URL builders', () => {
    it('strips trailing slashes from the server url', () => {
        expect(normalizeServerUrl('http://host:8080/')).toBe('http://host:8080')
        expect(normalizeServerUrl('http://host:8080///')).toBe('http://host:8080')
    })

    it('builds the xmltv.php url with encoded credentials', () => {
        expect(buildXmltvUrl('http://host:8080/', 'user name', 'p&ss'))
            .toBe('http://host:8080/xmltv.php?username=user%20name&password=p%26ss')
    })

    it('builds the get_simple_data_table url with the stream id', () => {
        expect(buildSimpleDataTableUrl('http://host:8080', 'u', 'p', 42))
            .toBe('http://host:8080/player_api.php?username=u&password=p&action=get_simple_data_table&stream_id=42')
    })
})

describe('looksLikeXmltv', () => {
    it('accepts a document containing programme entries', () => {
        expect(looksLikeXmltv('<?xml version="1.0"?><tv><programme channel="x"></programme></tv>')).toBe(true)
    })

    it('rejects empty bodies, HTML error pages and programme-less documents', () => {
        expect(looksLikeXmltv('')).toBe(false)
        expect(looksLikeXmltv('<!DOCTYPE html><html><body>404 Not Found</body></html>')).toBe(false)
        expect(looksLikeXmltv('<html><head><title>Error</title></head></html>')).toBe(false)
        expect(looksLikeXmltv('<?xml version="1.0"?><tv></tv>')).toBe(false)
    })
})

describe('parseXmltvTime', () => {
    it('parses "YYYYMMDDHHMMSS +0000" into epoch ms (UTC)', () => {
        expect(parseXmltvTime('20260612153000 +0000')).toBe(Date.UTC(2026, 5, 12, 15, 30, 0))
    })

    it('applies positive and negative timezone offsets', () => {
        // 15:30 at -0300 == 18:30 UTC
        expect(parseXmltvTime('20260612153000 -0300')).toBe(Date.UTC(2026, 5, 12, 18, 30, 0))
        // 15:30 at +0200 == 13:30 UTC
        expect(parseXmltvTime('20260612153000 +0200')).toBe(Date.UTC(2026, 5, 12, 13, 30, 0))
    })

    it('treats a missing offset as UTC and pads missing seconds', () => {
        expect(parseXmltvTime('202606121530')).toBe(Date.UTC(2026, 5, 12, 15, 30, 0))
    })

    it('returns null for malformed values', () => {
        expect(parseXmltvTime('')).toBeNull()
        expect(parseXmltvTime('not-a-time')).toBeNull()
        expect(parseXmltvTime('20261312000000 +0000')).toBeNull() // month 13
    })
})

describe('decodeXmlText', () => {
    it('unwraps CDATA sections', () => {
        expect(decodeXmlText('<![CDATA[Jornal Nacional]]>')).toBe('Jornal Nacional')
    })

    it('decodes entities including numeric and hex references', () => {
        expect(decodeXmlText('Tom &amp; Jerry &lt;ao vivo&gt; &quot;hoje&quot; &#233; &#xE0;s 20h'))
            .toBe('Tom & Jerry <ao vivo> "hoje" é às 20h')
    })

    it('keeps accented characters untouched', () => {
        expect(decodeXmlText('Sessão da Tarde: Ação e Emoção')).toBe('Sessão da Tarde: Ação e Emoção')
    })
})

// A small fixture exercising CDATA, entities, accents, multiple channels and
// programs outside the retention window.
const NOW = Date.UTC(2026, 5, 12, 12, 0, 0) // 2026-06-12 12:00 UTC

const XMLTV_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="provider">
  <channel id="globo.br"><display-name>Globo</display-name></channel>
  <programme start="20260612110000 +0000" stop="20260612130000 +0000" channel="globo.br">
    <title lang="pt"><![CDATA[Sessão da Tarde]]></title>
    <desc lang="pt"><![CDATA[Filme: Ação & Aventura]]></desc>
  </programme>
  <programme start="20260612130000 +0000" stop="20260612140000 +0000" channel="globo.br">
    <title lang="pt">Tom &amp; Jerry</title>
    <desc lang="pt">Epis&#243;dio in&#233;dito</desc>
  </programme>
  <programme start="20260610000000 +0000" stop="20260610010000 +0000" channel="globo.br">
    <title>Too old — outside the window</title>
  </programme>
  <programme start="20260620000000 +0000" stop="20260620010000 +0000" channel="globo.br">
    <title>Too far in the future</title>
  </programme>
  <programme start="20260612090000 -0300" stop="20260612100000 -0300" channel="sbt.br">
    <title>Programa Sílvio Santos</title>
  </programme>
  <programme start="bogus" stop="20260612140000 +0000" channel="sbt.br">
    <title>Malformed start, skipped</title>
  </programme>
  <programme start="20260612140000 +0000" stop="20260612150000 +0000">
    <title>No channel attribute, skipped</title>
  </programme>
</tv>`

describe('parseXmltvIndex', () => {
    it('indexes programmes per channel id', () => {
        const index = parseXmltvIndex(XMLTV_FIXTURE, NOW)
        expect([...index.keys()].sort()).toEqual(['globo.br', 'sbt.br'])
        expect(index.get('globo.br')).toHaveLength(2)
        expect(index.get('sbt.br')).toHaveLength(1)
    })

    it('decodes CDATA, entities and accents in titles/descriptions', () => {
        const index = parseXmltvIndex(XMLTV_FIXTURE, NOW)
        const globo = index.get('globo.br')!

        expect(globo[0].title).toBe('Sessão da Tarde')
        expect(globo[0].description).toBe('Filme: Ação & Aventura')
        expect(globo[1].title).toBe('Tom & Jerry')
        expect(globo[1].description).toBe('Episódio inédito')

        expect(index.get('sbt.br')![0].title).toBe('Programa Sílvio Santos')
    })

    it('converts XMLTV times (with offsets) into ISO timestamps, sorted', () => {
        const index = parseXmltvIndex(XMLTV_FIXTURE, NOW)
        const globo = index.get('globo.br')!

        expect(globo[0].start).toBe(new Date(Date.UTC(2026, 5, 12, 11, 0, 0)).toISOString())
        expect(globo[0].end).toBe(new Date(Date.UTC(2026, 5, 12, 13, 0, 0)).toISOString())
        expect(globo[0].start <= globo[1].start).toBe(true)

        // -0300 offset: 09:00 local == 12:00 UTC
        expect(index.get('sbt.br')![0].start).toBe(new Date(Date.UTC(2026, 5, 12, 12, 0, 0)).toISOString())
    })

    it('drops programmes outside the now-24h..now+48h window', () => {
        const index = parseXmltvIndex(XMLTV_FIXTURE, NOW)
        const titles = index.get('globo.br')!.map((p) => p.title)
        expect(titles).not.toContain('Too old — outside the window')
        expect(titles).not.toContain('Too far in the future')
    })

    it('returns an empty index for non-XMLTV input', () => {
        expect(parseXmltvIndex('<html>404</html>', NOW).size).toBe(0)
    })
})

describe('parseXmltvOffsetMinutes', () => {
    it('extracts positive and negative offsets in minutes', () => {
        expect(parseXmltvOffsetMinutes('20260612153000 -0300')).toBe(-180)
        expect(parseXmltvOffsetMinutes('20260612153000 +0200')).toBe(120)
        expect(parseXmltvOffsetMinutes('20260612153000 +0530')).toBe(330)
        expect(parseXmltvOffsetMinutes('20260612153000 +0000')).toBe(0)
    })

    it('returns null when the offset is absent or malformed', () => {
        expect(parseXmltvOffsetMinutes('20260612153000')).toBeNull()
        expect(parseXmltvOffsetMinutes('bogus')).toBeNull()
        expect(parseXmltvOffsetMinutes('')).toBeNull()
    })
})

describe('parseXmltvIndexWithMeta', () => {
    it('reports the dominant UTC offset across programmes', () => {
        // Fixture (in-window only): 2 programmes with +0000, 1 with -0300 → +0000 wins.
        const { index, utcOffsetMinutes } = parseXmltvIndexWithMeta(XMLTV_FIXTURE, NOW)
        expect(index.size).toBe(2)
        expect(utcOffsetMinutes).toBe(0)
    })

    it('picks the most common offset when providers mix timezones', () => {
        const xml = `<tv>
            <programme start="20260612100000 -0300" stop="20260612110000 -0300" channel="a"><title>1</title></programme>
            <programme start="20260612110000 -0300" stop="20260612120000 -0300" channel="a"><title>2</title></programme>
            <programme start="20260612100000 +0000" stop="20260612110000 +0000" channel="b"><title>3</title></programme>
        </tv>`
        expect(parseXmltvIndexWithMeta(xml, NOW).utcOffsetMinutes).toBe(-180)
    })

    it('returns null when no programme carries an offset', () => {
        const xml = `<tv>
            <programme start="20260612100000" stop="20260612110000" channel="a"><title>1</title></programme>
        </tv>`
        const result = parseXmltvIndexWithMeta(xml, NOW)
        expect(result.index.get('a')).toHaveLength(1)
        expect(result.utcOffsetMinutes).toBeNull()
    })
})

describe('buildDefaultWindow', () => {
    it('spans now-24h to now+48h', () => {
        const window = buildDefaultWindow(NOW)
        expect(window.minEndMs).toBe(NOW - PROVIDER_EPG_PAST_WINDOW_MS)
        expect(window.maxStartMs).toBe(NOW + PROVIDER_EPG_FUTURE_WINDOW_MS)
    })
})

describe('decodeBase64Utf8', () => {
    it('decodes UTF-8 text with accents', () => {
        const encoded = Buffer.from('Sessão da Tarde', 'utf-8').toString('base64')
        expect(decodeBase64Utf8(encoded)).toBe('Sessão da Tarde')
    })

    it('returns the input on invalid base64 instead of throwing', () => {
        expect(typeof decodeBase64Utf8('%%not-base64%%')).toBe('string')
    })
})

describe('parseSimpleDataTable', () => {
    const startSec = Math.floor(NOW / 1000)
    const payload = {
        epg_listings: [
            {
                id: '1',
                title: Buffer.from('Jornal da Manhã', 'utf-8').toString('base64'),
                description: Buffer.from('Notícias & esportes', 'utf-8').toString('base64'),
                start: '2026-06-12 12:00:00',
                end: '2026-06-12 13:00:00',
                start_timestamp: String(startSec),
                stop_timestamp: String(startSec + 3600),
            },
            {
                id: '2',
                title: Buffer.from('Muito antigo', 'utf-8').toString('base64'),
                start_timestamp: String(startSec - 3 * 24 * 3600),
                stop_timestamp: String(startSec - 3 * 24 * 3600 + 1800),
            },
        ],
    }

    it('maps listings to programs with decoded base64 fields', () => {
        const programs = parseSimpleDataTable(payload, 'globo.br', NOW)
        expect(programs).toHaveLength(1)
        expect(programs[0].title).toBe('Jornal da Manhã')
        expect(programs[0].description).toBe('Notícias & esportes')
        expect(programs[0].channel_id).toBe('globo.br')
        expect(programs[0].start).toBe(new Date(NOW).toISOString())
        expect(programs[0].end).toBe(new Date(NOW + 3600 * 1000).toISOString())
    })

    it('applies the retention window', () => {
        const programs = parseSimpleDataTable(payload, 'globo.br', NOW)
        expect(programs.some((p) => p.title === 'Muito antigo')).toBe(false)
    })

    it('handles malformed payloads gracefully', () => {
        expect(parseSimpleDataTable(null, 'x', NOW)).toEqual([])
        expect(parseSimpleDataTable({}, 'x', NOW)).toEqual([])
        expect(parseSimpleDataTable({ epg_listings: 'nope' }, 'x', NOW)).toEqual([])
        expect(parseSimpleDataTable({ epg_listings: [{ title: 'a' }] }, 'x', NOW)).toEqual([])
    })
})

describe('searchEpgIndex', () => {
    const NOW = Date.parse('2026-07-02T20:00:00Z')
    const prog = (title: string, channel: string, startOffsetH: number, durH = 1): ProviderEpgProgram => ({
        id: `${channel}-${title}`,
        title,
        channel_id: channel,
        start: new Date(NOW + startOffsetH * 3600_000).toISOString(),
        end: new Date(NOW + (startOffsetH + durH) * 3600_000).toISOString(),
    })
    const index = new Map<string, ProviderEpgProgram[]>([
        ['globo.br', [prog('Jornal Nacional', 'globo.br', 0.5), prog('Novela das Nove', 'globo.br', 1.5)]],
        ['sbt.br', [prog('Jornal do SBT', 'sbt.br', -0.5), prog('Filme antigo', 'sbt.br', -5, 1)]],
        ['band.br', [prog('Jornal da Band', 'band.br', 48)]],
    ])

    it('encontra por substring sem acentos e ordena por início', () => {
        const hits = searchEpgIndex(index, 'jornal', NOW)
        expect(hits.map(h => h.title)).toEqual(['Jornal do SBT', 'Jornal Nacional'])
    })

    it('exclui programas já encerrados e além do horizonte de 36h', () => {
        const titles = searchEpgIndex(index, 'a', NOW).map(h => h.title)
        expect(titles).not.toContain('Filme antigo')
        expect(titles).not.toContain('Jornal da Band')
    })

    it('é insensível a acentos e caixa', () => {
        expect(searchEpgIndex(index, 'JORNAL NACIONÁL'.normalize('NFD').replace(/[̀-ͯ]/g, ''), NOW)
            .some(h => h.title === 'Jornal Nacional')).toBe(true)
        expect(searchEpgIndex(index, 'novela', NOW)[0].title).toBe('Novela das Nove')
    })

    it('ignora consultas curtas e respeita o limite', () => {
        expect(searchEpgIndex(index, 'j', NOW)).toEqual([])
        expect(searchEpgIndex(index, 'jornal', NOW, 1)).toHaveLength(1)
    })
})

describe('normalizeEpgText', () => {
    it('minúsculas + sem acentos', () => {
        expect(normalizeEpgText('  Ação & Aventura  ')).toBe('acao & aventura')
    })
})
