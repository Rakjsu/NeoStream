import { useState, useEffect } from 'react';
import { updateService } from '../services/updateService';
import type { UpdateInfo } from '../types/update';

interface UpdateNotificationBadgeProps {
    onClick: () => void;
}

export function UpdateNotificationBadge({ onClick }: UpdateNotificationBadgeProps) {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

    useEffect(() => {
        // Listen for update available event
        const unsubscribe = updateService.onUpdateAvailable((info) => {
            setUpdateAvailable(true);
            setUpdateInfo(info);
        });

        // Cleanup on unmount
        return unsubscribe;
    }, []);

    // Don't render if no update available
    if (!updateAvailable) return null;

    return (
        <div
            style={{
                padding: '16px 0',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
            }}
        >
            <button
                onClick={onClick}
                className="update-notification-badge"
                style={{
                    position: 'relative',
                    width: '48px',
                    height: '48px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s ease'
                }}
                title={`Atualização disponível: v${updateInfo?.version}`}
            >
                {/* Download icon with pulsing animation */}
                <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                    }}
                >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                </svg>

                {/* Red notification dot */}
                <div
                    style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: '#ef4444',
                        boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
                        animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite'
                    }}
                />
            </button>

            <style>{`
                @keyframes pulse {
                    0%, 100% {
                        opacity: 1;
                    }
                    50% {
                        opacity: 0.6;
                    }
                }

                @keyframes ping {
                    75%, 100% {
                        transform: scale(2);
                        opacity: 0;
                    }
                }

                .update-notification-badge:hover svg {
                    stroke: #34d399 !important;
                    transform: scale(1.2);
                }
            `}</style>
        </div>
    );
}
