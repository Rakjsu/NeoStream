import { useNavigate } from 'react-router-dom';
import { User, Lock, Server, LogIn, Tv, ArrowLeft, Play, Film, PlaySquare, Sparkles } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useLanguage } from '../services/languageService';

export function Login() {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const [step, setStep] = useState<'credentials' | 'playlist-name'>('credentials');
    const [includeTV, setIncludeTV] = useState(true);
    const [includeVOD, setIncludeVOD] = useState(true);
    const [loading, setLoading] = useState(false);
    const [loadingCounts, setLoadingCounts] = useState(false);
    const [error, setError] = useState('');
    const [playlistName, setPlaylistName] = useState('');
    const [counts, setCounts] = useState({ live: 0, vod: 0, series: 0 });

    const [formData, setFormData] = useState({
        url: '',
        username: '',
        password: ''
    });

    useEffect(() => {
        if (step === 'playlist-name') {
            fetchCounts();
        }
    }, [step]);

    const fetchCounts = async () => {
        setLoadingCounts(true);
        try {
            const result = await window.ipcRenderer.invoke('content:get-counts');
            if (result.success) {
                setCounts(result.counts);
            }
        } catch (err) {
            console.error('Failed to fetch counts:', err);
        } finally {
            setLoadingCounts(false);
        }
    };

    const handleCredentialsSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const result = await window.ipcRenderer.invoke('auth:login', {
                url: formData.url,
                username: formData.username,
                password: formData.password
            });

            if (result.success) {
                localStorage.setItem('includeTV', includeTV.toString());
                localStorage.setItem('includeVOD', includeVOD.toString());
                setStep('playlist-name');
            } else {
                const errorMessage = result.error || t('login', 'unexpectedError');
                if (errorMessage.includes('Invalid URL') || errorMessage.includes('invalid url')) {
                    setError(t('login', 'invalidUrl'));
                } else if (errorMessage.includes('fetch') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
                    setError(t('login', 'connectionError'));
                } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('authentication')) {
                    setError(t('login', 'authError'));
                } else if (errorMessage.includes('timeout')) {
                    setError(t('login', 'timeoutError'));
                } else {
                    setError(errorMessage);
                }
            }
        } catch (err: any) {
            if (err?.message?.includes('Invalid URL') || err?.message?.includes('invalid url')) {
                setError(t('login', 'invalidUrl'));
            } else if (err?.message?.includes('fetch')) {
                setError(t('login', 'connectionError'));
            } else if (err?.message?.includes('timeout')) {
                setError(t('login', 'timeoutError'));
            } else {
                setError(t('login', 'unexpectedError'));
            }
        } finally {
            setLoading(false);
        }
    };

    const handlePlaylistNameSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('playlistName', playlistName || 'Minha Playlist');
        window.location.href = '/';
    };

    const handleBack = () => {
        if (step === 'playlist-name') {
            setStep('credentials');
            setError('');
        } else {
            navigate('/welcome');
        }
    };

    return (
        <>
            <style>{loginStyles}</style>
            <div className="login-container">
                {/* Animated Background */}
                <div className="login-bg">
                    <div className="login-orb login-orb-1" />
                    <div className="login-orb login-orb-2" />
                    <div className="login-orb login-orb-3" />
                    <div className="login-grid" />
                </div>

                {/* Content */}
                <div className="login-content">
                    {/* Logo */}
                    <div className="login-logo">
                        <div className="login-logo-bg">
                            <Tv className="login-logo-icon" strokeWidth={1.5} />
                        </div>
                        <h1 className="login-title">NeoStream</h1>
                        <div className="login-badge">
                            <Sparkles size={12} />
                            <span>{step === 'credentials' ? t('login', 'iptvLogin') : t('login', 'library')}</span>
                        </div>
                    </div>

                    {step === 'credentials' && (
                        <form onSubmit={handleCredentialsSubmit} className="login-form">
                            {error && (
                                <div className="login-error">
                                    <span>❌</span>
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="login-field">
                                <label>{t('login', 'serverAddress')}</label>
                                <div className="login-input-wrap">
                                    <Server size={18} />
                                    <input
                                        type="text"
                                        required
                                        value={formData.url}
                                        onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                                        placeholder="http://example.com:8080"
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            <div className="login-field">
                                <label>{t('login', 'username')}</label>
                                <div className="login-input-wrap">
                                    <User size={18} />
                                    <input
                                        type="text"
                                        required
                                        value={formData.username}
                                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            <div className="login-field">
                                <label>{t('login', 'password')}</label>
                                <div className="login-input-wrap">
                                    <Lock size={18} />
                                    <input
                                        type="password"
                                        required
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            <div className="login-checkboxes">
                                <label className="login-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={includeTV}
                                        onChange={(e) => setIncludeTV(e.target.checked)}
                                        disabled={loading}
                                    />
                                    <span className="login-checkbox-mark" />
                                    <span>{t('login', 'includeTV')}</span>
                                </label>

                                <label className="login-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={includeVOD}
                                        onChange={(e) => setIncludeVOD(e.target.checked)}
                                        disabled={loading}
                                    />
                                    <span className="login-checkbox-mark" />
                                    <span>{t('login', 'includeVOD')}</span>
                                </label>
                            </div>

                            <div className="login-buttons">
                                <button type="button" onClick={handleBack} className="login-btn login-btn-secondary" disabled={loading}>
                                    <ArrowLeft size={18} />
                                    {t('login', 'back')}
                                </button>

                                <button type="submit" className="login-btn login-btn-primary" disabled={loading}>
                                    {loading ? (
                                        <>
                                            <div className="login-spinner" />
                                            {t('login', 'authenticating')}
                                        </>
                                    ) : (
                                        <>
                                            <LogIn size={18} />
                                            {t('login', 'loginButton')}
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}

                    {step === 'playlist-name' && (
                        <div className="login-playlist">
                            <form onSubmit={handlePlaylistNameSubmit} className="login-form">
                                <div className="login-field">
                                    <label>{t('login', 'playlistNameLabel')}</label>
                                    <div className="login-input-wrap">
                                        <Play size={18} />
                                        <input
                                            type="text"
                                            value={playlistName}
                                            onChange={(e) => setPlaylistName(e.target.value)}
                                            placeholder={t('login', 'playlistPlaceholder')}
                                            autoFocus
                                        />
                                    </div>
                                </div>

                                <div className="login-buttons">
                                    <button type="button" onClick={handleBack} className="login-btn login-btn-secondary">
                                        <ArrowLeft size={18} />
                                        {t('login', 'back')}
                                    </button>

                                    <button type="submit" className="login-btn login-btn-primary">
                                        <Play size={18} />
                                        {t('login', 'continueButton')}
                                    </button>
                                </div>
                            </form>

                            {/* Library Stats */}
                            <div className="login-stats">
                                <div className="login-stats-title">{t('login', 'library')}</div>
                                {loadingCounts ? (
                                    <div className="login-stats-loading">
                                        <div className="login-spinner" />
                                    </div>
                                ) : (
                                    <div className="login-stats-items">
                                        {includeTV && (
                                            <div className="login-stat login-stat-blue">
                                                <div className="login-stat-icon">
                                                    <Tv size={20} />
                                                </div>
                                                <div className="login-stat-value">{counts.live}</div>
                                                <div className="login-stat-label">{t('login', 'channels')}</div>
                                            </div>
                                        )}
                                        {includeVOD && (
                                            <>
                                                <div className="login-stat login-stat-purple">
                                                    <div className="login-stat-icon">
                                                        <Film size={20} />
                                                    </div>
                                                    <div className="login-stat-value">{counts.vod}</div>
                                                    <div className="login-stat-label">{t('login', 'moviesCount')}</div>
                                                </div>
                                                <div className="login-stat login-stat-green">
                                                    <div className="login-stat-icon">
                                                        <PlaySquare size={20} />
                                                    </div>
                                                    <div className="login-stat-value">{counts.series}</div>
                                                    <div className="login-stat-label">{t('login', 'seriesCount')}</div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

const loginStyles = `
.login-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    background: linear-gradient(135deg, #0a0a0f 0%, #0d0d15 50%, #0a0f1a 100%);
    position: relative;
    overflow: hidden;
}

.login-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.login-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(100px);
    opacity: 0.4;
    animation: orbFloat 20s ease-in-out infinite;
}

.login-orb-1 {
    width: 500px;
    height: 500px;
    background: radial-gradient(circle, #6366f1 0%, transparent 70%);
    top: -150px;
    right: -150px;
}

.login-orb-2 {
    width: 400px;
    height: 400px;
    background: radial-gradient(circle, #a855f7 0%, transparent 70%);
    bottom: -100px;
    left: -100px;
    animation-delay: -7s;
}

.login-orb-3 {
    width: 300px;
    height: 300px;
    background: radial-gradient(circle, #06b6d4 0%, transparent 70%);
    top: 50%;
    left: 30%;
    transform: translate(-50%, -50%);
    animation-delay: -14s;
}

@keyframes orbFloat {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(40px, -40px) scale(1.1); }
    50% { transform: translate(-30px, 30px) scale(0.9); }
    75% { transform: translate(30px, 40px) scale(1.05); }
}

.login-grid {
    position: absolute;
    inset: 0;
    background-image: 
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 60px 60px;
    mask-image: radial-gradient(ellipse at center, black 30%, transparent 70%);
}

.login-content {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 400px;
    animation: fadeInUp 0.6s ease;
}

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
}

.login-logo {
    text-align: center;
    margin-bottom: 40px;
}

.login-logo-bg {
    width: 80px;
    height: 80px;
    background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
    border-radius: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
    box-shadow: 0 16px 48px rgba(99, 102, 241, 0.4);
}

.login-logo-icon {
    width: 40px;
    height: 40px;
    color: white;
}

.login-title {
    font-size: 28px;
    font-weight: 700;
    color: white;
    margin: 0;
    letter-spacing: -0.02em;
}

.login-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    padding: 5px 12px;
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 16px;
    color: #c4b5fd;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
}

.login-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.login-error {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 12px;
    color: #fca5a5;
    font-size: 14px;
}

.login-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.login-field label {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255,255,255,0.6);
}

.login-input-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    transition: all 0.2s ease;
}

.login-input-wrap:focus-within {
    background: rgba(255,255,255,0.08);
    border-color: rgba(99, 102, 241, 0.5);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}

.login-input-wrap svg {
    color: rgba(255,255,255,0.4);
    flex-shrink: 0;
}

.login-input-wrap input {
    flex: 1;
    padding: 14px 0;
    background: transparent;
    border: none;
    color: white;
    font-size: 15px;
    outline: none;
}

.login-input-wrap input::placeholder {
    color: rgba(255,255,255,0.3);
}

.login-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 8px;
}

.login-checkbox {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    color: rgba(255,255,255,0.7);
    font-size: 14px;
}

.login-checkbox input {
    display: none;
}

.login-checkbox-mark {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
}

.login-checkbox input:checked + .login-checkbox-mark {
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    border-color: transparent;
}

.login-checkbox input:checked + .login-checkbox-mark::after {
    content: '✓';
    color: white;
    font-size: 12px;
    font-weight: 700;
}

.login-buttons {
    display: flex;
    gap: 12px;
    padding-top: 12px;
}

.login-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 20px;
    border: none;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
}

.login-btn-primary {
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    color: white;
    box-shadow: 0 8px 32px rgba(99, 102, 241, 0.3);
}

.login-btn-primary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 12px 40px rgba(99, 102, 241, 0.4);
}

.login-btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.login-btn-secondary {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.8);
    border: 1px solid rgba(255,255,255,0.1);
}

.login-btn-secondary:hover:not(:disabled) {
    background: rgba(255,255,255,0.12);
}

.login-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.login-playlist {
    display: flex;
    gap: 32px;
    align-items: flex-start;
}

.login-playlist .login-form {
    flex: 1;
}

.login-stats {
    width: 200px;
    padding: 20px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    animation: fadeInRight 0.5s ease;
}

@keyframes fadeInRight {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
}

.login-stats-title {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255,255,255,0.5);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 16px;
    text-align: center;
}

.login-stats-loading {
    display: flex;
    justify-content: center;
    padding: 24px 0;
}

.login-stats-items {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.login-stat {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 12px;
    transition: all 0.2s ease;
}

.login-stat:hover {
    transform: translateX(4px);
}

.login-stat-blue { background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); }
.login-stat-purple { background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.2); }
.login-stat-green { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); }

.login-stat-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
}

.login-stat-blue .login-stat-icon { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); }
.login-stat-purple .login-stat-icon { background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); }
.login-stat-green .login-stat-icon { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); }

.login-stat-value {
    font-size: 20px;
    font-weight: 700;
    color: white;
}

.login-stat-label {
    font-size: 12px;
    color: rgba(255,255,255,0.5);
}
`;
