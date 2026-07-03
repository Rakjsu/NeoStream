import { useEffect, useState } from 'react';
import { useLanguage } from '../../services/languageService';
import { playlistService, type PlaylistSummary } from '../../services/playlistService';

/**
 * Settings > Playlists: list saved Xtream playlists, add a new one,
 * switch between them and remove. Switching/adding reloads the renderer
 * into the dashboard so every page refetches from the new provider.
 */
export function PlaylistsSection() {
    const { t } = useLanguage();

    const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
    const [error, setError] = useState('');

    // Add form
    const [showAddForm, setShowAddForm] = useState(false);
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ name: '', url: '', username: '', password: '' });
    const [addType, setAddType] = useState<'xtream' | 'm3u'>('xtream');

    const refresh = async () => {
        setLoading(true);
        try {
            setPlaylists(await playlistService.list());
        } catch (err) {
            console.error('Failed to list playlists:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Deferred: refresh flips loading state synchronously on entry.
        queueMicrotask(() => { void refresh(); });
    }, []);

    const hostOf = (url: string) => {
        try {
            return new URL(url).host;
        } catch {
            return url;
        }
    };

    const handleSwitch = async (id: string) => {
        setError('');
        setBusyId(id);
        try {
            const result = await playlistService.switchTo(id);
            if (result.success) {
                playlistService.reloadIntoDashboard();
            } else {
                setError(result.error || t('playlists', 'switchError'));
            }
        } catch {
            setError(t('playlists', 'switchError'));
        } finally {
            setBusyId(null);
        }
    };

    const handleRemove = async (id: string) => {
        if (confirmRemoveId !== id) {
            setConfirmRemoveId(id);
            return;
        }
        setConfirmRemoveId(null);
        setError('');
        setBusyId(id);
        try {
            const wasActive = playlists.find(p => p.id === id)?.active === true;
            const result = await playlistService.remove(id);
            if (!result.success) {
                setError(result.error || t('playlists', 'removeError'));
                return;
            }
            if (wasActive) {
                // Active provider changed (fallback playlist or logged out):
                // restart the renderer so every page refetches.
                playlistService.reloadIntoDashboard();
                return;
            }
            await refresh();
        } catch {
            setError(t('playlists', 'removeError'));
        } finally {
            setBusyId(null);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setAdding(true);
        try {
            if (addType === 'm3u') {
                const m3uResult = await playlistService.addM3u({
                    name: form.name.trim() || undefined,
                    url: form.url.trim()
                });
                if (m3uResult.success) {
                    playlistService.reloadIntoDashboard();
                } else {
                    setError(m3uResult.error || t('playlists', 'addError'));
                }
                return;
            }
            const result = await playlistService.add({
                name: form.name.trim() || undefined,
                url: form.url.trim(),
                username: form.username.trim(),
                password: form.password
            });
            if (result.success) {
                playlistService.reloadIntoDashboard();
            } else {
                setError(result.error || t('playlists', 'addError'));
            }
        } catch {
            setError(t('playlists', 'addError'));
        } finally {
            setAdding(false);
        }
    };

    return (
        <div className="section-card">
            <style>{playlistsStyles}</style>
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, var(--ns-accent-dark), var(--ns-accent))' }}>📺</div>
                <div>
                    <h2>{t('playlists', 'title')}</h2>
                    <p>{t('playlists', 'description')}</p>
                </div>
            </div>

            {error && <div className="playlists-error">{error}</div>}

            <div className="settings-group">
                {loading ? (
                    <p className="playlists-empty">{t('common', 'loading')}</p>
                ) : playlists.length === 0 ? (
                    <p className="playlists-empty">{t('playlists', 'empty')}</p>
                ) : (
                    <div className="playlists-list">
                        {playlists.map((playlist) => (
                            <div key={playlist.id} className={`playlists-item ${playlist.active ? 'active' : ''}`}>
                                <div className="playlists-item-info">
                                    <div className="playlists-item-name">
                                        {playlist.name}
                                        {playlist.active && (
                                            <span className="playlists-badge">{t('playlists', 'activeBadge')}</span>
                                        )}
                                    </div>
                                    <div className="playlists-item-meta">
                                        {playlist.type === 'm3u'
                                            ? <>M3U · {hostOf(playlist.url)}</>
                                            : <>{hostOf(playlist.url)} · {playlist.username}</>}
                                    </div>
                                </div>
                                <div className="playlists-item-actions">
                                    {!playlist.active && (
                                        <button
                                            className="playlists-btn playlists-btn-primary"
                                            disabled={busyId !== null}
                                            onClick={() => handleSwitch(playlist.id)}
                                        >
                                            {busyId === playlist.id ? t('playlists', 'switching') : t('playlists', 'switch')}
                                        </button>
                                    )}
                                    <button
                                        className="playlists-btn playlists-btn-danger"
                                        disabled={busyId !== null}
                                        onClick={() => handleRemove(playlist.id)}
                                        onBlur={() => setConfirmRemoveId(null)}
                                    >
                                        {confirmRemoveId === playlist.id
                                            ? t('playlists', 'confirmRemove')
                                            : t('playlists', 'remove')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!showAddForm ? (
                    <button className="playlists-btn playlists-btn-add" onClick={() => setShowAddForm(true)}>
                        + {t('playlists', 'add')}
                    </button>
                ) : (
                    <form className="playlists-add-form" onSubmit={handleAdd}>
                        <h3>{t('playlists', 'addTitle')}</h3>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                            {(['xtream', 'm3u'] as const).map(kind => (
                                <button
                                    key={kind}
                                    type="button"
                                    onClick={() => setAddType(kind)}
                                    style={{
                                        flex: 1,
                                        padding: '9px 12px',
                                        borderRadius: 10,
                                        border: addType === kind ? '1px solid var(--ns-accent)' : '1px solid rgba(255,255,255,0.2)',
                                        background: addType === kind ? 'rgba(var(--ns-accent-rgb), 0.2)' : 'transparent',
                                        color: 'white',
                                        fontSize: 13,
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {kind === 'xtream' ? 'Xtream Codes' : 'M3U'}
                                </button>
                            ))}
                        </div>
                        {addType === 'm3u' && (
                            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: '0 0 10px' }}>
                                {t('playlists', 'm3uHint')}
                            </p>
                        )}
                        <input
                            type="text"
                            placeholder={t('playlists', 'namePlaceholder')}
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            disabled={adding}
                        />
                        <input
                            type="text"
                            required
                            placeholder="http://example.com:8080"
                            value={form.url}
                            onChange={(e) => setForm({ ...form, url: e.target.value })}
                            disabled={adding}
                        />
                        {addType === 'xtream' && (
                            <>
                                <input
                                    type="text"
                                    required
                                    placeholder={t('login', 'username')}
                                    value={form.username}
                                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                                    disabled={adding}
                                />
                                <input
                                    type="password"
                                    required
                                    placeholder={t('login', 'password')}
                                    value={form.password}
                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                                    disabled={adding}
                                />
                            </>
                        )}
                        <div className="playlists-add-actions">
                            <button
                                type="button"
                                className="playlists-btn"
                                onClick={() => setShowAddForm(false)}
                                disabled={adding}
                            >
                                {t('common', 'close')}
                            </button>
                            <button type="submit" className="playlists-btn playlists-btn-primary" disabled={adding}>
                                {adding ? t('playlists', 'adding') : t('playlists', 'addConfirm')}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

const playlistsStyles = `
.playlists-error {
    margin-bottom: 16px;
    padding: 12px 16px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 10px;
    color: #fca5a5;
    font-size: 14px;
}

.playlists-empty {
    color: rgba(255,255,255,0.5);
    font-size: 14px;
}

.playlists-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
}

.playlists-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
}

.playlists-item.active {
    border-color: rgba(99, 102, 241, 0.5);
    background: rgba(99, 102, 241, 0.08);
}

.playlists-item-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: #fff;
    font-size: 15px;
}

.playlists-badge {
    padding: 2px 8px;
    background: linear-gradient(135deg, var(--ns-accent-dark), var(--ns-accent));
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
}

.playlists-item-meta {
    margin-top: 2px;
    font-size: 13px;
    color: rgba(255,255,255,0.5);
}

.playlists-item-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
}

.playlists-btn {
    padding: 8px 14px;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.85);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
}

.playlists-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.12);
}

.playlists-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.playlists-btn-primary {
    background: linear-gradient(135deg, var(--ns-accent-dark), var(--ns-accent));
    border-color: transparent;
    color: #fff;
}

.playlists-btn-danger {
    border-color: rgba(239, 68, 68, 0.4);
    color: #fca5a5;
}

.playlists-btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.15);
}

.playlists-btn-add {
    width: 100%;
}

.playlists-add-form {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
}

.playlists-add-form h3 {
    margin: 0 0 4px;
    font-size: 15px;
    color: #fff;
}

.playlists-add-form input {
    padding: 12px 14px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    color: #fff;
    font-size: 14px;
    outline: none;
}

.playlists-add-form input:focus {
    border-color: rgba(99, 102, 241, 0.5);
}

.playlists-add-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
}
`;
