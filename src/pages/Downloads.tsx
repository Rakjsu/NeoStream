import { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, Play, FolderOpen, HardDrive, Film, Tv, AlertTriangle, X } from 'lucide-react';
import { downloadService } from '../services/downloadService';
import type { DownloadItem, StorageInfo } from '../services/downloadService';

export function Downloads() {
    const [downloads, setDownloads] = useState<DownloadItem[]>([]);
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

    const loadData = useCallback(async () => {
        setDownloads(downloadService.getDownloads());
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

    const handleOpenFolder = async () => {
        await downloadService.openDownloadsFolder();
    };

    const filteredDownloads = downloads.filter(item => {
        if (activeTab === 'all') return true;
        if (activeTab === 'movies') return item.type === 'movie';
        if (activeTab === 'series') return item.type === 'episode' || item.type === 'series';
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
                    {filteredDownloads.length === 0 ? (
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
                                <div key={item.id} className="download-card">
                                    <div className="download-cover">
                                        <img src={item.cover} alt={item.name} />
                                        <div className="download-overlay">
                                            <button className="play-btn">
                                                <Play size={24} fill="white" />
                                            </button>
                                        </div>
                                        <div className="download-type">
                                            {item.type === 'movie' ? '🎬' : '📺'}
                                        </div>
                                    </div>
                                    <div className="download-info">
                                        <h4>{item.name}</h4>
                                        {item.seriesName && (
                                            <p className="series-info">
                                                {item.seriesName} • S{item.season}E{item.episode}
                                            </p>
                                        )}
                                        <div className="download-meta">
                                            <span>{downloadService.formatBytes(item.size)}</span>
                                            <span>•</span>
                                            <span>{item.status === 'completed' ? '✓ Concluído' : `${item.progress}%`}</span>
                                        </div>
                                    </div>
                                    <button className="delete-btn" title="Remover download" onClick={() => handleDeleteClick(item)}>
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
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

/* Downloads Grid */
.downloads-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
}

.download-card {
    display: flex;
    gap: 16px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    transition: all 0.2s;
    animation: fadeIn 0.4s ease backwards;
}

.download-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.15);
}

.download-cover {
    position: relative;
    width: 80px;
    height: 120px;
    border-radius: 10px;
    overflow: hidden;
    flex-shrink: 0;
}

.download-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.download-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s;
}

.download-card:hover .download-overlay {
    opacity: 1;
}

.play-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: linear-gradient(135deg, #06b6d4, #0891b2);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.2s;
}

.play-btn:hover {
    transform: scale(1.1);
}

.download-type {
    position: absolute;
    top: 6px;
    right: 6px;
    font-size: 16px;
}

.download-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
}

.download-info h4 {
    font-size: 16px;
    font-weight: 600;
    color: white;
    margin: 0 0 4px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.series-info {
    font-size: 13px;
    color: #67e8f9;
    margin: 0 0 8px 0;
}

.download-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
}

.delete-btn {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #ef4444;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
    align-self: center;
}

.delete-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.4);
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
`;
