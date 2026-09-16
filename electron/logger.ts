/**
 * Centralized logger for the Electron main process.
 *
 * Wraps electron-log so every main-process module logs to the same
 * file (under app.getPath('logs')) with consistent formatting, while
 * keeping console output in dev for quick feedback.
 *
 * Usage:
 *   import log from './logger'
 *   log.info('hello', { foo: 1 })
 *   log.warn('something odd')
 *   log.error('failed', err)
 */
import log from 'electron-log/main'
import { redactLogLine } from './logRedaction'
import { criarLimitador, descreverFalha, LIMITE_DE_FALHAS } from './falhaNaoTratada'

// Initialize once on first import. Safe to call multiple times.
log.initialize()

// File transport is enabled by default; keep verbose info in the file.
log.transports.file.level = 'info'

// In packaged builds suppress chatty console output; in dev keep it.
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn'

// Compact format: [timestamp] [level] message
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.transports.console.format = '[{level}] {text}'

// 🔒 Redação de credenciais NO TRANSPORTE, não em cada chamada de log.
//
// Esta é a última etapa da cadeia do transporte de arquivo: o `toString` do
// electron-log já transformou os argumentos (string, objeto, Error, stderr do
// ffmpeg) na linha final, então redigir aqui cobre TUDO que qualquer módulo
// logar — inclusive código que ainda nem foi escrito. Corrigir só as chamadas
// que vazam hoje deixaria a próxima nascer vazando.
//
// Só o transporte de arquivo é redigido: é ele que grava em disco, que é o que
// o usuário exporta e compartilha. O console não persiste nada.
log.transports.file.transforms = [...log.transports.file.transforms, redactLogLine]

// 🧯 Rede de segurança do processo principal.
//
// O renderer tem a dele desde sempre (src/main.tsx escuta `error` e
// `unhandledrejection`). O main — ffmpeg do DVR e do timeshift, servidor do
// controle web, sockets de cast, streams de download — não tinha nenhuma:
// qualquer throw assíncrono fora de um `.on('error')` subia até o Electron,
// que abria o diálogo nativo e derrubava o app SEM deixar linha no arquivo que
// a pessoa exporta em Diagnósticos. Fica aqui, e não no main.ts, porque este
// módulo é o primeiro import de todo mundo e já é o ponto onde a redação de
// credenciais acontece — o que for capturado passa pela mesma cadeia redigida.
const podeRegistrarFalha = criarLimitador()

function registrarFalha(origem: string, motivo: unknown): void {
    const veredito = podeRegistrarFalha()
    if (veredito === 'nao') return
    log.error(`[${origem}] ${descreverFalha(motivo)}`)
    if (veredito === 'ultima') {
        log.error(`[${origem}] limite de ${LIMITE_DE_FALHAS} falhas atingido — o resto desta sessão não será registrado`)
    }
}

// `showDialog: false`: o diálogo nativo do Chromium não diz nada de útil e
// ainda esconde o app. O que resolve o bug é a linha no log.
log.errorHandler?.startCatching?.({
    showDialog: false,
    onError: ({ error }) => registrarFalha('uncaughtException', error)
})

// O errorHandler do electron-log cobre exceção; promessa rejeitada sem catch
// entra por outro caminho.
process.on('unhandledRejection', (motivo: unknown) => registrarFalha('unhandledRejection', motivo))

export default log
