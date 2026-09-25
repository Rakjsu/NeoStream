/**
 * D132 — "Verificar favoritos" tratava QUALQUER host da lista como o provedor.
 *
 * O `diagnostics:probe-urls` chamava `resolveProviderHttpsAgent(url, url)`: a
 * própria URL sondada virava o "provedor de referência", então o
 * `isProviderUrl` dava `true` pra qualquer host. Numa lista M3U os streams
 * apontam pra onde a lista quiser (CDN de terceiro, host de outra pessoa) — e
 * cada um com certificado inválido abria o diálogo "Certificado inválido do
 * provedor"; um "Confiar" ali gravava o domínio alheio em
 * `trustedInvalidCertDomains` e `approvedProviderHosts` PRA SEMPRE, desligando
 * o TLS dele também no player (Chromium) e no resto do main.
 *
 * O handler sobe de verdade (`setupIpcHandlers()`), com o certificatePolicy
 * REAL por trás: só a rede (axios), o TLS (handshake falso que responde
 * "certificado vencido") e o diálogo são falsos. Nesse mundo falso TODO
 * certificado está vencido, então o axios falso só "conecta" com o agent
 * permissivo — igual ao Node de verdade. Afirma-se:
 *  - host FORA do provedor ativo: nem pergunta, nem grava confiança, a
 *    sonda sai com a validação TLS normal (agent `undefined`) e o canal
 *    volta como fora do ar;
 *  - host DO provedor ativo continua no modo compatível: pergunta, e com o
 *    "Confiar" a sonda sai com o agent permissivo e o canal volta vivo
 *    (nada de regressão pra painel com certificado próprio);
 *  - num lote misto, cada URL é julgada contra o provedor ATIVO, não contra
 *    si mesma nem contra a vizinha.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type Resposta = { success: boolean; results?: { id: string; alive: boolean }[] }

const h = vi.hoisted(() => ({
    handlers: new Map<string, Handler>(),
    /** URL → httpsAgent com que o handler foi à "rede". */
    pedidas: [] as { url: string; agent: unknown }[],
    /** Resposta do diálogo de certificado: 1 = "Confiar neste provedor". */
    resposta: 1,
    perguntas: [] as string[],
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: (canal: string, fn: Handler) => { h.handlers.set(canal, fn) },
        on: () => undefined,
        removeHandler: () => undefined,
    },
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null, fromWebContents: () => null },
    dialog: {
        showMessageBox: async (opcoes: { message?: string }) => {
            h.perguntas.push(String(opcoes?.message ?? ''))
            return { response: h.resposta }
        },
    },
    screen: {},
    shell: {},
    session: {},
    app: {
        getPath: () => '',
        getVersion: () => '0.0.0',
        getName: () => 'neostream',
        on: () => undefined,
        whenReady: () => new Promise(() => undefined),
        // Pronto: sem isto o certificatePolicy nunca pergunta nada.
        isReady: () => true,
    },
}))

vi.mock('./store', () => {
    const dados = new Map<string, unknown>([['auth', {}], ['playlists', []], ['settings', {}]])
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
vi.mock('./catalogCache', () => ({
    cachedCatalogFetch: async (_id: string, _kind: string, fetcher: () => Promise<unknown>) =>
        ({ data: await fetcher(), fromCache: false }),
    invalidatePlaylistCache: () => undefined,
}))

// TLS falso: todo handshake estrito falha com certificado vencido, sem rede.
// O certificatePolicy importa `'tls'` cru; o `vi.hoisted` assíncrono evita o
// "Cannot access before initialization" do EventEmitter.
const tlsFake = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    class SocketFalso extends EventEmitter {
        destroy() { /* o probe sempre destrói o socket */ }
    }
    return {
        connect: () => {
            const socket = new SocketFalso()
            setImmediate(() => socket.emit('error', Object.assign(new Error('expirado'), { code: 'CERT_HAS_EXPIRED' })))
            return socket
        },
    }
})
vi.mock('tls', () => ({ default: { connect: tlsFake.connect } }))

vi.mock('axios', () => {
    const get = async (url: string, config?: { httpsAgent?: { options?: { rejectUnauthorized?: boolean } } }) => {
        h.pedidas.push({ url, agent: config?.httpsAgent })
        // Todo certificado deste mundo falso está vencido: sem o agent
        // permissivo, o handshake de verdade falharia antes do status.
        if (url.startsWith('https:') && config?.httpsAgent?.options?.rejectUnauthorized !== false) {
            throw Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })
        }
        // Canal que o provedor tirou do ar: responde, mas com 404.
        const status = url.includes('/morto') ? 404 : 200
        return { status, data: Readable.from([Buffer.alloc(16)]) }
    }
    return { default: { get, post: get, head: get, isAxiosError: () => false } }
})

import store from './store'
import { setupIpcHandlers } from './ipcHandlers'
import { saveAndActivatePlaylist } from './playlistManager'

const LISTA = 'https://lista.provedor-m3u.com/get/lista.m3u'
const DO_PROVEDOR = 'https://cdn2.provedor-m3u.com/live/canal-1.ts'
const DE_TERCEIRO = 'https://stream.terceiro-qualquer.net/live/canal-2.ts'
const MORTO_NO_PROVEDOR = 'http://cdn2.provedor-m3u.com/live/morto-3.ts'

