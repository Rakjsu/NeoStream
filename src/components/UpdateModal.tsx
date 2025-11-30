import { useState, useEffect } from 'react';
import { updateService } from '../services/updateService';
import type { UpdateInfo, DownloadProgress } from '../types/update';

interface UpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
    updateInfo: UpdateInfo | null;
}

export function UpdateModal({ isOpen, onClose, updateInfo }: UpdateModalProps) {
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState<DownloadProgress | null>(null);
    const [downloaded, setDownloaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Listen for download progress
        const unsubscribeProgress = updateService.onDownloadProgress((prog) => {
            setProgress(prog);
        });

        // Listen for download completion
        const unsubscribeDownloaded = updateService.onUpdateDownloaded(() => {
            setDownloading(false);
            setDownloaded(true);
        });

        // Listen for errors
        const unsubscribeError = updateService.onUpdateError((err) => {
            setError(err.message);
            setDownloading(false);
        });

        return () => {
            unsubscribeProgress();
            unsubscribeDownloaded();
            unsubscribeError();
        };
    }, []);

    const handleDownloadNow = async () => {
        if (downloading) return;

        setDownloading(true);
        setError(null);

        const result = await updateService.downloadUpdate();

        if (!result.success) {
            setError(result.error || 'Erro ao baixar atualização');
            setDownloading(false);
        }
    };

    const handleInstallAndRestart = async () => {
        await updateService.installUpdate();
    };

    const handleSkipVersion = async () => {
        if (updateInfo) {
            await updateService.skipVersion(updateInfo.version);
        }
        onClose();
    };

    if (!isOpen || !updateInfo) return null;

    const progressPercent = progress?.percent || 0;

    return (
        <>
            {/* Backdrop */}
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 9998,
                    animation: 'fadeIn 0.2s ease'
                }}
                onClick={onClose}
            />

            {/* Modal */}
            <div
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                    padding: '32px',
                    borderRadius: '16px',
                    maxWidth: '500px',
                    width: '90%',
                    maxHeight: '80vh',
                    overflowY: 'auto',
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    zIndex: 9999,
                    animation: 'slideUp 0.3s ease'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ marginBottom: '24px' }}>
                    <h2 style={{
                        fontSize: '28px',
                        fontWeight: '700',
                        marginBottom: '8px',
                        background: 'linear-gradient(135deg, #60a5fa 0%, #34d399 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <span>🎉</span>
                        Nova Atualização Disponível!
                    </h2>
                    <p style={{ color: '#94a3b8', fontSize: '14px' }}>
                        Uma nova versão do NeoStream IPTV está pronta para instalação
                    </p>
                </div>

                {/* Version Info */}
                <div style={{
                    display: 'flex',
                    gap: '16px',
                    marginBottom: '24px',
                    padding: '16px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                    <div style={{ flex: 1 }}>
                        <p style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>
                            Versão Atual
                        </p>
                        <p style={{ color: 'white', fontSize: '18px', fontWeight: '600' }}>
                            v{window.electron?.app?.getVersion() || '1.0.0'}
                        </p>
                    </div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        color: '#60a5fa'
                    }}>
                        →
                    </div>
                    <div style={{ flex: 1 }}>
                        <p style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>
                            Nova Versão
                        </p>
                        <p style={{
                            color: '#34d399',
                            fontSize: '18px',
                            fontWeight: '600'
                        }}>
                            v{updateInfo.version}
                        </p>
                    </div>
                </div>

                {/* Release Notes */}
                {updateInfo.releaseNotes && (
                    <div style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        padding: '16px',
                        borderRadius: '8px',
                        marginBottom: '24px',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                        <h3 style={{
                            fontSize: '16px',
                            fontWeight: '600',
                            marginBottom: '12px',
                            color: 'white'
                        }}>
                            📝 Novidades:
                        </h3>
                        <div
                            style={{ color: '#cbd5e1', fontSize: '14px', lineHeight: '1.6' }}
                            dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
                        />
                    </div>
                )}

                {/* Download Progress */}
                {downloading && progress && (
                    <div style={{ marginBottom: '24px' }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: '8px'
                        }}>
                            <span style={{ color: '#94a3b8', fontSize: '14px' }}>
                                Baixando atualização...
                            </span>
                            <span style={{ color: '#60a5fa', fontSize: '14px', fontWeight: '600' }}>
                                {Math.round(progressPercent)}%
                            </span>
                        </div>
                        <div style={{
                            background: 'rgba(255, 255, 255, 0.1)',
                            height: '8px',
                            borderRadius: '4px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                width: `${progressPercent}%`,
                                height: '100%',
                                background: 'linear-gradient(90deg, #3b82f6, #34d399)',
                                transition: 'width 0.3s ease',
                                borderRadius: '4px'
                            }} />
                        </div>
                        <p style={{
                            textAlign: 'center',
                            marginTop: '8px',
                            color: '#94a3b8',
                            fontSize: '12px'
                        }}>
                            {(progress.bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s
                        </p>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div style={{
                        padding: '12px 16px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        marginBottom: '24px'
                    }}>
                        <p style={{ color: '#ef4444', fontSize: '14px' }}>
                            ⚠️ {error}
                        </p>
                    </div>
                )}

                {/* Action Buttons */}
                <div style={{
                    display: 'flex',
                    gap: '12px',
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap'
                }}>
                    <button
                        onClick={handleSkipVersion}
                        disabled={downloading}
                        style={{
                            padding: '12px 20px',
                            background: 'transparent',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '14px',
                            cursor: downloading ? 'not-allowed' : 'pointer',
                            opacity: downloading ? 0.5 : 1,
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                            if (!downloading) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                        }}
                    >
                        Pular Esta Versão
                    </button>

                    <button
                        onClick={onClose}
                        disabled={downloading}
                        style={{
                            padding: '12px 20px',
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '14px',
                            cursor: downloading ? 'not-allowed' : 'pointer',
                            opacity: downloading ? 0.5 : 1,
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                            if (!downloading) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                    >
                        Depois
                    </button>

                    <button
                        onClick={downloaded ? handleInstallAndRestart : handleDownloadNow}
                        disabled={downloading && !downloaded}
                        style={{
                            padding: '12px 24px',
                            background: downloaded
                                ? 'linear-gradient(135deg, #34d399, #10b981)'
                                : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: (downloading && !downloaded) ? 'not-allowed' : 'pointer',
                            opacity: (downloading && !downloaded) ? 0.7 : 1,
                            transition: 'all 0.2s',
                            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                        }}
                        onMouseEnter={(e) => {
                            if (!downloading || downloaded) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 6px 16px rgba(59, 130, 246, 0.4)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
                        }}
                    >
                        {downloaded ? '🚀 Instalar e Reiniciar' : '⬇️ Baixar Agora'}
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -45%);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%);
                    }
                }
            `}</style>
        </>
    );
}
