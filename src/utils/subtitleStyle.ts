/**
 * Estilo da legenda externa (tamanho/fundo/cor), persistido e aplicado no
 * SubtitleOverlay. PURO — parse validado e mapa pra CSS.
 */
export interface SubtitleStyle {
    size: 'small' | 'medium' | 'large';
    background: 'dark' | 'none' | 'solid';
    color: 'white' | 'yellow';
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = { size: 'medium', background: 'dark', color: 'white' };

const SIZES = new Set(['small', 'medium', 'large']);
const BACKGROUNDS = new Set(['dark', 'none', 'solid']);
const COLORS = new Set(['white', 'yellow']);

export function loadSubtitleStyle(raw: string | null): SubtitleStyle {
    if (!raw) return { ...DEFAULT_SUBTITLE_STYLE };
    try {
        const parsed = JSON.parse(raw) as Partial<SubtitleStyle>;
        return {
            size: SIZES.has(parsed.size as string) ? parsed.size as SubtitleStyle['size'] : DEFAULT_SUBTITLE_STYLE.size,
            background: BACKGROUNDS.has(parsed.background as string) ? parsed.background as SubtitleStyle['background'] : DEFAULT_SUBTITLE_STYLE.background,
            color: COLORS.has(parsed.color as string) ? parsed.color as SubtitleStyle['color'] : DEFAULT_SUBTITLE_STYLE.color,
        };
    } catch {
        return { ...DEFAULT_SUBTITLE_STYLE };
    }
}

export function subtitleCss(style: SubtitleStyle): { fontSize: string; backgroundColor: string; color: string } {
    return {
        fontSize: style.size === 'small' ? '1.1rem' : style.size === 'large' ? '1.8rem' : '1.4rem',
        backgroundColor: style.background === 'none' ? 'transparent'
            : style.background === 'solid' ? 'rgba(0, 0, 0, 0.85)'
            : 'rgba(0, 0, 0, 0.5)',
        color: style.color === 'yellow' ? '#fde047' : 'white',
    };
}
