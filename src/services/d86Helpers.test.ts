import { describe, it, expect, beforeEach } from 'vitest';
import { recordingRuleService, ruleMatches } from './recordingRuleService';
import { profileService } from './profileService';
import { watchLaterService } from './watchLater';

describe('recordingRuleService', () => {
    beforeEach(() => localStorage.clear());

    it('add valida o regex e deduplica', () => {
        expect(recordingRuleService.add('^Jornal')).toBe(true);
        expect(recordingRuleService.add('^Jornal')).toBe(false); // dupe
        expect(recordingRuleService.add('[inválido')).toBe(false); // regex quebrado
        expect(recordingRuleService.add('   ')).toBe(false);
        expect(recordingRuleService.list()).toHaveLength(1);
    });

    it('ruleMatches casa título (case-insensitive) e restringe por canal', () => {
        recordingRuleService.add('jornal', 'Globo');
        const rules = recordingRuleService.list();
        expect(ruleMatches(rules, 'Jornal Nacional', 'TV Globo HD')).toBe(true);
        expect(ruleMatches(rules, 'Jornal Nacional', 'Record')).toBe(false); // canal errado
        expect(ruleMatches(rules, 'Novela', 'TV Globo HD')).toBe(false);
    });

    it('regra com regex corrompido no storage é ignorada sem quebrar', () => {
        localStorage.setItem('recording_rules_v1', JSON.stringify([
            { id: 'a', pattern: '[', createdAt: '2026-01-01' },
            { id: 'b', pattern: 'filme', createdAt: '2026-01-01' },
        ]));
        expect(ruleMatches(recordingRuleService.list(), 'Filme da noite', 'X')).toBe(true);
    });
});

describe('watchLaterService.reorder', () => {
    beforeEach(async () => {
        localStorage.clear();
        await profileService.createProfile({ name: 'T', avatar: 'x' });
    });

    it('move o item e persiste a nova ordem', () => {
        watchLaterService.add({ id: '1', type: 'movie', name: 'A', cover: '' });
        watchLaterService.add({ id: '2', type: 'movie', name: 'B', cover: '' });
        watchLaterService.add({ id: '3', type: 'movie', name: 'C', cover: '' });
        expect(watchLaterService.reorder(0, 2).map(i => i.id)).toEqual(['2', '3', '1']);
        expect(watchLaterService.getAll().map(i => i.id)).toEqual(['2', '3', '1']);
    });

    it('índices inválidos são no-op', () => {
        watchLaterService.add({ id: '1', type: 'movie', name: 'A', cover: '' });
        expect(watchLaterService.reorder(0, 5).map(i => i.id)).toEqual(['1']);
        expect(watchLaterService.reorder(-1, 0).map(i => i.id)).toEqual(['1']);
    });
});
