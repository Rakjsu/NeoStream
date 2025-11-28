import { useState, useEffect } from 'react';
import { formatGenres, type TMDBSeriesDetails, fetchEpisodeDetails, getBackdropUrl } from '../services/tmdb';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';

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
    category_id: string;
    tmdb_id: string;
}

export function Series() {
    const [series, setSeries] = useState<Series[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery] = useState('');
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [selectedSeries, setSelectedSeries] = useState<Series | null>(null);
    const [tmdbData, setTmdbData] = useState<TMDBSeriesDetails | null>(null);
    const [loadingTmdb, setLoadingTmdb] = useState(false);
    const [playingSeries, setPlayingSeries] = useState<Series | null>(null);
    const [selectedSeason, setSelectedSeason] = useState<number>(1);
    const [selectedEpisode, setSelectedEpisode] = useState<number>(1);
    const [seriesInfo, setSeriesInfo] = useState<any>(null);
    // Cache for TMDB episode names: key is "seriesId-season-episode"
    const [tmdbEpisodeCache, setTmdbEpisodeCache] = useState<Map<string, string>>(new Map());

    useEffect(() => { fetchSeries(); }, []);

    const fetchSeries = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await window.ipcRenderer.invoke('streams:get-series');
            if (result.success) {
                setSeries(result.data || []);
            } else {
                setError(result.error || 'Failed to load series');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    const filteredSeries = series.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const handleImageError = (seriesId: number) => setBrokenImages(prev => new Set(prev).add(seriesId));
    const fixImageUrl = (url: string): string => url && url.startsWith('http') ? url : `https://${url}`;

    const extractYearFromName = (name: string): string => {
        const match = name.match(/\((\d{4})\)/);
        return match ? match[1] : '';
    };

    useEffect(() => {
        if (selectedSeries) {
            const year = extractYearFromName(selectedSeries.name);
            setLoadingTmdb(true);
            setTmdbData(null);
            import('../services/tmdb').then(({ searchSeriesByName }) => {
                searchSeriesByName(selectedSeries.name, year)
                    .then(data => { setTmdbData(data); setLoadingTmdb(false); })
                    .catch(() => setLoadingTmdb(false));
            });
        } else {
            setTmdbData(null);
        }
    }, [selectedSeries]);

    const handlePlaySeries = (seriesItem: Series) => {
        setPlayingSeries(seriesItem);
    };


    // Check if episode title from IPTV API is meaningful
    const isValidEpisodeTitle = (cleanTitle: string): boolean => {
        if (!cleanTitle || cleanTitle.length === 0) return false;
        if (cleanTitle.match(/^\d+$/)) return false; // Just a number
        if (cleanTitle.match(/^(Episódio|Capítulo|Ep\.?|Episode|Chapter)\s*\d+$/i)) return false;
        return true;
    };

    // Extract clean episode title and format as "Episódio X - Episode Name"
    // Uses TMDB as fallback when IPTV title is not meaningful
    const getEpisodeTitle = (fullTitle: string, episodeNum: number, season: number = selectedSeason): string => {
        // Try to get from cache first (for TMDB fallback)
        const cacheKey = selectedSeries?.tmdb_id
            ? `${selectedSeries.tmdb_id}-${season}-${episodeNum}`
            : null;

        if (cacheKey && tmdbEpisodeCache.has(cacheKey)) {
            const cachedName = tmdbEpisodeCache.get(cacheKey)!;
            return `Episódio ${episodeNum} - ${cachedName}`;
        }

        // Try to clean the IPTV title
        let cleanTitle = fullTitle || '';

        // Split by " - " and get the last meaningful part
        const parts = cleanTitle.split(' - ');
        if (parts.length > 1) {
            cleanTitle = parts[parts.length - 1].trim();
        }

        // Remove patterns like "S01E01", "Episódio 1", "Capítulo 1", "Ep1", etc.
        cleanTitle = cleanTitle
            .replace(/^S\d+E\d+\s*/i, '')           // Remove S01E01
            .replace(/^Episódio\s+\d+\s*/i, '')      // Remove "Episódio X"
            .replace(/^Capítulo\s+\d+\s*/i, '')      // Remove "Capítulo X"
            .replace(/^Ep\.?\s*\d+\s*/i, '')         // Remove "Ep1" or "Ep. 1"
            .replace(/^Episode\s+\d+\s*/i, '')       // Remove "Episode X"
            .replace(/^Chapter\s+\d+\s*/i, '')       // Remove "Chapter X"
            .trim();

        // If we have a valid title from IPTV, use it
        if (isValidEpisodeTitle(cleanTitle)) {
            return `Episódio ${episodeNum} - ${cleanTitle}`;
        }

        // If IPTV title is not good and we have TMDB ID, try to fetch from TMDB
        if (selectedSeries?.tmdb_id && cacheKey) {
            // Trigger async fetch (won't block rendering)
            fetchEpisodeDetails(selectedSeries.tmdb_id, season, episodeNum)
                .then(episodeData => {
                    if (episodeData && episodeData.name) {
                        setTmdbEpisodeCache(prev => {
                            const newCache = new Map(prev);
                            newCache.set(cacheKey, episodeData.name);
                            return newCache;
                        });
                    }
                })
                .catch(() => {
                    // Silently fail - will just show episode number
                });
        }

        // Return just the episode number as fallback
        return `Episódio ${episodeNum}`;
    };

    const buildSeriesStreamUrl = async (seriesItem: Series): Promise<string> => {
        try {
            const result = await window.ipcRenderer.invoke('auth:get-credentials');

            if (result.success) {
                const { url, username, password } = result.credentials;

                // Get the specific episode data from seriesInfo
                const episode = seriesInfo?.episodes?.[selectedSeason]?.find(
                    (ep: any) => ep.episode_num === selectedEpisode
                );

                if (!episode) {
                    throw new Error(`Episode ${selectedEpisode} of season ${selectedSeason} not found`);
                }

                // Use episode ID and container extension from API
                const streamUrl = `${url}/series/${username}/${password}/${episode.id}.${episode.container_extension}`;
                console.log('🎬 Building series stream URL:', streamUrl);
                return streamUrl;
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
            window.ipcRenderer.invoke('auth:get-credentials').then(result => {
                if (result.success) {
                    const { url, username, password } = result.credentials;
                    fetch(`${url}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${selectedSeries.series_id}`)
                        .then(res => res.json())
                        .then(data => {
                            console.log('📺 Series Info API Response:', data);
                            console.log('📺 Seasons structure:', data.seasons);
                            console.log('📺 Episodes (IPTV disponíveis):', data.episodes);
                            console.log('📺 Temporadas disponíveis:', Object.keys(data.episodes || {}));
                            console.log('📺 Exemplo de episódio:', data.episodes?.[1]?.[0]); // Mostra estrutura do primeiro episódio
                            setSeriesInfo(data);
                            // Reset to season 1 episode 1 when changing series
                            setSelectedSeason(1);
                            setSelectedEpisode(1);
                        })
                        .catch(err => {
                            console.error('❌ Error fetching series info:', err);
                            setSeriesInfo(null);
                        });
                }
            });
        } else {
            setSeriesInfo(null);
        }
    }, [selectedSeries]);

    if (loading) return (
        <div className="p-8">
            <h1 className="text-3xl font-bold text-white mb-6">Séries</h1>
            <div className="grid grid-cols-7 gap-[32px] px-[32px]">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((i) => (
                    <div key={i} className="animate-pulse">
                        <div className="aspect-[2/3] bg-gray-700 rounded-t-lg mb-0"></div>
                        <div className="bg-gray-700 rounded-b-lg p-2 h-16"></div>
                    </div>
                ))}
            </div>
        </div>
    );

    if (error) return (
        <div className="p-8">
            <h1 className="text-3xl font-bold text-white mb-6">Séries</h1>
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg text-center">
                <p className="font-medium mb-2">Erro ao carregar séries</p>
                <p className="text-sm">{error}</p>
                <button onClick={fetchSeries} className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Tentar novamente</button>
            </div>
        </div>
    );

    return (
        <>
            <style>{`
                @keyframes pulse{0%{opacity:1}50%{opacity:.7}100%{opacity:1}}
                @keyframes rotate{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
                @keyframes slideIn{from{transform:translateX(-10px);opacity:0}to{transform:translateX(0);opacity:1}}
                @keyframes buttonClick{
                    0%{transform:scale(1)}
                    50%{transform:scale(0.95)}
                    100%{transform:scale(1.05)}
                }
                .watch-button{transition:all .3s ease;animation:slideIn .5s ease-out}
                .watch-button:hover{transform:scale(1.05)!important;box-shadow:0 8px 24px rgba(37,99,235,.5)!important}
                .watch-button:active{transform:scale(.98)!important}
                .watch-button.clicked{animation:buttonClick 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)}
            `}</style>
            <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
                {selectedSeries && (() => {
                    // Priority: TMDB backdrop (high quality) > IPTV cover > IPTV stream_icon
                    const backdropUrl = tmdbData?.backdrop_path ? getBackdropUrl(tmdbData.backdrop_path) : null;
                    const fallbackUrl = selectedSeries.cover || fixImageUrl(selectedSeries.stream_icon);
                    const backgroundImageUrl = backdropUrl || fallbackUrl;

                    return backgroundImageUrl ? (
                        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, backgroundImage: `url(${backgroundImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(3px)', opacity: 0.5, pointerEvents: 'none' }}></div>
                    ) : null;
                })()}
                <div style={{ position: 'relative', zIndex: 10, padding: '32px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {selectedSeries && (
                        <div style={{ padding: '0 0 24px 0', marginBottom: '24px', flexShrink: 0 }}>
                            <div style={{ maxWidth: '900px' }}>
                                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                                    {loadingTmdb ? (
                                        <span style={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', color: '#9ca3af', padding: '6px 14px', borderRadius: '6px', fontSize: '14px', fontWeight: '600', fontStyle: 'italic', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)' }}>Carregando...</span>
                                    ) : tmdbData && tmdbData.first_air_date ? (
                                        <span style={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', color: 'white', padding: '6px 14px', borderRadius: '6px', fontSize: '14px', fontWeight: '600', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)' }}>{new Date(tmdbData.first_air_date).toLocaleDateString('pt-BR')}</span>
                                    ) : null}
                                    {loadingTmdb ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(234, 179, 8, 0.3)', padding: '6px 14px', borderRadius: '6px' }}>
                                            <span style={{ fontSize: '16px' }}>⭐</span>
                                            <span style={{ color: '#9ca3af', fontWeight: 'bold', fontSize: '14px', fontStyle: 'italic', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)' }}>...</span>
                                        </div>
                                    ) : tmdbData && tmdbData.vote_average ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(234, 179, 8, 0.3)', padding: '6px 14px', borderRadius: '6px', animation: 'pulse 2s ease-in-out infinite' }}>
                                            <span style={{ fontSize: '16px', animation: 'rotate 3s linear infinite' }}>⭐</span>
                                            <span style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: '14px', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)' }}>{tmdbData.vote_average.toFixed(1)}</span>
                                        </div>
                                    ) : null}
                                </div>
                                <h2 style={{ fontSize: '56px', fontWeight: 'bold', color: 'white', marginBottom: '16px', lineHeight: 1.1, textShadow: '4px 4px 12px rgba(0, 0, 0, 0.95)' }}>{selectedSeries.name}</h2>
                                {loadingTmdb ? (
                                    <p style={{ color: '#9ca3af', marginBottom: '16px', fontSize: '17px', fontStyle: 'italic', textShadow: '2px 2px 6px rgba(0, 0, 0, 0.9)' }}>Carregando gênero...</p>
                                ) : tmdbData && tmdbData.genres && tmdbData.genres.length > 0 ? (
                                    <p style={{ color: '#f3f4f6', marginBottom: '16px', fontSize: '17px', fontWeight: '500', textShadow: '2px 2px 6px rgba(0, 0, 0, 0.9)' }}>{formatGenres(tmdbData.genres)}</p>
                                ) : null}
                                {loadingTmdb ? (
                                    <p style={{ color: '#9ca3af', marginBottom: '28px', fontSize: '16px', fontStyle: 'italic', textShadow: '2px 2px 6px rgba(0, 0, 0, 0.9)' }}>Carregando sinopse...</p>
                                ) : tmdbData && tmdbData.overview ? (
                                    <p style={{ color: '#f9fafb', lineHeight: '1.8', marginBottom: '28px', fontSize: '16px', maxWidth: '650px', textShadow: '2px 2px 8px rgba(0, 0, 0, 0.95)' }}>{tmdbData.overview}</p>
                                ) : null}
                                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <select
                                        value={selectedSeason}
                                        onChange={(e) => {
                                            setSelectedSeason(Number(e.target.value));
                                            setSelectedEpisode(1); // Reset episode when changing season
                                        }}
                                        style={{
                                            padding: '14px 20px',
                                            backgroundColor: 'rgba(30, 30, 30, 0.9)',
                                            color: 'white',
                                            fontSize: '16px',
                                            fontWeight: '600',
                                            borderRadius: '8px',
                                            border: '2px solid rgba(59, 130, 246, 0.5)',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                                            minWidth: '140px'
                                        }}>
                                        {seriesInfo?.episodes ? Object.keys(seriesInfo.episodes).sort((a, b) => Number(a) - Number(b)).map((season: string) => (
                                            <option key={season} value={season}>Temporada {season}</option>
                                        )) : <option value="1">Temporada 1</option>}
                                    </select>

                                    <select
                                        value={selectedEpisode}
                                        onChange={(e) => setSelectedEpisode(Number(e.target.value))}
                                        style={{
                                            padding: '14px 20px',
                                            backgroundColor: 'rgba(30, 30, 30, 0.9)',
                                            color: 'white',
                                            fontSize: '16px',
                                            fontWeight: '600',
                                            borderRadius: '8px',
                                            border: '2px solid rgba(59, 130, 246, 0.5)',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                                            minWidth: '200px'
                                        }}>
                                        {seriesInfo?.episodes?.[selectedSeason] ? seriesInfo.episodes[selectedSeason].map((episode: any) => (
                                            <option key={episode.id} value={episode.episode_num}>
                                                {getEpisodeTitle(episode.title, episode.episode_num)}
                                            </option>
                                        )) : <option value="1">Episódio 1</option>}
                                    </select>

                                    <button
                                        onClick={() => handlePlaySeries(selectedSeries)}
                                        className="watch-button"
                                        style={{
                                            padding: '14px 32px',
                                            backgroundColor: '#2563eb',
                                            color: 'white',
                                            fontSize: '16px',
                                            fontWeight: '700',
                                            borderRadius: '8px',
                                            border: 'none',
                                            cursor: 'pointer',
                                            boxShadow: '0 6px 16px rgba(37, 99, 235, 0.4)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px'
                                        }}>
                                        <span style={{ fontSize: '20px' }}>▶</span>
                                        Assistir
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                        <div className="grid grid-cols-7 gap-[32px] px-[32px]">
                            {filteredSeries.map((s) => (
                                <div key={s.series_id} className="group cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-95" onClick={() => setSelectedSeries(s)}>
                                    <div className="relative overflow-hidden bg-gray-900 shadow-xl" style={{ borderRadius: '16px', border: selectedSeries?.series_id === s.series_id ? '3px solid #3b82f6' : '3px solid transparent' }}>
                                        <div className="aspect-[2/3]">
                                            {(s.cover || s.stream_icon) && !brokenImages.has(s.series_id) ? (
                                                <img src={fixImageUrl(s.cover || s.stream_icon)} alt={s.name} className="w-full h-full object-cover" style={{ borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }} onError={() => handleImageError(s.series_id)} />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-gray-700" style={{ borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}><span className="text-5xl">📺</span></div>
                                            )}
                                        </div>
                                        <div style={{ background: 'linear-gradient(to top, #111827, rgba(31, 41, 55, 0.95), rgba(31, 41, 55, 0.8))', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px', paddingLeft: '12px', paddingRight: '12px', paddingTop: '12px', paddingBottom: '12px' }}>
                                            <h3 className="text-white text-sm font-semibold truncate group-hover:text-blue-400 transition-colors">{s.name}</h3>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {playingSeries && (
                <AsyncVideoPlayer
                    movie={playingSeries}
                    buildStreamUrl={buildSeriesStreamUrl}
                    onClose={() => setPlayingSeries(null)}
                />
            )
            }
        </>
    );
}
