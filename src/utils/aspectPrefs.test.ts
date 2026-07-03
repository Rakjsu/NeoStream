import { describe, it, expect, beforeEach } from 'vitest';
import { aspectPrefs, aspectPrefKey } from './aspectPrefs';

describe('aspectPrefKey', () => {
    it('compõe tipo:id e devolve null sem id', () => {
        expect(aspectPrefKey('live', '42')).toBe('live:42');
        expect(aspectPrefKey(undefined, '42')).toBe('movie:42');
        expect(aspectPrefKey('live', undefined)).toBeNull();
    });
});

describe('aspectPrefs', () => {
    beforeEach(() => localStorage.clear());

    it('persiste e lê por conteúdo', () => {
        aspectPrefs.set('live:1', 'original');
        aspectPrefs.set('movie:2', 'zoom');
        expect(aspectPrefs.get('live:1')).toBe('original');
        expect(aspectPrefs.get('movie:2')).toBe('zoom');
        expect(aspectPrefs.get('live:999')).toBeNull();
    });

    it('fill (padrão) remove a entrada em vez de armazenar', () => {
        aspectPrefs.set('live:1', 'original');
        aspectPrefs.set('live:1', 'fill');
        expect(aspectPrefs.get('live:1')).toBeNull();
        expect(localStorage.getItem('neostream_aspect_prefs')).toBe('{}');
    });

    it('ignora storage corrompido e valores inválidos', () => {
        localStorage.setItem('neostream_aspect_prefs', '{lixo');
        expect(aspectPrefs.get('live:1')).toBeNull();
        localStorage.setItem('neostream_aspect_prefs', '{"live:1":"banana"}');
        expect(aspectPrefs.get('live:1')).toBeNull();
    });
});
