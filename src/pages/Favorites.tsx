import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { favoritesService, type FavoriteItem } from '../services/favoritesService';
import { playlistService, type PlaylistSummary } from '../services/playlistService';
import { casarFavoritos, indicePorTitulo, type AlvoDoCatalogo } from '../services/favoritesTransfer';
import { asList } from '../utils/catalogPayload';
import { ContentDetailModal } from '../components/ContentDetailModal';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { ResumeModal } from '../components/ResumeModal';
import { LazyImage } from '../components/LazyImage';
import { watchProgressService } from '../services/watchProgressService';
import { movieProgressService } from '../services/movieProgressService';
import { useLanguage } from '../services/languageService';

interface ProviderEpisode {
    id: string | number;
    episode_num: string | number;
    container_extension?: string;
}

/** Pôster que o provedor não entregou (mesmo SVG do onError anterior). */
const POSTER_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgMTAwIDE1MCI+PHJlY3QgZmlsbD0iIzFmMjkzNyIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxNTAiLz48dGV4dCBmaWxsPSIjNGI1NTYzIiBmb250LXNpemU9IjQwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgeD0iNTAlIiB5PSI1MCUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj4/PC90ZXh0Pjwvc3ZnPg==';

/** Catalog favorites only — channel favorites live in LiveTV's ⭐ category. */
type CatalogFavorite = FavoriteItem & { type: 'series' | 'movie' };

const loadCatalogFavorites = (): CatalogFavorite[] =>
    favoritesService.getAll().filter(
        (item): item is CatalogFavorite => item.type !== 'channel'
    );

