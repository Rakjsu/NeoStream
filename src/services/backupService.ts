// Backup/restore of user data.
//
// v1 covered only localStorage user data. v2 adds:
//   - theme, scheduled recordings, program reminders, MPV track prefs
//   - saved playlists from the main-process store (passwords base64-encoded —
//     obfuscation for shoulder-surfing, NOT encryption; the UI warns that the
//     file contains provider access data)
// v3 adds the user's API keys, so a restore/new machine doesn't lose them:
//   - TMDB key (localStorage, rides the normal data map)
//   - OpenSubtitles credentials (live in the main-process store; the caller
//     fetches/applies them over IPC — this module stays IPC-free)
// v4 muda a POLITICA, nao o formato: a inclusao deixou de ser allowlist e
// passou a ser PREFIXO + DENYLIST. Entra tudo que comeca com `neostream_`,
// mais as chaves LEGADAS (anteriores ao prefixo), menos as listadas abaixo.
//
// Motivo: a allowlist exigia editar este arquivo a cada preferencia nova e, na
// pratica, ninguem editava. Regras de gravacao, alertas de EPG, marcadores,
// limites do Kids e o XMLTV do usuario nunca viajaram — nem no backup, nem no
// sync. E `neostream_profile_daily_limit_min_<id>` viajava por ACIDENTE, so
// porque casava com o prefixo `neostream_profile_`: o limite por perfil ia e o
// limite global do Kids ficava.
//
// Uma chave nova entra na DENYLIST quando ela:
//   (a) e estado desta maquina (ponteiro, timestamp, log, caminho de arquivo);
//   (b) e credencial ou segredo;
//   (c) dispara efeito destrutivo (apagar arquivo) ou de rede (baixar URL);
//   (d) descreve o APARELHO, nao o usuario (modo TV, protetor de tela).
//
// ATENCAO: `isBackupKey` tambem filtra o SYNC entre maquinas (syncMerge.ts).
// O que for arriscado APENAS no sync automatico vai em SYNC_LOCAL_ONLY.

export const BACKUP_VERSION = 3;
export const BACKUP_APP = 'neostream';

export interface BackupPlaylist {
    name: string;
    url: string;
    username: string;
    /** base64(password) — see header note. */
    passwordB64: string;
}

export interface BackupOpenSubtitles {
    apiKey: string;
    username: string;
    /** base64(password) — same obfuscation note as the playlists. */
    passwordB64: string;
}

/** Decoded form the callers hand to `opensubtitles:set-config`. */
export interface OpenSubtitlesCreds {
    apiKey: string;
    username: string;
    password: string;
}

export interface BackupPayload {
    version: number;
    exportedAt: string;
    app: typeof BACKUP_APP;
    data: Record<string, string>;
    /** v2+: saved Xtream playlists (absent on v1 files). */
    playlists?: BackupPlaylist[];
    /** v3+: the user's OpenSubtitles credentials (absent when not configured). */
    openSubtitles?: BackupOpenSubtitles;
}

export interface ApplyReport {
    applied: number;
    skipped: string[];
    /** Playlists accepted for import in the main process. */
    playlistsImported: number;
}

/** Prefixo dos dados do app: tudo que comeca com ele entra, salvo a denylist. */
const NEOSTREAM_PREFIX = 'neostream_';

// Chaves LEGADAS de dados do usuario — nasceram antes do prefixo. Lista
// FECHADA: chave nova nasce com `neostream_` e entra sozinha.
const LEGACY_EXACT_KEYS = [
    'parentalConfig',         // parental control config (PIN hash included)
    'playerVolume',           // last player volume
    'watchLater',             // legacy pre-profile watch-later list
    'recording_rules_v1',     // regras de gravacao automatica (recordingRuleService)
    'video_bookmarks_v1',     // marcadores de posicao em VOD/series (bookmarkService)
];

