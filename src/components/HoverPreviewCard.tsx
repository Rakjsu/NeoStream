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
    /** Selo "NOVO": item que entrou no catálogo há poucos dias. */
    isNew?: boolean;
    /** Selo de qualidade (4K/FHD/HD) extraído do nome do provedor. */
    qualityBadge?: string | null;
    onPlay: () => void;
    onMoreInfo: () => void;
    onToggleFavorite?: () => void;
    children?: React.ReactNode;
}

// Grid card. Clicking opens the centered detail modal (trailer hero + info);
// hover is purely a CSS lift — no preview overlay (that caused flicker on
// distant items and the owner prefers click-to-open).
// Keyboard: the card is a Tab stop — Enter/Space opens it like a click.
function HoverPreviewCardComponent({
    cover,
    title,
    onMoreInfo,
    isNew,
    qualityBadge,
    children
}: HoverPreviewCardProps) {
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); // Space must not scroll the grid
            onMoreInfo();
        }
    };
    return (
        <div
            className="hover-preview-card"
            role="button"
            tabIndex={0}
            aria-label={title}
            onClick={onMoreInfo}
            onKeyDown={handleKeyDown}
        >
            {/* Poster */}
            <div className="preview-poster" style={{ position: 'relative' }}>
                {isNew && <span className="preview-new-badge">NOVO</span>}
                {qualityBadge && !isNew && (
                    <span className="preview-new-badge" style={{ background: 'rgba(59, 130, 246, 0.9)' }}>{qualityBadge}</span>
                )}
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