async function sondar(targets: { id: string; url: string }[]): Promise<Resposta> {
    const fn = h.handlers.get('diagnostics:probe-urls')
    expect(fn, 'canal diagnostics:probe-urls não registrado').toBeTruthy()
    return (await fn!({}, { targets })) as Resposta
}

function confianca() {
    const s = (store.get('settings') || {}) as { trustedInvalidCertDomains?: string[]; approvedProviderHosts?: string[] }
    return {
        dominios: s.trustedInvalidCertDomains ?? [],
        hosts: s.approvedProviderHosts ?? [],
    }
}

describe('D132 — a sonda de favoritos só usa o modo compatível no host do provedor ativo', () => {
    beforeAll(() => { setupIpcHandlers() })
    beforeEach(() => {
        h.pedidas.length = 0
        h.perguntas.length = 0
        h.resposta = 1
        store.set('settings', {})
        saveAndActivatePlaylist({ name: 'Lista', url: LISTA, username: 'm3u', password: 'm3u', type: 'm3u' })
    })

    it('stream de host alheio numa lista M3U: não pergunta, não grava confiança e valida o TLS', async () => {
        const r = await sondar([{ id: '2', url: DE_TERCEIRO }])
        expect(r.success).toBe(true)
        expect(r.results, 'o canal de certificado vencido fora do provedor tem que voltar fora do ar')
            .toEqual([{ id: '2', alive: false }])

        expect(h.perguntas, 'a sonda abriu o diálogo "certificado do provedor" pra um host de terceiro').toEqual([])
        const { dominios, hosts } = confianca()
        expect(dominios.includes('terceiro-qualquer.net'), 'domínio de terceiro ficou com o TLS desligado pra sempre').toBe(false)
        expect(hosts.includes('stream.terceiro-qualquer.net'), 'host de terceiro virou "provedor aprovado"').toBe(false)

        const pedida = h.pedidas.find(p => p.url === DE_TERCEIRO)
        expect(pedida, 'a sonda nem foi à rede').toBeTruthy()
        expect(pedida!.agent, 'a sonda do host alheio saiu sem validar o certificado').toBeUndefined()
    })

    it('stream do próprio provedor continua no modo compatível (pergunta e, com o sim, sonda com o agent permissivo)', async () => {
        const r = await sondar([{ id: '1', url: DO_PROVEDOR }])
        expect(r.success).toBe(true)
        expect(r.results, 'o canal do provedor aceito tem que voltar vivo').toEqual([{ id: '1', alive: true }])

        expect(h.perguntas.length, 'o provedor com certificado próprio perdeu o modo compatível').toBe(1)
        expect(confianca().dominios.includes('provedor-m3u.com')).toBe(true)
        expect(confianca().hosts.includes('cdn2.provedor-m3u.com')).toBe(true)

        const pedida = h.pedidas.find(p => p.url === DO_PROVEDOR)
        expect(pedida).toBeTruthy()
        expect((pedida!.agent as { options?: { rejectUnauthorized?: boolean } })?.options?.rejectUnauthorized).toBe(false)
    })

    it('lote misto: só o domínio do provedor ativo ganha confiança; o alheio sai validado e fora do ar', async () => {
        const r = await sondar([
            { id: '2', url: DE_TERCEIRO },
            { id: '1', url: DO_PROVEDOR },
            { id: '3', url: MORTO_NO_PROVEDOR },
        ])
        expect(r.success).toBe(true)
        expect(r.results).toEqual([
            { id: '2', alive: false },
            { id: '1', alive: true },
            { id: '3', alive: false },
        ])

        expect(h.perguntas.length, 'só o provedor ativo pode abrir o diálogo').toBe(1)
        expect(h.perguntas[0].includes('stream.terceiro-qualquer.net')).toBe(false)
        const { dominios, hosts } = confianca()
        expect(dominios).toEqual(['provedor-m3u.com'])
        expect(hosts.includes('stream.terceiro-qualquer.net')).toBe(false)
        expect(h.pedidas.find(p => p.url === DE_TERCEIRO)!.agent).toBeUndefined()
    })

    it('confiança já salva: vale pro provedor ativo, mas NÃO pra domínio alheio que ficou de fora dos hosts aprovados', async () => {
        // Domínio do provedor já confiado antes e um domínio alheio que uma
        // versão antiga deixou na lista de confiança (sem host aprovado).
        store.set('settings', { trustedInvalidCertDomains: ['provedor-m3u.com', 'terceiro-qualquer.net'] })

        const r = await sondar([{ id: '1', url: DO_PROVEDOR }, { id: '2', url: DE_TERCEIRO }])
        expect(r.results).toEqual([{ id: '1', alive: true }, { id: '2', alive: false }])
        expect(h.perguntas, 'com a confiança salva não há o que perguntar').toEqual([])

        const doProvedor = h.pedidas.find(p => p.url === DO_PROVEDOR)!
        expect((doProvedor.agent as { options?: { rejectUnauthorized?: boolean } })?.options?.rejectUnauthorized).toBe(false)
        expect(h.pedidas.find(p => p.url === DE_TERCEIRO)!.agent, 'domínio alheio saiu sem validar o TLS').toBeUndefined()

        const { hosts } = confianca()
        expect(hosts.includes('cdn2.provedor-m3u.com'), 'o host do provedor usado com o sim salvo não foi lembrado').toBe(true)
        expect(hosts.includes('stream.terceiro-qualquer.net')).toBe(false)
    })
})
