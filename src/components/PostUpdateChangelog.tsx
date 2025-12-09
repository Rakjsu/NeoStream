import { useState, useEffect } from 'react';

interface PostUpdateChangelogProps {
    // No props needed, it manages its own state
}

export function PostUpdateChangelog({ }: PostUpdateChangelogProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [previousVersion, setPreviousVersion] = useState<string>('');

    useEffect(() => {
        // Check if this is first launch after update
        const lastVersion = localStorage.getItem('lastAppVersion');
        const currentVersion = __APP_VERSION__;

        if (lastVersion && lastVersion !== currentVersion) {
            // Version changed - show changelog
            setPreviousVersion(lastVersion);
            setIsVisible(true);
        }

        // Always update stored version
        localStorage.setItem('lastAppVersion', currentVersion);
    }, []);

    const handleClose = () => {
        setIsVisible(false);
    };

    if (!isVisible) return null;

    return (
        <>
            <style>{changelogStyles}</style>

            {/* Backdrop */}
            <div className="changelog-backdrop" onClick={handleClose} />

            {/* Modal */}
            <div className="changelog-modal">
                {/* Header */}
                <div className="changelog-header">
                    <div className="changelog-icon">🎉</div>
                    <div>
                        <h3>Atualização Instalada!</h3>
                        <p className="changelog-version">
                            v{previousVersion} → v{__APP_VERSION__}
                        </p>
                    </div>
                    <button className="changelog-close" onClick={handleClose}>✕</button>
                </div>

                {/* Content */}
                <div className="changelog-content">
                    <h4>✨ Novidades nesta versão:</h4>

                    <div className="changelog-section">
                        <h5>🔄 Sistema de Atualização</h5>
                        <ul>
                            <li>Notificação visual quando há atualizações</li>
                            <li>Modal mostrando versão atual vs nova</li>
                            <li>Barra de progresso durante download</li>
                            <li>Instalação automática opcional</li>
                        </ul>
                    </div>

                    <div className="changelog-section">
                        <h5>📥 Downloads & Offline</h5>
                        <ul>
                            <li>Baixe filmes e séries para assistir offline</li>
                            <li>Nova página de gerenciamento de downloads</li>
                            <li>Indicador de espaço utilizado</li>
                        </ul>
                    </div>

                    <div className="changelog-section">
                        <h5>🐛 Correções</h5>
                        <ul>
                            <li>Corrigido erro 404 durante downloads</li>
                            <li>Melhorada compatibilidade com servidores</li>
                        </ul>
                    </div>
                </div>

                {/* Footer */}
                <div className="changelog-footer">
                    <button className="changelog-btn" onClick={handleClose}>
                        <span>👍</span>
                        Entendi, vamos lá!
                    </button>
                </div>
            </div>
        </>
    );
}

const changelogStyles = `
.changelog-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    z-index: 9998;
    animation: changelogFadeIn 0.3s ease;
}

@keyframes changelogFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.changelog-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 480px;
    max-height: 80vh;
    overflow-y: auto;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 24px;
    padding: 24px;
    z-index: 9999;
    box-shadow: 
        0 25px 50px -12px rgba(0, 0, 0, 0.5),
        0 0 60px rgba(16, 185, 129, 0.2);
    animation: changelogSlideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes changelogSlideUp {
    from { 
        opacity: 0;
        transform: translate(-50%, -40%);
    }
    to { 
        opacity: 1;
        transform: translate(-50%, -50%);
    }
}

.changelog-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
}

.changelog-icon {
    width: 56px;
    height: 56px;
    background: linear-gradient(135deg, #10b981, #059669);
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
    animation: changelogBounce 0.6s ease;
}

@keyframes changelogBounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
}

.changelog-header h3 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: white;
}

.changelog-version {
    margin: 4px 0 0 0;
    font-size: 14px;
    color: #10b981;
    font-weight: 600;
}

.changelog-close {
    margin-left: auto;
    width: 32px;
    height: 32px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 16px;
    cursor: pointer;
    transition: all 0.2s;
}

.changelog-close:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
}

.changelog-content {
    margin-bottom: 24px;
}

.changelog-content h4 {
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
}

.changelog-section {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
}

.changelog-section h5 {
    margin: 0 0 10px 0;
    font-size: 14px;
    font-weight: 600;
    color: #10b981;
}

.changelog-section ul {
    margin: 0;
    padding-left: 20px;
}

.changelog-section li {
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    line-height: 1.8;
}

.changelog-footer {
    display: flex;
    justify-content: center;
}

.changelog-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 14px 24px;
    background: linear-gradient(135deg, #10b981, #059669);
    border: none;
    border-radius: 12px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
    box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
}

.changelog-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(16, 185, 129, 0.4);
}
`;
