import { describe, it, expect, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

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
