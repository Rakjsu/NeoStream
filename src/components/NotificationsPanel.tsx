import { useState, useEffect } from 'react';
import { Bell, X, Check, CheckCheck, ExternalLink, Download, Tv, Film, AlertCircle } from 'lucide-react';
import { appNotificationService, type AppNotification } from '../services/episodeNotificationService';
import { useLanguage } from '../services/languageService';

interface NotificationsPanelProps {
    onNavigateToSeries?: (seriesId: string) => void;
    onNavigateToDownloads?: () => void;
}

export function NotificationsPanel({ onNavigateToSeries, onNavigateToDownloads }: NotificationsPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
    const { t } = useLanguage();

    useEffect(() => {
        // Initial load
        setNotifications(appNotificationService.getNotifications());
        setUnreadCount(appNotificationService.getUnreadCount());

        // Subscribe to changes
        const unsubscribe = appNotificationService.subscribe((newNotifications) => {
            setNotifications(newNotifications);
            setUnreadCount(newNotifications.filter(n => !n.read).length);
        });

        return unsubscribe;
    }, []);

    const handleMarkAsRead = (id: string) => {
        appNotificationService.deleteNotification(id);
        setNotifications(appNotificationService.getNotifications());
        setUnreadCount(appNotificationService.getUnreadCount());
    };

    const handleMarkAllAsRead = () => {
        appNotificationService.clearAll();
        setNotifications([]);
        setUnreadCount(0);
    };

    const handleClearAll = () => {
        appNotificationService.clearAll();
        setNotifications([]);
        setUnreadCount(0);
    };

    const handleNotificationClick = (notification: AppNotification) => {
        handleMarkAsRead(notification.id);

        // Navigate based on notification type
        if (notification.type === 'new_season' || notification.type === 'new_episodes') {
            if (onNavigateToSeries && notification.meta?.seriesId) {
                onNavigateToSeries(notification.meta.seriesId);
                setIsOpen(false);
            }
        } else if (notification.type.startsWith('download_')) {
            if (onNavigateToDownloads) {
                onNavigateToDownloads();
                setIsOpen(false);
            }
        }
    };

    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        const ago = t('notifications', 'ago');
        if (diffMins < 1) return t('notifications', 'now');
        if (diffMins < 60) return `${diffMins}m ${ago}`;
        if (diffHours < 24) return `${diffHours}h ${ago}`;
        return `${diffDays}d ${ago}`;
    };

    const getNotificationIcon = (type: AppNotification['type']) => {
        switch (type) {
            case 'new_season':
            case 'new_episodes':
                return <Tv size={16} color="#a855f7" />;
            case 'download_complete':
                return <Download size={16} color="#10b981" />;
            case 'download_failed':
                return <AlertCircle size={16} color="#ef4444" />;
            case 'download_started':
                return <Download size={16} color="#3b82f6" />;
            default:
                return <Bell size={16} />;
        }
    };

    const getNotificationColor = (type: AppNotification['type']) => {
        switch (type) {
            case 'new_season':
                return { bg: 'rgba(16, 185, 129, 0.3)', text: '#6ee7b7' };
            case 'new_episodes':
                return { bg: 'rgba(59, 130, 246, 0.3)', text: '#93c5fd' };
            case 'download_complete':
                return { bg: 'rgba(16, 185, 129, 0.3)', text: '#6ee7b7' };
            case 'download_failed':
                return { bg: 'rgba(239, 68, 68, 0.3)', text: '#fca5a5' };
            case 'download_started':
                return { bg: 'rgba(59, 130, 246, 0.3)', text: '#93c5fd' };
            default:
                return { bg: 'rgba(168, 85, 247, 0.3)', text: '#c4b5fd' };
        }
    };

    const getTypeLabel = (type: AppNotification['type']) => {
        switch (type) {
            case 'new_season': return t('notifications', 'newSeason');
            case 'new_episodes': return t('notifications', 'newEpisodes');
            case 'download_complete': return t('notifications', 'downloadComplete');
            case 'download_failed': return t('notifications', 'downloadFailed');
            case 'download_started': return t('notifications', 'downloadStarted');
            default: return t('notifications', 'notification');
        }
    };

    // Fix poster URL - handle relative paths and file:// URLs
    const fixPosterUrl = (url: string | undefined): string | undefined => {
        if (!url) {
            return undefined;
        }

        // Log for debugging

        // If it's a file:// URL (local cached image), return as-is
        if (url.startsWith('file://')) return url;

        // If it's a Windows absolute path, convert to file:// URL
        if (/^[A-Za-z]:\\/.test(url)) {
            return `file:///${url.replace(/\\/g, '/')}`;
        }

        // If it's an http/https URL, return as-is
        if (url.startsWith('http://') || url.startsWith('https://')) return url;

        // Otherwise it's invalid
        return undefined;
    };

    return (
        <div style={{ position: 'relative' }}>
            {/* Bell Icon with Badge */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 8,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    transition: 'background 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                title={t('notifications', 'tooltip')}
            >
                <Bell size={22} color={unreadCount > 0 ? '#fbbf24' : 'rgba(255,255,255,0.7)'} />
                {unreadCount > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                        color: 'white',
                        fontSize: 10,
                        fontWeight: 700,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 4px',
                        boxShadow: '0 2px 8px rgba(239, 68, 68, 0.5)'
                    }}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 998
                        }}
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Panel */}
                    <div
                        style={{
                            position: 'fixed',
                            left: 92,
                            bottom: 80,
                            width: 380,
                            minWidth: 380,
                            minHeight: 200,
                            maxHeight: 520,
                            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                            borderRadius: 16,
                            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            overflow: 'hidden',
                            zIndex: 999,
                            animation: 'slideIn 0.2s ease'
                        }}
                    >
                        <style>{`
                            @keyframes slideIn {
                                from { opacity: 0; transform: translateX(-10px) scale(0.95); }
                                to { opacity: 1; transform: translateX(0) scale(1); }
                            }
                            @keyframes buttonPop {
                                0% { transform: scale(1); }
                                50% { transform: scale(1.15); }
                                100% { transform: scale(1); }
                            }
                            .notif-action-btn {
                                background: rgba(255,255,255,0.1);
                                border: none;
                                border-radius: 6px;
                                padding: 6px;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                transition: all 0.2s ease;
                            }
                            .notif-action-btn:hover {
                                background: rgba(168, 85, 247, 0.3);
                                transform: scale(1.1);
                            }
                            .notif-action-btn:active {
                                animation: buttonPop 0.3s ease;
                            }
                            .notif-header-btn {
                                background: rgba(255,255,255,0.1);
                                border: none;
                                border-radius: 6px;
                                padding: 6px;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                transition: all 0.2s ease;
                            }
                            .notif-header-btn:hover {
                                background: rgba(168, 85, 247, 0.3);
                                transform: scale(1.1);
                            }
                            .notif-header-btn:active {
                                animation: buttonPop 0.3s ease;
                            }
                        `}</style>

                        {/* Header */}
                        <div style={{
                            padding: '16px 20px',
                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Bell size={18} color="#a855f7" />
                                <span style={{ color: 'white', fontWeight: 600, fontSize: 15 }}>
                                    {t('notifications', 'title')}
                                </span>
                                {unreadCount > 0 && (
                                    <span style={{
                                        background: 'rgba(168, 85, 247, 0.3)',
                                        color: '#c4b5fd',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        padding: '2px 8px',
                                        borderRadius: 10
                                    }}>
                                        {unreadCount} {unreadCount !== 1 ? t('notifications', 'newPlural') : t('notifications', 'new')}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                                {notifications.length > 0 && (
                                    <>
                                        <button
                                            onClick={handleMarkAllAsRead}
                                            title={t('notifications', 'markAllAsRead')}
                                            className="notif-header-btn"
                                        >
                                            <CheckCheck size={16} color="rgba(255,255,255,0.7)" />
                                        </button>
                                        <button
                                            onClick={handleClearAll}
                                            title={t('notifications', 'clearAll')}
                                            className="notif-header-btn"
                                        >
                                            <X size={16} color="rgba(255,255,255,0.7)" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Notifications List */}
                        <div style={{
                            maxHeight: 440,
                            overflowY: 'auto',
                            padding: notifications.length === 0 ? 0 : '8px 0'
                        }}>
                            {notifications.length === 0 ? (
                                <div style={{
                                    padding: 40,
                                    textAlign: 'center',
                                    color: 'rgba(255,255,255,0.5)'
                                }}>
                                    <Bell size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                                    <p style={{ fontSize: 14 }}>{t('notifications', 'noNotifications')}</p>
                                    <p style={{ fontSize: 12, marginTop: 4 }}>
                                        {t('notifications', 'newNotifications')}
                                    </p>
                                </div>
                            ) : (
                                notifications.map(notification => {
                                    const colors = getNotificationColor(notification.type);
                                    const posterUrl = fixPosterUrl(notification.poster);
                                    const showImage = posterUrl && !brokenImages.has(notification.id);

                                    return (
                                        <div
                                            key={notification.id}
                                            style={{
                                                display: 'flex',
                                                gap: 12,
                                                padding: '12px 16px',
                                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                background: notification.read ? 'transparent' : 'rgba(168, 85, 247, 0.08)',
                                                cursor: 'pointer',
                                                transition: 'background 0.2s'
                                            }}
                                            onClick={() => handleNotificationClick(notification)}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                            onMouseLeave={e => e.currentTarget.style.background = notification.read ? 'transparent' : 'rgba(168, 85, 247, 0.08)'}
                                        >
                                            {/* Icon or Poster */}
                                            <div style={{
                                                width: 50,
                                                height: 50,
                                                borderRadius: 10,
                                                overflow: 'hidden',
                                                flexShrink: 0,
                                                background: 'rgba(0,0,0,0.3)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}>
                                                {showImage ? (
                                                    <img
                                                        src={posterUrl}
                                                        alt=""
                                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                        onError={() => {
                                                            setBrokenImages(prev => new Set(prev).add(notification.id));
                                                        }}
                                                    />
                                                ) : (
                                                    <div style={{
                                                        width: 40,
                                                        height: 40,
                                                        borderRadius: 8,
                                                        background: colors.bg,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}>
                                                        {getNotificationIcon(notification.type)}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Content */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 6,
                                                    marginBottom: 4
                                                }}>
                                                    <span style={{
                                                        background: colors.bg,
                                                        color: colors.text,
                                                        fontSize: 10,
                                                        fontWeight: 600,
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 4
                                                    }}>
                                                        {getNotificationIcon(notification.type)}
                                                        {getTypeLabel(notification.type)}
                                                    </span>
                                                </div>
                                                <div style={{
                                                    color: 'white',
                                                    fontSize: 13,
                                                    fontWeight: 500,
                                                    marginBottom: 2,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {notification.title}
                                                </div>
                                                <div style={{
                                                    color: 'rgba(255,255,255,0.6)',
                                                    fontSize: 12,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {notification.message}
                                                </div>
                                                <div style={{
                                                    color: 'rgba(255,255,255,0.4)',
                                                    fontSize: 11,
                                                    marginTop: 4
                                                }}>
                                                    {formatTime(notification.createdAt)}
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                {!notification.read && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleMarkAsRead(notification.id);
                                                        }}
                                                        title="Marcar como lida"
                                                        className="notif-action-btn"
                                                    >
                                                        <Check size={14} color="rgba(255,255,255,0.7)" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

