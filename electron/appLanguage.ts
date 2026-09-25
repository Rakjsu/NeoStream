/**
 * 🌐 Idioma do app, do lado do processo main (#D120).
 *
 * Quem manda é o renderer: o languageService envia `app:language` no boot e a
 * cada troca. O webRemoteServer já escuta esse canal e PERSISTE o idioma no
 * store `web-remote`, chave `webRemoteLang` — e é daquele disco que este
 * módulo tira o valor inicial, porque a bandeja e a jump list são montadas
 * antes de existir janela. Sem isso, todo restart em inglês começaria com a
 * bandeja em português até o renderer terminar de subir.
 *
 * Este módulo só LÊ aquele arquivo (quem grava continua sendo o
 * webRemoteServer) e registra o PRÓPRIO ouvinte do canal — o Electron aceita
 * vários, o mesmo arranjo do media:state entre trayMode e winIntegration.
 */
import { ipcMain } from 'electron'
import Store from 'electron-store'
import log from './logger'
import { normalizeShellLang, type ShellLang } from './shellStrings'

type Ouvinte = (lang: ShellLang) => void

let atual: ShellLang | null = null
let escutando = false
const ouvintes = new Set<Ouvinte>()

function idiomaPersistido(): ShellLang {
    try {
        // Mesmo `name` e mesma chave do webRemoteServer (o teste confere).
        const disco = new Store<Record<string, unknown>>({ name: 'web-remote' })
        return normalizeShellLang(disco.get('webRemoteLang')) ?? 'pt'
    } catch {
        return 'pt'
    }
}

/** Idioma corrente das superfícies do main (bandeja, avisos, taskbar). */
export function getAppLanguage(): ShellLang {
    if (atual === null) atual = idiomaPersistido()
    return atual
}

function garantirEscuta(): void {
    if (escutando) return
    escutando = true
    ipcMain.on('app:language', (_e, raw: unknown) => {
        const code = normalizeShellLang(raw)
        // Compara com a memória, não com getAppLanguage(): o ouvinte do
        // webRemoteServer roda antes deste e já gravou `code` no disco, então
        // uma leitura preguiçosa aqui sempre acharia "nada mudou".
        if (!code || code === atual) return
        atual = code
        for (const fn of ouvintes) {
            try {
                fn(code)
            } catch (err) {
                log.warn('[AppLanguage] ouvinte falhou ao trocar de idioma:', err)
            }
        }
    })
}

/**
 * Chama `fn` a cada troca de idioma feita no app. Bandeja e taskbar vivem o
 * processo inteiro, então não há desinscrição.
 */
export function onAppLanguageChange(fn: Ouvinte): void {
    garantirEscuta()
    ouvintes.add(fn)
}
