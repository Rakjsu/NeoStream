import { useState, useCallback } from 'react';
import { Play } from 'lucide-react';
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

// Simplified export - no-op function for backward compatibility
export function closeAllPreviews() {
    // No-op - simplified version doesn't need this
}

export function HoverPreviewCard({
    cover,
    title,
    onMoreInfo,
    children
}: HoverPreviewCardProps) {
    const [imageError, setImageError] = useState(false);

    const handleImageError = useCallback(() => {
        setImageError(true);
    }, []);

    return (
        <div
            className="hover-preview-card"
            onClick={onMoreInfo}
        >
            {/* Poster */}
            <div className="preview-poster" style={{ position: 'relative' }}>
                {!imageError ? (
                    <img
                        src={cover}
                        alt={title}
                        loading="lazy"
                        onError={handleImageError}
                    />
                ) : (
                    <div className="poster-fallback-placeholder">
                        <span>🎬</span>
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
