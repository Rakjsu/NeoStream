/**
 * 🧹 Configurações → Armazenamento → "Cache do catálogo" (#D048).
 *
 * Desde que o cache do catálogo virou SQLite (item 19), ele mora em
 * `userData/catalog.db` (+ `-wal`/`-shm`), e a migração RENOMEIA a pasta
 * legada `catalog-cache` para `catalog-cache-backup`. O storageManager
 * continuou medindo e apagando só `catalog-cache` — uma pasta que não existe
 * mais. Resultado na tela: a linha mostrava ~0 KB com um catálogo de dezenas
 * de MB, e o "Limpar" respondia sucesso sem tocar em nada (nem no disco, nem
 * na cópia em memória do main, que seguia servindo a lista "limpa").
 *
 * Os testes cobram COMPORTAMENTO: rodam os handlers IPC de verdade sobre um
 * `userData` temporário, com o catalogCache e o node:sqlite reais, e olham o
 * disco e a próxima busca depois. O fallback JSON (node:sqlite indisponível)
 * é coberto também — a correção não pode quebrar o backend de reserva.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const state = vi.hoisted(() => ({
    userData: '',
    semSqlite: false,
    clearQuebrado: false,
    handlers: new Map<string, IpcHandler>(),
    abertas: [] as string[],
}))

vi.mock('electron', () => ({
    ipcMain: { handle: (canal: string, fn: IpcHandler) => state.handlers.set(canal, fn) },
    app: { getPath: () => state.userData },
    shell: {
        openPath: async (alvo: string) => {
            state.abertas.push(alvo)
            return ''
        },
    },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./dvrHandlers', () => ({ recordingsDir: () => path.join(state.userData, 'gravacoes') }))
vi.mock('./timeshiftHandlers', () => ({
    isTimeshiftRunning: () => false,
    timeshiftDir: () => path.join(state.userData, 'timeshift'),
}))
// Mesmo módulo de verdade; só dá pra desligar o SQLite pra exercitar o
// fallback JSON (é o que acontece num runtime sem node:sqlite).
vi.mock('./catalogDb', async (importOriginal) => {
    const real = await importOriginal<typeof import('./catalogDb')>()
    return {
        ...real,
        openCatalogStore: (...args: Parameters<typeof real.openCatalogStore>) => {
            if (state.semSqlite) return null
            const store = real.openCatalogStore(...args)
            if (!store) return null
            // Disco cheio / DB corrompido no meio do VACUUM, sob demanda.
            return {
                ...store,
                clear: () => {
                    if (state.clearQuebrado) throw new Error('database or disk is full')
                    store.clear()
                },
            }
        },
    }
})

import { setupStorageManager } from './storageManager'
import { cachedCatalogFetch, closeCatalogStore } from './catalogCache'
import { openCatalogStore } from './catalogDb'

interface RespostaUso { success: boolean; areas?: { area: string; bytes: number }[] }
interface RespostaSimples { success: boolean; error?: string }

const invoke = <T>(canal: string, arg?: unknown) =>
    (state.handlers.get(canal) as IpcHandler)(null, arg) as Promise<T>

const dbPath = () => path.join(state.userData, 'catalog.db')
const legacyDir = () => path.join(state.userData, 'catalog-cache')
const backupDir = () => path.join(state.userData, 'catalog-cache-backup')

/** ~1 MB de lista, pra a diferença entre "tem cache" e "não tem" ser gritante. */
const LISTA = Array.from({ length: 500 }, (_, i) => ({ stream_id: i, name: `Canal ${i} ${'x'.repeat(2000)}` }))
const TAMANHO_LISTA = JSON.stringify(LISTA).length

function tamanho(arquivo: string): number {
    try {
        return fs.statSync(arquivo).size
    } catch {
        return 0
    }
}

/** Bytes do catalog.db e dos arquivos de WAL/SHM, medidos direto no disco. */
function bytesDoBanco(): number {
    return tamanho(dbPath()) + tamanho(`${dbPath()}-wal`) + tamanho(`${dbPath()}-shm`)
}

