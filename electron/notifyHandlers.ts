import { ipcMain, Notification } from 'electron'
import type { BrowserWindow } from 'electron'
import log from './logger'

/**
 * Native notification bridge for the renderer (program reminders, etc.).
 * Clicking the notification focuses the main window and tells the renderer
 * which route to open via 'notify:clicked'.
 */
export function setupNotifyHandlers(getMainWindow: () => BrowserWindow | null) {
    ipcMain.handle('notify:show', (_event, payload: { title?: string; body?: string; route?: string }) => {
        try {
            if (!Notification.isSupported()) {
                return { success: false, error: 'Notifications not supported' }
            }

            const route = typeof payload?.route === 'string' ? payload.route : '/dashboard/guide'
            const notification = new Notification({
                title: String(payload?.title ?? 'NeoStream'),
                body: String(payload?.body ?? ''),
                silent: false
            })

            notification.on('click', () => {
                const win = getMainWindow()
                if (!win || win.isDestroyed()) return
                if (win.isMinimized()) win.restore()
                win.show()
                win.focus()
                win.webContents.send('notify:clicked', { route })
            })

            notification.show()
            return { success: true }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            log.error('[Notify] Failed to show notification:', message)
            return { success: false, error: message }
        }
    })
}
