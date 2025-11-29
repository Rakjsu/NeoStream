import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { watchLaterService, WatchLaterItem } from '../services/watchLater';

export function WatchLater() {
    const [items, setItems] = useState<WatchLaterItem[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        loadItems();
    }, []);

    const loadItems = () => {
        setItems(watchLaterService.getAll());
    };

    const removeItem = (id: string, type: 'series' | 'movie') => {
        watchLaterService.remove(id, type);
        loadItems();
    };

    const handleItemClick = (item: WatchLaterItem) => {
        if (item.type === 'series') {
            navigate('/series');
        } else {
            navigate('/vod');
        }
    };

    if (items.length === 0) {
        return (
            <div style={{
                padding: '32px',
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <div style={{
                    fontSize: '64px',
                    marginBottom: '24px'
                }}>🔖</div>
                <h2 style={{
                    fontSize: '32px',
                    fontWeight: 'bold',
                    color: 'white',
                    marginBottom: '12px'
                }}>Nada aqui ainda</h2>
                <p style={{
                    color: '#9ca3af',
                    fontSize: '16px'
                }}>Adicione séries e filmes para assistir depois</p>
            </div>
        );
    }

    return (
        <div style={{ padding: '32px', height: '100vh', overflow: 'auto' }}>
            <h1 style={{
                fontSize: '42px',
                fontWeight: 'bold',
                color: 'white',
                marginBottom: '32px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px'
            }}>
                <span>🔖</span>
                Assistir Depois
            </h1>

            <div className="grid grid-cols-9 gap-[32px]">
                {items.map((item) => (
                    <div key={`${item.type}-${item.id}`} className="group cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-95">
                        <div className="relative overflow-hidden bg-gray-900 shadow-xl" style={{ borderRadius: '16px', border: '3px solid transparent' }}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeItem(item.id, item.type);
                                }}
                                style={{
                                    position: 'absolute',
                                    top: '8px',
                                    right: '8px',
                                    zIndex: 10,
                                    background: '#ef4444',
                                    borderRadius: '50%',
                                    width: '32px',
                                    height: '32px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: 'none',
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.5)',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <span style={{ fontSize: '18px' }}>✕</span>
                            </button>

                            <div className="aspect-[2/3]" onClick={() => handleItemClick(item)}>
                                {item.cover ? (
                                    <img
                                        src={item.cover.startsWith('http') ? item.cover : `https://${item.cover}`}
                                        alt={item.name}
                                        className="w-full h-full object-cover"
                                        style={{ borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}
                                    />
                                ) : (
                                    <div
                                        className="w-full h-full flex items-center justify-center bg-gray-700"
                                        style={{ borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}
                                    >
                                        <span className="text-5xl">{item.type === 'series' ? '📺' : '🎬'}</span>
                                    </div>
                                )}
                            </div>

                            <div
                                style={{
                                    background: 'linear-gradient(to top, #111827, rgba(31, 41, 55, 0.95), rgba(31, 41, 55, 0.8))',
                                    borderBottomLeftRadius: '16px',
                                    borderBottomRightRadius: '16px',
                                    padding: '12px'
                                }}
                                onClick={() => handleItemClick(item)}
                            >
                                <h3 className="text-white text-sm font-semibold truncate group-hover:text-blue-400 transition-colors">
                                    {item.name}
                                </h3>
                                <p style={{ color: '#6b7280', fontSize: '12px', marginTop: '4px' }}>
                                    {item.type === 'series' ? 'Série' : 'Filme'}
                                </p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
