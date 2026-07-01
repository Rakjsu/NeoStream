import { memo, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { LazyImage } from './LazyImage';
import { extractYouTubeId } from '../utils/youtube';
import './HoverPreviewCard.css';

// Delay before the trailer starts so a quick mouse pass-over never loads it.
const TRAILER_DELAY_MS = 1200;

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
    cover,
    title,
    youtubeTrailer,
    onMoreInfo,
    children
}: HoverPreviewCardProps) {
    const trailerId = extractYouTubeId(youtubeTrailer);
    // Only mount the iframe once the hover delay elapses; unmount on leave.
    const [showTrailer, setShowTrailer] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const handleMouseEnter = () => {
        if (!trailerId || prefersReducedMotion()) return;
        clearTimer();
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setShowTrailer(true);
        }, TRAILER_DELAY_MS);
    };

    const handleMouseLeave = () => {
        clearTimer();
        setShowTrailer(false);
    };

    // Drop any pending timer / iframe on unmount.
    useEffect(() => clearTimer, []);

    const embedSrc = trailerId
        ? `https://www.youtube-nocookie.com/embed/${trailerId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${trailerId}`
        : '';

    return (
        <div
            className="hover-preview-card"
            onClick={onMoreInfo}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Poster */}
            <div className="preview-poster" style={{ position: 'relative' }}>
                <LazyImage
                    src={cover}
                    alt={title}
                    fallback={(
                        <div className="poster-fallback-placeholder">
                            <span>🎬</span>
                        </div>
                    )}
                />

                {/* Muted trailer preview, fades in over the poster */}
                {showTrailer && trailerId && (
                    <div className="preview-trailer">
                        <iframe
                            src={embedSrc}
                            title={`${title} trailer`}
                            referrerPolicy="strict-origin-when-cross-origin"
                            allow="autoplay; encrypted-media; picture-in-picture"
                            tabIndex={-1}
                        />
                        <span className="preview-trailer-muted" aria-hidden="true">🔇</span>
                    </div>
                )}

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
