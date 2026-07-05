import { describe, it, expect } from 'vitest'
import { parseM3u, m3uCategories, m3uToLiveStreams, m3uToVodStreams, classifyM3uChannels, parseM3uHeader, looksLikeM3u, parseEpisodeTag, m3uToSeries, m3uSeriesInfo, findM3uEpisodeUrl } from './m3uProtocol'

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="globo.br" tvg-logo="http://x/globo.png" group-title="Abertos",Globo SP
http://server/globo.m3u8
#EXTINF:-1 group-title="Abertos",SBT
http://server/sbt.ts
#EXTINF:-1 tvg-logo="http://x/espn.png" group-title="Esportes",ESPN
http://server/espn.m3u8
#EXTINF:-1,Sem Grupo
http://server/avulso.m3u8
`

describe('parseM3u', () => {
    it('extrai nome, url, logo, grupo e tvg-id', () => {
        const channels = parseM3u(SAMPLE)
        expect(channels).toHaveLength(4)
        expect(channels[0]).toEqual({
            name: 'Globo SP',
            url: 'http://server/globo.m3u8',
            logo: 'http://x/globo.png',
            group: 'Abertos',
            tvgId: 'globo.br'
        })
        expect(channels[3]).toMatchObject({ name: 'Sem Grupo', group: undefined })
    })

    it('tolera CRLF, BOM, linhas vazias e diretivas desconhecidas', () => {
        const text = '﻿#EXTM3U\r\n\r\n#EXTGRP:x\r\n#EXTINF:-1,Um\r\nhttp://a/1\r\n'
        expect(parseM3u(text)).toEqual([{ name: 'Um', url: 'http://a/1', logo: undefined, group: undefined, tvgId: undefined }])
    })

    it('nome com vírgula usa a última vírgula como separador', () => {
        const channels = parseM3u('#EXTINF:-1 group-title="G",Nome, com vírgula\nhttp://a/1\n')
        expect(channels[0].name).toBe('com vírgula') // last-comma rule (documented)
    })

    it('url sem #EXTINF vira canal com o próprio url como nome', () => {
        expect(parseM3u('http://a/só-url\n')[0].name).toBe('http://a/só-url')
    })
})

describe('m3uCategories / m3uToLiveStreams', () => {
    const channels = parseM3u(SAMPLE)

    it('grupos viram categorias estáveis; sem grupo cai em M3U', () => {
        expect(m3uCategories(channels)).toEqual([
            { category_id: 'm3u-0', category_name: 'Abertos', parent_id: 0 },
            { category_id: 'm3u-1', category_name: 'Esportes', parent_id: 0 },
            { category_id: 'm3u-2', category_name: 'M3U', parent_id: 0 }
        ])
    })

    it('mapeia pro shape LiveStream com direct_source', () => {
        const streams = m3uToLiveStreams(channels)
        expect(streams[0]).toMatchObject({
            num: 1,
            stream_id: 1,
            name: 'Globo SP',
            stream_icon: 'http://x/globo.png',
            epg_channel_id: 'globo.br',
            category_id: 'm3u-0',
            direct_source: 'http://server/globo.m3u8'
        })
        expect(streams[3].category_id).toBe('m3u-2')
    })
})

describe('looksLikeM3u', () => {
    it('aceita M3U e rejeita HTML/JSON', () => {
        expect(looksLikeM3u(SAMPLE)).toBe(true)
        expect(looksLikeM3u('﻿  #EXTM3U\n')).toBe(true)
        expect(looksLikeM3u('<!DOCTYPE html><html>')).toBe(false)
        expect(looksLikeM3u('{"user_info":{}}')).toBe(false)
    })
})

describe('parseM3uHeader', () => {
    it('extrai url-tvg do cabeçalho', () => {
        expect(parseM3uHeader('#EXTM3U url-tvg="http://x/guide.xml"\n#EXTINF:-1,A\nhttp://a/1\n'))
            .toEqual({ urlTvg: 'http://x/guide.xml' })
        expect(parseM3uHeader('#EXTM3U x-tvg-url="https://y/epg.xml"\n')).toEqual({ urlTvg: 'https://y/epg.xml' })
    })

    it('sem cabeçalho ou url inválida → vazio', () => {
        expect(parseM3uHeader('#EXTINF:-1,A\nhttp://a/1\n')).toEqual({})
        expect(parseM3uHeader('#EXTM3U url-tvg="ftp://nope"\n')).toEqual({})
        expect(parseM3uHeader('#EXTM3U\n')).toEqual({})
    })
})

describe('classifyM3uChannels / m3uToVodStreams', () => {
    const channels = parseM3u([
        '#EXTM3U',
        '#EXTINF:-1 group-title="Abertos",Globo',
        'http://a/globo.m3u8',
        '#EXTINF:-1 group-title="FILMES | Ação",Matrix',
        'http://a/matrix.mp4',
        '#EXTINF:-1 group-title="Movies VIP",Duna',
        'http://a/duna.mkv?token=1',
        '#EXTINF:-1,Avulso',
        'http://a/avulso.ts'
    ].join('\n'))

    it('separa live de vod por group-title', () => {
        const { live, vod } = classifyM3uChannels(channels)
        expect(live.map(c => c.name)).toEqual(['Globo', 'Avulso'])
        expect(vod.map(c => c.name)).toEqual(['Matrix', 'Duna'])
    })

    it('vod ganha shape Xtream com container do url e ids deslocados', () => {
        const vod = m3uToVodStreams(classifyM3uChannels(channels).vod)
        expect(vod[0]).toMatchObject({
            name: 'Matrix',
            stream_id: 100001,
            container_extension: 'mp4',
            direct_source: 'http://a/matrix.mp4'
        })
        expect(vod[1].container_extension).toBe('mkv')
    })
})

describe('parseEpisodeTag', () => {
    it('reconhece SxxEyy, S01 E02 e 1x02 com baseName limpo', () => {
        expect(parseEpisodeTag('Minha Serie S01E02')).toEqual({ season: 1, episode: 2, baseName: 'Minha Serie' })
        expect(parseEpisodeTag('Minha.Serie.S2.E10')).toEqual({ season: 2, episode: 10, baseName: 'Minha.Serie' })
        expect(parseEpisodeTag('Outra - 3x07')).toEqual({ season: 3, episode: 7, baseName: 'Outra' })
    })
    it('nomes sem tag retornam null', () => {
        expect(parseEpisodeTag('Filme Legal (2026)')).toBeNull()
        expect(parseEpisodeTag('')).toBeNull()
    })
})

describe('series M3U (fase 3)', () => {
    const seriesChannels = [
        { name: 'Beta S01E02', url: 'http://x/beta-s01e02.mkv', logo: 'b.png', group: 'SÉRIES | Drama', tvgId: '' },
        { name: 'Alfa S01E01', url: 'http://x/alfa-s01e01.mp4', logo: 'a.png', group: 'SÉRIES | Drama', tvgId: '' },
        { name: 'Beta S01E01', url: 'http://x/beta-s01e01.mkv', logo: 'b.png', group: 'SÉRIES | Drama', tvgId: '' },
        { name: 'Beta S02E01', url: 'http://x/beta-s02e01.mkv', logo: 'b.png', group: 'SÉRIES | Drama', tvgId: '' },
    ]

    it('classifica itens com tag em grupos de série/filme como séries', () => {
        const { live, vod, series } = classifyM3uChannels([
            { name: 'Canal Um', url: 'http://x/1.m3u8', logo: '', group: 'Abertos', tvgId: '' },
            { name: 'Filme Legal', url: 'http://x/f.mp4', logo: '', group: 'FILMES | Ação', tvgId: '' },
            ...seriesChannels,
        ])
        expect(live).toHaveLength(1)
        expect(vod).toHaveLength(1)
        expect(series).toHaveLength(4)
    })

    it('agrupa por baseName com ids estáveis (ordem alfabética)', () => {
        const series = m3uToSeries(seriesChannels)
        expect(series.map(s => s.name)).toEqual(['Alfa', 'Beta'])
        expect(series[0].series_id).toBe(300001)
        expect(series[1].series_id).toBe(300002)
        expect(series[1].cover).toBe('b.png')
    })

    it('m3uSeriesInfo monta temporadas/episódios ordenados no shape do modal', () => {
        const beta = m3uToSeries(seriesChannels).find(s => s.name === 'Beta')!
        const info = m3uSeriesInfo(seriesChannels, beta.series_id)
        expect(Object.keys(info.episodes)).toEqual(['1', '2'])
        expect(info.episodes['1'].map(e => e.episode_num)).toEqual([1, 2])
        expect(info.episodes['1'][0].container_extension).toBe('mkv')
    })

    it('findM3uEpisodeUrl resolve o id de volta pra URL do item', () => {
        const beta = m3uToSeries(seriesChannels).find(s => s.name === 'Beta')!
        const info = m3uSeriesInfo(seriesChannels, beta.series_id)
        const episode = info.episodes['1'][0] // Beta S01E01 (índice 2 na lista)
        expect(findM3uEpisodeUrl(seriesChannels, episode.id)).toBe('http://x/beta-s01e01.mkv')
        expect(findM3uEpisodeUrl(seriesChannels, 499999)).toBeNull()
    })
})
