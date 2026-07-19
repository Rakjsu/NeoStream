import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zapHistoryService } from './zapHistoryService';
import { profileService } from './profileService';

describe('zapHistoryService', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(profileService, 'getActiveProfile').mockReturnValue({
            id: 'p1', name: 'Teste', avatar: '👤', createdAt: 0
        } as ReturnType<typeof profileService.getActiveProfile>);
    });

    it('começa vazio', () => {
        expect(zapHistoryService.getRecent()).toEqual([]);
    });

    it('guarda em ordem MRU (mais recente primeiro)', () => {
        zapHistoryService.push('1');
        zapHistoryService.push('2');
        zapHistoryService.push('3');
        expect(zapHistoryService.getRecent()).toEqual(['3', '2', '1']);
    });

    it('re-zapear um canal move ele pra frente sem duplicar', () => {
        zapHistoryService.push('1');
        zapHistoryService.push('2');
        zapHistoryService.push('1');
        expect(zapHistoryService.getRecent()).toEqual(['1', '2']);
    });

    it('respeita o teto de 10 entradas', () => {
        for (let i = 1; i <= 14; i++) zapHistoryService.push(String(i));
        const recent = zapHistoryService.getRecent();
        expect(recent).toHaveLength(10);
        expect(recent[0]).toBe('14');
        expect(recent).not.toContain('4');
    });

    it('push devolve a lista nova', () => {
        expect(zapHistoryService.push('7')).toEqual(['7']);
    });

    it('sem perfil ativo não grava nem quebra', () => {
        vi.spyOn(profileService, 'getActiveProfile').mockReturnValue(null);
        expect(zapHistoryService.push('1')).toEqual(['1']);
        expect(zapHistoryService.getRecent()).toEqual([]);
    });

    it('ignora lixo no localStorage', () => {
        const before = zapHistoryService.push('1');
        expect(before).toEqual(['1']);
        // corrompe a chave usada
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('neostream_zap_history')) localStorage.setItem(key, '{broken');
        }
        expect(zapHistoryService.getRecent()).toEqual([]);
    });
});
