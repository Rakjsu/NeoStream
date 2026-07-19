// 📺 Item 32: lembrete que troca de canal sozinho — quando um lembrete de
// programa dispara (e o recurso está ligado em Configurações → Reprodução),
// este toast mostra uma contagem de 10s com Cancelar; sem intervenção, o app
// navega pra TV ao vivo e sintoniza o canal (via pending em sessionStorage,
// consumido pelo LiveTV assim que a lista de canais estiver pronta).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../services/languageService';

export const PENDING_TUNE_KEY = 'neostream_pending_tune';
const COUNTDOWN_S = 10;

interface PendingTune {
    streamId: number;
    channelName: string;
    title: string;
}

export function ReminderAutoTuneToast() {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const [pending, setPending] = useState<PendingTune | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_S);

    useEffect(() => {
        const onFire = (event: Event) => {
            const detail = (event as CustomEvent).detail as PendingTune | undefined;
            if (!detail || !detail.streamId) return;
            setPending(detail);
            setSecondsLeft(COUNTDOWN_S);
        };
        window.addEventListener('reminder:autotune', onFire);
        return () => window.removeEventListener('reminder:autotune', onFire);
    }, []);

    useEffect(() => {
        if (!pending) return;
        const timer = window.setInterval(() => setSecondsLeft(prev => prev - 1), 1000);
        return () => window.clearInterval(timer);
    }, [pending]);

    const tune = (target: PendingTune) => {
        setPending(null);
        try {
            sessionStorage.setItem(PENDING_TUNE_KEY, String(target.streamId));
        } catch { /* modo privado: sem pending, só navega */ }
        navigate('/dashboard/live');
        // LiveTV já montada consome na hora; senão, consome ao carregar os canais.
        window.dispatchEvent(new Event('live:tune-pending'));
    };

    useEffect(() => {
        if (!pending || secondsLeft > 0) return;
        queueMicrotask(() => tune(pending));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [secondsLeft, pending]);

    if (!pending) return null;

    return (
        <div
            style={{
                position: 'fixed', right: 20, bottom: 20, zIndex: 9000,
                background: 'rgba(15, 15, 30, 0.96)', border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 14, padding: '14px 18px', maxWidth: 340,
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)', color: 'white',
            }}
        >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>🔔 {pending.title}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 10 }}>
                {t('notifications', 'autoTuneIn')
                    .replace('{channel}', pending.channelName)
                    .replace('{s}', String(Math.max(0, secondsLeft)))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                    onClick={() => setPending(null)}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'transparent', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                    {t('notifications', 'autoTuneCancel')}
                </button>
                <button
                    onClick={() => tune(pending)}
                    style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--ns-accent, #7c3aed)', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                    {t('notifications', 'autoTuneNow')}
                </button>
            </div>
        </div>
    );
}
