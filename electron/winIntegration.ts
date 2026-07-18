// 🪟 Integração com a taskbar do Windows: jump list (atalhos de página),
// progresso de download no ícone e botões play/pause na miniatura.
//
// Este módulo registra o PRÓPRIO listener de media:state — o trayMode mantém
// o dele no mesmo canal (o Electron permite vários), o que evita mexer na
// tray pra espelhar o estado aqui.
import { app, ipcMain, nativeImage, BrowserWindow } from 'electron'
import path from 'node:path'

type GetWin = () => BrowserWindow | null

const ROUTE_ARG_PREFIX = '--route='

/** Extrai a rota interna (--route=/dashboard/...) de um argv de relançamento. */
export function routeFromArgv(argv: string[]): string | null {
    for (const arg of argv) {
        if (arg.startsWith(ROUTE_ARG_PREFIX)) {
            const route = arg.slice(ROUTE_ARG_PREFIX.length)
            if (route.startsWith('/dashboard')) return route
        }
    }
    return null
}

/**
 * 📶 Progresso agregado de download no ícone da taskbar.
 * 0–100 mostra a barra; null limpa (fim/cancelamento/erro).
 */
export function setTaskbarProgress(progress: number | null): void {
    if (process.platform !== 'win32') return
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) return
    try {
        win.setProgressBar(progress === null ? -1 : Math.max(0, Math.min(1, progress / 100)))
    } catch { /* taskbar é opcional */ }
}

export function setupWinIntegration(getWin: GetWin): void {
    if (process.platform !== 'win32') return

    // ⚡ Jump list: clique direito no ícone → atalhos das páginas principais.
    // Cada task relança o exe com --route=...; o single-instance lock do main
    // roteia o argv na instância viva via tray:navigate.
    try {
        const exe = process.execPath
        const tasks: { title: string; route: string }[] = [
            { title: '📡 TV ao Vivo', route: '/dashboard/live' },
            { title: '🎬 Filmes', route: '/dashboard/vod' },
            { title: '📺 Séries', route: '/dashboard/series' },
            { title: '📥 Baixados', route: '/dashboard/downloads' },
        ]
        app.setUserTasks(tasks.map(task => ({
            program: exe,
            arguments: `${ROUTE_ARG_PREFIX}${task.route}`,
            iconPath: exe,
            iconIndex: 0,
            title: task.title,
            description: task.title,
        })))
    } catch { /* jump list é opcional */ }

    // ⏯ Botões na miniatura da taskbar, espelhando o media:state do player.
    const iconFor = (name: string) =>
        nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || '', name))
    const icons = {
        play: iconFor('thumbar-play.png'),
        pause: iconFor('thumbar-pause.png'),
        stop: iconFor('thumbar-stop.png'),
    }

    let hasMedia = false
    let playing = false
    const applyThumbar = () => {
        const win = getWin()
        if (!win || win.isDestroyed()) return
        try {
            if (!hasMedia) {
                win.setThumbarButtons([])
                return
            }
            win.setThumbarButtons([
                {
                    tooltip: playing ? 'Pausar' : 'Reproduzir',
                    icon: playing ? icons.pause : icons.play,
                    click: () => { win.webContents.send('media:control', 'togglePlay') },
                },
                {
                    tooltip: 'Parar',
                    icon: icons.stop,
                    click: () => { win.webContents.send('media:control', 'stop') },
                },
            ])
        } catch { /* thumbar é opcional */ }
    }

    ipcMain.on('media:state', (_event, state: { hasMedia?: boolean; playing?: boolean }) => {
        hasMedia = !!state?.hasMedia
        playing = !!state?.playing
        applyThumbar()
    })
}
