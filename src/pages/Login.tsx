import { useNavigate } from 'react-router-dom';
import { User, Lock, Server, LogIn, Tv, ArrowLeft, Play, Film, PlaySquare } from 'lucide-react';
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
            console.log('Attempting login with:', { url: formData.url, username: formData.username });

            const result = await window.ipcRenderer.invoke('auth:login', {
                url: formData.url,
                username: formData.username,
                password: formData.password
            });

            console.log('Login result:', result);

            if (result.success) {
                localStorage.setItem('includeTV', includeTV.toString());
                localStorage.setItem('includeVOD', includeVOD.toString());
                setStep('playlist-name');
            } else {
                // Mensagens de erro específicas
                const errorMessage = result.error || 'Falha na autenticação';
                console.error('Login failed:', errorMessage);

                // Melhorar mensagem para erros comuns
                if (errorMessage.includes('fetch') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
                    setError('❌ Não foi possível conectar ao servidor. Verifique:\n• URL do servidor está correta\n• Servidor está online\n• Sua conexão com internet');
                } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('authentication')) {
                    setError('❌ Usuário ou senha incorretos. Verifique suas credenciais.');
                } else if (errorMessage.includes('timeout')) {
                    setError('⏱️ Tempo esgotado. O servidor demorou muito para responder.');
                } else {
                    setError(`❌ Erro: ${errorMessage}`);
                }
            }
        } catch (err: any) {
            console.error('Login exception:', err);

            // Log detalhado do erro
            const errorDetails = {
                message: err?.message,
                name: err?.name,
                stack: err?.stack
            };
            console.error('Error details:', errorDetails);

            // Mensagem amigável para o usuário
            if (err?.message?.includes('fetch')) {
                setError('❌ Falha na conexão com o servidor.\n\nVerifique:\n• URL do servidor\n• Conexão com internet\n• Servidor está acessível');
            } else if (err?.message?.includes('timeout')) {
                setError('⏱️ Conexão expirou. O servidor não respondeu a tempo.');
            } else {
                setError(`❌ Erro inesperado: ${err?.message || 'Tente novamente'}\n\nSe o problema persistir, verifique as configurações.`);
            }
        } finally {
            setLoading(false);
        }
    };

    const handlePlaylistNameSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('playlistName', playlistName || 'Minha Playlist');

        // Reload to trigger App.tsx profile selection flow
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
        <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#0c0c0cff', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            <div className="w-full max-w-4xl">
                <div className="flex items-center justify-center gap-3 mb-12">
                    <Tv className="w-8 h-8 text-white" strokeWidth={1.5} />
                    <h1 className="text-3xl text-white" style={{ fontWeight: 500 }}>Playlist Xtream</h1>
                </div>

                {step === 'credentials' && (
                    <form onSubmit={handleCredentialsSubmit} className="space-y-6 max-w-xs mx-auto">
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg text-sm text-left" style={{ whiteSpace: 'pre-line' }}>
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-base font-medium text-gray-400 text-center block">{t('login', 'serverAddress')}</label>
                            <div className="flex items-center justify-center gap-3">
                                <Server className="w-5 h-5 text-gray-500" />
                                <input type="text" required value={formData.url} onChange={(e) => setFormData({ ...formData, url: e.target.value })} className="bg-gray-900 border border-gray-700 rounded-xl py-2.5 px-4 text-white text-center text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" style={{ width: '280px' }} placeholder="http://example.com:8080" disabled={loading} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-base font-medium text-gray-400 text-center block">{t('login', 'username')}</label>
                            <div className="flex items-center justify-center gap-3">
                                <User className="w-5 h-5 text-gray-500" />
                                <input type="text" required value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="bg-gray-900 border border-gray-700 rounded-xl py-2.5 px-4 text-white text-center text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" style={{ width: '280px' }} disabled={loading} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-base font-medium text-gray-400 text-center block">{t('login', 'password')}</label>
                            <div className="flex items-center justify-center gap-3">
                                <Lock className="w-5 h-5 text-gray-500" />
                                <input type="password" required value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="bg-gray-900 border border-gray-700 rounded-xl py-2.5 px-4 text-white text-center text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all" style={{ width: '280px' }} disabled={loading} />
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 flex flex-col items-center">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input type="checkbox" checked={includeTV} onChange={(e) => setIncludeTV(e.target.checked)} className="w-5 h-5 rounded border-2 border-gray-600 bg-gray-900 checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600" style={{ accentColor: '#2563eb' }} disabled={loading} />
                                <span className="text-gray-300 text-base">{t('login', 'includeTV')}</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer">
                                <input type="checkbox" checked={includeVOD} onChange={(e) => setIncludeVOD(e.target.checked)} className="w-5 h-5 rounded border-2 border-gray-600 bg-gray-900 checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600" style={{ accentColor: '#2563eb' }} disabled={loading} />
                                <span className="text-gray-300 text-base">{t('login', 'includeVOD')}</span>
                            </label>
                        </div>

                        <div className="flex justify-center items-center pt-6" style={{ gap: '18px' }}>
                            <button type="button" onClick={handleBack} className="hover:scale-105 hover:shadow-lg active:scale-95 transition-all duration-200 flex items-center gap-2" style={{ backgroundColor: '#232427ff', color: 'white', borderRadius: '8px', padding: '13px 24px', fontSize: '16px', fontWeight: 500, border: 'none', cursor: 'pointer' }} disabled={loading}>
                                <ArrowLeft className="w-5 h-5" />
                                {t('login', 'back')}
                            </button>

                            <button type="submit" className="bg-gray-200 text-gray-900 hover:bg-white hover:scale-105 hover:shadow-xl active:scale-95 transition-all duration-200 flex items-center gap-2" style={{ backgroundColor: loading ? '#4a4a4a' : '#e5e7eb', color: loading ? '#9ca3af' : '#111827', borderRadius: '8px', padding: '13px 24px', fontSize: '16px', fontWeight: 500, border: 'none', cursor: loading ? 'not-allowed' : 'pointer' }} disabled={loading}>
                                {loading ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />
                                        {t('login', 'authenticating')}
                                    </>
                                ) : (
                                    <>
                                        <LogIn className="w-5 h-5" />
                                        {t('login', 'loginButton')}
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                )}

                {step === 'playlist-name' && (
                    <div className="relative flex justify-center">
                        <form onSubmit={handlePlaylistNameSubmit} className="space-y-8">
                            <label className="text-xl font-medium text-white text-center block">{t('login', 'playlistNameLabel')}</label>

                            <div className="flex justify-center">
                                <div className="flex items-center gap-3">
                                    <Play className="w-5 h-5 text-gray-500" />
                                    <input
                                        type="text"
                                        value={playlistName}
                                        onChange={(e) => setPlaylistName(e.target.value)}
                                        className="bg-gray-900 border border-gray-700 rounded-xl py-2.5 px-4 text-white text-center text-base focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                                        style={{ width: '320px' }}
                                        placeholder={t('login', 'playlistPlaceholder')}
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <div className="flex justify-center items-center pt-4" style={{ gap: '18px' }}>
                                <button
                                    type="button"
                                    onClick={handleBack}
                                    className="hover:scale-105 hover:shadow-lg hover:bg-gray-700 active:scale-95 transition-all duration-200 flex items-center gap-2"
                                    style={{ backgroundColor: '#232427ff', color: 'white', borderRadius: '8px', padding: '13px 24px', fontSize: '16px', fontWeight: 500, border: 'none', cursor: 'pointer' }}
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                    {t('login', 'back')}
                                </button>

                                <button
                                    type="submit"
                                    className="bg-gray-200 text-gray-900 hover:bg-white hover:scale-105 hover:shadow-xl active:scale-95 transition-all duration-200 flex items-center gap-2"
                                    style={{ borderRadius: '8px', padding: '13px 24px', fontSize: '16px', fontWeight: 500, border: 'none', cursor: 'pointer' }}
                                >
                                    <Play className="w-5 h-5" />
                                    {t('login', 'continueButton')}
                                </button>
                            </div>
                        </form>

                        <div className="absolute left-1/2 top-12 bg-gradient-to-br from-gray-800/60 to-gray-900/60 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-5 min-w-[220px] shadow-xl" style={{ transform: 'translateX(200px)', animation: 'fadeSlideIn 0.5s ease-out' }}>
                            <div className="text-gray-300 text-sm font-semibold mb-4 text-center tracking-wide">{t('login', 'library')}</div>

                            {loadingCounts ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="w-6 h-6 border-2 border-gray-500 border-t-blue-500 rounded-full animate-spin" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {includeTV && (
                                        <div className="flex items-center gap-3 p-3 bg-blue-600/10 rounded-xl border border-blue-600/20 hover:bg-blue-600/20 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/20 transition-all duration-300 cursor-pointer group" style={{ animation: 'slideInLeft 0.6s ease-out' }}>
                                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg group-hover:shadow-blue-500/50 group-hover:scale-110 transition-all duration-300" style={{ animation: 'pulse 2s ease-in-out infinite' }}>
                                                <Tv className="w-5 h-5 text-white group-hover:scale-110 transition-transform duration-300" />
                                            </div>
                                            <div className="flex-1 flex items-baseline gap-2">
                                                <div className="text-2xl font-bold text-white group-hover:text-blue-300 transition-colors duration-300" style={{ animation: 'countUp 1s ease-out' }}>{counts.live}</div>
                                                <div className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors duration-300">{t('login', 'channels')}</div>
                                            </div>
                                        </div>
                                    )}

                                    {includeVOD && (
                                        <>
                                            <div className="flex items-center gap-3 p-3 bg-purple-600/10 rounded-xl border border-purple-600/20 hover:bg-purple-600/20 hover:scale-105 hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300 cursor-pointer group" style={{ animation: 'slideInLeft 0.7s ease-out' }}>
                                                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg group-hover:shadow-purple-500/50 group-hover:scale-110 transition-all duration-300" style={{ animation: 'pulse 2s ease-in-out infinite 0.3s' }}>
                                                    <Film className="w-5 h-5 text-white group-hover:scale-110 transition-transform duration-300" />
                                                </div>
                                                <div className="flex-1 flex items-baseline gap-2">
                                                    <div className="text-2xl font-bold text-white group-hover:text-purple-300 transition-colors duration-300" style={{ animation: 'countUp 1.2s ease-out' }}>{counts.vod}</div>
                                                    <div className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors duration-300">{t('login', 'moviesCount')}</div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 p-3 bg-green-600/10 rounded-xl border border-green-600/20 hover:bg-green-600/20 hover:scale-105 hover:shadow-lg hover:shadow-green-500/20 transition-all duration-300 cursor-pointer group" style={{ animation: 'slideInLeft 0.8s ease-out' }}>
                                                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center shadow-lg group-hover:shadow-green-500/50 group-hover:scale-110 transition-all duration-300" style={{ animation: 'pulse 2s ease-in-out infinite 0.6s' }}>
                                                    <PlaySquare className="w-5 h-5 text-white group-hover:scale-110 transition-transform duration-300" />
                                                </div>
                                                <div className="flex-1 flex items-baseline gap-2">
                                                    <div className="text-2xl font-bold text-white group-hover:text-green-300 transition-colors duration-300" style={{ animation: 'countUp 1.4s ease-out' }}>{counts.series}</div>
                                                    <div className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors duration-300">{t('login', 'seriesCount')}</div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        <style>{`
              @keyframes fadeSlideIn {
                from {
                  opacity: 0;
                  transform: translateX(200px) translateY(-10px);
                }
                to {
                  opacity: 1;
                  transform: translateX(200px) translateY(0);
                }
              }
              
              @keyframes slideInLeft {
                from {
                  opacity: 0;
                  transform: translateX(-20px);
                }
                to {
                  opacity: 1;
                  transform: translateX(0);
                }
              }
              
              @keyframes pulse {
                0%, 100% {
                  transform: scale(1);
                }
                50% {
                  transform: scale(1.05);
                }
              }
              
              @keyframes countUp {
                from {
                  opacity: 0;
                  transform: translateY(10px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
            `}</style>
                    </div>
                )}
            </div>
        </div>
    );
}
