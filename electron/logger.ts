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

export default log
