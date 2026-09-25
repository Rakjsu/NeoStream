/**
 * 🖼️ A pasta de capas nunca guarda arquivo que não seja capa inteira.
 *
 * O `download:cache-image` escrevia o corpo DIRETO no destino final, e o
 * atalho de cache ("já existe? devolve") só olhava `existsSync`. Então o .jpg
 * de 0 byte ou pela metade que sobra quando o provedor corta, a rede cai ou o
 * app fecha passava a ser servido como capa boa para SEMPRE — não há TTL, não
 * há revalidação e não há botão na interface para limpar a pasta.
 *
 * O teste é comportamental: `fs` de verdade num `mkdtemp`, `http`/`https` e
 * `electron` mockados. Ele olha o que SOBRA no disco, não o código.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { urlDeArquivoLocal } from '../src/utils/urlDeArquivoLocal'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type CacheResult = { success: boolean; localPath?: string; error?: string }

const h = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    const { Readable } = await import('node:stream')

    const IMAGEM = Buffer.alloc(64, 0xff)

    const state = {
        /** inteiro = corpo completo; metade = manda metade e a conexão morre. */
        modo: 'inteiro' as 'inteiro' | 'metade',
        /** 'error' emitido sem ninguém escutando — no main de verdade, crash. */
        semDono: [] as Error[],
        handlers: new Map<string, IpcHandler>(),
        userData: '',
    }

    class FakeRequest extends EventEmitter {
        destroyed = false
        setTimeout() { return this }
        destroy() { this.destroyed = true }
    }

    /** Resposta que ANOTA um 'error' sem listener em vez de relançar. */
    class Resposta extends Readable {
        statusCode = 200
        headers: Record<string, string> = {}
        _read() { /* empurrado de fora */ }
        override emit(evento: string | symbol, ...args: unknown[]): boolean {
            if (evento === 'error' && this.listenerCount('error') === 0) {
                state.semDono.push(args[0] as Error)
                return false
            }
            return super.emit(evento, ...args)
        }
    }

    function get(_url: string, cb: (res: Resposta) => void) {
        const req = new FakeRequest()
        const res = new Resposta()
        setTimeout(() => {
            cb(res)
            if (state.modo === 'inteiro') {
                res.push(IMAGEM)
                res.push(null)
            } else {
                res.push(IMAGEM.subarray(0, 32))
                // A conexão morre no meio: nunca chega o 'end'.
                setTimeout(() => res.destroy(new Error('socket hang up')), 5)
            }
        }, 0)
        return req
    }

    return { state, get, IMAGEM }
})