export function Favorites() {
    const [items, setItems] = useState<CatalogFavorite[]>(loadCatalogFavorites);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'all' | 'movies' | 'series'>('all');
    const navigate = useNavigate();
    const { t } = useLanguage();

    // Modal and player states
    const [selectedContent, setSelectedContent] = useState<{
        id: string;
        type: 'series' | 'movie';
        name: string;
        cover: string;
    } | null>(null);
    const [playingContent, setPlayingContent] = useState<{
        id: string;
        type: 'series' | 'movie';
        name: string;
        season?: number;
        episode?: number;
        resumeTime?: number;
    } | null>(null);
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [pendingPlay, setPendingPlay] = useState<{
        id: string;
        type: 'series' | 'movie';
        name: string;
        season?: number;
        episode?: number;
        currentTime: number;
        duration: number;
    } | null>(null);

    // ❤️ Copiar de outra lista: quem troca de provedor abre esta tela e acha o
    // vazio, com os favoritos antigos intactos e inalcançáveis atrás da lista
    // velha (os ids de stream não atravessam provedores — ver
    // activePlaylistService.ts). O casamento por título vive em
    // favoritesTransfer.ts, com teste.
    const [origens, setOrigens] = useState<{ playlist: PlaylistSummary; total: number }[]>([]);
    const [copiandoDe, setCopiandoDe] = useState<string | null>(null);
    const [resumoCopia, setResumoCopia] = useState<string | null>(null);

    const loadItems = useCallback(() => {
        setItems(loadCatalogFavorites());
    }, []);

    // Só quando a tela está vazia: é o único momento em que a oferta faz
    // sentido, e evita um IPC em toda visita à aba cheia.
    const telaVazia = items.length === 0;
    useEffect(() => {
        // Só sai — não zera. A lista de origens fica obsoleta depois da cópia,
        // mas ela só é RENDERIZADA na tela vazia, e zerar aqui seria um
        // setState síncrono dentro do efeito (um render a mais, por nada).
        if (!telaVazia) return;
        let vivo = true;
        void (async () => {
            const playlists = await playlistService.list().catch(() => [] as PlaylistSummary[]);
            if (!vivo) return;
            setOrigens(
                playlists
                    .filter(pl => !pl.active)
                    .map(pl => ({ playlist: pl, total: favoritesService.getAllFromPlaylist(pl.id).length }))
                    .filter(o => o.total > 0)
            );
        })();
        return () => { vivo = false; };
    }, [telaVazia]);

    const copiarDaPlaylist = async (origem: PlaylistSummary) => {
        setCopiandoDe(origem.id);
        setResumoCopia(null);
        try {
            const favoritosAntigos = favoritesService.getAllFromPlaylist(origem.id);
            // Os três catálogos do provedor ATIVO. Falha de um não derruba os
            // outros: quem não veio simplesmente não casa, e o favorito sai na
            // conta de "não encontrados" em vez de sumir sem explicação.
            const buscar = async (canal: string): Promise<AlvoDoCatalogo[]> => {
                const res = await window.ipcRenderer.invoke(canal).catch(() => null) as { success?: boolean; data?: unknown } | null;
                if (!res?.success) return [];
                return asList<Record<string, unknown>>(res.data).map(item => ({
                    id: String(item.stream_id ?? item.series_id ?? ''),
                    name: String(item.name ?? ''),
                    poster: typeof item.stream_icon === 'string' ? item.stream_icon
                        : typeof item.cover === 'string' ? item.cover : undefined,
                })).filter(alvo => alvo.id && alvo.name);
            };
            const [filmes, series, canais] = await Promise.all([
                buscar('streams:get-vod'),
                buscar('streams:get-series'),
                buscar('streams:get-live'),
            ]);

            const { copiar, semPar, jaEstavam } = casarFavoritos(
                favoritosAntigos,
                {
                    movie: indicePorTitulo(filmes),
                    series: indicePorTitulo(series),
                    channel: indicePorTitulo(canais),
                },
                (id, type) => favoritesService.has(id, type),
            );
            const entraram = favoritesService.addMany(copiar);
            loadItems();
            // `semPar` e `jaEstavam` significam coisas OPOSTAS e não podem ser
            // somados: semPar é o que este provedor não tem, jaEstavam é o que
            // ele tem e já estava favoritado aqui. Juntá-los faria a frase
            // dizer que títulos presentes "não estão neste provedor" — e como
            // este resumo é o único retorno da operação, o usuário sairia
            // refazendo à mão favoritos que já existem.
            const jaEstava = jaEstavam.length > 0
                ? ' ' + t('favoritesPage', 'copyAlreadyHere').replace('{n}', String(jaEstavam.length))
                : '';
            setResumoCopia(
                t('favoritesPage', 'copyDone')
                    .replace('{n}', String(entraram))
                    .replace('{semPar}', String(semPar.length))
                + jaEstava
            );
        } finally {
            setCopiandoDe(null);
        }
    };

    const removeItem = useCallback((id: string, type: 'series' | 'movie') => {
        setRemovingId(`${type}-${id}`);
        setTimeout(() => {
            favoritesService.remove(id, type);
            loadItems();
            setRemovingId(null);
        }, 300);
    }, [loadItems]);

    // Índices lidos UMA vez por render: os cards consultavam progresso de filme
    // e de série um a um, e cada consulta reparseava o histórico inteiro.
    const movieProgressById = movieProgressService.getProgressIndex();
    const seriesProgressById = watchProgressService.getSeriesProgressIndex();

    const formatRemainingTime = (currentTime: number, duration: number) => {
        const remaining = Math.max(0, duration - currentTime);
        const minutes = Math.floor(remaining / 60);
        if (minutes < 60) return `${minutes} ${t('home', 'minRemaining')}`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}min ${t('home', 'hRemaining').replace('h ', '')}`;
    };

    const handleItemClick = (item: CatalogFavorite) => {
        setSelectedContent({
            id: item.id,
            type: item.type,
            name: item.title,
            cover: item.poster || ''
        });
    };

    const clearAll = () => {
        favoritesService.clear();
        loadItems();
    };

    const movies = items.filter(item => item.type === 'movie');
    const series = items.filter(item => item.type === 'series');

    const displayItems = activeTab === 'all' ? items :
        activeTab === 'movies' ? movies : series;

    // Empty State
    if (items.length === 0) {
        return (
            <>
                <style>{favoritesStyles}</style>
                <div className="favorites-page">
                    <div className="favorites-backdrop" />
                    <div className="empty-state">
                        <div className="empty-icon-container">
                            <div className="empty-icon">❤️</div>
                            <div className="empty-icon-glow" />
                        </div>
                        <h2 className="empty-title">{t('favoritesPage', 'emptyTitle')}</h2>
                        <p className="empty-text">
                            {t('favoritesPage', 'emptyText')} <strong>{t('favoritesPage', 'emptyButton')}</strong>
                        </p>
                        {origens.length > 0 && (
                            <div style={{ margin: '4px 0 18px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, margin: 0 }}>
                                    {t('favoritesPage', 'copyFromOther')}
                                </p>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                                    {origens.map(({ playlist, total }) => (
                                        <button
                                            key={playlist.id}
                                            className="suggestion-btn"
                                            disabled={copiandoDe !== null}
                                            onClick={() => void copiarDaPlaylist(playlist)}
                                        >
                                            <span>❤️</span>
                                            <span>
                                                {copiandoDe === playlist.id
                                                    ? t('common', 'loading')
                                                    : `${playlist.name} (${total})`}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {resumoCopia && (
                            <p style={{ color: '#34d399', fontSize: 13, margin: '0 0 14px' }}>{resumoCopia}</p>
                        )}
                        <div className="empty-suggestions">
                            <button
                                className="suggestion-btn"
                                onClick={() => navigate('/dashboard/vod')}
                            >
                                <span>🎬</span>
                                <span>{t('favoritesPage', 'exploreMovies')}</span>
                            </button>
                            <button
                                className="suggestion-btn"
                                onClick={() => navigate('/dashboard/series')}
                            >
                                <span>📺</span>
                                <span>{t('favoritesPage', 'exploreSeries')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <style>{favoritesStyles}</style>
            <div className="favorites-page">
                <div className="favorites-backdrop" />

                {/* Header */}
                <header className="favorites-header">
                    <div className="header-title">
                        <div className="title-icon">❤️</div>
                        <div>
                            <h1>{t('favoritesPage', 'title')}</h1>
                            <p className="subtitle">{items.length} {t('favoritesPage', 'itemCount')}</p>
                        </div>
                    </div>
                    {items.length > 0 && (
                        <button className="clear-btn" onClick={clearAll}>
                            <span>🗑️</span>
                            <span>{t('favoritesPage', 'clearAll')}</span>
                        </button>
                    )}
                </header>

                {/* O resumo da cópia PRECISA aparecer aqui também: quando ela dá
                    certo a tela deixa de estar vazia no mesmo instante, e o
                    aviso que só existisse no estado vazio sumiria junto — o
                    usuário veria os favoritos voltarem sem saber quantos
                    ficaram de fora. */}
                {resumoCopia && (
                    <p style={{ color: '#34d399', fontSize: 13, margin: '0 26px 10px' }}>{resumoCopia}</p>
                )}

                {/* Tabs */}
                <div className="tabs-container">
                    <button
                        className={`tab ${activeTab === 'all' ? 'active' : ''}`}
                        onClick={() => setActiveTab('all')}
                    >
                        <span>{t('favoritesPage', 'all')}</span>
                        <span className="tab-count">{items.length}</span>
                    </button>
                    <button
                        className={`tab ${activeTab === 'movies' ? 'active' : ''}`}
                        onClick={() => setActiveTab('movies')}
                    >
                        <span>🎬 {t('favoritesPage', 'movies')}</span>
                        <span className="tab-count">{movies.length}</span>
                    </button>
                    <button
                        className={`tab ${activeTab === 'series' ? 'active' : ''}`}
                        onClick={() => setActiveTab('series')}
                    >
                        <span>📺 {t('favoritesPage', 'series')}</span>
                        <span className="tab-count">{series.length}</span>
                    </button>
                </div>

                {/* Cards Grid */}
                <div className="cards-grid">
                    {displayItems.map((item, index) => {
                        const movieProgress = item.type === 'movie' ? movieProgressById.get(item.id) : undefined;
                        const progressPercent = movieProgress ? Math.round((movieProgress.currentTime / movieProgress.duration) * 100) : 0;
                        const seriesProgress = item.type === 'series' ? seriesProgressById.get(item.id) : undefined;

                        // O escalonamento da entrada para no 12º card: com 300
                        // itens ele virava uma animação de 15 s.
                        return (
                            <div
                                key={`${item.type}-${item.id}`}
                                className={`card ${removingId === `${item.type}-${item.id}` ? 'removing' : ''}`}
                                style={{ animationDelay: `${Math.min(index, 12) * 0.05}s` }}
                                onClick={() => handleItemClick(item)}
                            >
                                <div className="card-poster">
                                    {/* LazyImage (IntersectionObserver, 200px de margem): com
                                        <img> cru o Chromium pedia e decodificava os 300 pôsteres
                                        de uma vez, inclusive os 20 telas abaixo. */}
                                    <div className="card-poster-img">
                                        <LazyImage
                                            src={item.poster}
                                            alt={item.title}
                                            fallback={<img src={POSTER_PLACEHOLDER} alt="" />}
                                        />
                                    </div>
                                    <div className="card-type">
                                        {item.type === 'movie' ? '🎬' : '📺'}
                                    </div>
                                    <div className="card-overlay">
                                        <button
                                            className="remove-btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeItem(item.id, item.type);
                                            }}
                                        >
                                            <span>🗑️</span>
                                        </button>
                                    </div>

                                    {/* Progress Bar for movies */}
                                    {movieProgress && progressPercent > 0 && (
                                        <div className="card-progress-container">
                                            <div
                                                className="card-progress-bar"
                                                style={{ width: `${progressPercent}%` }}
                                            />
                                        </div>
                                    )}

                                    {/* Remaining Time Badge (shown on hover) */}
                                    {movieProgress && movieProgress.currentTime > 0 && progressPercent < 95 && (
                                        <div className="remaining-time-badge">
                                            {formatRemainingTime(movieProgress.currentTime, movieProgress.duration)}
                                        </div>
                                    )}

                                    {/* Series episode info */}
                                    {seriesProgress && (
                                        <div className="episode-badge">
                                            T{seriesProgress.lastWatchedSeason} E{seriesProgress.lastWatchedEpisode}
                                        </div>
                                    )}
                                </div>
                                <div className="card-info">
                                    <h3 className="card-title">{item.title}</h3>
                                    <div className="card-meta">
                                        {item.year && <span>{item.year}</span>}
                                        {item.rating && <span>⭐ {item.rating}</span>}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Content Detail Modal */}
            {selectedContent && (
                <ContentDetailModal
                    isOpen={!!selectedContent}
                    onClose={() => setSelectedContent(null)}
                    contentId={selectedContent.id}
                    contentType={selectedContent.type}
                    contentData={selectedContent}
                    onPlay={(season, episode) => {
                        if (selectedContent.type === 'series') {
                            const progress = watchProgressService.getEpisodeProgress(
                                selectedContent.id,
                                season || 1,
                                episode || 1
                            );
                            const progressPercent = progress ? Math.round((progress.currentTime / progress.duration) * 100) : 0;

                            if (progress && progress.currentTime > 10 && progressPercent < 95) {
                                setPendingPlay({
                                    id: selectedContent.id,
                                    type: 'series',
                                    name: selectedContent.name,
                                    season: season,
                                    episode: episode,
                                    currentTime: progress.currentTime,
                                    duration: progress.duration
                                });
                                setShowResumeModal(true);
                                setSelectedContent(null);
                            } else {
                                setPlayingContent({
                                    id: selectedContent.id,
                                    type: 'series',
                                    name: selectedContent.name,
                                    season: season,
                                    episode: episode
                                });
                                setSelectedContent(null);
                            }
                        } else {
                            const movieProgress = movieProgressService.getMoviePositionById(selectedContent.id);
                            setPlayingContent({
                                id: selectedContent.id,
                                type: 'movie',
                                name: selectedContent.name,
                                resumeTime: movieProgress?.currentTime || 0
                            });
                            setSelectedContent(null);
                        }
                    }}
                />
            )}

            {/* Video Player */}
            {playingContent && (
                <AsyncVideoPlayer
                    movie={playingContent}
                    buildStreamUrl={async (content) => {
                        const result = await window.ipcRenderer.invoke('auth:get-credentials');
                        if (result.success) {
                                        if (content.type === 'series') {
                                // Episodes + play URL via IPC (Xtream, M3U e Stalker).
                                const infoResult = await window.ipcRenderer.invoke('series:get-info', { seriesId: content.id }) as {
                                    success: boolean; info?: { episodes?: Record<string, ProviderEpisode[]> };
                                };
                                const episodes = infoResult.info?.episodes?.[content.season || 1];
                                const episode = episodes?.find((ep: ProviderEpisode) => Number(ep.episode_num) === (content.episode || 1));
                                if (episode) {
                                    const urlResult = await window.ipcRenderer.invoke('streams:get-series-url', {
                                        streamId: episode.id,
                                        container: episode.container_extension || 'mp4'
                                    }) as { success: boolean; url?: string };
                                    if (urlResult.success && urlResult.url) return urlResult.url;
                                }
                                throw new Error('Episode not found');
                            } else {
                                // Movie URL via IPC (Xtream, M3U e Stalker).
                                const urlResult = await window.ipcRenderer.invoke('streams:get-vod-url', {
                                    streamId: content.id,
                                    container: 'mp4'
                                }) as { success: boolean; url?: string };
                                if (urlResult.success && urlResult.url) return urlResult.url;
                                throw new Error('Movie not found');
                            }
                        }
                        throw new Error('Credentials not found');
                    }}
                    onClose={() => setPlayingContent(null)}
                    customTitle={playingContent.type === 'series'
                        ? `${playingContent.name} - T${playingContent.season} E${playingContent.episode}`
                        : playingContent.name
                    }
                    seriesId={playingContent.type === 'series' ? playingContent.id : undefined}
                    seasonNumber={playingContent.season}
                    episodeNumber={playingContent.episode}
                    resumeTime={playingContent.resumeTime || null}
                />
            )}

            {/* Resume Modal */}
            {showResumeModal && pendingPlay && (
                <ResumeModal
                    seriesName={pendingPlay.name}
                    seasonNumber={pendingPlay.season || 1}
                    episodeNumber={pendingPlay.episode || 1}
                    currentTime={pendingPlay.currentTime}
                    duration={pendingPlay.duration}
                    onResume={() => {
                        setPlayingContent({
                            id: pendingPlay.id,
                            type: pendingPlay.type,
                            name: pendingPlay.name,
                            season: pendingPlay.season,
                            episode: pendingPlay.episode,
                            resumeTime: pendingPlay.currentTime
                        });
                        setShowResumeModal(false);
                        setPendingPlay(null);
                    }}
                    onRestart={() => {
                        setPlayingContent({
                            id: pendingPlay.id,
                            type: pendingPlay.type,
                            name: pendingPlay.name,
                            season: pendingPlay.season,
                            episode: pendingPlay.episode,
                            resumeTime: 0
                        });
                        setShowResumeModal(false);
                        setPendingPlay(null);
                    }}
                    onCancel={() => {
                        setShowResumeModal(false);
                        setPendingPlay(null);
                    }}
                />
            )}
        </>
    );
}

const favoritesStyles = `
/* Page Container */
.favorites-page {
    position: relative;
    min-height: 100vh;
    padding: 32px;
    padding-left: 60px;
}

/* Animated Backdrop */
.favorites-backdrop {
    position: fixed;
    inset: 0;
    background: linear-gradient(135deg, var(--ns-bg-deep) 0%, var(--ns-bg-panel) 50%, var(--ns-bg-tint) 100%);
    z-index: 0;
}

.favorites-backdrop::before {
    content: '';
    position: absolute;
    inset: 0;
    background: 
        radial-gradient(ellipse at 20% 20%, rgba(239, 68, 68, 0.12) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 80%, rgba(236, 72, 153, 0.08) 0%, transparent 50%);
    animation: backdropPulse 8s ease-in-out infinite;
}

@keyframes backdropPulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.8; }
}

