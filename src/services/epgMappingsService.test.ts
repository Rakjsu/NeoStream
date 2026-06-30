import { describe, it, expect, beforeEach } from 'vitest';
import {
    isValidMappingObject,
    mergeMappings,
    shouldRefresh,
    getMergedMappings,
    REFRESH_INTERVAL_MS
} from './epgMappingsService';

describe('epgMappingsService — pure helpers', () => {
    it('validates flat string→string objects only', () => {
        expect(isValidMappingObject({ a: 'x', b: 'y' })).toBe(true);
        expect(isValidMappingObject({})).toBe(true);
        expect(isValidMappingObject({ a: 1 })).toBe(false);
        expect(isValidMappingObject(['a', 'b'])).toBe(false);
        expect(isValidMappingObject(null)).toBe(false);
        expect(isValidMappingObject('x')).toBe(false);
    });

    it('merges remote over static (remote wins, static fills gaps)', () => {
        const merged = mergeMappings({ a: '1', b: '2' }, { b: '9', c: '3' });
        expect(merged).toEqual({ a: '1', b: '9', c: '3' });
    });

    it('mergeMappings with null remote returns a copy of static', () => {
        const staticMap = { a: '1' };
        const merged = mergeMappings(staticMap, null);
        expect(merged).toEqual({ a: '1' });
        expect(merged).not.toBe(staticMap);
    });

    it('shouldRefresh: stale/missing/invalid → true; recent → false', () => {
        const now = 1_000_000_000;
        expect(shouldRefresh(null, now, REFRESH_INTERVAL_MS)).toBe(true);
        expect(shouldRefresh(NaN, now, REFRESH_INTERVAL_MS)).toBe(true);
        expect(shouldRefresh(now - REFRESH_INTERVAL_MS, now, REFRESH_INTERVAL_MS)).toBe(true);
        expect(shouldRefresh(now - 1000, now, REFRESH_INTERVAL_MS)).toBe(false);
        expect(shouldRefresh(now, now, REFRESH_INTERVAL_MS)).toBe(false);
    });
});

describe('epgMappingsService — getMergedMappings (cache)', () => {
    beforeEach(() => localStorage.clear());

    it('returns static when no cache present', () => {
        expect(getMergedMappings('mitv', { globo: 'globo' })).toEqual({ globo: 'globo' });
    });

    it('merges a valid cached remote over static', () => {
        localStorage.setItem('epg_mappings_remote_mitv', JSON.stringify({ globo: 'globo-novo', sbt: 'sbt' }));
        expect(getMergedMappings('mitv', { globo: 'globo' })).toEqual({ globo: 'globo-novo', sbt: 'sbt' });
    });

    it('ignores a corrupt/invalid cache and falls back to static', () => {
        localStorage.setItem('epg_mappings_remote_mitv', 'not json');
        expect(getMergedMappings('mitv', { globo: 'globo' })).toEqual({ globo: 'globo' });
        localStorage.setItem('epg_mappings_remote_mitv', JSON.stringify({ a: 5 }));
        expect(getMergedMappings('mitv', { globo: 'globo' })).toEqual({ globo: 'globo' });
    });
});
