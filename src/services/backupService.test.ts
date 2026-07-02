import { describe, it, expect, beforeEach } from 'vitest';
import {
    collectBackup, applyBackup, BACKUP_VERSION, BACKUP_APP,
    encodePlaylistPassword, decodePlaylistPassword, sanitizeBackupPlaylists
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

    describe('applyBackup validation', () => {
        const validPayload = () => ({
            version: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            app: BACKUP_APP,
            data: { neostream_language: 'pt' }
        });

        it('rejects unsupported versions but accepts v1', () => {
            expect(() => applyBackup({ ...validPayload(), version: 3 })).toThrow(/version/);
            expect(() => applyBackup({ ...validPayload(), version: undefined })).toThrow(/version/);
            expect(applyBackup({ ...validPayload(), version: 1 }).applied).toBe(1);
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
