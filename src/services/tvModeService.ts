/**
 * TV mode (10-foot UI), phase 1: scales the whole UI up (~1.25×) and
 * strengthens the keyboard/gamepad focus ring so the app is usable from the
 * couch. Applied via a root class + Chromium's CSS zoom.
 */

const STORAGE_KEY = 'neostream_tv_mode';
export const TV_MODE_ZOOM = 1.25;

export const tvModeService = {
    isEnabled(): boolean {
        try {
            return localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    },

    setEnabled(enabled: boolean): void {
        try {
            localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
        } catch { /* best-effort */ }
        this.apply();
    },

    /** Apply the current setting to the document (call at boot and on toggle). */
    apply(): void {
        const enabled = this.isEnabled();
        document.documentElement.classList.toggle('tv-mode', enabled);
        // Chromium honors non-standard CSS zoom — scales layout, not just paint.
        (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = enabled ? String(TV_MODE_ZOOM) : '';
    }
};
