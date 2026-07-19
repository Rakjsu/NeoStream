/**
 * Trakt.tv com credenciais do PRÓPRIO usuário (mesmo modelo do TMDB/mobile):
 * a pessoa cria um app pessoal em trakt.tv/oauth/applications e cola o
 * Client ID/Secret em Configurações → APIs. A conexão é por device code
 * (código digitado no site) e os "vistos" locais viram /sync/history —
 * melhor esforço, casando por busca de título; nunca trava o fluxo local.
 */

const API = 'https://api.trakt.tv';
const CREDS_KEY = 'neostream_trakt_creds';
const TOKEN_KEY = 'neostream_trakt_token';

export interface TraktCreds {
    clientId: string;
    clientSecret: string;
}

interface TraktToken {
    access: string;
    refresh: string;
}

export function getTraktCreds(): TraktCreds {
    try {
        const raw = localStorage.getItem(CREDS_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<TraktCreds>) : null;
        return {
            clientId: typeof parsed?.clientId === 'string' ? parsed.clientId : '',
            clientSecret: typeof parsed?.clientSecret === 'string' ? parsed.clientSecret : '',
        };
    } catch {
        return { clientId: '', clientSecret: '' };
    }
}

export function setTraktCreds(creds: TraktCreds): void {
    try {
        localStorage.setItem(CREDS_KEY, JSON.stringify({
            clientId: creds.clientId.trim(),
            clientSecret: creds.clientSecret.trim(),
        }));
    } catch { /* storage indisponível */ }
}

function getToken(): TraktToken | null {
    try {
        const raw = localStorage.getItem(TOKEN_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<TraktToken>) : null;
        return parsed?.access ? { access: parsed.access, refresh: parsed.refresh ?? '' } : null;
    } catch {
        return null;
    }
}

export function isTraktConnected(): boolean {
    return !!getToken();
}

export function disconnectTrakt(): void {
    try {
        localStorage.removeItem(TOKEN_KEY);
    } catch { /* best-effort */ }
}

export interface DeviceAuth {
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    intervalSec: number;
    expiresIn: number;
}

/** Passo 1 do device code: pede o código que o usuário digita no site. */
export async function startDeviceAuth(): Promise<DeviceAuth | null> {
    const { clientId } = getTraktCreds();
    if (!clientId) return null;
    try {
        const response = await fetch(`${API}/oauth/device/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId }),
        });
        if (!response.ok) return null;
        const data = await response.json() as {
            device_code?: string; user_code?: string; verification_url?: string; interval?: number; expires_in?: number;
        };
        if (!data.device_code || !data.user_code) return null;
        return {
            deviceCode: data.device_code,
            userCode: data.user_code,
            verificationUrl: data.verification_url ?? 'https://trakt.tv/activate',
            intervalSec: data.interval ?? 5,
            expiresIn: data.expires_in ?? 600,
        };
    } catch {
        return null;
    }
}

/** Passo 2: pergunta se o usuário já autorizou (400 = ainda não). */
export async function pollDeviceToken(deviceCode: string): Promise<'ok' | 'pending' | 'error'> {
    const { clientId, clientSecret } = getTraktCreds();
    if (!clientId || !clientSecret) return 'error';
    try {
        const response = await fetch(`${API}/oauth/device/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: deviceCode, client_id: clientId, client_secret: clientSecret }),
        });
        if (response.status === 200) {
            const data = await response.json() as { access_token?: string; refresh_token?: string };
            if (!data.access_token) return 'error';
            localStorage.setItem(TOKEN_KEY, JSON.stringify({ access: data.access_token, refresh: data.refresh_token ?? '' }));
            return 'ok';
        }
        if (response.status === 400) return 'pending';
        return 'error';
    } catch {
        return 'error';
    }
}

export interface TraktHit {
    title?: string;
    year?: number;
    ids?: Record<string, unknown>;
}

/** Melhor resultado da busca (PURO): título igual (e ano, se houver) vence; senão o 1º. */
export function pickSearchHit(results: { movie?: TraktHit; show?: TraktHit }[], title: string, year?: number): TraktHit | null {
    const wanted = title.toLowerCase().trim();
    const items: TraktHit[] = [];
    for (const result of results) {
        const item = result.movie ?? result.show;
        if (item) items.push(item);
    }
    const exact = items.find(item => item.title?.toLowerCase().trim() === wanted && (!year || item.year === year));
    return exact ?? items[0] ?? null;
}

/** "Filme (2024)" → { clean, year } (PURO — o ano ajuda a desambiguar a busca). */
export function splitTitleYear(title: string): { clean: string; year?: number } {
    const year = Number(/\((\d{4})\)/.exec(title)?.[1]) || undefined;
    const clean = title.replace(/\s*\(\d{4}\)\s*/g, ' ').trim();
    return { clean, year };
}

