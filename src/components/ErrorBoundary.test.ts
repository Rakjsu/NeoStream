import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ErrorInfo } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { diagnosticsService } from '../services/diagnosticsService';
import { resetRendererErrorCount } from '../services/rendererErrorReport';

describe('ErrorBoundary', () => {
    it('getDerivedStateFromError captures the error into state', () => {
        const err = new Error('boom');
        expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
    });

    it('clears the error when resetKey changes (navigation)', () => {
        const eb = new ErrorBoundary({ name: 'X', resetKey: 'b', children: null });
        eb.state = { error: new Error('boom') };
        const setState = vi.fn();
        eb.setState = setState as unknown as typeof eb.setState;

        eb.componentDidUpdate({ name: 'X', resetKey: 'a', children: null });
        expect(setState).toHaveBeenCalledWith({ error: null });
    });

    it('does NOT clear when resetKey is unchanged', () => {
        const eb = new ErrorBoundary({ name: 'X', resetKey: 'a', children: null });
        eb.state = { error: new Error('boom') };
        const setState = vi.fn();
        eb.setState = setState as unknown as typeof eb.setState;

        eb.componentDidUpdate({ name: 'X', resetKey: 'a', children: null });
        expect(setState).not.toHaveBeenCalled();
    });

    it('does nothing when there is no error', () => {
        const eb = new ErrorBoundary({ name: 'X', resetKey: 'b', children: null });
        eb.state = { error: null };
        const setState = vi.fn();
        eb.setState = setState as unknown as typeof eb.setState;

        eb.componentDidUpdate({ name: 'X', resetKey: 'a', children: null });
        expect(setState).not.toHaveBeenCalled();
    });
});

/**
 * 🧾 Crash de tela tem que entrar no relatório.
 *
 * O `componentDidCatch` fazia `console.error` e o comentário dizia que a ponte
 * do renderer levava dali para o `main.log`. Não levava: a ponte só escuta
 * `error` e `unhandledrejection`, e o React engole o erro de render antes dos
 * dois — ninguém sobrescreve o console. Ou seja, a única classe de erro que já
 * tem tela de aviso era justamente a que não aparecia em relatório nenhum.
 */
describe('ErrorBoundary: o crash chega ao relatório', () => {
    beforeEach(() => {
        resetRendererErrorCount();
        diagnosticsService._resetBuffer();
        vi.spyOn(console, 'error').mockImplementation(() => { /* silencia o log do teste */ });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('componentDidCatch registra no anel de diagnóstico', () => {
        const eb = new ErrorBoundary({ name: 'Downloads', children: null });

        eb.componentDidCatch(new Error('boom'), { componentStack: '\n  at Downloads' } as ErrorInfo);

        const entradas = diagnosticsService.getBreadcrumbs();
        expect(entradas).toHaveLength(1);
        expect(entradas[0].level).toBe('error');
        // O nome da área entra na mensagem: é o que diz QUAL tela quebrou.
        expect(entradas[0].message).toContain('Downloads');
        expect(entradas[0].message).toContain('boom');
    });

    it('e manda pro main.log pela ponte do preload', () => {
        const send = vi.fn();
        (window as unknown as { ipcRenderer?: { send: typeof send } }).ipcRenderer = { send };

        const eb = new ErrorBoundary({ name: 'VOD', children: null });
        eb.componentDidCatch(new Error('quebrou'), { componentStack: '' } as ErrorInfo);

        expect(send).toHaveBeenCalledWith('log:renderer', expect.objectContaining({
            level: 'error',
            message: expect.stringContaining('VOD'),
        }));
        delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    });
});
