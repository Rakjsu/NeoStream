// @vitest-environment node
/**
 * 🧱 D137 — as sondas de EPG externo (`epg:fetch-meuguia` e `epg:fetch-mitv`)
 * com teto de tamanho.
 *
 * As duas materializavam a resposta inteira com `response.text()` no processo
 * principal — exatamente o padrão que `httpLimits.ts` descreve como o que
 * estourava a heap do V8. Um site (ou um intermediário) que responda um corpo
 * sem fim derrubava o main por causa da grade de UM canal.
 *
 * Aqui o handler sobe de verdade (`setupIpcHandlers()`, com `electron` e
 * `node-fetch` mockados) e é chamado pelo canal, como o renderer chama. O que
 * se mede é o que SAIU do fio: quantos pedaços o handler puxou do corpo, se a
 * conexão foi fechada e o que voltou para o renderer — nada de olhar o fonte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSON_MAX_BYTES } from './httpLimits'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type Resultado = { success: boolean; html?: string; error?: string }

/** 1 MiB por pedaço: o teto (8 MiB) cai no meio da resposta gigante. */
const PEDACO = 1024 * 1024

/**
 * Pedaço ímpar de propósito para a página normal: 7 bytes partem os
 * caracteres de 2 e 3 bytes ("ã", "—") entre dois pedaços do fio.
 */
const PEDACO_DA_PAGINA = 7

const h = vi.hoisted(() => ({
    handlers: new Map<string, Handler>(),
    userData: '',
    /** Como o próximo corpo vai ser: quantos pedaços de 1 MiB, ou um texto pronto. */
    corpo: { pedacos: 0, texto: '' as string, contentLength: null as string | null },
    /** Pedaços que o handler efetivamente puxou do fio. */
    puxados: 0,
    /** A conexão foi fechada (destroy) pelo leitor? */
    destruido: false,
    fetches: [] as string[],
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Handler) => { h.handlers.set(canal, fn) },
        on: () => undefined,
        removeHandler: () => undefined,
    },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    dialog: {},
    screen: {},
    shell: {},
    app: { getPath: () => h.userData, getVersion: () => '0.0.0', getName: () => 'neostream' },
}))

// Store de mentira em memória: o `setupIpcHandlers` roda a migração de
// playlists na primeira linha, e ela espera `auth`/`playlists` de verdade.
vi.mock('./store', () => {
    const dados = new Map<string, unknown>([['auth', {}], ['playlists', []]])
    return {
        default: {
            get: (chave: string) => dados.get(chave),
            set: (chave: string, valor: unknown) => { dados.set(chave, valor) },
            delete: (chave: string) => { dados.delete(chave) },
        },
    }
})
vi.mock('./logger', () => ({
    default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}))
vi.mock('./mpvPlayer', () => ({ esconderMpvParaDialogo: () => undefined }))
vi.mock('./providerEpg', () => ({
    ensureProviderEpgLoaded: () => undefined,
    getProviderUtcOffsetMinutes: () => 0,
    resetProviderEpgState: () => undefined,
    setupProviderEpgHandlers: () => undefined,
}))

/**
 * Resposta no formato do node-fetch: `body` é um stream que conta cada pedaço
 * que sai e aceita `destroy`; `text()` é o `text()` de verdade — lê o MESMO
 * stream até o fim, sem teto nenhum.
 */
vi.mock('node-fetch', () => ({
    default: async (url: string) => {
        h.fetches.push(url)
        const { pedacos, texto, contentLength } = h.corpo
        async function* gerar() {
            if (texto) {
                const bytes = Buffer.from(texto, 'utf-8')
                for (let i = 0; i < bytes.length; i += PEDACO_DA_PAGINA) {
                    h.puxados++
                    yield bytes.subarray(i, i + PEDACO_DA_PAGINA)
                }
                return
            }
            for (let i = 0; i < pedacos; i++) {
                if (h.destruido) return
                h.puxados++
                yield Buffer.alloc(PEDACO, 0x61)
            }
        }
        const body = Object.assign(gerar(), {
            destroy: () => { h.destruido = true },
        })
        return {
            ok: true,
            status: 200,
            url,
            headers: { get: (nome: string) => (nome.toLowerCase() === 'content-length' ? contentLength : null) },
            body,
            text: async () => {
                const partes: Buffer[] = []
                for await (const pedaco of body) partes.push(pedaco)
                return Buffer.concat(partes).toString('utf-8')
            },
        }
    },
}))

function invocar(canal: string, slug: string): Promise<Resultado> {
    const handler = h.handlers.get(canal)
    if (!handler) throw new Error(`o canal ${canal} não foi registrado`)
    return handler(null, slug) as Promise<Resultado>
}

const SONDAS = ['epg:fetch-meuguia', 'epg:fetch-mitv'] as const

describe('sondas de EPG externo com teto de tamanho (D137)', () => {
    beforeEach(async () => {
        h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-sonda-epg-'))
        h.corpo = { pedacos: 0, texto: '', contentLength: null }
        h.puxados = 0
        h.destruido = false
        h.fetches = []
        h.handlers.clear()
        vi.resetModules()
        const { setupIpcHandlers } = await import('./ipcHandlers')
        setupIpcHandlers()
    })

    afterEach(() => {
        fs.rmSync(h.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    for (const canal of SONDAS) {
        it(`${canal}: corpo sem fim é cortado no teto e a conexão é fechada`, async () => {
            // 3x o teto: sem corte o main materializa tudo (e na vida real, sem fim).
            const total = Math.ceil((3 * JSON_MAX_BYTES) / PEDACO)
            h.corpo = { pedacos: total, texto: '', contentLength: null }

            const resposta = await invocar(canal, 'globo')

            expect(h.fetches.length, 'a sonda nem chegou à rede').toBe(1)
            expect(resposta.success, 'o corpo gigante foi aceito inteiro como grade do canal').toBe(false)
            expect(resposta.html).toBeUndefined()
            // Parou no teto: puxou no máximo o que cabe + o pedaço que estourou.
            expect(
                h.puxados <= Math.floor(JSON_MAX_BYTES / PEDACO) + 1,
                `o handler puxou ${h.puxados} MiB do fio — leu além do teto`,
            ).toBe(true)
            expect(h.destruido, 'a conexão ficou aberta: o site continua empurrando bytes').toBe(true)
        })

        it(`${canal}: Content-Length acima do teto é recusado antes de ler 1 byte`, async () => {
            // Corpo real pequeno (4 MiB, cabe no teto): só o cabeçalho denuncia.
            h.corpo = { pedacos: 4, texto: '', contentLength: String(10 * 1024 * 1024 * 1024) }

            const resposta = await invocar(canal, 'globo')

            expect(resposta.success).toBe(false)
            expect(h.puxados, 'leu o corpo apesar de o tamanho anunciado já passar do teto').toBe(0)
            expect(h.destruido).toBe(true)
        })

        it(`${canal}: página de tamanho normal continua chegando intacta`, async () => {
            const html = `<html><body>${'<li>Jornal Nacional — São Paulo</li>'.repeat(500)}</body></html>`
            h.corpo = { pedacos: 0, texto: html, contentLength: String(Buffer.byteLength(html, 'utf-8')) }

            const resposta = await invocar(canal, 'globo')

            expect(resposta.success).toBe(true)
            expect(h.puxados > 1, 'a página tinha de vir em vários pedaços do fio').toBe(true)
            expect(resposta.html === html, 'a página chegou diferente do que o site mandou').toBe(true)
            expect(h.destruido, 'a conexão de uma página válida foi derrubada').toBe(false)
        })
    }
})
