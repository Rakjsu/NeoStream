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
            <div className="p-8 flex items-center gap-4 border-b border-gray-800/50 bg-gradient-to-br from-blue-600/10 to-purple-600/10">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/50 shrink-0 relative overflow-hidden">
                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                    <Tv className="w-7 h-7 text-white relative z-10" />
                </div>
                <div>
                    <h1 className="font-bold text-2xl bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                        NeoStream
                    </h1>
                    <p className="text-xs text-gray-500 font-medium">IPTV Platform</p>
                </div>
            </div>



            {/* Navigation */}
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto mt-2">
                {menuItems.map((item) => {
                    const isActive = location.pathname.startsWith(item.path);
                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className={clsx(
                                "w-full flex items-center transition-all duration-300 group relative overflow-hidden",
                                isActive
                                    ? `bg-gradient-to-r ${item.color} shadow-md`
                                    : "text-gray-400 hover:bg-gray-800/50 hover:text-white"
                            )}
                            style={{
                                padding: '6px',
                                gap: '6px',
                                borderRadius: '8px',
                                fontSize: '11px'
                            }}
                        >
                            {/* Gradient overlay on hover */}
                            {!isActive && (
                                <div className={`absolute inset-0 bg-gradient-to-r ${item.color} opacity-0 group-hover:opacity-10 transition-opacity duration-300 rounded-2xl`}></div>
                            )}

                            {/* Icon container */}
                            <div className={clsx(
                                "rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 relative z-10",
                                isActive
                                    ? "bg-white/20 shadow-lg"
                                    : "bg-gray-800/50 group-hover:bg-gray-700/50"
                            )}
                                style={{
                                    width: '24px',
                                    height: '24px'
                                }}>
                                <item.icon className={clsx(
                                    "transition-all duration-300",
                                    isActive ? "text-white" : "text-gray-400 group-hover:text-white"
                                )}
                                    style={{ width: '14px', height: '14px' }} />
                            </div>

                            {/* Active indicator */}
                            {isActive && (
                                <div className="absolute bg-white rounded-full animate-pulse" style={{ right: '4px', width: '4px', height: '4px' }}></div>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Profile Section */}
            {activeProfile && (
                <div className="p-3 mx-3 mb-3 rounded-xl bg-gradient-to-br from-gray-800/80 to-gray-900/80 border border-gray-700/50">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border-2 border-gray-700/50">
                                {isImageAvatar ? (
                                    <img src={activeProfile.avatar} alt={activeProfile.name} className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-xl">{activeProfile.avatar}</span>
                                )}
                            </div>
                            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-900"></div>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500 font-medium">Perfil</p>
                            <h3 className="font-semibold text-white truncate text-sm">{activeProfile.name}</h3>
                        </div>
                    </div>
                </div>
            )}

            {/* Logout Button */}
            <div className="p-6 border-t border-gray-800/50 bg-gradient-to-t from-gray-950/50">
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-red-600/10 to-pink-600/10 border border-red-500/20 text-red-400 hover:from-red-600/20 hover:to-pink-600/20 hover:border-red-500/40 hover:text-red-300 hover:scale-[1.02] transition-all duration-300 group"
                >
                    <div className="w-11 h-11 rounded-xl bg-red-500/10 group-hover:bg-red-500/20 flex items-center justify-center shrink-0 transition-all duration-300">
                        <LogOut className="w-6 h-6" />
                    </div>
                    <span className="font-semibold text-base">Sair</span>
                </button>
            </div>
        </div>
    );
}
