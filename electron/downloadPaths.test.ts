import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveDownloadFile, resolveSeriesFolder, sanitizeDownloadName } from './downloadPaths'

/**
 * 🔒 `download:delete-folder` fazia `path.join(downloads, folderName)` +
 * `fs.rmSync(recursive)` com o nome da série CRU — e esse nome vem do catálogo
 * do provedor. Uma série chamada `..\..\..\Documents` apagava a pasta do
 * usuário no clique de "excluir série". Estes testes falham sem o confinamento.
 */

const ROOT = path.join('C:', 'Users', 'x', 'AppData', 'neostream', 'downloads')
const SERIES_ROOT = path.resolve(ROOT, 'series')

describe('resolveSeriesFolder', () => {
    it('nome normal vira <downloads>/series/<nome>', () => {
        expect(resolveSeriesFolder(ROOT, 'Dark')).toBe(path.join(SERIES_ROOT, 'Dark'))
    })

    it('🔒 traversal com .. não escapa da raiz', () => {
        for (const evil of ['..\\..\\..\\Documents', '../../../Documents', '../', '..\\', '..\\..\\AppData\\Roaming\\neostream']) {
            const resolved = resolveSeriesFolder(ROOT, evil)
            expect(resolved).not.toBeNull()
            expect(resolved!.startsWith(SERIES_ROOT + path.sep)).toBe(true)
            // O `..` sobrou só como texto no nome da pasta, não como salto.
            expect(path.dirname(resolved!)).toBe(SERIES_ROOT)
        }
        // `..` puro não sobra nada utilizável — recusado de vez.
        expect(resolveSeriesFolder(ROOT, '..')).toBeNull()
        expect(resolveSeriesFolder(ROOT, '.')).toBeNull()
        expect(resolveSeriesFolder(ROOT, '....')).toBeNull()
    })

    it('🔒 caminho absoluto e UNC viram nome de base dentro da raiz', () => {
        const abs = resolveSeriesFolder(ROOT, 'C:\\Windows\\System32')
        expect(abs).toBe(path.join(SERIES_ROOT, 'C__Windows_System32'))

        const unc = resolveSeriesFolder(ROOT, '\\\\192.168.0.66\\pub')
        expect(unc).toBe(path.join(SERIES_ROOT, '__192.168.0.66_pub'))

        const posixAbs = resolveSeriesFolder(ROOT, '/etc/passwd')
        expect(posixAbs).toBe(path.join(SERIES_ROOT, '_etc_passwd'))
    })

    it('🔒 nome que colidiria com outra pasta do app fica sob series/', () => {
        // Sem o prefixo `series/`, uma série chamada "movies" apagaria TODOS
        // os filmes baixados.
        expect(resolveSeriesFolder(ROOT, 'movies')).toBe(path.join(SERIES_ROOT, 'movies'))
        expect(resolveSeriesFolder(ROOT, 'covers')).toBe(path.join(SERIES_ROOT, 'covers'))
    })

    it('entrada inválida é recusada', () => {
        expect(resolveSeriesFolder(ROOT, '')).toBeNull()
        expect(resolveSeriesFolder(ROOT, '   ')).toBeNull()
        expect(resolveSeriesFolder(ROOT, undefined)).toBeNull()
        expect(resolveSeriesFolder(ROOT, 42)).toBeNull()
    })

    it('bate com o nome que o download:start cria', () => {
        const provider = 'Série: Teste/Piloto'
        expect(resolveSeriesFolder(ROOT, provider))
            .toBe(path.join(SERIES_ROOT, sanitizeDownloadName(provider)))
    })
})

describe('resolveDownloadFile', () => {
    it('arquivo dentro da pasta de downloads passa', () => {
        const file = path.join(ROOT, 'movies', 'filme.mp4')
        expect(resolveDownloadFile(ROOT, file)).toBe(path.resolve(file))
    })

    it('🔒 traversal para fora da raiz é recusado', () => {
        expect(resolveDownloadFile(ROOT, path.join(ROOT, '..', '..', 'config.json'))).toBeNull()
        expect(resolveDownloadFile(ROOT, path.join('..', 'segredo.txt'))).toBeNull()
    })

    it('🔒 a própria raiz não é um arquivo apagável', () => {
        expect(resolveDownloadFile(ROOT, ROOT)).toBeNull()
    })

    it('entrada vazia é recusada', () => {
        expect(resolveDownloadFile(ROOT, '')).toBeNull()
        expect(resolveDownloadFile(ROOT, null)).toBeNull()
    })
})
