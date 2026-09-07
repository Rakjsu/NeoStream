/**
 * Mensagem legível de um erro desconhecido — cópia ÚNICA.
 *
 * Esta mesma função estava declarada, byte a byte igual, em seis módulos do
 * processo principal (airplayHandlers, autoUpdater, diagnosticsHandlers,
 * dlnaHandlers, downloadHandlers e ipcHandlers), e a expressão aparece inline
 * em mais 32 lugares. Nenhuma divergia — o problema é ter seis definições a
 * manter, e a próxima "melhoria" só chegar a uma delas.
 *
 * ⚠️ O CORPO NÃO MUDA. O texto que sai daqui é LIDO POR REGEX no caminho do
 * DLNA, para decidir o retry das TVs Samsung:
 *
 *   dlnaHandlers.ts:1098  /\b701\b/          → tenta de novo em outro formato
 *   dlnaHandlers.ts:1120  /\b704\b|restrict|format/i
 *   dlnaHandlers.ts:1142  /\b704\b|restrict|format not supported|not implemented/i
 *   dlnaHandlers.ts:1146  /timeout/i         → "verifique se a TV está ligada"
 *
 * Tratar objeto, prefixar rótulo ou passar por JSON.stringify quebra esses
 * quatro em silêncio: o retry deixa de disparar e a pessoa vê "falhou" no
 * lugar da mensagem que explica o que houve. O `errorMessage.test.ts` trava
 * cada uma dessas formas.
 *
 * As duas versões do renderer (downloadService.ts, useDLNA.ts) NÃO entram
 * aqui: têm dois argumentos e descartam o `String(error)` em favor de um texto
 * de reserva. Unificá-las trocaria "[object Object]" por "Download failed" na
 * tela — é outra função, com outro contrato.
 */
export const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)
