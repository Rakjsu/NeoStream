/**
 * Custom Subtitle Overlay Component
 * Renders subtitles from VTT content in sync with video playback
 * Works around native <track> element issues with HLS streams
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';

interface SubtitleCue {
    startTime: number;  // in seconds
    endTime: number;    // in seconds
    text: string;
}

interface SubtitleOverlayProps {
    vttContent: string | null;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    enabled: boolean;
}

/**
 * Parse VTT timestamp to seconds
 * Format: HH:MM:SS.mmm or MM:SS.mmm
 */
function parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':');
    if (parts.length === 3) {
        // HH:MM:SS.mmm
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        const seconds = parseFloat(parts[2]);
        return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
        // MM:SS.mmm
        const minutes = parseInt(parts[0], 10);
        const seconds = parseFloat(parts[1]);
        return minutes * 60 + seconds;
    }
    return 0;
}

/**
 * Parse VTT content into array of cues
 */
function parseVTT(vttContent: string): SubtitleCue[] {
    const cues: SubtitleCue[] = [];
    const lines = vttContent.split('\n');

    let i = 0;
    // Skip header
    while (i < lines.length && !lines[i].includes('-->')) {
        i++;
    }

    while (i < lines.length) {
        const line = lines[i].trim();

        // Look for timestamp line (contains -->)
        if (line.includes('-->')) {
            const [startStr, endStr] = line.split('-->').map(s => s.trim().split(' ')[0]);
            const startTime = parseTimestamp(startStr);
            const endTime = parseTimestamp(endStr);

            // Collect text lines until empty line or next cue
            const textLines: string[] = [];
            i++;
            while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
                const textLine = lines[i].trim();
                // Skip cue numbers
                if (!/^\d+$/.test(textLine)) {
                    textLines.push(textLine);
                }
                i++;
            }

            if (textLines.length > 0) {
                cues.push({
                    startTime,
                    endTime,
                    text: textLines.join('\n')
                });
            }
        } else {
            i++;
        }
    }

    return cues;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
    vttContent,
    videoRef,
    enabled
}) => {
    const [currentText, setCurrentText] = useState<string>('');

    // Parse VTT content once when it changes
    const cues = useMemo(() => {
        if (!vttContent) return [];
        const parsed = parseVTT(vttContent);
        console.log(`📝 Parsed ${parsed.length} subtitle cues`);
        return parsed;
    }, [vttContent]);

    // Find and display the correct cue based on current time
    const updateSubtitle = useCallback(() => {
        if (!videoRef.current || cues.length === 0) {
            setCurrentText('');
            return;
        }

        const currentTime = videoRef.current.currentTime;

        // Find matching cue (binary search would be more efficient for large files)
        const activeCue = cues.find(cue =>
            currentTime >= cue.startTime && currentTime <= cue.endTime
        );

        setCurrentText(activeCue?.text || '');
    }, [cues, videoRef]);

    // Listen to video timeupdate event
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !enabled) {
            setCurrentText('');
            return;
        }

        // Update on timeupdate
        video.addEventListener('timeupdate', updateSubtitle);

        // Also update on seeking
        video.addEventListener('seeked', updateSubtitle);

        // Initial update
        updateSubtitle();

        return () => {
            video.removeEventListener('timeupdate', updateSubtitle);
            video.removeEventListener('seeked', updateSubtitle);
        };
    }, [videoRef, enabled, updateSubtitle]);

    // Don't render if no content or disabled
    if (!enabled || !currentText) {
        return null;
    }

    return (
        <div
            style={{
                position: 'absolute',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                maxWidth: '80%',
                padding: '6px 14px',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                borderRadius: '4px',
                color: 'white',
                fontSize: '1.4rem',
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
