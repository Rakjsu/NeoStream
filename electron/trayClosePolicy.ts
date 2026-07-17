/**
 * Pure decision for the window close button: quit the app, hide to tray, or
 * "hold" — hide to tray even with close-to-tray OFF because the DVR still has
 * work (recording right now or schedules pending).
 */

export type CloseAction = 'quit' | 'tray' | 'hold'

export interface CloseContext {
    quitting: boolean
    closeToTray: boolean
    activeRecordings: number
    pendingSchedules: number
}

export function closeAction(ctx: CloseContext): CloseAction {
    if (ctx.quitting) return 'quit'
    if (ctx.closeToTray) return 'tray'
    if (ctx.activeRecordings > 0 || ctx.pendingSchedules > 0) return 'hold'
    return 'quit'
}
