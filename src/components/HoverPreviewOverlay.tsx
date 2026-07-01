import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Heart, Info, VolumeX } from 'lucide-react';
import { extractYouTubeId } from '../utils/youtube';
import { fetchMovieTrailer, fetchSeriesTrailer } from '../services/tmdb';
import { hoverPreviewBus, type HoverPreviewPayload } from './hoverPreviewBus';
import './HoverPreviewOverlay.css';

// How long the card lingers (after the mouse leaves it) before the panel
// closes — enough time to travel across the dim toward the centered panel.
const CLOSE_FROM_CARD_MS = 380;
// Shorter grace once the mouse is on/near the panel itself.
const CLOSE_FROM_PANEL_MS = 160;

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Single, app-wide overlay that renders the centered "fly to center + expand"
 * trailer preview. Mounted once near the app root; driven by hoverPreviewBus.
 */
export function HoverPreviewOverlay() {
    const [payload, setPayload] = useState<HoverPreviewPayload | null>(null);
    // Trailer resolved from TMDB, tagged with the payload it belongs to so a
    // late response for a previous item is ignored (derived, not reset in an
    // effect).
    const [fetched, setFetched] = useState<{ key: HoverPreviewPayload; id: string | null } | null>(null);
    const [favorite, setFavorite] = useState(false);

    const directId = extractYouTubeId(payload?.youtubeTrailer || undefined);
    const trailerId = directId || (fetched && fetched.key === payload ? fetched.id : null);

    const panelRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Kept in a ref so the bus handlers (registered once) always see the latest.
    const payloadRef = useRef<HoverPreviewPayload | null>(null);
    useEffect(() => { payloadRef.current = payload; }, [payload]);

    const clearCloseTimer = () => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    };

    // Reverse FLIP: shrink the panel back toward the originating poster, then
    // unmount.
    const animateOutAndClose = useCallback(() => {
        const panel = panelRef.current;
        const current = payloadRef.current;
        if (!panel || !current || prefersReducedMotion()) {
            setPayload(null);
            return;
        }
        const target = panel.getBoundingClientRect();
        const a = current.anchor;
        const dx = (a.left + a.width / 2) - (target.left + target.width / 2);
        const dy = (a.top + a.height / 2) - (target.top + target.height / 2);
        const scale = a.width / target.width;
        panel.style.transition = 'transform .3s ease, opacity .28s ease';
        panel.style.transformOrigin = 'center center';
        panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        panel.style.opacity = '0';
        closeTimer.current = setTimeout(() => setPayload(null), 300);
    }, []);

    const scheduleClose = useCallback((delay: number) => {
        clearCloseTimer();
        closeTimer.current = setTimeout(animateOutAndClose, delay);
    }, [animateOutAndClose]);

    // Register with the bus once.
    useEffect(() => {
        const unregister = hoverPreviewBus.register({
            open: (next) => {
                clearCloseTimer();
                setFavorite(!!next.isFavorite);
                setPayload(next);
            },
            scheduleClose: () => scheduleClose(CLOSE_FROM_CARD_MS),
            cancelClose: clearCloseTimer,
        });
        return () => {
            unregister();
            clearCloseTimer();
        };
    }, [scheduleClose]);

    // Resolve the trailer from TMDB when the provider didn't supply one (same
    // source the detail modal uses). The async callback tags its result with
    // the current payload so a stale response is ignored by the derived value.
    useEffect(() => {
        if (!payload || directId) return;
        const fetcher = payload.type === 'series' ? fetchSeriesTrailer : fetchMovieTrailer;
        fetcher(payload.title, payload.year)
            .then((url) => setFetched({ key: payload, id: extractYouTubeId(url || undefined) }))
            .catch(() => { /* leave the still frame showing */ });
    }, [payload, directId]);

    // Enter FLIP: fly the panel from the poster rect to its centered rest state.
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel || !payload) return;
        panel.style.opacity = '';
        if (prefersReducedMotion()) {
            panel.style.transform = '';
            return;
        }
        const target = panel.getBoundingClientRect();
        const a = payload.anchor;
        const dx = (a.left + a.width / 2) - (target.left + target.width / 2);
        const dy = (a.top + a.height / 2) - (target.top + target.height / 2);
        const scale = a.width / target.width;
        panel.style.transition = 'none';
        panel.style.transformOrigin = 'center center';
        panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        // Force reflow, then animate to the rest state.
        void panel.getBoundingClientRect();
        panel.style.transition = 'transform .34s cubic-bezier(.32,1.28,.5,1), opacity .22s ease';
        panel.style.transform = 'translate(0, 0) scale(1)';
    }, [payload]);

    // Close on Escape.
    useEffect(() => {
        if (!payload) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') animateOutAndClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [payload, animateOutAndClose]);

    if (!payload) return null;

    const still = payload.backdrop || payload.cover;
    const embedSrc = trailerId
        ? `https://www.youtube-nocookie.com/embed/${trailerId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${trailerId}`
        : '';

    const runAndClose = (fn?: () => void) => {
        fn?.();
        clearCloseTimer();
        setPayload(null);
    };

    return createPortal(
        <div className="hp-overlay" role="dialog" aria-label={`${payload.title} — prévia`}>
            <div className="hp-dim" onClick={animateOutAndClose} />
            <div
                className="hp-panel"
                ref={panelRef}
                onMouseEnter={clearCloseTimer}
                onMouseLeave={() => scheduleClose(CLOSE_FROM_PANEL_MS)}
            >
                <div className="hp-screen" onClick={() => runAndClose(payload.onMoreInfo)}>
                    <div className="hp-still" style={{ backgroundImage: still ? `url("${still}")` : undefined }} />
                    {trailerId && (
                        <iframe
                            className="hp-trailer"
                            src={embedSrc}
                            title={`${payload.title} trailer`}
                            referrerPolicy="strict-origin-when-cross-origin"
                            allow="autoplay; encrypted-media; picture-in-picture"
                            tabIndex={-1}
                        />
                    )}
                    <span className="hp-muted" aria-hidden="true"><VolumeX size={15} /></span>
                </div>

                <div className="hp-bar">
                    <div className="hp-actions">
                        <button
                            className="hp-btn hp-btn-play"
                            onClick={(e) => { e.stopPropagation(); runAndClose(payload.onPlay); }}
                            aria-label="Assistir"
                        >
                            <Play size={18} fill="currentColor" />
                        </button>
                        {payload.onToggleFavorite && (
                            <button
                                className={`hp-btn ${favorite ? 'is-active' : ''}`}
                                onClick={(e) => { e.stopPropagation(); payload.onToggleFavorite?.(); setFavorite((v) => !v); }}
                                aria-label={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                            >
                                <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
                            </button>
                        )}
                        <button
                            className="hp-btn"
                            onClick={(e) => { e.stopPropagation(); runAndClose(payload.onMoreInfo); }}
                            aria-label="Mais informações"
                        >
                            <Info size={18} />
                        </button>
                    </div>
                    <div className="hp-meta">
                        <strong>{payload.title}</strong>
                        <span>
                            {[payload.year, payload.rating ? `★ ${payload.rating}` : null, payload.genres?.[0]]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
