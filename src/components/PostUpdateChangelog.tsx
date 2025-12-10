import { useState, useEffect } from 'react';

interface ChangelogEntry {
    icon: string;
    title: string;
    items: string[];
}

interface VersionChangelog {
    [version: string]: ChangelogEntry[];
}

// Changelogs for each version
const changelogs: VersionChangelog = {
    '2.4.9': [
        {
            icon: '🏠',
            title: 'Acesso Rápido Expandido',
            items: [
                'Novos atalhos: Minha Lista, Favoritos, Baixados',
                'Grid expandido para 7 itens na Home',
                'Navegação mais rápida entre seções',
            ]
        },
        {
            icon: '⚙️',
            title: 'Configurações Reorganizadas',
            items: [
                'Removida seção Aparência (não funcional)',
                'Idioma movido para seção Atualizações',
                'Layout mais limpo e organizado',
            ]
        },
        {
            icon: '✨',
            title: 'Animações Premium',
            items: [
                'Efeito shimmer na barra de busca',
                'Glow pulsante no logo da sidebar',
                'Animações mais suaves e elegantes',
            ]
        },
    ],
    '2.4.8': [
        {
            icon: '📺',
            title: 'Próximo Episódio Inteligente',
            items: [
                'Auto-seleção do próximo episódio quando atual >90% completo',
                'Toggle "Auto-play próximo episódio" nas configurações',
                'Se desativado, próximo ep carrega mas fica pausado',
            ]
        },
        {
            icon: '🎬',
            title: 'Codificador de Vídeo',
            items: [
                'Seleção de codec preferido (H.264, H.265, VP9)',
                'Player prioriza streams com codec selecionado',
            ]
        },
        {
            icon: '🔤',
            title: 'Legendas no Player',
            items: [
                'Botão de legendas (CC) nos controles',
                'Changelog dinâmico por versão',
            ]
        },
    ],
    '2.4.7': [
        {
            icon: '🎬',
            title: 'Correções do Player',
            items: [
                'Corrigido player reinicializando múltiplas vezes',
                'Corrigido vídeo "voltando no tempo" ao retomar',
                'Melhorada estabilidade do sistema de resume',
            ]
        },
        {
            icon: '🧠',
            title: 'Buffer Inteligente',
            items: [
                'Sistema adaptativo baseado na velocidade da conexão',
                'Menos travamentos em conexões instáveis',
            ]
        },
    ],
    '2.4.6': [
        {
            icon: '🧠',
            title: 'Buffer Inteligente',
            items: [
                'Novo sistema de buffer adaptativo',
                'Detecta velocidade da conexão automaticamente',
                'Otimiza reprodução para sua internet',
            ]
        },
    ],
    '2.4.5': [
        {
            icon: '🔄',
            title: 'Sistema de Atualização',
            items: [
                'Corrigido modal de atualização aparecendo em loop',
                'Melhorada detecção de versão disponível',
            ]
        },
    ],
    '2.4.4': [
        {
            icon: '🔄',
            title: 'Auto-Update',
            items: [
                'Corrigido download de atualizações',
                'Melhor tratamento de erros de rede',
            ]
        },
    ],
    'default': [
        {
            icon: '🔄',
            title: 'Sistema de Atualização',
            items: [
                'Notificação visual quando há atualizações',
                'Modal mostrando versão atual vs nova',
                'Barra de progresso durante download',
                'Instalação automática opcional',
            ]
        },
        {
            icon: '📥',
            title: 'Downloads & Offline',
            items: [
                'Baixe filmes e séries para assistir offline',
                'Nova página de gerenciamento de downloads',
                'Indicador de espaço utilizado',
            ]
        },
        {
            icon: '🐛',
            title: 'Correções',
            items: [
                'Corrigido erro 404 durante downloads',
                'Melhorada compatibilidade com servidores',
            ]
        },
    ],
};

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

    // Get changelog for current version, fallback to default
    const currentChangelog = changelogs[__APP_VERSION__] || changelogs['default'];

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
                    <h4>✨ Novidades na v{__APP_VERSION__}:</h4>

                    {currentChangelog.map((section, index) => (
                        <div key={index} className="changelog-section">
                            <h5>{section.icon} {section.title}</h5>
                            <ul>
                                {section.items.map((item, itemIndex) => (
                                    <li key={itemIndex}>{item}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
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
