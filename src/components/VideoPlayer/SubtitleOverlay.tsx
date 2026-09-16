/**
 * Custom Subtitle Overlay Component
 * Renders subtitles from VTT content in sync with video playback
 * Works around native <track> element issues with HLS streams
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DEFAULT_SUBTITLE_STYLE, subtitleCss, type SubtitleStyle } from '../../utils/subtitleStyle';
import { lerCuesDoVtt } from './legendaVtt';

interface SubtitleOverlayProps {
    vttContent: string | null;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    enabled: boolean;
    /** Sync adjustment in seconds: positive shows subtitles LATER. */
    offsetSeconds?: number;
    /** Estilo (tamanho/fundo/cor) escolhido no menu ⚙️ do player. */
    styleConfig?: SubtitleStyle;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
    vttContent,
    videoRef,
    enabled,
    offsetSeconds = 0,
    styleConfig
}) => {
    const [currentText, setCurrentText] = useState<string>('');

    // Parse VTT content once when it changes
    const cues = useMemo(() => {
        if (!vttContent) return [];
        const parsed = lerCuesDoVtt(vttContent);
                return parsed;
    }, [vttContent]);

    // Find and display the correct cue based on current time
    const updateSubtitle = useCallback(() => {
        if (!videoRef.current || cues.length === 0) {
            setCurrentText('');
            return;
        }

        // Positive offset delays the subtitles (cue matches later video time).
        const currentTime = videoRef.current.currentTime - offsetSeconds;

        // Find matching cue (binary search would be more efficient for large files)
        const activeCue = cues.find(cue =>
            currentTime >= cue.startTime && currentTime <= cue.endTime
        );

        setCurrentText(activeCue?.text || '');
    }, [cues, videoRef, offsetSeconds]);

    // Listen to video timeupdate event
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !enabled) {
            queueMicrotask(() => setCurrentText(''));
            return;
        }

        // Update on timeupdate
        video.addEventListener('timeupdate', updateSubtitle);

        // Also update on seeking
        video.addEventListener('seeked', updateSubtitle);

        // Initial update
        queueMicrotask(updateSubtitle);

        return () => {
            video.removeEventListener('timeupdate', updateSubtitle);
            video.removeEventListener('seeked', updateSubtitle);
        };
    }, [videoRef, enabled, updateSubtitle]);

    // Don't render if no content or disabled
    if (!enabled || !currentText) {
        return null;
    }

    const css = subtitleCss(styleConfig ?? DEFAULT_SUBTITLE_STYLE);

    return (
        <div
            style={{
                position: 'absolute',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                maxWidth: '80%',
                padding: '6px 14px',
                backgroundColor: css.backgroundColor,
                borderRadius: '4px',
                color: css.color,
                fontSize: css.fontSize,
                fontWeight: 600,
                textAlign: 'center',
                textShadow: '1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000, 0 0 8px rgba(0,0,0,0.9)',
                zIndex: 100,
                pointerEvents: 'none',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.3,
                // Fade in/out animation
                transition: 'opacity 0.15s ease-in-out',
            }}
        >
            {currentText}
        </div>
    );
};

export default SubtitleOverlay;