async function traktGet(path: string, clientId: string, access: string): Promise<unknown> {
    const response = await fetch(`${API}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': clientId,
            Authorization: `Bearer ${access}`,
        },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function traktPost(path: string, body: unknown, clientId: string, access: string): Promise<void> {
    const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': clientId,
            Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

// ids resolvidos por título nesta sessão — sync repetido não re-busca.
const idsCache = new Map<string, Record<string, unknown> | null>();

async function resolveMovieIds(title: string, clientId: string, access: string): Promise<Record<string, unknown> | null> {
    const cacheKey = `movie|${title}`;
    if (idsCache.has(cacheKey)) return idsCache.get(cacheKey) ?? null;
    let ids: Record<string, unknown> | null = null;
    const { clean, year } = splitTitleYear(title);
    if (clean) {
        const results = await traktGet(`/search/movie?query=${encodeURIComponent(clean)}`, clientId, access) as { movie?: TraktHit }[];
        ids = pickSearchHit(results, clean, year)?.ids ?? null;
    }
    idsCache.set(cacheKey, ids);
    return ids;
}

async function resolveShowIds(title: string, clientId: string, access: string): Promise<Record<string, unknown> | null> {
    const cacheKey = `show|${title}`;
    if (idsCache.has(cacheKey)) return idsCache.get(cacheKey) ?? null;
    let ids: Record<string, unknown> | null = null;
    const { clean } = splitTitleYear(title);
    if (clean) {
        const results = await traktGet(`/search/show?query=${encodeURIComponent(clean)}`, clientId, access) as { show?: TraktHit }[];
        ids = pickSearchHit(results, clean)?.ids ?? null;
    }
    idsCache.set(cacheKey, ids);
    return ids;
}

/**
 * Filme concluído (95%+) vira "visto" no Trakt — fire-and-forget do
 * movieProgressService. false = não sincronizou (desconectado, sem match…).
 */
export async function syncTraktMovieWatched(title: string): Promise<boolean> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId) return false;
    try {
        const ids = await resolveMovieIds(title, clientId, token.access);
        if (!ids) return false;
        await traktPost('/sync/history', { movies: [{ ids }] }, clientId, token.access);
        return true;
    } catch {
        return false;
    }
}

/** Episódio visto (temporada/número REAIS do provedor — sem parsing de título). */
export async function syncTraktEpisodeWatched(showTitle: string, season: number, episode: number): Promise<boolean> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId || !Number.isFinite(season) || !Number.isFinite(episode)) return false;
    try {
        const ids = await resolveShowIds(showTitle, clientId, token.access);
        if (!ids) return false;
        await traktPost('/sync/history', {
            shows: [{ ids, seasons: [{ number: season, episodes: [{ number: episode }] }] }],
        }, clientId, token.access);
        return true;
    } catch {
        return false;
    }
}

/**
 * 📡 Scrobble em tempo real: start ao abrir o player, pause com o progresso ao
 * sair — o Trakt mostra "assistindo agora". O visto final continua indo pelo
 * /sync/history (gatilho de 85% do progresso local) — stop aqui duplicaria o play.
 */
export async function traktScrobble(
    target: { kind: 'movie'; title: string } | { kind: 'episode'; showTitle: string; season: number; episode: number },
    action: 'start' | 'pause',
    progress: number
): Promise<boolean> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId) return false;
    try {
        let piece: Record<string, unknown> | null = null;
        if (target.kind === 'movie') {
            const ids = await resolveMovieIds(target.title, clientId, token.access);
            if (ids) piece = { movie: { ids } };
        } else {
            const ids = await resolveShowIds(target.showTitle, clientId, token.access);
            if (ids) piece = { show: { ids }, episode: { season: target.season, number: target.episode } };
        }
        if (!piece) return false;
        const clamped = Math.max(0, Math.min(100, Math.round(progress)));
        await traktPost(`/scrobble/${action}`, { ...piece, progress: clamped }, clientId, token.access);
        return true;
    } catch {
        return false;
    }
}

/** Username da conta conectada (GET /users/me) — '' se desconectado/erro. */
export async function fetchTraktProfile(): Promise<string> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId) return '';
    try {
        const data = await traktGet('/users/me', clientId, token.access) as { username?: string };
        return typeof data.username === 'string' ? data.username : '';
    } catch {
        return '';
    }
}

/** Só pra testes. */
export function resetTraktCache(): void {
    idsCache.clear();
}

/** ⭐ Watchlist do Trakt (títulos) — pro cruzamento com o catálogo por nome. */
export async function fetchTraktWatchlist(): Promise<{ kind: 'movie' | 'series'; title: string }[]> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId) return [];
    try {
        const [movies, shows] = await Promise.all([
            traktGet('/sync/watchlist/movies', clientId, token.access) as Promise<{ movie?: TraktHit }[]>,
            traktGet('/sync/watchlist/shows', clientId, token.access) as Promise<{ show?: TraktHit }[]>,
        ]);
        return [
            ...movies.flatMap(item => (item.movie?.title ? [{ kind: 'movie' as const, title: item.movie.title }] : [])),
            ...shows.flatMap(item => (item.show?.title ? [{ kind: 'series' as const, title: item.show.title }] : [])),
        ];
    } catch {
        return [];
    }
}

/** Adiciona/remove um título na watchlist do Trakt (resolve os ids pela busca). */
async function traktWatchlistChange(kind: 'movie' | 'series', title: string, remove: boolean): Promise<boolean> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId) return false;
    try {
        const ids = kind === 'movie'
            ? await resolveMovieIds(title, clientId, token.access)
            : await resolveShowIds(title, clientId, token.access);
        if (!ids) return false;
        const path = remove ? '/sync/watchlist/remove' : '/sync/watchlist';
        const body = kind === 'movie' ? { movies: [{ ids }] } : { shows: [{ ids }] };
        await traktPost(path, body, clientId, token.access);
        return true;
    } catch {
        return false;
    }
}

export async function traktWatchlistAdd(kind: 'movie' | 'series', title: string): Promise<boolean> {
    return traktWatchlistChange(kind, title, false);
}

export async function traktWatchlistRemove(kind: 'movie' | 'series', title: string): Promise<boolean> {
    return traktWatchlistChange(kind, title, true);
}

/** 🎬 Filmes marcados como vistos no Trakt (títulos) — pro "ocultar assistidos". */
export async function fetchTraktWatchedMovies(): Promise<string[]> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId) return [];
    try {
        const rows = await traktGet('/sync/watched/movies', clientId, token.access) as { movie?: TraktHit }[];
        return rows.flatMap(row => (row.movie?.title ? [row.movie.title] : []));
    } catch {
        return [];
    }
}

/** 🎬 Episódios vistos no Trakt, achatados por série — pro backfill/dedupe. */
export interface TraktWatchedEpisode { show: string; season: number; episode: number }
export async function fetchTraktWatchedShows(): Promise<TraktWatchedEpisode[]> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId) return [];
    try {
        const rows = await traktGet('/sync/watched/shows', clientId, token.access) as {
            show?: TraktHit;
            seasons?: { number: number; episodes?: { number: number }[] }[];
        }[];
        return rows.flatMap(row => {
            const title = row.show?.title;
            if (!title) return [];
            return (row.seasons ?? []).flatMap(season =>
                (season.episodes ?? []).map(ep => ({ show: title, season: season.number, episode: ep.number })));
        });
    } catch {
        return [];
    }
}

export interface TraktPlayback {
    kind: 'movie' | 'episode';
    /** Nos episódios é o nome da SÉRIE (season/episode dizem o capítulo). */
    title: string;
    /** 0–100 — o player converte pra segundos quando souber a duração. */
    progress: number;
    pausedAtMs: number;
    season?: number;
    episode?: number;
}

/** ▶️ Reproduções pausadas no Trakt (outros apps: Kodi, celular…). */
export async function fetchTraktPlayback(): Promise<TraktPlayback[]> {
    const token = getToken();
    const { clientId } = getTraktCreds();
    if (!token || !clientId) return [];
    try {
        const rows = await traktGet('/sync/playback', clientId, token.access) as {
            type?: string;
            progress?: number;
            paused_at?: string;
            movie?: TraktHit;
            show?: TraktHit;
            episode?: { season?: number; number?: number };
        }[];
        return rows.flatMap((row): TraktPlayback[] => {
            const progress = Number(row.progress);
            if (!Number.isFinite(progress) || progress <= 0 || progress >= 95) return [];
            const pausedAtMs = Date.parse(row.paused_at ?? '') || Date.now();
            if (row.type === 'movie' && row.movie?.title) {
                return [{ kind: 'movie', title: row.movie.title, progress, pausedAtMs }];
            }
            if (row.type === 'episode' && row.show?.title && row.episode) {
                const season = Number(row.episode.season);
                const episode = Number(row.episode.number);
                if (!Number.isFinite(season) || !Number.isFinite(episode)) return [];
                return [{ kind: 'episode', title: row.show.title, progress, pausedAtMs, season, episode }];
            }
            return [];
        });
    } catch {
        return [];
    }
}

// Playback do Trakt buscado uma vez por sessão — o player só consulta.
let playbackCache: TraktPlayback[] | null = null;

/** % de retomada do Trakt pra um FILME (null sem playback pausado lá). */
export async function getTraktResumePct(title: string): Promise<number | null> {
    if (playbackCache === null) {
        playbackCache = await fetchTraktPlayback().catch(() => []);
    }
    const { clean } = splitTitleYear(title);
    const wanted = clean.toLowerCase();
    const hit = playbackCache.find(p => p.kind === 'movie' && p.title.toLowerCase() === wanted);
    return hit ? hit.progress : null;
}
