import { useState } from 'react';
import { playbackService } from '../../services/playbackService';
import type { PlaybackConfig } from '../../services/playbackService';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';

export function PlaybackSection() {
    const [playbackConfig, setPlaybackConfig] = useState<PlaybackConfig>(playbackService.getConfig());
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();

    const handlePlaybackConfigChange = <K extends keyof PlaybackConfig>(key: K, value: PlaybackConfig[K]) => {
        const newConfig = { ...playbackConfig, [key]: value };
        setPlaybackConfig(newConfig);
        playbackService.setConfig({ [key]: value });

        // Show save animation
        triggerSaveAnimation(key);
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
            </div>
        </div>
    );
}
