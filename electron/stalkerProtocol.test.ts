import { describe, it, expect } from 'vitest'
import {
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
            epg_channel_id: 'um.br',
        })
    })
})
