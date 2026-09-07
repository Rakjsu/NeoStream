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
// consumida pelo dashboard pra mostrar o convite da chave da TMDB.
const ONBOARDING_FLAG = 'neostream_tmdb_onboarding';

/**
 * Identidade deste carregamento do documento.
 *
 * A flag é sempre setada uma linha antes de um `window.location.reload()`, e
 * quem a acompanha (`playlistService.reloadIntoDashboard`) troca o hash pra
 * '#/dashboard' antes de recarregar. Essa troca de hash remonta o dashboard
 * AINDA no documento condenado — e essa montagem consumia o convite, que
 * então já não existia depois do boot. O resultado era um convite que
 * aparecia ou não, na sorte: a corrida entre o React pintar e o navegador
 * derrubar a página.
 *
 * Com o id do documento junto, só um documento DIFERENTE consome. Valores
 * antigos ('1', de versões anteriores) nunca batem com o id e continuam
 * valendo — quem atualizar no meio do fluxo não perde o convite.
 */
const DOC_ID = `${Date.now()}.${Math.random().toString(36).slice(2)}`;

export function getTmdbApiKey(): string {
    try {
        const own = (localStorage.getItem(STORAGE_KEY) || '').trim();
        if (own) return own;
        // Gancho de E2E: simula o app instalado (sem fallback de .env), já que
        // o vite build local embute o VITE_TMDB_API_KEY do dev.
        if (localStorage.getItem('neostream_tmdb_ignore_env') === '1') return '';
    } catch { /* storage indisponível (testes) */ }
    return (import.meta.env.VITE_TMDB_API_KEY || '').trim();
}

export function setTmdbApiKey(key: string): void {
    try {
        const trimmed = key.trim();
        if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
        else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage indisponível */ }
    espelharNoMain();
}

/**
 * Espelha a chave no processo main, que é quem serve o /setup — a página que
 * leva as contas pro celular. O app do celular já sabia aplicar a chave; o
 * desktop é que nunca a mandava.
 *
 * Mesmo padrão do `app:accent` e do `app:language`: o renderer é dono do
 * valor, o main guarda uma cópia em memória enquanto vive.
 */
export function espelharChaveTmdbNoMain(): void {
    espelharNoMain();
}

function espelharNoMain(): void {
    try {
        window.ipcRenderer?.send('app:tmdb-key', getTmdbApiKey());
    } catch { /* jsdom/testes sem preload */ }
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
    try { localStorage.setItem(ONBOARDING_FLAG, DOC_ID); } catch { /* ignore */ }
}

/**
 * Lê e limpa a flag de onboarding (consumo único).
 *
 * Ignora — sem limpar — a flag que ESTE documento acabou de escrever: ele está
 * a caminho do reload, e consumir aqui apagaria o convite antes de alguém ver.
 */
export function consumeTmdbOnboardingPending(): boolean {
    try {
        const pending = localStorage.getItem(ONBOARDING_FLAG);
        if (!pending || pending === DOC_ID) return false;
        localStorage.removeItem(ONBOARDING_FLAG);
        return true;
    } catch {
        return false;
    }
}
