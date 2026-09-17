import { diagnosticsService } from './diagnosticsService';

/**
 * Leva um erro do renderer para o `main.log` e para o relatório de diagnóstico.
 *
 * Morava dentro do `src/main.tsx`, ligada só aos dois ouvintes globais
 * (`error` e `unhandledrejection`). O problema é que o React **engole** o erro
 * de render antes de qualquer um dos dois: o `componentDidCatch` do
 * `ErrorBoundary` chamava `console.error` e o comentário dizia que a ponte do
 * renderer pegava dali — não pegava, e ninguém sobrescreve o `console`. Ou
 * seja: a única classe de erro que já tem tela de aviso era justamente a que
 * não aparecia em lugar nenhum.
 *
 * Fica num serviço para o boundary poder chamar sem importar o `main.tsx`
 * (que monta o app no import).
 */

/** Teto de envios: um laço de erro não pode inundar o arquivo de log. */
const REPORT_LIMIT = 20;
let reportedErrors = 0;

export function reportRendererError(message: string, stack?: string, level: 'error' | 'warn' = 'error'): void {
    // O anel de diagnóstico é barato e nunca é persistido sozinho — só entra
    // numa exportação quando o usuário liga a opção.
    try {
        diagnosticsService.record({ time: new Date().toISOString(), level, message });
    } catch {
        // Buffer indisponível — ignora.
    }

    if (reportedErrors >= REPORT_LIMIT) return;
    reportedErrors += 1;
    try {
        window.ipcRenderer?.send('log:renderer', { level, message, stack });
    } catch {
        // Sem a ponte do preload (testes, por exemplo) — nada a fazer.
    }
}

/** Só para teste: zera o teto entre casos. */
export function resetRendererErrorCount(): void {
    reportedErrors = 0;
}