/**
 * Espera uma CONDIÇÃO (a gravação do cache sai do caminho da resposta, via
 * setImmediate no SQLite e write-behind no JSON). Nunca um número fixo de voltas.
 */
async function esperar(condicao: () => boolean, rotulo: string, prazoMs = 5000): Promise<void> {
    const fim = Date.now() + prazoMs
    while (!condicao()) {
        if (Date.now() > fim) throw new Error(`a condição nunca aconteceu: ${rotulo}`)
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

async function bytesDoCatalogoNaTela(): Promise<number> {
    const resultado = await invoke<RespostaUso>('storage:usage')
    expect(resultado.success).toBe(true)
    const linha = resultado.areas?.find(a => a.area === 'catalogCache')
    expect(linha, 'a tela de Armazenamento não lista o cache do catálogo').toBeDefined()
    return linha?.bytes ?? 0
}

let seq = 0
const novaPlaylist = () => `pl_armz_${++seq}`

describe('cache do catálogo na tela de Armazenamento (#D048)', () => {
    beforeEach(() => {
        closeCatalogStore()
        state.semSqlite = false
        state.clearQuebrado = false
        state.handlers.clear()
        state.abertas.length = 0
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-armz-cat-'))
        setupStorageManager()
    })

    afterEach(() => {
        closeCatalogStore()
        fs.rmSync(state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    describe('backend SQLite (o caminho normal)', () => {
        async function semearCatalogo(playlist: string): Promise<void> {
            const primeira = await cachedCatalogFetch(playlist, 'live', async () => LISTA)
            expect(primeira.fromCache).toBe(false)
            await esperar(() => bytesDoBanco() >= TAMANHO_LISTA, 'a lista chegar ao catalog.db')
        }

        it('storage:usage mede o catalog.db (+ WAL/SHM), não a pasta legada que a migração renomeou', async () => {
            await semearCatalogo(novaPlaylist())
            expect(fs.existsSync(legacyDir()), 'o cenário devia estar no backend SQLite').toBe(false)

            const bytes = await bytesDoCatalogoNaTela()

            expect(bytes, 'a linha "Cache do catálogo" mostra ~0 KB com o catálogo inteiro no disco')
                .toBeGreaterThanOrEqual(TAMANHO_LISTA)
            // Os TRÊS arquivos entram, byte a byte: com o DB aberto a lista está
            // no -wal e o -shm existe; nada além deles está no disco agora.
            expect(bytes, 'a medição esqueceu um dos arquivos do catalog.db').toBe(bytesDoBanco())

            // "Fecha o app": o checkpoint leva a lista pro catalog.db e o -wal some.
            closeCatalogStore()
            expect(tamanho(dbPath()), 'o cenário devia ter a lista dentro do catalog.db')
                .toBeGreaterThanOrEqual(TAMANHO_LISTA)
            expect(await bytesDoCatalogoNaTela(), 'o catalog.db em si ficou fora da conta')
                .toBe(bytesDoBanco())
        })

        it('storage:clear-cache esvazia o catálogo de verdade: disco e memória', async () => {
            const playlist = novaPlaylist()
            await semearCatalogo(playlist)
            const antes = bytesDoBanco()

            const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })
            expect(resultado.success, `limpeza recusada: ${resultado.error}`).toBe(true)

            // Disco: o arquivo encolhe (DELETE sozinho não devolve página nenhuma).
            expect(bytesDoBanco(), `o catalog.db continuou com ${bytesDoBanco()} de ${antes} bytes`)
                .toBeLessThan(TAMANHO_LISTA / 4)
            expect(await bytesDoCatalogoNaTela(), 'a tela seguiu mostrando o tamanho de antes')
                .toBeLessThan(TAMANHO_LISTA / 4)

            // Memória: a próxima busca vai ao provedor, mesmo dentro dos 15 min.
            const provedor = vi.fn(async () => [{ stream_id: 999 }])
            const depois = await cachedCatalogFetch(playlist, 'live', provedor)
            expect(provedor, 'o main seguiu servindo o catálogo "limpo" da memória').toHaveBeenCalledTimes(1)
            expect(depois).toEqual({ data: [{ stream_id: 999 }], fromCache: false })
        })

        it('depois de limpar, um novo boot não ressuscita a lista antiga do disco', async () => {
            const playlist = novaPlaylist()
            await semearCatalogo(playlist)

            await invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })
            closeCatalogStore() // "fecha o app": memória some, próximo acesso reabre o catalog.db

            const provedor = vi.fn(async () => [{ stream_id: 7 }])
            const depois = await cachedCatalogFetch(playlist, 'live', provedor)
            expect(provedor, 'o catalog.db ainda tinha a lista depois do "Limpar"').toHaveBeenCalledTimes(1)
            expect(depois.fromCache).toBe(false)
        })

        it('limpa o catalog.db de uma sessão anterior mesmo sem nenhuma lista pedida nesta', async () => {
            const playlist = novaPlaylist()
            await semearCatalogo(playlist)
            closeCatalogStore() // novo boot: nada aberto ainda quando o usuário clica em Limpar

            const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })
            expect(resultado.success, `limpeza recusada: ${resultado.error}`).toBe(true)
            expect(bytesDoBanco(), 'o catalog.db do boot anterior ficou inteiro').toBeLessThan(TAMANHO_LISTA / 4)

            const provedor = vi.fn(async () => [{ stream_id: 3 }])
            await cachedCatalogFetch(playlist, 'live', provedor)
            expect(provedor, 'a lista do boot anterior voltou do disco').toHaveBeenCalledTimes(1)
        })

        it('uma busca que já estava em voo não é reaproveitada depois do Limpar', async () => {
            const playlist = novaPlaylist()
            await semearCatalogo(playlist)

            // Atualização forçada em voo: ela carrega a lista de ANTES como
            // reserva (o SWR serve o cache velho se o provedor falhar).
            let falharProvedor: (erro: Error) => void = () => undefined
            const emVoo = cachedCatalogFetch(playlist, 'live', () => new Promise((_ok, falha) => {
                falharProvedor = falha
            }), true)

            await invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })

            const provedor = vi.fn(async () => [{ stream_id: 5 }])
            const depois = cachedCatalogFetch(playlist, 'live', provedor)
            falharProvedor(new Error('provedor fora do ar'))
            await emVoo

            expect(await depois, 'a busca pós-Limpar pegou carona na antiga e recebeu a lista limpa')
                .toEqual({ data: [{ stream_id: 5 }], fromCache: false })
            expect(provedor).toHaveBeenCalledTimes(1)
        })

        it('se o SQLite falhar na limpeza, a tela recebe falha — não um sucesso de mentira', async () => {
            await semearCatalogo(novaPlaylist())
            state.clearQuebrado = true

            const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })

            expect(resultado.success, 'o Limpar disse que limpou sem ter limpado').toBe(false)
            expect(resultado.error).toContain('disk is full')
        })

        it('o clear() do catalog.db lança em vez de engolir o erro (é o que vira a falha acima)', () => {
            const store = openCatalogStore(path.join(state.userData, 'avulso.db'), legacyDir())
            expect(store, 'o cenário devia estar no backend SQLite').not.toBeNull()
            store?.close()
            expect(() => store?.clear()).toThrow()
        })

        it('o backup legado (catalog-cache-backup) entra na conta e sai na limpeza', async () => {
            await semearCatalogo(novaPlaylist())
            fs.mkdirSync(backupDir(), { recursive: true })
            fs.writeFileSync(path.join(backupDir(), 'pl_velha-vod.json'), 'x'.repeat(300_000))

            const bytes = await bytesDoCatalogoNaTela()
            expect(bytes, 'o backup da migração não aparece em lugar nenhum da tela')
                .toBe(bytesDoBanco() + 300_000)

            const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })
            expect(resultado.success, `limpeza recusada: ${resultado.error}`).toBe(true)
            expect(fs.existsSync(backupDir()), 'o backup legado continuou ocupando disco').toBe(false)
        })

        it('limpar o catálogo não encosta no resto do userData (downloads, gravações)', async () => {
            await semearCatalogo(novaPlaylist())
            const filme = path.join(state.userData, 'downloads', 'filme.mp4')
            const gravacao = path.join(state.userData, 'gravacoes', 'jogo.ts')
            for (const arquivo of [filme, gravacao]) {
                fs.mkdirSync(path.dirname(arquivo), { recursive: true })
                fs.writeFileSync(arquivo, 'conteudo do usuario')
            }

            const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })

            expect(resultado.success, `limpeza recusada: ${resultado.error}`).toBe(true)
            expect(fs.existsSync(filme), 'o "Limpar" do catálogo apagou um download').toBe(true)
            expect(fs.existsSync(gravacao), 'o "Limpar" do catálogo apagou uma gravação').toBe(true)
        })
    })

    describe('fallback JSON (node:sqlite indisponível)', () => {
        beforeEach(() => {
            state.semSqlite = true
        })

        async function semearJson(playlist: string): Promise<string> {
            const primeira = await cachedCatalogFetch(playlist, 'live', async () => LISTA)
            expect(primeira.fromCache).toBe(false)
            const arquivo = path.join(legacyDir(), `${playlist}-live.json`)
            await esperar(() => tamanho(arquivo) >= TAMANHO_LISTA, 'o JSON da lista chegar ao disco')
            expect(fs.existsSync(dbPath()), 'o cenário devia estar no backend JSON').toBe(false)
            return arquivo
        }

        it('mede e limpa a pasta catalog-cache, e a memória vai junto', async () => {
            const playlist = novaPlaylist()
            const arquivo = await semearJson(playlist)

            expect(await bytesDoCatalogoNaTela()).toBe(tamanho(arquivo))

            const resultado = await invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })
            expect(resultado.success, `limpeza recusada: ${resultado.error}`).toBe(true)
            expect(fs.existsSync(arquivo), 'o JSON do catálogo continuou no disco').toBe(false)

            const provedor = vi.fn(async () => [{ stream_id: 1 }])
            await cachedCatalogFetch(playlist, 'live', provedor)
            expect(provedor, 'o main seguiu servindo o catálogo "limpo" da memória').toHaveBeenCalledTimes(1)
        })

        it('uma leitura no meio da limpeza não devolve a lista velha pra memória', async () => {
            const playlist = novaPlaylist()
            await semearJson(playlist)

            // O clique em Limpar e uma busca de catálogo no mesmo instante: a
            // busca roda enquanto o arquivo ainda está no disco.
            const limpeza = invoke<RespostaSimples>('storage:clear-cache', { area: 'catalogCache' })
            await cachedCatalogFetch(playlist, 'live', async () => LISTA)
            expect((await limpeza).success).toBe(true)

            const provedor = vi.fn(async () => [{ stream_id: 2 }])
            await cachedCatalogFetch(playlist, 'live', provedor)
            expect(provedor, 'a lista velha voltou pra memória durante a limpeza e sobreviveu a ela')
                .toHaveBeenCalledTimes(1)
        })
    })

    it('"Abrir pasta" abre o userData (onde o catalog.db está) e não recria a pasta legada vazia', async () => {
        await cachedCatalogFetch(novaPlaylist(), 'live', async () => LISTA)

        const resultado = await invoke<RespostaSimples>('storage:open-area', { area: 'catalogCache' })

        expect(resultado.success).toBe(true)
        expect(state.abertas).toEqual([state.userData])
        expect(fs.existsSync(legacyDir()), 'abrir a pasta criou um catalog-cache vazio no userData').toBe(false)
    })
})
