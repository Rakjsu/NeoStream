import { useState } from 'react';
import { useLanguage } from '../../services/languageService';

export function AboutSection() {
    const { t } = useLanguage();

    // Legal modals
    const [showTermsModal, setShowTermsModal] = useState(false);
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);

    return (
        <>
            <div className="section-card">
                <div className="section-header">
                    <div className="section-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>ℹ️</div>
                    <div>
                        <h2>{t('about', 'title')}</h2>
                        <p>{t('about', 'description')}</p>
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
                    <p className="app-version">{t('about', 'version')} {__APP_VERSION__}</p>
                    <p className="app-description">
                        {t('about', 'appDescription')}
                    </p>
                    <div className="about-links">
                        <button
                            onClick={() => setShowTermsModal(true)}
                            className="about-link"
                        >
                            📄 {t('about', 'termsOfUse')}
                        </button>
                        <button
                            onClick={() => setShowPrivacyModal(true)}
                            className="about-link"
                        >
                            🔒 {t('about', 'privacyPolicy')}
                        </button>
                        <a href="mailto:suporte@neostream.app" className="about-link">💬 {t('about', 'support')}</a>
                    </div>
                </div>
            </div>

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
                                <strong style={{ color: '#10b981' }}>📅 Última atualização:</strong> <span style={{ color: 'white' }}>09 de Dezembro de 2025</span>
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
        </>
    );
}
