import { useState } from 'react';
import { useLanguage } from '../../services/languageService';
import { tvModeService } from '../../services/tvModeService';
import {
    loadHomeRailPrefs, moveHomeRail, saveHomeRailPrefs, toggleHomeRail, type HomeRailPrefs,
} from '../../services/homeRailsService';
import {
    ACCENT_PRESETS,
    BACKGROUND_PRESETS,
    UI_SCALES,
    useTheme,
    type UiScale
} from '../../services/themeService';

export function AppearanceSection() {
    const { t } = useLanguage();
    const { theme, setTheme } = useTheme();
    const [tvMode, setTvMode] = useState<boolean>(() => tvModeService.isEnabled());
    // Fileiras do Início: ordem + ligar/desligar (vale ao voltar pro Início).
    const [railPrefs, setRailPrefs] = useState(() => loadHomeRailPrefs());
    const updateRails = (next: HomeRailPrefs) => {
        setRailPrefs(next);
        saveHomeRailPrefs(next);
    };
    const railButtonStyle: React.CSSProperties = {
        width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
        border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.06)', color: '#fff',
    };

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
                {/* Fileiras do Início: ordem + visibilidade */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>🧱 {t('appearance', 'homeRailsTitle')}</label>
                        <p>{t('appearance', 'homeRailsDesc')}</p>
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 4px 16px' }}>
                    {railPrefs.order.map((railKey, index) => (
                        <div key={railKey} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button
                                style={{ ...railButtonStyle, opacity: index === 0 ? 0.4 : 1 }}
                                disabled={index === 0}
                                onClick={() => updateRails(moveHomeRail(railPrefs, railKey, -1))}
                            >↑</button>
                            <button
                                style={{ ...railButtonStyle, opacity: index === railPrefs.order.length - 1 ? 0.4 : 1 }}
                                disabled={index === railPrefs.order.length - 1}
                                onClick={() => updateRails(moveHomeRail(railPrefs, railKey, 1))}
                            >↓</button>
                            <span style={{
                                flex: 1, fontSize: 14,
                                color: railPrefs.hidden.includes(railKey) ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.85)',
                            }}>
                                {t('appearance', `rail_${railKey}`)}
                            </span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={!railPrefs.hidden.includes(railKey)}
                                    onChange={() => updateRails(toggleHomeRail(railPrefs, railKey))}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                    ))}
                </div>

                {/* TV mode (10-foot UI) */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>📺 {t('appearance', 'tvMode')}</label>
                        <p>{t('appearance', 'tvModeDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={tvMode}
                            onChange={(e) => {
                                tvModeService.setEnabled(e.target.checked);
                                setTvMode(e.target.checked);
                            }}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

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

                {/* ♿ Alto contraste */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>♿ {t('appearance', 'contrast')}</label>
                        <p>{t('appearance', 'contrastDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={theme.contrast}
                            onChange={(e) => setTheme({ contrast: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {/* 🪶 Reduzir animações */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>🪶 {t('appearance', 'reducedMotion')}</label>
                        <p>{t('appearance', 'reducedMotionDesc')}</p>
                    </div>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={theme.reducedMotion}
                            onChange={(e) => setTheme({ reducedMotion: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {/* 🔠 Escala da interface */}
                <div className="setting-item">
                    <div className="setting-info">
                        <label>🔠 {t('appearance', 'uiScale')}</label>
                        <p>{t('appearance', 'uiScaleDesc')}</p>
                    </div>
                    <select
                        value={theme.scale}
                        onChange={(e) => setTheme({ scale: Number(e.target.value) as UiScale })}
                        style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: 'white', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
                    >
                        {UI_SCALES.map(scale => (
                            <option key={scale} value={scale} style={{ color: '#000' }}>{scale}%</option>
                        ))}
                    </select>
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
