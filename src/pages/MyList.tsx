// 📚 Item 27 + 🎞️ Item 30: "Minha lista" — Favoritos, Ver depois e a Fila
// manual de reprodução numa página única com abas.
import { useState } from 'react';
import { Favorites } from './Favorites';
import { WatchLater } from './WatchLater';
import { queueService, type QueuedItem } from '../services/queueService';
import { useLanguage } from '../services/languageService';

const TAB_KEY = 'neostream_mylist_tab';
type Tab = 'favorites' | 'watchLater' | 'queue';

function QueuePanel() {
    const { t } = useLanguage();
    const [items, setItems] = useState<QueuedItem[]>(() => queueService.getAll());

    if (items.length === 0) {
        return (
            <div style={{ padding: 60, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎞️</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{t('myListPage', 'queueEmpty')}</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>{t('myListPage', 'queueEmptyHint')}</div>
            </div>
        );
    }

    const buttonStyle: React.CSSProperties = {
        width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(255,255,255,0.06)', color: 'white', cursor: 'pointer', fontSize: 13,
    };

    return (
        <div style={{ padding: '18px 26px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{t('myListPage', 'queueHint')}</div>
            {items.map((item, index) => (
                <div
                    key={item.id}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                        borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    }}
                >
                    <span style={{ color: 'var(--ns-accent-light, #a78bfa)', fontWeight: 800, width: 24, textAlign: 'center' }}>{index + 1}</span>
                    {item.cover && <img src={item.cover} alt="" style={{ width: 34, height: 50, objectFit: 'cover', borderRadius: 6 }} />}
                    <span style={{ flex: 1, color: 'white', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    <button style={buttonStyle} title="↑" onClick={() => setItems(queueService.move(item.id, -1))}>↑</button>
                    <button style={buttonStyle} title="↓" onClick={() => setItems(queueService.move(item.id, 1))}>↓</button>
                    <button style={{ ...buttonStyle, color: '#f87171' }} title="✕" onClick={() => setItems(queueService.remove(item.id))}>✕</button>
                </div>
            ))}
        </div>
    );
}

export function MyList() {
    const { t } = useLanguage();
    const [tab, setTab] = useState<Tab>(() => {
        const saved = localStorage.getItem(TAB_KEY);
        return saved === 'watchLater' || saved === 'queue' ? saved : 'favorites';
    });

    const choose = (next: Tab) => {
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
                <button style={tabStyle(tab === 'queue')} onClick={() => choose('queue')}>
                    🎞️ {t('myListPage', 'tabQueue')}
                </button>
            </div>
            {tab === 'favorites' && <Favorites />}
            {tab === 'watchLater' && <WatchLater />}
            {tab === 'queue' && <QueuePanel />}
        </div>
    );
}
