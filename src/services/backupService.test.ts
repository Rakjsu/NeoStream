import { describe, it, expect, beforeEach } from 'vitest';
import {
    collectBackup, applyBackup, BACKUP_VERSION, BACKUP_APP,
    encodePlaylistPassword, decodePlaylistPassword, sanitizeBackupPlaylists,
    isBackupKey, isSyncKey
} from './backupService';

describe('backupService', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('collectBackup', () => {
        it('collects user-data keys (exact and prefixed)', () => {
            localStorage.setItem('neostream_profiles', '{"profiles":[]}');
            localStorage.setItem('neostream_profile_abc123', '{"favorites":[]}');
            localStorage.setItem('playbackConfig', '{"bufferSize":10}');
            localStorage.setItem('playbackConfig_abc123', '{"bufferSize":20}');
            localStorage.setItem('parentalConfig', '{"enabled":false}');
            localStorage.setItem('series_watch_progress_abc123', '{}');
            localStorage.setItem('movie_watch_progress', '{}');
            localStorage.setItem('usage_stats_abc123', '{}');
            localStorage.setItem('neostream_language', 'pt');
            localStorage.setItem('playerVolume', '0.8');
            localStorage.setItem('neostream_theme', '{"bg":"amoled"}');
            localStorage.setItem('neostream_mpv_tracks_abc123', '{}');
            localStorage.setItem('scheduled_recordings_abc123', '[]');
            localStorage.setItem('program_reminders_abc123', '[]');

            const backup = collectBackup();

            expect(backup.version).toBe(BACKUP_VERSION);
            expect(backup.app).toBe(BACKUP_APP);
            expect(typeof backup.exportedAt).toBe('string');
            expect(Object.keys(backup.data).sort()).toEqual([
                'movie_watch_progress',
                'neostream_language',
                'neostream_theme',
                'neostream_mpv_tracks_abc123',
                'neostream_profile_abc123',
                'neostream_profiles',
                'parentalConfig',
                'playbackConfig',
                'playbackConfig_abc123',
                'playerVolume',
                'program_reminders_abc123',
                'scheduled_recordings_abc123',
                'series_watch_progress_abc123',
                'usage_stats_abc123',
            ].sort());
        });

        it('excludes cache and transient keys', () => {
            localStorage.setItem('tmdb_cache_movies', '{}');
            localStorage.setItem('tmdb_movie_details', '{}');
            localStorage.setItem('epg_test_results', '{}');
            localStorage.setItem('contentLastFetch', '12345');
            localStorage.setItem('shouldAutoPlayNextEpisode', 'true');
            localStorage.setItem('parentalUnlocked', 'true');
            localStorage.setItem('neostream_profiles', '{"profiles":[]}');

            const backup = collectBackup();

            expect(Object.keys(backup.data)).toEqual(['neostream_profiles']);
        });
    });

    describe('round trip', () => {
        it('collect -> clear -> apply restores all values', () => {
            localStorage.setItem('neostream_profiles', '{"profiles":[{"id":"p1"}],"activeProfileId":"p1"}');
            localStorage.setItem('neostream_profile_p1', '{"favorites":[{"id":"42"}]}');
            localStorage.setItem('series_watch_progress_p1', '{"99":{"1":{"2":300}}}');
            localStorage.setItem('neostream_language', 'es');

            const backup = collectBackup();
            localStorage.clear();
            expect(localStorage.getItem('neostream_profiles')).toBeNull();

            // Simulate file round trip through JSON
            const report = applyBackup(JSON.parse(JSON.stringify(backup)));

            expect(report.applied).toBe(4);
            expect(report.skipped).toEqual([]);
            expect(localStorage.getItem('neostream_profiles')).toBe('{"profiles":[{"id":"p1"}],"activeProfileId":"p1"}');
            expect(localStorage.getItem('neostream_profile_p1')).toBe('{"favorites":[{"id":"42"}]}');
            expect(localStorage.getItem('series_watch_progress_p1')).toBe('{"99":{"1":{"2":300}}}');
            expect(localStorage.getItem('neostream_language')).toBe('es');
        });
    });

    describe('playlists (v2)', () => {
        it('faz round-trip da senha em base64 (incluindo unicode)', () => {
            for (const pw of ['abc123', 'çãé!@#', 'p@ss wörd senha']) {
                expect(decodePlaylistPassword(encodePlaylistPassword(pw))).toBe(pw);
            }
        });

        it('exporta playlists no payload e devolve sanitizadas no apply', () => {
            const playlists = [{ name: 'Casa', url: 'http://x.tv', username: 'u', passwordB64: encodePlaylistPassword('s3nh4') }];
            const backup = collectBackup(playlists);
            expect(backup.playlists).toEqual(playlists);

            const report = applyBackup(JSON.parse(JSON.stringify(backup)));
            expect(report.playlists).toEqual(playlists);
        });

        it('ignora playlists em backups v1 e entradas malformadas', () => {
            const v1 = { version: 1, exportedAt: 'x', app: BACKUP_APP, data: {}, playlists: [{ url: 'http://x', username: 'u', passwordB64: 'YQ==' }] };
            expect(applyBackup(v1).playlists).toEqual([]);

            expect(sanitizeBackupPlaylists([
                null,
                'x',
                { url: '', username: 'u', passwordB64: 'YQ==' },
                { url: 'http://ok', username: 'u' },
                { url: 'http://ok', username: 'u', passwordB64: '%%%invalid%%%' },
                { url: 'http://ok', username: 'u', passwordB64: 'YQ==' }
            ])).toEqual([{ name: '', url: 'http://ok', username: 'u', passwordB64: 'YQ==' }]);
        });
    });

    describe('chaves de API (v3)', () => {
        it('inclui a chave TMDB no data map e a restaura no apply', () => {
            localStorage.setItem('neostream_tmdb_api_key', 'minha-chave-tmdb');
            const backup = collectBackup();
            expect(backup.data['neostream_tmdb_api_key']).toBe('minha-chave-tmdb');

            localStorage.clear();
            applyBackup(JSON.parse(JSON.stringify(backup)));
            expect(localStorage.getItem('neostream_tmdb_api_key')).toBe('minha-chave-tmdb');
        });

        it('exporta as credenciais OpenSubtitles (senha em base64) e devolve decodificadas no apply', () => {
            const backup = collectBackup([], { apiKey: 'os-key', username: 'user', password: 'sênha!' });
            expect(backup.openSubtitles).toEqual({
                apiKey: 'os-key', username: 'user', passwordB64: encodePlaylistPassword('sênha!'),
            });

            const report = applyBackup(JSON.parse(JSON.stringify(backup)));
            expect(report.openSubtitles).toEqual({ apiKey: 'os-key', username: 'user', password: 'sênha!' });
        });

        it('omite o bloco sem apiKey e ignora blocos malformados/legados', () => {
            expect(collectBackup([], { apiKey: '', username: 'u', password: 'p' }).openSubtitles).toBeUndefined();
            expect(collectBackup().openSubtitles).toBeUndefined();

            // v2 (sem o campo) e blocos corrompidos viram null no apply.
            const v2 = { version: 2, exportedAt: 'x', app: BACKUP_APP, data: {}, openSubtitles: { apiKey: 'k', passwordB64: 'YQ==' } };
            expect(applyBackup(v2).openSubtitles).toBeNull();
            const corrupted = { version: 3, exportedAt: 'x', app: BACKUP_APP, data: {}, openSubtitles: { apiKey: 'k', passwordB64: '%%%' } };
            expect(applyBackup(corrupted).openSubtitles).toBeNull();
        });
    });

    describe('applyBackup validation', () => {
        const validPayload = () => ({
            version: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            app: BACKUP_APP,
            data: { neostream_language: 'pt' }
        });

        it('rejects unsupported versions but accepts v1..v3', () => {
            expect(() => applyBackup({ ...validPayload(), version: BACKUP_VERSION + 1 })).toThrow(/version/);
            expect(() => applyBackup({ ...validPayload(), version: 0 })).toThrow(/version/);
            expect(() => applyBackup({ ...validPayload(), version: undefined })).toThrow(/version/);
            expect(applyBackup({ ...validPayload(), version: 1 }).applied).toBe(1);
            expect(applyBackup({ ...validPayload(), version: 2 }).applied).toBe(1);
            expect(applyBackup(validPayload()).applied).toBe(1);
        });

        it('rejects payloads from other apps', () => {
            expect(() => applyBackup({ ...validPayload(), app: 'other' })).toThrow(/neostream/);
        });

        it('rejects garbage payloads', () => {
            expect(() => applyBackup(null)).toThrow();
            expect(() => applyBackup('garbage')).toThrow();
            expect(() => applyBackup(42)).toThrow();
            expect(() => applyBackup([])).toThrow();
            expect(() => applyBackup({})).toThrow();
            expect(() => applyBackup({ ...validPayload(), data: 'not-an-object' })).toThrow(/data/);
            expect(() => applyBackup({ ...validPayload(), data: ['x'] })).toThrow(/data/);
        });

        it('skips unknown keys and non-string values, applies the rest', () => {
            const report = applyBackup({
                ...validPayload(),
                data: {
                    neostream_language: 'en',
                    tmdb_cache_movies: '{}',           // cache key — not restorable
                    evil_key: 'value',                  // unknown key
                    playerVolume: 0.5                   // non-string value
                }
            });

            expect(report.applied).toBe(1);
            expect(report.skipped.sort()).toEqual(['evil_key', 'playerVolume', 'tmdb_cache_movies'].sort());
            expect(localStorage.getItem('neostream_language')).toBe('en');
            expect(localStorage.getItem('tmdb_cache_movies')).toBeNull();
            expect(localStorage.getItem('evil_key')).toBeNull();
        });
    });
});

