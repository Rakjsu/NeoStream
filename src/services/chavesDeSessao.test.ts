import { describe, it, expect } from 'vitest';
import { CHAVES_LIMPAS_NO_LOGOUT, limparSessao, sobreviveAoLogout } from './chavesDeSessao';

describe('sobreviveAoLogout', () => {
    it('o dado da pessoa FICA — era isto que o localStorage.clear() levava', () => {
        const dados = [
            'neostream_profiles',                       // perfis
            'neostream_profile_adulto__pl_abc',         // favoritos e progresso
            'neostream_keymap_v1',                      // atalhos de teclado
            'neostream_theme',                          // aparência
            'neostream_language',
            'neostream_personal_marks',                 // tags pessoais
            'neostream_parental_log',
            'neostream_tmdb_api_key',                   // a chave é do usuário
            'neostream_home_rails',
            'neostream_sync_tombstones',
        ];
        for (const chave of dados) {
            expect(sobreviveAoLogout(chave), chave).toBe(true);
        }
    });

    it('a sessão sai: o espelho da lista ativa e os caches do provedor', () => {
        expect(sobreviveAoLogout('neostream_active_playlist_id')).toBe(false);
        expect(sobreviveAoLogout('contentLastFetch')).toBe(false);
        expect(sobreviveAoLogout('epg_test_results')).toBe(false);
        expect(sobreviveAoLogout('neostream_catalog_last_refresh')).toBe(false);
    });

    it('a lista é curta e explícita — crescer sem querer é o risco', () => {
        expect(CHAVES_LIMPAS_NO_LOGOUT).toHaveLength(4);
    });
});

describe('limparSessao', () => {
    it('remove exatamente as chaves de sessão, e nenhuma outra', () => {
        const removidas: string[] = [];
        limparSessao({ removeItem: (k: string) => { removidas.push(k); } });
        expect(removidas).toEqual([...CHAVES_LIMPAS_NO_LOGOUT]);
    });

    it('storage que lança não impede a saída', () => {
        // Janela anônima ou storage bloqueado: sair da conta continua valendo.
        expect(() => limparSessao({
            removeItem: () => { throw new Error('bloqueado'); }
        })).not.toThrow();
    });
});
