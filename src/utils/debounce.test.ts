import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from './debounce'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('debounce', () => {
    it('invokes once with the last arguments after the delay', () => {
        const fn = vi.fn()
        const debounced = debounce(fn, 300)

        debounced('a')
        debounced('ab')
        debounced('abc')
        expect(fn).not.toHaveBeenCalled()

        vi.advanceTimersByTime(299)
        expect(fn).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn).toHaveBeenCalledWith('abc')
    })

    it('fires again for calls after the delay window', () => {
        const fn = vi.fn()
        const debounced = debounce(fn, 100)

        debounced(1)
        vi.advanceTimersByTime(100)
        debounced(2)
        vi.advanceTimersByTime(100)

        expect(fn).toHaveBeenCalledTimes(2)
        expect(fn).toHaveBeenNthCalledWith(1, 1)
        expect(fn).toHaveBeenNthCalledWith(2, 2)
    })

    it('cancel() drops the pending call', () => {
        const fn = vi.fn()
        const debounced = debounce(fn, 100)

        debounced('x')
        debounced.cancel()
        vi.advanceTimersByTime(500)

        expect(fn).not.toHaveBeenCalled()
    })
})
