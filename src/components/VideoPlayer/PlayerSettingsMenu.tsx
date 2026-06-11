import { Settings } from 'lucide-react';
import { useLanguage } from '../../services/languageService';

import type { MovieVersion } from '../../services/movieVersionService';

export interface SwitchableContent {
    stream_id?: string | number;
}

const playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export interface PlayerSettingsMenuProps<TSwitchContent extends SwitchableContent = SwitchableContent> {
    contentType: 'movie' | 'series' | 'live';
    movieVersions?: MovieVersion<TSwitchContent>[];
    currentMovieId?: number;
    onSwitchVersion?: (movie: TSwitchContent, currentTime: number) => void;
    currentTime: number;
    playbackRate: number;
    onSetPlaybackRate: (rate: number) => void;
    showSettings: boolean;
    setShowSettings: (show: boolean) => void;
}

// Gear settings menu: movie version / live quality switcher, or playback speed.
export function PlayerSettingsMenu<TSwitchContent extends SwitchableContent = SwitchableContent>({
    contentType,
    movieVersions,
    currentMovieId,
    onSwitchVersion,
    currentTime,
    playbackRate,
    onSetPlaybackRate,
    showSettings,
    setShowSettings
}: PlayerSettingsMenuProps<TSwitchContent>) {
    const { t } = useLanguage();

    // Settings/Quality button - show for movies/series OR for live TV with quality variants
    if (!(contentType !== 'live' || (movieVersions && movieVersions.length > 1))) {
        return null;
    }

    return (
        <div className="settings-menu-container">
            <button
                className="control-btn settings-btn"
                onClick={() => setShowSettings(!showSettings)}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
                <Settings size="1em" />
                {/* Quality Badge - show current quality when movie versions available */}
                {movieVersions && movieVersions.length > 0 && (() => {
                    const currentVersion = movieVersions.find(v => v.movie.stream_id === currentMovieId);
                    if (currentVersion) {
                        // For live TV, just show the quality label directly
                        if (contentType === 'live') {
                            return (
                                <span style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    background: currentVersion.label === '4K' || currentVersion.label === 'UHD'
                                        ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                        : currentVersion.label === 'FHD' || currentVersion.label === 'H.265'
                                            ? 'linear-gradient(135deg, #10b981, #059669)'
                                            : currentVersion.label === 'SD'
                                                ? 'linear-gradient(135deg, #6b7280, #4b5563)'
                                                : 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                                    color: 'white',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                                }}>
                                    {currentVersion.label}
                                </span>
                            );
                        }
                        // For movies/series
                        const qualityText = currentVersion.quality === '4k' ? '4K' : '1080p';
                        const audioText = currentVersion.audio === 'subtitled' ? 'LEG' : 'DUB';
                        return (
                            <span style={{
                                fontSize: '9px',
                                fontWeight: 700,
                                padding: '2px 5px',
                                borderRadius: '4px',
                                background: currentVersion.quality === '4k'
                                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                    : 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                                color: 'white',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                            }}>
                                {qualityText}
                                <span style={{ opacity: 0.7, fontSize: '7px' }}>•</span>
                                <span style={{ fontSize: '7px', opacity: 0.9 }}>{audioText}</span>
                            </span>
                        );
                    }
                    return null;
                })()}
            </button>

            {showSettings && (
                <div className="settings-menu">
                    {/* Movie Version Switcher / Live TV Quality Switcher */}
                    {movieVersions && movieVersions.length > 1 && onSwitchVersion ? (
                        <div className="settings-section">
                            <span className="settings-label">
                                {contentType === 'live' ? t('player', 'quality') : t('player', 'version')}
                            </span>
                            <div className="settings-options">
                                {movieVersions.map(version => {
                                    const isActive = version.movie.stream_id === currentMovieId;
                                    // Get icon based on quality
                                    const getQualityIcon = (label: string) => {
                                        const l = label.toLowerCase();
                                        if (l.includes('4k') || l.includes('uhd')) return '🔵';
                                        if (l.includes('fhd') || l.includes('h.265') || l.includes('1080')) return '🟢';
                                        if (l.includes('hd') || l.includes('720')) return '🟡';
                                        return '⚪'; // SD or unknown
                                    };
                                    return (
                                        <button
                                            key={version.movie.stream_id}
                                            className={`settings-option ${isActive ? 'active' : ''}`}
                                            onClick={() => {
                                                if (!isActive) {
                                                    onSwitchVersion(version.movie, currentTime);
                                                }
                                                setShowSettings(false);
                                            }}
                                            style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
                                        >
                                            <span style={{ fontSize: '10px' }}>{getQualityIcon(version.label)}</span>
                                            {version.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        /* Playback Speed - show for series or single-version movies */
                        <div className="settings-section">
                            <span className="settings-label">{t('player', 'speed')}</span>
                            <div className="settings-options">
                                {playbackRates.map(rate => (
                                    <button
                                        key={rate}
                                        className={`settings-option ${playbackRate === rate ? 'active' : ''}`}
                                        onClick={() => {
                                            onSetPlaybackRate(rate);
                                            setShowSettings(false);
                                        }}
                                    >
                                        {rate}x
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
