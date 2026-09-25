import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { movieProgressService } from '../services/movieProgressService';
import { watchProgressService } from '../services/watchProgressService';
import { LazyImage } from '../components/LazyImage';
import { useLanguage } from '../services/languageService';
import { useDialogA11y } from '../hooks/useDialogA11y';

interface SeriesData {
    series_id: number | string;
    name: string;
    cover?: string;
}

interface MovieData {
    stream_id: number | string;
    name: string;
    stream_icon?: string;
    cover?: string;
}

interface HistoryEntryBase {
    key: string;
    title: string;
    cover?: string;
    watchedAt: number;
    /** 0-100, only set when the item was NOT finished */
    progress?: number;
}

/**
 * A linha carrega a identidade que o SERVICO de progresso usa para apagar — o
 * `key` acima e so de desenho (tem prefixo) e nao serve para isso. Uniao
 * discriminada de proposito: cada ramo de `kind` ja vem com o seu id
 * obrigatorio, entao quem apaga nao precisa de uma guarda inalcancavel.
 */
type HistoryEntry =
    | (HistoryEntryBase & { kind: 'movie'; movieId: string })
    | (HistoryEntryBase & { kind: 'episode'; seriesId: string; seasonNumber: number; episodeNumber: number });

interface DayGroup {
    label: string;
    entries: HistoryEntry[];
}

/** Le os dois servicos de progresso (localStorage) numa chamada so. */
function lerHistoricoBruto() {
    return {
        filmes: movieProgressService.getHistory(),
        episodios: watchProgressService.getEpisodeHistory(),
    };
}

