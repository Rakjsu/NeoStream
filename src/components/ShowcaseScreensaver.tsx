import { useEffect, useRef, useState } from 'react';
import { LazyImage } from './LazyImage';

export const SCREENSAVER_MINUTES_KEY = 'neostream_screensaver_min';

interface ShowcasePoster {
    name: string;
    icon: string;
}

/**
 * 🖼️ Modo vitrine (screensaver): após N minutos sem input (configurável em
 * Reprodução, desligado por padrão), cobre o app com capas do catálogo em
 * rotação + relógio. Qualquer input sai. Nunca ativa com vídeo em reprodução.
 */
export function ShowcaseScreensaver() {
    const [active, setActive] = useState(false);
    const [posters, setPosters] = useState<ShowcasePoster[]>([]);
    const [index, setIndex] = useState(0);
    const [clock, setClock] = useState('');
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeRef = useRef(false);

    useEffect(() => {
        activeRef.current = active;
    }, [active]);

    // Atividade re-arma o timer; com a vitrine ativa, qualquer input sai.
    useEffect(() => {
        const arm = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            const minutes = parseInt(localStorage.getItem(SCREENSAVER_MINUTES_KEY) || '0', 10);
            if (!minutes || minutes <= 0) return;
            timerRef.current = setTimeout(() => {
                // Vídeo tocando (player, PiP embutido, multi-view) = nunca ativar.
                if (document.querySelector('video')) {
                    arm();
                    return;
                }
                setActive(true);
            }, minutes * 60_000);
        };
        const onActivity = () => {
            if (activeRef.current) setActive(false);
            arm();
        };
        const events: (keyof DocumentEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
        events.forEach(name => document.addEventListener(name, onActivity, { passive: true }));
        arm();
        return () => {
            events.forEach(name => document.removeEventListener(name, onActivity));
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    // Ao ativar: busca capas do catálogo (uma vez por ativação) + slideshow + relógio.
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        window.ipcRenderer.invoke('streams:get-vod', {})
            .then((result: { success?: boolean; data?: { name: string; stream_icon?: string }[] }) => {
                if (cancelled || !result?.success || !Array.isArray(result.data)) return;
                const withCover = result.data.filter(m => m.stream_icon);
                // Amostra espalhada (sem Math.random em render paths — aqui é efeito, ok usar)
                const sampled: ShowcasePoster[] = [];
                const step = Math.max(1, Math.floor(withCover.length / 30));
                for (let i = 0; i < withCover.length && sampled.length < 30; i += step) {
                    const start = Math.min(withCover.length - 1, i + Math.floor(Math.random() * step));
                    const movie = withCover[start];
                    sampled.push({ name: movie.name, icon: movie.stream_icon! });
                }
                setPosters(sampled);
                setIndex(0);
            })
            .catch(() => { /* vitrine segue só com o relógio */ });

        const tick = () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        tick();
        const clockId = setInterval(tick, 15_000);
        const slideId = setInterval(() => setIndex(prev => prev + 1), 8_000);
        return () => {
            cancelled = true;
            clearInterval(clockId);
            clearInterval(slideId);
        };
    }, [active]);

    if (!active) return null;

    const poster = posters.length > 0 ? posters[index % posters.length] : null;

    return (
        <div
            onClick={() => setActive(false)}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99998,
                background: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'none'
            }}
        >
            {poster && (
                <div key={poster.icon} style={{ textAlign: 'center', animation: 'fadeInScale 1.2s ease' }}>
                    <LazyImage
                        src={poster.icon}
                        alt=""
                        style={{ maxHeight: '70vh', maxWidth: '60vw', borderRadius: 16, boxShadow: '0 12px 48px rgba(0,0,0,0.8)' }}
                        fallback={<div style={{ fontSize: 80 }}>🎬</div>}
                    />
                    <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 18, fontWeight: 600, marginTop: 18, maxWidth: '60vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {poster.name}
                    </div>
                </div>
            )}
            <div style={{ position: 'absolute', bottom: 40, right: 56, color: 'rgba(255,255,255,0.7)', fontSize: 44, fontWeight: 300, letterSpacing: 1 }}>
                {clock}
            </div>
            <div style={{ position: 'absolute', bottom: 46, left: 56, color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
                NeoStream
            </div>
        </div>
    );
}
