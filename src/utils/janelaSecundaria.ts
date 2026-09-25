/**
 * O PiP e o multi-view abrem uma BrowserWindow que carrega o MESMO
 * `index.html` (electron/pipHandlers.ts: `#/pip?data=...` e `#/multiview...`):
 * o App sobe inteiro de novo ali dentro, pontes sempre-montadas e relógios de
 * boot incluídos. Quem fala com o usuário ou com o main em nome do app — aviso
 * nativo, espelho no celular, timer de lembrete, gravação agendada, relógio de
 * refresh — tem de rodar numa janela só, a principal; senão cada janela aberta
 * vira mais um aviso (e mais um ffmpeg).
 *
 * Janela nova que carregue o `index.html` = mais uma linha aqui E nas duas
 * cópias privadas que já existiam antes deste util (`janelaSecundaria()` em
 * services/profileService.ts e services/epgVarreduraRegras.ts).
 */
export function ehJanelaSecundaria(): boolean {
    const hash = window.location.hash;
    return hash.startsWith('#/pip') || hash.startsWith('#/multiview');
}
