import { useState, useEffect } from 'react';
import { formatGenres, type TMDBMovieDetails, getBackdropUrl } from '../services/tmdb';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';

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
}

export function VOD() {
    const [streams, setStreams] = useState<VODStream[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [selectedMovie, setSelectedMovie] = useState<VODStream | null>(null);
    const [tmdbData, setTmdbData] = useState<TMDBMovieDetails | null>(null);
    const [loadingTmdb, setLoadingTmdb] = useState(false);
    const [playingMovie, setPlayingMovie] = useState<VODStream | null>(null);

    useEffect(() => { fetchStreams(); }, []);

    const fetchStreams = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await window.ipcRenderer.invoke('streams:get-vod');
            if (result.success) {
                setStreams(result.data || []);
            } else {
                setError(result.error || 'Failed to load movies');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    const filteredStreams = streams.filter(stream => stream.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const handleImageError = (streamId: number) => setBrokenImages(prev => new Set(prev).add(streamId));
    const fixImageUrl = (url: string): string => url && url.startsWith('http') ? url : `https://${url}`;

    const extractYearFromName = (name: string): string => {
        const match = name.match(/\((\d{4})\)/);
        return match ? match[1] : '';
    };

    useEffect(() => {
        if (selectedMovie) {
            const year = extractYearFromName(selectedMovie.name);
            setLoadingTmdb(true);
            setTmdbData(null);
            import('../services/tmdb').then(({ searchMovieByName }) => {
                searchMovieByName(selectedMovie.name, year)
                    .then(data => { setTmdbData(data); setLoadingTmdb(false); })
                    .catch(() => setLoadingTmdb(false));
            });
        } else {
            setTmdbData(null);
        }
    }, [selectedMovie]);

    const handlePlayMovie = (movie: VODStream) => {
        setPlayingMovie(movie);
    };

    const buildStreamUrl = async (movie: VODStream): Promise<string> => {
        try {
            const result = await window.ipcRenderer.invoke('auth:get-credentials');

            if (result.success) {
                const { url, username, password } = result.credentials;
                const streamUrl = `${url}/movie/${username}/${password}/${movie.stream_id}.${movie.container_extension}`;
                return streamUrl;
            }

            throw new Error('Credenciais não encontradas');
        } catch (error) {
            console.error('❌ Error building stream URL:', error);
            throw error; // Re-throw instead of returning empty string
        }
    };

    if (loading) return (
        <div className="p-8">
            <h1 className="text-3xl font-bold text-white mb-6">Filmes</h1>
            <div className="grid grid-cols-9 gap-[32px] px-[32px]">
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
            <h1 className="text-3xl font-bold text-white mb-6">Filmes</h1>
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg text-center">
                <p className="font-medium mb-2">Erro ao carregar filmes</p>
                <p className="text-sm">{error}</p>
                <button onClick={fetchStreams} className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Tentar novamente</button>
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
                {selectedMovie && (() => {
                    // Priority: TMDB backdrop (high quality) > IPTV cover > IPTV stream_icon
                    const backdropUrl = tmdbData?.backdrop_path ? getBackdropUrl(tmdbData.backdrop_path) : null;
                    const fallbackUrl = selectedMovie.cover || fixImageUrl(selectedMovie.stream_icon);
                    const backgroundImageUrl = backdropUrl || fallbackUrl;

                    return backgroundImageUrl ? (
                        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, backgroundImage: `url(${backgroundImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(3px)', opacity: 0.5, pointerEvents: 'none' }}></div>
                    ) : null;
                })()}
                <AnimatedSearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Buscar filmes..."
                />
                <div style={{ position: 'relative', zIndex: 10, padding: '32px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {selectedMovie && (
                        <div style={{ padding: '0 0 24px 0', marginBottom: '24px', flexShrink: 0 }}>
                            <div style={{ maxWidth: '900px' }}>
                                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                                    {loadingTmdb ? (
                                        <span style={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', color: '#9ca3af', padding: '6px 14px', borderRadius: '6px', fontSize: '14px', fontWeight: '600', fontStyle: 'italic', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)' }}>Carregando...</span>
                                    ) : tmdbData && tmdbData.release_date ? (
                                        <span style={{ backgroundColor: 'rgba(31, 41, 55, 0.8)', color: 'white', padding: '6px 14px', borderRadius: '6px', fontSize: '14px', fontWeight: '600', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9)' }}>{new Date(tmdbData.release_date).toLocaleDateString('pt-BR')}</span>
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
                                <h2 style={{ fontSize: '56px', fontWeight: 'bold', color: 'white', marginBottom: '16px', lineHeight: 1.1, textShadow: '4px 4px 12px rgba(0, 0, 0, 0.95)' }}>{selectedMovie.name}</h2>
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
                                <div style={{ display: 'flex', gap: '14px' }}>
                                    <button
                                        className="watch-button"
                                        onClick={(e) => {
                                            e.currentTarget.classList.add('clicked');
                                            setTimeout(() => e.currentTarget.classList.remove('clicked'), 600);
                                            handlePlayMovie(selectedMovie);
                                        }}
                                        style={{
                                            padding: '16px 48px',
                                            backgroundColor: '#2563eb',
                                            color: 'white',
                                            fontWeight: 'bold',
                                            fontSize: '17px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            cursor: 'pointer',
                                            boxShadow: '0 6px 16px rgba(0, 0, 0, 0.6)',
                                            transition: 'all 0.2s ease',
                                            position: 'relative',
                                            overflow: 'hidden'
                                        }}>
                                        ▶ Assistir Agora
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingRight: '8px' }}>
                        {filteredStreams.length === 0 ? (
                            <div className="text-center text-gray-400 py-12"><p className="text-lg">Nenhum filme encontrado</p></div>
                        ) : (
                            <div className="grid grid-cols-9 gap-[32px] px-[32px]">
                                {filteredStreams.map((stream) => (
                                    <div key={stream.stream_id} className="group cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-95" onClick={() => setSelectedMovie(stream)}>
                                        <div className="relative overflow-hidden bg-gray-900 shadow-xl" style={{ borderRadius: '16px', border: selectedMovie?.stream_id === stream.stream_id ? '3px solid #3b82f6' : '3px solid transparent' }}>
                                            <div className="aspect-[2/3]">
                                                {stream.stream_icon && !brokenImages.has(stream.stream_id) ? (
                                                    <img src={fixImageUrl(stream.stream_icon)} alt={stream.name} className="w-full h-full object-cover" style={{ borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }} onError={() => handleImageError(stream.stream_id)} />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-gray-700" style={{ borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}><span className="text-5xl">🎬</span></div>
                                                )}
                                            </div>
                                            <div style={{ background: 'linear-gradient(to top, #111827, rgba(31, 41, 55, 0.95), rgba(31, 41, 55, 0.8))', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px', paddingLeft: '12px', paddingRight: '12px', paddingTop: '12px', paddingBottom: '12px' }}>
                                                <h3 className="text-white text-sm font-semibold truncate group-hover:text-blue-400 transition-colors">{stream.name}</h3>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div >

            {playingMovie && (
                <AsyncVideoPlayer
                    movie={playingMovie}
                    buildStreamUrl={buildStreamUrl}
                    onClose={() => setPlayingMovie(null)}
                />
            )
            }
        </>
    );
}
