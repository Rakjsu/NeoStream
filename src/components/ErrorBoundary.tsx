import { Component, type ErrorInfo, type ReactNode } from 'react';
import { languageService } from '../services/languageService';
import { reportRendererError } from '../services/rendererErrorReport';

/**
 * Per-page error boundary. A render crash in one page shows a themed fallback
 * (keeping the sidebar/layout intact) instead of taking down the whole app.
 *
 * O React engole o erro ANTES do `window.onerror`, então o relato tem que
 * partir daqui, explicitamente: o `componentDidCatch` chama o
 * `reportRendererError`. Antes ele só fazia `console.error` — e o comentário
 * afirmava que a ponte do renderer levava dali pro main.log, o que nunca foi
 * verdade (a ponte só escuta `error` e `unhandledrejection`, e ninguém
 * sobrescreve o console). A única classe de erro que já tem tela de aviso era
 * justamente a que não aparecia em relatório nenhum.
 *
 * Auto-resets when `resetKey` changes (pass the route pathname) so navigating
 * away from a crashed page clears the error without a manual retry.
 */
interface ErrorBoundaryProps {
    /** Human label for the area (shown in logs), e.g. the page name. */
    name: string;
    /** When this value changes, the boundary clears its error (e.g. route path). */
    resetKey?: string;
    children: ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidUpdate(prevProps: ErrorBoundaryProps) {
        // Clear the error when the reset key changes (navigation).
        if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack);
        // Explícito: o console não é ponte pra lugar nenhum.
        reportRendererError(
            `[ErrorBoundary:${this.props.name}] ${error.message}`,
            error.stack || info.componentStack || undefined,
        );
    }

    private handleRetry = () => this.setState({ error: null });

    private handleHome = () => {
        this.setState({ error: null });
        window.location.hash = '#/dashboard/home';
    };

    render() {
        if (!this.state.error) return this.props.children;

        // Componente de classe: sem hook. O `languageService.t` é o mesmo
        // caminho que o DvrNotifyBridge e o episodeNotificationService já usam
        // fora de React. A tela de crash não precisa reagir à troca de idioma.
        const t = (key: string) => languageService.t('errorBoundary', key);

        return (
            <>
                <style>{errorBoundaryStyles}</style>
                <div className="eb-screen">
                    <div className="eb-card">
                        <div className="eb-icon">⚠️</div>
                        <h2 className="eb-title">{t('title')}</h2>
                        <p className="eb-msg">{t('hint')}</p>
                        <p className="eb-detail">{this.state.error.message}</p>
                        <div className="eb-actions">
                            <button className="eb-btn eb-btn-primary" onClick={this.handleRetry}>
                                {t('retry')}
                            </button>
                            <button className="eb-btn" onClick={this.handleHome}>
                                {t('home')}
                            </button>
                        </div>
                    </div>
                </div>
            </>
        );
    }
}

const errorBoundaryStyles = `
.eb-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    padding: 32px;
}
.eb-card {
    max-width: 420px;
    width: 100%;
    text-align: center;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 36px 28px;
}
.eb-icon { font-size: 44px; }
.eb-title {
    color: #fff;
    font-size: 20px;
    font-weight: 700;
    margin: 14px 0 8px;
}
.eb-msg {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 12px;
}
.eb-detail {
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    font-family: monospace;
    word-break: break-word;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 8px;
    padding: 8px 10px;
    margin: 0 0 20px;
}
.eb-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
}
.eb-btn {
    padding: 10px 18px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
}
.eb-btn:hover { background: rgba(255, 255, 255, 0.1); }
.eb-btn-primary {
    border: none;
    background: linear-gradient(135deg, var(--ns-accent), var(--ns-accent-grad-to));
}
.eb-btn-primary:hover { transform: scale(1.04); }
`;
