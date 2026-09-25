import { useState, useEffect, useRef, useMemo } from 'react';
import { SortSelect } from '../components/SortSelect';
import { CatalogFilters } from '../components/CatalogFilters';
import { fuzzyIncludes, matchesFilters, qualityBadgeOf } from '../utils/catalogFilter';
import { compareCatalogItems, type CatalogSort } from '../utils/catalogSort';
import { watchLaterService } from '../services/watchLater';
import { favoritesService } from '../services/favoritesService';
import { newEpisodesService } from '../services/newEpisodesService';
import { watchProgressService } from '../services/watchProgressService';
import { syncTraktEpisodeWatched } from '../services/traktService';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';
import { CategoryMenu } from '../components/CategoryMenu';
import { ResumeModal } from '../components/ResumeModal';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { idsComTag } from '../services/personalMarksService';
import { profileService } from '../services/profileService';
import { useEpisodeTitle } from '../hooks/useEpisodeTitle';
import { useContentFiltering } from '../hooks/useContentFiltering';
import { useWindowedGrid } from '../hooks/useWindowedGrid';
import { useResetOnFilterChange } from '../hooks/useResetOnFilterChange';
import { HoverPreviewCard } from '../components/HoverPreviewCard';
import { closeAllPreviews } from '../components/hoverPreviewActions';
import { useLanguage } from '../services/languageService';
import { isRecentlyAdded } from '../services/catalogNew';
import { GLOBAL_SEARCH_TERM_KEY, GLOBAL_SEARCH_OPEN_KEY, GLOBAL_SEARCH_EVENT } from '../components/GlobalSearch';
import { fichaLiberada } from '../services/abrirFicha';

import { asList } from '../utils/catalogPayload';
interface Series {
    num: number;
    name: string;
    series_id: number;
    stream_icon: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    release_date: string;
    last_modified: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    category_id: string | string[];
    tmdb_id: string;
}

// Formato do `series:get-info` que a página guarda para o player (URL do
// episódio, próximo/anterior, título). Morava no antigo `SeriesDetailPanel`,
// que saiu da tela no #D047; a ficha declara o mesmo formato por conta própria.
interface SeriesEpisode {
    id: number | string;
    episode_num: number | string;
    title?: string;
    container_extension?: string;
}

interface SeriesInfo {
    episodes?: Record<string, SeriesEpisode[]>;
}

const CARD_MIN_WIDTH = 180;
const CARD_GAP = 24;

