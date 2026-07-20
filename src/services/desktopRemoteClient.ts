/**
 * 🖥️ Item 38 — PC controla PC: cliente do controle web de OUTRO NeoStream.
 * Mesmo protocolo WS da página do celular (PIN na query, comandos {action}).
 * O WebSocket vive no renderer (Configurações → Controle remoto), então não
 * há IPC nem preload novos.
 */

export interface RemotePeerState {
    title: string
    playing: boolean
    casting: boolean
    castTitle: string
}

/** PURO: normaliza o endereço digitado (sem esquema/barras) → URL do WS. */
export function buildRemoteWsUrl(addr: string, pin: string): string {
    const clean = addr.trim().replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    return `ws://${clean}/?pin=${encodeURIComponent(pin.trim())}`
}

/** PURO: estado que o servidor manda pros clientes (type:'state'). */
export function parsePeerState(text: string): RemotePeerState | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return null
    }
    const state = parsed as { type?: string; title?: string; playing?: boolean; casting?: boolean; castTitle?: string } | null
    if (state?.type !== 'state') return null
    return {
        title: state.title || '',
        playing: state.playing === true,
        casting: state.casting === true,
        castTitle: state.castTitle || '',
    }
}

/** Manda um comando de transporte ({action}) pro outro PC. */
export function sendPeerCommand(socket: WebSocket | null, action: string): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify({ action }))
    return true
}