export function History() {
    const navigate = useNavigate();
    const { t } = useLanguage();

    // Reference timestamp for the Today/Yesterday groups (stable per mount)
    const [now] = useState(() => Date.now());

    // O historico e lido dos dois servicos de progresso (localStorage), e eles
    // nao avisam ninguem quando mudam: depois de apagar, quem manda reler e
    // `recarregar()` logo abaixo.
    const [confirmarLimpeza, setConfirmarLimpeza] = useState(false);

    // Optional metadata (names/posters) resolved from the cached content lists.
    // The progress services don't store posters or series names, so we enrich
    // entries when the lists are available and fall back to placeholders.
    const [seriesById, setSeriesById] = useState<Map<string, SeriesData>>(new Map());
    const [moviesById, setMoviesById] = useState<Map<string, MovieData>>(new Map());

    useEffect(() => {
        let cancelled = false;

        const loadMetadata = async () => {
            try {
                const seriesResult = await window.ipcRenderer.invoke('streams:get-series');
                if (!cancelled && seriesResult?.success && Array.isArray(seriesResult.data)) {
                    const map = new Map<string, SeriesData>();
                    seriesResult.data.forEach((s: SeriesData) => map.set(String(s.series_id), s));
                    setSeriesById(map);
                }

                const moviesResult = await window.ipcRenderer.invoke('streams:get-vod');
                if (!cancelled && moviesResult?.success && Array.isArray(moviesResult.data)) {
                    const map = new Map<string, MovieData>();
                    moviesResult.data.forEach((m: MovieData) => map.set(String(m.stream_id), m));
                    setMoviesById(map);
                }
            } catch (error) {
                console.error('Failed to load history metadata:', error);
            }
        };

        loadMetadata();
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * A LEITURA CRUA dos dois servicos mora no ESTADO, nao num memo.
     *
     * Ela esta separada do desenho de proposito: o memo de baixo tambem
     * depende de `t`, e o `t` do useLanguage e uma funcao NOVA a cada render
     * — os dois juntos num memo so faziam a releitura acontecer por acidente
     * (o memo nunca memoiza), e bastava alguem estabilizar o `t` com
     * useCallback, que e a otimizacao obvia num hook usado no app inteiro, pra
     * apagar uma linha parar de sumir da tela sem ninguem perceber.
     */
    const [brutos, setBrutos] = useState(lerHistoricoBruto);
    const recarregar = useCallback(() => setBrutos(lerHistoricoBruto()), []);

    const entries = useMemo<HistoryEntry[]>(() => {
        const list: HistoryEntry[] = [];

        brutos.filmes.forEach((movie) => {
            const meta = moviesById.get(String(movie.movieId));
            const finished = movie.completed || movie.progress >= 95;
            list.push({
                key: `movie-${movie.movieId}`,
                kind: 'movie',
                title: meta?.name || movie.movieName,
                cover: meta?.cover || meta?.stream_icon,
                watchedAt: movie.watchedAt,
                progress: finished ? undefined : Math.max(1, Math.round(movie.progress)),
                movieId: String(movie.movieId)
            });
        });

        brutos.episodios.forEach((ep) => {
            const meta = seriesById.get(String(ep.seriesId));
            const seriesName = meta?.name || t('history', 'serie');
            const progressPercent = !ep.completed && ep.currentTime && ep.duration
                ? Math.max(1, Math.round((ep.currentTime / ep.duration) * 100))
                : undefined;
            list.push({
                key: `episode-${ep.seriesId}-${ep.seasonNumber}-${ep.episodeNumber}`,
                kind: 'episode',
                title: `${seriesName} — T${ep.seasonNumber}E${ep.episodeNumber}`,
                cover: meta?.cover,
                watchedAt: ep.watchedAt,
                progress: ep.completed ? undefined : progressPercent,
                seriesId: String(ep.seriesId),
                seasonNumber: ep.seasonNumber,
                episodeNumber: ep.episodeNumber
            });
        });

        list.sort((a, b) => b.watchedAt - a.watchedAt);
        return list;
    }, [brutos, moviesById, seriesById, t]);

    const dayGroups = useMemo<DayGroup[]>(() => {
        const startOfDay = (timestamp: number) => {
            const d = new Date(timestamp);
            d.setHours(0, 0, 0, 0);
            return d.getTime();
        };

        const todayStart = startOfDay(now);
        const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

        const groups: DayGroup[] = [];
        const groupByDay = new Map<number, DayGroup>();

        entries.forEach((entry) => {
            const dayStart = startOfDay(entry.watchedAt);
            let group = groupByDay.get(dayStart);
            if (!group) {
                let label: string;
                if (dayStart === todayStart) {
                    label = t('history', 'today');
                } else if (dayStart === yesterdayStart) {
                    label = t('history', 'yesterday');
                } else {
                    label = new Date(dayStart).toLocaleDateString(t('home', 'locale'), {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long'
                    });
                }
                group = { label, entries: [] };
                groupByDay.set(dayStart, group);
                groups.push(group);
            }
            group.entries.push(entry);
        });

        return groups;
    }, [entries, t, now]);

    const formatWatchedTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString(t('home', 'locale'), {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleEntryClick = (entry: HistoryEntry) => {
        navigate(entry.kind === 'movie' ? '/dashboard/vod' : '/dashboard/series');
    };

    /** Apaga UMA linha, reusando o `clear*` que cada servico ja expunha. */
    const handleRemoveEntry = (entry: HistoryEntry) => {
        if (entry.kind === 'movie') {
            movieProgressService.clearMovieProgress(entry.movieId);
        } else {
            watchProgressService.clearEpisodeProgress(entry.seriesId, entry.seasonNumber, entry.episodeNumber);
        }
        recarregar();
    };

    const fecharConfirmacao = useCallback(() => setConfirmarLimpeza(false), []);

    /** Apaga TUDO: os dois `clearAllProgress()` que ja existiam sem chamador. */
    const handleClearAll = () => {
        movieProgressService.clearAllProgress();
        watchProgressService.clearAllProgress();
        setConfirmarLimpeza(false);
        recarregar();
    };

    // Dialogo de verdade, pelo hook que o app ja usa nos outros modais
    // (CreateProfileModal, UpdateModal, WrappedOverlay): papel, trava de foco,
    // Esc, devolucao do foco e o `data-overlay="modal"` que a navegacao por
    // setas e por controle leem para parar de andar pela pagina de tras.
    const { containerRef, dialogProps } = useDialogA11y({
        aberto: confirmarLimpeza,
        aoFechar: fecharConfirmacao,
        rotulo: `${t('watchLater', 'clearAll')} — ${t('history', 'title')}`,
    });

    const renderPosterPlaceholder = (entry: HistoryEntry) => (
        <div className="history-poster-fallback">
            <span>{entry.title.trim().charAt(0).toUpperCase() || '🎬'}</span>
        </div>
    );

    // Empty State
    if (entries.length === 0) {
        return (
            <>
                <style>{historyStyles}</style>
                <div className="history-page">
                    <div className="history-backdrop" />
                    <div className="history-empty-state">
                        <div className="history-empty-icon-container">
                            <div className="history-empty-icon">🕘</div>
                            <div className="history-empty-icon-glow" />
                        </div>
                        <h2 className="history-empty-title">{t('history', 'emptyTitle')}</h2>
                        <p className="history-empty-text">{t('history', 'emptyText')}</p>
                        <div className="history-empty-suggestions">
                            <button
                                className="history-suggestion-btn"
                                onClick={() => navigate('/dashboard/vod')}
                            >
                                <span>🎬</span>
                                <span>{t('history', 'exploreMovies')}</span>
                            </button>
                            <button
                                className="history-suggestion-btn"
                                onClick={() => navigate('/dashboard/series')}
                            >
                                <span>📺</span>
                                <span>{t('history', 'exploreSeries')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <style>{historyStyles}</style>
            <div className="history-page">
                <div className="history-backdrop" />

                {/* Header */}
                <header className="history-header">
                    <div className="history-header-title">
                        <div className="history-title-icon">🕘</div>
                        <div>
                            <h1>{t('history', 'title')}</h1>
                            <p className="history-subtitle">
                                {entries.length} {entries.length === 1 ? t('history', 'item') : t('history', 'items')}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="history-clear-all-btn"
                        onClick={() => setConfirmarLimpeza(true)}
                    >
                        <span aria-hidden="true">🗑️</span>
                        <span>{t('watchLater', 'clearAll')}</span>
                    </button>
                </header>

                {/* Day groups */}
                <div className="history-content">
                    {dayGroups.map((group, groupIndex) => (
                        <section key={group.label} className="history-day-group">
                            <h2 className="history-day-label">{group.label}</h2>
                            <div className="history-rows">
                                {group.entries.map((entry, index) => (
                                    <div
                                        key={entry.key}
                                        className="history-row"
                                        style={{ animationDelay: `${Math.min(groupIndex * 4 + index, 20) * 0.04}s` }}
                                        onClick={() => handleEntryClick(entry)}
                                    >
                                        <div className="history-poster">
                                            {entry.cover ? (
                                                <LazyImage
                                                    src={entry.cover.startsWith('http') ? entry.cover : `https://${entry.cover}`}
                                                    alt={entry.title}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                    fallback={renderPosterPlaceholder(entry)}
                                                />
                                            ) : (
                                                renderPosterPlaceholder(entry)
                                            )}
                                        </div>

                                        <div className="history-row-info">
                                            <span className="history-row-title">{entry.title}</span>
                                            <span className="history-row-meta">
                                                <span className={`history-kind-badge ${entry.kind}`}>
                                                    {entry.kind === 'movie' ? t('history', 'movie') : t('history', 'serie')}
                                                </span>
                                                {entry.progress !== undefined && (
                                                    <span className="history-progress-badge">
                                                        {entry.progress}% {t('history', 'watched')}
                                                    </span>
                                                )}
                                            </span>
                                        </div>

                                        <div className="history-row-time">
                                            {formatWatchedTime(entry.watchedAt)}
                                        </div>

                                        <button
                                            type="button"
                                            className="history-row-remove"
                                            title={t('playlists', 'remove')}
                                            aria-label={`${t('playlists', 'remove')}: ${entry.title}`}
                                            onClick={(event) => {
                                                // A linha inteira navega; sem isto o X
                                                // apagava E mandava a pessoa pra outra tela.
                                                event.stopPropagation();
                                                handleRemoveEntry(entry);
                                            }}
                                        >
                                            <span aria-hidden="true">✕</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                {confirmarLimpeza && (
                    <div className="history-confirm-overlay" onClick={fecharConfirmacao}>
                        <div
                            className="history-confirm"
                            ref={containerRef}
                            {...dialogProps}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <span className="history-confirm-icon" aria-hidden="true">🗑️</span>
                            <h2>{t('watchLater', 'clearAll')} — {t('history', 'title')}</h2>
                            <p>{t('profile', 'actionCannotBeUndone')}</p>
                            <div className="history-confirm-buttons">
                                {/* Cancelar vem PRIMEIRO no DOM de proposito: e nele
                                    que a trava de foco pousa ao abrir, nunca no
                                    botao destrutivo. */}
                                <button
                                    type="button"
                                    className="history-confirm-cancel"
                                    onClick={fecharConfirmacao}
                                >
                                    {t('common', 'cancel')}
                                </button>
                                <button
                                    type="button"
                                    className="history-confirm-danger"
                                    onClick={handleClearAll}
                                >
                                    {t('watchLater', 'clearAll')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

// CSS Styles
const historyStyles = `
/* Page Container */
.history-page {
    position: relative;
    min-height: 100vh;
    padding: 32px;
    overflow-x: hidden;
    background: linear-gradient(135deg, var(--ns-bg-deep) 0%, var(--ns-bg-panel) 50%, var(--ns-bg-tint) 100%);
}

/* Animated Backdrop */
.history-backdrop {
    position: fixed;
    inset: 0;
    background:
        radial-gradient(ellipse at 20% 20%, rgba(var(--ns-accent-rgb), 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 80%, rgba(var(--ns-accent-grad-to-rgb), 0.1) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 50%, rgba(59, 130, 246, 0.05) 0%, transparent 70%);
    pointer-events: none;
    z-index: 0;
    animation: historyBackdropPulse 8s ease-in-out infinite;
}

@keyframes historyBackdropPulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.8; }
}

/* Header */
.history-header {
    position: relative;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 32px;
    animation: historyFadeInDown 0.5s ease;
}

@keyframes historyFadeInDown {
    from {
        opacity: 0;
        transform: translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.history-header-title {
    display: flex;
    align-items: center;
    gap: 20px;
}

.history-title-icon {
    font-size: 48px;
    animation: historyIconBounce 2s ease-in-out infinite;
}

@keyframes historyIconBounce {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    25% { transform: translateY(-5px) rotate(-5deg); }
    75% { transform: translateY(-5px) rotate(5deg); }
}

.history-header-title h1 {
    font-size: 42px;
    font-weight: 800;
    color: white;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #fff 0%, var(--ns-accent-light) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.history-subtitle {
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    margin-top: 4px;
}

/* Limpar tudo */
.history-clear-all-btn {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 12px;
    color: #fca5a5;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s ease;
}

.history-clear-all-btn:hover {
    background: rgba(239, 68, 68, 0.22);
    border-color: rgba(239, 68, 68, 0.6);
    color: #fecaca;
}

.history-clear-all-btn:focus-visible,
.history-row-remove:focus-visible,
.history-confirm-cancel:focus-visible,
.history-confirm-danger:focus-visible {
    outline: 2px solid var(--ns-accent-light);
    outline-offset: 2px;
}

/* Content */
.history-content {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 32px;
}

.history-day-label {
    font-size: 18px;
    font-weight: 700;
    color: var(--ns-accent-light);
    margin: 0 0 14px 0;
    text-transform: capitalize;
}

.history-rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

/* Row */
.history-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.3s ease;
    animation: historyRowSlideIn 0.4s ease backwards;
}

@keyframes historyRowSlideIn {
    from {
        opacity: 0;
        transform: translateY(15px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.history-row:hover {
    background: rgba(var(--ns-accent-rgb), 0.1);
    border-color: rgba(var(--ns-accent-rgb), 0.4);
    transform: translateX(4px);
}

/* Poster thumb */
.history-poster {
    width: 48px;
    height: 72px;
    flex-shrink: 0;
    border-radius: 8px;
    overflow: hidden;
    background: linear-gradient(135deg, var(--ns-bg-panel) 0%, var(--ns-bg-deep) 100%);
}

.history-poster-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.3), rgba(var(--ns-accent-grad-to-rgb), 0.3));
    color: white;
    font-size: 22px;
    font-weight: 700;
}

/* Row info */
.history-row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.history-row-title {
    font-size: 15px;
    font-weight: 600;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.history-row:hover .history-row-title {
    color: var(--ns-accent-light);
}

.history-row-meta {
    display: flex;
    align-items: center;
    gap: 8px;
}

.history-kind-badge {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    color: white;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.history-kind-badge.movie {
    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
}

.history-kind-badge.episode {
    background: linear-gradient(135deg, var(--ns-accent) 0%, var(--ns-accent-dark) 100%);
}

.history-progress-badge {
    padding: 3px 8px;
    background: rgba(16, 185, 129, 0.2);
    border: 1px solid rgba(16, 185, 129, 0.4);
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: #34d399;
}

/* Watched time */
.history-row-time {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
}

/* X da linha */
.history-row-remove {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    font-size: 14px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s ease;
}

.history-row:hover .history-row-remove,
.history-row-remove:focus-visible {
    opacity: 1;
}

.history-row-remove:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.5);
    color: #fca5a5;
}

/* Confirmacao de limpar tudo */
.history-confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
}

.history-confirm {
    width: 90%;
    max-width: 440px;
    padding: 32px;
    text-align: center;
    border-radius: 24px;
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    border: 1px solid rgba(239, 68, 68, 0.25);
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
}

.history-confirm:focus-visible {
    outline: none;
}

.history-confirm-icon {
    display: block;
    font-size: 44px;
    margin-bottom: 12px;
}

.history-confirm h2 {
    margin: 0 0 12px 0;
    font-size: 22px;
    font-weight: 700;
    color: white;
}

.history-confirm p {
    margin: 0 0 26px 0;
    color: #9ca3af;
    line-height: 1.6;
}

.history-confirm-buttons {
    display: flex;
    gap: 12px;
}

.history-confirm-cancel,
.history-confirm-danger {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
}

.history-confirm-cancel {
    border: 2px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
}

.history-confirm-danger {
    border: none;
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: white;
    box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
}

/* Empty State */
.history-empty-state {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 80vh;
    text-align: center;
    animation: historyFadeIn 0.6s ease;
}

@keyframes historyFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.history-empty-icon-container {
    position: relative;
    margin-bottom: 32px;
}

.history-empty-icon {
    font-size: 100px;
    animation: historyFloatIcon 3s ease-in-out infinite;
}

@keyframes historyFloatIcon {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-15px); }
}

.history-empty-icon-glow {
    position: absolute;
    bottom: -20px;
    left: 50%;
    transform: translateX(-50%);
    width: 80px;
    height: 20px;
    background: radial-gradient(ellipse, rgba(var(--ns-accent-rgb), 0.4) 0%, transparent 70%);
    border-radius: 50%;
    animation: historyGlowPulse 3s ease-in-out infinite;
}

@keyframes historyGlowPulse {
    0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(1); }
    50% { opacity: 1; transform: translateX(-50%) scale(1.2); }
}

.history-empty-title {
    font-size: 32px;
    font-weight: 700;
    color: white;
    margin-bottom: 12px;
}

.history-empty-text {
    color: rgba(255, 255, 255, 0.6);
    font-size: 16px;
    max-width: 400px;
    line-height: 1.6;
    margin-bottom: 32px;
}

.history-empty-suggestions {
    display: flex;
    gap: 16px;
}

.history-suggestion-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 28px;
    background: linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.15) 0%, rgba(var(--ns-accent-grad-to-rgb), 0.15) 100%);
    border: 1px solid rgba(var(--ns-accent-rgb), 0.3);
    color: white;
    font-size: 15px;
    font-weight: 600;
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.history-suggestion-btn:hover {
    background: linear-gradient(135deg, rgba(var(--ns-accent-rgb), 0.25) 0%, rgba(var(--ns-accent-grad-to-rgb), 0.25) 100%);
    border-color: rgba(var(--ns-accent-rgb), 0.5);
    transform: translateY(-3px);
    box-shadow: 0 10px 30px rgba(var(--ns-accent-rgb), 0.2);
}

.history-suggestion-btn span:first-child {
    font-size: 20px;
}

/* Responsive */
@media (max-width: 600px) {
    .history-page {
        padding: 20px;
    }

    .history-header-title h1 {
        font-size: 32px;
    }

    .history-title-icon {
        font-size: 36px;
    }

    .history-row-time {
        font-size: 12px;
    }

    /* Sem hover no toque: o X fica sempre visivel. */
    .history-row-remove {
        opacity: 1;
    }

    .history-empty-suggestions {
        flex-direction: column;
        width: 100%;
    }

    .history-suggestion-btn {
        justify-content: center;
    }
}
`;
