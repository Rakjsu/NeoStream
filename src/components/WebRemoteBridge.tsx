import { useEffect, useRef } from 'react';
import type { CastQueueItem } from '../services/castQueue';
import { watchProgressService } from '../services/watchProgressService';
import { getProtectedRecordings, toggleProtectedRecording } from '../services/dvrSweep';
import { scheduledRecordingService } from '../services/scheduledRecordingService';
import { movieProgressService } from '../services/movieProgressService';
import { usageStatsService } from '../services/usageStatsService';
import { reminderService } from '../services/reminderService';
import { favoritesService } from '../services/favoritesService';
import { getHomeRecommendations, type RecMovie, type RecSeries } from '../services/recommendationService';
import { queueService } from '../services/queueService';
import { downloadService } from '../services/downloadService';

/**
 * Always-mounted bridge for the phone web remote's catalog second-screen.
 * The web-remote server forwards commands over media:control:
 *   - `requestCatalog`/`requestSeries`/`requestSeriesInfo` → push lists back;
 *   - `requestDevices` → discover cast targets (Chromecast + DLNA + AirPlay);
 *   - `castMovie`/`castMovieQueue`/`castEpisode` → resolve URLs and cast to the
 *     chosen device (or the first Chromecast when the phone sent no target).
 * Every cast reports back over `web-remote:cast-result` so the phone can toast.
 * Lives at the app root (like ProgramReminderBridge) so it works from any page.
 */

interface VodMovie {
    stream_id: number | string;
    name: string;
    stream_icon?: string;
    container_extension?: string;
}

interface SeriesItem { series_id: number | string; name: string; cover?: string }
interface Episode { id: number | string; episode_num: number | string; title?: string; container_extension?: string }

type CastTargetType = 'chromecast' | 'dlna' | 'airplay';
interface CastTarget { deviceId: string; deviceType: CastTargetType }
interface DiscoverResult { success: boolean; devices?: { id: string | number; name: string }[] }

