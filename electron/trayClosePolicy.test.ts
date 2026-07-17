import { describe, expect, it } from 'vitest'
import { closeAction } from './trayClosePolicy'

describe('closeAction (fechar janela: sair, bandeja ou segurar pelo DVR)', () => {
    const base = { quitting: false, closeToTray: false, activeRecordings: 0, pendingSchedules: 0 }

    it('sair explícito sempre encerra, mesmo gravando', () => {
        expect(closeAction({ ...base, quitting: true, activeRecordings: 2 })).toBe('quit')
        expect(closeAction({ ...base, quitting: true, closeToTray: true })).toBe('quit')
    })

    it('fechar pra bandeja ligado esconde normalmente', () => {
        expect(closeAction({ ...base, closeToTray: true })).toBe('tray')
    })

    it('com bandeja desligada, gravação ativa ou agendada segura o app', () => {
        expect(closeAction({ ...base, activeRecordings: 1 })).toBe('hold')
        expect(closeAction({ ...base, pendingSchedules: 3 })).toBe('hold')
    })

    it('sem bandeja e sem DVR pendente, fechar encerra', () => {
        expect(closeAction(base)).toBe('quit')
    })
})
