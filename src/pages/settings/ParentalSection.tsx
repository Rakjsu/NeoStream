import { useState } from 'react';
import { parentalService } from '../../services/parentalService';
import type { ParentalConfig } from '../../services/parentalService';
import {
    getKidsDailyLimitMinutes, setKidsDailyLimitMinutes,
    getProfileDailyLimitMinutes, setProfileDailyLimitMinutes,
    getKidsAllowedHours, setKidsAllowedHours,
    getAutoKidsHours, setAutoKidsHours,
    type HoursWindow,
} from '../../services/watchLimitsService';
import { profileService } from '../../services/profileService';
import { listParentalLog, clearParentalLog, type ParentalLogEntry } from '../../services/parentalLogService';
import { useLanguage } from '../../services/languageService';
import { useSaveAnimation } from './useSaveAnimation';

export function ParentalSection() {
    const [parentalConfig, setParentalConfig] = useState<ParentalConfig>(parentalService.getConfig());
    const { t } = useLanguage();
    const { saveAnimation, triggerSaveAnimation } = useSaveAnimation();
    const [kidsLimit, setKidsLimit] = useState(() => getKidsDailyLimitMinutes());
    // D65: janelas de horário, limites por perfil e log parental.
    const windowToValue = (window: HoursWindow | null) => (window ? `${window.start}-${window.end}` : '');
    const valueToWindow = (value: string): HoursWindow | null => {
        const match = value.match(/^(\d{1,2})-(\d{1,2})$/);
        return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
    };
    const [kidsHours, setKidsHours] = useState(() => windowToValue(getKidsAllowedHours()));
    const [autoKids, setAutoKids] = useState(() => windowToValue(getAutoKidsHours()));
    const [profiles] = useState(() => profileService.getAllProfiles().filter(p => !p.isGuest));
    const [profileLimits, setProfileLimits] = useState<Record<string, number>>(() =>
        Object.fromEntries(profileService.getAllProfiles().map(p => [p.id, getProfileDailyLimitMinutes(p.id)])));
    const [logEntries, setLogEntries] = useState<ParentalLogEntry[]>(() => listParentalLog().slice(0, 30));

    // PIN Modal states
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinInput, setPinInput] = useState(['', '', '', '']);
    const [pinConfirm, setPinConfirm] = useState(['', '', '', '']);
    const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter');
    const [pinError, setPinError] = useState('');
    const [pinMode, setPinMode] = useState<'set' | 'verify'>('set'); // 'set' for new PIN, 'verify' for disabling

    const handleParentalConfigChange = <K extends keyof ParentalConfig>(key: K, value: ParentalConfig[K]) => {
        // When trying to disable parental control, require PIN verification
        if (key === 'enabled' && value === false && parentalService.hasPin()) {
            resetPinModal();
            setPinMode('verify');
            setShowPinModal(true);
            return; // Don't change config until PIN is verified
        }

        const newConfig = { ...parentalConfig, [key]: value };
        setParentalConfig(newConfig);
        parentalService.setConfig({ [key]: value });

        // When enabling parental control for the first time, prompt for PIN
        if (key === 'enabled' && value === true && !parentalService.hasPin()) {
            resetPinModal();
            setPinMode('set');
            setShowPinModal(true);
        }

        // Show save animation
        triggerSaveAnimation(`parental_${key}`);
    };

    const handlePinSubmit = async () => {
        const pin = pinInput.join('');

        if (pin.length !== 4) {
            setPinError(t('parental', 'pinError4Digits'));
            return;
        }

        // Verification mode - check if PIN is correct to disable parental control
        if (pinMode === 'verify') {
            if (await parentalService.verifyPin(pin)) {
                // PIN is correct - disable parental control
                setParentalConfig(prev => ({ ...prev, enabled: false }));
                parentalService.setConfig({ enabled: false });
                setShowPinModal(false);
                resetPinModal();

                // Show save animation
                triggerSaveAnimation('parental_enabled');
            } else {
                setPinError(t('parental', 'pinIncorrect'));
                setPinInput(['', '', '', '']);
            }
            return;
        }

        // Set mode - setting a new PIN
        if (pinStep === 'enter') {
            // Move to confirm step
            setPinStep('confirm');
            setPinError('');
        } else {
            // Confirm PIN
            const confirmPin = pinConfirm.join('');
            if (pin !== confirmPin) {
                setPinError(t('parental', 'pinMismatch'));
                setPinConfirm(['', '', '', '']);
                return;
            }
            // Save PIN
            await parentalService.setPin(pin);
            setParentalConfig(parentalService.getConfig());
            setShowPinModal(false);
            resetPinModal();

            // Show save animation
            triggerSaveAnimation('parental_pin');
        }
    };

    const resetPinModal = () => {
        setPinInput(['', '', '', '']);
        setPinConfirm(['', '', '', '']);
        setPinStep('enter');
        setPinError('');
    };

    return (
        <>
            <div className="section-card">
                <div className="section-header">
                    <div className="section-icon" style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}>👨‍👩‍👧</div>
                    <div>
                        <h2>{t('parental', 'title')}</h2>
                        <p>{t('parental', 'description')}</p>
                    </div>
                </div>

                <div className="settings-group">
                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'enable')}</label>
                            <p>{t('parental', 'enableDesc')}</p>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={parentalConfig.enabled}
                                onChange={(e) => handleParentalConfigChange('enabled', e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                        {saveAnimation === 'parental_enabled' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'maxRating')}</label>
                            <p>{t('parental', 'maxRatingDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={parentalConfig.maxRating}
                            onChange={(e) => handleParentalConfigChange('maxRating', e.target.value as ParentalConfig['maxRating'])}
                            disabled={!parentalConfig.enabled}
                        >
                            <option value="L">{t('parental', 'free')}</option>
                            <option value="10">10 {t('parental', 'years')}</option>
                            <option value="12">12 {t('parental', 'years')}</option>
                            <option value="14">14 {t('parental', 'years')}</option>
                            <option value="16">16 {t('parental', 'years')}</option>
                            <option value="18">18 {t('parental', 'years')}</option>
                        </select>
                        {saveAnimation === 'parental_maxRating' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'pin')}</label>
                            <p>{parentalService.hasPin() ? t('parental', 'pinConfigured') : t('parental', 'pinDefine')}</p>
                        </div>
                        <button
                            className="setting-btn"
                            onClick={() => {
                                resetPinModal();
                                setShowPinModal(true);
                            }}
                            disabled={!parentalConfig.enabled}
                            style={{
                                padding: '10px 20px',
                                background: parentalConfig.enabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(100, 100, 100, 0.2)',
                                border: `1px solid ${parentalConfig.enabled ? 'rgba(239, 68, 68, 0.4)' : 'rgba(100, 100, 100, 0.4)'}`,
                                borderRadius: '10px',
                                color: parentalConfig.enabled ? '#ef4444' : '#666',
                                cursor: parentalConfig.enabled ? 'pointer' : 'not-allowed',
                                fontWeight: 600,
                                transition: 'all 0.2s'
                            }}
                        >
                            🔑 {parentalService.hasPin() ? t('parental', 'changePin') : t('parental', 'setPin')} PIN
                        </button>
                        {saveAnimation === 'parental_pin' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'blockAdult')}</label>
                            <p>{t('parental', 'blockAdultDesc')}</p>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={parentalConfig.blockAdultCategories}
                                onChange={(e) => handleParentalConfigChange('blockAdultCategories', e.target.checked)}
                                disabled={!parentalConfig.enabled}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                        {saveAnimation === 'parental_blockAdultCategories' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>{t('parental', 'filterTMDB')}</label>
                            <p>{t('parental', 'filterTMDBDesc')}</p>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={parentalConfig.filterByTMDB}
                                onChange={(e) => handleParentalConfigChange('filterByTMDB', e.target.checked)}
                                disabled={!parentalConfig.enabled}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                        {saveAnimation === 'parental_filterByTMDB' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <label>⏰ {t('parental', 'kidsLimit')}</label>
                            <p>{t('parental', 'kidsLimitDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={kidsLimit}
                            onChange={(e) => {
                                const minutes = Number(e.target.value);
                                setKidsLimit(minutes);
                                setKidsDailyLimitMinutes(minutes);
                                triggerSaveAnimation('parental_kidsLimit');
                            }}
                        >
                            <option value={0}>{t('parental', 'limitOff')}</option>
                            <option value={30}>30 min</option>
                            <option value={60}>1h</option>
                            <option value={90}>1h30</option>
                            <option value={120}>2h</option>
                            <option value={180}>3h</option>
                        </select>
                        {saveAnimation === 'parental_kidsLimit' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* 🕗 Janela de horário do perfil kids */}
                    <div className="setting-item">
                        <div className="setting-info">
                            <label>🕗 {t('parental', 'kidsHours')}</label>
                            <p>{t('parental', 'kidsHoursDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={kidsHours}
                            onChange={(e) => {
                                setKidsHours(e.target.value);
                                setKidsAllowedHours(valueToWindow(e.target.value));
                                triggerSaveAnimation('parental_kidsHours');
                            }}
                        >
                            <option value="">{t('parental', 'limitOff')}</option>
                            <option value="6-20">06h–20h</option>
                            <option value="7-21">07h–21h</option>
                            <option value="8-22">08h–22h</option>
                        </select>
                        {saveAnimation === 'parental_kidsHours' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* 👶 Auto-trocar pra kids por horário */}
                    <div className="setting-item">
                        <div className="setting-info">
                            <label>👶 {t('parental', 'autoKids')}</label>
                            <p>{t('parental', 'autoKidsDesc')}</p>
                        </div>
                        <select
                            className="setting-select"
                            value={autoKids}
                            onChange={(e) => {
                                setAutoKids(e.target.value);
                                setAutoKidsHours(valueToWindow(e.target.value));
                                triggerSaveAnimation('parental_autoKids');
                            }}
                        >
                            <option value="">{t('parental', 'limitOff')}</option>
                            <option value="6-20">06h–20h</option>
                            <option value="7-21">07h–21h</option>
                            <option value="8-22">08h–22h</option>
                        </select>
                        {saveAnimation === 'parental_autoKids' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* ⏳ Limite diário por perfil (adultos também) */}
                    <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                        <div className="setting-info">
                            <label>⏳ {t('parental', 'profileLimits')}</label>
                            <p>{t('parental', 'profileLimitsDesc')}</p>
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {profiles.map(profile => (
                                    <div key={profile.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ minWidth: 140, color: 'rgba(255,255,255,0.8)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {profile.isKids ? '👶 ' : ''}{profile.name}
                                        </span>
                                        <select
                                            className="setting-select"
                                            value={profileLimits[profile.id] ?? 0}
                                            onChange={(e) => {
                                                const minutes = Number(e.target.value);
                                                setProfileDailyLimitMinutes(profile.id, minutes);
                                                setProfileLimits(prev => ({ ...prev, [profile.id]: minutes }));
                                                triggerSaveAnimation('parental_profileLimit');
                                            }}
                                        >
                                            <option value={0}>{t('parental', 'limitOff')}</option>
                                            <option value={30}>30 min</option>
                                            <option value={60}>1h</option>
                                            <option value={90}>1h30</option>
                                            <option value={120}>2h</option>
                                            <option value={180}>3h</option>
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {saveAnimation === 'parental_profileLimit' && <span className="save-indicator">{t('settings', 'saved')}</span>}
                    </div>

                    {/* 📜 Log parental (verificações de PIN) */}
                    <div className="setting-item" style={{ alignItems: 'flex-start' }}>
                        <div className="setting-info">
                            <label>📜 {t('parental', 'logTitle')}</label>
                            <p>{t('parental', 'logDesc')}</p>
                            {logEntries.length > 0 ? (
                                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                                    {logEntries.map((entry, index) => (
                                        <div key={`${entry.ts}-${index}`} style={{ fontSize: 12, color: entry.kind === 'pin_fail' ? '#fca5a5' : 'rgba(255,255,255,0.6)' }}>
                                            {new Date(entry.ts).toLocaleString('pt-BR')} · {entry.kind === 'pin_fail' ? '❌' : '✅'} {entry.detail}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 }}>{t('parental', 'logEmpty')}</p>
                            )}
                        </div>
                        <button
                            className="check-btn"
                            style={{ width: 'auto', padding: '10px 16px' }}
                            title={t('parental', 'logClear')}
                            onClick={() => { clearParentalLog(); setLogEntries([]); }}
                        >
                            🗑
                        </button>
                    </div>
                </div>
            </div>

            {/* PIN Modal */}
            {showPinModal && (
                <div
                    className="pin-modal-overlay"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0, 0, 0, 0.9)',
                        backdropFilter: 'blur(12px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        animation: 'pinFadeIn 0.3s ease'
                    }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowPinModal(false);
                            resetPinModal();
                        }
                    }}
                >
                    <style>{`
                        @keyframes pinFadeIn {
                            from { opacity: 0; }
                            to { opacity: 1; }
                        }
                        @keyframes pinSlideIn {
                            from { opacity: 0; transform: translateY(-30px) scale(0.95); }
                            to { opacity: 1; transform: translateY(0) scale(1); }
                        }
                        @keyframes pinBounce {
                            0%, 100% { transform: scale(1); }
                            50% { transform: scale(1.15); }
                        }
                        @keyframes pinDigitPop {
                            0% { transform: scale(1); }
                            50% { transform: scale(1.1); }
                            100% { transform: scale(1); }
                        }
                        @keyframes pinShake {
                            0%, 100% { transform: translateX(0); }
                            20% { transform: translateX(-10px); }
                            40% { transform: translateX(10px); }
                            60% { transform: translateX(-10px); }
                            80% { transform: translateX(10px); }
                        }
                        .pin-digit-filled {
                            animation: pinDigitPop 0.2s ease !important;
                        }
                        .pin-error-shake {
                            animation: pinShake 0.5s ease !important;
                        }
                    `}</style>
                    <div style={{
                        background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
                        borderRadius: '28px',
                        padding: '48px 40px',
                        maxWidth: '420px',
                        width: '90%',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        boxShadow: '0 30px 100px rgba(0, 0, 0, 0.6), 0 0 40px rgba(239, 68, 68, 0.1)',
                        animation: 'pinSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
                    }}>
                        {/* Header */}
                        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
                            <span style={{
                                fontSize: '56px',
                                display: 'block',
                                marginBottom: '16px',
                                animation: 'pinBounce 0.6s ease'
                            }}>{pinMode === 'verify' ? '🔓' : '🔐'}</span>
                            <h2 style={{
                                color: 'white',
                                fontSize: '26px',
                                fontWeight: 700,
                                margin: '0 0 10px 0',
                                background: 'linear-gradient(135deg, #fff 0%, #f87171 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text'
                            }}>
                                {pinMode === 'verify'
                                    ? t('parental', 'verifyPin')
                                    : pinStep === 'enter'
                                        ? t('parental', 'setPin') + ' PIN'
                                        : t('parental', 'confirmPin')}
                            </h2>
                            <p style={{ color: '#9ca3af', fontSize: '15px', margin: 0 }}>
                                {pinMode === 'verify'
                                    ? t('parental', 'verifyPin')
                                    : pinStep === 'enter'
                                        ? t('parental', 'enterPin')
                                        : t('parental', 'confirmPin')}
                            </p>
                        </div>

                        {/* PIN Input Container */}
                        <div
                            style={{
                                position: 'relative',
                                display: 'flex',
                                justifyContent: 'center',
                                gap: '14px',
                                marginBottom: '28px'
                            }}
                            onClick={() => {
                                const input = document.getElementById('pin-hidden-input');
                                if (input) input.focus();
                            }}
                        >
                            {/* Hidden Input that captures keyboard */}
                            <input
                                id="pin-hidden-input"
                                type="tel"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={4}
                                autoFocus
                                autoComplete="off"
                                value={pinStep === 'enter' ? pinInput.join('') : pinConfirm.join('')}
                                onChange={(e) => {
                                    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                                    const digits = value.split('').concat(['', '', '', '']).slice(0, 4);
                                    if (pinStep === 'enter') {
                                        setPinInput(digits);
                                    } else {
                                        setPinConfirm(digits);
                                    }
                                    setPinError('');
                                }}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    opacity: 0,
                                    cursor: 'pointer',
                                    zIndex: 10
                                }}
                            />

                            {/* Visual PIN Digits */}
                            {(pinStep === 'enter' ? pinInput : pinConfirm).map((digit, index) => (
                                <div
                                    key={index}
                                    className={digit ? 'pin-digit-filled' : ''}
                                    style={{
                                        width: '64px',
                                        height: '76px',
                                        background: digit
                                            ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.15) 100%)'
                                            : 'rgba(255, 255, 255, 0.05)',
                                        border: `2px solid ${digit ? '#ef4444' : 'rgba(255, 255, 255, 0.15)'}`,
                                        borderRadius: '16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '36px',
                                        color: '#ef4444',
                                        transition: 'all 0.2s ease',
                                        boxShadow: digit ? '0 4px 20px rgba(239, 68, 68, 0.3)' : 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {digit ? '●' : ''}
                                </div>
                            ))}
                        </div>

                        {/* Error Message */}
                        {pinError && (
                            <div
                                className="pin-error-shake"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    color: '#f87171',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    marginBottom: '20px',
                                    padding: '12px',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    borderRadius: '10px',
                                    border: '1px solid rgba(239, 68, 68, 0.2)'
                                }}
                            >
                                ⚠️ {pinError}
                            </div>
                        )}

                        {/* Buttons */}
                        <div style={{
                            display: 'flex',
                            gap: '14px',
                            marginTop: '28px'
                        }}>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowPinModal(false);
                                    resetPinModal();
                                    // If we're enabling parental control and user cancels, disable it
                                    if (!parentalService.hasPin()) {
                                        handleParentalConfigChange('enabled', false);
                                    }
                                }}
                                style={{
                                    flex: 1,
                                    padding: '16px 24px',
                                    borderRadius: '14px',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    background: 'rgba(255, 255, 255, 0.08)',
                                    color: '#9ca3af',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                                    e.currentTarget.style.color = 'white';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                    e.currentTarget.style.color = '#9ca3af';
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => handlePinSubmit()}
                                style={{
                                    flex: 1,
                                    padding: '16px 24px',
                                    borderRadius: '14px',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                                    color: 'white',
                                    border: 'none',
                                    transition: 'all 0.2s ease',
                                    boxShadow: '0 4px 20px rgba(239, 68, 68, 0.4)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 6px 25px rgba(239, 68, 68, 0.5)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(239, 68, 68, 0.4)';
                                }}
                            >
                                {pinMode === 'verify'
                                    ? '🔓 Desbloquear'
                                    : pinStep === 'enter'
                                        ? 'Continuar →'
                                        : '✓ Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
