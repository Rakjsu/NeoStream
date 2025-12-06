import { useState, useEffect, useRef } from 'react';
import { CategoryMenu } from '../components/CategoryMenu';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { epgService } from '../services/epgService';

interface LiveStream {
    num: number;
    name: string;
    stream_type: string;
    stream_id: number;
    stream_icon: string;
    epg_channel_id: string;
    added: string;
    category_id: string;
    custom_sid: string;
    tv_archive: number;
    direct_source: string;
    tv_archive_duration: number;
}

// Channel card approximate dimensions
const CARD_WIDTH = 200; // min-width of grid column
const CARD_HEIGHT = 80; // approximate card height with gap
const GRID_GAP = 16; // gap between cards

// LiveTV Component - Icons: 6px - Updated 2025-11-26 00:29
export function LiveTV() {
    const [streams, setStreams] = useState<LiveStream[]>([]);
    const [_categories, setCategories] = useState<Array<{ category_id: string; category_name: string; parent_id: number }>>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [selectedChannel, setSelectedChannel] = useState<LiveStream | null>(null);
    const [playingChannel, setPlayingChannel] = useState<LiveStream | null>(null);
    const [_epgData, setEpgData] = useState<any[]>([]);
    const [currentProgram, setCurrentProgram] = useState<any | null>(null);
    const [upcomingPrograms, setUpcomingPrograms] = useState<any[]>([]);
    const [visibleCount, setVisibleCount] = useState(0);
    const [itemsPerPage, setItemsPerPage] = useState(48); // Default fallback
    const [progressTick, setProgressTick] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Calculate items per page based on window dimensions
    useEffect(() => {
        const calculateItemsPerPage = () => {
            // Use window dimensions directly - more reliable
            const availableWidth = window.innerWidth - 100; // sidebar + padding
            const availableHeight = window.innerHeight - 150; // header + padding

            // Calculate how many columns fit
            const columns = Math.max(1, Math.floor(availableWidth / (CARD_WIDTH + GRID_GAP)));
            // Calculate how many rows fit + buffer for scroll
            const rows = Math.max(3, Math.ceil(availableHeight / (CARD_HEIGHT + GRID_GAP)) + 3);

            const calculatedItems = columns * rows;

            console.log('[LiveTV Grid]', {
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight,
                availableWidth,
                availableHeight,
                columns,
                rows,
                calculatedItems
            });

            setItemsPerPage(calculatedItems);
            setVisibleCount(calculatedItems);
        };

        // Initial calculation
        calculateItemsPerPage();

        // Recalculate after layout is ready
        setTimeout(calculateItemsPerPage, 200);

        // Listen to window resize
        window.addEventListener('resize', calculateItemsPerPage);

        return () => {
            window.removeEventListener('resize', calculateItemsPerPage);
        };
    }, []);

    useEffect(() => {
        fetchStreams();
        fetchCategories();
    }, []);

    // Update progress bar every 10 seconds
    useEffect(() => {
        if (!currentProgram) return;
        const interval = setInterval(() => {
            setProgressTick(t => t + 1);
        }, 10000);
        return () => clearInterval(interval);
    }, [currentProgram]);


    // Fetch EPG when channel is selected
    useEffect(() => {
        if (!selectedChannel || !selectedChannel.epg_channel_id) {
            setEpgData([]);
            setCurrentProgram(null);
            setUpcomingPrograms([]);
            return;
        }

        let intervalId: number;

        const fetchEPG = async () => {
            // Pass both EPG ID and channel name (for meuguia.tv fallback)
            const programs = await epgService.fetchChannelEPG(selectedChannel.epg_channel_id, selectedChannel.name);
            setEpgData(programs);

            const current = epgService.getCurrentProgram(programs);
            setCurrentProgram(current);

            const upcoming = epgService.getUpcomingPrograms(programs, current, 3);
            setUpcomingPrograms(upcoming);
        };

        fetchEPG();
        // Refresh EPG every 60 seconds
        intervalId = setInterval(fetchEPG, 60000);

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [selectedChannel]);

    const fetchStreams = async () => {
        setLoading(true);
        setError('');

        try {
            const result = await window.ipcRenderer.invoke('streams:get-live');

            if (result.success) {
                setStreams(result.data || []);
            } else {
                setError(result.error || 'Failed to load channels');
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to connect to server');
        } finally {
            setLoading(false);
        }
    };

    const fetchCategories = async () => {
        try {
            const result = await window.ipcRenderer.invoke('categories:get-live');
            if (result.success) {
                setCategories(result.data || []);
            }
        } catch (err) {
            console.error('Failed to load categories:', err);
        }
    };

    const filteredStreams = streams.filter(stream => {
        const matchesSearch = stream.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = !selectedCategory || selectedCategory === 'all' || stream.category_id === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    // Lazy loading scroll listener
    useEffect(() => {
        const attachScrollListener = () => {
            const container = scrollContainerRef.current;
            if (!container) {
                // Retry after a short delay if container is not ready
                setTimeout(attachScrollListener, 100);
                return;
            }

            const handleScroll = () => {
                const { scrollTop, scrollHeight, clientHeight } = container;
                // Load more when 80% scrolled
                if (scrollTop + clientHeight >= scrollHeight * 0.8 && visibleCount < filteredStreams.length) {
                    setVisibleCount(prev => Math.min(prev + itemsPerPage, filteredStreams.length));
                }
            };

            container.addEventListener('scroll', handleScroll);
            return () => container.removeEventListener('scroll', handleScroll);
        };

        const cleanup = attachScrollListener();
        return () => {
            if (cleanup) cleanup();
        };
    }, [filteredStreams.length, visibleCount, itemsPerPage]);

    // Reset visible count when search or category changes
    useEffect(() => {
        setVisibleCount(itemsPerPage);
        setSelectedChannel(null);
    }, [searchQuery, selectedCategory]);

    const handleImageError = (streamId: number) => {
        setBrokenImages(prev => new Set(prev).add(streamId));
    };


    const buildLiveStreamUrl = async (channel: LiveStream): Promise<string> => {
        try {
            const result = await window.ipcRenderer.invoke('auth:get-credentials');

            if (result.success) {
                const { url, username, password } = result.credentials;
                const streamUrl = `${url}/live/${username}/${password}/${channel.stream_id}.m3u8`;
                return streamUrl;
            }

            throw new Error('Credenciais não encontradas');
        } catch (error) {
            console.error('❌ Error building live stream URL:', error);
            throw error;
        }
    };

    if (loading) {
        return (
            <div className="p-8">
                <h1 className="text-3xl font-bold text-white mb-6">Canais de TV</h1>
                <div className="space-y-px">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                        <div key={i} className="bg-gray-800 py-1 px-2 border-b border-gray-700/50 flex items-center gap-2 animate-pulse">
                            <div className="w-[16px] h-[16px] bg-gray-700 rounded"></div>
                            <div className="flex-1">
                                <div className="h-3 bg-gray-700 rounded w-2/3"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8">
                <h1 className="text-3xl font-bold text-white mb-6">Canais de TV</h1>
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg text-center">
                    <p className="font-medium mb-2">Erro ao carregar canais</p>
                    <p className="text-sm">{error}</p>
                    <button
                        onClick={fetchStreams}
                        className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                    >
                        Tentar novamente
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
            {/* Animated Backdrop */}
            <div style={{
                position: 'fixed',
                inset: 0,
                background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
                zIndex: 0
            }} />
            <div style={{
                position: 'fixed',
                inset: 0,
                background: `
                    radial-gradient(ellipse at 20% 20%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
                    radial-gradient(ellipse at 80% 80%, rgba(147, 51, 234, 0.1) 0%, transparent 50%),
                    radial-gradient(ellipse at 50% 50%, rgba(59, 130, 246, 0.05) 0%, transparent 70%)
                `,
                pointerEvents: 'none',
                zIndex: 0,
                animation: 'backdropPulse 8s ease-in-out infinite'
            }} />
            <style>{`
                @keyframes backdropPulse {
                    0%, 100% { opacity: 0.5; }
                    50% { opacity: 0.8; }
                }
            `}</style>
            <AnimatedSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar canais..."
            />
            <CategoryMenu
                onSelectCategory={setSelectedCategory}
                selectedCategory={selectedCategory}
                type="live"
            />
            <div ref={scrollContainerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', paddingTop: '40px' }}>
                {selectedChannel && (
                    <div style={{
                        padding: '24px 20px 24px 60px',
                        marginBottom: '24px',
                        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.98) 0%, rgba(31, 41, 55, 0.95) 50%, rgba(17, 24, 39, 0.98) 100%)',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                        animation: 'slideDown 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                        backdropFilter: 'blur(20px)'
                    }}>
                        <style>{`
                            @keyframes slideDown {
                                from { opacity: 0; transform: translateY(-20px); }
                                to { opacity: 1; transform: translateY(0); }
                            }
                            @keyframes fadeInScale {
                                from { opacity: 0; transform: scale(0.95); }
                                to { opacity: 1; transform: scale(1); }
                            }
                            @keyframes shimmer {
                                0% { background-position: -200% 0; }
                                100% { background-position: 200% 0; }
                            }
                            @keyframes progressGlow {
                                0%, 100% { box-shadow: 0 0 8px rgba(59, 130, 246, 0.5); }
                                50% { box-shadow: 0 0 16px rgba(59, 130, 246, 0.8); }
                            }
                            @keyframes pulse {
                                0%, 100% { opacity: 1; }
                                50% { opacity: 0.6; }
                            }
                            @keyframes liveGlow {
                                0%, 100% { box-shadow: 0 0 10px rgba(239, 68, 68, 0.6), 0 0 20px rgba(239, 68, 68, 0.4); }
                                50% { box-shadow: 0 0 20px rgba(239, 68, 68, 0.8), 0 0 40px rgba(239, 68, 68, 0.5); }
                            }
                            @keyframes liveDot {
                                0%, 100% { opacity: 1; transform: scale(1); }
                                50% { opacity: 0.5; transform: scale(0.7); }
                            }
                            @keyframes slideUp {
                                from { opacity: 0; transform: translateY(20px); }
                                to { opacity: 1; transform: translateY(0); }
                            }
                            .epg-program-item {
                                animation: slideUp 0.4s ease-out forwards;
                            }
                            .epg-item { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
                            .epg-item:hover { transform: translateX(8px); background: rgba(255, 255, 255, 0.1) !important; }
                            .preview-container { flex: 1; min-width: 0; }
                            .epg-container { flex: 1; min-width: 0; }
                            @media (max-width: 1200px) {
                                .preview-epg-wrapper { flex-direction: column !important; }
                                .preview-container, .epg-container { flex: none !important; width: 100% !important; }
                            }
                        `}</style>

                        {/* Channel Title */}
                        <h2 style={{
                            fontSize: 'clamp(24px, 3vw, 32px)',
                            fontWeight: '800',
                            background: 'linear-gradient(135deg, #ffffff 0%, #94a3b8 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            marginBottom: '20px',
                            letterSpacing: '-0.5px',
                            animation: 'fadeInScale 0.5s ease-out'
                        }}>
                            {selectedChannel.name}
                        </h2>

                        <div className="preview-epg-wrapper" style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                            {/* Preview Video Container - 50% */}
                            <div className="preview-container" style={{ animation: 'fadeInScale 0.5s ease-out 0.1s both' }}>
                                <div style={{
                                    width: '100%',
                                    aspectRatio: '16/9',
                                    borderRadius: '16px',
                                    overflow: 'hidden',
                                    position: 'relative',
                                    marginBottom: '20px',
                                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)'
                                }}>
                                    <video
                                        id="preview-video"
                                        key={selectedChannel.stream_id}
                                        autoPlay
                                        muted
                                        playsInline
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', background: 'transparent' }}
                                        ref={(videoEl) => {
                                            if (videoEl) {
                                                const loadVideo = async () => {
                                                    try {
                                                        const url = await buildLiveStreamUrl(selectedChannel);
                                                        if (url.includes('.m3u8') && !(window as any).Hls) {
                                                            await new Promise((resolve, reject) => {
                                                                const script = document.createElement('script');
                                                                script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
                                                                script.onload = () => resolve(true);
                                                                script.onerror = () => reject(new Error('Failed to load hls.js'));
                                                                document.head.appendChild(script);
                                                            });
                                                        }
                                                        if (url.includes('.m3u8')) {
                                                            const Hls = (window as any).Hls;
                                                            if (Hls && Hls.isSupported()) {
                                                                const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
                                                                hls.loadSource(url);
                                                                hls.attachMedia(videoEl);
                                                                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                                                                    videoEl.play().catch(() => { });
                                                                });
                                                            } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                                                                videoEl.src = url;
                                                                await videoEl.play();
                                                            }
                                                        } else {
                                                            videoEl.src = url;
                                                            await videoEl.play();
                                                        }
                                                    } catch (error) {
                                                        console.error('Preview load error:', error);
                                                    }
                                                };
                                                loadVideo();
                                            }
                                        }}
                                    />
                                    {/* Live Badge */}
                                    <div style={{
                                        position: 'absolute',
                                        top: '16px',
                                        right: '16px',
                                        background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                                        padding: '8px 16px',
                                        borderRadius: '24px',
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        color: 'white',
                                        textTransform: 'uppercase',
                                        letterSpacing: '1.5px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        animation: 'liveGlow 2s ease-in-out infinite'
                                    }}>
                                        <span style={{
                                            width: '8px',
                                            height: '8px',
                                            background: 'white',
                                            borderRadius: '50%',
                                            animation: 'liveDot 1s ease-in-out infinite'
                                        }} />
                                        AO VIVO
                                    </div>
                                </div>

                                {/* Buttons */}
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    <button
                                        onClick={() => {
                                            setPlayingChannel(selectedChannel);
                                            setSelectedChannel(null);
                                        }}
                                        style={{
                                            flex: '1 1 auto',
                                            minWidth: '150px',
                                            padding: '14px 32px',
                                            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                            color: 'white',
                                            fontWeight: '700',
                                            fontSize: '15px',
                                            borderRadius: '12px',
                                            border: 'none',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '10px',
                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            boxShadow: '0 10px 30px -5px rgba(59, 130, 246, 0.5)'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                                            e.currentTarget.style.boxShadow = '0 15px 40px -5px rgba(59, 130, 246, 0.6)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                            e.currentTarget.style.boxShadow = '0 10px 30px -5px rgba(59, 130, 246, 0.5)';
                                        }}
                                    >
                                        <span style={{ fontSize: '18px' }}>▶</span> Assistir Agora
                                    </button>

                                    <button
                                        onClick={() => setSelectedChannel(null)}
                                        style={{
                                            padding: '14px 24px',
                                            background: 'rgba(255, 255, 255, 0.05)',
                                            color: 'rgba(255, 255, 255, 0.9)',
                                            fontWeight: '600',
                                            fontSize: '15px',
                                            borderRadius: '12px',
                                            border: '1px solid rgba(255, 255, 255, 0.15)',
                                            cursor: 'pointer',
                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            backdropFilter: 'blur(10px)'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                        }}
                                    >
                                        ✕ Fechar
                                    </button>
                                </div>
                            </div>

                            {/* EPG Schedule Panel - 50% */}
                            <div className="epg-container" style={{
                                background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
                                borderRadius: '16px',
                                padding: 'clamp(16px, 2vw, 24px)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                backdropFilter: 'blur(20px)',
                                animation: 'fadeInScale 0.5s ease-out 0.2s both',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
                                height: 'fit-content'
                            }}>
                                <h3 style={{
                                    fontSize: 'clamp(16px, 2vw, 18px)',
                                    fontWeight: '700',
                                    color: 'white',
                                    marginBottom: '20px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px'
                                }}>
                                    <span style={{
                                        background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                                        padding: '8px',
                                        borderRadius: '10px',
                                        display: 'flex',
                                        boxShadow: '0 4px 15px rgba(59, 130, 246, 0.3)'
                                    }}>📺</span>
                                    Grade Horária
                                </h3>

                                {currentProgram ? (
                                    <>
                                        {/* Current Program */}
                                        <div style={{
                                            marginBottom: '20px',
                                            padding: 'clamp(14px, 2vw, 20px)',
                                            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%)',
                                            borderRadius: '14px',
                                            border: '1px solid rgba(59, 130, 246, 0.25)',
                                            position: 'relative',
                                            overflow: 'hidden'
                                        }}>
                                            <div style={{
                                                position: 'absolute',
                                                top: 0, left: 0, right: 0, bottom: 0,
                                                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)',
                                                backgroundSize: '200% 100%',
                                                animation: 'shimmer 3s infinite',
                                                pointerEvents: 'none'
                                            }} />

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                                <span style={{
                                                    width: '10px',
                                                    height: '10px',
                                                    background: '#ef4444',
                                                    borderRadius: '50%',
                                                    animation: 'pulse 1.5s ease-in-out infinite',
                                                    boxShadow: '0 0 10px rgba(239, 68, 68, 0.6)'
                                                }} />
                                                <span style={{ fontSize: '12px', color: '#93c5fd', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                                    AGORA
                                                </span>
                                            </div>

                                            <div style={{ fontSize: 'clamp(14px, 1.5vw, 18px)', color: 'white', fontWeight: '700', marginBottom: '8px', lineHeight: '1.4' }}>
                                                {currentProgram.title}
                                            </div>

                                            <div style={{ fontSize: '13px', color: 'rgba(148, 163, 184, 1)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span>🕐</span>
                                                {epgService.formatTime(currentProgram.start)} - {epgService.formatTime(currentProgram.end)}
                                            </div>

                                            {/* Progress Bar */}
                                            <div key={`progress-${progressTick}`} style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                                                <div style={{
                                                    width: `${epgService.getProgramProgress(currentProgram)}%`,
                                                    height: '100%',
                                                    background: 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)',
                                                    borderRadius: '3px',
                                                    transition: 'width 1s ease',
                                                    animation: 'progressGlow 2s ease-in-out infinite'
                                                }} />
                                            </div>
                                        </div>

                                        {/* Upcoming Programs */}
                                        {upcomingPrograms.length > 0 && (
                                            <div>
                                                <div style={{ fontSize: '13px', color: 'rgba(148, 163, 184, 1)', marginBottom: '14px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                    A Seguir
                                                </div>
                                                {upcomingPrograms.map((program, index) => (
                                                    <div
                                                        key={program.id || index}
                                                        className="epg-item epg-program-item"
                                                        style={{
                                                            marginBottom: '10px',
                                                            padding: 'clamp(10px, 1.5vw, 14px) clamp(12px, 1.5vw, 16px)',
                                                            background: 'rgba(255, 255, 255, 0.03)',
                                                            borderRadius: '10px',
                                                            border: '1px solid rgba(255, 255, 255, 0.05)',
                                                            cursor: 'pointer',
                                                            animationDelay: `${index * 0.1}s`
                                                        }}
                                                    >
                                                        <div style={{ fontSize: 'clamp(12px, 1.2vw, 14px)', color: 'white', fontWeight: '500', marginBottom: '6px' }}>
                                                            {program.title}
                                                        </div>
                                                        <div style={{ fontSize: '12px', color: 'rgba(148, 163, 184, 0.8)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <span style={{ opacity: 0.7 }}>🕐</span>
                                                            {epgService.formatTime(program.start)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(148, 163, 184, 0.8)' }}>
                                        <div style={{ fontSize: '48px', marginBottom: '16px', filter: 'grayscale(0.3)' }}>📺</div>
                                        <div style={{ fontWeight: '500' }}>Sem informações de programação</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <div ref={scrollContainerRef} className="p-8" style={{ paddingLeft: '60px', position: 'relative', zIndex: 1, height: 'calc(100vh - 120px)', overflowY: 'auto' }}>
                    <style>{`
                        .channel-card {
                            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                            transform-origin: center;
                            animation: channelFadeIn 0.4s ease backwards;
                        }
                        @keyframes channelFadeIn {
                            from { opacity: 0; transform: translateY(10px) scale(0.98); }
                            to { opacity: 1; transform: translateY(0) scale(1); }
                        }
                        .channel-card:hover {
                            transform: translateY(-4px) scale(1.02);
                            background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(31, 41, 55, 0.95) 100%) !important;
                            border-color: rgba(59, 130, 246, 0.4) !important;
                            box-shadow: 0 15px 40px -10px rgba(59, 130, 246, 0.35);
                        }
                        .channel-card:hover .channel-logo { transform: scale(1.1); }
                        .channel-logo { transition: transform 0.3s ease; }
                        .channel-card:active { transform: translateY(-2px) scale(0.98); }
                        .channels-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                            gap: 16px;
                        }
                        @media (max-width: 1200px) {
                            .channels-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
                        }
                        @media (max-width: 768px) {
                            .channels-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
                        }
                        @media (max-width: 480px) {
                            .channels-grid { grid-template-columns: 1fr; }
                        }
                    `}</style>

                    {filteredStreams.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                            <div style={{ fontSize: '64px', marginBottom: '16px', opacity: 0.5 }}>📺</div>
                            <p style={{ fontSize: '18px', color: 'rgba(156, 163, 175, 1)', fontWeight: '500' }}>Nenhum canal encontrado</p>
                            <p style={{ fontSize: '14px', color: 'rgba(107, 114, 128, 1)', marginTop: '8px' }}>Tente buscar por outro termo</p>
                        </div>
                    ) : (
                        <div className="channels-grid" style={{ animation: 'fadeInScale 0.5s ease-out' }}>
                            {filteredStreams.slice(0, visibleCount).map((stream) => (
                                <div
                                    key={stream.stream_id}
                                    onClick={() => setSelectedChannel(stream)}
                                    className="channel-card"
                                    style={{
                                        background: selectedChannel?.stream_id === stream.stream_id
                                            ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(55, 65, 81, 1) 100%)'
                                            : 'linear-gradient(135deg, rgba(31, 41, 55, 0.8) 0%, rgba(55, 65, 81, 0.9) 100%)',
                                        padding: '12px 16px',
                                        borderRadius: '12px',
                                        border: selectedChannel?.stream_id === stream.stream_id
                                            ? '1px solid rgba(59, 130, 246, 0.5)'
                                            : '1px solid rgba(255, 255, 255, 0.06)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '16px'
                                    }}
                                >
                                    <div
                                        className="channel-logo"
                                        style={{
                                            width: '56px',
                                            height: '56px',
                                            background: 'linear-gradient(145deg, rgba(55, 65, 81, 1) 0%, rgba(31, 41, 55, 1) 100%)',
                                            borderRadius: '10px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            overflow: 'hidden',
                                            flexShrink: 0,
                                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
                                        }}
                                    >
                                        {stream.stream_icon && !brokenImages.has(stream.stream_id) ? (
                                            <img
                                                src={stream.stream_icon}
                                                alt=""
                                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '4px' }}
                                                onError={() => handleImageError(stream.stream_id)}
                                            />
                                        ) : (
                                            <div style={{
                                                width: '100%',
                                                height: '100%',
                                                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '20px'
                                            }}>📺</div>
                                        )}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{
                                            color: selectedChannel?.stream_id === stream.stream_id ? '#93c5fd' : 'rgba(229, 231, 235, 1)',
                                            fontSize: '14px',
                                            fontWeight: selectedChannel?.stream_id === stream.stream_id ? '600' : '500',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            letterSpacing: '-0.2px'
                                        }}>
                                            {stream.name}
                                        </p>
                                    </div>
                                    {selectedChannel?.stream_id === stream.stream_id && (
                                        <div style={{
                                            width: '8px',
                                            height: '8px',
                                            background: '#3b82f6',
                                            borderRadius: '50%',
                                            boxShadow: '0 0 10px rgba(59, 130, 246, 0.6)',
                                            animation: 'pulse 2s ease-in-out infinite'
                                        }} />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {
                playingChannel && (
                    <AsyncVideoPlayer
                        movie={playingChannel as any}
                        buildStreamUrl={buildLiveStreamUrl}
                        onClose={() => setPlayingChannel(null)}
                        customTitle={playingChannel.name}
                    />
                )
            }
        </div >
    );
}
