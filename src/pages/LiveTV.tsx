import { useState, useEffect, useRef } from 'react';
import { CategoryMenu } from '../components/CategoryMenu';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';
import AsyncVideoPlayer from '../components/AsyncVideoPlayer';
import { epgService } from '../services/epgService';
import { profileService } from '../services/profileService';
import { parentalService } from '../services/parentalService';
import { useLanguage } from '../services/languageService';

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
    const isKidsProfile = profileService.getActiveProfile()?.isKids || false;
    const [allowedCategoryIds, setAllowedCategoryIds] = useState<Set<string>>(new Set());
    const [blockedCategoryIds, setBlockedCategoryIds] = useState<Set<string>>(new Set());
    const [pipResumeTime, setPipResumeTime] = useState<number | null>(null);
    const { t } = useLanguage();

    // For Kids profiles: only allow 'infantis' and '24 horas infantis' categories
    const KIDS_ALLOWED_PATTERNS = ['infantil', 'infantis', 'kids', 'criança', '24 horas infantis'];

    // Blocked category patterns for Parental Control
    const BLOCKED_CATEGORY_PATTERNS = ['adult', 'adulto', '+18', '18+', 'xxx', 'erotic', 'erótico'];

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

    // Listen for mini player expand event to reopen full player
    useEffect(() => {
        const handleMiniPlayerExpand = (e: CustomEvent) => {
            const { contentId, contentType, currentTime } = e.detail;
            if (contentType === 'live' && contentId) {
                // Find the channel in our list
                const channel = streams.find((c: LiveStream) => c.stream_id.toString() === contentId);
                if (channel) {
                    setPipResumeTime(currentTime || 0);
                    setPlayingChannel(channel);
                }
            }
        };

        window.addEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
        return () => window.removeEventListener('miniPlayerExpand', handleMiniPlayerExpand as EventListener);
    }, [streams]);

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
        // Allow EPG fetch if we have any identifier (epg_channel_id OR name)
        if (!selectedChannel || (!selectedChannel.epg_channel_id && !selectedChannel.name)) {
            setEpgData([]);
            setCurrentProgram(null);
            setUpcomingPrograms([]);
            return;
        }

        let intervalId: number;

        const fetchEPG = async () => {
            console.log('[EPG] Fetching EPG for channel:', selectedChannel.name, 'EPG ID:', selectedChannel.epg_channel_id);
            // Pass both EPG ID and channel name (for Open-EPG Portugal and meuguia.tv fallback)
            const programs = await epgService.fetchChannelEPG(selectedChannel.epg_channel_id || '', selectedChannel.name);
            console.log('[EPG] Got programs:', programs.length);
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

                // For Kids profile: extract allowed category IDs (only infantis)
                if (isKidsProfile) {
                    const allowedIds = new Set<string>();
                    (result.data || []).forEach((cat: { category_id: string; category_name: string }) => {
                        const lowerName = cat.category_name.toLowerCase();
                        if (KIDS_ALLOWED_PATTERNS.some(p => lowerName.includes(p))) {
                            allowedIds.add(cat.category_id);
                        }
                    });
                    setAllowedCategoryIds(allowedIds);
                }

                // For Parental Control: block adult categories
                const parentalConfig = parentalService.getConfig();
                if (parentalConfig.enabled && parentalConfig.blockAdultCategories && !parentalService.isSessionUnlocked()) {
                    const blockedIds = new Set<string>();
                    (result.data || []).forEach((cat: { category_id: string; category_name: string }) => {
                        const lowerName = cat.category_name.toLowerCase();
                        if (BLOCKED_CATEGORY_PATTERNS.some(p => lowerName.includes(p))) {
                            blockedIds.add(cat.category_id);
                        }
                    });
                    setBlockedCategoryIds(blockedIds);
                } else {
                    setBlockedCategoryIds(new Set());
                }
            }
        } catch (err) {
            console.error('Failed to load categories:', err);
        }
    };

    const filteredStreams = streams.filter(stream => {
        const matchesSearch = stream.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = !selectedCategory || selectedCategory === 'all' || stream.category_id === selectedCategory;

        // Parental Control: block channels from adult categories
        if (blockedCategoryIds.has(stream.category_id)) {
            return false;
        }

        // Kids profile: only allow channels from infantis categories
        if (isKidsProfile && allowedCategoryIds.size > 0) {
            if (!allowedCategoryIds.has(stream.category_id)) {
                return false;
            }
        }

        return matchesSearch && matchesCategory;
    });

    // Scroll handler for lazy loading
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const container = e.currentTarget;
        const { scrollTop, scrollHeight, clientHeight } = container;
        const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

        // Load more when 80% scrolled
        if (scrollPercentage >= 0.8 && visibleCount < filteredStreams.length) {
            const newCount = Math.min(visibleCount + itemsPerPage, filteredStreams.length);
            setVisibleCount(newCount);
        }
    };

    // Reset visible count when search or category changes
    useEffect(() => {
        setVisibleCount(itemsPerPage);
        setSelectedChannel(null);
    }, [searchQuery, selectedCategory]);

    const handleImageError = (streamId: number) => {
        setBrokenImages(prev => new Set(prev).add(streamId));
    };

    // Find quality variants for a channel (e.g., Globo SP matches Globo [4K])
    const getChannelQualityVariants = (channel: LiveStream) => {
        // Brazilian state abbreviations for regional channels
        const stateAbbreviations = new Set([
            'sp', 'rj', 'mg', 'rs', 'pr', 'sc', 'ba', 'pe', 'ce', 'pa',
            'go', 'ma', 'pb', 'am', 'rn', 'pi', 'al', 'mt', 'ms', 'se',
            'ro', 'to', 'ac', 'ap', 'rr', 'es', 'df'
        ]);

        // Function to extract base name, quality and codec from a channel name
        const extractInfo = (name: string): { baseName: string; quality: string; codec: string; label: string; priority: number; hasOnlyQuality: boolean; regionSuffix: string } => {
            let workingName = name.trim();
            let quality = '';
            let codec = '';
            let priority = 2; // Default HD priority

            // Detect resolution quality
            if (/\[4K\]|\(4K\)|2160p/i.test(workingName)) {
                quality = '4K';
                priority = 0;
            } else if (/\[UHD\]|\(UHD\)/i.test(workingName)) {
                quality = 'UHD';
                priority = 0;
            } else if (/\[FHD\]|\(FHD\)|1080p/i.test(workingName)) {
                quality = 'FHD';
                priority = 1;
            } else if (/\[HD\]|\(HD\)|720p/i.test(workingName)) {
                quality = 'HD';
                priority = 2;
            } else if (/\[SD\]|\(SD\)|480p/i.test(workingName)) {
                quality = 'SD';
                priority = 3;
            }

            // Detect codec (H.265/HEVC)
            if (/\[H\.?265\]|\(H\.?265\)|HEVC/i.test(workingName)) {
                codec = 'H.265';
                // H.265 gives slightly higher priority within same quality
                priority = Math.max(0, priority - 0.5);
            }

            // Create label
            let label = quality || 'HD';
            if (codec) {
                label = quality ? `${quality} ${codec}` : codec;
            }

            // Strip ALL quality/codec indicators to get base name
            const baseName = workingName
                .replace(/\s*\[(?:FHD|HD|SD|4K|UHD|H\.?265|HEVC)\]\s*/gi, ' ')
                .replace(/\s*\((?:FHD|HD|SD|4K|UHD|H\.?265|HEVC)\)\s*/gi, ' ')
                .replace(/\s*(?:2160|1080|720|480)p?\s*/gi, ' ')
                .replace(/\s+FHD\s+/gi, ' ')
                .replace(/\s+HD\s+/gi, ' ')
                .replace(/\s+SD\s+/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            // Check if channel only has quality indicator (e.g., "Globo [4K]" -> baseName is "Globo")
            const hasOnlyQuality = !!(quality || codec) && baseName.length < workingName.length * 0.7;

            // Extract regional suffix (last word if it's a state abbreviation)
            const words = baseName.split(' ');
            const lastWord = words[words.length - 1]?.toLowerCase() || '';
            const regionSuffix = stateAbbreviations.has(lastWord) ? lastWord : '';

            return { baseName, quality, codec, label, priority, hasOnlyQuality, regionSuffix };
        };

        const currentInfo = extractInfo(channel.name);
        const { baseName } = currentInfo;

        // Find all channels that match this base name
        const variants: Array<{
            channel: LiveStream;
            quality: string;
            priority: number;
            label: string;
        }> = [];

        for (const stream of streams) {
            const info = extractInfo(stream.name);
            const streamBaseLower = info.baseName.toLowerCase();
            const currentBaseLower = baseName.toLowerCase();

            // Match conditions:
            // 1. Exact base name match (e.g., "Globo SP" === "Globo SP")
            const isExactMatch = streamBaseLower === currentBaseLower;

            // 2. For quality-only channels (e.g., "Globo [4K]"):
            //    Only match channels with same core name + state abbreviation (e.g., "Globo SP", "Globo RJ")
            //    NOT channels with different names (e.g., "Globo News", "Globo Minas")
            let isQualityVariant = false;
            if (currentInfo.hasOnlyQuality && currentBaseLower.length >= 3) {
                // Stream must have a state suffix and core name must match
                if (info.regionSuffix) {
                    const streamCoreWords = info.baseName.toLowerCase().split(' ');
                    streamCoreWords.pop(); // Remove state suffix
                    const streamCore = streamCoreWords.join(' ');
                    isQualityVariant = streamCore === currentBaseLower;
                }
            }

            // 3. For regional channels (e.g., "Globo SP"):
            //    Match quality-only channels with same core name (e.g., "Globo [4K]")
            let isCurrentRegionalVariant = false;
            if (currentInfo.regionSuffix && !currentInfo.hasOnlyQuality) {
                if (info.hasOnlyQuality) {
                    const currentCoreWords = currentBaseLower.split(' ');
                    currentCoreWords.pop(); // Remove state suffix
                    const currentCore = currentCoreWords.join(' ');
                    isCurrentRegionalVariant = info.baseName.toLowerCase() === currentCore;
                }
            }

            if (isExactMatch || isQualityVariant || isCurrentRegionalVariant) {
                // If no quality/codec detected, use "SD" as default label
                const label = (info.quality || info.codec) ? info.label : 'SD';
                const priority = (info.quality || info.codec) ? info.priority : 4;

                variants.push({
                    channel: stream,
                    quality: info.quality || 'SD',
                    priority: priority,
                    label: label
                });
            }
        }

        // Sort by priority (4K first, then FHD H.265, then FHD, then HD, then SD, then unmarked)
        variants.sort((a, b) => a.priority - b.priority);

        // Only return variants if there's more than one option
        return variants.length > 1 ? variants : [];
    };

    // Get best variant based on user preference
    const getBestVariantForPreference = (channel: LiveStream): LiveStream => {
        const variants = getChannelQualityVariants(channel);
        if (variants.length === 0) return channel;

        const preference = profileService.getPreferredQuality();

        // If auto or no preference, return best available (first in sorted list)
        if (preference === 'auto') {
            return variants[0].channel;
        }

        // Find matching preference
        const preferenceMap: Record<string, string[]> = {
            '4k': ['4K', 'UHD', '4k'],
            'fhd': ['FHD', 'FHD H.265', '1080p', '1080'],
            'hd': ['HD', '720p', '720'],
            'sd': ['SD', '480p', '480']
        };

        const targetLabels = preferenceMap[preference] || [];

        // Find first variant matching preference
        const preferred = variants.find(v =>
            targetLabels.some(label => v.label.toLowerCase().includes(label.toLowerCase()))
        );

        // Return preferred or best available
        return preferred?.channel || variants[0].channel;
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
            <div style={{
                position: 'relative',
                height: '100vh',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                {/* Background */}
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
                        radial-gradient(ellipse at 80% 80%, rgba(147, 51, 234, 0.1) 0%, transparent 50%)
                    `,
                    pointerEvents: 'none',
                    zIndex: 0
                }} />

                <style>{`
                    @keyframes tvPulse {
                        0%, 100% { transform: scale(1); opacity: 1; }
                        50% { transform: scale(1.1); opacity: 0.8; }
                    }
                    @keyframes ringExpand {
                        0% { transform: scale(0.8); opacity: 0.8; }
                        100% { transform: scale(2); opacity: 0; }
                    }
                    @keyframes shimmerLoad {
                        0% { background-position: -200% 0; }
                        100% { background-position: 200% 0; }
                    }
                    @keyframes fadeInUp {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    @keyframes dotPulse {
                        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
                        40% { transform: scale(1); opacity: 1; }
                    }
                `}</style>

                {/* Animated Icon Container */}
                <div style={{
                    position: 'relative',
                    zIndex: 1,
                    marginBottom: '40px'
                }}>
                    {/* Expanding Rings */}
                    {[0, 1, 2].map((i) => (
                        <div key={i} style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '100px',
                            height: '100px',
                            borderRadius: '50%',
                            border: '2px solid rgba(59, 130, 246, 0.3)',
                            animation: `ringExpand 2s ease-out infinite`,
                            animationDelay: `${i * 0.5}s`
                        }} />
                    ))}

                    {/* TV Icon */}
                    <div style={{
                        width: '100px',
                        height: '100px',
                        borderRadius: '24px',
                        background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '48px',
                        boxShadow: '0 20px 60px rgba(59, 130, 246, 0.4)',
                        animation: 'tvPulse 2s ease-in-out infinite'
                    }}>
                        📺
                    </div>
                </div>

                {/* Loading Text with Dots */}
                <div style={{
                    position: 'relative',
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '60px',
                    animation: 'fadeInUp 0.6s ease-out'
                }}>
                    <span style={{
                        fontSize: '18px',
                        fontWeight: '600',
                        color: 'rgba(255, 255, 255, 0.9)',
                        letterSpacing: '0.5px'
                    }}>
                        {t('categories', 'loadingChannels')}
                    </span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        {[0, 1, 2].map((i) => (
                            <span key={i} style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: '#3b82f6',
                                animation: 'dotPulse 1.4s ease-in-out infinite',
                                animationDelay: `${i * 0.2}s`
                            }} />
                        ))}
                    </div>
                </div>

                {/* Skeleton Cards Preview */}
                <div style={{
                    position: 'relative',
                    zIndex: 1,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 200px)',
                    gap: '16px',
                    opacity: 0.5,
                    animation: 'fadeInUp 0.6s ease-out 0.2s both'
                }}>
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} style={{
                            background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.6) 0%, rgba(55, 65, 81, 0.4) 100%)',
                            borderRadius: '12px',
                            padding: '12px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.05)'
                        }}>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '10px',
                                background: 'linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 100%)',
                                backgroundSize: '200% 100%',
                                animation: 'shimmerLoad 1.5s infinite'
                            }} />
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    height: '12px',
                                    width: '80%',
                                    borderRadius: '6px',
                                    background: 'linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 100%)',
                                    backgroundSize: '200% 100%',
                                    animation: 'shimmerLoad 1.5s infinite',
                                    marginBottom: '8px'
                                }} />
                                <div style={{
                                    height: '8px',
                                    width: '50%',
                                    borderRadius: '4px',
                                    background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 100%)',
                                    backgroundSize: '200% 100%',
                                    animation: 'shimmerLoad 1.5s infinite'
                                }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
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
                {/* Animated Background */}
                <div style={{
                    position: 'absolute',
                    width: '400px',
                    height: '400px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, transparent 70%)',
                    filter: 'blur(80px)',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    animation: 'pulse 4s ease-in-out infinite'
                }} />

                {/* Content */}
                <div style={{
                    position: 'relative',
                    zIndex: 1,
                    textAlign: 'center',
                    maxWidth: '400px'
                }}>
                    {/* Icon */}
                    <div style={{
                        width: '80px',
                        height: '80px',
                        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%)',
                        borderRadius: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 24px',
                        border: '1px solid rgba(239, 68, 68, 0.3)'
                    }}>
                        <span style={{ fontSize: '36px' }}>📡</span>
                    </div>

                    {/* Title */}
                    <h2 style={{
                        fontSize: '24px',
                        fontWeight: 600,
                        color: 'white',
                        margin: '0 0 8px 0'
                    }}>{t('login', 'loadChannelsError')}</h2>

                    {/* Error Message */}
                    <p style={{
                        fontSize: '14px',
                        color: 'rgba(255,255,255,0.5)',
                        margin: '0 0 8px 0'
                    }}>{t('login', 'connectionErrorDetails')}</p>

                    <p style={{
                        fontSize: '13px',
                        color: '#f87171',
                        margin: '0 0 32px 0',
                        padding: '12px 16px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        borderRadius: '8px',
                        border: '1px solid rgba(239, 68, 68, 0.2)'
                    }}>{error === 'Not authenticated' ? t('login', 'notAuthenticated') : error}</p>

                    {/* Retry Button */}
                    <button
                        onClick={fetchStreams}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '14px 28px',
                            background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                            border: 'none',
                            borderRadius: '12px',
                            color: 'white',
                            fontSize: '15px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: '0 8px 32px rgba(239, 68, 68, 0.3)',
                            transition: 'all 0.3s ease'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 12px 40px rgba(239, 68, 68, 0.4)';
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 8px 32px rgba(239, 68, 68, 0.3)';
                        }}
                    >
                        <span>🔄</span>
                        {t('profile', 'tryAgain') || 'Tentar novamente'}
                    </button>
                </div>

                <style>{`
                    @keyframes pulse {
                        0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
                        50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.1); }
                    }
                `}</style>
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
                placeholder={t('login', 'searchChannels')}
            />
            <CategoryMenu
                onSelectCategory={setSelectedCategory}
                selectedCategory={selectedCategory}
                type="live"
                isKidsProfile={isKidsProfile}
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
                                        {t('liveTV', 'live')}
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
                                        <span style={{ fontSize: '18px' }}>▶</span> {t('liveTV', 'watchNow')}
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
                                        ✕ {t('liveTV', 'close')}
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
                                    {t('liveTV', 'scheduleTitle')}
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
                                                    {t('liveTV', 'nowPlaying')}
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
                                                    {t('liveTV', 'upNext')}
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
                                        <div style={{ fontWeight: '500' }}>{t('liveTV', 'noScheduleInfo')}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <div ref={scrollContainerRef} onScroll={handleScroll} className="livetv-scroll-container p-8" style={{ paddingLeft: '60px', position: 'relative', zIndex: 1, height: 'calc(100vh - 120px)', overflowY: 'auto', paddingRight: '8px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(168, 85, 247, 0.4) transparent' }}>
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
                            overflow: hidden;
                            padding-right: 8px;
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
                        /* LiveTV Scrollbar Styling */
                        .livetv-scroll-container::-webkit-scrollbar {
                            width: 6px;
                        }
                        .livetv-scroll-container::-webkit-scrollbar-track {
                            background: transparent;
                        }
                        .livetv-scroll-container::-webkit-scrollbar-thumb {
                            background: linear-gradient(180deg, #a855f7, #ec4899);
                            border-radius: 3px;
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
                        onClose={() => {
                            setPlayingChannel(null);
                            setPipResumeTime(null);
                        }}
                        customTitle={playingChannel.name}
                        contentId={playingChannel.stream_id.toString()}
                        contentType="live"
                        resumeTime={pipResumeTime}
                        liveQualityVariants={getChannelQualityVariants(playingChannel)}
                        onSwitchQuality={(channel: any) => {
                            setPlayingChannel(channel);
                            // Save quality preference based on selected variant
                            const variants = getChannelQualityVariants(channel);
                            const selectedVariant = variants.find(v => v.channel.stream_id === channel.stream_id);
                            if (selectedVariant) {
                                const label = selectedVariant.label.toLowerCase();
                                if (label.includes('4k') || label.includes('uhd')) {
                                    profileService.setPreferredQuality('4k');
                                } else if (label.includes('fhd') || label.includes('1080')) {
                                    profileService.setPreferredQuality('fhd');
                                } else if (label.includes('hd') || label.includes('720')) {
                                    profileService.setPreferredQuality('hd');
                                } else if (label.includes('sd') || label.includes('480')) {
                                    profileService.setPreferredQuality('sd');
                                }
                            }
                        }}
                    />
                )
            }
        </div >
    );
}