export function Series() {
    const [series, setSeries] = useState<Series[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<CatalogSort>('recent');
    // 🔎 Filtros de década e gênero — aplicados antes da ordenação.
    const [decade, setDecade] = useState<number | null>(null);
    const [genreFilter, setGenreFilter] = useState<string | null>(null);
    // 🏷️ Filtro por tag pessoal (mesmo par do VOD). O tick refaz a conta
    // quando a ficha fecha — marcar na ficha reflete aqui sem trocar de tela.
    const [tagFilter, setTagFilter] = useState<string | null>(null);
    const [tagsTick, setTagsTick] = useState(0);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedSeries, setSelectedSeries] = useState<Series | null>(null);
    const [playingSeries, setPlayingSeries] = useState<Series | null>(null);
    // Caminho do episodio baixado, quando a ficha resolveu um (ver handlePlaySeries).
    const [offlineEpisodeUrl, setOfflineEpisodeUrl] = useState<string | null>(null);
    const [pipResumeTime, setPipResumeTime] = useState<number | null>(null);
    const [selectedSeason, setSelectedSeason] = useState<number>(1);
    const [selectedEpisode, setSelectedEpisode] = useState<number>(1);
    const [seriesInfo, setSeriesInfo] = useState<SeriesInfo | null>(null);
    const [visibleCount, setVisibleCount] = useState(0);
    const [itemsPerPage, setItemsPerPage] = useState(36);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    // Resume modal state
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [resumeModalData, setResumeModalData] = useState<{
        currentTime: number;
        duration: number;
    } | null>(null);

    const isKidsProfile = profileService.getActiveProfile()?.isKids || false;
    const { t } = useLanguage();
    // Congelado por sessão da página (regra de pureza) — base do selo NOVO.
    const [nowMs] = useState(() => Date.now());

    // 📺 Nome do episódio que está TOCANDO (título do player). A ficha
    // (ContentDetailModal) já resolve a série no TMDB e lista os episódios; a
    // página não mantém uma segunda cópia disso escondida atrás dela (#D047).
    // Sem série tocando não há `tmdb_id` aqui, e o hook não vai ao TMDB.
    const playingEpisodeTitle = useEpisodeTitle(
        playingSeries?.tmdb_id,
        selectedSeason,
        selectedEpisode,
        seriesInfo?.episodes?.[selectedSeason]
    );

    // Kids profile + Parental Control filtering and click-gating
    const {
        checkingItem,
        blockMessage,
        isItemVisible,
        handleItemClick: handleSeriesClick
    } = useContentFiltering<Series>({
        contentType: 'series',
        isKidsProfile,
        items: series,
        getItemName: (s) => s.name,
        getItemCategoryIds: (s) => Array.isArray(s.category_id) ? s.category_id : [s.category_id],
        onAllowed: (s) => {
            // Opening the series consumes its "new episodes" badge.
            newEpisodesService.markSeen(s.series_id, s.last_modified);
            setUpdatedSeriesIds(prev => {
                if (!prev.has(String(s.series_id))) return prev;
                const next = new Set(prev);
                next.delete(String(s.series_id));
                return next;
            });
            setSelectedSeries(s);
        }
    });

    // Close any open previews when this page mounts
    useEffect(() => {
        closeAllPreviews();
    }, []);

    // Reset on filter change: busca/categoria fecham a ficha e voltam ao topo;
    // o recálculo da grade (resize, os 200 ms) só reajusta o visibleCount.
    // Fica ANTES do efeito do pendingOpenId (ver o hook).
    useResetOnFilterChange({
        searchQuery,
        selectedCategory,
        itemsPerPage,
        setVisibleCount,
        setSelection: setSelectedSeries,
        scrollRef: scrollContainerRef,
    });

    // Global search term-bridge: consume (read + remove) the term stored by
    // the Ctrl+K overlay, both on mount (cross-page navigation) and on the
    // event (already on this page).
    // Ficha pendente de abrir (id vindo da busca global ou do modal).
    const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

    useEffect(() => {
        const consumeGlobalSearchTerm = () => {
            const term = sessionStorage.getItem(GLOBAL_SEARCH_TERM_KEY);
            if (term !== null) {
                sessionStorage.removeItem(GLOBAL_SEARCH_TERM_KEY);
                setSearchQuery(term);
            }
            // Item clicado na busca (ou nos Parecidos do modal): abre a ficha.
            const openRaw = sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY);
            if (openRaw !== null) {
                try {
                    const open = JSON.parse(openRaw) as { kind?: string; id?: number | string };
                    if (open?.kind === 'series' && open.id != null) {
                        sessionStorage.removeItem(GLOBAL_SEARCH_OPEN_KEY);
                        setPendingOpenId(String(open.id));
                    }
                } catch {
                    sessionStorage.removeItem(GLOBAL_SEARCH_OPEN_KEY);
                }
            }
        };
        consumeGlobalSearchTerm();
        window.addEventListener(GLOBAL_SEARCH_EVENT, consumeGlobalSearchTerm);
        return () => window.removeEventListener(GLOBAL_SEARCH_EVENT, consumeGlobalSearchTerm);
    }, []);

    // Abre a ficha pendente quando a lista chega (a navegação pode vencer o fetch).
    useEffect(() => {
        if (!pendingOpenId || series.length === 0) return;
        // 🔒 O id vem de FORA da grade (busca global, "Parecidos" da ficha, o
        // aviso de novos episódios) e `series` é a lista CRUA: resolver e abrir
        // direto entregava a ficha de uma série que a grade esconde. Mesmo gate
        // da grade.
        const hit = fichaLiberada(pendingOpenId, series, s => s.series_id, isItemVisible);
        queueMicrotask(() => {
            setPendingOpenId(null);
            if (hit) setSelectedSeries(hit);
        });
    // isItemVisible é recriado a cada render e lê estado de parental/perfil que
    // só muda por troca de perfil ou ajuste — o que remonta esta página. Nas
    // deps ele reagendaria a abertura a cada render; mesmo recurso que o filtro
    // da grade usa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingOpenId, series]);

    // Listen for mini player expand event to reopen full player
    useEffect(() => {
        const handleMiniPlayerExpand = (e: CustomEvent) => {
            const { contentId, contentType, currentTime, seasonNumber: season, episodeNumber: episode } = e.detail;
            if (contentType === 'series' && contentId) {
                // Find the series in our list
                const foundSeries = series.find((s: Series) => s.series_id.toString() === contentId);
                if (foundSeries) {
                    // Set the season and episode to match PiP state
                    if (season !== undefined) setSelectedSeason(season);
                    if (episode !== undefined) setSelectedEpisode(episode);
                    setPipResumeTime(currentTime || 0);
                    setPlayingSeries(foundSeries);
                }
            }
        };

        window.addEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
        return () => window.removeEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
    }, [series]);

    // Dynamic grid calculation based on window dimensions
    useEffect(() => {
        const calculateGrid = () => {
            // Use window dimensions directly - more reliable
            const availableWidth = window.innerWidth - 100; // sidebar + padding
            const availableHeight = window.innerHeight - 200; // header + details panel buffer

            const cols = Math.max(2, Math.floor(availableWidth / (CARD_MIN_WIDTH + CARD_GAP)));
            const rows = Math.max(3, Math.ceil(availableHeight / 320) + 3); // card height ~280px + gap

            const items = cols * rows;

            setItemsPerPage(items);
            setVisibleCount(items);
        };

        // Initial calculation
        calculateGrid();

        // Recalculate after layout is ready
        const recalculo = setTimeout(calculateGrid, 200);

        // Listen to window resize
        window.addEventListener('resize', calculateGrid);

        return () => {
            // Sair da página antes dos 200 ms não deixa o recálculo rodar depois.
            clearTimeout(recalculo);
            window.removeEventListener('resize', calculateGrid);
        };
    }, []);

    const fetchSeries = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await window.ipcRenderer.invoke('streams:get-series');
            if (result.success) {
                setSeries(asList<Series>(result.data));
            } else {
                setError(result.error || 'Failed to load series');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Deferred: fetchSeries flips loading state synchronously on entry.
        queueMicrotask(() => { void fetchSeries(); });
    }, []);

    // Memoized so a big library isn't re-sorted/re-filtered on every render
    // (notably on every scroll frame — the windowed grid updates scrollTop state).
    const sortedSeries = useMemo(
        () => {
            const porFiltro = (decade !== null || genreFilter)
                ? series.filter(item => matchesFilters(item, decade, genreFilter))
                : series;
            // Uma leitura de storage para a grade inteira, nao uma por card.
            const comTag = tagFilter ? idsComTag(tagFilter) : null;
            const base = comTag
                ? porFiltro.filter(item => comTag.has(`series:${item.series_id}`))
                : porFiltro;
            return sortBy === 'recent' ? base : [...base].sort((a, b) => compareCatalogItems(sortBy, a, b));
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `tagsTick` força a releitura; as marcas vivem no localStorage, fora do React
        [series, sortBy, decade, genreFilter, tagFilter, tagsTick]
    );

    // 🙈 Esconder assistidos: só sai da grade a série CONCLUÍDA — todo episódio
    // que o PROVEDOR tem foi visto até o fim. O critério daqui era "todo
    // episódio REGISTRADO está completo", e registro só existe pro que foi
    // aberto: ver o 1º episódio de dez dava 1 de 1 e a série inteira sumia.
    // Mesmo denominador do selo ✓ e da categoria 🏆 (`isSeriesCompleted`).
    const [hideWatched, setHideWatchedState] = useState(() => localStorage.getItem('neostream_hide_watched') === 'on');
    const watchedSeriesIds = useMemo(() => {
        if (!hideWatched) return new Set<string>();
        return watchProgressService.getCompletedSeriesIds();
    }, [hideWatched]);

    const filteredSeries = useMemo(() => {
        // 🗂️ Mesmo motivo da VOD: `getContinueWatching()` varre o histórico de
        // episódios inteiro e montava um Map novo DENTRO do callback do
        // `.filter()`, que roda por item — "Continuar assistindo" custava
        // O(catálogo × histórico).
        const emProgresso = selectedCategory === 'CONTINUE_WATCHING'
            ? watchProgressService.getContinueWatching()
            : null;
        return sortedSeries.filter(s => {
            const matchesSearch = fuzzyIncludes(s.name, searchQuery);
            // A categoria 🏆 É a lista de concluídas: se o 🙈 também as tirasse
            // daqui, ela abriria vazia sempre que o botão estivesse ligado (e
            // o botão é o mesmo flag da grade de Filmes, que já poupa a sua
            // categoria de assistidos — VOD.tsx, `selectedCategory !== 'WATCHED'`).
            if (hideWatched && selectedCategory !== 'COMPLETED' && watchedSeriesIds.has(String(s.series_id))) {
                return false;
            }

            // Kids profile + Parental Control filtering
            if (!isItemVisible(s)) {
                return false;
            }

            if (emProgresso) {
                return matchesSearch && emProgresso.has(String(s.series_id));
            }

            if (selectedCategory === 'COMPLETED') {
                return matchesSearch && watchProgressService.isSeriesCompleted(String(s.series_id));
            }

            const categories = Array.isArray(s.category_id) ? s.category_id : [s.category_id];
            const matchesCategory = !selectedCategory || selectedCategory === '' || selectedCategory === 'all' || categories.includes(selectedCategory);
            return matchesSearch && matchesCategory;
        });
    // isItemVisible reads parental/kids state that only changes via a profile/
    // settings switch (which reloads the library), so it's intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sortedSeries, searchQuery, selectedCategory, hideWatched, watchedSeriesIds]);

    // Windowed rendering (same mechanism as VOD): spacer rows keep the
    // scrollbar honest while only ~3 screens of cards stay mounted.
    const gridWindow = useWindowedGrid({
        scrollRef: scrollContainerRef,
        gridRef,
        itemCount: filteredSeries.length
    });
    const windowStart = gridWindow.ready ? gridWindow.start : 0;
    const windowEnd = gridWindow.ready ? gridWindow.end : Math.min(visibleCount, filteredSeries.length);

    // Listas de estado do usuário lidas UMA vez por render, não por card (o
    // mesmo motivo da VOD: cada card fazia getItem+JSON.parse do histórico
    // inteiro). Os serviços devolvem a MESMA referência enquanto o localStorage
    // não muda, então indexar com useMemo sobre elas não congela dado velho.
    const watchLaterEntries = watchLaterService.getAll();
    const savedSeriesIds = useMemo(
        () => new Set(watchLaterEntries.filter(i => i.type === 'series').map(i => i.id)),
        [watchLaterEntries]
    );
    const seriesProgressIndex = watchProgressService.getSeriesProgressIndex();

    // Followed series (favorites/in progress) whose provider last_modified
    // bumped since the user last opened them → "new episodes" badge.
    const [updatedSeriesIds, setUpdatedSeriesIds] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (series.length === 0) return;
        queueMicrotask(() => {
            const followed = new Set<string>([
                ...favoritesService.getAll().filter(f => f.type === 'series').map(f => f.id),
                ...watchProgressService.getContinueWatching().keys()
            ]);
            const updated = newEpisodesService.getUpdatedSeries(series, followed);
            setUpdatedSeriesIds(new Set(updated.map(u => String(u.series_id))));
        });
    }, [series]);

    const fixImageUrl = (url: string): string => url && url.startsWith('http') ? url : `https://${url}`;

    // Season/episode entram por parâmetro: quem chama pode ter acabado de fazer
    // setSelectedSeason/Episode no mesmo tick, e o state ainda seria o antigo —
    // o prompt de retomada acabava mostrando o progresso de outro episódio.
    const handlePlaySeries = (
        seriesItem: Series,
        season = selectedSeason,
        episode = selectedEpisode,
        offlineUrl?: string
    ) => {
        // 📥 O caminho do arquivo baixado chega da ficha e precisa sobreviver
        // até o buildSeriesStreamUrl: a ficha já resolvia o arquivo, pintava o
        // botão de ciano e escrevia "Offline T1 E1" — e a página jogava o
        // terceiro parâmetro fora, tocando o stream do provedor. Quem baixou o
        // episódio para ver sem internet via exatamente o oposto do prometido.
        setOfflineEpisodeUrl(offlineUrl ?? null);
        // Check for existing progress
        const progress = watchProgressService.getEpisodeProgress(
            String(seriesItem.series_id),
            season,
            episode
        );
        const progressPercent = progress ? Math.round((progress.currentTime / progress.duration) * 100) : 0;
        if (progress && progress.currentTime > 10 && progressPercent < 95) {
            // Has meaningful progress, show resume modal
            setResumeModalData({
                currentTime: progress.currentTime,
                duration: progress.duration
            });
            setShowResumeModal(true);
        } else {
            // No progress or completed, play directly
            setPlayingSeries(seriesItem);
        }
    };

    const buildSeriesStreamUrl = async (seriesItem: Series): Promise<string> => {
        void seriesItem;
        // Arquivo no disco vence o provedor — mesmo desenho do VOD.tsx, que já
        // devolve `movie.offlineUrl` antes de pedir a URL do stream.
        if (offlineEpisodeUrl) return offlineEpisodeUrl;
        try {
            const episodes = seriesInfo?.episodes?.[selectedSeason];
            const episode = episodes?.find((ep) => Number(ep.episode_num) === selectedEpisode);
            if (episode) {
                // Episode URL via IPC (Xtream, M3U e Stalker).
                const urlResult = await window.ipcRenderer.invoke('streams:get-series-url', {
                    streamId: episode.id,
                    container: episode.container_extension || 'mp4'
                }) as { success: boolean; url?: string };
                if (urlResult.success && urlResult.url) return urlResult.url;
            }
            throw new Error('Credenciais não encontradas');
        } catch (error) {
            console.error('❌ Error building series stream URL:', error);
            throw error;
        }
    };

    // Fetch series info when series is selected
    useEffect(() => {
        if (selectedSeries) {
            // Main process resolves per playlist type (Xtream proxy / M3U grouping).
            window.ipcRenderer.invoke('series:get-info', { seriesId: selectedSeries.series_id })
                .then((result: { success: boolean; info?: unknown }) => {
                    if (!result.success || result.info === undefined || result.info === null) {
                        setSeriesInfo(null);
                        return;
                    }
                    setSeriesInfo(result.info as Parameters<typeof setSeriesInfo>[0]);
                    const lastWatched = watchProgressService.getLastWatchedEpisode(String(selectedSeries.series_id));
                    if (lastWatched) {
                        setSelectedSeason(lastWatched.season);
                        setSelectedEpisode(lastWatched.episode);
                    } else {
                        setSelectedSeason(1);
                        setSelectedEpisode(1);
                    }
                })
                .catch(() => setSeriesInfo(null));
        } else {
            queueMicrotask(() => setSeriesInfo(null));
        }
    }, [selectedSeries]);

    // Loading State
    if (loading) return (
        <div className="series-page">
            <style>{seriesStyles}</style>
            <div className="series-loading">
                <div className="loading-grid">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 0.05}s` }}>
                            <div className="skeleton-poster" />
                            <div className="skeleton-title" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    // Error State
    if (error) return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 20px',
            background: 'linear-gradient(135deg, #0a0a0f 0%, #0d0d15 50%, #0a0f1a 100%)',
            position: 'relative',
            overflow: 'hidden'
        }}>
            <div style={{
                position: 'absolute',
                width: '400px',
                height: '400px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, transparent 70%)',
                filter: 'blur(80px)',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)'
            }} />
            <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '400px' }}>
                <div style={{
                    width: '80px', height: '80px',
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%)',
                    borderRadius: '20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 24px',
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                }}>
                    <span style={{ fontSize: '36px' }}>📺</span>
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'white', margin: '0 0 8px 0' }}>
                    {t('login', 'loadSeriesError')}
                </h2>
                <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: '0 0 8px 0' }}>
                    {t('login', 'connectionErrorDetails')}
                </p>
                <p style={{
                    fontSize: '13px', color: '#f87171', margin: '0 0 32px 0',
                    padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)'
                }}>{error === 'Not authenticated' ? t('login', 'notAuthenticated') : error}</p>
                <button onClick={fetchSeries} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: '14px 28px', background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                    border: 'none', borderRadius: '12px', color: 'white', fontSize: '15px', fontWeight: 600,
                    cursor: 'pointer', boxShadow: '0 8px 32px rgba(239, 68, 68, 0.3)'
                }}>
                    <span>🔄</span> {t('profile', 'tryAgain')}
                </button>
            </div>
        </div>
    );

    const backdropUrl = selectedSeries ? (
        selectedSeries.cover || fixImageUrl(selectedSeries.stream_icon)
    ) : null;

    return (
        <>
            <style>{seriesStyles}</style>
            <div className="series-page">
                {/* Dynamic Background */}
                {backdropUrl && (
                    <div
                        className="series-backdrop"
                        style={{ backgroundImage: `url(${backdropUrl})` }}
                    />
                )}

                <AnimatedSearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t('login', 'searchSeries')}
                />
                {/* Toolbar única de filtros: flex com wrap — os offsets fixos
                    antigos assumiam larguras dos vizinhos e sobrepunham. */}
                <div style={{
                    position: 'absolute', top: 30, right: 90, zIndex: 95,
                    display: 'flex', alignItems: 'center', gap: 8,
                    flexWrap: 'wrap', justifyContent: 'flex-end',
                    maxWidth: 'calc(100% - 330px)'
                }}>
                    <CatalogFilters items={series} decade={decade} genre={genreFilter} onDecade={setDecade} onGenre={setGenreFilter} tag={tagFilter} onTag={setTagFilter} tagsTick={tagsTick} inline />
                    <button
                        onClick={() => {
                            const next = !hideWatched;
                            setHideWatchedState(next);
                            if (next) localStorage.setItem('neostream_hide_watched', 'on');
                            else localStorage.removeItem('neostream_hide_watched');
                        }}
                        title={t('contentModal', 'hideWatchedHint')}
                        style={{
                            padding: '9px 12px', borderRadius: 12,
                            border: hideWatched ? '1px solid rgba(var(--ns-accent-rgb), 0.5)' : '1px solid rgba(255, 255, 255, 0.18)',
                            background: hideWatched ? 'rgba(var(--ns-accent-rgb), 0.2)' : 'rgba(15, 15, 35, 0.85)',
                            color: hideWatched ? 'var(--ns-accent-light)' : 'rgba(255, 255, 255, 0.85)',
                            fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            backdropFilter: 'blur(8px)', whiteSpace: 'nowrap'
                        }}
                    >
                        {t('contentModal', 'hideWatched')}
                    </button>
                    <SortSelect value={sortBy} onChange={setSortBy} inline />
                </div>

                <CategoryMenu
                    onSelectCategory={setSelectedCategory}
                    selectedCategory={selectedCategory}
                    type="series"
                    isKidsProfile={isKidsProfile}
                />

                <div className="series-content">
                    {/* Series Grid */}
                    <div
                        ref={scrollContainerRef}
                        className="series-scroll-container"
                    >
                        {filteredSeries.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">📺</div>
                                <h3>Nenhuma série encontrada</h3>
                                <p>Tente buscar por outro termo</p>
                            </div>
                        ) : (
                            <div ref={gridRef} className="series-grid" role="list" aria-label={t('nav', 'series')}>
                                {gridWindow.topSpacer > 0 && (
                                    <div data-spacer="true" style={{ gridColumn: '1 / -1', height: gridWindow.topSpacer }} />
                                )}
                                {filteredSeries.slice(windowStart, windowEnd).map((s, index) => {
                                    const isSaved = savedSeriesIds.has(String(s.series_id));
                                    const hasProgress = seriesProgressIndex.get(String(s.series_id));
                                    const isCompleted = watchProgressService.isSeriesCompleted(String(s.series_id));
                                    const isNew = isRecentlyAdded(s.last_modified, nowMs);

                                    return (
                                        <div
                                            key={s.series_id}
                                            style={{ animationDelay: gridWindow.ready ? '0s' : `${(index % itemsPerPage) * 0.03}s` }}
                                        >
                                            <HoverPreviewCard
                                                type="series"
                                                id={s.series_id}
                                                cover={fixImageUrl(s.cover || s.stream_icon)}
                                                title={s.name}
                                                isNew={isNew}
                                                qualityBadge={qualityBadgeOf(s.name)}
                                                checking={checkingItem === s.name}
                                                onMoreInfo={() => handleSeriesClick(s)}
                                            >
                                                {/* New episodes badge */}
                                                {updatedSeriesIds.has(String(s.series_id)) && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        bottom: 10,
                                                        left: 10,
                                                        background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                                                        borderRadius: 8,
                                                        padding: '4px 9px',
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        color: 'white',
                                                        letterSpacing: '0.4px',
                                                        zIndex: 5,
                                                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
                                                    }}>{t('home', 'newEpisodesBadge')}</span>
                                                )}

                                                {/* Saved Badge */}
                                                {isSaved && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        top: 10,
                                                        right: 10,
                                                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                                        borderRadius: 8,
                                                        padding: '4px 8px',
                                                        fontSize: 14,
                                                        zIndex: 5
                                                    }}>🔖</span>
                                                )}

                                                {/* Completed Badge */}
                                                {isCompleted && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        top: 10,
                                                        left: 10,
                                                        background: 'linear-gradient(135deg, var(--ns-accent) 0%, var(--ns-accent-grad-to) 100%)',
                                                        borderRadius: 8,
                                                        padding: '4px 8px',
                                                        fontSize: 14,
                                                        zIndex: 5
                                                    }}>✓</span>
                                                )}

                                                {/* Episode Progress Badge */}
                                                {hasProgress && !isCompleted && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        bottom: 50,
                                                        left: 8,
                                                        right: 8,
                                                        background: 'rgba(0, 0, 0, 0.85)',
                                                        borderRadius: 6,
                                                        padding: '5px 8px',
                                                        fontSize: 11,
                                                        fontWeight: 600,
                                                        color: 'var(--ns-accent-light)',
                                                        textAlign: 'center',
                                                        zIndex: 5
                                                    }}>
                                                        T{hasProgress.lastWatchedSeason} E{hasProgress.lastWatchedEpisode}
                                                    </span>
                                                )}
                                            </HoverPreviewCard>
                                        </div>
                                    );
                                })}
                                {gridWindow.bottomSpacer > 0 && (
                                    <div data-spacer="true" style={{ gridColumn: '1 / -1', height: gridWindow.bottomSpacer }} />
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Kids Block Message Toast */}
            {blockMessage && (
                <div className="kids-block-toast">
                    <span className="toast-icon">🔒</span>
                    <span className="toast-message">{blockMessage}</span>
                </div>
            )}

            {/* Video Player */}
            {playingSeries && (
                <AsyncVideoPlayer
                    movie={playingSeries}
                    buildStreamUrl={buildSeriesStreamUrl}
                    onClose={() => {
                        setPlayingSeries(null);
                        setPipResumeTime(null);
                    }}
                    seriesId={String(playingSeries.series_id)}
                    seasonNumber={selectedSeason}
                    episodeNumber={selectedEpisode}
                    resumeTime={pipResumeTime}
                    onNextEpisode={() => {
                        // O resumeTime capturado ao expandir o mini player vale só
                        // pro episódio de onde ele veio; sem limpar, todo episódio
                        // seguinte abriria naquele ponto (e gravaria a posição
                        // espúria no progresso/Trakt).
                        setPipResumeTime(null);
                        watchProgressService.markEpisodeWatched(
                            String(playingSeries.series_id),
                            selectedSeason,
                            selectedEpisode
                        );
                        // 🎬 Trakt: episódio concluído com temporada/número reais.
                        void syncTraktEpisodeWatched(playingSeries.name, selectedSeason, selectedEpisode);

                        const episodes = seriesInfo?.episodes?.[selectedSeason];
                        if (episodes && selectedEpisode < episodes.length) {
                            setSelectedEpisode(selectedEpisode + 1);
                        } else if (seriesInfo?.episodes?.[selectedSeason + 1]) {
                            setSelectedSeason(selectedSeason + 1);
                            setSelectedEpisode(1);
                        }
                    }}
                    onPreviousEpisode={() => {
                        setPipResumeTime(null);
                        if (selectedEpisode > 1) {
                            setSelectedEpisode(selectedEpisode - 1);
                        } else if (selectedSeason > 1) {
                            const prevSeasonEpisodes = seriesInfo?.episodes?.[selectedSeason - 1];
                            if (prevSeasonEpisodes) {
                                setSelectedSeason(selectedSeason - 1);
                                setSelectedEpisode(prevSeasonEpisodes.length);
                            }
                        }
                    }}
                    canGoNext={
                        (seriesInfo?.episodes?.[selectedSeason] &&
                            selectedEpisode < seriesInfo.episodes[selectedSeason].length) ||
                        !!seriesInfo?.episodes?.[selectedSeason + 1]
                    }
                    canGoPrevious={selectedEpisode > 1 || selectedSeason > 1}
                    currentEpisode={selectedEpisode}
                    customTitle={`${playingSeries.name} - ${playingEpisodeTitle}`}
                />
            )}

            {/* Resume Modal */}
            {showResumeModal && resumeModalData && selectedSeries && (
                <ResumeModal
                    seriesName={selectedSeries.name}
                    seasonNumber={selectedSeason}
                    episodeNumber={selectedEpisode}
                    currentTime={resumeModalData.currentTime}
                    duration={resumeModalData.duration}
                    onResume={() => {
                        setShowResumeModal(false);
                        setPlayingSeries(selectedSeries);
                    }}
                    onRestart={() => {
                        watchProgressService.clearEpisodeProgress(
                            String(selectedSeries.series_id),
                            selectedSeason,
                            selectedEpisode
                        );
                        setShowResumeModal(false);
                        setPlayingSeries(selectedSeries);
                    }}
                    onCancel={() => {
                        setShowResumeModal(false);
                        setResumeModalData(null);
                    }}
                />
            )}

            {/* Content Detail Modal */}
            {selectedSeries && (
                <ContentDetailModal
                    isOpen={!!selectedSeries}
                    onClose={() => { setSelectedSeries(null); setTagsTick(tick => tick + 1); }}
                    contentId={String(selectedSeries.series_id)}
                    contentType="series"
                    // 🔇 A ficha da Série fica montada durante a reprodução (o
                    // player troca de episódio sozinho e o `seriesInfo` daqui
                    // precisa sobreviver), então o trailer é quem sai de cena.
                    suspended={!!playingSeries}
                    contentData={{
                        name: selectedSeries.name,
                        cover: selectedSeries.cover || selectedSeries.stream_icon,
                        rating: selectedSeries.rating,
                        youtube_trailer: selectedSeries.youtube_trailer,
                        tmdb_id: selectedSeries.tmdb_id
                    }}
                    onPlay={(season, episode, offlineUrl) => {
                        const nextSeason = season || 1;
                        const nextEpisode = episode || 1;
                        setSelectedSeason(nextSeason);
                        setSelectedEpisode(nextEpisode);
                        handlePlaySeries(selectedSeries, nextSeason, nextEpisode, offlineUrl);
                    }}
                />
            )}
        </>
    );
}

// CSS Styles — só o que esta página renderiza. Este <style> é GLOBAL e entra
// DEPOIS das folhas dos componentes: o layout antigo que morava aqui
// (.series-card, painel/abas/episódios, .btn-*, tela de erro com classe…) não tinha
// mais elemento nenhum e, ainda assim, sobrescrevia o card de verdade
// (.card-info/.card-title/.card-overlay), redefinia @keyframes do card e do
// player e vazava para o aviso de atualização e o AsyncVideoPlayer (#D050).
// O card da grade é o HoverPreviewCard (visual em HoverPreviewCard.css) e a
// ficha é o ContentDetailModal — nenhum dos dois é estilizado aqui.
const seriesStyles = `
/* Page Container */
.series-page {
    position: relative;
    height: 100vh;
    overflow: hidden;
    background: linear-gradient(135deg, var(--ns-bg-deep) 0%, var(--ns-bg-panel) 50%, var(--ns-bg-tint) 100%);
}

/* Dynamic Backdrop */
.series-backdrop {
    position: fixed;
    inset: 0;
    background-size: cover;
    background-position: center;
    opacity: 0.25;
    filter: blur(20px) saturate(1.2);
    transform: scale(1.1);
    transition: opacity 0.5s ease, background-image 0.8s ease;
    pointer-events: none;
    z-index: 0;
}

/* Content Area */
.series-content {
    position: relative;
    z-index: 10;
    padding: 24px 32px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

/* Series Scroll Container */
.series-scroll-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(var(--ns-accent-rgb), 0.4) transparent;
}

.series-scroll-container::-webkit-scrollbar {
    width: 6px;
}

.series-scroll-container::-webkit-scrollbar-track {
    background: transparent;
}

.series-scroll-container::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, var(--ns-accent), var(--ns-accent-grad-to));
    border-radius: 3px;
}

