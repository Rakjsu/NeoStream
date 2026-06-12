import { useEffect, useState } from 'react';
import { playbackService } from '../../services/playbackService';
import type { PlaybackConfig } from '../../services/playbackService';
import { mpvService } from '../../services/mpvService';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';

export function PlaybackSection() {
    const [playbackConfig, setPlaybackConfig] = useState<PlaybackConfig>(playbackService.getConfig());
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();

    // EXPERIMENTAL — MPV PoC state
    const [mpvPathInput, setMpvPathInput] = useState('');
    const [mpvDetecting, setMpvDetecting] = useState(false);
    const [mpvResolvedPath, setMpvResolvedPath] = useState<string | null | undefined>(undefined);

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
                        <label>🧪 {t('playback', 'mpvEnabled') || 'Player MPV (experimental)'}</label>
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
                    </div>
                )}
            </div>
        </div>
    );
}
