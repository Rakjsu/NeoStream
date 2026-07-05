import { describe, it, expect } from 'vitest'
import {
    buildXmltvFromStalkerEpg,
    formatXmltvTime,
    parseEpgPrograms,
    parseTotalItems,
    parseVodItems,
    stalkerVodCategories,
    stalkerVodToStreams,
    parseSeriesItems,
    parseSeasons,
    stalkerSeriesToList,
    stalkerSeriesInfo,
    stalkerEpisodeId,
    parseStalkerEpisodeId,
    seasonNumberOf,
    normalizeMac,
    portalCandidates,
    buildStalkerQuery,
    buildStalkerCookie,
    unwrapJs,
    extractToken,
    parseGenres,
    parseChannels,
    extractStreamUrl,
    stalkerGenresToCategories,
    stalkerChannelsToLiveStreams,
} from './stalkerProtocol'

describe('normalizeMac', () => {
    it('aceita separadores variados e normaliza pra AA:BB:CC:DD:EE:FF', () => {
        expect(normalizeMac('00:1a:79:ab:cd:ef')).toBe('00:1A:79:AB:CD:EF')
        expect(normalizeMac('00-1A-79-AB-CD-EF')).toBe('00:1A:79:AB:CD:EF')
        expect(normalizeMac('001a79abcdef')).toBe('00:1A:79:AB:CD:EF')
    })
    it('rejeita entradas que não têm 12 dígitos hex', () => {
        expect(normalizeMac('00:1A:79')).toBeNull()
        expect(normalizeMac('not-a-mac')).toBeNull()
        expect(normalizeMac('')).toBeNull()
    })
})

describe('portalCandidates', () => {
    it('URL com portal.php explícito vem primeiro', () => {
        const candidates = portalCandidates('http://host.tv/portal.php')
        expect(candidates[0]).toBe('http://host.tv/portal.php')
    })
    it('URL de stalker_portal vira server/load.php canônico', () => {
        const candidates = portalCandidates('http://host.tv/stalker_portal/c/')
        expect(candidates[0]).toBe('http://host.tv/stalker_portal/server/load.php')
    })
    it('host cru ganha os endpoints padrão sem duplicatas', () => {
        const candidates = portalCandidates('host.tv:8080')
        expect(candidates).toEqual([
            'http://host.tv:8080/portal.php',
            'http://host.tv:8080/stalker_portal/server/load.php',
            'http://host.tv:8080/c/portal.php',
        ])
    })
    it('entrada inválida retorna vazio', () => {
        expect(portalCandidates('http://[invalido')).toEqual([])
    })
})

describe('buildStalkerQuery / cookie', () => {
    it('monta type/action + JsHttpRequest', () => {
        const query = buildStalkerQuery('stb', 'handshake', { token: '' })
        const params = new URLSearchParams(query)
        expect(params.get('type')).toBe('stb')
        expect(params.get('action')).toBe('handshake')
        expect(params.get('JsHttpRequest')).toBe('1-xml')
    })
    it('cookie identifica o MAC', () => {
        expect(buildStalkerCookie('00:1A:79:AB:CD:EF')).toContain('mac=00%3A1A%3A79%3AAB%3ACD%3AEF')
    })
})

describe('unwrapJs / extractToken', () => {
    it('desembrulha {js: ...} e extrai token', () => {
        expect(unwrapJs<{ token: string }>({ js: { token: 'T' } })).toEqual({ token: 'T' })
        expect(extractToken({ token: 'ABC123' })).toBe('ABC123')
    })
    it('formas inesperadas viram null', () => {
        expect(unwrapJs('html de erro')).toBeNull()
        expect(extractToken({})).toBeNull()
        expect(extractToken(null)).toBeNull()
    })
})

