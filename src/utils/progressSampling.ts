/**
 * Amostragem do progresso de reprodução.
 *
 * O `timeupdate` do <video> dispara ~4x por segundo. As condições usadas até
 * aqui — `Math.floor(currentTime) % 5 === 0` (verdadeira durante um SEGUNDO
 * inteiro, ou seja ~4 gravações) e `currentTime % 5 < 0.5` (~2 gravações) —
 * transformavam "gravar a cada 5 s" em 2 a 4 read-modify-write do array de
 * progresso por janela, cada um seguido de um CustomEvent que vira IPC para os
 * celulares pareados.
 *
 * Aqui a decisão é pelo TEMPO DECORRIDO desde a última gravação, então uma
 * janela de 5 s grava exatamente uma vez — e um seek para trás (ou a troca de
 * mídia, que zera a referência) também grava na hora.
 */
export const PROGRESS_SAMPLE_INTERVAL_S = 5

/**
 * Deve gravar agora? `lastSaved` é o `currentTime` da última gravação (null
 * quando ainda não houve nenhuma para esta mídia).
 */
export function shouldSampleProgress(
    currentTime: number,
    lastSaved: number | null,
    intervalS: number = PROGRESS_SAMPLE_INTERVAL_S
): boolean {
    if (!Number.isFinite(currentTime) || currentTime < 0) return false
    if (lastSaved === null || !Number.isFinite(lastSaved)) return true
    // Salto para trás (seek): a posição mudou de verdade, grava.
    return Math.abs(currentTime - lastSaved) >= intervalS
}
