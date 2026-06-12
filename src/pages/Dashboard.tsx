import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { GlobalSearch } from '../components/GlobalSearch';

export function Dashboard() {
    return (
        <div className="flex h-full bg-gray-900 text-white overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-hidden relative">
                <Outlet />
            </main>
            {/* Ctrl+K / Cmd+K global search overlay — available on all dashboard pages */}
            <GlobalSearch />
        </div>
    );
}
