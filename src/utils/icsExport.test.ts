import { describe, expect, it } from 'vitest'
import { buildIcs } from './icsExport'

const NOW = Date.UTC(2026, 6, 18, 12, 0, 0)

describe('buildIcs (exportação da Agenda)', () => {
    it('gera um VCALENDAR válido com um VEVENT por item', () => {
        const ics = buildIcs([
            { title: 'Jogo', startMs: Date.UTC(2026, 6, 19, 20, 0, 0), endMs: Date.UTC(2026, 6, 19, 22, 0, 0), description: 'ESPN' },
            { title: 'Novela', startMs: Date.UTC(2026, 6, 19, 21, 0, 0) },
        ], NOW)
        expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
        expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
        expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
        expect(ics).toContain('DTSTART:20260719T200000Z')
        expect(ics).toContain('DTEND:20260719T220000Z')
        expect(ics).toContain('DESCRIPTION:ESPN')
    })

    it('lembrete sem fim vira evento de 1h', () => {
        const ics = buildIcs([{ title: 'X', startMs: Date.UTC(2026, 6, 19, 21, 0, 0) }], NOW)
        expect(ics).toContain('DTSTART:20260719T210000Z')
        expect(ics).toContain('DTEND:20260719T220000Z')
    })

    it('escapa vírgula, ponto-e-vírgula e quebra de linha no texto', () => {
        const ics = buildIcs([{ title: 'A, B; C\nD', startMs: NOW }], NOW)
        expect(ics).toContain('SUMMARY:A\\, B\\; C\\nD')
    })

    it('UIDs são únicos dentro do arquivo', () => {
        const ics = buildIcs([{ title: 'a', startMs: NOW }, { title: 'b', startMs: NOW }], NOW)
        const uids = [...ics.matchAll(/UID:(\S+)/g)].map(m => m[1])
        expect(new Set(uids).size).toBe(2)
    })
})
