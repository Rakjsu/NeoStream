import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedRecommendationsService } from './blockedRecommendationsService';
import { profileService } from './profileService';

describe('blockedRecommendationsService', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(profileService, 'getActiveProfile').mockReturnValue({
            id: 'p1', name: 'Teste', avatar: '👤', createdAt: 0, watchLater: [], continueWatching: [], lastUsed: 0
        } as unknown as ReturnType<typeof profileService.getActiveProfile>);
    });

    it('começa vazio', () => {
        expect(blockedRecommendationsService.getAll().size).toBe(0);
    });

    it('bane filme e série com chaves separadas por tipo', () => {
        blockedRecommendationsService.block('movie', 10);
        blockedRecommendationsService.block('series', 10);
        expect(blockedRecommendationsService.getBlockedIds('movie')).toEqual(new Set(['10']));
        expect(blockedRecommendationsService.getBlockedIds('series')).toEqual(new Set(['10']));
        expect(blockedRecommendationsService.getAll().size).toBe(2);
    });

    it('banir duas vezes não duplica', () => {
        blockedRecommendationsService.block('movie', '7');
        blockedRecommendationsService.block('movie', 7);
        expect(blockedRecommendationsService.getAll().size).toBe(1);
    });

    it('persiste no localStorage e relê', () => {
        blockedRecommendationsService.block('movie', 1);
        expect(blockedRecommendationsService.getBlockedIds('movie').has('1')).toBe(true);
    });

    it('sem perfil ativo não grava nem quebra', () => {
        vi.spyOn(profileService, 'getActiveProfile').mockReturnValue(null);
        expect(blockedRecommendationsService.block('movie', 1).has('movie:1')).toBe(true);
        expect(blockedRecommendationsService.getAll().size).toBe(0);
    });

    it('ignora lixo no localStorage', () => {
        blockedRecommendationsService.block('movie', 1);
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('neostream_blocked_recommendations')) localStorage.setItem(key, '{broken');
        }
        expect(blockedRecommendationsService.getAll().size).toBe(0);
    });
});