describe('backup com senha (AES-GCM)', () => {
    it('roundtrip com a senha certa; senha errada dá null', async () => {
        const { encryptBackup, decryptBackup, isEncryptedBackup } = await import('./backupService');
        const json = JSON.stringify({ app: 'neostream', dados: 'çãé 🎬' });
        const packed = await encryptBackup(json, 'segredo123');
        expect(isEncryptedBackup(packed)).toBe(true);
        expect(packed).not.toContain('neostream');
        expect(await decryptBackup(packed, 'segredo123')).toBe(json);
        expect(await decryptBackup(packed, 'errada')).toBeNull();
    });

    it('texto sem prefixo passa direto (backup antigo sem senha)', async () => {
        const { decryptBackup } = await import('./backupService');
        expect(await decryptBackup('{"a":1}', 'qualquer')).toBe('{"a":1}');
    });
});

/**
 * Política de chaves v4: prefixo + denylist, no lugar da allowlist.
 *
 * A allowlist exigia editar o backupService a cada preferência nova e ninguém
 * editava — regras de gravação, alertas de EPG, marcadores e limites do Kids
 * nunca viajaram. O default agora é o contrário: chave `neostream_*` entra
 * sozinha, e o que NÃO pode viajar precisa estar escrito na denylist.
 *
 * Estes testes protegem o novo default. Sem eles, a próxima chave volátil
 * criada com o prefixo vaza para o arquivo de backup sem ninguém notar.
 */
