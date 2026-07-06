import { useEffect, useRef } from 'react';
import { castResolvedQueue, type CastQueueItem } from '../services/castQueue';

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

export function WebRemoteBridge() {
    // Last fetched movie list, so castMovie can look up the container.
    const moviesRef = useRef<Map<string, VodMovie>>(new Map());

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

        const castMovieQueue = async (movieIds: string[]) => {
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
            await castResolvedQueue(queue).catch(() => undefined);
        };

        const handler = (_e: unknown, action: string, arg?: unknown) => {
            if (action === 'requestCatalog') void pushCatalog();
            else if (action === 'castMovie') void castMovie(String(arg ?? ''));
            else if (action === 'castMovieQueue') void castMovieQueue(Array.isArray(arg) ? (arg as string[]) : []);
        };
        window.ipcRenderer.on('media:control', handler);
        return () => window.ipcRenderer.off('media:control', handler);
    }, []);

    return null;
}
