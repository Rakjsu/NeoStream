import { useEffect, useState } from 'react';
import { SCREENSAVER_MINUTES_KEY } from '../../components/ShowcaseScreensaver';
import { catalogRefreshService, REFRESH_INTERVAL_OPTIONS, type RefreshIntervalHours } from '../../services/catalogRefreshService';
import { newEpisodeNotifier } from '../../services/newEpisodeNotifier';
import { playbackService } from '../../services/playbackService';
import type { PlaybackConfig } from '../../services/playbackService';
import { mpvService } from '../../services/mpvService';
import type { MpvDownloadProgress } from '../../services/mpvService';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';

// EXPERIMENTAL — one-click MPV download state machine
type MpvDownloadState =
    | { phase: 'idle' }
    | { phase: 'downloading'; progress: MpvDownloadProgress | null }
    | { phase: 'success'; path: string }
    | { phase: 'error' };

export function PlaybackSection() {
    const [refreshInterval, setRefreshInterval] = useState<RefreshIntervalHours>(() => catalogRefreshService.getIntervalHours());
    const [notifyNewEpisodes, setNotifyNewEpisodes] = useState<boolean>(() => newEpisodeNotifier.isEnabled());
    const [screensaverMin, setScreensaverMin] = useState<number>(() => parseInt(localStorage.getItem(SCREENSAVER_MINUTES_KEY) || '0', 10) || 0);
    const [playbackConfig, setPlaybackConfig] = useState<PlaybackConfig>(playbackService.getConfig());
    // Multi-monitor: where the PiP window opens (list comes from the main process).
    const [pipDisplays, setPipDisplays] = useState<{ id: number; label: string; width: number; height: number; primary: boolean }[]>([]);
    const [pipDisplayId, setPipDisplayId] = useState<number | null>(null);
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();

    useEffect(() => {
        let cancelled = false;
        window.ipcRenderer.invoke('pip:get-display-config')
            .then((result: { success: boolean; displays?: { id: number; label: string; width: number; height: number; primary: boolean }[]; selectedId?: number | null }) => {
                if (cancelled || !result?.success) return;
                setPipDisplays(result.displays || []);
                setPipDisplayId(result.selectedId ?? null);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    // EXPERIMENTAL — MPV PoC state
    const [mpvPathInput, setMpvPathInput] = useState('');
    const [mpvDetecting, setMpvDetecting] = useState(false);
    const [mpvResolvedPath, setMpvResolvedPath] = useState<string | null | undefined>(undefined);
    const [mpvDownload, setMpvDownload] = useState<MpvDownloadState>({ phase: 'idle' });

    const handlePlaybackConfigChange = <K extends keyof PlaybackConfig>(key: K, value: PlaybackConfig[K]) => {
        const newConfig = { ...playbackConfig, [key]: value };
        setPlaybackConfig(newConfig);
        playbackService.setConfig({ [key]: value });

        // Show save animation
        triggerSaveAnimation(key);
    };

    // EXPERIMENTAL — show the current configured/resolved mpv path on mount
    useEffect(() => {
        let cancelled = false;
        mpvService.getAvailability().then(({ path, configuredPath }) => {
            if (cancelled) return;
            setMpvResolvedPath(path);
            if (configuredPath) setMpvPathInput(configuredPath);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // EXPERIMENTAL — persist the path (empty = auto-detect) and re-resolve
    const handleMpvDetect = async () => {
        setMpvDetecting(true);
        try {
            const resolved = await mpvService.setPath(mpvPathInput.trim());
            setMpvResolvedPath(resolved);
        } finally {
            setMpvDetecting(false);
        }
    };

    // EXPERIMENTAL — one-click MPV download (progress streams via mpv:download-progress)
    const handleMpvDownload = async () => {
        setMpvDownload({ phase: 'downloading', progress: null });
        const unsubscribe = mpvService.onDownloadProgress((progress) => {
            setMpvDownload((prev) => (prev.phase === 'downloading' ? { phase: 'downloading', progress } : prev));
        });
        try {
            const result = await mpvService.startDownload();
            if (result.success && result.path) {
                setMpvResolvedPath(result.path);
                setMpvPathInput(result.path);
                setMpvDownload({ phase: 'success', path: result.path });
            } else if (result.reason === 'cancelled') {
                setMpvDownload({ phase: 'idle' });
            } else {
                setMpvDownload({ phase: 'error' });
            }
        } finally {
            unsubscribe();
        }
    };

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>⏯️</div>
                <div>
                    <h2>{t('playback', 'title')}</h2>
                    <p>{t('playback', 'description')}</p>
                </div>
            </div>

            <div className="settings-group">
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'catalogRefresh')}</label>
                        <p>{t('playback', 'catalogRefreshDesc')}</p>
                    </div>
                    <select
                        className="setting-select"
                        value={refreshInterval}
                        onChange={(e) => {
                            const hours = Number(e.target.value) as RefreshIntervalHours;
                            catalogRefreshService.setIntervalHours(hours);
                            setRefreshInterval(hours);
                        }}
                    >
                        {REFRESH_INTERVAL_OPTIONS.map(hours => (
                            <option key={hours} value={hours}>
                                {hours === 0 ? t('playback', 'catalogRefreshOff') : `${hours}h`}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'screensaver')}</label>
                        <p>{t('playback', 'screensaverDesc')}</p>
                    </div>
                    <select
                        value={screensaverMin}
                        onChange={(e) => {
                            const minutes = parseInt(e.target.value, 10) || 0;
                            localStorage.setItem(SCREENSAVER_MINUTES_KEY, String(minutes));
                            setScreensaverMin(minutes);
                        }}
                    >
                        <option value="0">{t('playback', 'screensaverOff')}</option>
                        {[3, 5, 10, 20].map(minutes => (
                            <option key={minutes} value={minutes}>{minutes} min</option>
                        ))}
                    </select>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'notifyNewEpisodes')}</label>
                        <p>{t('playback', 'notifyNewEpisodesDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={notifyNewEpisodes}
                            onChange={(e) => {
                                newEpisodeNotifier.setEnabled(e.target.checked);
                                setNotifyNewEpisodes(e.target.checked);
                            }}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'bufferSize')}</label>
                        <p>{t('playback', 'bufferSizeDesc')}</p>
                    </div>
                    <select
                        className="setting-select"
                        value={playbackConfig.bufferSize}
                        onChange={(e) => handlePlaybackConfigChange('bufferSize', e.target.value as PlaybackConfig['bufferSize'])}
                    >
                        <option value="intelligent">{t('playback', 'intelligent')}</option>
                        <option value="5">5 {t('playback', 'seconds')}</option>
                        <option value="10">10 {t('playback', 'seconds')}</option>
                        <option value="15">15 {t('playback', 'seconds')}</option>
                        <option value="30">30 {t('playback', 'seconds')}</option>
                    </select>
                    {saveAnimation === 'bufferSize' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                </div>

                {pipDisplays.length > 1 && (
                    <div className="setting-item">
                        <div className="setting-info">
                            <label>🖥️ {t('playback', 'pipDisplay')}</label>
                            <p>{t('playback', 'pipDisplayDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={pipDisplayId === null ? 'auto' : String(pipDisplayId)}
                            onChange={(e) => {
                                const displayId = e.target.value === 'auto' ? null : Number(e.target.value);
                                setPipDisplayId(displayId);
                                window.ipcRenderer.invoke('pip:set-display', { displayId }).catch(() => undefined);
                                triggerSaveAnimation('pipDisplay');
                            }}
                        >
                            <option value="auto">{t('playback', 'pipDisplayAuto')}</option>
                            {pipDisplays.map(display => (
                                <option key={display.id} value={String(display.id)}>
                                    {display.label} ({display.width}×{display.height}){display.primary ? ' ★' : ''}
                                </option>
                            ))}
                        </select>
                        {saveAnimation === 'pipDisplay' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>
                )}

                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'videoCodec')}</label>
                        <p>{t('playback', 'videoCodecDesc')}</p>
                    </div>
                    <select
                        className="setting-select"
                        value={playbackConfig.videoCodec}
                        onChange={(e) => handlePlaybackConfigChange('videoCodec', e.target.value as PlaybackConfig['videoCodec'])}
                    >
                        <option value="auto">Auto</option>
                        <option value="h264">H.264 (AVC)</option>
                        <option value="h265">H.265 (HEVC)</option>
                        <option value="vp9">VP9</option>
                    </select>
                    {saveAnimation === 'videoCodec' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                </div>

                {/* Subtitle Language Setting */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'subtitleLanguage') || 'Idioma das Legendas'}</label>
                        <p>{t('playback', 'subtitleLanguageDesc') || 'Idioma preferido para download automático de legendas'}</p>
                    </div>
                    <select
                        className="setting-select"
                        value={playbackConfig.subtitleLanguage}
                        onChange={(e) => handlePlaybackConfigChange('subtitleLanguage', e.target.value as PlaybackConfig['subtitleLanguage'])}
                    >
                        <option value="pt-br">🇧🇷 Português (Brasil)</option>
                        <option value="pt">🇵🇹 Português</option>
                        <option value="en">🇺🇸 English</option>
                        <option value="es">🇪🇸 Español</option>
                    </select>
                    {saveAnimation === 'subtitleLanguage' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                </div>

                {/* Forced Subtitles Setting */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'forcedSubtitles') || 'Legendas Forçadas'}</label>
                        <p>{t('playback', 'forcedSubtitlesDesc') || 'Carregar automaticamente legendas de placas e diálogos estrangeiros (não funciona em conteúdo [L] já legendado)'}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={playbackConfig.forcedSubtitlesEnabled}
                            onChange={(e) => handlePlaybackConfigChange('forcedSubtitlesEnabled', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'forcedSubtitlesEnabled' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                </div>

                {/* Auto Play Next Episode Setting */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'autoPlayNext')}</label>
                        <p>{t('playback', 'autoPlayNextDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={playbackConfig.autoPlayNextEpisode}
                            onChange={(e) => handlePlaybackConfigChange('autoPlayNextEpisode', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'autoPlayNextEpisode' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                </div>

                {/* Skip Intro Setting */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'skipIntro')}</label>
                        <p>{t('playback', 'skipIntroDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input type="checkbox" defaultChecked />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {/* Click-Through Mode Setting */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>{t('playback', 'clickThrough')}</label>
                        <p>{t('playback', 'clickThroughDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={playbackConfig.clickThroughEnabled}
                            onChange={(e) => handlePlaybackConfigChange('clickThroughEnabled', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'clickThroughEnabled' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                </div>

                {/* EXPERIMENTAL — MPV PoC: external MPV player toggle */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>🎞️ {t('playback', 'mpvEnabled') || 'Player MPV'}</label>
                        <p>{t('playback', 'mpvEnabledDesc') || 'Reproduz canais ao vivo e filmes em uma janela MPV externa.'}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={playbackConfig.mpvEnabled}
                            onChange={(e) => handlePlaybackConfigChange('mpvEnabled', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    {saveAnimation === 'mpvEnabled' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                </div>

                {/* EXPERIMENTAL — MPV path + detection */}
                {playbackConfig.mpvEnabled && (
                    <div className="setting-item" style={{ flexWrap: 'wrap', gap: '12px' }}>
                        <div className="setting-info">
                            <label>{t('playback', 'mpvPath') || 'Caminho do MPV'}</label>
                            <p>{t('playback', 'mpvPathDesc') || 'Caminho do mpv.exe (deixe vazio para detectar automaticamente)'}</p>
                            <p style={{ marginTop: '6px', fontSize: '12px' }}>
                                {mpvResolvedPath === undefined ? (
                                    <span style={{ opacity: 0.6 }}>...</span>
                                ) : mpvResolvedPath ? (
                                    <span style={{ color: '#10b981' }}>
                                        ✓ {t('playback', 'mpvFoundAt') || 'MPV encontrado em'}: {mpvResolvedPath}
                                    </span>
                                ) : (
                                    <span style={{ color: '#ef4444' }}>
                                        ✕ {t('playback', 'mpvNotFound') || 'mpv não encontrado'} — {t('playback', 'mpvInstallHint') || 'Instale com scoop install mpv, choco install mpv ou baixe em mpv.io'}
                                    </span>
                                )}
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="text"
                                className="setting-select"
                                style={{ minWidth: '260px' }}
                                placeholder="C:\\Program Files\\mpv\\mpv.exe"
                                value={mpvPathInput}
                                onChange={(e) => setMpvPathInput(e.target.value)}
                            />
                            <button
                                className="setting-select"
                                style={{ cursor: 'pointer' }}
                                disabled={mpvDetecting}
                                onClick={handleMpvDetect}
                            >
                                {mpvDetecting
                                    ? (t('playback', 'mpvDetecting') || 'Detectando...')
                                    : (t('playback', 'mpvDetect') || 'Detectar')}
                            </button>
                        </div>

                        {/* EXPERIMENTAL — one-click MPV download (mpv not found, or download in progress) */}
                        {(mpvResolvedPath === null || mpvDownload.phase !== 'idle') && (
                            <div style={{ width: '100%' }}>
                                {(mpvDownload.phase === 'idle' || mpvDownload.phase === 'error') && (
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <button
                                            onClick={handleMpvDownload}
                                            style={{
                                                cursor: 'pointer',
                                                border: 'none',
                                                borderRadius: '8px',
                                                padding: '10px 18px',
                                                fontWeight: 600,
                                                color: '#fff',
                                                background: 'linear-gradient(135deg, var(--ns-accent) 0%, var(--ns-accent-dark) 100%)',
                                            }}
                                        >
                                            {mpvDownload.phase === 'error'
                                                ? (t('playback', 'mpvDownloadRetry') || 'Tentar novamente')
                                                : (t('playback', 'mpvDownloadButton') || 'Baixar MPV automaticamente (~30MB)')}
                                        </button>
                                        {mpvDownload.phase === 'error' && (
                                            <span style={{ color: '#ef4444', fontSize: '13px' }}>
                                                ✕ {t('playback', 'mpvDownloadError') || 'Falha ao baixar o MPV. Verifique sua conexão.'}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {mpvDownload.phase === 'downloading' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                            <span>{t('playback', 'mpvDownloading') || 'Baixando MPV...'}</span>
                                            <span style={{ opacity: 0.8 }}>
                                                {mpvDownload.progress
                                                    ? `${mpvDownload.progress.percent}% — ${mpvDownload.progress.transferredMB} / ${mpvDownload.progress.totalMB} MB`
                                                    : '...'}
                                            </span>
                                        </div>
                                        <div
                                            style={{
                                                height: '8px',
                                                borderRadius: '4px',
                                                overflow: 'hidden',
                                                background: 'rgba(var(--ns-accent-rgb), 0.15)',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    height: '100%',
                                                    width: `${mpvDownload.progress?.percent ?? 0}%`,
                                                    transition: 'width 0.3s ease',
                                                    background: 'linear-gradient(90deg, var(--ns-accent) 0%, var(--ns-accent-dark) 100%)',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <button
                                                className="setting-select"
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => mpvService.cancelDownload()}
                                            >
                                                {t('playback', 'mpvDownloadCancel') || 'Cancelar'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {mpvDownload.phase === 'success' && (
                                    <span style={{ color: '#10b981', fontSize: '13px' }}>
                                        ✓ {t('playback', 'mpvDownloadSuccess') || 'MPV instalado'}: {mpvDownload.path}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