// Prefixos LEGADOS (sem `neostream_`). Lista FECHADA, mesmo motivo de cima.
const LEGACY_PREFIX_KEYS = [
    'playbackConfig',         // playbackConfig and playbackConfig_<profileId>
    'movie_watch_progress',   // movie resume positions, incl. per-(profile,playlist)
    'series_watch_progress',  // series progress, incl. per-(profile,playlist)
    'usage_stats',            // usage_stats_<profileId> / usage_stats_default
    'scheduled_recordings',   // per-profile scheduled DVR recordings (v2)
    'program_reminders',      // per-profile EPG program reminders (v2)
];

// DENYLIST: chaves `neostream_*` que NAO viajam. Cache TMDB, contentLastFetch,
// parentalUnlocked e afins ja ficam de fora por nao terem o prefixo nem estarem
// nas legadas — so precisa listar aqui o que TEM o prefixo.
const VOLATILE_KEYS = [
    // (a) estado DESTA maquina — restaurar noutra corrompe ou mente
    'neostream_active_playlist_id',   // e o `__pl_<id>` que escopa favoritos e progresso;
                                      // importar o de outra maquina aponta o escopo pra
                                      // uma playlist que nao existe aqui
    'neostream_tmdb_onboarding',      // flag transitoria de onboarding
    'neostream_tmdb_ignore_env',      // gancho de E2E
    'neostream_boot_profile_v1',      // marcas de tempo do boot desta maquina
    'neostream_error_log_v1',         // log de erros desta maquina
    'neostream_parental_log',         // auditoria de PIN: evento local, nao configuracao
    'neostream_dvr_protected',        // CAMINHOS de arquivo das gravacoes protegidas
    'neostream_catalog_last_refresh', // quando ATUALIZOU aqui (a config em horas viaja)
    // Ledgers de "ja avisei": ressincronizar reabre ou silencia avisos
    'neostream_epg_keyword_seen',     // (as PALAVRAS, neostream_epg_keywords, viajam)
    'neostream_expiry_snooze',
    'neostream_weekly_summary_week',
    'neostream_wrapped_notified_year',
    'neostream_trakt_backfill_done_v2',
    // (c) gatilho DESTRUTIVO: a faxina automatica apaga gravacao pela idade, e a
    // lista de protegidas (neostream_dvr_protected) e local. Deixar so o gatilho
    // viajar apagaria gravacao alheia.
    'neostream_dvr_max_age_days',
    'neostream_dvr_max_concurrent',   // capacidade desta maquina
    'neostream_dl_max_concurrent',
    'neostream_dl_smart',
    'neostream_dl_night_only',
    // (d) descreve o APARELHO, nao o usuario
    'neostream_tv_mode',              // UI de 3 metros, zoom 1.25x
    'neostream_screensaver_min',
    'neostream_diagnostics_enabled',
];

const VOLATILE_PREFIXES = [
    'neostream_play_queue',   // fila da sessao
    'neostream_zap_history_', // historico de zapping desta maquina
    'neostream_series_seen_', // ledger de "episodio novo ja mostrado"
];

/**
 * Entra no arquivo de backup, mas NAO no sync automatico.
 *
 * O sync le qualquer `neostream-sync-*.json` da pasta compartilhada sem checar
 * origem (electron/syncFolder.ts). A URL de XMLTV e baixada pelo app com
 * prioridade sobre o EPG do provedor (epgService.ts) — numa maquina que ainda
 * nao tem uma configurada, um arquivo naquela pasta a instalaria. No backup,
 * que o usuario exporta e importa conscientemente, ela e dado legitimo dele.
 */
const SYNC_LOCAL_ONLY = ['neostream_external_epg_url'];

/**
 * Dados da sessão de CONVIDADO nunca entram no backup/sync. O modo convidado é
 * efêmero por definição (o `purgeGuestData` limpa ao sair), mas só na máquina
 * local: se um ciclo de sync rodava durante a sessão, o perfil "Convidado" e o
 * histórico dele apareciam na outra máquina — e voltavam pra esta no ciclo
 * seguinte, virando perfil fantasma permanente.
 */
