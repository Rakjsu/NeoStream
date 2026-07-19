import { Settings } from 'lucide-react';
import type { SubtitleStyle } from '../../utils/subtitleStyle';
import { useLanguage } from '../../services/languageService';
import { SUBTITLE_LANGUAGE_OPTIONS } from '../../services/subtitleService';
import { SLEEP_TIMER_OPTIONS } from './useSleepTimer';
import { BOOST_OPTIONS } from './playerExtras';

import type { MovieVersion } from '../../services/movieVersionService';

export interface SwitchableContent {
    stream_id?: string | number;
}

export interface PlayerAudioTrack {
    id: number;
    label: string;
    active: boolean;
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
    /** Subtitle language picker (movies/series). */
    subtitlesEnabled?: boolean;
    subtitleLanguage?: string | null;
    onSelectSubtitleLanguage?: (code: string) => void;
    onDisableSubtitles?: () => void;
    /** HLS audio tracks (live streams with more than one). */
    audioTracks?: PlayerAudioTrack[];
    onSelectAudioTrack?: (id: number) => void;
    /** Sleep timer (null = off, otherwise the armed duration in minutes). */
    sleepTimerMinutes?: number | null;
    onSetSleepTimer?: (minutes: number | null) => void;
    /** Subtitle sync (seconds; undefined hides the section). */
    subtitleOffset?: number;
    onAdjustSubtitleOffset?: (delta: number) => void;
    /** Aspect ratio mode. */
    aspectMode?: 'original' | 'stretch' | 'fill' | 'zoom';
    onSetAspectMode?: (mode: 'original' | 'stretch' | 'fill' | 'zoom') => void;
    /** Volume boost via WebAudio gain (1 = 100%, up to 3 = 300%). */
    volumeBoost?: number;
    onSetVolumeBoost?: (mult: number) => void;
    /** Estilo da legenda externa (tamanho/fundo/cor). */
    subtitleStyle?: SubtitleStyle;
    onSetSubtitleStyle?: (style: SubtitleStyle) => void;
    /** 📻 Modo rádio: tela preta com o áudio seguindo. */
    onEnterRadioMode?: () => void;
    /** 🎬 Modo cinema: vinheta + luz ambiente da cor do filme. */
    cinemaMode?: boolean;
    onToggleCinemaMode?: () => void;
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
    setShowSettings,
    subtitlesEnabled,
    subtitleLanguage,
    onSelectSubtitleLanguage,
    onDisableSubtitles,
    audioTracks,
    onSelectAudioTrack,
    sleepTimerMinutes,
    onSetSleepTimer,
    subtitleOffset,
    onAdjustSubtitleOffset,
    aspectMode,
    onSetAspectMode,
    volumeBoost,
    onSetVolumeBoost,
    subtitleStyle,
    onSetSubtitleStyle,
    onEnterRadioMode,
    cinemaMode,
    onToggleCinemaMode
}: PlayerSettingsMenuProps<TSwitchContent>) {
    const { t } = useLanguage();

    // Settings/Quality button - show for movies/series, live TV with quality
    // variants, or whenever the sleep timer is available.
    if (!(contentType !== 'live' || (movieVersions && movieVersions.length > 1) || onSetSleepTimer)) {
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
                                                : 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-dark))',
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
                                    : 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-dark))',
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
                    ) : contentType !== 'live' && (
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

                    {/* Subtitle language picker (movies/series) */}
                    {contentType !== 'live' && onSelectSubtitleLanguage && (
                        <div className="settings-section">
                            <span className="settings-label">{t('player', 'subtitleLanguage')}</span>
                            <div className="settings-options">
                                <button
                                    className={`settings-option ${!subtitlesEnabled ? 'active' : ''}`}
                                    onClick={() => {
                                        onDisableSubtitles?.();
                                        setShowSettings(false);
                                    }}
                                >
                                    {t('player', 'subtitlesOff')}
                                </button>
                                {SUBTITLE_LANGUAGE_OPTIONS.map(opt => {
                                    const norm = (subtitleLanguage || '').toLowerCase();
                                    const isActive = !!subtitlesEnabled &&
                                        (norm === opt.code || norm === opt.code.split('-')[0]);
                                    return (
                                        <button
                                            key={opt.code}
                                            className={`settings-option ${isActive ? 'active' : ''}`}
                                            onClick={() => {
                                                onSelectSubtitleLanguage(opt.code);
                                                setShowSettings(false);
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Audio tracks (HLS streams exposing more than one) */}
                    {audioTracks && audioTracks.length > 1 && onSelectAudioTrack && (
                        <div className="settings-section">
                            <span className="settings-label">{t('player', 'audioTrack')}</span>
                            <div className="settings-options">
                                {audioTracks.map(track => (
                                    <button
                                        key={track.id}
                                        className={`settings-option ${track.active ? 'active' : ''}`}
                                        onClick={() => {
                                            onSelectAudioTrack(track.id);
                                            setShowSettings(false);
                                        }}
                                    >
                                        {track.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Subtitle sync: shift subtitles in 0.5s steps */}
                    {subtitleOffset !== undefined && onAdjustSubtitleOffset && (
                        <div className="settings-section">
                            <span className="settings-label">{t('player', 'subtitleSync')}</span>
                            <div className="settings-options" style={{ alignItems: 'center' }}>
                                <button
                                    className="settings-option"
                                    onClick={() => onAdjustSubtitleOffset(-0.5)}
                                >
                                    −0,5s
                                </button>
                                <span style={{ minWidth: 64, textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: subtitleOffset === 0 ? 'rgba(255,255,255,0.5)' : 'white', fontSize: 13, fontWeight: 600 }}>
                                    {subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(1)}s
                                </span>
                                <button
                                    className="settings-option"
                                    onClick={() => onAdjustSubtitleOffset(0.5)}
                                >
                                    +0,5s
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Aspect ratio: how the video fills the stage */}
                    {aspectMode !== undefined && onSetAspectMode && (
                        <div className="settings-section">
                            <span className="settings-label">{t('player', 'aspectRatio')}</span>
                            <div className="settings-options">
                                {([
                                    ['original', t('player', 'aspectOriginal')],
                                    ['stretch', t('player', 'aspectStretch')],
                                    ['fill', t('player', 'aspectFill')],
                                    ['zoom', t('player', 'aspectZoom')]
                                ] as const).map(([mode, label]) => (
                                    <button
                                        key={mode}
                                        className={`settings-option ${aspectMode === mode ? 'active' : ''}`}
                                        onClick={() => onSetAspectMode(mode)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Volume boost: WebAudio gain above the HTML5 100% ceiling */}
                    {volumeBoost !== undefined && onSetVolumeBoost && (
                        <div className="settings-section">
                            <span className="settings-label">{t('player', 'volumeBoost')}</span>
                            <div className="settings-options">
                                {BOOST_OPTIONS.map(mult => (
                                    <button
                                        key={mult}
                                        className={`settings-option ${volumeBoost === mult ? 'active' : ''}`}
                                        onClick={() => onSetVolumeBoost(mult)}
                                    >
                                        {Math.round(mult * 100)}%
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Sleep timer: pause playback after 30/60/90 minutes */}
                    {onSetSleepTimer && (
                        <div className="settings-section">
                            <span className="settings-label">{t('player', 'sleepTimer')}</span>
                            <div className="settings-options">
                                <button
                                    className={`settings-option ${sleepTimerMinutes == null ? 'active' : ''}`}
                                    onClick={() => {
                                        onSetSleepTimer(null);
                                        setShowSettings(false);
                                    }}
                                >
                                    {t('player', 'sleepTimerOff')}
                                </button>
                                {SLEEP_TIMER_OPTIONS.map(minutes => (
                                    <button
                                        key={minutes}
                                        className={`settings-option ${sleepTimerMinutes === minutes ? 'active' : ''}`}
                                        onClick={() => {
                                            onSetSleepTimer(minutes);
                                            setShowSettings(false);
                                        }}
                                    >
                                        {minutes} min
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 💬 Estilo da legenda: tamanho, fundo e cor */}
                    {subtitleStyle && onSetSubtitleStyle && (
                        <div className="settings-section">
                            <span className="settings-label">{t('player', 'subStyle')}</span>
                            <div className="settings-options">
                                {(['small', 'medium', 'large'] as const).map(size => (
                                    <button
                                        key={size}
                                        className={`settings-option ${subtitleStyle.size === size ? 'active' : ''}`}
                                        onClick={() => onSetSubtitleStyle({ ...subtitleStyle, size })}
                                    >
                                        {size === 'small' ? 'Aa⁻' : size === 'large' ? 'Aa⁺' : 'Aa'}
                                    </button>
                                ))}
                            </div>
                            <div className="settings-options">
                                {(['dark', 'none', 'solid'] as const).map(background => (
                                    <button
                                        key={background}
                                        className={`settings-option ${subtitleStyle.background === background ? 'active' : ''}`}
                                        onClick={() => onSetSubtitleStyle({ ...subtitleStyle, background })}
                                    >
                                        {t('player', background === 'dark' ? 'subBgDark' : background === 'none' ? 'subBgNone' : 'subBgSolid')}
                                    </button>
                                ))}
                            </div>
                            <div className="settings-options">
                                {(['white', 'yellow'] as const).map(color => (
                                    <button
                                        key={color}
                                        className={`settings-option ${subtitleStyle.color === color ? 'active' : ''}`}
                                        onClick={() => onSetSubtitleStyle({ ...subtitleStyle, color })}
                                    >
                                        {color === 'white' ? '⚪' : '🟡'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 🎬 Modo cinema: vinheta + luz ambiente (toggle) */}
                    {onToggleCinemaMode && (
                        <div className="settings-section">
                            <div className="settings-options">
                                <button
                                    className={`settings-option ${cinemaMode ? 'active' : ''}`}
                                    onClick={onToggleCinemaMode}
                                >
                                    🎬 {t('player', 'cinemaMode')}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 📻 Modo rádio: tela preta, áudio segue (clique volta) */}
                    {onEnterRadioMode && (
                        <div className="settings-section">
                            <div className="settings-options">
                                <button
                                    className="settings-option"
                                    onClick={() => { onEnterRadioMode(); setShowSettings(false); }}
                                >
                                    📻 {t('player', 'radioMode')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
