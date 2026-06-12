// Theme Service - app appearance (background variant + accent color preset)
//
// The app is a hand-styled dark UI. Theming works by setting CSS custom
// properties (--ns-*) on <html> that high-visibility surfaces consume via
// var(). Surfaces not yet migrated keep the classic palette (documented
// limitation shown in Settings > Aparência).

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'neostream_theme';

export type BackgroundVariant = 'default' | 'amoled';
export type AccentId = 'roxo' | 'azul' | 'verde' | 'vermelho' | 'laranja' | 'rosa';

export interface Theme {
    background: BackgroundVariant;
    accent: AccentId;
}

export interface AccentPreset {
    id: AccentId;
    /** translation key under the "appearance" section */
    nameKey: string;
    /** main accent color */
    accent: string;
    /** darker variant (gradient ends, pressed states) */
    dark: string;
    /** lighter variant (hover text/icons) */
    light: string;
    /** companion second gradient stop (accent → gradTo gradients) */
    gradTo: string;
    /** "r, g, b" of accent, for rgba(var(--ns-accent-rgb), a) composition */
    rgb: string;
    /** "r, g, b" of gradTo */
    gradToRgb: string;
}

// Hard-coded preset table. "roxo" mirrors the classic palette exactly
// (#a855f7 → #ec4899 gradients) so the default theme is pixel-identical.
export const ACCENT_PRESETS: readonly AccentPreset[] = [
    { id: 'roxo', nameKey: 'colorPurple', accent: '#a855f7', dark: '#7c3aed', light: '#c4b5fd', gradTo: '#ec4899', rgb: '168, 85, 247', gradToRgb: '236, 72, 153' },
    { id: 'azul', nameKey: 'colorBlue', accent: '#3b82f6', dark: '#1d4ed8', light: '#93c5fd', gradTo: '#06b6d4', rgb: '59, 130, 246', gradToRgb: '6, 182, 212' },
    { id: 'verde', nameKey: 'colorGreen', accent: '#22c55e', dark: '#15803d', light: '#86efac', gradTo: '#14b8a6', rgb: '34, 197, 94', gradToRgb: '20, 184, 166' },
    { id: 'vermelho', nameKey: 'colorRed', accent: '#ef4444', dark: '#b91c1c', light: '#fca5a5', gradTo: '#f97316', rgb: '239, 68, 68', gradToRgb: '249, 115, 22' },
    { id: 'laranja', nameKey: 'colorOrange', accent: '#f97316', dark: '#c2410c', light: '#fdba74', gradTo: '#f59e0b', rgb: '249, 115, 22', gradToRgb: '245, 158, 11' },
    { id: 'rosa', nameKey: 'colorPink', accent: '#ec4899', dark: '#be185d', light: '#f9a8d4', gradTo: '#f43f5e', rgb: '236, 72, 153', gradToRgb: '244, 63, 94' }
];

export interface BackgroundPreset {
    id: BackgroundVariant;
    nameKey: string;
    /** deepest background (page gradients start, sidebar) */
    deep: string;
    /** panel/card background */
    panel: string;
    /** subtle blue-ish tint used as third gradient stop */
    tint: string;
}

export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
    { id: 'default', nameKey: 'backgroundDefault', deep: '#0f0f1a', panel: '#1a1a2e', tint: '#16213e' },
    { id: 'amoled', nameKey: 'backgroundAmoled', deep: '#000000', panel: '#0a0a0f', tint: '#05050a' }
];

export const DEFAULT_THEME: Theme = { background: 'default', accent: 'roxo' };

export function getAccentPreset(id: AccentId): AccentPreset {
    return ACCENT_PRESETS.find(p => p.id === id) ?? ACCENT_PRESETS[0];
}

export function getBackgroundPreset(id: BackgroundVariant): BackgroundPreset {
    return BACKGROUND_PRESETS.find(p => p.id === id) ?? BACKGROUND_PRESETS[0];
}

/** Pure: theme → CSS custom property map (what gets set on <html>). */
export function cssVariablesFor(theme: Theme): Record<string, string> {
    const accent = getAccentPreset(theme.accent);
    const bg = getBackgroundPreset(theme.background);
    return {
        '--ns-accent': accent.accent,
        '--ns-accent-dark': accent.dark,
        '--ns-accent-light': accent.light,
        '--ns-accent-grad-to': accent.gradTo,
        '--ns-accent-rgb': accent.rgb,
        '--ns-accent-grad-to-rgb': accent.gradToRgb,
        '--ns-accent-soft': `rgba(${accent.rgb}, 0.15)`,
        '--ns-accent-glow': `rgba(${accent.rgb}, 0.4)`,
        '--ns-bg-deep': bg.deep,
        '--ns-bg-panel': bg.panel,
        '--ns-bg-tint': bg.tint
    };
}

/** Pure: parse a persisted JSON string back into a valid Theme (or default). */
export function parseStoredTheme(raw: string | null): Theme {
    if (!raw) return { ...DEFAULT_THEME };
    try {
        const parsed = JSON.parse(raw) as Partial<Theme>;
        const background = BACKGROUND_PRESETS.some(b => b.id === parsed.background)
            ? parsed.background as BackgroundVariant
            : DEFAULT_THEME.background;
        const accent = ACCENT_PRESETS.some(a => a.id === parsed.accent)
            ? parsed.accent as AccentId
            : DEFAULT_THEME.accent;
        return { background, accent };
    } catch {
        return { ...DEFAULT_THEME };
    }
}

class ThemeService {
    private theme: Theme;
    private listeners: Set<() => void> = new Set();

    constructor() {
        let raw: string | null = null;
        try {
            raw = localStorage.getItem(STORAGE_KEY);
        } catch {
            // localStorage unavailable (tests/SSR) — fall back to default
        }
        this.theme = parseStoredTheme(raw);
    }

    getTheme(): Theme {
        return { ...this.theme };
    }

    setTheme(partial: Partial<Theme>): void {
        this.theme = { ...this.theme, ...partial };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.theme));
        } catch {
            // best effort persistence
        }
        this.apply();
        this.listeners.forEach(listener => listener());
    }

    /** Set the --ns-* variables + data-theme attribute on <html>. */
    apply(): void {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        const vars = cssVariablesFor(this.theme);
        for (const [name, value] of Object.entries(vars)) {
            root.style.setProperty(name, value);
        }
        root.setAttribute('data-theme', `${this.theme.background}-${this.theme.accent}`);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

export const themeService = new ThemeService();

/** React hook: current theme + setter, re-renders on any theme change. */
export function useTheme() {
    const [theme, setThemeState] = useState<Theme>(themeService.getTheme());

    useEffect(() => {
        return themeService.subscribe(() => setThemeState(themeService.getTheme()));
    }, []);

    return {
        theme,
        setTheme: (partial: Partial<Theme>) => themeService.setTheme(partial)
    };
}
