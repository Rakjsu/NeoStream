import { useNavigate, useLocation } from 'react-router-dom';
import { Tv, Film, PlaySquare, Settings, LogOut, Bookmark } from 'lucide-react';
import { clsx } from 'clsx';

export function Sidebar() {
    const navigate = useNavigate();
    const location = useLocation();

    const menuItems = [
        { icon: Tv, label: 'Live TV', path: '/dashboard/live' },
        { icon: Film, label: 'Movies', path: '/dashboard/vod' },
        { icon: PlaySquare, label: 'Series', path: '/dashboard/series' },
        { icon: Bookmark, label: 'Assistir Depois', path: '/dashboard/watch-later' },
        { icon: Settings, label: 'Settings', path: '/dashboard/settings' },
    ];

    const handleLogout = async () => {
        await window.ipcRenderer.invoke('auth:logout');
        localStorage.clear();
        navigate('/welcome');
    };

    return (
        <div className="w-20 lg:w-64 bg-gray-800 border-r border-gray-700 flex flex-col h-screen transition-all duration-300">
            <div className="p-6 flex items-center justify-center lg:justify-start gap-3 border-b border-gray-700">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/30 shrink-0">
                    <Tv className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-xl text-white hidden lg:block">StreamPro</span>
            </div>

            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                {menuItems.map((item) => {
                    const isActive = location.pathname.startsWith(item.path);
                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className={clsx(
                                "w-full flex items-center gap-3 p-3 rounded-xl transition-all group",
                                isActive
                                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                                    : "text-gray-400 hover:bg-gray-700 hover:text-white"
                            )}
                        >
                            <item.icon className={clsx("w-5 h-5", isActive ? "text-white" : "text-gray-400 group-hover:text-white")} />
                            <span className="font-medium hidden lg:block">{item.label}</span>
                        </button>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-gray-700">
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all group"
                >
                    <LogOut className="w-5 h-5" />
                    <span className="font-medium hidden lg:block">Logout</span>
                </button>
            </div>
        </div>
    );
}