export function isGuestKey(key: string): boolean {
    return /_guest(__pl_|$)/.test(key);
}

/** Volateis, locais ou secretas: nunca entram, nem no backup nem no sync. */
export function isVolatileKey(key: string): boolean {
    return VOLATILE_KEYS.includes(key) || VOLATILE_PREFIXES.some(prefix => key.startsWith(prefix));
}

export function isBackupKey(key: string): boolean {
    if (isGuestKey(key)) return false;
    if (isVolatileKey(key)) return false;
    if (key.startsWith(NEOSTREAM_PREFIX)) return true;
    return LEGACY_EXACT_KEYS.includes(key) || LEGACY_PREFIX_KEYS.some(prefix => key.startsWith(prefix));
}

/** O que o sync automatico entre maquinas pode carregar. */
export function isSyncKey(key: string): boolean {
    return isBackupKey(key) && !SYNC_LOCAL_ONLY.includes(key);
}

export function encodePlaylistPassword(password: string): string {
    // btoa handles latin1 only; round-trip via encodeURIComponent for unicode.
    return btoa(unescape(encodeURIComponent(password)));
}

export function decodePlaylistPassword(passwordB64: string): string {
    return decodeURIComponent(escape(atob(passwordB64)));
}

/** Validates and normalizes the optional v2 playlists array from a parsed file. */
export function sanitizeBackupPlaylists(raw: unknown): BackupPlaylist[] {
    if (!Array.isArray(raw)) return [];
    const result: BackupPlaylist[] = [];
    for (const item of raw) {
        if (item === null || typeof item !== 'object') continue;
        const p = item as Record<string, unknown>;
        if (typeof p.url !== 'string' || typeof p.username !== 'string' || typeof p.passwordB64 !== 'string') continue;
        if (!p.url.trim() || !p.username.trim()) continue;
        try {
            decodePlaylistPassword(p.passwordB64);
        } catch {
            continue; // corrupted base64 — skip this entry
        }
        result.push({
            name: typeof p.name === 'string' ? p.name : '',
            url: p.url,
            username: p.username,
            passwordB64: p.passwordB64
        });
    }
    return result;
}

/** Validates the optional v3 OpenSubtitles block; null when absent/corrupted. */
export function sanitizeBackupOpenSubtitles(raw: unknown): OpenSubtitlesCreds | null {
    if (raw === null || typeof raw !== 'object') return null;
    const os = raw as Record<string, unknown>;
    if (typeof os.apiKey !== 'string' || !os.apiKey.trim()) return null;
    const username = typeof os.username === 'string' ? os.username : '';
    let password = '';
    if (typeof os.passwordB64 === 'string' && os.passwordB64) {
        try {
            password = decodePlaylistPassword(os.passwordB64);
        } catch {
            return null; // corrupted base64 — drop the whole block
        }
    }
    return { apiKey: os.apiKey.trim(), username, password };
}

/** Remove o perfil convidado do JSON do registro (o resto passa intacto). */
function stripGuestProfiles(raw: string): string {
    try {
        const parsed = JSON.parse(raw) as {
            profiles?: Array<{ id?: string; isGuest?: boolean }>;
            activeProfileId?: string;
        };
        if (!Array.isArray(parsed?.profiles)) return raw;
        const profiles = parsed.profiles.filter(p => !p?.isGuest && p?.id !== 'guest');
        // Se o snapshot foi tirado DURANTE uma sessão de convidado, o
        // activeProfileId apontaria pra um perfil que acabou de sair do payload
        // — no restore o app ficaria sem perfil selecionado.
        const activeProfileId = parsed.activeProfileId === 'guest' ? undefined : parsed.activeProfileId;
        if (profiles.length === parsed.profiles.length && activeProfileId === parsed.activeProfileId) return raw;
        return JSON.stringify({ ...parsed, profiles, activeProfileId });
    } catch {
        return raw;
    }
}

