/**
 * TMDB API key do PRÓPRIO usuário (Configurações → APIs).
 *
 * O app não embute mais uma chave nossa nos builds: cada pessoa cria a sua
 * (gratuita) em themoviedb.org e cola aqui. Sem chave, o app funciona
 * normalmente — só ficam de fora os metadados TMDB (capas melhores, sinopses,
 * notas, trailers, classificação etária e o reforço de gêneros das
 * recomendações). Em dev, o fallback VITE_TMDB_API_KEY do .env local ainda
 * vale (nunca é embutido em release; o CI não define o secret).
 */

const STORAGE_KEY = 'neostream_tmdb_api_key';

// Flag de onboarding: setada ao adicionar playlist sem chave configurada,
// consumida pelo dashboard pra redirecionar às Configurações → APIs.
const ONBOARDING_FLAG = 'neostream_tmdb_onboarding';

export function getTmdbApiKey(): string {
    try {
        const own = (localStorage.getItem(STORAGE_KEY) || '').trim();
        if (own) return own;
    } catch { /* storage indisponível (testes) */ }
    return (import.meta.env.VITE_TMDB_API_KEY || '').trim();
}

export function setTmdbApiKey(key: string): void {
    try {
        const trimmed = key.trim();
        if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
        else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage indisponível */ }
}

export function hasTmdbApiKey(): boolean {
    return getTmdbApiKey().length > 0;
}

/** Valida a chave online (GET /configuration): true = aceita pela TMDB. */
export async function validateTmdbApiKey(key: string): Promise<boolean> {
    const trimmed = key.trim();
    if (!trimmed) return false;
    try {
        const res = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(trimmed)}`);
        return res.ok;
    } catch {
        return false;
    }
}

export function setTmdbOnboardingPending(): void {
    try { localStorage.setItem(ONBOARDING_FLAG, '1'); } catch { /* ignore */ }
}

/** Lê e limpa a flag de onboarding (consumo único). */
export function consumeTmdbOnboardingPending(): boolean {
    try {
        const pending = localStorage.getItem(ONBOARDING_FLAG) === '1';
        if (pending) localStorage.removeItem(ONBOARDING_FLAG);
        return pending;
    } catch {
        return false;
    }
}