describe('parseGenres / parseChannels', () => {
    it('mapeia gêneros ignorando o pseudo-gênero *', () => {
        const genres = parseGenres([
            { id: '*', title: 'All' },
            { id: 1, title: 'Abertos' },
            { id: '2', title: 'Esportes' },
            { bogus: true },
        ])
        expect(genres).toEqual([
            { id: '1', title: 'Abertos' },
            { id: '2', title: 'Esportes' },
        ])
    })
    it('mapeia canais defensivamente (cmd e nome obrigatórios)', () => {
        const channels = parseChannels({
            data: [
                { id: 10, name: 'Canal Um', number: '1', logo: 'http://x/l.png', tv_genre_id: 1, cmd: 'ffmpeg http://x/1.ts', xmltv_id: 'um.br' },
                { id: 11, name: '', cmd: 'http://x/2.ts' },
                { id: 12, name: 'Sem cmd' },
            ],
        })
        expect(channels).toHaveLength(1)
        expect(channels[0]).toMatchObject({ id: '10', name: 'Canal Um', genreId: '1', cmd: 'ffmpeg http://x/1.ts' })
    })
    it('shape inesperado retorna vazio', () => {
        expect(parseChannels(null)).toEqual([])
        expect(parseChannels({ data: 'x' })).toEqual([])
    })
})

describe('extractStreamUrl', () => {
    it('remove prefixos ffmpeg/auto', () => {
        expect(extractStreamUrl('ffmpeg http://x/s.ts')).toBe('http://x/s.ts')
        expect(extractStreamUrl('auto https://x/s.m3u8')).toBe('https://x/s.m3u8')
        expect(extractStreamUrl('http://x/s.ts')).toBe('http://x/s.ts')
    })
    it('sem URL retorna null', () => {
        expect(extractStreamUrl('ffmpeg')).toBeNull()
        expect(extractStreamUrl('')).toBeNull()
    })
})

describe('mapeamentos pro shape Xtream', () => {
    it('gêneros viram categorias com prefixo stk-', () => {
        expect(stalkerGenresToCategories([{ id: '2', title: 'Esportes' }])).toEqual([
            { category_id: 'stk-2', category_name: 'Esportes', parent_id: 0 },
        ])
    })
    it('canais viram live streams com cmd em direct_source', () => {
        const [stream] = stalkerChannelsToLiveStreams([
            { id: '10', name: 'Canal Um', number: 1, logo: 'l.png', genreId: '2', cmd: 'ffmpeg http://x/1.ts', xmltvId: 'um.br' },
        ])
        expect(stream).toMatchObject({
            stream_id: 10,
            name: 'Canal Um',
            category_id: 'stk-2',
            direct_source: 'ffmpeg http://x/1.ts',
            epg_channel_id: 'stk-ch-10',
        })
    })
})

describe('parseVodItems / parseTotalItems', () => {
    it('mapeia itens de VOD defensivamente', () => {
        const items = parseVodItems({
            total_items: 37,
            data: [
                { id: 7, name: 'Filme Um', screenshot_uri: 'http://x/p.jpg', cmd: 'auto /media/7.mpg', category_id: 3, year: 2024, description: 'desc' },
                { id: 8, name: '', cmd: 'x' },
            ],
        })
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({ id: '7', name: 'Filme Um', categoryId: '3', year: '2024' })
        expect(parseTotalItems({ total_items: 37 })).toBe(37)
        expect(parseTotalItems({ total_items: 'lixo' })).toBe(0)
    })
})

describe('stalkerVodToStreams / stalkerVodCategories', () => {
    it('vira o shape Xtream de VOD com ids deslocados e cmd em direct_source', () => {
        const [movie] = stalkerVodToStreams([
            { id: '7', name: 'Filme Um', logo: 'p.jpg', cmd: 'auto /media/7.mpg', categoryId: '3', year: '2024', description: '' },
        ])
        expect(movie).toMatchObject({
            stream_id: 200001,
            name: 'Filme Um',
            category_id: 'stk-vod-3',
            direct_source: 'auto /media/7.mpg',
        })
        expect(stalkerVodCategories([{ id: '3', title: 'Ação' }])[0]).toEqual({
            category_id: 'stk-vod-3', category_name: 'Ação', parent_id: 0,
        })
    })
})

