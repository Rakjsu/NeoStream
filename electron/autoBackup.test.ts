/**
 * ⏰ O backup automático só acontecia em sessão de mais de uma hora.
 *
 * O relógio era um `setInterval` puro: o primeiro tique chega 60 minutos
 * depois de abrir o app. Quem abre para ver um episódio e fecha — a sessão
 * típica — nunca chegava lá. O backup ficava ligado nas Configurações, com
 * prazo vencido, e simplesmente não acontecia.
 *
 * As asserções são sobre o que o usuário observa (o pedido de coleta sai ou
 * não sai), nunca sobre qual primitiva de timer foi usada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = vi.hoisted(() => ({
    data: {} as Record<string, unknown>,
    enviados: [] as string[],
}))

vi.mock('electron', () => ({
    ipcMain: { handle: () => undefined },
    app: { getPath: () => '' },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    BrowserWindow: class { },
}))
vi.mock('electron-store', () => ({
    default: class {
        get(chave: string) { return state.data[chave] }
        set(chave: string, valor: unknown) { state.data[chave] = valor }
    },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupAutoBackup } from './autoBackup'

const DIA_MS = 24 * 3600_000

/** Janela falsa sem `once`, de propósito: o teste não opina sobre a primitiva. */
const janelaFalsa = {
    isDestroyed: () => false,
    webContents: { send: (canal: string) => { state.enviados.push(canal) } },
}

function ligarBackup(ultimoBackupHa: number) {
    state.data.autoBackup = {
        enabled: true,
        dirPath: 'D:\\backups',
        intervalDays: 7,
        lastBackupAt: Date.now() - ultimoBackupHa,
    }
}

beforeEach(() => {
    vi.useFakeTimers()
    state.data = {}
    state.enviados = []
})

afterEach(() => {
    vi.useRealTimers()
})

describe('relógio do backup automático', () => {
    it('faz o backup vencido numa sessão de cinco minutos', () => {
        ligarBackup(30 * DIA_MS)
        setupAutoBackup(() => janelaFalsa as never)

        vi.advanceTimersByTime(5 * 60_000)

        expect(state.enviados).toEqual(['backup:auto-collect'])
    })

    it('não faz backup fora do prazo', () => {
        // Sem isto, o conserto poderia virar "backup em todo boot".
        ligarBackup(1 * DIA_MS)
        setupAutoBackup(() => janelaFalsa as never)

        vi.advanceTimersByTime(5 * 60_000)

        expect(state.enviados).toEqual([])
    })

    it('a cadência de uma hora continua valendo', () => {
        // Guarda contra trocar o intervalo pelo disparo de boot.
        ligarBackup(30 * DIA_MS)
        setupAutoBackup(() => janelaFalsa as never)

        vi.advanceTimersByTime(5 * 60_000)
        state.enviados = []

        vi.advanceTimersByTime(60 * 60_000)

        expect(state.enviados).toEqual(['backup:auto-collect'])
    })

    it('desligado nas Configurações, nada sai', () => {
        state.data.autoBackup = { enabled: false, dirPath: 'D:\\backups', intervalDays: 7, lastBackupAt: 0 }
        setupAutoBackup(() => janelaFalsa as never)

        vi.advanceTimersByTime(2 * 60 * 60_000)

        expect(state.enviados).toEqual([])
    })
})