/* Header */
.favorites-header {
    position: relative;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 32px;
    animation: fadeInDown 0.5s ease;
}

@keyframes fadeInDown {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
}

.header-title {
    display: flex;
    align-items: center;
    gap: 16px;
}

.title-icon {
    font-size: 42px;
    animation: heartBeat 2s ease-in-out infinite;
}

@keyframes heartBeat {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
}

.favorites-header h1 {
    font-size: 36px;
    font-weight: 800;
    background: linear-gradient(135deg, #fff 0%, #fca5a5 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin: 0;
}

.subtitle {
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    margin-top: 4px;
}

.clear-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 10px;
    color: #fca5a5;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
}

.clear-btn:hover {
    background: rgba(239, 68, 68, 0.25);
    transform: translateY(-2px);
}

/* Tabs */
.tabs-container {
    position: relative;
    z-index: 10;
    display: flex;
    gap: 12px;
    margin-bottom: 32px;
    animation: fadeIn 0.5s ease 0.1s backwards;
}

.tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
}

.tab:hover {
    background: rgba(255, 255, 255, 0.1);
}

.tab.active {
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(236, 72, 153, 0.15));
    border-color: rgba(239, 68, 68, 0.3);
    color: white;
}

.tab-count {
    background: rgba(255, 255, 255, 0.1);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
}

