import { useEffect } from 'react';

/**
 * Couch-mode navigation with a gamepad (Xbox/PS layout via the Gamepad API).
 *
 * Two modes, decided per input by what's on screen:
 *  - An overlay is open (video player, detail modal, zap list): buttons are
 *    translated into synthetic keyboard events, so the overlays' existing
 *    keyboard handling (arrows/Enter/Esc/PgUp/PgDn) drives them.
 *  - Otherwise (browsing grids/menus): the D-pad moves REAL focus spatially
 *    between interactive elements, A clicks the focused one, B goes back.
 *
 * Mapping (standard layout): D-pad/left stick = navigate · A(0) = select ·
 * B(1) = back/Esc · LB(4)/RB(5) = PgUp/PgDn (live zapping) · Start(9) = Space.
 */

const POLL_MS = 90;
const AXIS_THRESHOLD = 0.6;
const REPEAT_MS = 220;

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), .hover-preview-card';

function overlayOpen(): boolean {
    return !!document.querySelector('.video-player-container, [data-overlay="modal"]');
}

function sendKey(key: string) {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    (document.activeElement || document.body).dispatchEvent(ev);
    // Handlers bound to window/document via bubbling get it from the dispatch
    // above; also dispatch on window for listeners attached there directly.
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function isVisible(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

/** Move focus to the nearest interactive element in the given direction. */
function moveFocus(dir: 'up' | 'down' | 'left' | 'right') {
    const current = (document.activeElement instanceof HTMLElement && document.activeElement !== document.body)
        ? document.activeElement
        : null;
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
    if (candidates.length === 0) return;

    if (!current || !isVisible(current)) {
        focusEl(candidates[0]);
        return;
    }

    const cur = current.getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of candidates) {
        if (el === current) continue;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const dx = x - cx;
        const dy = y - cy;
        // Must lie in the direction's half-plane.
        if (dir === 'up' && dy >= -4) continue;
        if (dir === 'down' && dy <= 4) continue;
        if (dir === 'left' && dx >= -4) continue;
        if (dir === 'right' && dx <= 4) continue;
        // Distance along the axis + heavy penalty for lateral offset.
        const along = (dir === 'up' || dir === 'down') ? Math.abs(dy) : Math.abs(dx);
        const lateral = (dir === 'up' || dir === 'down') ? Math.abs(dx) : Math.abs(dy);
        const score = along + lateral * 2.5;
        if (score < bestScore) {
            bestScore = score;
            best = el;
        }
    }
    if (best) focusEl(best);
}

function focusEl(el: HTMLElement) {
    if (!el.hasAttribute('tabindex') && !(el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
        el.setAttribute('tabindex', '-1');
    }
    document.querySelectorAll('.gp-focus').forEach(n => n.classList.remove('gp-focus'));
    el.classList.add('gp-focus');
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function useGamepadNavigation() {
    useEffect(() => {
        let raf = 0;
        let lastPoll = 0;
        // Per-input timestamps for edge/repeat detection.
        const lastFire: Record<string, number> = {};

        const fire = (input: string, now: number, fn: () => void, repeat = false) => {
            const prev = lastFire[input] ?? 0;
            if (prev === 0 || (repeat && now - prev > REPEAT_MS)) {
                lastFire[input] = now;
                fn();
            }
        };
        const release = (input: string) => { lastFire[input] = 0; };

        const act = (dir: 'up' | 'down' | 'left' | 'right') => {
            if (overlayOpen()) {
                sendKey(dir === 'up' ? 'ArrowUp' : dir === 'down' ? 'ArrowDown' : dir === 'left' ? 'ArrowLeft' : 'ArrowRight');
            } else {
                moveFocus(dir);
            }
        };

        const poll = (now: number) => {
            raf = requestAnimationFrame(poll);
            if (now - lastPoll < POLL_MS) return;
            lastPoll = now;

            const pads = navigator.getGamepads?.() ?? [];
            const pad = Array.from(pads).find(p => p && p.connected);
            if (!pad) return;

            const b = (i: number) => !!pad.buttons[i]?.pressed;
            const axisX = pad.axes[0] ?? 0;
            const axisY = pad.axes[1] ?? 0;

            const up = b(12) || axisY < -AXIS_THRESHOLD;
            const down = b(13) || axisY > AXIS_THRESHOLD;
            const left = b(14) || axisX < -AXIS_THRESHOLD;
            const right = b(15) || axisX > AXIS_THRESHOLD;

            if (up) fire('up', now, () => act('up'), true); else release('up');
            if (down) fire('down', now, () => act('down'), true); else release('down');
            if (left) fire('left', now, () => act('left'), true); else release('left');
            if (right) fire('right', now, () => act('right'), true); else release('right');

            // A: select — click the focused element while browsing, Enter in overlays.
            if (b(0)) {
                fire('a', now, () => {
                    if (overlayOpen()) {
                        sendKey('Enter');
                    } else if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
                        document.activeElement.click();
                    }
                });
            } else release('a');

            // B: back.
            if (b(1)) fire('b', now, () => sendKey('Escape')); else release('b');

            // LB/RB: channel zap (PgUp/PgDn — the live player listens).
            if (b(4)) fire('lb', now, () => sendKey('PageUp')); else release('lb');
            if (b(5)) fire('rb', now, () => sendKey('PageDown')); else release('rb');

            // Start: play/pause (space).
            if (b(9)) fire('start', now, () => sendKey(' ')); else release('start');
        };

        raf = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(raf);
    }, []);
}
