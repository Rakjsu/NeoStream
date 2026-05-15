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

// Initialize once on first import. Safe to call multiple times.
log.initialize()

// File transport is enabled by default; keep verbose info in the file.
log.transports.file.level = 'info'

// In packaged builds suppress chatty console output; in dev keep it.
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn'

// Compact format: [timestamp] [level] message
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.transports.console.format = '[{level}] {text}'

export default log
