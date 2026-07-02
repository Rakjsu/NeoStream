import { useState, useEffect } from 'react';
import { autoFetchSubtitle, autoFetchForcedSubtitle, cleanupSubtitleUrl } from '../../services/subtitleService';
import { useLanguage } from '../../services/languageService';

export interface UseSubtitleManagerParams {
    title?: string;
    tmdbId?: string | number;
    imdbId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useSubtitleManager({
    title,
    tmdbId,
    imdbId,
    seasonNumber,
    episodeNumber,
    videoRef
}: UseSubtitleManagerParams) {
    const { t } = useLanguage();

    const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
    const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
    const [subtitleLoading, setSubtitleLoading] = useState(false);
    const [subtitleLanguage, setSubtitleLanguage] = useState<string | null>(null);
    const [vttContent, setVttContent] = useState<string | null>(null);
    const [subtitleWarning, setSubtitleWarning] = useState<string | null>(null);
    const [isForcedSubtitle, setIsForcedSubtitle] = useState(false); // Track if current subtitle is Forced type
    // Initialize session toggle from global config (enabled = setting is ON)
    const [forcedEnabledForSession, setForcedEnabledForSession] = useState(() => {
        try {
            // Read active profile ID from neostream_profiles (correct key)
            const profilesData = localStorage.getItem('neostream_profiles');
            let profileId: string | null = null;
            if (profilesData) {
                const parsed = JSON.parse(profilesData);
                profileId = parsed.activeProfileId || null;
            }
            const configKey = profileId ? `playbackConfig_${profileId}` : 'playbackConfig';
            const saved = localStorage.getItem(configKey);
            if (saved) {
                const config = JSON.parse(saved);
                const result = config.forcedSubtitlesEnabled !== false;
                return result;
            }
        } catch (e) { console.error('Error reading forced config:', e); }
        return true; // default enabled
    });

    // Auto-load Forced subtitles when content starts (movies and series)
    useEffect(() => {
        // Skip if no title
        if (!title) return;

        // Check if title contains [L] - already subtitled, skip Forced
        if (title.includes('[L]')) {
            return;
        }

        const loadForcedSubtitles = async () => {
            try {
                // Check if Forced subtitles are disabled for this session
                if (!forcedEnabledForSession) {
                    return;
                }

                // Check if Forced subtitles are enabled in settings
                const { playbackService } = await import('../../services/playbackService');
                playbackService.reloadConfig();
                const config = playbackService.getConfig();

                if (!config.forcedSubtitlesEnabled) {
                    return;
                }

                const result = await autoFetchForcedSubtitle({
                    title,
                    tmdbId,
                    imdbId,
                    season: seasonNumber,
                    episode: episodeNumber
                });

                if (result) {
                    setSubtitleUrl(result.url);
                    setSubtitleLanguage(result.language);
                    setVttContent(result.vttContent);
                    setSubtitlesEnabled(true);
                    setIsForcedSubtitle(true);
                }
            } catch (error) {
                console.error('Error auto-loading forced subtitles:', error);
            }
        };

        // Small delay to let video player initialize
        const timer = setTimeout(loadForcedSubtitles, 1000);
        return () => clearTimeout(timer);
    }, [title, tmdbId, imdbId, seasonNumber, episodeNumber, forcedEnabledForSession]);

    // Cleanup subtitle blob URL on unmount
    useEffect(() => {
        return () => {
            if (subtitleUrl) {
                cleanupSubtitleUrl(subtitleUrl);
            }
        };
    }, [subtitleUrl]);

    // CC button: toggles subtitles, fetching full subtitles on demand
    const handleSubtitleToggle = async () => {
        // If currently showing Forced subtitles, switch to full subtitles
        if (subtitlesEnabled && isForcedSubtitle) {
            // Cleanup Forced subtitle
            if (subtitleUrl) {
                cleanupSubtitleUrl(subtitleUrl);
            }
            setSubtitleLoading(true);
            setIsForcedSubtitle(false);

            try {
                const result = await autoFetchSubtitle({
                    title: title || '',
                    tmdbId,
                    imdbId,
                    season: seasonNumber,
                    episode: episodeNumber
                });
                if (result) {
                    setSubtitleUrl(result.url);
                    setSubtitleLanguage(result.language);
                    setVttContent(result.vttContent);
                    if (result.warning) {
                        setSubtitleWarning(result.warning);
                        setTimeout(() => setSubtitleWarning(null), 5000);
                    }
                } else {
                    setSubtitleWarning(t('player', 'noFullSubtitlesFound'));
                    setTimeout(() => setSubtitleWarning(null), 4000);
                }
            } catch (error) {
                console.error('Error fetching full subtitles:', error);
            } finally {
                setSubtitleLoading(false);
            }
            return;
        }

        if (subtitlesEnabled) {
            // Disable subtitles and cleanup
            setSubtitlesEnabled(false);
            setIsForcedSubtitle(false);

            // Cleanup subtitle blob URL from memory
            if (subtitleUrl) {
                cleanupSubtitleUrl(subtitleUrl);
                setSubtitleUrl(null);
                setSubtitleLanguage(null);
                setVttContent(null);
            }

            const video = videoRef.current;
            if (video && video.textTracks.length > 0) {
                for (let i = 0; i < video.textTracks.length; i++) {
                    video.textTracks[i].mode = 'hidden';
                }
            }
        } else {
            // Enable subtitles - fetch if not already loaded
            if (!subtitleUrl && title) {
                setSubtitleLoading(true);
                try {
                    const result = await autoFetchSubtitle({
                        title,
                        tmdbId,
                        imdbId,
                        season: seasonNumber,
                        episode: episodeNumber
                    });
                    if (result) {
                        setSubtitleUrl(result.url);
                        setSubtitleLanguage(result.language);
                        setVttContent(result.vttContent);
                        setSubtitlesEnabled(true);
                        // Show warning if using fallback language
                        if (result.warning) {
                            setSubtitleWarning(result.warning);
                            // Clear warning after 5 seconds
                            setTimeout(() => setSubtitleWarning(null), 5000);
                        }
                    } else {
                        setSubtitleWarning(t('player', 'noSubtitlesFound'));
                        setTimeout(() => setSubtitleWarning(null), 4000);
                    }
                } catch (error) {
                    console.error('Error fetching subtitles:', error);
                } finally {
                    setSubtitleLoading(false);
                }
            } else {
                setSubtitlesEnabled(true);
                const video = videoRef.current;
                if (video && video.textTracks.length > 0) {
                    for (let i = 0; i < video.textTracks.length; i++) {
                        video.textTracks[i].mode = 'showing';
                    }
                }
            }
        }
    };

    // Explicit language pick from the settings menu (strict — no fallback chain).
    const handleSubtitleLanguageSelect = async (lang: string) => {
        if (!title) return;
        if (subtitleUrl) cleanupSubtitleUrl(subtitleUrl);
        setSubtitleLoading(true);
        setIsForcedSubtitle(false);
        try {
            const result = await autoFetchSubtitle({
                title,
                tmdbId,
                imdbId,
                season: seasonNumber,
                episode: episodeNumber,
                language: lang
            });
            if (result) {
                setSubtitleUrl(result.url);
                setSubtitleLanguage(result.language);
                setVttContent(result.vttContent);
                setSubtitlesEnabled(true);
            } else {
                setSubtitleWarning(`${t('player', 'noSubtitlesFound')} (${lang.toUpperCase()})`);
                setTimeout(() => setSubtitleWarning(null), 4000);
            }
        } catch (error) {
            console.error('Error fetching subtitles for language:', error);
        } finally {
            setSubtitleLoading(false);
        }
    };

    // Turn subtitles fully off (settings menu "Desligada").
    const handleSubtitlesOff = () => {
        setSubtitlesEnabled(false);
        setIsForcedSubtitle(false);
        if (subtitleUrl) {
            cleanupSubtitleUrl(subtitleUrl);
            setSubtitleUrl(null);
            setSubtitleLanguage(null);
            setVttContent(null);
        }
        const video = videoRef.current;
        if (video && video.textTracks.length > 0) {
            for (let i = 0; i < video.textTracks.length; i++) {
                video.textTracks[i].mode = 'hidden';
            }
        }
    };

    // Forced-subtitles session toggle (settings dropdown row)
    const handleForcedSessionToggle = async () => {
        const newValue = !forcedEnabledForSession;
        setForcedEnabledForSession(newValue);

        if (!newValue && isForcedSubtitle) {
            // Disabling: remove current forced subtitle
            setSubtitlesEnabled(false);
            setIsForcedSubtitle(false);
            if (subtitleUrl) {
                cleanupSubtitleUrl(subtitleUrl);
                setSubtitleUrl(null);
                setVttContent(null);
            }
        } else if (newValue && !subtitlesEnabled) {
            // Enabling: load forced subtitles now
            try {
                const { autoFetchForcedSubtitle } = await import('../../services/subtitleService');
                const result = await autoFetchForcedSubtitle({
                    title: title || '',
                    tmdbId,
                    imdbId,
                    season: seasonNumber,
                    episode: episodeNumber
                });
                if (result && result.warning) {
                    // Show warning toast for rejected special editions
                    setSubtitleWarning(result.warning);
                    setTimeout(() => setSubtitleWarning(null), 4000);
                } else if (result && result.vttContent) {
                    const blob = new Blob([result.vttContent], { type: 'text/vtt' });
                    const blobUrl = URL.createObjectURL(blob);
                    setSubtitleUrl(blobUrl);
                    setVttContent(result.vttContent);
                    setSubtitlesEnabled(true);
                    setIsForcedSubtitle(true);
                } else {
                    setSubtitleWarning(t('player', 'noForcedSubtitlesFound'));
                    setTimeout(() => setSubtitleWarning(null), 4000);
                }
            } catch (e) {
                console.error('Failed to load forced subtitles:', e);
                setSubtitleWarning(t('player', 'errorLoadingSubtitles'));
                setTimeout(() => setSubtitleWarning(null), 4000);
            }
        }
    };

    return {
        subtitlesEnabled,
        setSubtitlesEnabled,
        subtitleLoading,
        subtitleLanguage,
        vttContent,
        subtitleWarning,
        isForcedSubtitle,
        forcedEnabledForSession,
        handleSubtitleToggle,
        handleSubtitleLanguageSelect,
        handleSubtitlesOff,
        handleForcedSessionToggle
    };
}
