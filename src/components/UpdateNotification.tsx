import { useState, useEffect } from 'react';
import { updateService } from '../services/updateService';
import type { UpdateInfo, DownloadProgress } from '../types/update';

interface UpdateNotificationProps {
    // Optional: can be controlled externally
}

export function UpdateNotification({ }: UpdateNotificationProps) {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
    const [isDownloaded, setIsDownloaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Listen for update available
        const cleanupAvailable = updateService.onUpdateAvailable((info) => {
            console.log('Update available:', info);
            setUpdateInfo(info);
            setIsVisible(true);
            setError(null);
        });

        // Listen for download progress
        const cleanupProgress = updateService.onDownloadProgress((progress) => {
            setDownloadProgress(progress);
        });

        // Listen for update downloaded
        const cleanupDownloaded = updateService.onUpdateDownloaded((info) => {
            console.log('Update downloaded:', info);
            setIsDownloading(false);
            setIsDownloaded(true);
        });

        // Listen for errors
        const cleanupError = updateService.onUpdateError((err) => {
            console.error('Update error:', err);
            setError(err.message || 'Erro ao atualizar');
            setIsDownloading(false);
        });

        return () => {
            cleanupAvailable();
            cleanupProgress();
            cleanupDownloaded();
            cleanupError();
        };
    }, []);

    const handleDownload = async () => {
        setIsDownloading(true);
        setError(null);
        await updateService.downloadUpdate();
    };

    const handleInstall = async () => {
        await updateService.installUpdate();
    };

    const handleLater = () => {
        setIsVisible(false);
    };

    const handleSkip = async () => {
        if (updateInfo?.version) {
            await updateService.skipVersion(updateInfo.version);
        }
        setIsVisible(false);
    };

    if (!isVisible || !updateInfo) return null;

    return (
        <>
            <style>{notificationStyles}</style>

            {/* Backdrop */}
            <div className="update-backdrop" onClick={handleLater} />

            {/* Notification Modal */}
            <div className="update-notification">
                {/* Header */}
                <div className="update-header">
                    <div className="update-icon">🚀</div>
                    <div>
                        <h3>Nova Atualização Disponível!</h3>
                        <p className="version-info">
                            v{updateInfo.version}
                        </p>
                    </div>
                    <button className="close-btn" onClick={handleLater}>✕</button>
                </div>

                {/* Content */}
                <div className="update-content">
                    {error ? (
                        <div className="error-message">
                            <span>⚠️</span>
                            <span>{error}</span>
                        </div>
                    ) : isDownloading ? (
                        <div className="download-progress">
                            <div className="progress-text">
                                <span>Baixando atualização...</span>
                                <span>{downloadProgress?.percent?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="progress-bar">
                                <div
                                    className="progress-fill"
                                    style={{ width: `${downloadProgress?.percent || 0}%` }}
                                />
                            </div>
                            <div className="progress-details">
                                {downloadProgress?.transferred && downloadProgress?.total && (
                                    <span>
                                        {(downloadProgress.transferred / 1024 / 1024).toFixed(1)} MB /
                                        {(downloadProgress.total / 1024 / 1024).toFixed(1)} MB
                                    </span>
                                )}
                                {downloadProgress?.bytesPerSecond && (
                                    <span>
                                        {(downloadProgress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s
                                    </span>
                                )}
                            </div>
                        </div>
                    ) : isDownloaded ? (
                        <div className="download-complete">
                            <span className="success-icon">✓</span>
                            <span>Download concluído! Reinicie para instalar.</span>
                        </div>
                    ) : (
                        <p className="update-description">
                            Uma nova versão do NeoStream está disponível.
                            Atualize agora para obter as últimas melhorias e correções!
                        </p>
                    )}
                </div>

                {/* Actions */}
                <div className="update-actions">
                    {isDownloaded ? (
                        <button className="btn-primary" onClick={handleInstall}>
                            <span>🔄</span>
                            Reiniciar e Instalar
                        </button>
                    ) : isDownloading ? (
                        <button className="btn-secondary" disabled>
                            <span className="spinner" />
                            Baixando...
                        </button>
                    ) : (
                        <>
                            <button className="btn-primary" onClick={handleDownload}>
                                <span>📥</span>
                                Baixar Agora
                            </button>
                            <button className="btn-secondary" onClick={handleLater}>
                                <span>⏰</span>
                                Mais Tarde
                            </button>
                            <button className="btn-skip" onClick={handleSkip}>
                                Pular esta versão
                            </button>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

const notificationStyles = `
/* Update Notification Styles */
.update-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    z-index: 9998;
    animation: fadeIn 0.3s ease;
}

.update-notification {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 420px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 24px;
    padding: 24px;
    z-index: 9999;
    box-shadow: 
        0 25px 50px -12px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.05),
        0 0 60px rgba(168, 85, 247, 0.2);
    animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes slideUp {
    from { 
        opacity: 0;
        transform: translate(-50%, -40%);
    }
    to { 
        opacity: 1;
        transform: translate(-50%, -50%);
    }
}

.update-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
}

.update-icon {
    width: 56px;
    height: 56px;
    background: linear-gradient(135deg, #a855f7, #ec4899);
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.4);
}

.update-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: white;
}

.version-info {
    margin: 4px 0 0 0;
    font-size: 14px;
    color: #a855f7;
    font-weight: 600;
}

.close-btn {
    margin-left: auto;
    width: 32px;
    height: 32px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 16px;
    cursor: pointer;
    transition: all 0.2s;
}

.close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
}

.update-content {
    margin-bottom: 24px;
}

.update-description {
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    line-height: 1.6;
    margin: 0;
}

.download-progress {
    padding: 16px;
    background: rgba(168, 85, 247, 0.1);
    border-radius: 12px;
}

.progress-text {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
    color: white;
    font-size: 14px;
    font-weight: 500;
}

.progress-bar {
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #a855f7, #ec4899);
    border-radius: 4px;
    transition: width 0.3s ease;
}

.progress-details {
    display: flex;
    justify-content: space-between;
    margin-top: 10px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
}

.download-complete {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: rgba(16, 185, 129, 0.1);
    border-radius: 12px;
    color: #6ee7b7;
    font-size: 14px;
}

.success-icon {
    width: 28px;
    height: 28px;
    background: linear-gradient(135deg, #10b981, #059669);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: white;
}

.error-message {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 12px;
    color: #fca5a5;
    font-size: 14px;
}

.update-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.btn-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 14px 24px;
    background: linear-gradient(135deg, #a855f7, #ec4899);
    border: none;
    border-radius: 12px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.3);
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(168, 85, 247, 0.4);
}

.btn-secondary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 12px 24px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
}

.btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.btn-skip {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
    cursor: pointer;
    padding: 8px;
    transition: color 0.2s;
}

.btn-skip:hover {
    color: rgba(255, 255, 255, 0.7);
}

.spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
`;
