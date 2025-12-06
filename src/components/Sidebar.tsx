import { useNavigate, useLocation } from 'react-router-dom';
import { Tv, Film, PlaySquare, Settings, LogOut, Bookmark } from 'lucide-react';
import { profileService } from '../services/profileService';
import { useState } from 'react';
import { UpdateNotificationBadge } from './UpdateNotificationBadge';
import { UpdateModal } from './UpdateModal';
import type { UpdateInfo } from '../types/update';

export function Sidebar() {
    const navigate = useNavigate();
    const location = useLocation();
    const [activeProfile] = useState(() => profileService.getActiveProfile());
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [updateInfo] = useState<UpdateInfo | null>(null);

    const handleUpdateBadgeClick = () => {
        setShowUpdateModal(true);
    };

    const menuItems = [
        { icon: Tv, label: 'TV ao Vivo', path: '/dashboard/live', color: 'from-purple-500 to-pink-500' },
        { icon: Film, label: 'Filmes', path: '/dashboard/vod', color: 'from-blue-500 to-cyan-500' },
        { icon: PlaySquare, label: 'Séries', path: '/dashboard/series', color: 'from-orange-500 to-red-500' },
        { icon: Bookmark, label: 'Assistir Depois', path: '/dashboard/watch-later', color: 'from-green-500 to-emerald-500' },
        { icon: Settings, label: 'Configurações', path: '/dashboard/settings', color: 'from-gray-500 to-slate-500' },
    ];

    const handleLogout = async () => {
        // Clear all local storage data
        localStorage.clear();
        // Clear profile data
        profileService.clearActiveProfile();
        // Logout via IPC
        await window.ipcRenderer.invoke('auth:logout');
        // Navigate to welcome
        navigate('/welcome');
    };

    return (
        <>
            <div className="bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 flex flex-col h-screen shadow-2xl" style={{ minWidth: '80px', maxWidth: '80px', width: '80px' }}>
                {/* Header/Logo */}
                <div className="flex items-center justify-center bg-gradient-to-br from-blue-600/10 to-purple-600/10" style={{ padding: '20px 0' }}>
                    <div className="relative">
                        {/* Custom Logo SVG - Play with equalizer bars */}
                        <svg width="48" height="48" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                            {/* Play triangle outline */}
                            <path d="M 10,10 L 10,90 L 90,50 Z" fill="none" stroke="white" strokeWidth="6" strokeLinejoin="round" />
                            {/* Equalizer bars */}
                            <rect x="35" y="35" width="6" height="30" fill="white" rx="3" />
                            <rect x="45" y="25" width="6" height="50" fill="white" rx="3" />
                            <rect x="55" y="40" width="6" height="20" fill="white" rx="3" />
                        </svg>
                    </div>
                </div>

                {/* Home Icon */}
                <div style={{ padding: '0 0 16px 0', display: 'flex', justifyContent: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <button
                        onClick={() => navigate('/dashboard/home')}
                        className="flex items-center justify-center transition-all duration-200 active:scale-90"
                        style={{
                            width: '48px',
                            height: '48px',
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer'
                        }}
                        title="Página Inicial"
                    >
                        <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="transition-all duration-200"
                            style={{ color: '#ffffff', stroke: '#ffffff' }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#fbbf24';
                                e.currentTarget.style.stroke = '#fbbf24';
                                e.currentTarget.style.transform = 'scale(1.25)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = '#ffffff';
                                e.currentTarget.style.stroke = '#ffffff';
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                        >
                            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto" style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    {menuItems.map((item) => {
                        const isActive = location.pathname.startsWith(item.path);
                        return (
                            <button
                                key={item.path}
                                onClick={() => navigate(item.path)}
                                className="flex items-center justify-center transition-all duration-200 group relative active:scale-90"
                                style={{
                                    width: '48px',
                                    height: '48px',
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer'
                                }}
                            >
                                {/* Icon - White or Yellow when active */}
                                <item.icon
                                    className="transition-all duration-200 relative z-10"
                                    style={{
                                        width: '24px',
                                        height: '24px',
                                        color: isActive ? '#fbbf24' : '#ffffff',
                                        stroke: isActive ? '#fbbf24' : '#ffffff'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isActive) {
                                            e.currentTarget.style.color = '#ef4444';
                                            e.currentTarget.style.stroke = '#ef4444';
                                            e.currentTarget.style.transform = 'scale(1.25)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isActive) {
                                            e.currentTarget.style.color = '#ffffff';
                                            e.currentTarget.style.stroke = '#ffffff';
                                            e.currentTarget.style.transform = 'scale(1)';
                                        }
                                    }}
                                />

                                {/* Active indicator */}
                                {isActive && (
                                    <div className="absolute bg-yellow-400 rounded-full animate-pulse" style={{ bottom: '4px', right: '4px', width: '6px', height: '6px' }}></div>
                                )}
                            </button>
                        );
                    })}
                </nav>


                {/* Update Notification Badge */}
                <UpdateNotificationBadge onClick={handleUpdateBadgeClick} />

                {/* Profile Section */}
                {activeProfile && (
                    <div className="flex items-center justify-center" style={{ padding: '12px 0', marginBottom: '16px', position: 'relative' }}>
                        <style>{`
                            @keyframes profileRingPulse {
                                0%, 100% { opacity: 0.6; transform: scale(1); }
                                50% { opacity: 1; transform: scale(1.1); }
                            }
                            @keyframes profileGlow {
                                0%, 100% { box-shadow: 0 0 15px rgba(168, 85, 247, 0.3); }
                                50% { box-shadow: 0 0 25px rgba(236, 72, 153, 0.5); }
                            }
                            .profile-btn {
                                position: relative;
                                cursor: pointer;
                                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                            }
                            .profile-btn:hover {
                                transform: scale(1.15);
                            }
                            .profile-btn:hover .profile-ring {
                                animation: profileRingPulse 1.5s ease-in-out infinite;
                            }
                            .profile-btn:hover .profile-inner {
                                animation: profileGlow 2s ease-in-out infinite;
                            }
                            .profile-ring {
                                position: absolute;
                                inset: -4px;
                                border-radius: 50%;
                                background: linear-gradient(135deg, #a855f7, #ec4899, #a855f7);
                                background-size: 200% 200%;
                                z-index: 0;
                            }
                            .profile-inner {
                                position: relative;
                                z-index: 1;
                                width: 48px;
                                height: 48px;
                                border-radius: 50%;
                                background: linear-gradient(135deg, #1a1a2e, #0f0f1a);
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                        `}</style>
                        <div
                            className="profile-btn"
                            onClick={() => {
                                navigate('/dashboard/settings');
                            }}
                            title="Configurações de Perfil"
                        >
                            <div className="profile-ring" />
                            <div className="profile-inner">
                                <svg width="32" height="32" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                    <defs>
                                        <linearGradient id="profileIconGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stopColor="#a855f7" />
                                            <stop offset="100%" stopColor="#ec4899" />
                                        </linearGradient>
                                    </defs>
                                    {/* Head circle */}
                                    <circle cx="50" cy="35" r="14" fill="none" stroke="url(#profileIconGrad)" strokeWidth="6" />
                                    {/* Body/torso */}
                                    <path
                                        d="M 20,85 C 20,65 30,55 50,55 C 70,55 80,65 80,85"
                                        fill="none"
                                        stroke="url(#profileIconGrad)"
                                        strokeWidth="6"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            </div>
                        </div>
                    </div>
                )}

                {/* Logout Button */}
                <div className="flex items-center justify-center" style={{ padding: '16px 0' }}>
                    <button
                        onClick={handleLogout}
                        className="flex items-center justify-center transition-all duration-200 active:scale-90"
                        style={{
                            width: '48px',
                            height: '48px',
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer'
                        }}
                    >
                        <LogOut
                            className="transition-all duration-200"
                            style={{ width: '24px', height: '24px', color: '#ffffff', stroke: '#ffffff' }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#ef4444';
                                e.currentTarget.style.stroke = '#ef4444';
                                e.currentTarget.style.transform = 'scale(1.25)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = '#ffffff';
                                e.currentTarget.style.stroke = '#ffffff';
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                        />
                    </button>
                </div>
            </div>

            {/* Update Modal */}
            <UpdateModal
                isOpen={showUpdateModal}
                onClose={() => setShowUpdateModal(false)}
                updateInfo={updateInfo}
            />
        </>
    );
}
