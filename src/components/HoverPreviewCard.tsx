import { memo } from 'react';
import { Play } from 'lucide-react';
import { LazyImage } from './LazyImage';
import './HoverPreviewCard.css';

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

// Grid card. Clicking opens the centered detail modal (trailer hero + info);
// hover is purely a CSS lift — no preview overlay (that caused flicker on
// distant items and the owner prefers click-to-open).
function HoverPreviewCardComponent({
    cover,
    title,
    onMoreInfo,
    children
}: HoverPreviewCardProps) {
    return (
        <div className="hover-preview-card" onClick={onMoreInfo}>
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
