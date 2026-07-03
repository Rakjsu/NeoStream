import { useEffect } from 'react';
import { tvModeService } from '../services/tvModeService';
import { pickSpatialTarget, type NavRect, type NavDirection } from '../utils/spatialNav';

/**
 * TV mode phase 2: arrow keys move focus geometrically between focusable
 * elements (cards, buttons, nav), Backspace goes back. Active ONLY while TV
 * mode is on, and stands down whenever something more specific owns the keys
 * (inputs, the video player, open overlays that preventDefault).
 */

const FOCUSABLE_SELECTOR =
    'button, [role="button"], a[href], input, select, [tabindex]:not([tabindex="-1"])';

const ARROWS: Record<string, NavDirection> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right'
};

function isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
    );
}

function visibleCandidates(): HTMLElement[] {
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => {
        if (el.offsetParent === null) return false; // display:none subtree
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        // Keep a generous band around the viewport so scrolling rows work.
        return rect.bottom > -200 && rect.top < viewportH + 200 && rect.right > 0 && rect.left < viewportW;
    });
}

export function useSpatialNavigation(): void {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!tvModeService.isEnabled()) return;
            if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
            if (isTyping(e.target)) return;
            // The player and its overlays own the arrows while mounted.
            if (document.querySelector('.video-player-container, .mpv-view-backdrop, .gsearch-overlay')) return;

            if (e.key === 'Backspace') {
                e.preventDefault();
                window.history.back();
                return;
            }

            const direction = ARROWS[e.key];
            if (!direction) return;

            const candidates = visibleCandidates();
            const current = document.activeElement as HTMLElement | null;
            const currentRect: NavRect = current && candidates.includes(current)
                ? current.getBoundingClientRect()
                // Nothing focused: seed from the viewport's top-left corner.
                : { left: 0, top: 0, right: 8, bottom: 8 };

            const pool = candidates.filter(el => el !== current);
            const index = pickSpatialTarget(currentRect, pool.map(el => el.getBoundingClientRect()), direction);
            if (index >= 0) {
                e.preventDefault();
                pool[index].focus();
                pool[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);
}
