/**
 * 🌐 D205 — o `epg:fetch-meuguia` tem de olhar o status HTTP, como o gêmeo
 * `epg:fetch-mitv` já olha.
 *
 * Os dois handlers são o mesmo desenho (proxy de HTML de uma fonte de EPG
 * externa, para escapar do CORS do renderer). Só o do mi.tv conferia
 * `response.ok`: com o meuguia fora do ar, um slug que virou 404 ou a página
 * de erro de um CDN, o do meuguia respondia `{ success: true, html: <página
 * de erro> }`, o log dizia "Response length: N" como se tivesse dado certo e
 * o renderer mandava a página de erro para o `parseMeuGuiaHTML`.
 *
 * O teste sobe os handlers de verdade (`setupIpcHandlers()`) com a rede
 * (`node-fetch`) de mentira e invoca o canal como o preload invocaria. A
 * última parte atravessa a PONTE inteira: o `epgService.fetchFromMeuGuia` do
 * renderer fala com o handler real por um `window.ipcRenderer` que só
 * repassa (molde de removerPlaylistPelaPonte.test.ts).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

interface RespostaFalsa {
    status: number
    corpo: string
}

const h = vi.hoisted(() => ({
    handlers: new Map<string, IpcHandler>(),
    userData: '',
    /** URLs que SAÍRAM para a rede. */
    fetches: [] as string[],
    /** Quantas vezes alguém leu o corpo (`text()`) da resposta. */
    corposLidos: 0,
    /** O que a "rede" responde a cada pedido. */
    resposta: { status: 200, corpo: '' } as RespostaFalsa,
    /** Tudo o que o main escreveu no log.info, já em texto. */
    logInfo: [] as string[],
}))

vi.mock('electron', () => {
    const registrar = (canal: string, fn: IpcHandler) => { h.handlers.set(canal, fn) }
    return {
        ipcMain: { handle: registrar, handleOnce: registrar, on: () => undefined, removeHandler: () => undefined },
        BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
        dialog: {},
        screen: {},
        shell: {},
        app: { getPath: () => h.userData, getVersion: () => '0.0.0', getName: () => 'neostream' },
    }
})

// Store em memória, DESLOGADO: nada de provedor se mexe no setup.
vi.mock('./store', () => {
    const dados = new Map<string, unknown>([
        ['auth', { url: '', username: '', password: '' }],
        ['playlists', []],
    ])
    return {
        default: {
            get: (chave: string) => dados.get(chave),
            set: (chave: string, valor: unknown) => { dados.set(chave, valor) },
            delete: (chave: string) => { dados.delete(chave) },
        },
    }
})
vi.mock('./logger', () => ({
    default: {
        info: (...partes: unknown[]) => { h.logInfo.push(partes.map(String).join(' ')) },
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
    },
}))
vi.mock('./mpvPlayer', () => ({ esconderMpvParaDialogo: () => undefined }))

vi.mock('node-fetch', () => ({
    default: async (url: string) => {
        h.fetches.push(url)
        const { status, corpo } = h.resposta
        return {
            ok: status >= 200 && status < 300,
            status,
            url,
            headers: { get: () => null },
            // O handler lê o corpo pelo `.text()` OU pelo stream `body` (leitura
            // com teto, #D137): os dois caminhos contam como "corpo lido".
            text: async () => { h.corposLidos++; return corpo },
            body: (async function* () { h.corposLidos++; yield Buffer.from(corpo, 'utf-8') })(),
        }
    },
}))

import { setupIpcHandlers } from './ipcHandlers'
import { epgService } from '../src/services/epgService'

function invocar(canal: string, ...args: unknown[]): Promise<unknown> {
    const handler = h.handlers.get(canal)
    if (!handler) throw new Error(`o canal ${canal} não foi registrado`)
    return handler(null, ...args)
}

const PAGINA_DE_ERRO = '<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>'

/** Grade no formato que o `parseMeuGuiaHTML` reconhece. */
const GRADE_DO_MEUGUIA =
    '<ul><li><div class="time">10:00</div><h2>Jornal da Tarde</h2></li>' +
    '<li><div class="time">11:00</div><h2>Filme Longo</h2></li></ul>'

