import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { watchLaterService, type WatchLaterItem } from '../services/watchLater';

export function WatchLater() {
    const [items, setItems] = useState<WatchLaterItem[]>([]);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'all' | 'movies' | 'series'>('all');
    const navigate = useNavigate();

    useEffect(() => {
        loadItems();
    }, []);

    const loadItems = () => {
        setItems(watchLaterService.getAll());
    };

    const removeItem = useCallback((id: string, type: 'series' | 'movie') => {
        setRemovingId(`${type}-${id}`);
        setTimeout(() => {
            watchLaterService.remove(id, type);
            loadItems();
            setRemovingId(null);
        }, 300);
    }, []);

    const handleItemClick = (item: WatchLaterItem) => {
        if (item.type === 'series') {
            navigate('/dashboard/series', { state: { scrollToSeries: item.id } });
        } else {
            navigate('/dashboard/vod', { state: { scrollToMovie: item.id } });
        }
    };

    const clearAll = () => {
        items.forEach(item => {
            watchLaterService.remove(item.id, item.type);
        });
        loadItems();
    };

    const movies = items.filter(item => item.type === 'movie');
    const series = items.filter(item => item.type === 'series');

    const displayItems = activeTab === 'all' ? items :
        activeTab === 'movies' ? movies : series;

    // Empty State
    if (items.length === 0) {
        return (
            <>
                <style>{watchLaterStyles}</style>
                <div className="watchlater-page">
                    <div className="watchlater-backdrop" />
                    <div className="empty-state">
                        <div className="empty-icon-container">
                            <div className="empty-icon">🔖</div>
                            <div className="empty-icon-glow" />
                        </div>
                        <h2 className="empty-title">Sua lista está vazia</h2>
                        <p className="empty-text">
                            Adicione filmes e séries para assistir depois clicando no botão <strong>+ Minha Lista</strong>
                        </p>
                        <div className="empty-suggestions">
                            <button
                                className="suggestion-btn"
                                onClick={() => navigate('/dashboard/vod')}
                            >
                                <span>🎬</span>
                                <span>Explorar Filmes</span>
                            </button>
                            <button
                                className="suggestion-btn"
                                onClick={() => navigate('/dashboard/series')}
                            >
                                <span>📺</span>
                                <span>Explorar Séries</span>
                            </button>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <style>{watchLaterStyles}</style>
            <div className="watchlater-page">
                <div className="watchlater-backdrop" />

                {/* Header */}
                <header className="watchlater-header">
                    <div className="header-title">
                        <div className="title-icon">🔖</div>
                        <div>
                            <h1>Minha Lista</h1>
                            <p className="subtitle">{items.length} {items.length === 1 ? 'item salvo' : 'itens salvos'}</p>
                        </div>
                    </div>

                    <div className="header-actions">
                        {items.length > 0 && (
                            <button className="clear-all-btn" onClick={clearAll}>
                                <span>🗑️</span>
                                <span>Limpar Tudo</span>
                            </button>
                        )}
                    </div>
                </header>

                {/* Tabs */}
                <div className="tabs-container">
                    <button
                        className={`tab ${activeTab === 'all' ? 'active' : ''}`}
                        onClick={() => setActiveTab('all')}
                    >
                        <span className="tab-icon">📋</span>
                        <span>Todos</span>
                        <span className="tab-count">{items.length}</span>
                    </button>
                    <button
                        className={`tab ${activeTab === 'movies' ? 'active' : ''}`}
                        onClick={() => setActiveTab('movies')}
                    >
                        <span className="tab-icon">🎬</span>
                        <span>Filmes</span>
                        <span className="tab-count">{movies.length}</span>
                    </button>
                    <button
                        className={`tab ${activeTab === 'series' ? 'active' : ''}`}
                        onClick={() => setActiveTab('series')}
                    >
                        <span className="tab-icon">📺</span>
                        <span>Séries</span>
                        <span className="tab-count">{series.length}</span>
                    </button>
                </div>

                {/* Content Grid */}
                <div className="content-scroll">
                    {displayItems.length === 0 ? (
                        <div className="no-items-message">
                            <p>Nenhum {activeTab === 'movies' ? 'filme' : 'série'} salvo</p>
                        </div>
                    ) : (
                        <div className="items-grid">
                            {displayItems.map((item, index) => {
                                const isRemoving = removingId === `${item.type}-${item.id}`;
                                const coverUrl = item.cover?.startsWith('http') ? item.cover : `https://${item.cover}`;

                                return (
                                    <div
                                        key={`${item.type}-${item.id}`}
                                        className={`item-card ${isRemoving ? 'removing' : ''}`}
                                        style={{ animationDelay: `${index * 0.05}s` }}
                                    >
                                        {/* Remove Button */}
                                        <button
                                            className="remove-btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeItem(item.id, item.type);
                                            }}
                                            title="Remover da lista"
                                        >
                                            <span>✕</span>
                                        </button>

                                        {/* Type Badge */}
                                        <div className={`type-badge ${item.type}`}>
                                            {item.type === 'movie' ? '🎬' : '📺'}
                                        </div>

                                        {/* Poster */}
                                        <div
                                            className="card-poster"
                                            onClick={() => handleItemClick(item)}
                                        >
                                            {item.cover ? (
                                                <img
                                                    src={coverUrl}
                                                    alt={item.name}
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="poster-fallback">
                                                    <span>{item.type === 'movie' ? '🎬' : '📺'}</span>
                                                </div>
                                            )}

                                            {/* Overlay */}
                                            <div className="card-overlay">
                                                <div className="play-icon">▶</div>
                                            </div>
                                        </div>

                                        {/* Card Info */}
                                        <div
                                            className="card-info"
                                            onClick={() => handleItemClick(item)}
                                        >
                                            <h3 className="card-title">{item.name}</h3>
                                            <p className="card-type">
                                                {item.type === 'movie' ? 'Filme' : 'Série'}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

// CSS Styles
const watchLaterStyles = `
/* Page Container */
.watchlater-page {
    position: relative;
    min-height: 100vh;
    padding: 32px;
    overflow-x: hidden;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
}

/* Animated Backdrop */
.watchlater-backdrop {
    position: fixed;
    inset: 0;
    background: 
        radial-gradient(ellipse at 20% 20%, rgba(168, 85, 247, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 80%, rgba(236, 72, 153, 0.1) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 50%, rgba(59, 130, 246, 0.05) 0%, transparent 70%);
    pointer-events: none;
    z-index: 0;
    animation: backdropPulse 8s ease-in-out infinite;
}

@keyframes backdropPulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.8; }
}

/* Header */
.watchlater-header {
    position: relative;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 32px;
    animation: fadeInDown 0.5s ease;
}

@keyframes fadeInDown {
    from {
        opacity: 0;
        transform: translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.header-title {
    display: flex;
    align-items: center;
    gap: 20px;
}

.title-icon {
    font-size: 48px;
    animation: iconBounce 2s ease-in-out infinite;
}

@keyframes iconBounce {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    25% { transform: translateY(-5px) rotate(-5deg); }
    75% { transform: translateY(-5px) rotate(5deg); }
}

.header-title h1 {
    font-size: 42px;
    font-weight: 800;
    color: white;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #fff 0%, #c4b5fd 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.subtitle {
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    margin-top: 4px;
}

.header-actions {
    display: flex;
    gap: 12px;
}

.clear-all-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #f87171;
    font-size: 14px;
    font-weight: 600;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.clear-all-btn:hover {
    background: rgba(239, 68, 68, 0.25);
    border-color: rgba(239, 68, 68, 0.5);
    transform: translateY(-2px);
}

/* Tabs */
.tabs-container {
    position: relative;
    z-index: 10;
    display: flex;
    gap: 12px;
    margin-bottom: 32px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    animation: fadeIn 0.5s ease 0.1s backwards;
}

.tab {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 24px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    font-size: 15px;
    font-weight: 600;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.tab:hover {
    color: white;
    background: rgba(255, 255, 255, 0.05);
}

.tab.active {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(236, 72, 153, 0.2) 100%);
    color: white;
    border: 1px solid rgba(168, 85, 247, 0.3);
}

.tab-icon {
    font-size: 18px;
}

.tab-count {
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
}

.tab.active .tab-count {
    background: rgba(168, 85, 247, 0.4);
}

/* Content Scroll */
.content-scroll {
    position: relative;
    z-index: 10;
}

/* Items Grid */
.items-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 24px;
}

@media (max-width: 768px) {
    .items-grid {
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 16px;
    }
}

@media (max-width: 480px) {
    .items-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }
}

/* Item Card */
.item-card {
    position: relative;
    border-radius: 20px;
    overflow: hidden;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.03);
    border: 2px solid transparent;
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    animation: cardSlideIn 0.5s ease backwards;
}

@keyframes cardSlideIn {
    from {
        opacity: 0;
        transform: translateY(30px) scale(0.9);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.item-card:hover {
    transform: translateY(-10px) scale(1.02);
    border-color: rgba(168, 85, 247, 0.5);
    box-shadow: 
        0 25px 50px rgba(0, 0, 0, 0.4),
        0 0 50px rgba(168, 85, 247, 0.15);
}

.item-card.removing {
    animation: cardRemove 0.3s ease forwards;
}

@keyframes cardRemove {
    to {
        opacity: 0;
        transform: scale(0.8) translateY(-20px);
    }
}

/* Remove Button */
.remove-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 20;
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    border: none;
    border-radius: 50%;
    color: white;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0.8);
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
}

.item-card:hover .remove-btn {
    opacity: 1;
    transform: scale(1);
}

.remove-btn:hover {
    transform: scale(1.15) rotate(90deg);
    box-shadow: 0 6px 20px rgba(239, 68, 68, 0.6);
}

/* Type Badge */
.type-badge {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 15;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.type-badge.movie {
    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
}

.type-badge.series {
    background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%);
}

/* Card Poster */
.card-poster {
    position: relative;
    aspect-ratio: 2 / 3;
    overflow: hidden;
    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
}

.card-poster img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease;
}

.item-card:hover .card-poster img {
    transform: scale(1.1);
}

.poster-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1e1e3f 0%, #0f0f1a 100%);
    font-size: 56px;
}

/* Card Overlay */
.card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
        to top,
        rgba(0, 0, 0, 0.9) 0%,
        rgba(0, 0, 0, 0.3) 40%,
        transparent 70%
    );
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.item-card:hover .card-overlay {
    opacity: 1;
}

.play-icon {
    width: 70px;
    height: 70px;
    background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    color: white;
    transform: scale(0);
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 8px 30px rgba(168, 85, 247, 0.5);
}

.item-card:hover .play-icon {
    transform: scale(1);
}

/* Card Info */
.card-info {
    padding: 16px;
    background: linear-gradient(to top, rgba(15, 15, 26, 0.98), rgba(26, 26, 46, 0.9));
}

.card-title {
    font-size: 15px;
    font-weight: 600;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0 0 6px 0;
    transition: color 0.2s ease;
}

.item-card:hover .card-title {
    color: #c4b5fd;
}

.card-type {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

/* No Items Message */
.no-items-message {
    text-align: center;
    padding: 60px 20px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 16px;
}

/* Empty State */
.empty-state {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 80vh;
    text-align: center;
    animation: fadeIn 0.6s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.empty-icon-container {
    position: relative;
    margin-bottom: 32px;
}

.empty-icon {
    font-size: 100px;
    animation: floatIcon 3s ease-in-out infinite;
}

@keyframes floatIcon {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-15px); }
}

.empty-icon-glow {
    position: absolute;
    bottom: -20px;
    left: 50%;
    transform: translateX(-50%);
    width: 80px;
    height: 20px;
    background: radial-gradient(ellipse, rgba(168, 85, 247, 0.4) 0%, transparent 70%);
    border-radius: 50%;
    animation: glowPulse 3s ease-in-out infinite;
}

@keyframes glowPulse {
    0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(1); }
    50% { opacity: 1; transform: translateX(-50%) scale(1.2); }
}

.empty-title {
    font-size: 32px;
    font-weight: 700;
    color: white;
    margin-bottom: 12px;
}

.empty-text {
    color: rgba(255, 255, 255, 0.6);
    font-size: 16px;
    max-width: 400px;
    line-height: 1.6;
    margin-bottom: 32px;
}

.empty-text strong {
    color: #c4b5fd;
}

.empty-suggestions {
    display: flex;
    gap: 16px;
}

.suggestion-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 28px;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(236, 72, 153, 0.15) 100%);
    border: 1px solid rgba(168, 85, 247, 0.3);
    color: white;
    font-size: 15px;
    font-weight: 600;
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.suggestion-btn:hover {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(236, 72, 153, 0.25) 100%);
    border-color: rgba(168, 85, 247, 0.5);
    transform: translateY(-3px);
    box-shadow: 0 10px 30px rgba(168, 85, 247, 0.2);
}

.suggestion-btn span:first-child {
    font-size: 20px;
}

/* Responsive */
@media (max-width: 600px) {
    .watchlater-page {
        padding: 20px;
    }

    .watchlater-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 16px;
    }

    .header-title h1 {
        font-size: 32px;
    }

    .title-icon {
        font-size: 36px;
    }

    .tabs-container {
        width: 100%;
        overflow-x: auto;
        padding: 6px;
    }

    .tab {
        padding: 12px 16px;
        font-size: 14px;
        white-space: nowrap;
    }

    .empty-suggestions {
        flex-direction: column;
        width: 100%;
    }

    .suggestion-btn {
        justify-content: center;
    }
}
`;
