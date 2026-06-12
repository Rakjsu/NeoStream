import { useLanguage } from '../../services/languageService';
import {
    ACCENT_PRESETS,
    BACKGROUND_PRESETS,
    useTheme
} from '../../services/themeService';

export function AppearanceSection() {
    const { t } = useLanguage();
    const { theme, setTheme } = useTheme();

    return (
        <div className="section-card">
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to))' }}>🎨</div>
                <div>
                    <h2>{t('appearance', 'title')}</h2>
                    <p>{t('appearance', 'description')}</p>
                </div>
            </div>

            <div className="settings-group">
                {/* Background variant */}
                <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px' }}>
                    <div className="setting-info">
                        <label>{t('appearance', 'background')}</label>
                        <p>{t('appearance', 'backgroundDesc')}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        {BACKGROUND_PRESETS.map(bg => {
                            const selected = theme.background === bg.id;
                            return (
                                <button
                                    key={bg.id}
                                    onClick={() => setTheme({ background: bg.id })}
                                    aria-pressed={selected}
                                    style={{
                                        flex: 1,
                                        padding: '14px',
                                        borderRadius: '14px',
                                        border: selected
                                            ? '2px solid var(--ns-accent)'
                                            : '2px solid rgba(255, 255, 255, 0.12)',
                                        background: 'rgba(255, 255, 255, 0.04)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '10px',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <div style={{
                                        width: '100%',
                                        height: '54px',
                                        borderRadius: '10px',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        background: `linear-gradient(135deg, ${bg.deep} 0%, ${bg.panel} 60%, ${bg.tint} 100%)`
                                    }} />
                                    <span style={{ color: 'white', fontSize: '13px', fontWeight: 600 }}>
                                        {t('appearance', bg.nameKey)}
                                        {selected && <span style={{ marginLeft: 6, color: 'var(--ns-accent-light)' }}>✓</span>}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Accent color */}
                <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px' }}>
                    <div className="setting-info">
                        <label>{t('appearance', 'accent')}</label>
                        <p>{t('appearance', 'accentDesc')}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                        {ACCENT_PRESETS.map(preset => {
                            const selected = theme.accent === preset.id;
                            return (
                                <button
                                    key={preset.id}
                                    onClick={() => setTheme({ accent: preset.id })}
                                    title={t('appearance', preset.nameKey)}
                                    aria-pressed={selected}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '8px',
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '4px'
                                    }}
                                >
                                    <span style={{
                                        width: '44px',
                                        height: '44px',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: `linear-gradient(135deg, ${preset.accent}, ${preset.gradTo})`,
                                        border: selected ? '3px solid white' : '3px solid transparent',
                                        boxShadow: selected ? `0 0 14px ${preset.accent}` : 'none',
                                        color: 'white',
                                        fontSize: '16px',
                                        fontWeight: 700,
                                        transition: 'all 0.2s ease'
                                    }}>
                                        {selected ? '✓' : ''}
                                    </span>
                                    <span style={{
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        color: selected ? 'white' : 'rgba(255, 255, 255, 0.6)'
                                    }}>
                                        {t('appearance', preset.nameKey)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Partial theming note */}
                <div className="last-check">
                    <span className="check-icon">ℹ️</span>
                    <span>{t('appearance', 'note')}</span>
                </div>
            </div>
        </div>
    );
}
