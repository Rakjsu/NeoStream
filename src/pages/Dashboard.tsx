import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';

export function Dashboard() {
    return (
        <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto relative">
                <Outlet />
            </main>
        </div>
    );
}
