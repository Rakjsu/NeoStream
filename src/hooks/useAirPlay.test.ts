import { describe, it, expect } from 'vitest';
import { mapAirplayStatus } from './useAirPlay';

describe('mapAirplayStatus (item 25 — transporte AirPlay no desktop)', () => {
    it('sem sessão ativa vira o erro que o CastControls entende como fim', () => {
        expect(mapAirplayStatus(null)).toEqual({ success: false, error: 'No active cast session' });
        expect(mapAirplayStatus({ success: false })).toEqual({ success: false, error: 'No active cast session' });
        expect(mapAirplayStatus({ success: true, active: false })).toEqual({ success: false, error: 'No active cast session' });
    });

    it('sessão tocando mapeia pro shape do mini-remoto', () => {
        const status = mapAirplayStatus({
            success: true,
            active: true,
            playing: true,
            position: 42.5,
            duration: 3600,
            title: 'Filme',
            deviceId: 'Apple-TV._airplay._tcp.local',
            deviceName: 'Apple TV',
        });
        expect(status).toMatchObject({
            success: true,
            state: 'PLAYING',
            position: 42.5,
            duration: 3600,
            title: 'Filme',
            deviceId: 'Apple-TV._airplay._tcp.local',
        });
        // Protocolo sem volume — null esconde o slider.
        expect(status.volume).toBeNull();
        expect(status.queue).toEqual([]);
        expect(status.subtitleAvailable).toBe(false);
    });

    it('pausado vira PAUSED_PLAYBACK e campos ausentes têm defaults seguros', () => {
        const status = mapAirplayStatus({ success: true, active: true, playing: false });
        expect(status.state).toBe('PAUSED_PLAYBACK');
        expect(status.position).toBe(0);
        expect(status.duration).toBe(0);
        expect(status.title).toBe('');
        expect(status.deviceId).toBe('airplay');
    });
});
