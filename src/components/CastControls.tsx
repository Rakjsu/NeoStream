/**
 * CastControls — mini remote shown while a DLNA cast session is active.
 * Polls dlna:get-status every 2s for state/position/volume; detects when
 * the TV stops and notifies the parent.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, Volume2, Tv } from 'lucide-react';
import { castControls, type CastStatus } from '../hooks/useDLNA';
import { formatTime } from '../utils/videoHelpers';

interface CastControlsProps {
    deviceId: string;
    deviceName: string;
    onSessionEnded: () => void;
}

const POLL_INTERVAL_MS = 2000;
// After seek/play/pause the TV repositions and may report STOPPED or refuse
// status calls for several seconds — suppress session-ended detection during
// this window so the remote doesn't vanish mid-seek.
const COMMAND_GRACE_MS = 12000;
const STOPPED_POLLS_TO_END = 4;
const FAILED_POLLS_TO_END = 6;

export function CastControls({ deviceId, deviceName, onSessionEnded }: CastControlsProps) {
    const [status, setStatus] = useState<CastStatus | null>(null);
    const [pendingVolume, setPendingVolume] = useState<number | null>(null);
    const stoppedPolls = useRef(0);
    const failedPolls = useRef(0);
    // 0 = "treat mount time as the first command" — set on mount effect below.
    const lastCommandAt = useRef(0);
    const endedRef = useRef(false);

    const endSession = useCallback(() => {
        if (endedRef.current) return;
        endedRef.current = true;
        onSessionEnded();
    }, [onSessionEnded]);

    const markCommand = () => {
        lastCommandAt.current = Date.now();
        stoppedPolls.current = 0;
        failedPolls.current = 0;
    };

    useEffect(() => {
        let cancelled = false;
        // Grace window also covers the cast start (TV still buffering).
        if (lastCommandAt.current === 0) lastCommandAt.current = Date.now();

        const poll = async () => {
            const inGrace = Date.now() - lastCommandAt.current < COMMAND_GRACE_MS;
            try {
                const result = await castControls.getStatus();
                if (cancelled) return;
                if (!result.success) {
                    // Session explicitly cleared in the main process — end now.
                    if (/no active cast session/i.test(result.error || '')) {
                        endSession();
                        return;
                    }
                    // Transient SOAP failure (TV busy seeking/buffering):
                    // tolerate several in a row before giving up.
                    if (!inGrace && ++failedPolls.current >= FAILED_POLLS_TO_END) {
                        endSession();
                    }
                    return;
                }
                failedPolls.current = 0;
                setStatus({
                    state: result.state || 'UNKNOWN',
                    position: result.position || 0,
                    duration: result.duration || 0,
                    volume: result.volume ?? null,
                    title: result.title || '',
                    deviceId: result.deviceId || deviceId,
                });

                // TV reports STOPPED/NO_MEDIA for several consecutive polls →
                // the user stopped it on the TV side or playback finished.
                // Ignored during the post-command grace window (seek causes a
                // transient STOPPED while the TV repositions the stream).
                if (/STOPPED|NO_MEDIA/i.test(result.state || '')) {
                    if (!inGrace && ++stoppedPolls.current >= STOPPED_POLLS_TO_END) {
                        endSession();
                    }
                } else {
                    stoppedPolls.current = 0;
                }
            } catch {
                // IPC failure — keep trying; transient errors are common
                // while the TV transitions between streams.
            }
        };

        poll();
        const interval = setInterval(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [deviceId, endSession]);

    const isPlaying = /PLAYING|TRANSITIONING/i.test(status?.state || '');
    const duration = status?.duration || 0;
    const position = status?.position || 0;
    const volume = pendingVolume ?? status?.volume ?? null;

    const handleTogglePlay = async () => {
        markCommand();
        if (isPlaying) await castControls.pause();
        else await castControls.resume();
    };

    const handleSeek = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const seconds = Number(event.target.value);
        markCommand();
        setStatus(prev => prev ? { ...prev, position: seconds } : prev);
        await castControls.seek(seconds);
    };

    const handleVolume = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const level = Number(event.target.value);
        setPendingVolume(level);
        await castControls.setVolume(level);
        setPendingVolume(null);
    };

    const handleStop = async () => {
        await castControls.stop(deviceId);
        endSession();
    };

    return (
        <div style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            borderRadius: 14,
            background: 'rgba(15, 15, 35, 0.95)',
            border: '1px solid rgba(var(--ns-accent-rgb), 0.5)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            color: 'white',
            minWidth: 420,
            maxWidth: '90vw'
        }}>
            <Tv size={18} color="var(--ns-accent)" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0, flexShrink: 1 }}>
                <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 140
                }}>
                    {status?.title || 'Transmitindo'}
                </div>
                <div style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>{deviceName}</div>
            </div>

            <button
                onClick={handleTogglePlay}
                title={isPlaying ? 'Pausar' : 'Reproduzir'}
                style={{
                    background: 'rgba(var(--ns-accent-rgb), 0.8)',
                    border: 'none',
                    borderRadius: 8,
                    padding: 8,
                    cursor: 'pointer',
                    display: 'flex',
                    color: 'white',
                    flexShrink: 0
                }}
            >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>

            {/* Seek (hidden for live content where duration is 0) */}
            {duration > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 120 }}>
                    <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{formatTime(position)}</span>
                    <input
                        type="range"
                        min={0}
                        max={Math.max(1, Math.floor(duration))}
                        value={Math.floor(position)}
                        onChange={handleSeek}
                        style={{ flex: 1, height: 4, cursor: 'pointer', accentColor: 'var(--ns-accent)' }}
                    />
                    <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{formatTime(duration)}</span>
                </div>
            ) : (
                <div style={{ flex: 1, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
                    {status ? 'AO VIVO' : 'Conectando...'}
                </div>
            )}

            {volume !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <Volume2 size={14} color="#9ca3af" />
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={volume}
                        onChange={handleVolume}
                        style={{ width: 64, height: 4, cursor: 'pointer', accentColor: 'var(--ns-accent)' }}
                    />
                </div>
            )}

            <button
                onClick={handleStop}
                title="Parar transmissão"
                style={{
                    background: 'rgba(239, 68, 68, 0.7)',
                    border: 'none',
                    borderRadius: 8,
                    padding: 8,
                    cursor: 'pointer',
                    display: 'flex',
                    color: 'white',
                    flexShrink: 0
                }}
            >
                <Square size={14} />
            </button>
        </div>
    );
}