.tab.active .tab-count {
    background: rgba(239, 68, 68, 0.3);
}

/* Cards Grid */
.cards-grid {
    position: relative;
    z-index: 10;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
}

/* Card */
.card {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    animation: cardSlideIn 0.4s ease backwards;
}

@keyframes cardSlideIn {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}

.card:hover {
    transform: translateY(-8px) scale(1.02);
    border-color: rgba(239, 68, 68, 0.3);
    box-shadow: 0 20px 40px -15px rgba(239, 68, 68, 0.2);
}

.card.removing {
    opacity: 0;
    transform: scale(0.8);
}

.card-poster {
    position: relative;
    aspect-ratio: 2/3;
    overflow: hidden;
}

/* Wrapper do LazyImage: o componente traz um <div> de 100%×100%, então este
   aqui é quem lhe dá a caixa do pôster dentro do .card-poster. */
.card-poster-img {
    position: absolute;
    inset: 0;
}

.card-poster img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s ease;
}

.card:hover .card-poster img {
    transform: scale(1.1);
}

.card-type {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 14px;
}

.card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 50%);
    opacity: 0;
    transition: opacity 0.3s ease;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 12px;
}

.card:hover .card-overlay {
    opacity: 1;
}

.remove-btn {
    width: 40px;
    height: 40px;
    background: rgba(239, 68, 68, 0.8);
    border: none;
    border-radius: 50%;
    font-size: 18px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
}

