import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * O convite da chave da TMDB aparecia OU NÃO, na sorte.
 *
 * `setTmdbOnboardingPending()` é sempre chamado uma linha antes de um
 * `window.location.reload()`, e o `reloadIntoDashboard` troca o hash pra
 * '#/dashboard' antes de recarregar. Essa troca remonta o dashboard ainda no
 * documento condenado — e a Home consome a flag no inicializador do estado.
 * Se o React pintasse antes de o navegador derrubar a página, o convite era
 * consumido por uma tela que ninguém chegou a ver, e depois do boot não
 * existia mais. Foi assim que o e2e do onboarding virou moeda ao ar.
 */
describe('convite da TMDB sobrevive ao reload', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules(); // cada import novo = um "documento" novo
    });

    it('o documento que setou NÃO consome — ele ainda vai recarregar', async () => {
        const mod = await import('./tmdbKey');
        mod.setTmdbOnboardingPending();
        expect(mod.consumeTmdbOnboardingPending()).toBe(false);
        // E, principalmente, não apaga: o boot seguinte precisa achar a flag.
        expect(localStorage.getItem('neostream_tmdb_onboarding')).not.toBeNull();
    });

    it('o boot seguinte consome — uma vez só', async () => {
        const condenado = await import('./tmdbKey');
        condenado.setTmdbOnboardingPending();

        vi.resetModules();
        const depoisDoReload = await import('./tmdbKey');
        expect(depoisDoReload.consumeTmdbOnboardingPending()).toBe(true);
        expect(depoisDoReload.consumeTmdbOnboardingPending()).toBe(false);
    });

    it('flag no formato antigo ("1") continua valendo', async () => {
        // Quem atualizar o app no meio do fluxo não perde o convite.
        localStorage.setItem('neostream_tmdb_onboarding', '1');
        const mod = await import('./tmdbKey');
        expect(mod.consumeTmdbOnboardingPending()).toBe(true);
        expect(localStorage.getItem('neostream_tmdb_onboarding')).toBeNull();
    });

    it('sem flag nenhuma, nada acontece', async () => {
        const mod = await import('./tmdbKey');
        expect(mod.consumeTmdbOnboardingPending()).toBe(false);
    });
});
