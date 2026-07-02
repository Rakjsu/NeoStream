import { useState } from 'react';
import { useLanguage } from '../../services/languageService';
import { searchConfigService, type SearchConfig } from '../../services/searchConfigService';
import { useSaveAnimation } from './useSaveAnimation';

/**
 * Settings > Busca: which content kinds the global search (Ctrl+K) covers.
 * Kids/parental gating still applies on top of these toggles.
 */
export function SearchSection() {
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();
    const [config, setConfig] = useState<SearchConfig>(() => searchConfigService.getConfig());

    const handleToggle = (key: keyof SearchConfig, value: boolean) => {
        setConfig(searchConfigService.setConfig({ [key]: value }));
        triggerSaveAnimation(key);
    };

    const options: Array<{ key: keyof SearchConfig; icon: string; label: string; desc: string }> = [
        { key: 'live', icon: '📺', label: t('searchConfig', 'liveLabel'), desc: t('searchConfig', 'liveDesc') },
        { key: 'vod', icon: '🎬', label: t('searchConfig', 'vodLabel'), desc: t('searchConfig', 'vodDesc') },
        { key: 'series', icon: '🎞️', label: t('searchConfig', 'seriesLabel'), desc: t('searchConfig', 'seriesDesc') },
        { key: 'epg', icon: '📅', label: t('searchConfig', 'epgLabel'), desc: t('searchConfig', 'epgDesc') }
    ];

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, #0ea5e9, #0369a1)' }}>🔍</div>
                <div>
                    <h2>{t('searchConfig', 'title')}</h2>
                    <p>{t('searchConfig', 'description')}</p>
                </div>
            </div>

            <div className="settings-group">
                {options.map(option => (
                    <div className="setting-item" key={option.key}>
                        <div className="setting-info">
                            <label>{option.icon} {option.label}</label>
                            <p>{option.desc}</p>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={config[option.key]}
                                onChange={(e) => handleToggle(option.key, e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                        {saveAnimation === option.key && (
                            <span className="save-indicator">✓</span>
                        )}
                    </div>
                ))}

                <div className="certificate-warning">
                    {t('searchConfig', 'note')}
                </div>
            </div>
        </div>
    );
}
