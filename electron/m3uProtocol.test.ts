import { describe, it, expect } from 'vitest'
import { parseM3u, m3uCategories, m3uToLiveStreams, m3uToVodStreams, classifyM3uChannels, parseM3uHeader, looksLikeM3u } from './m3uProtocol'

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
