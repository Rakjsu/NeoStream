import { app, shell } from 'electron'
import type { WebContents } from 'electron'

import log from './logger'

/**
 * 🛡️ Guarda de janelas: nenhuma janela do app abre outra nem sai do próprio
 * index.html (D138).
 *
 * Endurecimento, não correção de uma exploração demonstrada. As três janelas
 * (principal, PiP e multi-view) sobem com o preload, que expõe
 * `window.ipcRenderer` com a allowlist inteira — `auth:get-credentials`
 * incluído. Sem esta guarda (medido no app empacotado, Electron 44.4.2):
 *  - uma navegação do quadro principal (link sem `preventDefault`, arquivo
 *    solto em cima da janela, `location.href`) trocava o index.html por outra
 *    página — e o preload roda de novo nela: uma página http qualquer ganhava
 *    o mesmo `window.ipcRenderer`. Esse é o buraco de verdade;
 *  - um `window.open` (ou `<a target="_blank">`) abria uma 2ª janela solta,
 *    fora de tudo o que o app controla. Nela o `window.ipcRenderer` NÃO
 *    apareceu (about:blank nem http) — é arrumação, não o furo principal.
 *
 * Por isso a regra mora num lugar só, no `web-contents-created` do app: vale
 * para as três BrowserWindow de hoje e para qualquer uma que alguém criar
 * depois sem lembrar deste arquivo (WebContentsView/BrowserView, que têm outro
 * `getType()`, ficariam de fora — hoje o app não usa nenhuma).
 *
 * Quem precisa abrir link externo já tem o canal `shell:open-external`
 * (ipcHandlers.ts). Mesmo assim, uma navegação do quadro principal para
 * `https:`/`mailto:` (o "Suporte" de Sobre é um `<a href="mailto:">`) segue
 * para o navegador/cliente de e-mail do sistema em vez de morrer calada.
 * `window.open` não tem esse desvio: o iframe do trailer (terceiro) também
 * passa por ele, e um popup não pode virar aba de navegador sem clique.
 *
 * Testado em janelaNaoAbreOutraNemSaiDoApp.test.ts.
 */

/**
 * PURO: `destino` é o PRÓPRIO app? Mesmo documento que a janela carregou —
 * mesmo arquivo em `file:` (build) ou mesma origem em http(s) (servidor do
 * Vite em dev). Compara com a URL ATUAL da janela, não com uma montada à mão:
 * as duas vêm canonizadas pelo Chromium (letra de unidade, espaço, acento).
 */
export function ehNavegacaoDoApp(destino: string, atual: string): boolean {
    let alvo: URL
    let origem: URL
    try {
        alvo = new URL(destino)
        origem = new URL(atual)
    } catch {
        return false
    }
    if (origem.protocol === 'file:') {
        return alvo.protocol === 'file:'
            && alvo.host === origem.host
            && alvo.pathname === origem.pathname
    }
    if (origem.protocol === 'http:' || origem.protocol === 'https:') {
        return alvo.origin === origem.origin
    }
    return false
}

/**
 * PURO: o destino pode seguir para fora do app (navegador / e-mail do
 * sistema)? Só `https:` — a mesma regra do `shell:open-external` — e
 * `mailto:`. Devolve a URL normalizada ou `null`.
 */
export function destinoExterno(destino: string): string | null {
    try {
        const url = new URL(destino)
        if (url.protocol === 'https:' || url.protocol === 'mailto:') return url.href
    } catch {
        // URL inválida: não sai.
    }
    return null
}

/** Aplica a guarda a UM webContents de janela. */
export function protegerJanela(contents: WebContents): void {
    contents.setWindowOpenHandler(({ url }) => {
        log.warn('[Janela] window.open bloqueado:', url.slice(0, 200))
        return { action: 'deny' }
    })

    contents.on('will-navigate', (event) => {
        const destino = event.url
        if (ehNavegacaoDoApp(destino, contents.getURL())) return
        event.preventDefault()
        const externo = destinoExterno(destino)
        if (externo) {
            // Sem cliente de e-mail configurado o openExternal rejeita: vira
            // aviso no log, não uma "falha não tratada" (logger.ts).
            shell.openExternal(externo).catch((erro: unknown) => {
                log.warn('[Janela] o sistema não abriu o link:', externo.slice(0, 200), erro)
            })
            return
        }
        log.warn('[Janela] navegação para fora do app bloqueada:', destino.slice(0, 200))
    })

    // `webviewTag` já nasce desligado; isto garante que ninguém religa.
    contents.on('will-attach-webview', (event) => {
        event.preventDefault()
    })
}

let registrado = false

/**
 * Liga a guarda para TODA janela criada daqui em diante. Tem de rodar antes da
 * primeira janela (main.ts chama no topo, ao lado dos outros setup*()).
 */
export function setupWindowGuard(): void {
    if (registrado) return
    registrado = true
    app.on('web-contents-created', (_event, contents) => {
        // DevTools e afins não são janelas do app: ficam como estão.
        if (contents.getType() !== 'window') return
        protegerJanela(contents)
    })
}
