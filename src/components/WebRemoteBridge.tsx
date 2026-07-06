import { useEffect, useRef } from 'react';

/**
 * Always-mounted bridge for the phone web remote's catalog second-screen.
 * The web-remote server forwards two commands over media:control:
 *   - `requestCatalog` → fetch the movie list and push it back (web-remote:catalog);
 *   - `castMovie <id>` → resolve the movie URL and start a Chromecast.
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

export function WebRemoteBridge() {
    // Last fetched movie list, so castMovie can look up the container.
    const moviesRef = useRef<Map<string, VodMovie>>(new Map());
    // Last fetched episodes (across a series' seasons), for castEpisode.
    const episodesRef = useRef<Map<string, { id: number | string; container: string; name: string }>>(new Map());

    useEffect(() => {
        const pushCatalog = async () => {
            const result = await window.ipcRenderer.invoke('streams:get-vod').catch(() => null) as
                { success: boolean; data?: VodMovie[] } | null;
            const movies = result?.success ? (result.data ?? []) : [];
            const map = new Map<string, VodMovie>();
            for (const m of movies) map.set(String(m.stream_id), m);
            moviesRef.current = map;
            window.ipcRenderer.send('web-remote:catalog', {
                items: movies.slice(0, 400).map(m => ({
                    id: String(m.stream_id),
                    name: m.name,
                    cover: m.stream_icon || '',
                })),
            });
        };

        const castMovie = async (movieId: string) => {
            const movie = moviesRef.current.get(movieId);
            if (!movie) return;
            const discover = await window.ipcRenderer.invoke('cast:discover').catch(() => null) as
                { success: boolean; devices?: { id: string; name: string }[] } | null;
            const device = discover?.devices?.[0];
            if (!device) return;
            const urlRes = await window.ipcRenderer.invoke('streams:get-vod-url', {
                streamId: movie.stream_id,
                container: movie.container_extension || 'mp4',
            }).catch(() => null) as { success: boolean; url?: string } | null;
            if (!urlRes?.success || !urlRes.url) return;
            await window.ipcRenderer.invoke('cast:play', {
                deviceId: device.id, url: urlRes.url, title: movie.name, live: false,
            }).catch(() => undefined);
        };

        const pushSeries = async () => {
            const result = await window.ipcRenderer.invoke('streams:get-series').catch(() => null) as
                { success: boolean; data?: SeriesItem[] } | null;
            const series = result?.success ? (result.data ?? []) : [];
            window.ipcRenderer.send('web-remote:series', {
                items: series.slice(0, 400).map(s => ({
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
            episodesRef.current = map;
            window.ipcRenderer.send('web-remote:series-info', { seriesId, episodes });
        };

        const castEpisode = async (episodeId: string) => {
            const ep = episodesRef.current.get(episodeId);
            if (!ep) return;
            const discover = await window.ipcRenderer.invoke('cast:discover').catch(() => null) as
                { success: boolean; devices?: { id: string; name: string }[] } | null;
            const device = discover?.devices?.[0];
            if (!device) return;
            const urlRes = await window.ipcRenderer.invoke('streams:get-series-url', {
                streamId: ep.id, container: ep.container,
            }).catch(() => null) as { success: boolean; url?: string } | null;
            if (!urlRes?.success || !urlRes.url) return;
            await window.ipcRenderer.invoke('cast:play', {
                deviceId: device.id, url: urlRes.url, title: ep.name, live: false,
            }).catch(() => undefined);
        };

        const handler = (_e: unknown, action: string, arg?: unknown) => {
            if (action === 'requestCatalog') void pushCatalog();
            else if (action === 'castMovie') void castMovie(String(arg ?? ''));
            else if (action === 'requestSeries') void pushSeries();
            else if (action === 'requestSeriesInfo') void pushSeriesInfo(String(arg ?? ''));
            else if (action === 'castEpisode') void castEpisode(String(arg ?? ''));
        };
        window.ipcRenderer.on('media:control', handler);
        return () => window.ipcRenderer.off('media:control', handler);
    }, []);

    return null;
}