vi.mock('node:http', () => ({ default: { get: h.get }, get: h.get }))
vi.mock('node:https', () => ({ default: { get: h.get }, get: h.get }))
vi.mock('http', () => ({ default: { get: h.get }, get: h.get }))
vi.mock('https', () => ({ default: { get: h.get }, get: h.get }))
vi.mock('electron', () => ({
    app: { getPath: () => h.state.userData, on: () => undefined },
    ipcMain: { handle: (canal: string, fn: IpcHandler) => h.state.handlers.set(canal, fn), on: () => undefined },
    BrowserWindow: { getAllWindows: () => [] },
    shell: { openPath: () => Promise.resolve(''), showItemInFolder: () => undefined },
    dialog: { showSaveDialog: () => Promise.resolve({ canceled: true }) },
    Notification: class { show() { /* noop */ } static isSupported() { return false } },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const capas = () => path.join(h.state.userData, 'downloads', 'covers')

/** Espera uma condição virar verdadeira (teto curto), sem sleep fixo. */
async function esperar(cond: () => boolean, oQue: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
        if (cond()) return
        await new Promise(r => setTimeout(r, 10))
    }
    throw new Error(`esperei demais: ${oQue}`)
}
const arquivosDeCapa = () => (fs.existsSync(capas()) ? fs.readdirSync(capas()) : [])
const cachear = (id: string) =>
    (h.state.handlers.get('download:cache-image') as IpcHandler)(null, { url: 'http://prov.tv/capa.jpg', id }) as Promise<CacheResult>

describe('cache de capa: nada de arquivo pela metade', () => {
    beforeEach(async () => {
        vi.resetModules()
        h.state.handlers.clear()
        h.state.semDono.length = 0
        h.state.modo = 'inteiro'
        h.state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-capa-'))
        const mod = await import('./downloadHandlers')
        mod.setupDownloadHandlers()
    })

    afterEach(() => {
        // Antes do rmSync: um `renameSync` ainda dublado vazaria pro teste seguinte.
        vi.restoreAllMocks()
        fs.rmSync(h.state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('o caminho feliz grava a capa inteira', async () => {
        const r = await cachear('42')
        expect(r.success).toBe(true)
        expect(arquivosDeCapa()).toEqual(['42.jpg'])
        expect(fs.statSync(path.join(capas(), '42.jpg')).size).toBe(h.IMAGEM.length)
    })

    it('o localPath e a URL do arquivo gravado -- tres barras em qualquer sistema', async () => {
        // Fora do Windows o caminho JA comeca com `/` e o main montava
        // `file:////tmp/...` (quatro barras). O oraculo e o `fileURLToPath`
        // do proprio Node: com quatro barras ele devolve `//tmp/...`, que nao
        // e o arquivo. No Windows a letra da unidade nunca comeca com `/`.
        const capa = path.join(capas(), '42.jpg')
        const baixada = await cachear('42')
        const doCache = await cachear('42')

        expect(baixada.success && doCache.success).toBe(true)
        expect(fileURLToPath(baixada.localPath as string), 'capa recem-baixada').toBe(capa)
        expect(fileURLToPath(doCache.localPath as string), 'atalho do cache').toBe(capa)
        // E na MESMA grafia que a tela monta para o resto dos arquivos locais.
        expect(doCache.localPath).toBe(urlDeArquivoLocal(capa))
    })

    it('conexao que morre no meio NAO deixa capa pela metade', async () => {
        h.state.modo = 'metade'
        const r = await cachear('42')

        expect(r.success).toBe(false)
        // No instante em que o handler responde, a capa NAO pode existir: e
        // ela que o atalho de cache serviria para sempre.
        expect(fs.existsSync(path.join(capas(), '42.jpg'))).toBe(false)
        // O .tmp sai logo depois: no Windows nao se apaga arquivo com handle
        // aberto, entao a limpeza espera o 'close' do stream.
        await esperar(() => arquivosDeCapa().length === 0, 'o .tmp continuou no disco')
    })

    it('depois da falha, a proxima tentativa baixa de novo e acerta', async () => {
        // O ponto do item: sem isto, o lixo da primeira tentativa era servido
        // como capa boa para sempre.
        h.state.modo = 'metade'
        await cachear('42')

        h.state.modo = 'inteiro'
        const r = await cachear('42')
        expect(r.success).toBe(true)
        expect(fs.statSync(path.join(capas(), '42.jpg')).size).toBe(h.IMAGEM.length)
    })

    it('a limpeza da tentativa que falhou nao leva junto o temporario da seguinte', async () => {
        // A grade pede a capa de novo assim que a primeira tentativa falha, e
        // a limpeza da primeira ainda esta pendurada no 'close' do stream
        // dela. Com um `.tmp` de nome FIXO ela apagava o arquivo da SEGUNDA,
        // que morria no rename com ENOENT -- a capa nunca mais entrava.
        h.state.modo = 'metade'
        await cachear('42')

        h.state.modo = 'inteiro'
        const segunda = await cachear('42')
        expect(segunda.success, segunda.error).toBe(true)

        // E nenhum temporario sobra depois que as duas assentam.
        await esperar(() => arquivosDeCapa().every(nome => !nome.endsWith('.tmp')), 'sobrou .tmp no disco')
        expect(fs.statSync(path.join(capas(), '42.jpg')).size).toBe(h.IMAGEM.length)
    })

    it('dois pedidos SIMULTANEOS da mesma capa nao escrevem no mesmo arquivo', async () => {
        // Dois cards do mesmo item, ou um re-render: com o `.tmp` fixo os dois
        // downloads escreviam no MESMO arquivo e o rename publicava a mistura.
        //
        // O desfecho sozinho NAO prova isso: desde que o rename que esbarra
        // numa capa ja publicada conta como sucesso, o `.tmp` fixo tambem
        // terminaria verde aqui. Por isso o teste olha ONDE cada pedido
        // escreveu.
        const temporarios: string[] = []
        const criarDeVerdade = fs.createWriteStream.bind(fs)
        vi.spyOn(fs, 'createWriteStream').mockImplementation(
            ((alvo: fs.PathLike, opcoes?: Parameters<typeof fs.createWriteStream>[1]) => {
                temporarios.push(String(alvo))
                return criarDeVerdade(alvo, opcoes)
            }) as typeof fs.createWriteStream,
        )

        const [a, b] = await Promise.all([cachear('42'), cachear('42')])

        expect(temporarios.length, 'os dois pedidos tinham que baixar').toBe(2)
        expect(new Set(temporarios).size, `os dois pedidos escreveram no MESMO temporario: ${temporarios[0]}`).toBe(2)
        expect(a.success && b.success, `${a.error ?? ''} ${b.error ?? ''}`).toBe(true)
        await esperar(() => arquivosDeCapa().every(nome => !nome.endsWith('.tmp')), 'sobrou .tmp no disco')
        // O tamanho denuncia a mistura: dois corpos no mesmo arquivo dobram.
        expect(fs.statSync(path.join(capas(), '42.jpg')).size).toBe(h.IMAGEM.length)
    })

    it('o rename que esbarra na capa que o OUTRO pedido acabou de publicar ainda e sucesso', async () => {
        // No runner Windows do CI isto aconteceu de verdade: dois pedidos da
        // mesma capa terminam juntos, o primeiro publica e o `rename` do
        // segundo por cima do arquivo recem-criado volta EPERM (o antivirus e
        // o indexador abrem arquivo novo). A capa ja esta inteira no cache --
        // o pedido esta atendido, e responder `success:false` fazia a tela
        // cair no fallback por nada. Aqui o EPERM e FORCADO, para o teste nao
        // depender da sorte de um runner lento.
        const renomearDeVerdade = fs.renameSync.bind(fs)
        let chamadas = 0
        vi.spyOn(fs, 'renameSync').mockImplementation((de, para) => {
            chamadas++
            if (chamadas === 2) {
                throw Object.assign(new Error(`EPERM: operation not permitted, rename '${String(de)}' -> '${String(para)}'`), { code: 'EPERM' })
            }
            return renomearDeVerdade(de, para)
        })

        const [a, b] = await Promise.all([cachear('42'), cachear('42')])

        expect(chamadas, 'os dois pedidos tinham que chegar ao rename').toBe(2)
        expect(a.success && b.success, `${a.error ?? ''} ${b.error ?? ''}`).toBe(true)
        expect(a.localPath).toBe(b.localPath)
        // Um dos dois saiu pelo ramo do EPERM: os dois apontam para a capa.
        for (const r of [a, b]) expect(fileURLToPath(r.localPath as string)).toBe(path.join(capas(), '42.jpg'))
        await esperar(() => arquivosDeCapa().every(nome => !nome.endsWith('.tmp')), 'sobrou .tmp no disco')
        expect(fs.statSync(path.join(capas(), '42.jpg')).size).toBe(h.IMAGEM.length)
    })

    it('rename que falha SEM capa nenhuma no destino continua sendo falha', async () => {
        // O outro lado: EPERM de verdade (pasta sem permissao, disco) com o
        // destino vazio nao pode virar sucesso -- a tela receberia um caminho
        // para um arquivo que nao existe.
        vi.spyOn(fs, 'renameSync').mockImplementation(() => {
            throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
        })

        const r = await cachear('42')

        expect(r.success).toBe(false)
        expect(fs.existsSync(path.join(capas(), '42.jpg'))).toBe(false)
        await esperar(() => arquivosDeCapa().every(nome => !nome.endsWith('.tmp')), 'sobrou .tmp no disco')
    })

    it('arquivo de 0 byte ja no disco nao conta como cache', async () => {
        // Sobra de uma versao anterior do app: o arquivo nascia junto com os
        // cabecalhos, entao 0 byte e o estado mais comum do lixo.
        fs.mkdirSync(capas(), { recursive: true })
        fs.writeFileSync(path.join(capas(), '42.jpg'), '')

        const r = await cachear('42')
        expect(r.success).toBe(true)
        expect(fs.statSync(path.join(capas(), '42.jpg')).size).toBe(h.IMAGEM.length)
    })

    it('nenhum erro de stream fica sem dono', async () => {
        // `pipe` nao poe listener de 'error' na origem: sem um explicito, o
        // 'error' sobe como excecao nao capturada e abre o dialogo de crash do
        // Electron (licao epipe-assincrono-stream).
        h.state.modo = 'metade'
        await cachear('42')
        expect(h.state.semDono).toEqual([])
    })
})
