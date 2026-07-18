import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { GlobalSearch } from '../components/GlobalSearch';
import { ShowcaseScreensaver } from '../components/ShowcaseScreensaver';
import { ShortcutsOverlay } from '../components/ShortcutsOverlay';
import { useSpatialNavigation } from '../hooks/useSpatialNavigation';

export function Dashboard() {
    const navigate = useNavigate();

    // TV mode phase 2: arrows move focus geometrically, Backspace goes back.
    useSpatialNavigation();

    // Tray menu shortcuts (e.g. "⏺ Gravações") navigate the running app.
    useEffect(() => {
        if (!window.ipcRenderer) return;
        const handler = (_event: unknown, path: unknown) => {
            if (typeof path === 'string' && path.startsWith('/dashboard')) {
                navigate(path);
            }
        };
        window.ipcRenderer.on('tray:navigate', handler);
        return () => { window.ipcRenderer?.off('tray:navigate', handler); };
    }, [navigate]);

    return (
        <div className="flex h-full bg-gray-900 text-white overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-hidden relative">
                <Outlet />
            </main>
            {/* Ctrl+K / Cmd+K global search overlay — available on all dashboard pages */}
            <GlobalSearch />
            <ShowcaseScreensaver />
            {/* "?" keyboard shortcuts cheatsheet */}
            <ShortcutsOverlay />
        </div>
    );
}
