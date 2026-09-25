import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SortSelect } from '../components/SortSelect';
import { CatalogFilters } from '../components/CatalogFilters';
import { fuzzyIncludes, matchesFilters, qualityBadgeOf, matchesDuration, type DurationBucket } from '../utils/catalogFilter';
import { getMovieBaseName, getVersionTag, groupByBaseName } from '../services/movieVersionService';
import { proximoDaFila } from '../services/proximoDaFila';
import { fetchTraktWatchedMovies } from '../services/traktService';
import { normalizeTitle } from '../services/personSearchHelpers';
import { compareCatalogItems, type CatalogSort } from '../utils/catalogSort';
import { fetchMovieDetails, searchMovieByName, type TMDBMovieDetails, getBackdropUrl } from '../services/tmdb';
import { watchLaterService } from '../services/watchLater';
import { queueService } from '../services/queueService';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';
import { CategoryMenu } from '../components/CategoryMenu';
import { movieProgressService } from '../services/movieProgressService';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { idsComTag } from '../services/personalMarksService';
import { profileService } from '../services/profileService';
import { downloadService } from '../services/downloadService';
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
interface VODStream {
    num: number;
    name: string;
    stream_type: string;
    stream_id: number;
    container_extension: string;
    custom_sid: string;
    direct_source: string;
    added: string;
    category_id: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    stream_icon: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    release_date: string;
    tmdb_id: string;
    offlineUrl?: string;
}

// Dynamic card sizing based on container
const CARD_MIN_WIDTH = 180;
const CARD_GAP = 24;

