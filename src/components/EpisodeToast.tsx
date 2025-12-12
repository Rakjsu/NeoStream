import { useState, useEffect, useCallback } from 'react';
import { X, Tv } from 'lucide-react';
import { episodeNotificationService, type EpisodeNotification } from '../services/episodeNotificationService';

interface EpisodeToastProps {
    onNavigateToSeries?: (seriesId: string) => void;
}

export function EpisodeToast({ onNavigateToSeries }: EpisodeToastProps) {
    const [toasts, setToasts] = useState<EpisodeNotification[]>([]);
    const [hasChecked, setHasChecked] = useState(false);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    useEffect(() => {
        // Only check once when component mounts
        if (hasChecked) return;
        setHasChecked(true);

        // Delay check to allow app to fully load
        const checkTimeout = setTimeout(async () => {
            console.log('[EpisodeToast] Starting check for new episodes...');
            const newNotifications = await episodeNotificationService.checkForNewEpisodes();

            if (newNotifications.length > 0) {
                // Show toasts for new notifications (max 3)
                setToasts(newNotifications.slice(0, 3));
            }
        }, 3000); // Wait 3 seconds after app starts

        return () => clearTimeout(checkTimeout);
    }, [hasChecked]);

    // Auto-dismiss toasts after 8 seconds
    useEffect(() => {
        if (toasts.length === 0) return;

        const timers = toasts.map(toast =>
            setTimeout(() => removeToast(toast.id), 8000)
        );

        return () => timers.forEach(timer => clearTimeout(timer));
    }, [toasts, removeToast]);

    if (toasts.length === 0) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            zIndex: 10000,
            pointerEvents: 'none'
        }}>
            <style>{`
                @keyframes slideInRight {
                    from { 
                        opacity: 0; 
                        transform: translateX(100px); 
                    }
                    to { 
                        opacity: 1; 
                        transform: translateX(0); 
                    }
                }
                @keyframes slideOutRight {
                    from { 
                        opacity: 1; 
                        transform: translateX(0); 
                    }
                    to { 
                        opacity: 0; 
                        transform: translateX(100px); 
                    }
                }
            `}</style>

            {toasts.map(toast => (
                <div
                    key={toast.id}
                    style={{
                        display: 'flex',
                        gap: 12,
                        padding: 16,
                        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                        borderRadius: 16,
                        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(168, 85, 247, 0.2)',
                        border: '1px solid rgba(168, 85, 247, 0.4)',
                        maxWidth: 380,
                        animation: 'slideInRight 0.3s ease',
                        pointerEvents: 'auto',
                        cursor: 'pointer'
                    }}
                    onClick={() => {
                        if (onNavigateToSeries) {
                            onNavigateToSeries(toast.seriesId);
                        }
                        removeToast(toast.id);
                    }}
                >
                    {/* Poster */}
                    <div style={{
                        width: 60,
                        height: 80,
                        borderRadius: 10,
                        overflow: 'hidden',
                        flexShrink: 0,
                        background: 'rgba(0,0,0,0.3)'
                    }}>
                        {toast.poster ? (
                            <img
                                src={toast.poster}
                                alt={toast.seriesName}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        ) : (
                            <div style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <Tv size={28} color="rgba(255,255,255,0.3)" />
                            </div>
                        )}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginBottom: 6
                        }}>
                            <span style={{
                                background: toast.type === 'new_season'
                                    ? 'linear-gradient(135deg, #10b981, #059669)'
                                    : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                color: 'white',
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: 4,
                                textTransform: 'uppercase'
                            }}>
                                {toast.type === 'new_season' ? '🎉 Nova Temporada' : '📺 Novos Episódios'}
                            </span>
                        </div>
                        <div style={{
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 600,
                            marginBottom: 4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}>
                            {toast.seriesName}
                        </div>
                        <div style={{
                            color: 'rgba(255,255,255,0.7)',
                            fontSize: 12
                        }}>
                            {toast.message}
                        </div>
                        <div style={{
                            color: '#a855f7',
                            fontSize: 11,
                            marginTop: 6,
                            fontWeight: 500
                        }}>
                            Clique para ver →
                        </div>
                    </div>

                    {/* Close Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            removeToast(toast.id);
                        }}
                        style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            background: 'rgba(0,0,0,0.3)',
                            border: 'none',
                            borderRadius: '50%',
                            width: 24,
                            height: 24,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            opacity: 0.7,
                            transition: 'opacity 0.2s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
                    >
                        <X size={14} color="white" />
                    </button>
                </div>
            ))}
        </div>
    );
}