describe('política de chaves do backup (v4)', () => {
    beforeEach(() => localStorage.clear());

    it('as chaves que nunca viajaram agora viajam', () => {
        const antes = [
            'recording_rules_v1',            // regras de gravação automática
            'neostream_epg_keywords',        // alertas de EPG por palavra
            'video_bookmarks_v1',            // marcadores de posição
            'neostream_personal_marks',      // nota e tags do usuário
            'neostream_kids_daily_limit_min',
            'neostream_kids_allowed_hours',
            'neostream_external_epg_url',    // XMLTV do próprio usuário
        ];
        antes.forEach(chave => expect(isBackupKey(chave)).toBe(true));
    });

    // (c) da regra: gatilho destrutivo. A faxina apaga gravação pela idade, e a
    // lista de protegidas é LOCAL — deixar só o gatilho viajar apagaria
    // gravação alheia na outra máquina.
    it('o gatilho da faxina do DVR não viaja', () => {
        expect(isBackupKey('neostream_dvr_max_age_days')).toBe(false);
        expect(isBackupKey('neostream_dvr_protected')).toBe(false);
    });

    // (d) da regra: descreve o aparelho, não o usuário.
    it('configuração de aparelho não viaja', () => {
        expect(isBackupKey('neostream_tv_mode')).toBe(false);
        expect(isBackupKey('neostream_screensaver_min')).toBe(false);
        expect(isBackupKey('neostream_dl_max_concurrent')).toBe(false);
    });

    // (a) da regra: o ponteiro da playlist ativa é o que escopa favoritos e
    // progresso (`__pl_<id>`). Importado de outra máquina, aponta para uma
    // playlist que não existe aqui.
    it('estado local desta máquina não viaja', () => {
        expect(isBackupKey('neostream_active_playlist_id')).toBe(false);
        expect(isBackupKey('neostream_error_log_v1')).toBe(false);
        expect(isBackupKey('neostream_parental_log')).toBe(false);
        expect(isBackupKey('neostream_catalog_last_refresh')).toBe(false);
    });

    it('ledger de "já avisei" não viaja, mas a configuração do aviso sim', () => {
        expect(isBackupKey('neostream_epg_keyword_seen')).toBe(false);
        expect(isBackupKey('neostream_epg_keywords')).toBe(true);
    });

    it('a denylist vence o prefixo largo, e o convidado vence os dois', () => {
        expect(isBackupKey('neostream_zap_history_p1__pl_x')).toBe(false);
        expect(isBackupKey('neostream_play_queue_p1__pl_x')).toBe(false);
        expect(isBackupKey('neostream_profiles_guest')).toBe(false);
        expect(isBackupKey('neostream_zap_history_guest__pl_x')).toBe(false);
    });

    it('cache e flag transitória continuam de fora (não têm o prefixo)', () => {
        ['tmdb_cache_movies', 'contentLastFetch', 'parentalUnlocked', 'epg_test_results']
            .forEach(chave => expect(isBackupKey(chave)).toBe(false));
    });

    // O sync lê qualquer arquivo da pasta compartilhada sem checar origem, e o
    // app BAIXA a URL de XMLTV com prioridade sobre o EPG do provedor. No
    // arquivo de backup, que o usuário importa conscientemente, ela é dado dele.
    it('a URL de XMLTV entra no backup mas fica fora do sync automático', () => {
        expect(isBackupKey('neostream_external_epg_url')).toBe(true);
        expect(isSyncKey('neostream_external_epg_url')).toBe(false);
        // O resto do que faz backup também sincroniza.
        expect(isSyncKey('neostream_profiles')).toBe(true);
        expect(isSyncKey('neostream_dvr_max_age_days')).toBe(false);
    });

    it('collectBackup leva o que a política deixa passar e para o resto', () => {
        localStorage.setItem('neostream_epg_keywords', '["copa"]');
        localStorage.setItem('recording_rules_v1', '[]');
        localStorage.setItem('neostream_dvr_max_age_days', '7');
        localStorage.setItem('neostream_tv_mode', '1');
        localStorage.setItem('tmdb_cache_movies', '{}');

        const chaves = Object.keys(collectBackup().data);
        expect(chaves).toContain('neostream_epg_keywords');
        expect(chaves).toContain('recording_rules_v1');
        expect(chaves).not.toContain('neostream_dvr_max_age_days');
        expect(chaves).not.toContain('neostream_tv_mode');
        expect(chaves).not.toContain('tmdb_cache_movies');
    });
});