export function collectBackup(
    playlists: BackupPlaylist[] = [],
    openSubtitles?: OpenSubtitlesCreds,
): BackupPayload {
    const data: Record<string, string> = {};

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === null || !isBackupKey(key)) continue;

        const value = localStorage.getItem(key);
        if (value === null) continue;
        // O registro de perfis vai sem o convidado (as chaves _guest já ficaram
        // de fora acima, mas o perfil em si mora dentro deste JSON).
        data[key] = key === 'neostream_profiles' ? stripGuestProfiles(value) : value;
    }

    return {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        app: BACKUP_APP,
        data,
        playlists,
        // Only worth carrying when actually configured.
        ...(openSubtitles?.apiKey ? {
            openSubtitles: {
                apiKey: openSubtitles.apiKey,
                username: openSubtitles.username,
                passwordB64: encodePlaylistPassword(openSubtitles.password),
            },
        } : {}),
    };
}

/**
 * Validates the parsed payload and applies the localStorage portion.
 * Returns the sanitized playlists (v2) for the caller to hand to the main
 * process — this module stays free of IPC so it remains unit-testable.
 */
export function applyBackup(parsed: unknown): ApplyReport & { playlists: BackupPlaylist[]; openSubtitles: OpenSubtitlesCreds | null } {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid backup: payload is not an object');
    }

    const payload = parsed as Partial<BackupPayload>;

    if (payload.app !== BACKUP_APP) {
        throw new Error(`Invalid backup: not a ${BACKUP_APP} backup file`);
    }
    if (typeof payload.version !== 'number' || payload.version < 1 || payload.version > BACKUP_VERSION) {
        throw new Error(`Invalid backup: unsupported version "${String(payload.version)}" (expected 1..${BACKUP_VERSION})`);
    }
    if (payload.data === null || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
        throw new Error('Invalid backup: missing data object');
    }

    let applied = 0;
    const skipped: string[] = [];

    for (const [key, value] of Object.entries(payload.data)) {
        if (typeof value !== 'string' || !isBackupKey(key)) {
            skipped.push(key);
            continue;
        }
        localStorage.setItem(key, value);
        applied++;
    }

    const playlists = payload.version >= 2 ? sanitizeBackupPlaylists(payload.playlists) : [];
    const openSubtitles = payload.version >= 3 ? sanitizeBackupOpenSubtitles(payload.openSubtitles) : null;

    return { applied, skipped, playlistsImported: 0, playlists, openSubtitles };
}

// ----------------- backup com senha (AES-GCM + PBKDF2, Web Crypto) -----------------
// Opcional: com senha o arquivo sai criptografado inteiro, com o prefixo
// abaixo marcando o formato (salt 16 + iv 12 + cifra, tudo em base64).

export const ENCRYPTED_PREFIX = 'NEOENC2:';

export function isEncryptedBackup(text: string): boolean {
    return text.startsWith(ENCRYPTED_PREFIX);
}

function bytesToB64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function deriveBackupKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptBackup(json: string, password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(password, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(json)));
    const packed = new Uint8Array(salt.length + iv.length + cipher.length);
    packed.set(salt, 0);
    packed.set(iv, salt.length);
    packed.set(cipher, salt.length + iv.length);
    return ENCRYPTED_PREFIX + bytesToB64(packed);
}

/** null = senha errada ou arquivo corrompido (o GCM autentica a cifra). */
export async function decryptBackup(text: string, password: string): Promise<string | null> {
    if (!isEncryptedBackup(text)) return text;
    try {
        const packed = b64ToBytes(text.slice(ENCRYPTED_PREFIX.length).trim());
        const salt = packed.subarray(0, 16);
        const iv = packed.subarray(16, 28);
        const cipher = packed.subarray(28);
        const key = await deriveBackupKey(password, salt);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource);
        return new TextDecoder().decode(plain);
    } catch {
        return null;
    }
}
