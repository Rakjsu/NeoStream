import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MultiView } from '../components/MultiView';
import { favoritesService } from '../services/favoritesService';

/**
 * 🖥️ Item 17: multi-view destacado em janela própria (rota /multiview).
 * Carrega os canais direto do main e fecha a JANELA no ✕ — o mosaico fica
 * independente do app principal (dá pra assistir TV numa tela e navegar na outra).
 */
export default function MultiViewWindow() {
    const location = useLocation();
    const initial = new URLSearchParams(location.search).get('initial') ?? undefined;
    const [channels, setChannels] = useState<{ id: string | number; name: string; logo?: string; favorite?: boolean }[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        void window.ipcRenderer.invoke('streams:get-live', {})
            .then((res: { success?: boolean; data?: { stream_id: number | string; name: string; stream_icon?: string }[] }) => {
                if (cancelled) return;
                const favoriteIds = new Set(favoritesService.getAll()
                    .filter(f => (f.type as string) === 'channel').map(f => f.id));
                setChannels((res?.data ?? []).map(s => ({
                    id: s.stream_id,
                    name: s.name,
                    logo: s.stream_icon,
                    favorite: favoriteIds.has(String(s.stream_id))
                })));
            })
            .catch(() => { if (!cancelled) setChannels([]); });
        return () => { cancelled = true; };
    }, []);

    if (!channels) {
        return <div style={{ position: 'fixed', inset: 0, background: '#0f0f1e' }} />;
    }
    return <MultiView channels={channels} initialChannelId={initial} onClose={() => window.close()} />;
}
