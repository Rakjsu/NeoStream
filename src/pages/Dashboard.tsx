import { lazy, Suspense, useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { GlobalSearch } from '../components/GlobalSearch';
import { ShowcaseScreensaver } from '../components/ShowcaseScreensaver';
import { ShortcutsOverlay } from '../components/ShortcutsOverlay';

/**
 * Retrospectiva anual. Fica preguiçosa porque só abre uma vez por ano — mas
 * fica AQUI, no layout do painel, e não dentro das Estatísticas.
 *
 * O aviso de dezembro (NotificationsPanel) dispara `neostream:open-wrapped`, e
 * o único ouvinte vivia no StatsSection — ou seja, dentro de Configurações →
 * Estatísticas, e ainda por cima num chunk carregado sob demanda. Clicar no
 * aviso em qualquer outra tela não fazia absolutamente nada: a notificação
 * sumia e a Retrospectiva não abria. Uma vez por ano, e sem segunda chance.
 */
const WrappedOverlay = lazy(() =>
    import('../components/WrappedOverlay').then(m => ({ default: m.WrappedOverlay })));

export function Dashboard() {
    const navigate = useNavigate();
    const [retrospectivaAberta, setRetrospectivaAberta] = useState(false);

    useEffect(() => {
        const abrir = () => setRetrospectivaAberta(true);
        window.addEventListener('neostream:open-wrapped', abrir);
        return () => window.removeEventListener('neostream:open-wrapped', abrir);
    }, []);

    // A navegação por setas do Modo TV NÃO mora mais aqui: montada só neste
    // layout, ela nascia depois do "Quem está assistindo?", do /welcome e do
    // /login. Agora sobe junto com o app inteiro, em `RaizDoApp`.

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
            {retrospectivaAberta && (
                <Suspense fallback={null}>
                    <WrappedOverlay onClose={() => setRetrospectivaAberta(false)} />
                </Suspense>
            )}
        </div>
    );
}
