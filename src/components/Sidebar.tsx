import { useNavigate, useLocation } from 'react-router-dom';
import { Tv, Film, PlaySquare, Settings, LogOut, Bookmark, User } from 'lucide-react';
import { clsx } from 'clsx';
import { profileService } from '../services/profileService';
import { useState } from 'react';

export function Sidebar() {
    const navigate = useNavigate();
    const location = useLocation();
    const [activeProfile] = useState(() => profileService.getActiveProfile());

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
        <div className="bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 border-r border-gray-800/50 flex flex-col h-screen shadow-2xl" style={{ minWidth: '80px', maxWidth: '80px', width: '80px' }}>
            {/* Header/Logo */}
            <div className="flex items-center justify-center bg-gradient-to-br from-blue-600/10 to-purple-600/10" style={{ padding: '20px 0' }}>
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/50 relative overflow-hidden">
                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                    <Tv className="w-7 h-7 text-white relative z-10" />
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto" style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                {menuItems.map((item) => {
                    const isActive = location.pathname.startsWith(item.path);
                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className="flex items-center justify-center transition-all duration-300 group relative"
                            style={{
                                width: '48px',
                                height: '48px',
                                background: 'transparent',
                                border: 'none',
                                padding: 0
                            }}
                        >
                            {/* Icon - Always White */}
                            <item.icon
                                className="transition-all duration-300 relative z-10"
                                style={{
                                    width: '24px',
                                    height: '24px',
                                    color: isActive ? '#ffffff' : '#ffffff',
                                    stroke: '#ffffff'
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
                                <div className="absolute bg-white rounded-full animate-pulse" style={{ bottom: '4px', right: '4px', width: '6px', height: '6px' }}></div>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Profile Section */}
            {activeProfile && (
                <div className="flex items-center justify-center" style={{ padding: '12px 0', marginBottom: '16px' }}>
                    <div className="relative cursor-pointer transition-transform duration-300 hover:scale-110">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: '#000000' }}>
                            {isImageAvatar ? (
                                <img src={activeProfile.avatar} alt={activeProfile.name} className="w-full h-full object-cover rounded-full" />
                            ) : activeProfile.avatar ? (
                                <span className="text-2xl">{activeProfile.avatar}</span>
                            ) : (
                                <User className="text-white" style={{ width: '24px', height: '24px', stroke: '#ffffff' }} />
                            )}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-900"></div>
                    </div>
                </div>
            )}

            {/* Logout Button */}
            <div className="flex items-center justify-center" style={{ padding: '16px 0', borderTop: '1px solid rgba(55, 65, 81, 0.3)' }}>
                <button
                    onClick={handleLogout}
                    className="flex items-center justify-center transition-all duration-300"
                    style={{ width: '48px', height: '48px' }}
                >
                    <LogOut
                        className="transition-all duration-300"
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
    );
}
