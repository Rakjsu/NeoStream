/**
 * 🔐 PIN do pareamento do controle web — parte PURA (testável; o
 * webRemoteServer importa 'electron' e não roda em unit test).
 *
 * O PIN era sorteado a cada start do servidor, então todo restart do PC
 * invalidava o código salvo no celular: o app re-tentava o WebSocket a cada
 * 15s com o PIN velho, derrubava o próprio IP no lockout por tentativas e o
 * POST /transfer passava a responder 429 — que o app mostrava como "falha de
 * rede", na mesma LAN, sem nenhuma pista de que o problema era o pareamento.
 */

/** Formato aceito no armazenamento: exatamente 4 dígitos. */
export function isValidSessionPin(raw: unknown): raw is string {
    return typeof raw === 'string' && /^\d{4}$/.test(raw)
}

/**
 * PIN a usar ao subir o servidor: reaproveita o salvo e só sorteia (pedindo
 * persistência) quando não há um válido. Revogar continua manual (regen-pin).
 */
export function resolveSessionPin(saved: unknown, generate: () => string): { pin: string; persist: boolean } {
    if (isValidSessionPin(saved)) return { pin: saved, persist: false }
    return { pin: generate(), persist: true }
}
