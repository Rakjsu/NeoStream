import { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, Play, FolderOpen, HardDrive, Film, Tv, AlertTriangle, X, RefreshCw } from 'lucide-react';
import { downloadService } from '../services/downloadService';
import type { DownloadItem, StorageInfo } from '../services/downloadService';

// Type for grouped series
type SeriesGroup = {
    seriesName: string;
    seriesId?: string;
    cover: string;
    localCover?: string;
    plot?: string;
    rating?: string;
    year?: string;
    genres?: string[];
    seasons: {
        season: number;
        episodes: DownloadItem[]
    }[]
};

export function Downloads() {
    const [downloads, setDownloads] = useState<DownloadItem[]>([]);
    const [groupedData, setGroupedData] = useState<{ movies: DownloadItem[]; series: SeriesGroup[] }>({ movies: [], series: [] });
    const [activeTab, setActiveTab] = useState<'all' | 'movies' | 'series'>('all');
    const [storageInfo, setStorageInfo] = useState<StorageInfo>({
        used: 0,
        total: 100 * 1024 * 1024 * 1024,
        available: 100 * 1024 * 1024 * 1024,
        downloadsPath: ''
    });

    // Delete confirmation modal state
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; item: DownloadItem | null }>({
        isOpen: false,
        item: null
    });

    // Series detail modal state
    const [seriesModal, setSeriesModal] = useState<{ isOpen: boolean; series: SeriesGroup | null; selectedSeason: number; selectedEpisode: number }>({
        isOpen: false,
        series: null,
        selectedSeason: 1,
        selectedEpisode: 1
    });

    const loadData = useCallback(async () => {
        setDownloads(downloadService.getDownloads());
        setGroupedData(downloadService.getDownloadsGrouped());
        const storage = await downloadService.getStorageInfo();
        setStorageInfo(storage);
    }, []);

    useEffect(() => {
        loadData();

        // Subscribe to download events
        const handleUpdate = () => loadData();
        downloadService.on('added', handleUpdate);
        downloadService.on('progress', handleUpdate);
        downloadService.on('completed', handleUpdate);
        downloadService.on('deleted', handleUpdate);
        downloadService.on('cancelled', handleUpdate);

        return () => {
            downloadService.off('added', handleUpdate);
            downloadService.off('progress', handleUpdate);
            downloadService.off('completed', handleUpdate);
            downloadService.off('deleted', handleUpdate);
            downloadService.off('cancelled', handleUpdate);
        };
    }, [loadData]);

    const handleDeleteClick = (item: DownloadItem) => {
        setDeleteModal({ isOpen: true, item });
    };

    const handleDeleteConfirm = async () => {
        if (deleteModal.item) {
            await downloadService.deleteDownload(deleteModal.item.id);
        }
        setDeleteModal({ isOpen: false, item: null });
    };

    const handleDeleteCancel = () => {
        setDeleteModal({ isOpen: false, item: null });
    };

    const handleCardClick = (item: DownloadItem) => {
        if (item.status !== 'completed' || !item.filePath) return; // Only play completed downloads with file

        // Convert file path to file:// URL
        const fileUrl = `file:///${item.filePath.replace(/\\/g, '/')}`;

        // Navigate to player with offline file path
        if (item.type === 'movie') {
            window.location.hash = `#/dashboard/vod?play=${encodeURIComponent(item.name)}&offline=${encodeURIComponent(fileUrl)}`;
        } else if (item.type === 'episode') {
            window.location.hash = `#/dashboard/series?series=${encodeURIComponent(item.seriesName || '')}&season=${item.season}&episode=${item.episode}&offline=${encodeURIComponent(fileUrl)}`;
        }
    };

    const handleSeriesClick = (series: SeriesGroup) => {
        // Open series modal with first available season and episode
        const firstSeason = series.seasons[0]?.season || 1;
        const firstEpisode = series.seasons[0]?.episodes[0]?.episode || 1;
        setSeriesModal({
            isOpen: true,
            series,
            selectedSeason: firstSeason,
            selectedEpisode: firstEpisode
        });
    };

    const handlePlayOfflineEpisode = (episode: DownloadItem) => {
        if (!episode.filePath) return;
        const fileUrl = `file:///${episode.filePath.replace(/\\/g, '/')}`;
        window.location.hash = `#/dashboard/series?series=${encodeURIComponent(episode.seriesName || '')}&season=${episode.season}&episode=${episode.episode}&offline=${encodeURIComponent(fileUrl)}`;
        setSeriesModal({ isOpen: false, series: null, selectedSeason: 1, selectedEpisode: 1 });
    };

    const handleOpenFolder = async () => {
        await downloadService.openDownloadsFolder();
    };

    const handleResumeDownload = async (item: DownloadItem) => {
        // Try to resume or restart the download
        await downloadService.resumeDownload(item.id);
    };


    // Filter downloads - episodes are shown grouped, so exclude them here
    const filteredDownloads = downloads.filter(item => {
        // Episodes are grouped separately, exclude from main grid
        if (item.type === 'episode') return false;
        if (activeTab === 'all') return true;
        if (activeTab === 'movies') return item.type === 'movie';
        return true;
    });

    const storagePercent = storageInfo.total > 0
        ? Math.round((storageInfo.used / storageInfo.total) * 100)
        : 0;

    return (
        <>
            <style>{downloadsStyles}</style>
            <div className="downloads-page">
                <div className="downloads-backdrop" />

                {/* Delete Confirmation Modal */}
                {deleteModal.isOpen && deleteModal.item && (
                    <>
                        <div className="delete-modal-overlay" onClick={handleDeleteCancel} />
                        <div className="delete-modal">
                            <button className="delete-modal-close" onClick={handleDeleteCancel}>
                                <X size={20} />
                            </button>
                            <div className="delete-modal-icon">
                                <AlertTriangle size={48} />
                            </div>
                            <h3>Remover Download?</h3>
                            <p>
                                Tem certeza que deseja remover <strong>"{deleteModal.item.name}"</strong>?
                                O arquivo será excluído permanentemente.
                            </p>
                            <div className="delete-modal-size">
                                📦 {downloadService.formatBytes(deleteModal.item.size)}
                            </div>
                            <div className="delete-modal-buttons">
                                <button className="cancel-btn" onClick={handleDeleteCancel}>
                                    Cancelar
                                </button>
                                <button className="confirm-btn" onClick={handleDeleteConfirm}>
                                    <Trash2 size={18} />
                                    Remover
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {/* Header */}
                <header className="downloads-header">
                    <div className="header-icon">📥</div>
                    <div>
                        <h1>Baixados</h1>
                        <p className="subtitle">Conteúdo disponível offline</p>
                    </div>
                </header>

                {/* Storage Info */}
                <div className="storage-card">
                    <div className="storage-icon">
                        <HardDrive size={24} />
                    </div>
                    <div className="storage-info">
                        <div className="storage-text">
                            <span>Armazenamento usado</span>
                            <span className="storage-value">
                                {downloadService.formatBytes(storageInfo.used)} / {downloadService.formatBytes(storageInfo.total)}
                            </span>
                        </div>
                        <div className="storage-bar">
                            <div className="storage-fill" style={{ width: `${storagePercent}%` }} />
                        </div>
                    </div>
                    <button className="storage-btn" onClick={handleOpenFolder}>
                        <FolderOpen size={18} />
                        Abrir Pasta
                    </button>
                </div>

                {/* Tabs */}
                <div className="downloads-tabs">
                    <button
                        className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                        onClick={() => setActiveTab('all')}
                    >
                        <Download size={18} />
                        Todos
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'movies' ? 'active' : ''}`}
                        onClick={() => setActiveTab('movies')}
                    >
                        <Film size={18} />
                        Filmes
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'series' ? 'active' : ''}`}
                        onClick={() => setActiveTab('series')}
                    >
                        <Tv size={18} />
                        Séries
                    </button>
                </div>

                {/* Content */}
                <div className="downloads-content">
                    {filteredDownloads.length === 0 && groupedData.series.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-icon">📥</div>
                            <h3>Nenhum download</h3>
                            <p>Baixe filmes e séries para assistir offline</p>
                            <div className="empty-hint">
                                <span>💡</span>
                                <span>Clique no ícone de download em qualquer filme ou série</span>
                            </div>
                        </div>
                    ) : (
                        <div className="downloads-grid">
                            {filteredDownloads.map((item) => (
                                <div
                                    key={item.id}
                                    className={`download-card ${item.status === 'completed' ? 'clickable' : ''}`}
                                    onClick={() => handleCardClick(item)}
                                >
                                    {/* Cover/Poster */}
                                    <div className="card-poster">
                                        <img
                                            src={item.cover}
                                            alt={item.name}
                                            onError={(e) => {
                                                const target = e.target as HTMLImageElement;
                                                target.src = 'https://via.placeholder.com/150x225?text=No+Image';
                                            }}
                                        />
                                        {/* Progress bar on poster for incomplete downloads */}
                                        {item.status !== 'completed' && item.progress > 0 && (
                                            <div className="poster-progress">
                                                <div
                                                    className="poster-progress-fill"
                                                    style={{ width: `${item.progress}%` }}
                                                />
                                            </div>
                                        )}
                                        {/* Type badge - top left */}
                                        <div className="type-badge">
                                            {item.type === 'movie' ? '🎬' : '📺'}
                                        </div>
                                        {/* Delete button - top right (always visible on hover) */}
                                        <button
                                            className="delete-btn-corner"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteClick(item);
                                            }}
                                            title="Remover download"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        {/* Status badge - bottom right */}
                                        {item.status === 'completed' && (
                                            <div className="status-badge completed">✓ Baixado</div>
                                        )}
                                        {item.status === 'downloading' && (
                                            <div className="status-badge downloading">{item.progress}%</div>
                                        )}
                                        {(item.status === 'paused' || item.status === 'failed') && (
                                            <div className="status-badge paused">⏸ Pausado</div>
                                        )}
                                        {/* Hover overlay - show play for completed, resume for paused */}
                                        <div className="card-overlay">
                                            {item.status === 'completed' ? (
                                                <button
                                                    className="play-btn-center"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCardClick(item);
                                                    }}
                                                >
                                                    <Play size={28} fill="white" />
                                                </button>
                                            ) : (item.status === 'paused' || item.status === 'failed') && (
                                                <button
                                                    className="resume-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleResumeDownload(item);
                                                    }}
                                                    title="Continuar download"
                                                >
                                                    <RefreshCw size={24} />
                                                    <span>Continuar</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {/* Info */}
                                    <div className="card-info">
                                        <h4 className="card-title">{item.name}</h4>
                                        <p className="card-size">{downloadService.formatBytes(item.size)}</p>
                                    </div>
                                </div>
                            ))}

                            {/* Grouped Series Cards */}
                            {(activeTab === 'all' || activeTab === 'series') && groupedData.series.map((series) => (
                                <div
                                    key={series.seriesName}
                                    className="download-card clickable"
                                    onClick={() => handleSeriesClick(series)}
                                >
                                    <div className="card-poster">
                                        <img
                                            src={series.cover}
                                            alt={series.seriesName}
                                        />
                                        <div className="type-badge">📺</div>
                                        {/* Delete button */}
                                        <button
                                            className="delete-btn-corner"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // Delete all episodes from this series
                                                series.seasons.forEach(s => {
                                                    s.episodes.forEach(ep => {
                                                        downloadService.deleteDownload(ep.id);
                                                    });
                                                });
                                            }}
                                            title="Remover série"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        {/* Season count badge - like normal series */}
                                        <div style={{
                                            position: 'absolute',
                                            top: 8,
                                            left: 40,
                                            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.9), rgba(5, 150, 105, 0.9))',
                                            padding: '4px 8px',
                                            borderRadius: 6,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: 'white'
                                        }}>
                                            {series.seasons.length} Temp
                                        </div>
                                        <div className="status-badge completed">✓ Baixado</div>
                                        <div className="card-overlay">
                                            <button className="play-btn-center">
                                                <Play size={28} fill="white" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="card-info">
                                        <h4 className="card-title">{series.seriesName}</h4>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Series Detail Modal */}
            {seriesModal.isOpen && seriesModal.series && (
                <>
                    <div className="delete-modal-overlay" onClick={() => setSeriesModal({ isOpen: false, series: null, selectedSeason: 1, selectedEpisode: 1 })} />
                    <div style={{
                        position: 'fixed',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '90%',
                        maxWidth: 800,
                        maxHeight: '85vh',
                        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                        borderRadius: 20,
                        overflow: 'hidden',
                        display: 'flex',
                        zIndex: 1001,
                        boxShadow: '0 25px 80px rgba(0, 0, 0, 0.6)',
                        border: '1px solid rgba(168, 85, 247, 0.3)'
                    }}>
                        {/* Poster */}
                        <div style={{ width: 260, minWidth: 260, position: 'relative' }}>
                            <img
                                src={seriesModal.series.cover}
                                alt={seriesModal.series.seriesName}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 60%, rgba(26, 26, 46, 1) 100%)' }} />
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
                            <button
                                onClick={() => setSeriesModal({ isOpen: false, series: null, selectedSeason: 1, selectedEpisode: 1 })}
                                style={{
                                    position: 'absolute', top: 16, right: 16, width: 36, height: 36,
                                    borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none',
                                    color: 'white', fontSize: 18, cursor: 'pointer', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center'
                                }}
                            >
                                ✕
                            </button>

                            <h2 style={{ color: 'white', fontSize: 24, marginBottom: 8 }}>{seriesModal.series.seriesName}</h2>

                            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                                {seriesModal.series.year && <span style={{ background: 'rgba(168,85,247,0.3)', padding: '4px 10px', borderRadius: 6, color: '#c4b5fd', fontSize: 12 }}>{seriesModal.series.year}</span>}
                                {seriesModal.series.rating && <span style={{ background: 'rgba(251,191,36,0.3)', padding: '4px 10px', borderRadius: 6, color: '#fcd34d', fontSize: 12 }}>⭐ {seriesModal.series.rating}</span>}
                                <span style={{ background: 'rgba(16,185,129,0.3)', padding: '4px 10px', borderRadius: 6, color: '#6ee7b7', fontSize: 12 }}>📥 Offline</span>
                            </div>

                            {seriesModal.series.plot && (
                                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
                                    {seriesModal.series.plot.slice(0, 200)}{seriesModal.series.plot.length > 200 ? '...' : ''}
                                </p>
                            )}

                            {/* Season Tabs - Style matching ContentDetailModal */}
                            <div style={{
                                display: 'flex',
                                gap: 8,
                                marginBottom: 12,
                                flexWrap: 'wrap'
                            }}>
                                {seriesModal.series.seasons.map(s => (
                                    <button
                                        key={s.season}
                                        onClick={() => setSeriesModal(prev => ({ ...prev, selectedSeason: s.season, selectedEpisode: 1 }))}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: 20,
                                            border: seriesModal.selectedSeason === s.season
                                                ? '2px solid #10b981'
                                                : '2px solid rgba(255, 255, 255, 0.1)',
                                            background: seriesModal.selectedSeason === s.season
                                                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(5, 150, 105, 0.2))'
                                                : 'rgba(255, 255, 255, 0.05)',
                                            color: 'white',
                                            fontSize: 13,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        T{s.season}
                                    </button>
                                ))}
                            </div>

                            {/* Episodes List - Style matching ContentDetailModal */}
                            <div style={{
                                maxHeight: 180,
                                overflowY: 'auto',
                                background: 'rgba(0, 0, 0, 0.2)',
                                borderRadius: 12,
                                padding: 8
                            }}>
                                {seriesModal.series.seasons
                                    .find(s => s.season === seriesModal.selectedSeason)?.episodes
                                    .map(ep => {
                                        const isCompleted = ep.status === 'completed';
                                        return (
                                            <div
                                                key={ep.id}
                                                onClick={() => isCompleted && handlePlayOfflineEpisode(ep)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 12,
                                                    padding: '10px 14px',
                                                    borderRadius: 10,
                                                    cursor: isCompleted ? 'pointer' : 'default',
                                                    background: isCompleted
                                                        ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.15))'
                                                        : 'transparent',
                                                    border: isCompleted ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid transparent',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                <span style={{
                                                    width: 32,
                                                    height: 32,
                                                    borderRadius: 8,
                                                    background: isCompleted
                                                        ? 'linear-gradient(135deg, #10b981, #059669)'
                                                        : 'rgba(168, 85, 247, 0.3)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                    color: 'white'
                                                }}>
                                                    {isCompleted ? '✓' : ep.progress + '%'}
                                                </span>
                                                <span style={{
                                                    fontSize: 13,
                                                    color: 'white',
                                                    flex: 1,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    Episódio {ep.episode}
                                                </span>
                                                {isCompleted && (
                                                    <span style={{
                                                        width: 24,
                                                        height: 24,
                                                        borderRadius: '50%',
                                                        background: 'linear-gradient(135deg, #10b981, #059669)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: 10,
                                                        color: 'white'
                                                    }}>
                                                        ▶
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

const downloadsStyles = `
.downloads-page {
    position: relative;
    min-height: 100vh;
    padding: 32px;
    overflow-x: hidden;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
}

.downloads-backdrop {
    position: fixed;
    inset: 0;
    background: 
        radial-gradient(ellipse at 30% 30%, rgba(6, 182, 212, 0.1) 0%, transparent 50%),
        radial-gradient(ellipse at 70% 70%, rgba(168, 85, 247, 0.08) 0%, transparent 50%);
    pointer-events: none;
    z-index: 0;
}

.downloads-header {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 32px;
    animation: fadeInDown 0.5s ease;
}

@keyframes fadeInDown {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
}

.header-icon {
    font-size: 48px;
}

.downloads-header h1 {
    font-size: 42px;
    font-weight: 800;
    color: white;
    background: linear-gradient(135deg, #fff 0%, #67e8f9 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin: 0;
}

.subtitle {
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    margin-top: 4px;
}

/* Storage Card */
.storage-card {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 20px 24px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 24px;
    animation: fadeIn 0.5s ease 0.1s backwards;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.storage-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.1));
    display: flex;
    align-items: center;
    justify-content: center;
    color: #06b6d4;
}

.storage-info {
    flex: 1;
}

.storage-text {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.7);
}

.storage-value {
    color: white;
    font-weight: 600;
}

.storage-bar {
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
}

.storage-fill {
    height: 100%;
    background: linear-gradient(90deg, #06b6d4, #0891b2);
    border-radius: 4px;
    transition: width 0.3s ease;
}

.storage-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.storage-btn:hover {
    background: rgba(255, 255, 255, 0.1);
}

/* Tabs */
.downloads-tabs {
    position: relative;
    z-index: 10;
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
    animation: fadeIn 0.5s ease 0.2s backwards;
}

.tab-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.tab-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
}

.tab-btn.active {
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.1));
    border-color: rgba(6, 182, 212, 0.3);
    color: #67e8f9;
}

/* Content */
.downloads-content {
    position: relative;
    z-index: 10;
}

/* Empty State */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 20px;
    text-align: center;
    animation: fadeIn 0.5s ease 0.3s backwards;
}

.empty-icon {
    font-size: 80px;
    margin-bottom: 24px;
    opacity: 0.5;
}

.empty-state h3 {
    font-size: 24px;
    font-weight: 700;
    color: white;
    margin: 0 0 8px 0;
}

.empty-state p {
    font-size: 16px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 24px 0;
}

.empty-hint {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 24px;
    background: rgba(6, 182, 212, 0.1);
    border: 1px solid rgba(6, 182, 212, 0.2);
    border-radius: 12px;
    color: #67e8f9;
    font-size: 14px;
}

/* Downloads Grid - Same style as VOD/Series */
.downloads-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
    padding-bottom: 32px;
}

@media (max-width: 768px) {
    .downloads-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 16px;
    }
}

/* Download Card - Vertical style like VOD */
.download-card {
    position: relative;
    border-radius: 16px;
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
        transform: translateY(20px) scale(0.95);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.download-card:hover {
    transform: translateY(-8px) scale(1.03);
    border-color: rgba(6, 182, 212, 0.4);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4),
                0 0 40px rgba(6, 182, 212, 0.15);
}

.download-card.clickable {
    cursor: pointer;
}

.download-card:not(.clickable) {
    cursor: default;
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
    transition: transform 0.4s ease;
}

.download-card:hover .card-poster img {
    transform: scale(1.08);
}

/* Type Badge */
.type-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    width: 32px;
    height: 32px;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    z-index: 5;
}

/* Status Badge - bottom left */
.status-badge {
    position: absolute;
    bottom: 10px;
    left: 10px;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    z-index: 5;
}

.status-badge.completed {
    background: rgba(16, 185, 129, 0.9);
    color: white;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
}

.status-badge.downloading {
    background: rgba(6, 182, 212, 0.9);
    color: white;
    animation: pulse 1.5s infinite;
}

.status-badge.paused {
    background: rgba(251, 191, 36, 0.9);
    color: white;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

/* Progress on Poster - only for incomplete downloads */
.poster-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 6px;
    background: rgba(0, 0, 0, 0.6);
    z-index: 5;
}

.poster-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #06b6d4, #0891b2);
    transition: width 0.3s ease;
    position: relative;
}

.poster-progress-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
    animation: progressShimmer 1.5s infinite;
}

/* Card Overlay - simplified */
.card-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.download-card:hover .card-overlay {
    opacity: 1;
}

/* Play Button Center */
.play-btn-center {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: linear-gradient(135deg, #06b6d4, #0891b2);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transform: scale(0);
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 8px 24px rgba(6, 182, 212, 0.5);
}

.download-card:hover .play-btn-center {
    transform: scale(1);
}

.play-btn-center:hover {
    transform: scale(1.15) !important;
    box-shadow: 0 12px 32px rgba(6, 182, 212, 0.6);
}

/* Resume Button for paused downloads */
.resume-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px 24px;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    border: none;
    border-radius: 16px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transform: scale(0);
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 8px 24px rgba(245, 158, 11, 0.4);
}

.download-card:hover .resume-btn {
    transform: scale(1);
}

.resume-btn:hover {
    transform: scale(1.05) !important;
    box-shadow: 0 12px 32px rgba(245, 158, 11, 0.6);
}

/* Delete Button Corner - bottom right */
.delete-btn-corner {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    background: rgba(239, 68, 68, 0.9);
    border: none;
    border-radius: 8px;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transform: scale(0.8);
    transition: all 0.2s ease;
    z-index: 10;
}

.download-card:hover .delete-btn-corner {
    opacity: 1;
    transform: scale(1);
}

.delete-btn-corner:hover {
    background: #ef4444;
    transform: scale(1.1) !important;
}

/* Card Info - clean, no extra lines */
.card-info {
    padding: 12px;
    background: rgba(15, 15, 26, 0.9);
}

.card-title {
    font-size: 14px;
    font-weight: 600;
    color: white;
    margin: 0 0 4px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.2s ease;
}

.download-card:hover .card-title {
    color: #67e8f9;
}

.card-series {
    font-size: 12px;
    color: #67e8f9;
    margin: 0 0 4px 0;
}

.card-size {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
}

/* Delete Confirmation Modal */
.delete-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(8px);
    z-index: 1000;
    animation: fadeIn 0.2s ease;
}

.delete-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 420px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 20px;
    padding: 32px;
    z-index: 1001;
    text-align: center;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5), 0 0 60px rgba(239, 68, 68, 0.1);
    animation: modalSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modalSlideIn {
    from { opacity: 0; transform: translate(-50%, -40%); }
    to { opacity: 1; transform: translate(-50%, -50%); }
}

.delete-modal-close {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 32px;
    height: 32px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.delete-modal-close:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
}

.delete-modal-icon {
    width: 80px;
    height: 80px;
    margin: 0 auto 20px;
    background: rgba(239, 68, 68, 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ef4444;
    animation: iconPulse 0.5s ease;
}

@keyframes iconPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
}

.delete-modal h3 {
    font-size: 22px;
    font-weight: 700;
    color: white;
    margin: 0 0 12px 0;
}

.delete-modal p {
    font-size: 15px;
    color: rgba(255, 255, 255, 0.7);
    margin: 0 0 16px 0;
    line-height: 1.5;
}

.delete-modal p strong {
    color: #ef4444;
}

.delete-modal-size {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
    margin-bottom: 24px;
}

.delete-modal-buttons {
    display: flex;
    gap: 12px;
}

.delete-modal-buttons .cancel-btn {
    flex: 1;
    padding: 14px 24px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.delete-modal-buttons .cancel-btn:hover {
    background: rgba(255, 255, 255, 0.15);
}

.delete-modal-buttons .confirm-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 24px;
    background: linear-gradient(135deg, #ef4444, #dc2626);
    border: none;
    border-radius: 12px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
}

.delete-modal-buttons .confirm-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(239, 68, 68, 0.4);
}

/* Download Progress Bar */
.download-progress-bar {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 10px;
}

.download-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #06b6d4, #0891b2);
    border-radius: 3px;
    transition: width 0.3s ease;
    position: relative;
}

.download-progress-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.3) 50%,
        transparent 100%
    );
    animation: progressShimmer 1.5s infinite;
}

@keyframes progressShimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}
`;
