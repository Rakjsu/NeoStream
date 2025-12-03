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
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

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
        await window.ipcRenderer.invoke('auth:logout');
        localStorage.clear();
        navigate('/welcome');
    };

    const isImageAvatar = activeProfile?.avatar.startsWith('data:image') || activeProfile?.avatar.startsWith('http');

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
                        onClick={() => navigate('/dashboard/live')}
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

                {/* Dev Tools - Category Analyzer */}
                <div style={{ padding: '16px 0', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    <button
                        onClick={() => navigate('/dashboard/category-analyzer')}
                        className="flex items-center justify-center transition-all duration-200 active:scale-90"
                        style={{
                            width: '48px',
                            height: '48px',
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            margin: '0 auto'
                        }}
                        title="Analisador de Categorias"
                    >
                        {/* Ícone de lupa/análise */}
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
                                e.currentTarget.style.color = '#3b82f6';
                                e.currentTarget.style.stroke = '#3b82f6';
                                e.currentTarget.style.transform = 'scale(1.25)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = '#ffffff';
                                e.currentTarget.style.stroke = '#ffffff';
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                        >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                            <path d="M11 8v6" />
                            <path d="M8 11h6" />
                        </svg>
                    </button>
                </div>

                {/* Update Notification Badge */}
                <UpdateNotificationBadge onClick={handleUpdateBadgeClick} />

                {/* Profile Section */}
                {activeProfile && (
                    <div className="flex items-center justify-center" style={{ padding: '12px 0', marginBottom: '16px', position: 'relative' }}>
                        <div
                            className="relative cursor-pointer transition-transform duration-300 hover:scale-110"
                            onClick={() => {
                                navigate('/dashboard/settings');
                            }}
                            title="Configurações de Perfil"
                        >
                            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: '#000000' }}>
                                {/* Always show cyan icon - comment out to use avatar */}
                                <svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                    {/* Outer circle */}
                                    <circle cx="50" cy="50" r="46" fill="none" stroke="#06b6d4" strokeWidth="8" />
                                    {/* Head circle (outline only) */}
                                    <circle cx="50" cy="35" r="12" fill="none" stroke="#06b6d4" strokeWidth="8" />
                                    {/* Body/torso (outline) */}
                                    <path
                                        d="M 23,80 C 23,65 32,58 50,58 C 68,58 77,65 77,80"
                                        fill="none"
                                        stroke="#06b6d4"
                                        strokeWidth="8"
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
