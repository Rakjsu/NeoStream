/**
 * 📥 Item 12 — dono da pasta e do manifest dos downloads que chegam do celular.
 * O manifest existe porque o `webContents.send('transfer:received')` é
 * fire-and-forget: com o renderer recarregando (Ctrl+R, crash-restart, boot) o
 * evento se perdia, o arquivo ficava órfão no disco e o celular já tinha visto
 * 200. Agora a pendência é gravada ANTES da resposta e o WebRemoteBridge
 * reconcilia o que sobrou toda vez que monta.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import log from './logger'
import {
    appendTransferEntry,
    parseTransferManifest,
    removeTransferEntries,
    type ReceivedTransfer,
} from './transferReceiver'

/** Pasta dos arquivos recebidos (a mesma que o /transfer escreve). */
export function transfersDir(): string {
    return path.join(app.getPath('userData'), 'downloads', 'transfers')
}

// Fora da pasta dos arquivos de propósito: um envio chamado "received.json"
// passaria na validação de extensão e sobrescreveria o próprio manifest.
function manifestPath(): string {
    return path.join(app.getPath('userData'), 'downloads', 'transfers-pending.json')
}

function readManifest(): ReceivedTransfer[] {
    try {
        return parseTransferManifest(fs.readFileSync(manifestPath(), 'utf8'))
    } catch {
        return [] // ainda não existe (ou ilegível) — nada pendente
    }
}

function writeManifest(list: ReceivedTransfer[]): void {
    try {
        fs.mkdirSync(path.dirname(manifestPath()), { recursive: true })
        fs.writeFileSync(manifestPath(), JSON.stringify(list))
    } catch (error) {
        log.warn('[Transfer] manifest não gravado:', error)
    }
}

/** Registra a pendência antes do 200 pro celular. */
export function recordReceivedTransfer(entry: ReceivedTransfer): void {
    writeManifest(appendTransferEntry(readManifest(), entry))
}

export function setupTransferHandlers(): void {
    // Pendências que ainda têm arquivo no disco. Quem perdeu o arquivo (usuário
    // apagou na mão) sai daqui pra não ressuscitar entrada quebrada.
    ipcMain.handle('transfer:pending', () => {
        const all = readManifest()
        const items = all.filter(entry => fs.existsSync(entry.filePath))
        if (items.length !== all.length) writeManifest(items)
        return { success: true, items }
    })

    // O renderer confirma o que registrou — só então o id sai do manifest.
    ipcMain.handle('transfer:consume', (_event, raw: unknown) => {
        const ids = Array.isArray((raw as { ids?: unknown })?.ids)
            ? ((raw as { ids: unknown[] }).ids).filter((id): id is string => typeof id === 'string')
            : []
        if (ids.length === 0) return { success: true }
        writeManifest(removeTransferEntries(readManifest(), ids))
        return { success: true }
    })
}
