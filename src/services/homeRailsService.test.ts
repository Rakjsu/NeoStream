import { describe, expect, it } from 'vitest';
import {
    HOME_RAIL_KEYS, defaultHomeRailPrefs, moveHomeRail, orderedHomeRails,
    sanitizeHomeRailPrefs, toggleHomeRail,
} from './homeRailsService';

describe('homeRailsService (fileiras do Início)', () => {
    it('mover troca vizinhos e respeita as bordas', () => {
        const prefs = defaultHomeRailPrefs();
        const down = moveHomeRail(prefs, 'continue', 1);
        expect(down.order[0]).toBe('newEpisodes');
        expect(down.order[1]).toBe('continue');
        expect(moveHomeRail(prefs, 'continue', -1)).toBe(prefs); // topo não sobe
    });

    it('toggle esconde/mostra e orderedHomeRails filtra', () => {
        let prefs = defaultHomeRailPrefs();
        prefs = toggleHomeRail(prefs, 'recentMovies');
        expect(orderedHomeRails(prefs)).not.toContain('recentMovies');
        prefs = toggleHomeRail(prefs, 'recentMovies');
        expect(orderedHomeRails(prefs)).toContain('recentMovies');
    });

    it('sanitize joga fora chave estranha e completa as faltantes', () => {
        const prefs = sanitizeHomeRailPrefs({ order: ['recentMovies', 'zzz'], hidden: ['zzz', 'continue'] });
        expect(prefs.order[0]).toBe('recentMovies');
        expect(prefs.order).toHaveLength(HOME_RAIL_KEYS.length);
        expect(prefs.hidden).toEqual(['continue']);
        expect(sanitizeHomeRailPrefs(null).order).toEqual([...HOME_RAIL_KEYS]);
    });
});
