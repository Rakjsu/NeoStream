import { useNavigate, useLocation } from 'react-router-dom';
import { Tv, Film, PlaySquare, Settings, LogOut, Bookmark } from 'lucide-react';
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
                            className={clsx(
                                "flex items-center justify-center transition-all duration-300 group relative",
                                isActive ? "" : "hover:scale-110"
                            )}
                            style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '12px',
                                background: isActive ? `linear-gradient(135deg, var(--tw-gradient-stops))` : 'transparent'
                            }}
                        >
                            {/* Gradient overlay on hover */}
                            {!isActive && (
                                <div className={`absolute inset-0 bg-gradient-to-r ${item.color} opacity-0 group-hover:opacity-20 transition-opacity duration-300`} style={{ borderRadius: '12px' }}></div>
                            )}

                            {/* Icon - NO BACKGROUND */}
                            <item.icon
                                className={clsx(
                                    "transition-all duration-300 relative z-10",
                                    isActive ? "text-white" : "text-gray-400 group-hover:text-white"
                                )}
                                style={{ width: '24px', height: '24px' }}
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
                    <div className="relative">
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border-2 border-gray-700/50">
                            {isImageAvatar ? (
                                <img src={activeProfile.avatar} alt={activeProfile.name} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-2xl">{activeProfile.avatar}</span>
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
                    className="flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600/10 to-pink-600/10 border border-red-500/20 text-red-400 hover:from-red-600/20 hover:to-pink-600/20 hover:border-red-500/40 hover:text-red-300 hover:scale-110 transition-all duration-300 group"
                    style={{ width: '48px', height: '48px' }}
                >
                    <LogOut className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
