import { useState, useEffect } from 'react';
import { updateService } from '../services/updateService';
import { playbackService } from '../services/playbackService';
import type { PlaybackConfig } from '../services/playbackService';
import { parentalService } from '../services/parentalService';
import type { ParentalConfig } from '../services/parentalService';
import { showUpToDateModal } from '../components/UpdateNotification';
import type { UpdateConfig } from '../types/update';

export function Settings() {
    const [updateConfig, setUpdateConfig] = useState<UpdateConfig>({
        checkFrequency: 'on-open',
        autoInstall: false,
        lastCheck: 0
    });
    const [playbackConfig, setPlaybackConfig] = useState<PlaybackConfig>(playbackService.getConfig());
    const [parentalConfig, setParentalConfig] = useState<ParentalConfig>(parentalService.getConfig());
    const [bufferInfo, setBufferInfo] = useState<string>('');
    const [checking, setChecking] = useState(false);
    const [lastCheckDate, setLastCheckDate] = useState<string>('');
    const [activeSection, setActiveSection] = useState<string>('updates');
    const [saveAnimation, setSaveAnimation] = useState<string | null>(null);

    // PIN Modal states
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinInput, setPinInput] = useState(['', '', '', '']);
    const [pinConfirm, setPinConfirm] = useState(['', '', '', '']);
    const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter');
    const [pinError, setPinError] = useState('');
    const [pinMode, setPinMode] = useState<'set' | 'verify'>('set'); // 'set' for new PIN, 'verify' for disabling

    // Legal modals
    const [showTermsModal, setShowTermsModal] = useState(false);
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);

    useEffect(() => {
        loadUpdateConfig();
        updateBufferInfo();
    }, []);

    const loadUpdateConfig = async () => {
        const config = await updateService.getConfig();
        setUpdateConfig(config);

        if (config.lastCheck) {
            const date = new Date(config.lastCheck);
            setLastCheckDate(date.toLocaleString('pt-BR'));
        }
    };

    const handleUpdateConfigChange = async (key: keyof UpdateConfig, value: any) => {
        const newConfig = { ...updateConfig, [key]: value };
        setUpdateConfig(newConfig);
        await updateService.setConfig(newConfig);

        // Show save animation
        setSaveAnimation(key);
        setTimeout(() => setSaveAnimation(null), 1500);
    };

    const updateBufferInfo = async () => {
        const description = playbackService.getBufferDescription();
        setBufferInfo(description);
    };

    const handlePlaybackConfigChange = async (key: keyof PlaybackConfig, value: any) => {
        const newConfig = { ...playbackConfig, [key]: value };
        setPlaybackConfig(newConfig);
        playbackService.setConfig({ [key]: value });

        // Update buffer info display when buffer changes
        if (key === 'bufferSize') {
            await updateBufferInfo();
        }

        // Show save animation
        setSaveAnimation(key);
        setTimeout(() => setSaveAnimation(null), 1500);
    };

    const handleParentalConfigChange = (key: keyof ParentalConfig, value: any) => {
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
        setSaveAnimation(`parental_${key}`);
        setTimeout(() => setSaveAnimation(null), 1500);
    };

    const handlePinSubmit = () => {
        const pin = pinInput.join('');

        if (pin.length !== 4) {
            setPinError('Digite 4 dígitos');
            return;
        }

        // Verification mode - check if PIN is correct to disable parental control
        if (pinMode === 'verify') {
            if (parentalService.verifyPin(pin)) {
                // PIN is correct - disable parental control
                setParentalConfig(prev => ({ ...prev, enabled: false }));
                parentalService.setConfig({ enabled: false });
                setShowPinModal(false);
                resetPinModal();

                // Show save animation
                setSaveAnimation('parental_enabled');
                setTimeout(() => setSaveAnimation(null), 1500);
            } else {
                setPinError('PIN incorreto');
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
                setPinError('Os PINs não coincidem');
                setPinConfirm(['', '', '', '']);
                return;
            }
            // Save PIN
            parentalService.setPin(pin);
            setParentalConfig(parentalService.getConfig());
            setShowPinModal(false);
            resetPinModal();

            // Show save animation
            setSaveAnimation('parental_pin');
            setTimeout(() => setSaveAnimation(null), 1500);
        }
    };

    const resetPinModal = () => {
        setPinInput(['', '', '', '']);
        setPinConfirm(['', '', '', '']);
        setPinStep('enter');
        setPinError('');
    };

    const handleCheckNow = async () => {
        setChecking(true);
        try {
            // This will trigger update:available event if update exists
            // If no update, we show the "up to date" modal manually
            const result = await updateService.checkForUpdates();
            if (!result.updateAvailable) {
                showUpToDateModal();
            }
            // If update is available, the UpdateNotification will show automatically
            await loadUpdateConfig();
        } catch (error) {
            console.error('Error checking for updates:', error);
        } finally {
            setChecking(false);
        }
    };

    const sections = [
        { id: 'updates', icon: '🔄', label: 'Atualizações', color: '#10b981' },
        { id: 'appearance', icon: '🎨', label: 'Aparência', color: '#8b5cf6' },
        { id: 'playback', icon: '⏯️', label: 'Reprodução', color: '#3b82f6' },
        { id: 'parental', icon: '👨‍👩‍👧', label: 'Controle Parental', color: '#ef4444' },
        { id: 'about', icon: 'ℹ️', label: 'Sobre', color: '#f59e0b' }
    ];

    return (
        <>
            <style>{settingsStyles}</style>
            <div className="settings-page">
                <div className="settings-backdrop" />

                {/* Header */}
                <header className="settings-header">
                    <div className="header-icon">⚙️</div>
                    <div>
                        <h1>Configurações</h1>
                        <p className="subtitle">Personalize sua experiência</p>
                    </div>
                </header>

                <div className="settings-layout">
                    {/* Sidebar Navigation */}
                    <nav className="settings-nav">
                        {sections.map((section, index) => (
                            <button
                                key={section.id}
                                className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
                                onClick={() => setActiveSection(section.id)}
                                style={{
                                    animationDelay: `${index * 0.1}s`,
                                    '--section-color': section.color
                                } as React.CSSProperties}
                            >
                                <span className="nav-icon">{section.icon}</span>
                                <span className="nav-label">{section.label}</span>
                            </button>
                        ))}
                    </nav>

                    {/* Content Area */}
                    <div className="settings-content">
                        {/* Updates Section */}
                        {activeSection === 'updates' && (
                            <div className="section-card">
                                <div className="section-header">
                                    <div className="section-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>🔄</div>
                                    <div>
                                        <h2>Atualizações Automáticas</h2>
                                        <p>Mantenha seu aplicativo sempre atualizado</p>
                                    </div>
                                </div>

                                <div className="settings-group">
                                    {/* Check Frequency */}
                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Verificar atualizações</label>
                                            <p>Define com que frequência o app verifica por novas versões</p>
                                        </div>
                                        <select
                                            className="setting-select"
                                            value={updateConfig.checkFrequency}
                                            onChange={(e) => handleUpdateConfigChange('checkFrequency', e.target.value as UpdateConfig['checkFrequency'])}
                                        >
                                            <option value="on-open">Ao abrir o app</option>
                                            <option value="1-day">A cada 1 dia</option>
                                            <option value="1-week">A cada 1 semana</option>
                                            <option value="1-month">A cada 1 mês</option>
                                        </select>
                                    </div>

                                    {/* Auto Install Toggle */}
                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Instalar automaticamente</label>
                                            <p>Atualizações serão instaladas sem pedir confirmação</p>
                                        </div>
                                        <label className="toggle-switch">
                                            <input
                                                type="checkbox"
                                                checked={updateConfig.autoInstall}
                                                onChange={(e) => handleUpdateConfigChange('autoInstall', e.target.checked)}
                                            />
                                            <span className="toggle-slider"></span>
                                        </label>
                                        {saveAnimation === 'autoInstall' && (
                                            <span className="save-indicator">✓ Salvo</span>
                                        )}
                                    </div>

                                    {/* Last Check */}
                                    {lastCheckDate && (
                                        <div className="last-check">
                                            <span className="check-icon">🕐</span>
                                            <span>Última verificação: <strong>{lastCheckDate}</strong></span>
                                        </div>
                                    )}

                                    {/* Check Now Button */}
                                    <button
                                        className={`check-btn ${checking ? 'checking' : ''}`}
                                        onClick={handleCheckNow}
                                        disabled={checking}
                                    >
                                        {checking ? (
                                            <>
                                                <span className="spinner"></span>
                                                <span>Verificando...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>🔍</span>
                                                <span>Verificar Atualizações Agora</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Appearance Section */}
                        {activeSection === 'appearance' && (
                            <div className="section-card">
                                <div className="section-header">
                                    <div className="section-icon" style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' }}>🎨</div>
                                    <div>
                                        <h2>Aparência</h2>
                                        <p>Personalize a interface do aplicativo</p>
                                    </div>
                                </div>

                                <div className="settings-group">

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Cor do Tema</label>
                                            <p>Escolha a cor principal do aplicativo</p>
                                        </div>
                                        <select className="setting-select">
                                            <option value="purple">💜 Roxo</option>
                                            <option value="blue">💙 Azul</option>
                                            <option value="green">💚 Verde</option>
                                            <option value="red">❤️ Vermelho</option>
                                            <option value="pink">💗 Rosa</option>
                                        </select>
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Tema</label>
                                            <p>Escolha o tema visual do aplicativo</p>
                                        </div>
                                        <select className="setting-select">
                                            <option>🌙 Escuro</option>
                                            <option>☀️ Claro</option>
                                            <option>🖥️ Sistema</option>
                                        </select>
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Idioma</label>
                                            <p>Idioma da interface</p>
                                        </div>
                                        <select className="setting-select">
                                            <option>🇧🇷 Português</option>
                                            <option>🇺🇸 English</option>
                                            <option>🇪🇸 Español</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Playback Section */}
                        {activeSection === 'playback' && (
                            <div className="section-card">
                                <div className="section-header">
                                    <div className="section-icon" style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>⏯️</div>
                                    <div>
                                        <h2>Reprodução</h2>
                                        <p>Ajuste a reprodução de vídeo e áudio</p>
                                    </div>
                                </div>

                                <div className="settings-group">
                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Tamanho do Buffer</label>
                                            <p>Tempo de buffer antes de iniciar a reprodução</p>
                                        </div>
                                        <select
                                            className="setting-select"
                                            value={playbackConfig.bufferSize}
                                            onChange={(e) => handlePlaybackConfigChange('bufferSize', e.target.value)}
                                        >
                                            <option value="intelligent">🧠 Inteligente (Adaptativo)</option>
                                            <option value="5">5 segundos</option>
                                            <option value="10">10 segundos</option>
                                            <option value="15">15 segundos</option>
                                            <option value="30">30 segundos</option>
                                        </select>
                                        {saveAnimation === 'bufferSize' && <span className="save-indicator">✓ Salvo</span>}
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Codificador de Vídeo</label>
                                            <p>Codec de vídeo preferencial</p>
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
                                        {saveAnimation === 'videoCodec' && <span className="save-indicator">✓ Salvo</span>}
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Auto-play próximo episódio</label>
                                            <p>Reproduzir automaticamente o próximo episódio</p>
                                        </div>
                                        <label className="toggle-switch">
                                            <input
                                                type="checkbox"
                                                checked={playbackConfig.autoPlayNextEpisode}
                                                onChange={(e) => handlePlaybackConfigChange('autoPlayNextEpisode', e.target.checked)}
                                            />
                                            <span className="toggle-slider"></span>
                                        </label>
                                        {saveAnimation === 'autoPlayNextEpisode' && <span className="save-indicator">✓ Salvo</span>}
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Pular intro automaticamente</label>
                                            <p>Pular abertura de séries quando disponível</p>
                                        </div>
                                        <label className="toggle-switch">
                                            <input type="checkbox" defaultChecked />
                                            <span className="toggle-slider"></span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Parental Control Section */}
                        {activeSection === 'parental' && (
                            <div className="section-card">
                                <div className="section-header">
                                    <div className="section-icon" style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}>👨‍👩‍👧</div>
                                    <div>
                                        <h2>Controle Parental</h2>
                                        <p>Gerencie o acesso ao conteúdo</p>
                                    </div>
                                </div>

                                <div className="settings-group">
                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Ativar Controle Parental</label>
                                            <p>Restringir acesso a conteúdo adulto</p>
                                        </div>
                                        <label className="toggle-switch">
                                            <input
                                                type="checkbox"
                                                checked={parentalConfig.enabled}
                                                onChange={(e) => handleParentalConfigChange('enabled', e.target.checked)}
                                            />
                                            <span className="toggle-slider"></span>
                                        </label>
                                        {saveAnimation === 'parental_enabled' && <span className="save-indicator">✓ Salvo</span>}
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Classificação Máxima</label>
                                            <p>Limite de classificação indicativa</p>
                                        </div>
                                        <select
                                            className="setting-select"
                                            value={parentalConfig.maxRating}
                                            onChange={(e) => handleParentalConfigChange('maxRating', e.target.value)}
                                            disabled={!parentalConfig.enabled}
                                        >
                                            <option value="L">Livre</option>
                                            <option value="10">10 anos</option>
                                            <option value="12">12 anos</option>
                                            <option value="14">14 anos</option>
                                            <option value="16">16 anos</option>
                                            <option value="18">18 anos</option>
                                        </select>
                                        {saveAnimation === 'parental_maxRating' && <span className="save-indicator">✓ Salvo</span>}
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>PIN de Acesso</label>
                                            <p>{parentalService.hasPin() ? 'PIN configurado ✓' : 'Definir PIN para desbloquear conteúdo'}</p>
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
                                            🔑 {parentalService.hasPin() ? 'Alterar' : 'Definir'} PIN
                                        </button>
                                        {saveAnimation === 'parental_pin' && <span className="save-indicator">✓ Salvo</span>}
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Bloquear Categorias Adultas</label>
                                            <p>Ocultar automaticamente categorias adultas</p>
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
                                        {saveAnimation === 'parental_blockAdultCategories' && <span className="save-indicator">✓ Salvo</span>}
                                    </div>

                                    <div className="setting-item">
                                        <div className="setting-info">
                                            <label>Filtrar por TMDB</label>
                                            <p>Verificar classificação no TMDB automaticamente</p>
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
                                        {saveAnimation === 'parental_filterByTMDB' && <span className="save-indicator">✓ Salvo</span>}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* About Section */}
                        {activeSection === 'about' && (
                            <div className="section-card">
                                <div className="section-header">
                                    <div className="section-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>ℹ️</div>
                                    <div>
                                        <h2>Sobre o Aplicativo</h2>
                                        <p>Informações e créditos</p>
                                    </div>
                                </div>

                                <div className="about-content">
                                    <div className="app-logo">
                                        <svg width="80" height="80" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                                            <defs>
                                                <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                                    <stop offset="0%" stopColor="#a855f7" />
                                                    <stop offset="100%" stopColor="#ec4899" />
                                                </linearGradient>
                                            </defs>
                                            <path d="M 10,10 L 10,90 L 90,50 Z" fill="none" stroke="url(#logoGrad)" strokeWidth="6" strokeLinejoin="round" />
                                            <rect x="35" y="35" width="6" height="30" fill="url(#logoGrad)" rx="3" />
                                            <rect x="45" y="25" width="6" height="50" fill="url(#logoGrad)" rx="3" />
                                            <rect x="55" y="40" width="6" height="20" fill="url(#logoGrad)" rx="3" />
                                        </svg>
                                    </div>
                                    <h3 className="app-name">NeoStream</h3>
                                    <p className="app-version">Versão {__APP_VERSION__}</p>
                                    <p className="app-description">
                                        Sua experiência de streaming completa com TV ao vivo, filmes e séries.
                                    </p>
                                    <div className="about-links">
                                        <button
                                            onClick={() => setShowTermsModal(true)}
                                            className="about-link"
                                        >
                                            📄 Termos de Uso
                                        </button>
                                        <button
                                            onClick={() => setShowPrivacyModal(true)}
                                            className="about-link"
                                        >
                                            🔒 Política de Privacidade
                                        </button>
                                        <a href="mailto:suporte@neostream.app" className="about-link">💬 Suporte</a>
                                    </div>
                                </div>
                            </div>
                        )}
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
                                        ? 'Verificar PIN'
                                        : pinStep === 'enter'
                                            ? 'Definir PIN'
                                            : 'Confirmar PIN'}
                                </h2>
                                <p style={{ color: '#9ca3af', fontSize: '15px', margin: 0 }}>
                                    {pinMode === 'verify'
                                        ? 'Digite o PIN para desativar o controle parental'
                                        : pinStep === 'enter'
                                            ? 'Digite um PIN de 4 dígitos para proteger o controle parental'
                                            : 'Digite o PIN novamente para confirmar'}
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

                {/* Terms of Use Modal */}
                {showTermsModal && (
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(0, 0, 0, 0.9)',
                            backdropFilter: 'blur(12px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1000,
                            padding: '20px',
                            animation: 'modalFadeIn 0.3s ease'
                        }}
                        onClick={(e) => {
                            if (e.target === e.currentTarget) setShowTermsModal(false);
                        }}
                    >
                        <style>{`
                            @keyframes modalFadeIn {
                                from { opacity: 0; }
                                to { opacity: 1; }
                            }
                            @keyframes modalSlideIn {
                                from { opacity: 0; transform: translateY(-40px) scale(0.95); }
                                to { opacity: 1; transform: translateY(0) scale(1); }
                            }
                            @keyframes iconPulse {
                                0%, 100% { transform: scale(1); }
                                50% { transform: scale(1.1); }
                            }
                            @keyframes fadeInUp {
                                from { opacity: 0; transform: translateY(20px); }
                                to { opacity: 1; transform: translateY(0); }
                            }
                        `}</style>
                        <div style={{
                            background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
                            borderRadius: '24px',
                            padding: '32px',
                            maxWidth: '700px',
                            width: '100%',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            boxShadow: '0 25px 80px rgba(0, 0, 0, 0.5), 0 0 40px rgba(168, 85, 247, 0.1)',
                            animation: 'modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <h2 style={{
                                    color: 'white',
                                    fontSize: '24px',
                                    fontWeight: 700,
                                    margin: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px'
                                }}>
                                    <span style={{ fontSize: '32px', animation: 'iconPulse 2s ease infinite' }}>📄</span>
                                    <span style={{
                                        background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        backgroundClip: 'text'
                                    }}>Termos de Uso</span>
                                </h2>
                                <button
                                    onClick={() => setShowTermsModal(false)}
                                    style={{
                                        background: 'rgba(168, 85, 247, 0.15)',
                                        border: '1px solid rgba(168, 85, 247, 0.3)',
                                        borderRadius: '12px',
                                        padding: '10px 16px',
                                        color: '#a855f7',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(168, 85, 247, 0.25)';
                                        e.currentTarget.style.transform = 'scale(1.05)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
                                        e.currentTarget.style.transform = 'scale(1)';
                                    }}
                                >
                                    ✕ Fechar
                                </button>
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: '14px', lineHeight: 1.8, animation: 'fadeInUp 0.5s ease 0.2s both' }}>
                                <p style={{ marginBottom: '16px', padding: '12px 16px', background: 'rgba(168, 85, 247, 0.1)', borderRadius: '12px', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                                    <strong style={{ color: '#a855f7' }}>📅 Última atualização:</strong> <span style={{ color: 'white' }}>09 de Dezembro de 2025</span>
                                </p>

                                <h3 style={{ color: '#a855f7', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>1. Aceitação dos Termos</h3>
                                <p>Ao utilizar o NeoStream, você concorda com estes Termos de Uso. O aplicativo é destinado exclusivamente para uso pessoal e não comercial.</p>

                                <h3 style={{ color: '#a855f7', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>2. Descrição do Serviço</h3>
                                <p>O NeoStream é um player de mídia que permite visualizar conteúdo IPTV através de listas M3U fornecidas pelo usuário. Não fornecemos, hospedamos ou distribuímos qualquer conteúdo de mídia.</p>

                                <h3 style={{ color: '#a855f7', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>3. Responsabilidade do Usuário</h3>
                                <p>Você é responsável por:</p>
                                <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
                                    <li>Garantir que possui direitos legais sobre o conteúdo acessado</li>
                                    <li>Cumprir as leis de direitos autorais do seu país</li>
                                    <li>Manter suas credenciais de acesso seguras</li>
                                    <li>Usar o aplicativo de forma ética e responsável</li>
                                </ul>

                                <h3 style={{ color: '#a855f7', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>4. Uso do Controle Parental</h3>
                                <p>O recurso de controle parental é fornecido como ferramenta auxiliar. Os pais/responsáveis devem supervisionar o uso do aplicativo por menores.</p>

                                <h3 style={{ color: '#a855f7', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>5. Limitação de Responsabilidade</h3>
                                <p>O NeoStream é fornecido "como está", sem garantias. Não nos responsabilizamos por:</p>
                                <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
                                    <li>Conteúdo de terceiros acessado através do aplicativo</li>
                                    <li>Interrupções no serviço de streaming</li>
                                    <li>Perdas de dados ou problemas técnicos</li>
                                </ul>

                                <h3 style={{ color: '#a855f7', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>6. Modificações</h3>
                                <p>Reservamo-nos o direito de modificar estes termos a qualquer momento. Alterações significativas serão comunicadas através do aplicativo.</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Privacy Policy Modal */}
                {showPrivacyModal && (
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(0, 0, 0, 0.9)',
                            backdropFilter: 'blur(12px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1000,
                            padding: '20px',
                            animation: 'modalFadeIn 0.3s ease'
                        }}
                        onClick={(e) => {
                            if (e.target === e.currentTarget) setShowPrivacyModal(false);
                        }}
                    >
                        <style>{`
                            @keyframes modalFadeIn {
                                from { opacity: 0; }
                                to { opacity: 1; }
                            }
                            @keyframes modalSlideIn {
                                from { opacity: 0; transform: translateY(-40px) scale(0.95); }
                                to { opacity: 1; transform: translateY(0) scale(1); }
                            }
                            @keyframes iconPulse {
                                0%, 100% { transform: scale(1); }
                                50% { transform: scale(1.1); }
                            }
                            @keyframes fadeInUp {
                                from { opacity: 0; transform: translateY(20px); }
                                to { opacity: 1; transform: translateY(0); }
                            }
                        `}</style>
                        <div style={{
                            background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
                            borderRadius: '24px',
                            padding: '32px',
                            maxWidth: '700px',
                            width: '100%',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            boxShadow: '0 25px 80px rgba(0, 0, 0, 0.5), 0 0 40px rgba(16, 185, 129, 0.1)',
                            animation: 'modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <h2 style={{
                                    color: 'white',
                                    fontSize: '24px',
                                    fontWeight: 700,
                                    margin: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px'
                                }}>
                                    <span style={{ fontSize: '32px', animation: 'iconPulse 2s ease infinite' }}>🔒</span>
                                    <span style={{
                                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        backgroundClip: 'text'
                                    }}>Política de Privacidade</span>
                                </h2>
                                <button
                                    onClick={() => setShowPrivacyModal(false)}
                                    style={{
                                        background: 'rgba(16, 185, 129, 0.15)',
                                        border: '1px solid rgba(16, 185, 129, 0.3)',
                                        borderRadius: '12px',
                                        padding: '10px 16px',
                                        color: '#10b981',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)';
                                        e.currentTarget.style.transform = 'scale(1.05)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
                                        e.currentTarget.style.transform = 'scale(1)';
                                    }}
                                >
                                    ✕ Fechar
                                </button>
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: '14px', lineHeight: 1.8, animation: 'fadeInUp 0.5s ease 0.2s both' }}>
                                <p style={{ marginBottom: '16px', padding: '12px 16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                    <strong style={{ color: '#10b981' }}>📅 Última atualização:</strong> <span style={{ color: 'white' }}>09 de Dezembro de 2024</span>
                                </p>

                                <h3 style={{ color: '#10b981', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>1. Dados que Coletamos</h3>
                                <p>O NeoStream coleta e armazena <strong style={{ color: 'white' }}>localmente no seu dispositivo</strong>:</p>
                                <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
                                    <li>Credenciais de conexão IPTV (criptografadas)</li>
                                    <li>Preferências de configuração</li>
                                    <li>Histórico de reprodução e progresso</li>
                                    <li>Configurações de controle parental</li>
                                    <li>Cache de classificações de conteúdo</li>
                                </ul>

                                <h3 style={{ color: '#10b981', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>2. Armazenamento Local</h3>
                                <p>Todos os dados são armazenados <strong style={{ color: 'white' }}>exclusivamente no seu dispositivo</strong> usando:</p>
                                <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
                                    <li>LocalStorage para configurações</li>
                                    <li>IndexedDB para cache de conteúdo</li>
                                    <li>SessionStorage para dados temporários</li>
                                </ul>

                                <h3 style={{ color: '#10b981', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>3. Comunicações Externas</h3>
                                <p>O aplicativo faz conexões externas apenas para:</p>
                                <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
                                    <li>Seu servidor IPTV (fornecido por você)</li>
                                    <li>API do TMDB para metadados e classificações</li>
                                    <li>Verificação de atualizações (opcional)</li>
                                </ul>

                                <h3 style={{ color: '#10b981', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>4. Não Coletamos</h3>
                                <p style={{ color: '#10b981' }}>❌ NÃO coletamos, transmitimos ou vendemos:</p>
                                <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
                                    <li>Informações pessoais identificáveis</li>
                                    <li>Dados de localização</li>
                                    <li>Histórico de navegação</li>
                                    <li>Informações de contatos</li>
                                    <li>Dados analíticos ou telemetria</li>
                                </ul>

                                <h3 style={{ color: '#10b981', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>5. Seus Direitos</h3>
                                <p>Você pode a qualquer momento:</p>
                                <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
                                    <li>Limpar todos os dados locais nas configurações</li>
                                    <li>Desinstalar o aplicativo para remover todos os dados</li>
                                    <li>Exportar seus dados (histórico, favoritos)</li>
                                </ul>

                                <h3 style={{ color: '#10b981', fontSize: '16px', marginTop: '24px', marginBottom: '12px' }}>6. Contato</h3>
                                <p>Para questões sobre privacidade, entre em contato através do suporte do aplicativo.</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

// CSS Styles
const settingsStyles = `
/* Page Container */
.settings-page {
    position: relative;
    min-height: 100vh;
    padding: 32px;
    overflow-x: hidden;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
}

/* Animated Backdrop */
.settings-backdrop {
    position: fixed;
    inset: 0;
    background: 
        radial-gradient(ellipse at 30% 30%, rgba(168, 85, 247, 0.1) 0%, transparent 50%),
        radial-gradient(ellipse at 70% 70%, rgba(59, 130, 246, 0.1) 0%, transparent 50%);
    pointer-events: none;
    z-index: 0;
}

/* Header */
.settings-header {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 40px;
    animation: fadeInDown 0.5s ease;
}

@keyframes fadeInDown {
    from {
        opacity: 0;
        transform: translateY(-20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.header-icon {
    font-size: 48px;
    animation: spin 10s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.settings-header h1 {
    font-size: 42px;
    font-weight: 800;
    color: white;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #fff 0%, #c4b5fd 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin: 0;
}

.subtitle {
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    margin-top: 4px;
}

/* Layout */
.settings-layout {
    position: relative;
    z-index: 10;
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 32px;
    max-width: 1200px;
}

@media (max-width: 900px) {
    .settings-layout {
        grid-template-columns: 1fr;
    }
}

/* Navigation */
.settings-nav {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    height: fit-content;
    min-width: 220px;
}

@media (max-width: 900px) {
    .settings-nav {
        flex-direction: row;
        overflow-x: auto;
        padding: 10px;
        min-width: unset;
    }
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: transparent;
    border: none;
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    animation: slideIn 0.4s ease backwards;
    width: 100%;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-20px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.nav-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
}

.nav-item.active {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(236, 72, 153, 0.2));
    color: white;
    box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.4);
}

.nav-icon {
    font-size: 22px;
}

.nav-label {
    white-space: nowrap;
}

/* Content Area */
.settings-content {
    flex: 1;
}

/* Section Card */
.section-card {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: 32px;
    animation: fadeIn 0.4s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.section-header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.section-icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.section-header h2 {
    font-size: 24px;
    font-weight: 700;
    color: white;
    margin: 0 0 4px 0;
}

.section-header p {
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
    font-size: 14px;
}

/* Settings Group */
.settings-group {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

/* Setting Item */
.setting-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    transition: all 0.3s ease;
}

.setting-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
}

.setting-info {
    flex: 1;
}

.setting-info label {
    display: block;
    font-size: 16px;
    font-weight: 600;
    color: white;
    margin-bottom: 4px;
}

.setting-info p {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
}

/* Select */
.setting-select {
    padding: 12px 20px;
    background: rgba(30, 30, 50, 0.9);
    color: white;
    font-size: 14px;
    font-weight: 600;
    border-radius: 12px;
    border: 2px solid rgba(168, 85, 247, 0.3);
    cursor: pointer;
    outline: none;
    min-width: 180px;
    transition: all 0.2s ease;
}

.setting-select:hover {
    border-color: rgba(168, 85, 247, 0.5);
}

.setting-select:focus {
    border-color: #a855f7;
    box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.2);
}

/* Toggle Switch */
.toggle-switch {
    position: relative;
    display: inline-block;
    width: 56px;
    height: 30px;
}

.toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.toggle-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 30px;
    transition: all 0.4s ease;
}

.toggle-slider:before {
    position: absolute;
    content: "";
    height: 22px;
    width: 22px;
    left: 4px;
    bottom: 4px;
    background: white;
    border-radius: 50%;
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toggle-switch input:checked + .toggle-slider {
    background: linear-gradient(135deg, #a855f7, #ec4899);
}

.toggle-switch input:checked + .toggle-slider:before {
    transform: translateX(26px);
}

/* Save Indicator */
.save-indicator {
    margin-left: 12px;
    padding: 6px 12px;
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
    font-size: 12px;
    font-weight: 600;
    border-radius: 20px;
    animation: popIn 0.3s ease;
}

@keyframes popIn {
    from { transform: scale(0); }
    to { transform: scale(1); }
}

/* Last Check */
.last-check {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    background: rgba(168, 85, 247, 0.1);
    border-radius: 12px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
}

.check-icon {
    font-size: 18px;
}

.last-check strong {
    color: white;
}

/* Check Button */
.check-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    padding: 18px 32px;
    background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
    border: none;
    border-radius: 14px;
    color: white;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 8px 24px rgba(168, 85, 247, 0.3);
}

.check-btn:hover:not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 12px 32px rgba(168, 85, 247, 0.4);
}

.check-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
}

.check-btn.checking {
    background: rgba(168, 85, 247, 0.3);
}

.spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spinLoader 0.8s linear infinite;
}

@keyframes spinLoader {
    to { transform: rotate(360deg); }
}

/* About Section */
.about-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 32px 0;
}

.app-logo {
    margin-bottom: 24px;
    animation: float 3s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

.app-name {
    font-size: 32px;
    font-weight: 800;
    color: white;
    margin: 0 0 8px 0;
    background: linear-gradient(135deg, #a855f7, #ec4899);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.app-version {
    display: inline-block;
    padding: 6px 16px;
    background: rgba(168, 85, 247, 0.2);
    border-radius: 20px;
    color: #c4b5fd;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 20px;
}

.app-description {
    color: rgba(255, 255, 255, 0.6);
    font-size: 15px;
    line-height: 1.6;
    max-width: 400px;
    margin-bottom: 32px;
}

.about-links {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
}

.about-link {
    padding: 14px 24px;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(236, 72, 153, 0.15) 100%);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 14px;
    color: #c4b5fd;
    text-decoration: none;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 4px 15px rgba(168, 85, 247, 0.15);
}

.about-link:hover {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(236, 72, 153, 0.25) 100%);
    color: white;
    transform: translateY(-4px) scale(1.02);
    box-shadow: 0 8px 25px rgba(168, 85, 247, 0.3);
    border-color: rgba(168, 85, 247, 0.5);
}

.about-link:active {
    transform: translateY(-2px) scale(1);
}
`;
