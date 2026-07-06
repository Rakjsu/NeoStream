import { useState } from 'react';
import { useLanguage } from '../../services/languageService';
import { getTmdbApiKey, setTmdbApiKey, validateTmdbApiKey } from '../../services/tmdbKey';

/**
 * Settings > APIs: the user's own TMDB API key.
 *
 * The app no longer ships a bundled key — metadata (covers, plots, ratings,
 * trailers, parental certification, recommendation genres) only works after
 * the user pastes their own free key from themoviedb.org. New playlists
 * redirect here (onboarding) while no key is configured.
 */
export function ApiKeysSection({ onboarding = false }: { onboarding?: boolean }) {
    const { t } = useLanguage();

    const [key, setKey] = useState(() => getTmdbApiKey());
    const [configured, setConfigured] = useState(() => getTmdbApiKey().length > 0);
    const [testing, setTesting] = useState(false);
    const [feedback, setFeedback] = useState<'idle' | 'saved' | 'ok' | 'fail'>('idle');

    const handleSave = () => {
        setTmdbApiKey(key);
        setConfigured(getTmdbApiKey().length > 0);
        setFeedback('saved');
    };

    const handleTest = async () => {
        setTesting(true);
        setFeedback('idle');
        const ok = await validateTmdbApiKey(key);
        setTesting(false);
        setFeedback(ok ? 'ok' : 'fail');
        // Uma chave que a TMDB aceitou merece ser salva junto.
        if (ok) {
            setTmdbApiKey(key);
            setConfigured(true);
        }
    };

    const openTmdbSite = () => {
        void window.ipcRenderer.invoke('shell:open-external', { url: 'https://www.themoviedb.org/settings/api' });
    };

    const steps = [1, 2, 3, 4].map(n => t('apiKeys', `step${n}`));

    return (
        <div className="section-card">
            <style>{apiKeysStyles}</style>
            <div className="section-header">
                <div className="section-icon" style={{ background: 'linear-gradient(135deg, #ca8a04, #eab308)' }}>🔑</div>
                <div>
                    <h2>{t('apiKeys', 'title')}</h2>
                    <p>{t('apiKeys', 'description')}</p>
                </div>
            </div>

            {onboarding && !configured && (
                <div className="apikeys-onboarding">
                    <strong>🎉 {t('apiKeys', 'onboardingTitle')}</strong>
                    <p>{t('apiKeys', 'onboardingText')}</p>
                </div>
            )}

            <div className="settings-group">
                <div className="setting-item">
                    <div className="setting-info">
                        <label>🎬 TMDB (The Movie Database)</label>
                        <p>{t('apiKeys', 'whyText')}</p>
                    </div>
                    <span className={`apikeys-status ${configured ? 'ok' : 'missing'}`}>
                        {configured ? `✓ ${t('apiKeys', 'statusConfigured')}` : `○ ${t('apiKeys', 'statusMissing')}`}
                    </span>
                </div>

                <div className="apikeys-form">
                    <label className="apikeys-label" htmlFor="tmdb-key">{t('apiKeys', 'keyLabel')}</label>
                    <input
                        id="tmdb-key"
                        className="apikeys-input"
                        type="text"
                        value={key}
                        placeholder={t('apiKeys', 'keyPlaceholder')}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => { setKey(e.target.value); setFeedback('idle'); }}
                    />
                    <div className="apikeys-actions">
                        <button className="apikeys-btn primary" onClick={handleSave}>
                            {t('apiKeys', 'save')}
                        </button>
                        <button className="apikeys-btn" onClick={() => { void handleTest(); }} disabled={testing || !key.trim()}>
                            {testing ? t('apiKeys', 'testing') : t('apiKeys', 'test')}
                        </button>
                        {feedback === 'saved' && <span className="apikeys-feedback ok">✓ {t('apiKeys', 'saved')}</span>}
                        {feedback === 'ok' && <span className="apikeys-feedback ok">✓ {t('apiKeys', 'testOk')}</span>}
                        {feedback === 'fail' && <span className="apikeys-feedback err">✗ {t('apiKeys', 'testFail')}</span>}
                    </div>
                </div>

                <div className="apikeys-how">
                    <h3>{t('apiKeys', 'howTitle')}</h3>
                    <ol>
                        {steps.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                    <button className="apikeys-btn primary" onClick={openTmdbSite}>
                        🌐 {t('apiKeys', 'openSite')}
                    </button>
                </div>

                <div className="certificate-warning">
                    🔒 {t('apiKeys', 'privacyNote')}
                </div>
            </div>
        </div>
    );
}

const apiKeysStyles = `
.apikeys-onboarding {
    background: linear-gradient(135deg, rgba(202,138,4,.18), rgba(234,179,8,.08));
    border: 1px solid rgba(234,179,8,.4);
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 18px;
}
.apikeys-onboarding p { margin: 6px 0 0; color: rgba(255,255,255,.75); font-size: 14px; }
.apikeys-status { flex: none; font-size: 13px; font-weight: 600; white-space: nowrap; }
.apikeys-status.ok { color: #34d399; }
.apikeys-status.missing { color: #fbbf24; }
.apikeys-form { padding: 14px 4px; }
.apikeys-label { display: block; font-size: 13px; color: rgba(255,255,255,.6); margin-bottom: 8px; }
.apikeys-input {
    width: 100%; max-width: 520px; padding: 12px 14px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.06);
    color: #fff; font-size: 14px; font-family: monospace; letter-spacing: .5px;
}
.apikeys-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.apikeys-btn {
    padding: 10px 18px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15);
    background: rgba(255,255,255,.08); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
}
.apikeys-btn.primary { background: linear-gradient(135deg, #ca8a04, #eab308); border-color: transparent; color: #1c1917; }
.apikeys-btn:disabled { opacity: .5; cursor: default; }
.apikeys-feedback { font-size: 13px; font-weight: 600; }
.apikeys-feedback.ok { color: #34d399; }
.apikeys-feedback.err { color: #fca5a5; }
.apikeys-how { padding: 8px 4px 14px; }
.apikeys-how h3 { font-size: 15px; margin: 8px 0; }
.apikeys-how ol { margin: 0 0 14px; padding-left: 22px; color: rgba(255,255,255,.75); font-size: 14px; line-height: 1.9; }
`;
