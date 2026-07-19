// 📚 Item 27: "Minha lista" — Ver depois + Favoritos numa página única.
// As duas páginas existentes viram abas (lógica intacta); as rotas antigas
// redirecionam pra cá e o menu lateral mostra um item só.
import { useState } from 'react';
import { Favorites } from './Favorites';
import { WatchLater } from './WatchLater';
import { useLanguage } from '../services/languageService';

const TAB_KEY = 'neostream_mylist_tab';

export function MyList() {
    const { t } = useLanguage();
    const [tab, setTab] = useState<'favorites' | 'watchLater'>(() =>
        localStorage.getItem(TAB_KEY) === 'watchLater' ? 'watchLater' : 'favorites');

    const choose = (next: 'favorites' | 'watchLater') => {
        localStorage.setItem(TAB_KEY, next);
        setTab(next);
    };

    const tabStyle = (active: boolean): React.CSSProperties => ({
        padding: '10px 22px',
        borderRadius: 999,
        border: active ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.12)',
        background: active ? 'var(--ns-accent, #7c3aed)' : 'rgba(255,255,255,0.06)',
        color: 'white',
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
    });

    return (
        <div>
            <div
                style={{
                    position: 'sticky', top: 0, zIndex: 50,
                    display: 'flex', gap: 10, padding: '14px 24px',
                    background: 'rgba(10, 10, 22, 0.92)', backdropFilter: 'blur(8px)',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
            >
                <button style={tabStyle(tab === 'favorites')} onClick={() => choose('favorites')}>
                    ❤️ {t('myListPage', 'tabFavorites')}
                </button>
                <button style={tabStyle(tab === 'watchLater')} onClick={() => choose('watchLater')}>
                    🔖 {t('myListPage', 'tabWatchLater')}
                </button>
            </div>
            {tab === 'favorites' ? <Favorites /> : <WatchLater />}
        </div>
    );
}