describe('EPG do portal → XMLTV sintético', () => {
    it('parseEpgPrograms aceita {data:{ch:[...]}} e {ch:[...]}', () => {
        const program = { name: 'Jornal', descr: 'noticias', start_timestamp: 1751700000, stop_timestamp: 1751703600 }
        expect(parseEpgPrograms({ data: { '10': [program] } }).get('10')).toHaveLength(1)
        expect(parseEpgPrograms({ '10': [program] }).get('10')).toHaveLength(1)
        expect(parseEpgPrograms({ '10': [{ name: '', start_timestamp: 1, stop_timestamp: 2 }] }).size).toBe(0)
    })

    it('formatXmltvTime gera YYYYMMDDHHMMSS +0000 em UTC', () => {
        expect(formatXmltvTime(0)).toBe('19700101000000 +0000')
    })

    it('buildXmltvFromStalkerEpg gera documento com canais e programas escapados', () => {
        const xml = buildXmltvFromStalkerEpg(
            [{ id: '10', name: 'Canal <Um> & Cia', number: 1, logo: '', genreId: '1', cmd: 'ffmpeg http://x/1.ts', xmltvId: '' }],
            parseEpgPrograms({ '10': [{ name: 'Filme "X"', descr: '', start_timestamp: 1751700000, stop_timestamp: 1751703600 }] }),
        )
        expect(xml).toContain('<channel id="stk-ch-10">')
        expect(xml).toContain('Canal &lt;Um&gt; &amp; Cia')
        expect(xml).toContain('<title>Filme &quot;X&quot;</title>')
        expect(xml).toContain('channel="stk-ch-10"')
    })
})

describe('séries do portal (fase 3)', () => {
    it('parseSeriesItems e parseSeasons mapeiam defensivamente', () => {
        const items = parseSeriesItems({ data: [
            { id: 70, name: 'Serie Portal', screenshot_uri: 'c.jpg', category_id: 4 },
            { id: 71, name: '' },
        ] })
        expect(items).toEqual([{ id: '70', name: 'Serie Portal', logo: 'c.jpg', categoryId: '4' }])

        const seasons = parseSeasons({ data: [
            { id: '70:1', name: 'Season 1', cmd: 'auto /media/70-1.mpg', series: [1, 2, 3] },
            { id: '70:2', name: 'Season 2', cmd: 'auto /media/70-2.mpg', series: ['1', '2'] },
            { id: '70:x', name: 'vazia', cmd: 'auto /x', series: [] },
        ] })
        expect(seasons).toHaveLength(2)
        expect(seasons[1].episodes).toEqual([1, 2])
    })

    it('stalkerSeriesToList guarda o portal_id e desloca ids', () => {
        const [serie] = stalkerSeriesToList([{ id: '70', name: 'Serie Portal', logo: '', categoryId: '4' }])
        expect(serie).toMatchObject({ series_id: 500001, portal_id: '70', category_id: 'stk-ser-4' })
    })

    it('stalkerSeriesInfo monta o shape do modal com ids compostos', () => {
        const info = stalkerSeriesInfo('70', parseSeasons({ data: [
            { id: '70:1', name: 'Season 1', cmd: 'auto /m/1', series: [2, 1] },
            { id: '70:2', name: 'Season 2', cmd: 'auto /m/2', series: [1] },
        ] }))
        expect(Object.keys(info.episodes)).toEqual(['1', '2'])
        expect(info.episodes['1'].map(e => e.episode_num)).toEqual([1, 2])
        expect(info.episodes['1'][0].id).toBe('stk-ep|70|70:1|1')
    })

    it('parseStalkerEpisodeId faz o round-trip e rejeita lixo', () => {
        expect(parseStalkerEpisodeId(stalkerEpisodeId('70', '70:2', 5))).toEqual({
            portalSeriesId: '70', seasonId: '70:2', episode: 5,
        })
        expect(parseStalkerEpisodeId('12345')).toBeNull()
        expect(parseStalkerEpisodeId('stk-ep|70|x|zero')).toBeNull()
    })

    it('seasonNumberOf extrai do nome/id com fallback pro índice', () => {
        expect(seasonNumberOf({ id: '70:3', name: 'Temporada 3', cmd: 'x', episodes: [1] }, 0)).toBe(3)
        expect(seasonNumberOf({ id: '70:9', name: 'sem numero no nome', cmd: 'x', episodes: [1] }, 0)).toBe(9)
        expect(seasonNumberOf({ id: 'abc', name: 'sem nada', cmd: 'x', episodes: [1] }, 4)).toBe(5)
    })
})
