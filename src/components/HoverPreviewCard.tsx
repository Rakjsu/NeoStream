import { memo, useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { LazyImage } from './LazyImage';
import { hoverPreviewBus } from './hoverPreviewBus';
import './HoverPreviewCard.css';

// Delay before the centered preview opens, so a quick mouse pass-over never
// triggers it.
const OPEN_DELAY_MS = 450;

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface HoverPreviewCardProps {
    type: 'movie' | 'series';
    id: string | number;
    cover: string;
    backdrop?: string;
    title: string;
    year?: string;
    rating?: string;
    genres?: string[];
    plot?: string;
    youtubeTrailer?: string;
    isFavorite?: boolean;
    onPlay: () => void;
    onMoreInfo: () => void;
    onToggleFavorite?: () => void;
    children?: React.ReactNode;
}

function HoverPreviewCardComponent({
    type,
    cover,
    backdrop,
    title,
    year,
    rating,
    genres,
    youtubeTrailer,
    isFavorite,
    onPlay,
    onMoreInfo,
    onToggleFavorite,
    children
}: HoverPreviewCardProps) {
    const posterRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const handleMouseEnter = () => {
        if (prefersReducedMotion()) return;
        clearTimer();
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const el = posterRef.current;
            if (!el) return;
            hoverPreviewBus.open({
                anchor: el.getBoundingClientRect(),
                type,
                title,
                year,
                cover,
                backdrop,
                rating,
                genres,
                youtubeTrailer,
                isFavorite,
                onPlay,
                onMoreInfo,
                onToggleFavorite,
            });
        }, OPEN_DELAY_MS);
    };

    const handleMouseLeave = () => {
        clearTimer();
        hoverPreviewBus.scheduleClose();
    };

    // Drop any pending timer on unmount.
    useEffect(() => clearTimer, []);

    return (
        <div
            className="hover-preview-card"
            onClick={onMoreInfo}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Poster */}
            <div className="preview-poster" ref={posterRef} style={{ position: 'relative' }}>
                <LazyImage
                    src={cover}
                    alt={title}
                    fallback={(
                        <div className="poster-fallback-placeholder">
                            <span>🎬</span>
                        </div>
                    )}
                />

                {/* Overlay with play button */}
                <div className="card-overlay">
                    <div className="play-icon">
                        <Play size={24} fill="white" />
                    </div>
                </div>

                {/* Children badges go here (absolute positioned) */}
                {children}
            </div>

            {/* Card info below poster */}
            <div className="card-info">
                <h4 className="card-title">{title}</h4>
            </div>
        </div>
    );
}

export const HoverPreviewCard = memo(HoverPreviewCardComponent);
