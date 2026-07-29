import { describe, it, expect } from 'vitest'
import { channelEpgKey, needsEpgRefetch } from './liveEpgSchedule'

const iso = (offsetMinutes: number) => new Date(Date.UTC(2026, 6, 29, 12, 0, 0) + offsetMinutes * 60_000).toISOString()
const NOW = Date.UTC(2026, 6, 29, 12, 0, 0)

describe('channelEpgKey', () => {
    it('é a mesma para objetos diferentes do MESMO canal (o efeito não remonta por render)', () => {
        const a = { epg_channel_id: 'globo.br', name: 'Globo SP', stream_id: 12 }
        const b = { ...a }
        expect(a).not.toBe(b)
        expect(channelEpgKey(a)).toBe(channelEpgKey(b))
    })

    it('muda quando o canal muda de verdade', () => {
        expect(channelEpgKey({ epg_channel_id: 'globo.br', name: 'Globo', stream_id: 1 }))
            .not.toBe(channelEpgKey({ epg_channel_id: 'sbt.br', name: 'SBT', stream_id: 2 }))
        // Mesmo id de EPG, canais diferentes (variantes) continuam distintos.
        expect(channelEpgKey({ epg_channel_id: 'globo.br', name: 'Globo HD', stream_id: 1 }))
            .not.toBe(channelEpgKey({ epg_channel_id: 'globo.br', name: 'Globo HD', stream_id: 2 }))
    })

    it('canal sem nenhum identificador não tem chave', () => {
        expect(channelEpgKey(null)).toBe('')
        expect(channelEpgKey({ stream_id: 9 })).toBe('')
    })
})

describe('needsEpgRefetch', () => {
    it('não bate na rede enquanto o guia em memória cobre o futuro', () => {
        const programs = [
            { start: iso(-30), end: iso(30) },
            { start: iso(30), end: iso(90) }
        ]
        expect(needsEpgRefetch(programs, NOW)).toBe(false)
    })

    it('bate na rede quando o guia acabou (último programa já terminou)', () => {
        const programs = [
            { start: iso(-180), end: iso(-120) },
            { start: iso(-120), end: iso(-1) }
        ]
        expect(needsEpgRefetch(programs, NOW)).toBe(true)
    })

    it('canal sem guia nenhum ainda tenta', () => {
        expect(needsEpgRefetch([], NOW)).toBe(true)
    })

    it('ignora datas inválidas em vez de achar que o guia é válido', () => {
        expect(needsEpgRefetch([{ start: 'x', end: 'nao-e-data' }], NOW)).toBe(true)
    })

    it('programa em cartaz agora conta como cobertura', () => {
        expect(needsEpgRefetch([{ start: iso(-10), end: iso(10) }], NOW)).toBe(false)
    })
})
