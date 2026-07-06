import { useState, useEffect } from 'react';

/**
 * A small, always-mounted "Transmitindo na TV" pill (app root, page-independent).
 * It also gives the cast-reconnect capability a home: on startup it asks the
 * main process to re-adopt a Chromecast session that survived an app restart
 * (only the Default Media Receiver — never hijacks Netflix/YouTube). The full
 * transport controls stay in the player's CastControls; this is just presence
 * + a quick Stop, visible from any screen.
 */
export function GlobalCastIndicator() {
    const [device, setDevice] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Resume control of a cast still running after a restart (best-effort).
        void window.ipcRenderer.invoke('cast:reconnect').catch(() => undefined);

        const poll = async () => {
            const result = await window.ipcRenderer.invoke('cast:get-status').catch(() => null) as
                { success?: boolean; active?: boolean; deviceName?: string } | null;
            if (cancelled) return;
            setDevice(result?.success && result.active ? (result.deviceName || 'Chromecast') : null);
        };
        void poll();
        const id = setInterval(() => void poll(), 3000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    if (!device) return null;

    const stop = () => {
        void window.ipcRenderer.invoke('cast:stop').catch(() => undefined);
        setDevice(null);
    };

    return (
        <div style={{
            position: 'fixed', bottom: 16, left: 16, zIndex: 9998,
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 12,
            background: 'rgba(15, 15, 35, 0.95)', border: '1px solid rgba(var(--ns-accent-rgb), 0.5)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)', color: 'white', fontSize: 13,
        }}>
            <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                📡 {device}
            </span>
            <button
                onClick={stop}
                title="Parar transmissão"
                style={{ background: 'rgba(239, 68, 68, 0.7)', border: 'none', borderRadius: 8, padding: '4px 9px', cursor: 'pointer', color: 'white' }}
            >
                ⏹
            </button>
        </div>
    );
}
