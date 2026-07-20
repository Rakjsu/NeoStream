// Pure helpers for the D62 player extras (volume boost, A-B loop, frame
// step) — kept free of DOM/React so vitest covers the tricky edges.

/** Volume boost options shown in the gear menu (1 = normal 100%). */
export const BOOST_OPTIONS = [1, 1.5, 2, 3] as const;

/** Clamps a WebAudio gain multiplier to the supported 100%–300% range. */
export function clampBoost(mult: number): number {
    if (!Number.isFinite(mult)) return 1;
    return Math.min(3, Math.max(1, mult));
}

export interface AbLoopState {
    a: number | null;
    b: number | null;
}

/**
 * One key cycles the A-B loop: 1st press marks A, 2nd press marks B (a press
 * before A just re-marks A), 3rd press clears the loop.
 */
export function cycleAbState(state: AbLoopState, currentTime: number): AbLoopState {
    const t = Math.max(0, currentTime);
    if (state.a === null) return { a: t, b: null };
    if (state.b === null) {
        return t > state.a ? { a: state.a, b: t } : { a: t, b: null };
    }
    return { a: null, b: null };
}

/** Where to seek to enforce the loop, or null when no jump is needed. */
export function abLoopTarget(currentTime: number, state: AbLoopState): number | null {
    if (state.a === null || state.b === null) return null;
    return currentTime >= state.b ? state.a : null;
}

/** Seconds one frame step moves — assumes ~30fps (no fps metadata exposed). */
export const FRAME_STEP_SEC = 1 / 30;

// 🎨 Filtros de vídeo (tecla V): presets de CSS filter aplicados no <video>.
export interface VideoFilterPreset {
    id: string;
    css: string;
}

export const VIDEO_FILTERS: VideoFilterPreset[] = [
    { id: 'normal', css: 'none' },
    { id: 'vivid', css: 'saturate(1.3) contrast(1.08)' },
    { id: 'cinema', css: 'saturate(0.92) contrast(1.06) brightness(0.97)' },
    { id: 'night', css: 'brightness(0.8) contrast(1.02)' },
];

export function filterCssOf(id: string): string {
    return VIDEO_FILTERS.find(preset => preset.id === id)?.css ?? 'none';
}

/** Próximo preset no ciclo (id desconhecido volta pro início). */
export function nextVideoFilter(id: string): VideoFilterPreset {
    const index = VIDEO_FILTERS.findIndex(preset => preset.id === id);
    return VIDEO_FILTERS[(index + 1) % VIDEO_FILTERS.length];
}

/** 🖼️ Item 31: bucket de cache do preview (agrupa hovers em janelas de 10s). PURO. */
export function previewBucket(timeSec: number, bucketS = 10): number {
    if (!Number.isFinite(timeSec) || timeSec < 0) return -1;
    return Math.floor(timeSec / bucketS);
}

/** Ponto de seek de um bucket (o meio da janela — frame representativo). PURO. */
export function previewSeekTarget(bucket: number, bucketS = 10): number {
    return bucket * bucketS + bucketS / 2;
}