/* Series Grid - Responsive */
.series-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
    padding: 16px;
    padding-bottom: 32px;
}

@media (max-width: 768px) {
    .series-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 16px;
    }
}

@media (max-width: 480px) {
    .series-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }
}

/* Empty State */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 60vh;
    text-align: center;
    color: rgba(255, 255, 255, 0.6);
}

.empty-icon {
    font-size: 80px;
    margin-bottom: 24px;
    opacity: 0.5;
}

.empty-state h3 {
    font-size: 24px;
    margin-bottom: 8px;
    color: white;
}

.empty-state p {
    font-size: 16px;
}

/* Loading State */
.series-loading {
    padding: 32px;
}

.loading-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
}

.skeleton-card {
    animation: skeletonPulse 1.5s ease-in-out infinite;
}

@keyframes skeletonPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.skeleton-poster {
    aspect-ratio: 2 / 3;
    background: linear-gradient(135deg, #2a2a4a 0%, var(--ns-bg-panel) 100%);
    border-radius: 16px 16px 0 0;
}

.skeleton-title {
    height: 50px;
    background: linear-gradient(135deg, var(--ns-bg-panel) 0%, #2a2a4a 100%);
    border-radius: 0 0 16px 16px;
}

/* fadeIn NÃO é órfão: o fundo do CategoryMenu e os chips do player
   (.sleep-timer-chip / .live-epg-bar em VideoPlayer.css) animam com ele sem
   declará-lo. Idêntico ao das outras telas (opacity 0 → 1). */
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

/* Kids Block Toast */
.kids-block-toast {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.95) 0%, rgba(185, 28, 28, 0.95) 100%);
    color: white;
    padding: 16px 32px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-weight: 600;
    box-shadow: 0 8px 32px rgba(239, 68, 68, 0.4);
    z-index: 10000;
    animation: toastSlideUp 0.3s ease, toastFadeOut 0.5s ease 2.5s forwards;
}

.kids-block-toast .toast-icon {
    font-size: 24px;
}

.kids-block-toast .toast-message {
    font-size: 15px;
}

@keyframes toastSlideUp {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
}

@keyframes toastFadeOut {
    to {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
    }
}
`;