.remove-btn:hover {
    background: #ef4444;
    transform: scale(1.1);
}

/* Card Progress Bar */
.card-progress-container {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: rgba(0, 0, 0, 0.6);
}

.card-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #ef4444, #ec4899);
    transition: width 0.3s ease;
}

/* Remaining Time Badge */
.remaining-time-badge {
    position: absolute;
    top: 50px;
    left: 10px;
    padding: 6px 10px;
    background: rgba(16, 185, 129, 0.9);
    backdrop-filter: blur(4px);
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: white;
    opacity: 0;
    transform: translateY(-5px);
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    z-index: 15;
}

.card:hover .remaining-time-badge {
    opacity: 1;
    transform: translateY(0);
}

/* Episode Badge for series */
.episode-badge {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 11px;
    font-weight: 600;
    color: white;
    text-align: center;
}

.card-info {
    padding: 16px;
}

.card-title {
    font-size: 14px;
    font-weight: 600;
    color: white;
    margin: 0 0 8px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.card-meta {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
}

/* Empty State */
.empty-state {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    text-align: center;
    padding: 40px;
    animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.empty-icon-container {
    position: relative;
    margin-bottom: 24px;
}

.empty-icon {
    font-size: 80px;
    animation: heartBeat 2s ease-in-out infinite;
}

.empty-icon-glow {
    position: absolute;
    inset: -20px;
    background: radial-gradient(circle, rgba(239, 68, 68, 0.3) 0%, transparent 60%);
    border-radius: 50%;
    animation: glowPulse 3s ease-in-out infinite;
}

@keyframes glowPulse {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.1); }
}

.empty-title {
    font-size: 28px;
    font-weight: 700;
    color: white;
    margin: 0 0 12px 0;
}

.empty-text {
    color: rgba(255, 255, 255, 0.6);
    font-size: 16px;
    max-width: 400px;
    margin: 0 0 32px 0;
    line-height: 1.6;
}

.empty-suggestions {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
}

.suggestion-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 24px;
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(236, 72, 153, 0.2));
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 12px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
}

.suggestion-btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 30px rgba(239, 68, 68, 0.2);
}
`;
