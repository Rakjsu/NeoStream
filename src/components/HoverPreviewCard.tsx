import { memo, useState } from 'react';
import { Info } from 'lucide-react';
import { LazyImage } from './LazyImage';
import { hasSeenNewBadge, markNewBadgeSeen } from '../services/newBadgeService';
import './HoverPreviewCard.css';

// A interface tinha 17 props e o componente lia 8. As outras 9 (backdrop,
// year, rating, genres, plot, youtubeTrailer, isFavorite, onPlay,
// onToggleFavorite) sobraram do tempo em que o hover abria uma prévia — o
// componente as recebia e descartava, e as duas páginas montavam closures a
// cada card do catálogo para alimentá-las.
interface HoverPreviewCardProps {
    type: 'movie' | 'series';
    id: string | number;
    cover: string;
    title: string;
    /** Selo "NOVO": item que entrou no catálogo há poucos dias. */
    isNew?: boolean;
    /** Selo de qualidade (4K/FHD/HD) extraído do nome do provedor. */
    qualityBadge?: string | null;
    /**
     * Verificação do controle parental / perfil Kids em andamento (a página
     * foi ao IndexedDB/TMDB antes de abrir a ficha). O card esmaece, gira e
     * não aceita outro clique nem Enter até a verificação terminar.
     */
    checking?: boolean;
    onMoreInfo: () => void;
    children?: React.ReactNode;
}

// Grid card. Clicking opens the centered detail modal (trailer hero + info);
// hover is purely a CSS lift — no preview overlay (that caused flicker on
// distant items and the owner prefers click-to-open).
// Keyboard: the card is a Tab stop — Enter/Space opens it like a click.
function HoverPreviewCardComponent({
    type,
    id,
    cover,
    title,
    onMoreInfo,
    isNew,
    qualityBadge,
    checking,
    children
}: HoverPreviewCardProps) {
    // 🟢 O selo NOVO some no primeiro hover e fica visto pra sempre.
    const [newSeen, setNewSeen] = useState(() => (isNew ? hasSeenNewBadge(type, id) : false));
    // O `pointer-events: none` do CSS só barra o mouse: o Enter/Espaço passa.
    // Sem esta guarda, abrir de novo durante a verificação disparava outra
    // (outra ida ao IndexedDB/TMDB pelo mesmo título).
    const open = () => {
        if (checking) return;
        onMoreInfo();
    };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); // Space must not scroll the grid
            open();
        }
    };
    return (
        <div
            className={checking ? 'hover-preview-card checking' : 'hover-preview-card'}
            role="button"
            tabIndex={0}
            aria-label={title}
            aria-busy={checking || undefined}
            onClick={open}
            onKeyDown={handleKeyDown}
            onMouseEnter={() => {
                if (isNew && !newSeen) {
                    markNewBadgeSeen(type, id);
                    setNewSeen(true);
                }
            }}
        >
            {/* Poster */}
            <div className="preview-poster" style={{ position: 'relative' }}>
                {isNew && !newSeen && <span className="preview-new-badge">NOVO</span>}
                {qualityBadge && !(isNew && !newSeen) && (
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

                {/* O card ABRE A FICHA — nunca reproduziu. O ▶ no hover
                    prometia play e entregava a ficha; agora o ícone diz o que
                    o clique faz. `aria-hidden` porque o alvo clicável é o card
                    inteiro, que já tem role e rótulo. */}
                <div className="card-overlay" aria-hidden="true">
                    <div className="info-icon">
                        <Info size={24} />
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
