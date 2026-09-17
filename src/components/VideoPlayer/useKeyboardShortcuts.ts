import { useEffect, useRef } from 'react';
import { alvoDoEscape } from './escapeDoPlayer';
import { FRAME_STEP_SEC } from './playerExtras';
import { keymapService } from '../../services/keymapService';

interface PlayerKeyboardControls {
    togglePlay: () => void;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
}

/** Sobreposições que o Escape fecha ANTES de derrubar o filme. */
export interface SobreposicoesDoPlayer {
    ajustes: boolean;
    marcadores: boolean;
    qr: boolean;
    fechar: (alvo: 'ajustes' | 'marcadores' | 'qr') => void;
}

export interface UseKeyboardShortcutsParams {
    showDeviceSelector: boolean;
    controls: PlayerKeyboardControls;
    currentTime: number;
    duration: number;
    volume: number;
    containerRef: React.RefObject<HTMLDivElement | null>;
    vttContent: string | null;
    setSubtitlesEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    onClose?: () => void;
    /** Frame step (,/.) — the player mutates the <video> element itself. */
    onFrameStep?: (deltaSec: number) => void;
    onToggleStats?: () => void;
    onCycleAbLoop?: () => void;
    /** 🔖 X marca a posição atual; Shift+X abre o painel de marcadores. */
    onAddBookmark?: () => void;
    onToggleBookmarks?: () => void;
    onScreenshot?: () => void;
    onCycleVideoFilter?: () => void;
    onToggleNormalize?: () => void;
    /** Sem isto, o Escape continua derrubando o player com o menu aberto. */
    sobreposicoes?: SobreposicoesDoPlayer;
}

// Keyboard shortcuts — the latest handler lives in a ref so a single
// stable document listener is attached for the whole player lifetime.
export function useKeyboardShortcuts({
    showDeviceSelector,
    controls,
    currentTime,
    duration,
    volume,
    containerRef,
    vttContent,
    setSubtitlesEnabled,
    onClose,
    onFrameStep,
    onToggleStats,
    onCycleAbLoop,
    onAddBookmark,
    onToggleBookmarks,
    onScreenshot,
    onCycleVideoFilter,
    onToggleNormalize,
    sobreposicoes
}: UseKeyboardShortcutsParams) {
    const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => { });
    // Intentional render-time ref update (same as the original inline code in
    // VideoPlayer): the handler must never be stale, while the document
    // listener below stays attached exactly once.
    // eslint-disable-next-line react-hooks/refs
    handleKeyDownRef.current = (e: KeyboardEvent) => {
        // Ignore keystrokes aimed at form fields or editable content
        const target = e.target as HTMLElement | null;
        if (target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable
        )) return;

        // Ignore while the cast device selector modal is open
        if (showDeviceSelector) return;

        const key = e.key.toLowerCase();

        // Teclas estruturais fixas (não personalizáveis).
        switch (key) {
            case ',':
            case '.':
                if (onFrameStep) {
                    e.preventDefault();
                    onFrameStep(key === ',' ? -FRAME_STEP_SEC : FRAME_STEP_SEC);
                }
                return;
            case 'arrowup':
                e.preventDefault();
                controls.setVolume(Math.min(1, volume + 0.1));
                return;
            case 'arrowdown':
                e.preventDefault();
                controls.setVolume(Math.max(0, volume - 0.1));
                return;
            case 'escape': {
                // Ordem de prioridade em vez de "fullscreen ou tchau": ver
                // escapeDoPlayer.ts. Antes, Esc com o menu da engrenagem
                // aberto fechava o FILME.
                const alvo = alvoDoEscape({
                    ajustes: sobreposicoes?.ajustes ?? false,
                    marcadores: sobreposicoes?.marcadores ?? false,
                    qr: sobreposicoes?.qr ?? false,
                    fullscreen: Boolean(document.fullscreenElement),
                    podeFechar: Boolean(onClose),
                });
                if (alvo === 'fullscreen') document.exitFullscreen();
                else if (alvo === 'fechar') onClose?.();
                else if (alvo !== 'nada') sobreposicoes?.fechar(alvo);
                return;
            }
        }

        // Demais ações resolvidas pelo keymap (letras personalizáveis no "?").
        const action = keymapService.getKeyToAction()[key];
        if (!action) return;
        switch (action) {
            case 'togglePlay':
                e.preventDefault();
                controls.togglePlay();
                break;
            case 'seekBack':
                e.preventDefault();
                // Shift pula 30s — feito pra varrer gravações e VOD longos.
                controls.seek(Math.max(0, currentTime - (e.shiftKey ? 30 : 10)));
                break;
            case 'seekForward':
                e.preventDefault();
                controls.seek(Math.min(duration, currentTime + (e.shiftKey ? 30 : 10)));
                break;
            case 'stats':
                if (onToggleStats) {
                    e.preventDefault();
                    onToggleStats();
                }
                break;
            case 'bookmark':
                if (e.shiftKey) {
                    if (onToggleBookmarks) {
                        e.preventDefault();
                        onToggleBookmarks();
                    }
                } else if (onAddBookmark) {
                    e.preventDefault();
                    onAddBookmark();
                }
                break;
            case 'abLoop':
                if (onCycleAbLoop) {
                    e.preventDefault();
                    onCycleAbLoop();
                }
                break;
            case 'screenshot':
                if (onScreenshot) {
                    e.preventDefault();
                    onScreenshot();
                }
                break;
            case 'videoFilter':
                if (onCycleVideoFilter) {
                    e.preventDefault();
                    onCycleVideoFilter();
                }
                break;
            case 'normalize':
                if (onToggleNormalize) {
                    e.preventDefault();
                    onToggleNormalize();
                }
                break;
            case 'mute':
                e.preventDefault();
                controls.toggleMute();
                break;
            case 'fullscreen':
                e.preventDefault();
                if (!document.fullscreenElement) {
                    containerRef.current?.requestFullscreen();
                } else {
                    document.exitFullscreen();
                }
                break;
            case 'subtitles':
                // The CC button runs an async fetch flow; the shortcut only
                // toggles visibility when a subtitle is already loaded.
                if (vttContent) {
                    setSubtitlesEnabled(prev => !prev);
                }
                break;
        }
    };

    useEffect(() => {
        const listener = (e: KeyboardEvent) => handleKeyDownRef.current(e);
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, []);
}