export function WebRemoteBridge() {
    // Last fetched movie list, so castMovie can look up the container.
    const moviesRef = useRef<Map<string, VodMovie>>(new Map());
    // Last fetched episodes (across a series' seasons), for castEpisode. Carries
    // the series/season/episode so a cast started here can write watch progress.
    const episodesRef = useRef<Map<string, { id: number | string; container: string; name: string; seriesId?: string; season?: number; episode?: number }>>(new Map());
    // What the phone is currently casting, so a poll can write "continue watching"
    // progress back to the local history (the loop the app records when it plays).
    const castingRef = useRef<
        | { kind: 'movie'; id: string; name: string }
        | { kind: 'episode'; seriesId: string; season: number; episode: number }
        | null
    >(null);
    // Last discovered cast targets, so a target id from the phone resolves a name.
    const devicesRef = useRef<Map<string, { name: string; type: CastTargetType }>>(new Map());
    // Resume positions (seconds) for "continue watching" items, keyed by
    // "movie:<id>" / "ep:<episodeId>", so a cast started from that tab resumes.
    const resumeRef = useRef<Map<string, number>>(new Map());

    // 📥 Item 12: um download enviado pelo celular chegou pelo /transfer —
    // registra como concluído pra aparecer na página de Downloads.
    useEffect(() => {
        const onReceived = (_event: unknown, payload: { title?: string; kind?: string; filePath?: string; size?: number }) => {
            if (!payload?.filePath || !payload.title) return;
            const kind = payload.kind === 'episode' ? 'episode' as const : 'movie' as const;
            void downloadService.registerReceived({
                title: payload.title,
                kind,
                filePath: payload.filePath,
                size: payload.size ?? 0,
            });
        };
        window.ipcRenderer.on('transfer:received', onReceived);
        return () => { window.ipcRenderer.off('transfer:received', onReceived); };
    }, []);

    useEffect(() => {
        const sendCastResult = (status: 'ok' | 'no-device' | 'error', deviceName = '') =>
            window.ipcRenderer.send('web-remote:cast-result', { status, deviceName });

        // Push the movie list; with a query, filter the WHOLE catalog server-side
        // (not just the first 400 the phone happened to load) — streams:get-vod is
        // main-cached (SWR), so filtering on each keystroke stays cheap.
        const pushCatalog = async (query = '') => {
            const result = await window.ipcRenderer.invoke('streams:get-vod').catch(() => null) as
                { success: boolean; data?: VodMovie[] } | null;
            const movies = result?.success ? (result.data ?? []) : [];
            const map = new Map<string, VodMovie>();
            for (const m of movies) map.set(String(m.stream_id), m);
            moviesRef.current = map;
            const q = query.trim().toLowerCase();
            const matches = q ? movies.filter(m => (m.name || '').toLowerCase().includes(q)) : movies;
            window.ipcRenderer.send('web-remote:catalog', {
                query,
                items: matches.slice(0, 400).map(m => ({
                    id: String(m.stream_id),
                    name: m.name,
                    cover: m.stream_icon || '',
                })),
            });
        };

        // Live channels matching the phone's global search — straight from the
        // main-cached list, so it works even with the LiveTV page closed.
        const pushLiveSearch = async (query = '') => {
            const res = await window.ipcRenderer.invoke('streams:get-live').catch(() => null) as
                { success: boolean; data?: { stream_id: number | string; name: string; stream_icon?: string }[] } | null;
            const q = query.trim().toLowerCase();
            const matches = q
                ? (res?.data ?? []).filter(c => (c.name || '').toLowerCase().includes(q))
                : [];
            window.ipcRenderer.send('web-remote:live-results', {
                items: matches.slice(0, 100).map(c => ({
                    id: String(c.stream_id), name: c.name, logo: c.stream_icon || '',
                })),
            });
        };

        // Discover every cast technology and push a flat, typed list to the phone.
        const pushDevices = async () => {
            const [cc, dl, ap] = await Promise.all([
                window.ipcRenderer.invoke('cast:discover').catch(() => null) as Promise<DiscoverResult | null>,
                window.ipcRenderer.invoke('dlna:discover').catch(() => null) as Promise<DiscoverResult | null>,
                window.ipcRenderer.invoke('airplay:discover').catch(() => null) as Promise<DiscoverResult | null>,
            ]);
            const map = new Map<string, { name: string; type: CastTargetType }>();
            const items: { id: string; name: string; type: CastTargetType }[] = [];
            const add = (list: DiscoverResult | null, type: CastTargetType) => {
                for (const d of list?.devices ?? []) {
                    const id = String(d.id);
                    if (!id || !d.name) continue;
                    map.set(id, { name: d.name, type });
                    items.push({ id, name: d.name, type });
                }
            };
            add(cc, 'chromecast');
            add(dl, 'dlna');
            add(ap, 'airplay');
            devicesRef.current = map;
            window.ipcRenderer.send('web-remote:devices', { items });
        };

        // Resume a Chromecast to a saved position: the castv2 LOAD has no
        // currentTime field, so we SEEK once the media session is up.
        const resumeChromecast = (seconds: number) => {
            if (seconds <= 5) return; // not worth resuming a few seconds in
            setTimeout(() => { void window.ipcRenderer.invoke('cast:seek', { seconds }).catch(() => undefined); }, 1500);
        };

        // Cast a resolved playlist to a chosen device (or the first Chromecast when
        // the phone sent no target). Chromecast honours the whole queue; DLNA and
        // AirPlay have no queue protocol, so they start the first item. `resumeAt`
        // (seconds) resumes a Chromecast from where it was left off.
        const startCast = async (items: CastQueueItem[], target?: CastTarget, resumeAt = 0): Promise<boolean> => {
            const queue = items.filter(i => i.url);
            if (queue.length === 0) { sendCastResult('error'); return false; }
            const first = queue[0];

            if (target) {
                const name = devicesRef.current.get(target.deviceId)?.name ?? '';
                let ok: boolean;
                if (target.deviceType === 'chromecast') {
                    if (queue.length > 1) {
                        const r = await window.ipcRenderer.invoke('cast:play-queue', { deviceId: target.deviceId, items: queue })
                            .catch(() => null) as { success: boolean } | null;
                        ok = !!r?.success;
                    } else {
                        const r = await window.ipcRenderer.invoke('cast:play', {
                            deviceId: target.deviceId, url: first.url, title: first.title, live: false,
                        }).catch(() => null) as { success: boolean } | null;
                        ok = !!r?.success;
                    }
                } else if (target.deviceType === 'dlna') {
                    const r = await window.ipcRenderer.invoke('dlna:cast', {
                        deviceId: target.deviceId, url: first.url, title: first.title,
                    }).catch(() => null) as { success: boolean } | null;
                    ok = !!r?.success;
                } else {
                    const r = await window.ipcRenderer.invoke('airplay:cast', {
                        deviceId: target.deviceId, url: first.url, title: first.title,
                    }).catch(() => null) as { success: boolean } | null;
                    ok = !!r?.success;
                }
                if (ok && resumeAt > 0 && target.deviceType === 'chromecast') resumeChromecast(resumeAt);
                sendCastResult(ok ? 'ok' : 'error', name);
                // Only a Chromecast reports position back for the history poll.
                return ok && target.deviceType === 'chromecast';
            }

            // No explicit target: legacy behaviour — first Chromecast on the LAN.
            const discover = await window.ipcRenderer.invoke('cast:discover').catch(() => null) as DiscoverResult | null;
            const device = discover?.devices?.[0];
            if (!device) { sendCastResult('no-device'); return false; }
            const deviceId = String(device.id);
            let ok: boolean;
            if (queue.length > 1) {
                const r = await window.ipcRenderer.invoke('cast:play-queue', { deviceId, items: queue })
                    .catch(() => null) as { success: boolean } | null;
                ok = !!r?.success;
            } else {
                const r = await window.ipcRenderer.invoke('cast:play', {
                    deviceId, url: first.url, title: first.title, live: false,
                }).catch(() => null) as { success: boolean } | null;
                ok = !!r?.success;
            }
            if (ok && resumeAt > 0) resumeChromecast(resumeAt); // default target is a Chromecast
            sendCastResult(ok ? 'ok' : 'error', device.name);
            return ok; // default target is a Chromecast → position is pollable
        };

        const castMovie = async (movieId: string, target?: CastTarget) => {
            const movie = moviesRef.current.get(movieId);
            if (!movie) { sendCastResult('error'); return; }
            const urlRes = await window.ipcRenderer.invoke('streams:get-vod-url', {
                streamId: movie.stream_id,
                container: movie.container_extension || 'mp4',
            }).catch(() => null) as { success: boolean; url?: string } | null;
            const pollable = await startCast([{ url: urlRes?.url ?? '', title: movie.name }], target, resumeRef.current.get('movie:' + movieId) ?? 0);
            castingRef.current = pollable ? { kind: 'movie', id: movieId, name: movie.name } : null;
        };

        const castMovieQueue = async (movieIds: string[], target?: CastTarget) => {
            const queue: CastQueueItem[] = [];
            for (const id of movieIds) {
                const movie = moviesRef.current.get(id);
                if (!movie) continue;
                const urlRes = await window.ipcRenderer.invoke('streams:get-vod-url', {
                    streamId: movie.stream_id,
                    container: movie.container_extension || 'mp4',
                }).catch(() => null) as { success: boolean; url?: string } | null;
                if (urlRes?.success && urlRes.url) queue.push({ url: urlRes.url, title: movie.name });
            }
            await startCast(queue, target);
            castingRef.current = null; // queues aren't single-item progress-tracked
        };

        const pushSeries = async (query = '') => {
            const result = await window.ipcRenderer.invoke('streams:get-series').catch(() => null) as
                { success: boolean; data?: SeriesItem[] } | null;
            const series = result?.success ? (result.data ?? []) : [];
            const q = query.trim().toLowerCase();
            const matches = q ? series.filter(s => (s.name || '').toLowerCase().includes(q)) : series;
            window.ipcRenderer.send('web-remote:series', {
                query,
                items: matches.slice(0, 400).map(s => ({
                    id: String(s.series_id), name: s.name, cover: s.cover || '',
                })),
            });
        };

        const pushSeriesInfo = async (seriesId: string) => {
            const result = await window.ipcRenderer.invoke('series:get-info', { seriesId }).catch(() => null) as
                { success: boolean; info?: { episodes?: Record<string, Episode[]> } } | null;
            const seasons = result?.success ? (result.info?.episodes ?? {}) : {};
            const episodes: { id: string; label: string }[] = [];
            const map = new Map<string, { id: number | string; container: string; name: string; seriesId?: string; season?: number; episode?: number }>();
            for (const seasonNum of Object.keys(seasons).sort((a, b) => Number(a) - Number(b))) {
                for (const ep of seasons[seasonNum] ?? []) {
                    const id = String(ep.id);
                    const tag = `T${seasonNum}E${ep.episode_num}`;
                    const label = ep.title ? `${tag} · ${ep.title}` : tag;
                    episodes.push({ id, label });
                    map.set(id, {
                        id: ep.id, container: ep.container_extension || 'mp4', name: label,
                        seriesId, season: Number(seasonNum), episode: Number(ep.episode_num),
                    });
                }
            }
            // Merge (don't wipe) so episodes resolved for "continue watching"
            // survive a drill-down into another series and vice-versa.
            for (const [k, v] of map) episodesRef.current.set(k, v);
            window.ipcRenderer.send('web-remote:series-info', { seriesId, episodes });
        };

        // Build the "continue watching" list (movies + the resume episode of each
        // in-progress series), resolving the episode stream ids so a tap can cast
        // straight to them, and record resume positions for a seek-after-load.
        const pushContinue = async () => {
            const vodRes = await window.ipcRenderer.invoke('streams:get-vod').catch(() => null) as
                { success: boolean; data?: VodMovie[] } | null;
            const vod = vodRes?.success ? (vodRes.data ?? []) : [];
            const vodById = new Map<string, VodMovie>();
            for (const m of vod) { vodById.set(String(m.stream_id), m); moviesRef.current.set(String(m.stream_id), m); }

            const seriesRes = await window.ipcRenderer.invoke('streams:get-series').catch(() => null) as
                { success: boolean; data?: SeriesItem[] } | null;
            const coverBySeries = new Map<string, string>();
            for (const s of seriesRes?.success ? (seriesRes.data ?? []) : []) coverBySeries.set(String(s.series_id), s.cover || '');

            const items: { kind: 'movie' | 'series'; castId: string; name: string; cover: string; pct: number; at: number }[] = [];

            for (const id of movieProgressService.getMoviesInProgress()) {
                const p = movieProgressService.getMoviePositionById(id);
                if (!p || p.completed) continue;
                const movie = vodById.get(String(id));
                resumeRef.current.set('movie:' + id, p.currentTime || 0);
                items.push({
                    kind: 'movie', castId: String(id), name: p.movieName || movie?.name || 'Filme',
                    cover: movie?.stream_icon || '', pct: Math.round(p.progress || 0), at: p.watchedAt || 0,
                });
            }

            for (const [seriesId, sp] of watchProgressService.getContinueWatching()) {
                const info = await window.ipcRenderer.invoke('series:get-info', { seriesId }).catch(() => null) as
                    { success: boolean; info?: { episodes?: Record<string, Episode[]> } } | null;
                const seasonEps = info?.success ? (info.info?.episodes?.[String(sp.lastWatchedSeason)] ?? []) : [];
                const ep = seasonEps.find(e => Number(e.episode_num) === sp.lastWatchedEpisode);
                if (!ep) continue;
                const episodeId = String(ep.id);
                const tag = `T${sp.lastWatchedSeason}E${sp.lastWatchedEpisode}`;
                episodesRef.current.set(episodeId, {
                    id: ep.id, container: ep.container_extension || 'mp4', name: `${sp.seriesName} · ${tag}`,
                    seriesId, season: sp.lastWatchedSeason, episode: sp.lastWatchedEpisode,
                });
                const prog = watchProgressService.getEpisodeProgress(seriesId, sp.lastWatchedSeason, sp.lastWatchedEpisode);
                const cur = prog?.currentTime || 0, dur = prog?.duration || 0;
                resumeRef.current.set('ep:' + episodeId, cur);
                items.push({
                    kind: 'series', castId: episodeId, name: `${sp.seriesName} · ${tag}`,
                    cover: coverBySeries.get(seriesId) || '', pct: dur > 0 ? Math.round((cur / dur) * 100) : 0, at: sp.lastWatchedAt || 0,
                });
            }

            items.sort((a, b) => b.at - a.at);
            window.ipcRenderer.send('web-remote:continue', {
                items: items.slice(0, 40).map(({ kind, castId, name, cover, pct }) => ({ kind, castId, name, cover, pct })),
            });
        };

        // Habit-based "porque você assistiu" rows for the phone's Continuar tab —
        // same engine as the Home page, fed by the main-cached catalog lists.
        const pushRecommended = async () => {
            const vodRes = await window.ipcRenderer.invoke('streams:get-vod').catch(() => null) as
                { success: boolean; data?: VodMovie[] } | null;
            const vod = vodRes?.success ? (vodRes.data ?? []) : [];
            // Register the movies so a castMovie for a recommended id resolves.
            for (const m of vod) moviesRef.current.set(String(m.stream_id), m);
            const seriesRes = await window.ipcRenderer.invoke('streams:get-series').catch(() => null) as
                { success: boolean; data?: SeriesItem[] } | null;
            const series = seriesRes?.success ? (seriesRes.data ?? []) : [];
            const groups = await getHomeRecommendations(
                vod as unknown as RecMovie[],
                series as unknown as RecSeries[],
            ).catch(() => []);
            window.ipcRenderer.send('web-remote:recommended', {
                groups: groups.slice(0, 5).map(g => ({
                    seed: g.seedName,
                    items: g.items.slice(0, 12).map(r => r.kind === 'vod'
                        ? {
                            kind: 'movie',
                            id: String((r.item as RecMovie).stream_id),
                            name: r.item.name,
                            cover: (r.item as RecMovie).stream_icon || (r.item as RecMovie).cover || '',
                        }
                        : {
                            kind: 'series',
                            id: String((r.item as RecSeries).series_id),
                            name: r.item.name,
                            cover: (r.item as RecSeries).cover || '',
                        }),
                })),
            });
        };

        const castEpisode = async (episodeId: string, target?: CastTarget) => {
            const ep = episodesRef.current.get(episodeId);
            if (!ep) { sendCastResult('error'); return; }
            const urlRes = await window.ipcRenderer.invoke('streams:get-series-url', {
                streamId: ep.id, container: ep.container,
            }).catch(() => null) as { success: boolean; url?: string } | null;
            const pollable = await startCast([{ url: urlRes?.url ?? '', title: ep.name }], target, resumeRef.current.get('ep:' + episodeId) ?? 0);
            castingRef.current = pollable && ep.seriesId && ep.season != null && ep.episode != null
                ? { kind: 'episode', seriesId: ep.seriesId, season: ep.season, episode: ep.episode }
                : null;
        };

        // REC from the phone's guide: resolve the live URL and start the DVR
        // (same ffmpeg pipeline as the player's record button). Works from any
        // page — the bridge lives at the app root.
        const recordChannel = async (channelId: string, channelName: string) => {
            const name = channelName || 'Canal';
            const urlRes = await window.ipcRenderer.invoke('streams:get-live-url', { streamId: channelId })
                .catch(() => null) as { success: boolean; url?: string } | null;
            if (!urlRes?.success || !urlRes.url) {
                window.ipcRenderer.send('web-remote:record-result', { status: 'error', name });
                return;
            }
            const rec = await window.ipcRenderer.invoke('dvr:start', { url: urlRes.url, channelName: name })
                .catch(() => null) as { success: boolean; id?: string } | null;
            // The id lets the phone toggle this row to ⏹ (stopRecord).
            window.ipcRenderer.send('web-remote:record-result', {
                status: rec?.success ? 'ok' : 'error', name, id: rec?.id ?? '',
            });
        };

        // 🗑 on a finished file: resolve the name back to its safe absolute path
        // (dvr:delete-file only accepts paths inside the recordings folder).
        const deleteRecording = async (name: string) => {
            const filesRes = await window.ipcRenderer.invoke('dvr:list-files').catch(() => null) as
                { success: boolean; files?: { name: string; path: string; recording: boolean }[] } | null;
            const file = (filesRes?.files ?? []).find(f => f.name === name && !f.recording);
            if (!file) {
                window.ipcRenderer.send('web-remote:record-result', { status: 'error', name });
                return;
            }
            if (getProtectedRecordings().has(file.path)) {
                window.ipcRenderer.send('web-remote:record-result', { status: 'protected', name })
                return
            }
            const res = await window.ipcRenderer.invoke('dvr:delete-file', { path: file.path })
                .catch(() => null) as { success: boolean } | null;
            window.ipcRenderer.send('web-remote:record-result', { status: res?.success ? 'deleted' : 'error', name });
        };

        // Second tap on a 🔴 row: finalize that DVR recording.
        const stopRecord = async (id: string) => {
            const res = await window.ipcRenderer.invoke('dvr:stop', { id })
                .catch(() => null) as { success: boolean } | null;
            window.ipcRenderer.send('web-remote:record-result', {
                status: res?.success ? 'stopped' : 'error', name: '', id,
            });
        };

        // Active recordings (guide 🔴 rows + the Controle tab's Gravações card),
        // the latest finished files and the pending EPG schedules, so the phone
        // sees the whole DVR (active → ready → scheduled).
        const pushRecordings = async () => {
            const res = await window.ipcRenderer.invoke('dvr:active').catch(() => null) as
                { success: boolean; recordings?: { id: string; channelName: string; seconds: number }[] } | null;
            const filesRes = await window.ipcRenderer.invoke('dvr:list-files').catch(() => null) as
                { success: boolean; files?: { name: string; path: string; sizeBytes: number; recording: boolean }[] } | null;
            const scheduled = scheduledRecordingService.list()
                .slice()
                .sort((a, b) => (Date.parse(a.startIso) || 0) - (Date.parse(b.startIso) || 0))
                .slice(0, 10)
                .map(s => ({ id: s.id, title: s.title, channelName: s.channelName, startIso: s.startIso }));
            window.ipcRenderer.send('web-remote:recordings', {
                items: (res?.recordings ?? []).map(r => ({ id: r.id, channelName: r.channelName, seconds: r.seconds })),
                files: (filesRes?.files ?? []).filter(f => !f.recording).slice(0, 10)
                    .map(f => ({ name: f.name, sizeMb: Math.round(f.sizeBytes / 1048576), locked: getProtectedRecordings().has(f.path) })),
                scheduled,
            });
        };

        // ✏️ Renomeia uma gravação pronta a pedido do celular (resolve name→path).
        const renameRecording = async (name: string, newName: string) => {
            const filesRes = await window.ipcRenderer.invoke('dvr:list-files').catch(() => null) as
                { success: boolean; files?: { name: string; path: string; recording: boolean }[] } | null;
            const file = (filesRes?.files ?? []).find(f => f.name === name && !f.recording);
            const res = file && newName.trim()
                ? await window.ipcRenderer.invoke('dvr:rename-file', { path: file.path, name: newName.trim() })
                    .catch(() => null) as { success: boolean } | null
                : null;
            window.ipcRenderer.send('web-remote:record-result', { status: res?.success ? 'renamed' : 'error', name });
            void pushRecordings();
        };

        // 🔐 Alterna a proteção contra exclusão (mesma flag do sweep do desktop).
        const toggleProtect = async (name: string) => {
            const filesRes = await window.ipcRenderer.invoke('dvr:list-files').catch(() => null) as
                { success: boolean; files?: { name: string; path: string; recording: boolean }[] } | null;
            const file = (filesRes?.files ?? []).find(f => f.name === name && !f.recording);
            if (!file) {
                window.ipcRenderer.send('web-remote:record-result', { status: 'error', name });
                return;
            }
            toggleProtectedRecording(file.path);
            const lockedNow = getProtectedRecordings().has(file.path);
            window.ipcRenderer.send('web-remote:record-result', { status: lockedNow ? 'protected' : 'unprotected', name });
            void pushRecordings();
        };

        // ⭐ Favoritos pro app do celular (ids do provedor — mesmo servidor casa direto).
        const pushFavorites = () => {
            const items = favoritesService.getAll().slice(0, 200)
                .map(f => ({ id: f.id, type: f.type, title: f.title }));
            window.ipcRenderer.send('web-remote:favorites', { items });
        };

        // 🖐️ Trackpad do celular: swipes viram teclas de navegação no app.
        const dispatchNavKey = (key: string) => {
            const keyMap: Record<string, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ok: 'Enter', back: 'Escape' };
            const mapped = keyMap[key];
            if (!mapped) return;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: mapped, bubbles: true, cancelable: true }));
        };

        // ✖ on a scheduled row: unarm the timer (and stop it if already recording).
        const cancelSchedule = (id: string) => {
            const exists = scheduledRecordingService.list().some(s => s.id === id);
            if (exists) scheduledRecordingService.remove(id);
            window.ipcRenderer.send('web-remote:record-result', { status: exists ? 'cancelled' : 'error', name: '', id });
        };

        const asTarget = (v: unknown): CastTarget | undefined => {
            const t = v as Partial<CastTarget> | undefined;
            return t && typeof t.deviceId === 'string' && t.deviceId ? t as CastTarget : undefined;
        };

        // 📊 Stats rápidas pro controle web (hoje / últimos 7 dias / streak).
        const pushStats = () => {
            const stats = usageStatsService.getStats();
            const today = new Date().toISOString().split('T')[0];
            const todaySeconds = stats.dailyStats.find(d => d.date === today)?.totalSeconds || 0;
            const cutoff = Date.now() - 7 * 86400_000;
            const weekSeconds = stats.dailyStats
                .filter(d => Date.parse(d.date + 'T12:00:00') >= cutoff)
                .reduce((sum, d) => sum + d.totalSeconds, 0);
            window.ipcRenderer.send('web-remote:stats', { todaySeconds, weekSeconds, streak: stats.watchStreak || 0 });
        };

        // ⏰ Lembretes do guia pro celular (id + título + horário).
        const pushReminders = () => {
            const items = reminderService.list().map(reminder => ({
                id: reminder.id,
                title: reminder.title,
                channelName: reminder.channelName,
                startIso: reminder.startIso,
            }));
            window.ipcRenderer.send('web-remote:reminders', { items });
        };

        // 🔄 Item 11: sync de posições PC ↔ celular. Filme casa por stream_id;
        // episódio casa por nome da série (cache id ↔ nome montado sob demanda).
        let applyingRemoteProgress = false;
        let seriesNameCache: Map<string, string> | null = null;
        const loadSeriesNames = async (): Promise<Map<string, string>> => {
            if (seriesNameCache) return seriesNameCache;
            const result = await window.ipcRenderer.invoke('streams:get-series').catch(() => null) as
                { success: boolean; data?: SeriesItem[] } | null;
            const map = new Map<string, string>();
            for (const s of (result?.success ? result.data ?? [] : [])) map.set(String(s.series_id), s.name || '');
            seriesNameCache = map;
            return map;
        };
        const applyRemoteProgress = async (raw: unknown) => {
            const report = (raw ?? {}) as { kind?: string; movieId?: string; title?: string; season?: number; episode?: number; positionSec?: number; durationSec?: number; updatedAt?: number };
            const positionSec = Number(report.positionSec), durationSec = Number(report.durationSec), updatedAt = Number(report.updatedAt);
            if (!Number.isFinite(positionSec) || !(durationSec > 0) || !Number.isFinite(updatedAt)) return;
            applyingRemoteProgress = true;
            try {
                if (report.kind === 'movie' && report.movieId) {
                    // LWW: só aplica se a amostra do celular for mais nova que a local.
                    const local = movieProgressService.getMoviePositionById(report.movieId);
                    if (local && local.watchedAt >= updatedAt) return;
                    movieProgressService.saveMovieTime(report.movieId, String(report.title ?? ''), positionSec, durationSec);
                } else if (report.kind === 'episode' && report.title && Number.isInteger(report.season) && Number.isInteger(report.episode)) {
                    const names = await loadSeriesNames();
                    const wanted = String(report.title).trim().toLowerCase();
                    let seriesId = '';
                    for (const [id, name] of names) {
                        if (name.trim().toLowerCase() === wanted) { seriesId = id; break; }
                    }
                    if (!seriesId) return; // série fora do catálogo local — o Trakt cobre.
                    const local = watchProgressService.getEpisodeProgress(seriesId, report.season!, report.episode!);
                    if (local && local.duration > 0 && local.currentTime > 0) {
                        // Sem watchedAt exposto aqui: "maior progresso vence" resolve o empate.
                        if (local.currentTime >= positionSec) return;
                    }
                    watchProgressService.saveVideoTime(seriesId, report.season!, report.episode!, positionSec, durationSec);
                }
            } finally {
                applyingRemoteProgress = false;
            }
        };
        // O espelho de posição roda dentro do onTimeUpdate do player. Um throw
        // aqui (ex.: canal fora da whitelist do preload) sobe pelo event handler
        // do <video> e derruba a reprodução — então NUNCA deixe escapar.
        const sendProgress = (payload: unknown) => {
            try {
                window.ipcRenderer.send('web-remote:progress', payload);
            } catch (error) {
                console.warn('[WebRemoteBridge] progresso não espelhado:', error);
            }
        };
        const onLocalProgressSample = (event: Event) => {
            if (applyingRemoteProgress) return; // eco do que o celular acabou de mandar
            const detail = (event as CustomEvent).detail as { kind?: string; movieId?: string; title?: string; seriesId?: string; season?: number; episode?: number; positionSec?: number; durationSec?: number; updatedAt?: number } | undefined;
            if (!detail) return;
            if (detail.kind === 'movie') {
                sendProgress({ kind: 'movie', movieId: detail.movieId, title: detail.title, positionSec: detail.positionSec, durationSec: detail.durationSec, updatedAt: detail.updatedAt });
            } else if (detail.kind === 'episode' && detail.seriesId) {
                void loadSeriesNames().then(names => {
                    const seriesName = names.get(String(detail.seriesId));
                    if (!seriesName) return;
                    sendProgress({ kind: 'episode', title: seriesName, season: detail.season, episode: detail.episode, positionSec: detail.positionSec, durationSec: detail.durationSec, updatedAt: detail.updatedAt });
                });
            }
        };
        window.addEventListener('progress:sample', onLocalProgressSample);

        const handler = (_e: unknown, action: string, arg?: unknown, target?: unknown) => {
            if (action === 'requestCatalog') void pushCatalog(typeof arg === 'string' ? arg : '');
            else if (action === 'requestLiveSearch') void pushLiveSearch(typeof arg === 'string' ? arg : '');
            else if (action === 'requestContinue') void pushContinue();
            else if (action === 'requestRecommended') void pushRecommended();
            else if (action === 'requestStats') pushStats();
            else if (action === 'requestReminders') pushReminders();
            else if (action === 'cancelReminder') {
                if (typeof arg === 'string' && arg) reminderService.removeReminder(arg);
                pushReminders();
            }
            else if (action === 'requestDevices') void pushDevices();
            else if (action === 'recordChannel') void recordChannel(String(arg ?? ''), typeof target === 'string' ? target : '');
            else if (action === 'stopRecord') void stopRecord(String(arg ?? ''));
            else if (action === 'deleteRecording') void deleteRecording(String(arg ?? ''));
            else if (action === 'renameRecording') void renameRecording(String(arg ?? ''), String(target ?? ''));
            else if (action === 'toggleProtectRecording') void toggleProtect(String(arg ?? ''));
            else if (action === 'navKey') dispatchNavKey(String(arg ?? ''));
            else if (action === 'requestFavorites') pushFavorites();
            else if (action === 'requestRecordings') void pushRecordings();
            else if (action === 'cancelSchedule') cancelSchedule(String(arg ?? ''));
            else if (action === 'castMovie') void castMovie(String(arg ?? ''), asTarget(target));
            // 🎉 Item 40 (modo festa): o filme cai na fila manual da TV — o
            // VOD toca o próximo da fila quando o atual termina (item 32).
            else if (action === 'partyAdd') {
                const movie = moviesRef.current.get(String(arg ?? ''));
                if (movie) queueService.add({ id: String(movie.stream_id), name: movie.name, cover: movie.stream_icon });
            }
            else if (action === 'castMovieQueue') void castMovieQueue(Array.isArray(arg) ? (arg as string[]) : [], asTarget(target));
            else if (action === 'requestSeries') void pushSeries(typeof arg === 'string' ? arg : '');
            else if (action === 'requestSeriesInfo') void pushSeriesInfo(String(arg ?? ''));
            else if (action === 'castEpisode') void castEpisode(String(arg ?? ''), asTarget(target));
            else if (action === 'reportProgress') void applyRemoteProgress(arg);
        };
        window.ipcRenderer.on('media:control', handler);

        // While the phone is casting a movie/episode, mirror the Chromecast's
        // position into the local watch history every ~5s, so "continuar
        // assistindo" reflects what was watched on the TV. Clears when it stops.
        const historyPoll = setInterval(() => {
            const casting = castingRef.current;
            if (!casting) return;
            void (async () => {
                const st = await window.ipcRenderer.invoke('cast:get-status').catch(() => null) as
                    { success: boolean; active?: boolean; currentTime?: number | null; duration?: number | null } | null;
                if (!st?.success || !st.active) { castingRef.current = null; return; }
                const cur = st.currentTime ?? 0, dur = st.duration ?? 0;
                if (dur <= 0 || cur <= 0) return;
                if (casting.kind === 'movie') movieProgressService.saveMovieTime(casting.id, casting.name, cur, dur);
                else watchProgressService.saveVideoTime(casting.seriesId, casting.season, casting.episode, cur, dur);
            })();
        }, 5000);

        return () => { window.ipcRenderer.off('media:control', handler); window.removeEventListener('progress:sample', onLocalProgressSample); clearInterval(historyPoll); };
    }, []);

    return null;
}