describe('epg:fetch-meuguia confere o status HTTP (D205)', () => {
    beforeAll(() => {
        h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-meuguia-status-'))
        h.handlers.clear()
        setupIpcHandlers()
    })

    beforeEach(() => {
        h.fetches = []
        h.corposLidos = 0
        h.logInfo = []
    })

    afterAll(() => {
        fs.rmSync(h.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('um 404 do meuguia vira falha, não "sucesso" com a página de erro no html', async () => {
        h.resposta = { status: 404, corpo: PAGINA_DE_ERRO }

        const resultado = await invocar('epg:fetch-meuguia', 'canal-que-sumiu')

        // 404 é definitivo: uma ida só à rede, sem nova tentativa.
        expect(h.fetches).toEqual(['https://meuguia.tv/programacao/canal/canal-que-sumiu'])
        expect(resultado).toEqual({ success: false, error: 'HTTP 404' })
        // A página de erro nem é lida, e o log não finge que deu certo.
        expect(h.corposLidos).toBe(0)
        expect(h.logInfo.some(linha => linha.includes('Response length'))).toBe(false)
        expect(h.logInfo.some(linha => linha.includes('meuguia') && linha.includes('404'))).toBe(true)
    })

    it('um 403 (página de bloqueio do CDN) também vira falha', async () => {
        h.resposta = { status: 403, corpo: '<html><body>Access denied</body></html>' }

        const resultado = await invocar('epg:fetch-meuguia', 'globo')

        expect(resultado).toEqual({ success: false, error: 'HTTP 403' })
        expect(h.corposLidos).toBe(0)
    })

    it('meuguia fora do ar (503): a nova tentativa continua, e o status final vira falha', async () => {
        h.resposta = { status: 503, corpo: '<html><body>Service Unavailable</body></html>' }

        const resultado = await invocar('epg:fetch-meuguia', 'globo')

        // 5xx é transitório: o fetchWithRetry tenta de novo (duas idas à rede).
        expect(h.fetches).toEqual([
            'https://meuguia.tv/programacao/canal/globo',
            'https://meuguia.tv/programacao/canal/globo',
        ])
        expect(resultado).toEqual({ success: false, error: 'HTTP 503' })
        expect(h.corposLidos).toBe(0)
    })

    it('o 200 continua entregando o html', async () => {
        const html = '<html><body><ul><li>programa</li></ul></body></html>'
        h.resposta = { status: 200, corpo: html }

        const resultado = await invocar('epg:fetch-meuguia', 'globo')

        expect(resultado).toEqual({ success: true, html })
        expect(h.corposLidos).toBe(1)
        expect(h.logInfo.some(linha => linha.includes('Response length'))).toBe(true)
    })

    it('o slug continua indo codificado na URL', async () => {
        h.resposta = { status: 200, corpo: '<html></html>' }

        await invocar('epg:fetch-meuguia', 'sportv 2')

        expect(h.fetches).toEqual(['https://meuguia.tv/programacao/canal/sportv%202'])
    })

    it('mesmo contrato do gêmeo epg:fetch-mitv para o mesmo 404', async () => {
        h.resposta = { status: 404, corpo: PAGINA_DE_ERRO }

        const meuguia = await invocar('epg:fetch-meuguia', 'x')
        const mitv = await invocar('epg:fetch-mitv', 'x')

        expect(meuguia).toEqual(mitv)
        expect(meuguia).toEqual({ success: false, error: 'HTTP 404' })
    })

    describe('pela ponte: renderer (epgService) → handler real', () => {
        beforeEach(() => {
            ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
                invoke: (canal: string, ...args: unknown[]) => invocar(canal, ...args),
            }
        })

        afterEach(() => {
            delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer
            vi.restoreAllMocks()
        })

        it('com 200, a grade do meuguia chega ao renderer e vira programas', async () => {
            h.resposta = { status: 200, corpo: GRADE_DO_MEUGUIA }

            // "HBO Signature" está no mapeamento empacotado do meuguia (slug HFE).
            const programas = await epgService.fetchFromMeuGuia('HBO Signature')

            expect(h.fetches).toEqual(['https://meuguia.tv/programacao/canal/HFE'])
            expect(programas.map(p => p.title)).toEqual(['Jornal da Tarde', 'Filme Longo'])
        })

        it('com 404, o renderer recebe falha: a página de erro nem chega ao parser', async () => {
            h.resposta = { status: 404, corpo: PAGINA_DE_ERRO }
            const parse = vi.spyOn(epgService, 'parseMeuGuiaHTML')

            const programas = await epgService.fetchFromMeuGuia('HBO Signature')

            expect(h.fetches).toEqual(['https://meuguia.tv/programacao/canal/HFE'])
            expect(programas).toEqual([])
            expect(parse).not.toHaveBeenCalled()
        })
    })
})
