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

export function CastControls({ deviceId, deviceName, onSessionEnded }: CastControlsProps) {
    const [status, setStatus] = useState<CastStatus | null>(null);
    const [pendingVolume, setPendingVolume] = useState<number | null>(null);
    const stoppedPolls = useRef(0);
    const endedRef = useRef(false);

    const endSession = useCallback(() => {
        if (endedRef.current) return;
        endedRef.current = true;
        onSessionEnded();
    }, [onSessionEnded]);

    useEffect(() => {
        let cancelled = false;

        const poll = async () => {
            try {
                const result = await castControls.getStatus();
                if (cancelled) return;
                if (!result.success) {
                    // Session gone in the main process (stop, error, app logic).
                    endSession();
                    return;
                }
                setStatus({
                    state: result.state || 'UNKNOWN',
                    position: result.position || 0,
                    duration: result.duration || 0,
                    volume: result.volume ?? null,
                    title: result.title || '',
                    deviceId: result.deviceId || deviceId,
                });

                // TV reports STOPPED/NO_MEDIA for a few consecutive polls →
                // the user stopped it on the TV side or playback finished.
                if (/STOPPED|NO_MEDIA/i.test(result.state || '')) {
                    stoppedPolls.current += 1;
                    if (stoppedPolls.current >= 3) endSession();
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
        if (isPlaying) await castControls.pause();
        else await castControls.resume();
    };

    const handleSeek = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const seconds = Number(event.target.value);
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
            border: '1px solid rgba(139, 92, 246, 0.5)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            color: 'white',
            minWidth: 420,
            maxWidth: '90vw'
        }}>
            <Tv size={18} color="#8b5cf6" style={{ flexShrink: 0 }} />
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
                    background: 'rgba(139, 92, 246, 0.8)',
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
                        style={{ flex: 1, height: 4, cursor: 'pointer', accentColor: '#8b5cf6' }}
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
                        style={{ width: 64, height: 4, cursor: 'pointer', accentColor: '#8b5cf6' }}
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
