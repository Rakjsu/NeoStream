import { useEffect, useRef } from 'react';
import { FRAME_STEP_SEC } from './playerExtras';

interface PlayerKeyboardControls {
    togglePlay: () => void;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
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
    onToggleNormalize
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

        switch (e.key.toLowerCase()) {
            case ' ':
            case 'k':
                e.preventDefault();
                controls.togglePlay();
                break;
            case 'arrowleft':
            case 'j':
                e.preventDefault();
                // Shift pula 30s — feito pra varrer gravações e VOD longos.
                controls.seek(Math.max(0, currentTime - (e.shiftKey ? 30 : 10)));
                break;
            case 'arrowright':
            case 'l':
                e.preventDefault();
                controls.seek(Math.min(duration, currentTime + (e.shiftKey ? 30 : 10)));
                break;
            case ',':
            case '.':
                if (onFrameStep) {
                    e.preventDefault();
                    onFrameStep(e.key === ',' ? -FRAME_STEP_SEC : FRAME_STEP_SEC);
                }
                break;
            case 'i':
                if (onToggleStats) {
                    e.preventDefault();
                    onToggleStats();
                }
                break;
            case 'x':
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
            case 'b':
                if (onCycleAbLoop) {
                    e.preventDefault();
                    onCycleAbLoop();
                }
                break;
            case 's':
                if (onScreenshot) {
                    e.preventDefault();
                    onScreenshot();
                }
                break;
            case 'v':
                if (onCycleVideoFilter) {
                    e.preventDefault();
                    onCycleVideoFilter();
                }
                break;
            case 'n':
                if (onToggleNormalize) {
                    e.preventDefault();
                    onToggleNormalize();
                }
                break;
            case 'arrowup':
                e.preventDefault();
                controls.setVolume(Math.min(1, volume + 0.1));
                break;
            case 'arrowdown':
                e.preventDefault();
                controls.setVolume(Math.max(0, volume - 0.1));
                break;
            case 'm':
                e.preventDefault();
                controls.toggleMute();
                break;
            case 'f':
                e.preventDefault();
                if (!document.fullscreenElement) {
                    containerRef.current?.requestFullscreen();
                } else {
                    document.exitFullscreen();
                }
                break;
            case 'c':
                // The CC button runs an async fetch flow; the shortcut only
                // toggles visibility when a subtitle is already loaded.
                if (vttContent) {
                    setSubtitlesEnabled(prev => !prev);
                }
                break;
            case 'escape':
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else if (onClose) {
                    onClose();
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
