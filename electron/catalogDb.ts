/**
 * 💾 Item 19 — catálogo em SQLite (node:sqlite, embutido no Node 24 do
 * Electron: zero dependência nativa, nada muda no electron-builder).
 *
 * Substitui os JSONs por-chave do catalog-cache por um catalog.db único
 * (WAL): sem custo de reparse de arquivos multi-MB inteiros a cada boot e
 * escrita atômica de verdade em catálogos grandes.
 *
 * Migração segura (ver openCatalogStore):
 *   - primeiro boot: importa os JSONs legados numa transação e renomeia a
 *     pasta pra catalog-cache-backup (o BACKUP do rollback manual);
 *   - qualquer erro no init/migração → retorna null e o catalogCache segue
 *     no backend JSON de sempre (ROLLBACK automático, sem perda);
 *   - rollback manual: fechar o app, apagar catalog.db* e renomear
 *     catalog-cache-backup de volta pra catalog-cache.
 *
 * Sem imports do electron — o chamador passa os caminhos (testável no vitest).
 */

import type { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

/**
 * node:sqlite via process.getBuiltinModule (Node >= 22.3): o import ESTÁTICO
 * quebrava o transform do vitest no CI ("Cannot bundle Node.js built-in") —
 * em runtime não passa pelo resolver de bundler nenhum. null = indisponível
 * (o chamador cai no backend JSON).
 */
function loadSqlite(): typeof import('node:sqlite') | null {
    try {
        const getBuiltin = (process as unknown as {
            getBuiltinModule?: (id: string) => unknown
        }).getBuiltinModule
        return (getBuiltin?.call(process, 'node:sqlite') as typeof import('node:sqlite')) ?? null
    } catch {
        return null
    }
}

export interface CatalogEntryRow {
    fetchedAt: number
    data: unknown
}

export interface CatalogStore {
    read(key: string): CatalogEntryRow | null
    write(key: string, entry: CatalogEntryRow): void
    remove(key: string): void
    close(): void
}

type Warn = (message: string) => void

/**
 * Migração única dos JSONs legados (um por playlist+kind) pro DB, numa
 * transação. Arquivo corrompido é pulado; a pasta vira *-backup no fim.
 * Idempotente: INSERT OR IGNORE nunca regride uma chave que o DB já tem,
 * e sem a pasta legada a função é um no-op.
 */
export function migrateLegacyJsonDir(db: DatabaseSync, legacyDir: string, warn: Warn): number {
    let files: string[]
    try {
        files = fs.readdirSync(legacyDir).filter((file) => file.endsWith('.json'))
    } catch {
        return 0 // pasta legada não existe: nada a migrar
    }
    const insert = db.prepare(
        'INSERT OR IGNORE INTO catalog_cache (key, fetched_at, data) VALUES (?, ?, ?)'
    )
    let count = 0
    db.exec('BEGIN')
    try {
        for (const file of files) {
            try {
                const parsed = JSON.parse(fs.readFileSync(path.join(legacyDir, file), 'utf-8')) as {
                    fetchedAt?: unknown
                    data?: unknown
                }
                if (typeof parsed?.fetchedAt !== 'number' || !('data' in parsed)) continue
                insert.run(file.replace(/\.json$/, ''), parsed.fetchedAt, JSON.stringify(parsed.data))
                count++
            } catch {
                // JSON corrompido: pula (o SWR refaz do provedor)
            }
        }
        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        warn(`migração legada falhou (JSONs preservados): ${String(error)}`)
        return 0
    }
    // A pasta inteira vira o backup do rollback manual. Um backup antigo de
    // uma tentativa anterior sai da frente primeiro.
    const backupDir = `${legacyDir}-backup`
    try {
        if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true })
        fs.renameSync(legacyDir, backupDir)
    } catch (error) {
        warn(`não deu pra mover a pasta legada pro backup: ${String(error)}`)
    }
    return count
}

/**
 * Abre (criando se preciso) o catalog.db e roda a migração legada.
 * null = SQLite indisponível/erro → o chamador fica no backend JSON.
 */
export function openCatalogStore(dbPath: string, legacyJsonDir: string, warn: Warn = () => {}): CatalogStore | null {
    try {
        const sqlite = loadSqlite()
        if (!sqlite) {
            warn('node:sqlite indisponível neste runtime — cache do catálogo segue em JSON')
            return null
        }
        fs.mkdirSync(path.dirname(dbPath), { recursive: true })
        const db = new sqlite.DatabaseSync(dbPath)
        db.exec('PRAGMA journal_mode = WAL')
        db.exec(
            'CREATE TABLE IF NOT EXISTS catalog_cache ('
            + 'key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, data TEXT NOT NULL)'
        )
        migrateLegacyJsonDir(db, legacyJsonDir, warn)
        const readStmt = db.prepare('SELECT fetched_at, data FROM catalog_cache WHERE key = ?')
        const writeStmt = db.prepare(
            'INSERT INTO catalog_cache (key, fetched_at, data) VALUES (?, ?, ?) '
            + 'ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data'
        )
        const removeStmt = db.prepare('DELETE FROM catalog_cache WHERE key = ?')
        return {
            read(key) {
                try {
                    const row = readStmt.get(key) as { fetched_at: number; data: string } | undefined
                    if (!row) return null
                    return { fetchedAt: row.fetched_at, data: JSON.parse(row.data) }
                } catch (error) {
                    warn(`leitura do catalog.db falhou (${key}): ${String(error)}`)
                    return null
                }
            },
            write(key, entry) {
                try {
                    writeStmt.run(key, entry.fetchedAt, JSON.stringify(entry.data))
                } catch (error) {
                    warn(`escrita do catalog.db falhou (${key}): ${String(error)}`)
                }
            },
            remove(key) {
                try {
                    removeStmt.run(key)
                } catch { /* já não existe */ }
            },
            close() {
                try {
                    db.close()
                } catch { /* já fechado */ }
            },
        }
    } catch (error) {
        warn(`SQLite indisponível — cache do catálogo segue em JSON: ${String(error)}`)
        return null
    }
}
