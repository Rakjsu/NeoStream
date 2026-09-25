import { useEffect } from 'react';
import { languageService } from '../services/languageService';
import { ehJanelaSecundaria } from '../utils/janelaSecundaria';

/**
 * Native "recording finished" notification. The main process broadcasts
 * 'dvr:stopped' when ffmpeg finalizes a recording (manual ⏹, scheduled stop
 * or the stream ending); this always-mounted bridge turns it into a Windows
 * notification — essential in tray mode, where the app window is hidden.
 * Clicking it opens the Downloads page (where the Gravações list lives).
 *
 * O 'dvr:stopped' é BROADCAST (todas as BrowserWindows), e o PiP e o
 * multi-view montam o App inteiro — esta ponte inclusive. Sem a guarda,
 * cada janela aberta virava mais uma notificação e mais um espelho no
 * celular (D119). O player da janela segue ouvindo o evento por conta própria.
 */
export function DvrNotifyBridge() {
    useEffect(() => {
        if (ehJanelaSecundaria()) return;
        const handler = (_event: unknown, raw: unknown) => {
            const payload = (raw ?? {}) as { file?: string; seconds?: number; error?: string };
            if (payload.error) return; // ffmpeg failures already surface in the player UI
            const file = typeof payload.file === 'string' ? payload.file : '';
            const name = file.split(/[\\/]/).pop()?.replace(/\.ts$/i, '') ?? '';
            if (!name) return;

            const secs = typeof payload.seconds === 'number' && Number.isFinite(payload.seconds) ? payload.seconds : 0;
            const mins = Math.floor(secs / 60);
            const duration = mins >= 60
                ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
                : `${mins} min`;

            const t = (key: string) => languageService.t('notifications', key);
            void window.ipcRenderer.invoke('notify:show', {
                title: `📼 ${t('dvrFinishedTitle')}`,
                body: t('dvrFinishedBody').replace('{name}', name).replace('{duration}', duration),
                route: '/dashboard/downloads',
            }).catch((err: unknown) => console.warn('[DVR] notify:show failed:', err));
            // 🔔 Espelha no app do celular pareado (no-op sem app conectado).
            void window.ipcRenderer.invoke('web-remote:notify-mobile', {
                title: `📼 ${t('dvrFinishedTitle')}`,
                body: t('dvrFinishedBody').replace('{name}', name).replace('{duration}', duration),
            }).catch(() => undefined);
        };
        window.ipcRenderer.on('dvr:stopped', handler);
        return () => window.ipcRenderer.off('dvr:stopped', handler);
    }, []);

    return null;
}