export function VOD() {
    const [streams, setStreams] = useState<VODStream[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<CatalogSort>('recent');
    // 🔎 Filtros de década e gênero — aplicados antes da ordenação.
    const [decade, setDecade] = useState<number | null>(null);
    // ⏳ Item 37: filtro por duração (episode_run_time do provedor).
    const [durationFilter, setDurationFilter] = useState<DurationBucket | null>(null);
    // 🏷️ Filtro por tag pessoal. O tick refaz a conta quando a ficha fecha —
    // marcar "Cult" lá dentro tem que refletir aqui sem trocar de tela.
    const [tagFilter, setTagFilter] = useState<string | null>(null);
    const [tagsTick, setTagsTick] = useState(0);
    const [genreFilter, setGenreFilter] = useState<string | null>(null);
    const [selectedMovie, setSelectedMovie] = useState<VODStream | null>(null);
    const [tmdbData, setTmdbData] = useState<TMDBMovieDetails | null>(null);
    const [playingMovie, setPlayingMovie] = useState<VODStream | null>(null);
    const [pipResumeTime, setPipResumeTime] = useState<number | null>(null);
    const [visibleCount, setVisibleCount] = useState(0);
    const [itemsPerPage, setItemsPerPage] = useState(36);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const isKidsProfile = profileService.getActiveProfile()?.isKids || false;
    const { t } = useLanguage();
    // Congelado por sessão da página (regra de pureza) — base do selo NOVO.
    const [nowMs] = useState(() => Date.now());

    // Kids profile + Parental Control filtering and click-gating
    // (same generic hook Series.tsx uses)
    const {
        checkingItem,
        blockMessage,
        isItemVisible,
        handleItemClick: handleMovieClick
    } = useContentFiltering<VODStream>({
        contentType: 'movie',
        isKidsProfile,
        items: streams,
        getItemName: (movie) => movie.name,
        getItemCategoryIds: (movie) => [movie.category_id],
        onAllowed: setSelectedMovie
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
        setSelection: setSelectedMovie,
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
            // Item clicado na busca (ou nos Parecidos/filmografia do modal):
            // abre a ficha assim que o catálogo estiver carregado.
            const openRaw = sessionStorage.getItem(GLOBAL_SEARCH_OPEN_KEY);
            if (openRaw !== null) {
                try {
                    const open = JSON.parse(openRaw) as { kind?: string; id?: number | string };
                    if (open?.kind === 'vod' && open.id != null) {
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
        if (!pendingOpenId || streams.length === 0) return;
        // 🔒 O id vem de FORA da grade (busca global, "Parecidos"/filmografia
        // da ficha) e `streams` é a lista CRUA: resolver e abrir direto
        // entregava a ficha de um filme que a grade esconde. Mesmo gate da
        // grade, mesmo desenho do `proximoDaFila` daqui de cima.
        const hit = fichaLiberada(pendingOpenId, streams, s => s.stream_id, isItemVisible);
        queueMicrotask(() => {
            setPendingOpenId(null);
            if (hit) setSelectedMovie(hit);
        });
    // isItemVisible é recriado a cada render e lê estado de parental/perfil que
    // só muda por troca de perfil ou ajuste — o que remonta esta página. Nas
    // deps ele reagendaria a abertura a cada render; é o mesmo motivo (e o
    // mesmo recurso) do filtro da grade logo abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingOpenId, streams]);

    // Listen for mini player expand event to reopen full player
    useEffect(() => {
        const handleMiniPlayerExpand = (e: CustomEvent) => {
            const { contentId, contentType, currentTime } = e.detail;
            if (contentType === 'movie' && contentId) {
                // Find the movie in our list and set it as playing
                const movie = streams.find((m: VODStream) => m.stream_id.toString() === contentId);
                if (movie) {
                    setPipResumeTime(currentTime || 0);
                    setPlayingMovie(movie);
                }
            }
        };

        window.addEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
        return () => window.removeEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
    }, [streams]);

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

    const fetchStreams = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const result = await window.ipcRenderer.invoke('streams:get-vod');
            if (result.success) {
                setStreams(asList<VODStream>(result.data));
            } else {
                setError(result.error || 'Failed to load movies');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Deferred: fetchStreams flips loading state synchronously on entry.
        queueMicrotask(() => { void fetchStreams(); });
    }, [fetchStreams]);

    // First "Assistir Depois" movie present in the catalog (excluding the one
    // playing) — the end-of-movie countdown offers it as "A seguir".
    const getNextQueuedMovie = (currentId: string): VODStream | null => {
        // 🎞️ Item 30: a fila MANUAL vem primeiro; o Ver depois segue de fallback.
        // O gate de parental/infantil vale nos DOIS caminhos (proximoDaFila.ts):
        // entrar na fila — pela ficha ou pelo celular — não é passe livre.
        return proximoDaFila(
            currentId,
            queueService.next(currentId),
            watchLaterService.getAll(),
            id => streams.find(s => String(s.stream_id) === id),
            isItemVisible
        );
    };

    // Memoized so a big catalog isn't re-sorted/re-filtered on every render —
    // notably on every scroll frame (the windowed grid updates scrollTop state).
    const sortedStreams = useMemo(
        () => {
            const filtered = (decade !== null || genreFilter)
                ? streams.filter(item => matchesFilters(item, decade, genreFilter))
                : streams;
            const porDuracao = durationFilter
                ? filtered.filter(item => matchesDuration(item.episode_run_time, durationFilter))
                : filtered;
            // Uma leitura de storage para a grade inteira, não uma por card.
            const comTag = tagFilter ? idsComTag(tagFilter) : null;
            const base = comTag
                ? porDuracao.filter(item => comTag.has(`movie:${item.stream_id}`))
                : porDuracao;
            return sortBy === 'recent' ? base : [...base].sort((a, b) => compareCatalogItems(sortBy, a, b));
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `tagsTick` força a releitura; as marcas vivem no localStorage, fora do React
        [streams, sortBy, decade, genreFilter, durationFilter, tagFilter, tagsTick]
    );

    // 🙈 Esconder assistidos: filmes com progresso >= 95% saem da grade.
    const [hideWatched, setHideWatchedState] = useState(() => localStorage.getItem('neostream_hide_watched') === 'on');
    // 🎬 Item B2-6: com "ocultar assistidos" ligado, o que foi visto no TRAKT
    // (em qualquer app) também some da grade (match por título normalizado).
    const [traktWatchedTitles, setTraktWatchedTitles] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (!hideWatched) {
            queueMicrotask(() => setTraktWatchedTitles(new Set()));
            return;
        }
        let cancelled = false;
        void fetchTraktWatchedMovies().then(titles => {
            if (!cancelled && titles.length > 0) setTraktWatchedTitles(new Set(titles.map(normalizeTitle)));
        });
        return () => { cancelled = true; };
    }, [hideWatched]);
    const watchedIds = useMemo(
        () => (hideWatched ? new Set(movieProgressService.getWatchedMovies()) : new Set<string>()),
        [hideWatched]
    );

    // 🎞️ Item 45: card único de versões — agrupa 4K/FHD/HD/legendado por
    // nome-base (toggle em Configurações → Reprodução, ligado por padrão).
    const [groupVersions] = useState(() => localStorage.getItem('neostream_group_versions') !== '0');
    const versionsByBase = useMemo(() => {
        if (!groupVersions) return null;
        return groupByBaseName(sortedStreams);
    }, [groupVersions, sortedStreams]);

    const filteredStreams = useMemo(() => {
        // 🗂️ O histórico é lido UMA vez por avaliação do filtro, não uma vez por
        // card: `getMoviesInProgress()`/`getWatchedMovies()` varrem o histórico
        // inteiro (getItem + filter + map) e rodavam DENTRO do callback, que
        // roda por item — escolher "Continuar assistindo"/"Assistidos" custava
        // O(catálogo × histórico), com `.includes()` linear por cima.
        const moviesInProgress = selectedCategory === 'CONTINUE_WATCHING'
            ? new Set(movieProgressService.getMoviesInProgress())
            : null;
        const watchedMovies = selectedCategory === 'WATCHED'
            ? new Set(movieProgressService.getWatchedMovies())
            : null;
        return sortedStreams.filter(stream => {
            const matchesSearch = fuzzyIncludes(stream.name, searchQuery);
            if (hideWatched && selectedCategory !== 'WATCHED' && traktWatchedTitles.size > 0 && traktWatchedTitles.has(normalizeTitle(stream.name))) {
                return false;
            }
            if (hideWatched && selectedCategory !== 'WATCHED' && watchedIds.has(stream.stream_id.toString())) {
                return false;
            }

            // Kids profile + Parental Control gating (categories, cached ratings, hidden items)
            if (!isItemVisible(stream)) {
                return false;
            }

            if (moviesInProgress) {
                return matchesSearch && moviesInProgress.has(stream.stream_id.toString());
            }

            if (watchedMovies) {
                return matchesSearch && watchedMovies.has(stream.stream_id.toString());
            }

            const matchesCategory = !selectedCategory || selectedCategory === '' || selectedCategory === 'all' || stream.category_id === selectedCategory;
            return matchesSearch && matchesCategory;
        });
    // isItemVisible reads parental/kids state that only changes via a profile/
    // settings switch (which reloads streams / remounts this page), so it doesn't
    // need to be a dep — keeping it out is what makes scrolling cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sortedStreams, searchQuery, selectedCategory, hideWatched, watchedIds, traktWatchedTitles]);

    // Windowed rendering: only ~3 screens of cards stay mounted while the
    // scrollbar reflects the full list (spacer rows keep the geometry).
    // Until geometry is measured, the plain first-page slice renders.
    // 🎞️ Item 45: com o agrupamento ligado, cada nome-base vira UM card; com
    // "ocultar assistidos", QUALQUER versão vista esconde o grupo inteiro.
    const displayStreams = useMemo(() => {
        if (!versionsByBase) return filteredStreams;
        const seen = new Set<string>();
        const out: typeof filteredStreams = [];
        for (const stream of filteredStreams) {
            const base = getMovieBaseName(stream.name);
            if (seen.has(base)) continue;
            seen.add(base);
            if (hideWatched && selectedCategory !== 'WATCHED') {
                const versions = versionsByBase.get(base) ?? [];
                const anyWatched = versions.some(v =>
                    watchedIds.has(v.stream_id.toString()) ||
                    (traktWatchedTitles.size > 0 && traktWatchedTitles.has(normalizeTitle(v.name))));
                if (anyWatched) continue;
            }
            out.push(stream);
        }
        return out;
    }, [versionsByBase, filteredStreams, hideWatched, selectedCategory, watchedIds, traktWatchedTitles]);

    const gridWindow = useWindowedGrid({
        scrollRef: scrollContainerRef,
        gridRef,
        itemCount: displayStreams.length
    });
    const windowStart = gridWindow.ready ? gridWindow.start : 0;
    const windowEnd = gridWindow.ready ? gridWindow.end : Math.min(visibleCount, filteredStreams.length);

    // Fetch TMDB data
    useEffect(() => {
        if (!selectedMovie) {
            queueMicrotask(() => setTmdbData(null));
            return;
        }

        const fetchTmdb = async () => {
            try {
                let data: TMDBMovieDetails | null = null;

                // Try by tmdb_id first
                if (selectedMovie.tmdb_id) {
                    data = await fetchMovieDetails(selectedMovie.tmdb_id);
                }

                // Fallback: search by name
                if (!data) {
                    // Extract year from movie name if present (e.g., "Movie Name (2023)")
                    const yearMatch = selectedMovie.name.match(/\((\d{4})\)/);
                    const year = yearMatch ? yearMatch[1] : undefined;
                    data = await searchMovieByName(selectedMovie.name, year);
                }

                setTmdbData(data);
            } catch (err) {
                console.error('Failed to fetch TMDB data:', err);
            }
        };
        fetchTmdb();
    }, [selectedMovie]);

    const fixImageUrl = (url: string): string => url?.replace(/\/\/+/g, '/').replace(':/', '://') || '';

    const buildStreamUrl = async (movie: VODStream): Promise<string> => {
        // Check for offline URL first
        if (movie.offlineUrl) {
            return movie.offlineUrl;
        }

        try {
            const result = await window.ipcRenderer.invoke('streams:get-vod-url', {
                streamId: movie.stream_id,
                container: movie.container_extension
            });
            return result.success ? result.url : '';
        } catch (err) {
            console.error('Failed to build stream URL:', err);
            return '';
        }
    };

    // Listas de estado do usuário lidas UMA vez por render, não por card: antes
    // cada card fazia getItem+JSON.parse do histórico inteiro (×5), o que a
    // ~60 cards montados custava mais que o orçamento de um frame inteiro.
    // Os serviços devolvem a MESMA referência enquanto o localStorage não muda,
    // então indexar com useMemo sobre elas é correto por construção: identidade
    // nova = dado novo (não há como congelar valor velho na tela).
    const watchLaterEntries = watchLaterService.getAll();
    const savedMovieIds = useMemo(
        () => new Set(watchLaterEntries.filter(i => i.type === 'movie').map(i => i.id)),
        [watchLaterEntries]
    );
    const progressById = movieProgressService.getProgressIndex();

    const getProgress = (movieId: number) => {
        const progress = progressById.get(movieId.toString());
        if (!progress || !progress.duration) return 0;
        return Math.round((progress.currentTime / progress.duration) * 100);
    };

    const getMovieProgress = (movieId: number) => {
        return progressById.get(movieId.toString()) ?? null;
    };

    const formatRemainingTime = (currentTime: number, duration: number) => {
        const remaining = Math.max(0, duration - currentTime);
        const minutes = Math.floor(remaining / 60);
        if (minutes < 60) return `${minutes}min restantes`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}min restantes`;
    };

    // Movie card click gating (Kids/Parental) is handleMovieClick from
    // useContentFiltering above — identical flow to the one Series.tsx uses.


    // Loading State
    if (loading) return (
        <div className="vod-page">
            <style>{vodStyles}</style>
            <div className="vod-loading">
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
                    <span style={{ fontSize: '36px' }}>🎬</span>
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'white', margin: '0 0 8px 0' }}>
                    {t('login', 'loadMoviesError')}
                </h2>
                <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: '0 0 8px 0' }}>
                    {t('login', 'connectionErrorDetails')}
                </p>
                <p style={{
                    fontSize: '13px', color: '#f87171', margin: '0 0 32px 0',
                    padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)'
                }}>{error === 'Not authenticated' ? t('login', 'notAuthenticated') : error}</p>
                <button onClick={fetchStreams} style={{
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

    const backdropUrl = selectedMovie ? (
        tmdbData?.backdrop_path ? getBackdropUrl(tmdbData.backdrop_path) :
            selectedMovie.cover || fixImageUrl(selectedMovie.stream_icon)
    ) : null;

    return (
        <>
            <style>{vodStyles}</style>
            <div className="vod-page">
                {/* Dynamic Background */}
                {backdropUrl && (
                    <div
                        className="vod-backdrop"
                        style={{ backgroundImage: `url(${backdropUrl})` }}
                    />
                )}

                <AnimatedSearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t('login', 'searchMovies')}
                />
                {/* Toolbar única de filtros: flex com wrap — os offsets fixos
                    antigos assumiam larguras dos vizinhos e sobrepunham. */}
                <div style={{
                    position: 'absolute', top: 30, right: 90, zIndex: 95,
                    display: 'flex', alignItems: 'center', gap: 8,
                    flexWrap: 'wrap', justifyContent: 'flex-end',
                    maxWidth: 'calc(100% - 330px)'
                }}>
                    <CatalogFilters items={streams} decade={decade} genre={genreFilter} onDecade={setDecade} onGenre={setGenreFilter} duration={durationFilter} onDuration={setDurationFilter} tag={tagFilter} onTag={setTagFilter} tagsTick={tagsTick} inline />
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
                    type="vod"
                    isKidsProfile={isKidsProfile}
                />

                <div className="vod-content">
                    {/* Movies Grid */}
                    <div
                        ref={scrollContainerRef}
                        className="movies-scroll-container"
                    >
                        {filteredStreams.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">🎬</div>
                                <h3>Nenhum filme encontrado</h3>
                                <p>Tente buscar por outro termo</p>
                            </div>
                        ) : (
                            <div ref={gridRef} className="movies-grid" role="list" aria-label={t('nav', 'movies')}>
                                {gridWindow.topSpacer > 0 && (
                                    <div data-spacer="true" style={{ gridColumn: '1 / -1', height: gridWindow.topSpacer }} />
                                )}
                                {displayStreams.slice(windowStart, windowEnd).map((stream, index) => {
                                    const groupList = versionsByBase?.get(getMovieBaseName(stream.name));
                                    const versionCount = groupList?.length ?? 1;
                                    // Progresso do grupo: a versão mais avançada representa o card.
                                    const progress = groupList && groupList.length > 1
                                        ? Math.max(...groupList.map(v => getProgress(v.stream_id)))
                                        : getProgress(stream.stream_id);
                                    const movieProgress = getMovieProgress(stream.stream_id);
                                    const isSaved = savedMovieIds.has(String(stream.stream_id));
                                    const isNew = isRecentlyAdded(stream.added, nowMs);

                                    return (
                                        <div
                                            key={stream.stream_id}
                                            style={{ animationDelay: gridWindow.ready ? '0s' : `${(index % itemsPerPage) * 0.03}s` }}
                                        >
                                            <HoverPreviewCard
                                                type="movie"
                                                id={stream.stream_id}
                                                cover={fixImageUrl(stream.stream_icon) || stream.cover}
                                                title={stream.name}
                                                isNew={isNew}
                                                qualityBadge={qualityBadgeOf(stream.name)}
                                                checking={checkingItem === stream.name}
                                                onMoreInfo={() => handleMovieClick(stream)}
                                            >
                                                {/* Saved Badge */}
                                                {isSaved && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        top: 10,
                                                        right: 10,
                                                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                                        borderRadius: 8,
                                                        padding: '4px 8px',
                                                        fontSize: 14
                                                    }}>🔖</span>
                                                )}

                                                {/* Offline Badge */}
                                                {downloadService.isDownloaded(stream.name, 'movie') && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        top: 10,
                                                        left: 10,
                                                        background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                                                        borderRadius: 8,
                                                        padding: '4px 8px',
                                                        fontSize: 14
                                                    }}>📥</span>
                                                )}

                                                {/* Progress Bar */}
                                                {progress > 0 && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        bottom: 0,
                                                        left: 0,
                                                        right: 0,
                                                        height: 4,
                                                        background: 'rgba(0,0,0,0.6)'
                                                    }}>
                                                        <div style={{
                                                            width: `${progress}%`,
                                                            height: '100%',
                                                            background: 'linear-gradient(90deg, var(--ns-accent-dark), var(--ns-accent))'
                                                        }} />
                                                    </div>
                                                )}

                                                {/* Remaining Time Badge */}
                                                {movieProgress && movieProgress.currentTime > 0 && progress < 95 && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        bottom: 8,
                                                        left: 8,
                                                        background: 'rgba(0,0,0,0.8)',
                                                        padding: '4px 8px',
                                                        borderRadius: 4,
                                                        fontSize: 11,
                                                        color: 'white'
                                                    }}>
                                                        {formatRemainingTime(movieProgress.currentTime, movieProgress.duration)}
                                                    </div>
                                                )}

                                                {/* 🎞️ Item 45: quantas versões esse card agrupa */}
                                                {versionCount > 1 && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        bottom: 8,
                                                        right: 8,
                                                        background: 'rgba(0,0,0,0.8)',
                                                        borderRadius: 6,
                                                        padding: '3px 7px',
                                                        fontSize: 11,
                                                        color: 'white'
                                                    }}>🎞️ {versionCount}</span>
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
            {playingMovie && (
                <AsyncVideoPlayer
                    movie={playingMovie}
                    buildStreamUrl={buildStreamUrl}
                    onClose={() => {
                        setPlayingMovie(null);
                        setPipResumeTime(null);
                    }}
                    // "Assistir Depois" doubles as the play queue: when the
                    // movie ends, offer the next queued movie with the same
                    // countdown used for series episodes.
                    canGoNext={!!getNextQueuedMovie(String(playingMovie.stream_id))}
                    onNextEpisode={() => {
                        const next = getNextQueuedMovie(String(playingMovie.stream_id));
                        if (!next) return;
                        // The finished movie leaves the queue (manual e Ver depois).
                        queueService.remove(String(playingMovie.stream_id));
                        watchLaterService.remove(String(playingMovie.stream_id), 'movie');
                        setPipResumeTime(null);
                        setPlayingMovie(next);
                    }}
                    nextCountdownLabel={t('player', 'upNextIn')}
                    nextActionLabel={t('player', 'upNext')}
                    resumeTime={pipResumeTime !== null ? pipResumeTime : (movieProgressService.getMoviePositionById(playingMovie.stream_id.toString())?.currentTime || null)}
                    // Sem onTimeUpdate de propósito: o AsyncVideoPlayer já grava
                    // o progresso do filme (mesmo id, mesmo serviço). A cópia que
                    // ficava aqui gravava DE NOVO e com `Math.floor(t) % 5 === 0`,
                    // verdadeiro durante um segundo INTEIRO — ~4 gravações por
                    // janela de 5 s, cada uma reescrevendo o array de progresso
                    // no localStorage e mandando IPC pro celular pareado.
                    allMovies={streams}
                    onSwitchVersion={(newMovie, currentTime) => {
                        // Switch to new movie version while maintaining playback time
                        setPipResumeTime(currentTime);
                        setPlayingMovie(newMovie);
                    }}
                />
            )}

            {/* Content Detail Modal */}
            {selectedMovie && (
                <ContentDetailModal
                    isOpen={!!selectedMovie}
                    onClose={() => { setSelectedMovie(null); setTagsTick(tick => tick + 1); }}
                    contentId={String(selectedMovie.stream_id)}
                    contentType="movie"
                    contentData={{
                        name: selectedMovie.name,
                        cover: selectedMovie.stream_icon,
                        rating: selectedMovie.rating,
                        container_extension: selectedMovie.container_extension,
                        youtube_trailer: selectedMovie.youtube_trailer,
                        // O id que o fundo da tela já usa — sem ele, a ficha
                        // resolvia a sinopse por busca de nome e podia abrir outro filme.
                        tmdb_id: selectedMovie.tmdb_id
                    }}
                    versions={versionsByBase
                        ? (versionsByBase.get(getMovieBaseName(selectedMovie.name)) ?? [])
                            .map(v => ({ id: String(v.stream_id), label: getVersionTag(v.name) }))
                        : undefined}
                    activeVersionId={String(selectedMovie.stream_id)}
                    onSelectVersion={(id) => {
                        const version = sortedStreams.find(v => String(v.stream_id) === id);
                        if (version) setSelectedMovie(version);
                    }}
                    onPlay={(_season, _episode, offlineUrl) => {
                        // Set offline URL if available
                        if (offlineUrl) {
                            setPlayingMovie({ ...selectedMovie, offlineUrl });
                        } else {
                            setPlayingMovie(selectedMovie);
                        }
                        setSelectedMovie(null);
                    }}
                />
            )}
        </>
    );
}

// CSS Styles — só o que esta página renderiza. Este <style> é GLOBAL e entra
// DEPOIS das folhas dos componentes: o layout antigo que morava aqui
// (.movie-card, painel de detalhes, .btn-*, tela de erro com classe…) não tinha
// mais elemento nenhum e, ainda assim, sobrescrevia o card de verdade
// (.card-info/.card-title/.card-overlay), redefinia @keyframes do card e do
// player e vazava para o aviso de atualização e o AsyncVideoPlayer (#D050).
// O card da grade é o HoverPreviewCard (visual em HoverPreviewCard.css) e a
// ficha é o ContentDetailModal — nenhum dos dois é estilizado aqui.
const vodStyles = `
/* Page Container */
.vod-page {
    position: relative;
    height: 100vh;
    overflow: hidden;
    background: linear-gradient(135deg, var(--ns-bg-deep) 0%, var(--ns-bg-panel) 50%, var(--ns-bg-tint) 100%);
}

/* Dynamic Backdrop */
.vod-backdrop {
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
.vod-content {
    position: relative;
    z-index: 10;
    padding: 24px 32px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

/* Movies Scroll Container */
.movies-scroll-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(var(--ns-accent-rgb), 0.4) transparent;
}

.movies-scroll-container::-webkit-scrollbar {
    width: 6px;
}

.movies-scroll-container::-webkit-scrollbar-track {
    background: transparent;
}

.movies-scroll-container::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, var(--ns-accent-dark), var(--ns-accent));
    border-radius: 3px;
}

/* Movies Grid - Responsive */
.movies-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
    padding: 16px;
    padding-bottom: 32px;
}

@media (max-width: 768px) {
    .movies-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 16px;
    }
}

@media (max-width: 480px) {
    .movies-grid {
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
.vod-loading {
    padding: 32px;
}

.loading-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 24px;
}

.skeleton-card {
    animation: skeletonPulse 1.5s ease-in-out infinite;
    animation-delay: var(--delay);
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
