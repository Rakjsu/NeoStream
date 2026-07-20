import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openCatalogStore, type CatalogStore } from './catalogDb'

let dir: string
let store: CatalogStore | null

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-catalogdb-'))
    store = null
})

afterEach(() => {
    store?.close()
    fs.rmSync(dir, { recursive: true, force: true })
})

const dbPath = () => path.join(dir, 'catalog.db')
const legacyDir = () => path.join(dir, 'catalog-cache')

describe('openCatalogStore (item 19 — catálogo em SQLite)', () => {
    it('write/read/remove com roundtrip do data', () => {
        store = openCatalogStore(dbPath(), legacyDir())
        expect(store).not.toBeNull()
        store!.write('p1-live', { fetchedAt: 123, data: [{ name: 'Canal' }] })
        expect(store!.read('p1-live')).toEqual({ fetchedAt: 123, data: [{ name: 'Canal' }] })
        // Upsert atualiza a mesma chave.
        store!.write('p1-live', { fetchedAt: 456, data: [] })
        expect(store!.read('p1-live')).toEqual({ fetchedAt: 456, data: [] })
        store!.remove('p1-live')
        expect(store!.read('p1-live')).toBeNull()
    })

    it('dados sobrevivem a fechar e reabrir o banco', () => {
        store = openCatalogStore(dbPath(), legacyDir())
        store!.write('p1-vod', { fetchedAt: 1, data: { total: 9 } })
        store!.close()
        store = openCatalogStore(dbPath(), legacyDir())
        expect(store!.read('p1-vod')).toEqual({ fetchedAt: 1, data: { total: 9 } })
    })

    it('migra os JSONs legados, pula corrompido e renomeia a pasta pra backup', () => {
        fs.mkdirSync(legacyDir(), { recursive: true })
        fs.writeFileSync(path.join(legacyDir(), 'p1-live.json'), JSON.stringify({ fetchedAt: 10, data: ['a'] }))
        fs.writeFileSync(path.join(legacyDir(), 'p1-series.json'), JSON.stringify({ fetchedAt: 20, data: ['b'] }))
        fs.writeFileSync(path.join(legacyDir(), 'quebrado.json'), '{nope')
        store = openCatalogStore(dbPath(), legacyDir())
        expect(store!.read('p1-live')).toEqual({ fetchedAt: 10, data: ['a'] })
        expect(store!.read('p1-series')).toEqual({ fetchedAt: 20, data: ['b'] })
        expect(store!.read('quebrado')).toBeNull()
        // Backup do rollback manual no lugar da pasta original.
        expect(fs.existsSync(legacyDir())).toBe(false)
        expect(fs.existsSync(`${legacyDir()}-backup`)).toBe(true)
    })

    it('sem pasta legada a migração é no-op e o store abre normal', () => {
        store = openCatalogStore(dbPath(), legacyDir())
        expect(store).not.toBeNull()
        expect(store!.read('qualquer')).toBeNull()
    })

    it('caminho de DB impossível → null (rollback automático pro JSON)', () => {
        const warnings: string[] = []
        // NUL é inválido em nome de arquivo no Windows; em POSIX o mkdir falha.
        const bad = openCatalogStore(path.join(dir, 'x\0y', 'catalog.db'), legacyDir(), (m) => warnings.push(m))
        expect(bad).toBeNull()
        expect(warnings.length).toBeGreaterThan(0)
    })
})
