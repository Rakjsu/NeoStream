import { useEffect, useRef } from 'react';
import type { CastQueueItem } from '../services/castQueue';
import { watchProgressService } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';

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
    // Last fetched episodes (across a series' seasons), for castEpisode.
    const episodesRef = useRef<Map<string, { id: number | string; container: string; name: string }>>(new Map());
    // Last discovered cast targets, so a target id from the phone resolves a name.
    const devicesRef = useRef<Map<string, { name: string; type: CastTargetType }>>(new Map());
    // Resume positions (seconds) for "continue watching" items, keyed by
    // "movie:<id>" / "ep:<episodeId>", so a cast started from that tab resumes.
    const resumeRef = useRef<Map<string, number>>(new Map());

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
        const startCast = async (items: CastQueueItem[], target?: CastTarget, resumeAt = 0) => {
            const queue = items.filter(i => i.url);
            if (queue.length === 0) { sendCastResult('error'); return; }
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
                return;
            }

            // No explicit target: legacy behaviour — first Chromecast on the LAN.
            const discover = await window.ipcRenderer.invoke('cast:discover').catch(() => null) as DiscoverResult | null;
            const device = discover?.devices?.[0];
            if (!device) { sendCastResult('no-device'); return; }
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
        };

        const castMovie = async (movieId: string, target?: CastTarget) => {
            const movie = moviesRef.current.get(movieId);
            if (!movie) { sendCastResult('error'); return; }
            const urlRes = await window.ipcRenderer.invoke('streams:get-vod-url', {
                streamId: movie.stream_id,
                container: movie.container_extension || 'mp4',
            }).catch(() => null) as { success: boolean; url?: string } | null;
            await startCast([{ url: urlRes?.url ?? '', title: movie.name }], target, resumeRef.current.get('movie:' + movieId) ?? 0);
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
            const map = new Map<string, { id: number | string; container: string; name: string }>();
            for (const seasonNum of Object.keys(seasons).sort((a, b) => Number(a) - Number(b))) {
                for (const ep of seasons[seasonNum] ?? []) {
                    const id = String(ep.id);
                    const tag = `T${seasonNum}E${ep.episode_num}`;
                    const label = ep.title ? `${tag} · ${ep.title}` : tag;
                    episodes.push({ id, label });
                    map.set(id, { id: ep.id, container: ep.container_extension || 'mp4', name: label });
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
                episodesRef.current.set(episodeId, { id: ep.id, container: ep.container_extension || 'mp4', name: `${sp.seriesName} · ${tag}` });
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

        const castEpisode = async (episodeId: string, target?: CastTarget) => {
            const ep = episodesRef.current.get(episodeId);
            if (!ep) { sendCastResult('error'); return; }
            const urlRes = await window.ipcRenderer.invoke('streams:get-series-url', {
                streamId: ep.id, container: ep.container,
            }).catch(() => null) as { success: boolean; url?: string } | null;
            await startCast([{ url: urlRes?.url ?? '', title: ep.name }], target, resumeRef.current.get('ep:' + episodeId) ?? 0);
        };

        const asTarget = (v: unknown): CastTarget | undefined => {
            const t = v as Partial<CastTarget> | undefined;
            return t && typeof t.deviceId === 'string' && t.deviceId ? t as CastTarget : undefined;
        };

        const handler = (_e: unknown, action: string, arg?: unknown, target?: unknown) => {
            if (action === 'requestCatalog') void pushCatalog(typeof arg === 'string' ? arg : '');
            else if (action === 'requestContinue') void pushContinue();
            else if (action === 'requestDevices') void pushDevices();
            else if (action === 'castMovie') void castMovie(String(arg ?? ''), asTarget(target));
            else if (action === 'castMovieQueue') void castMovieQueue(Array.isArray(arg) ? (arg as string[]) : [], asTarget(target));
            else if (action === 'requestSeries') void pushSeries(typeof arg === 'string' ? arg : '');
            else if (action === 'requestSeriesInfo') void pushSeriesInfo(String(arg ?? ''));
            else if (action === 'castEpisode') void castEpisode(String(arg ?? ''), asTarget(target));
        };
        window.ipcRenderer.on('media:control', handler);
        return () => window.ipcRenderer.off('media:control', handler);
    }, []);

    return null;
}
