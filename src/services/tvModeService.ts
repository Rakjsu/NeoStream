/**
 * TV mode (10-foot UI), phase 1: scales the whole UI up (~1.25×) and
 * strengthens the keyboard/gamepad focus ring so the app is usable from the
 * couch. Applied via a root class + Chromium's CSS zoom.
 *
 * O `zoom` do body tem UM dono só: a regra `body` do index.css, que
 * multiplica a Escala da interface (`--ns-ui-scale`, do themeService) por
 * `--ns-tv-zoom` (daqui). Escrever `body.style.zoom` inline venceria a folha
 * de estilo e deixava o seletor de escala morto com o Modo TV ligado (D129).
 */

const STORAGE_KEY = 'neostream_tv_mode';
export const TV_MODE_ZOOM = 1.25;
/** Fator do Modo TV, lido pelo `body { zoom }` do index.css. */
const TV_ZOOM_VAR = '--ns-tv-zoom';

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
        // Chromium honors CSS zoom — scales layout, not just paint. Aqui só a
        // variável: quem aplica é o CSS, multiplicando pela Escala da interface.
        const root = document.documentElement.style;
        if (enabled) root.setProperty(TV_ZOOM_VAR, String(TV_MODE_ZOOM));
        else root.removeProperty(TV_ZOOM_VAR);
    }
};
