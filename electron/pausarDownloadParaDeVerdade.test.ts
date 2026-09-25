// @vitest-environment node
/**
 * ⏸ D179 — pausar um download tem que PARAR o download.
 *
 * Três buracos, todos no main (electron/downloadHandlers.ts):
 *
 *  1. Conexão única (provedor que não responde HEAD direito, ou não manda
 *     tamanho): a entrada guardava `request: null` e nenhum `requests[]`, então
 *     o `download:pause` só ligava um booleano que ninguém lia. O filme seguia
 *     baixando em velocidade cheia, ocupando uma das conexões da conta, com a
 *     tela mostrando ⏸ — e quando o provedor terminava de mandar, o
 *     `download:start` voltava SUCESSO e o item "despausava" sozinho como
 *     concluído.
 *  2. Pausa durante o HEAD: ainda não havia entrada nenhuma no main, o pause
 *     respondia "Download not found" e o download seguia (o renderer marcava
 *     pausado mesmo assim).
 *  3. Caminho paralelo: destruir as requests com a resposta já entregue NÃO
 *     avisa o stream de escrita (Node real: nem 'error', nem 'finish', nem
 *     'close'). O `download:start` do pausado ficava pendurado para sempre e o
 *     renderer nunca devolvia a vaga da fila — com o limite de simultâneos
 *     cheio de pausados, o "retomar" não começava nada.
 *
 * Aqui não há `http` falso: o provedor é um servidor HTTP de verdade em
 * 127.0.0.1 e o teste cobra o efeito que a pessoa sente — a conexão com o
 * provedor cai, o start termina, e o resume continua de onde parou.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type StartResult = { success: boolean; filePath?: string; size?: number; error?: string }

const h = vi.hoisted(() => ({
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
    userData: '',
}))

vi.mock('electron', () => ({
    ipcMain: { handle: (canal: string, fn: IpcHandler) => h.handlers.set(canal, fn) },
    app: { getPath: () => h.userData },
    BrowserWindow: { getAllWindows: () => [] },
    shell: { openPath: () => undefined, showItemInFolder: () => undefined },
    Notification: Object.assign(function NotificacaoFalsa() { /* nunca instanciada */ },
        { isSupported: () => false }),
}))
vi.mock('./winIntegration', () => ({ setTaskbarProgress: () => undefined }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupDownloadHandlers } from './downloadHandlers'

/** Conteúdo determinístico: o resume tem que remontar exatamente isto. */
const TOTAL = 64 * 1024
const CONTEUDO = Buffer.from(Array.from({ length: TOTAL }, (_, i) => i % 251))

/**
 * sem-range: HEAD sem tamanho → conexão única; o GET manda metade e fica aberto.
 * get-mudo: HEAD sem tamanho → conexão única; o GET nunca é respondido.
 * head-mudo: o HEAD nunca é respondido.
 * head-redirect-mudo: o HEAD manda para outro endereço, e o HEAD de lá nunca é respondido.
 * range-metade: HEAD com tamanho e Range; cada GET manda metade do pedaço e fica aberto.
 * range-inteiro: idem, mas cada GET entrega o pedaço pedido inteiro.
 */
type Cenario = 'sem-range' | 'get-mudo' | 'head-mudo' | 'head-redirect-mudo' | 'range-metade' | 'range-inteiro'

interface Conexao {
    metodo: string
    caminho: string
    range?: string
    res: http.ServerResponse
    fechada: boolean
}

let cenario: Cenario = 'sem-range'
let conexoes: Conexao[] = []
let servidor: http.Server
let base = ''

function atender(req: http.IncomingMessage, res: http.ServerResponse) {
    const conexao: Conexao = {
        metodo: req.method ?? '', caminho: req.url ?? '', range: req.headers.range, res, fechada: false,
    }
    conexoes.push(conexao)
    res.on('close', () => { conexao.fechada = true })

    if (req.method === 'HEAD') {
        if (cenario === 'head-mudo') return
        if (cenario === 'head-redirect-mudo') {
            if (req.url === '/cdn/filme.mp4') return
            res.writeHead(302, { location: `${base}/cdn/filme.mp4` })
            res.end()
            return
        }
        if (cenario === 'sem-range' || cenario === 'get-mudo') {
            res.writeHead(200)
            res.end()
            return
        }
        res.writeHead(200, { 'content-length': String(TOTAL), 'accept-ranges': 'bytes' })
        res.end()
        return
    }

    if (cenario === 'get-mudo') return
    if (cenario === 'sem-range') {
        res.writeHead(200, { 'content-length': String(TOTAL) })
        res.write(CONTEUDO.subarray(0, TOTAL / 2))
        return
    }

    const faixa = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range ?? ''))
    const inicio = Number(faixa?.[1] ?? 0)
    const fim = Number(faixa?.[2] ?? TOTAL - 1)
    const pedaco = CONTEUDO.subarray(inicio, fim + 1)
    res.writeHead(206, { 'content-length': String(pedaco.length) })
    if (cenario === 'range-inteiro') {
        res.end(pedaco)
        return
    }
    res.write(pedaco.subarray(0, Math.floor(pedaco.length / 2)))
}

const invoke = (canal: string, args: unknown) =>
    (h.handlers.get(canal) as IpcHandler)(null, args)

const start = (id: string) => invoke('download:start', {
    id, url: `${base}/filme.mp4`, name: 'Filme', type: 'movie',
}) as Promise<StartResult>

const pastaDeFilmes = () => path.join(h.userData, 'downloads', 'movies')
const arquivoFinal = () => path.join(pastaDeFilmes(), 'Filme.mp4')
const tamanho = (arquivo: string) => {
    try { return fs.statSync(arquivo).size } catch { return 0 }
}
const partes = () => Array.from({ length: 4 }, (_, i) => `${arquivoFinal()}.part${i}`)

/**
 * Espera a CONDIÇÃO (nunca um número fixo de voltas): socket, threadpool do
 * libuv e fechamento de arquivo não assentam em microtask.
 */
async function esperar(condicao: () => boolean, oque: string, limiteMs = 5000) {
    const limite = Date.now() + limiteMs
    while (!condicao()) {
        if (Date.now() > limite) throw new Error(`nunca aconteceu: ${oque}`)
        await new Promise(r => setTimeout(r, 5))
    }
}

/**
 * Acompanha a promessa sem prender o teste nela (o start pendurado era o bug)
 * e anota a ORDEM em que as respostas saem do main.
 */
function acompanhar<T>(promessa: Promise<T>, nome: string, ordem: string[]) {
    const estado: { resultado: T | null } = { resultado: null }
    void promessa.then(r => {
        estado.resultado = r
        ordem.push(nome)
    })
    return estado
}

describe('D179 — pausar um download para o download de verdade', () => {
    beforeEach(async () => {
        cenario = 'sem-range'
        conexoes = []
        h.handlers.clear()
        h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-d179-'))
        servidor = http.createServer(atender)
        await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', () => resolve()))
        base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
        setupDownloadHandlers()
    })

    afterEach(async () => {
        vi.restoreAllMocks()
        servidor.closeAllConnections()
        await new Promise<void>(resolve => servidor.close(() => resolve()))
        try {
            fs.rmSync(h.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
        } catch {
            // Só acontece com o bug de volta: o arquivo do download pendurado
            // continua aberto e o Windows não apaga — a falha real já foi dita.
        }
    })

    it('conexão única: a pausa derruba a conexão com o provedor e solta o start', async () => {
        cenario = 'sem-range'
        const ordem: string[] = []
        const rodando = acompanhar(start('dl-unico'), 'start', ordem)
        await esperar(() => tamanho(arquivoFinal()) > 0, 'metade do arquivo gravada')
        const get = conexoes.find(c => c.metodo === 'GET')!

        const pausa = acompanhar(invoke('download:pause', { id: 'dl-unico' }), 'pause', ordem)

        // Antes: a pausa não tocava em nada deste caminho e o socket seguia
        // aberto, ocupando uma das conexões que a conta do provedor permite.
        await esperar(() => get.fechada, 'a conexão com o provedor cair')
        await esperar(() => rodando.resultado !== null, 'o download:start do pausado terminar')
        expect(pausa.resultado).toEqual({ success: true })
        expect(rodando.resultado!.success).toBe(false)
        // A resposta da pausa tem que chegar ao renderer ANTES da falha do
        // start: é o status 'paused' que faz o renderer ler essa falha como
        // pausa (e não como "falhou", com notificação).
        expect(ordem).toEqual(['pause', 'start'])
        // Sem Range não há resume: retomar recomeça do zero. O pedaço gravado
        // não serve pra nada e tem o NOME do arquivo final.
        await esperar(() => !fs.existsSync(arquivoFinal()), 'o pedaço inútil sair do disco')
    }, 20_000)

    it('conexão única: o provedor terminar de mandar depois da pausa NÃO vira concluído', async () => {
        cenario = 'sem-range'
        const rodando = start('dl-despausa')
        await esperar(() => tamanho(arquivoFinal()) > 0, 'metade do arquivo gravada')
        const get = conexoes.find(c => c.metodo === 'GET')!

        await invoke('download:pause', { id: 'dl-despausa' })
        // O provedor manda o resto, se ainda tiver para onde mandar.
        if (!get.fechada && !get.res.writableEnded) get.res.end(CONTEUDO.subarray(TOTAL / 2))

        // Antes: o resto chegava, o 'finish' disparava e o start voltava
        // SUCESSO — o item pausado aparecia como concluído.
        const resultado = await rodando
        expect(resultado.success).toBe(false)
        await esperar(() => !fs.existsSync(arquivoFinal()), 'o pedaço inútil sair do disco')
    }, 20_000)

    it('conexão única: pausar enquanto o provedor ainda não respondeu o GET derruba o pedido', async () => {
        cenario = 'get-mudo'
        const rodando = start('dl-get-mudo')
        await esperar(() => conexoes.some(c => c.metodo === 'GET'), 'o GET chegar ao provedor')
        const get = conexoes.find(c => c.metodo === 'GET')!

        expect(await invoke('download:pause', { id: 'dl-get-mudo' })).toEqual({ success: true })

        const resultado = await rodando
        expect(resultado.success).toBe(false)
        await esperar(() => get.fechada, 'o GET pendurado cair')
        expect(fs.existsSync(arquivoFinal())).toBe(false)
        // O main não segura a entrada de um download que já acabou.
        expect(await invoke('download:pause', { id: 'dl-get-mudo' }))
            .toEqual({ success: false, error: 'Download not found' })
    }, 20_000)

    it('conexão única: retomar enquanto o arquivo do pausado ainda fecha não apaga o arquivo do download novo', async () => {
        cenario = 'sem-range'
        const primeiro = start('dl-retoma')
        await esperar(() => tamanho(arquivoFinal()) > 0, 'metade do arquivo gravada')

        // Segura o fechamento do arquivo do pausado: é a ordem em que o
        // threadpool do libuv entrega o 'close' DEPOIS de o resume já ter
        // aberto o mesmo destino — e o 'close' do pausado apaga o pedaço.
        const fecharDeVerdade = fs.close
        let fechamentoSegurado: (() => void) | null = null
        vi.spyOn(fs, 'close').mockImplementation(((fd: number, cb: (erro: NodeJS.ErrnoException | null) => void) => {
            if (!fechamentoSegurado) {
                fechamentoSegurado = () => fecharDeVerdade(fd, cb)
                return
            }
            fecharDeVerdade(fd, cb)
        }) as typeof fs.close)

        await invoke('download:pause', { id: 'dl-retoma' })
        await esperar(() => fechamentoSegurado !== null, 'o arquivo do pausado começar a fechar')

        const retomado = start('dl-retoma')
        await esperar(
            () => conexoes.filter(c => c.metodo === 'GET').length === 2 && tamanho(arquivoFinal()) >= TOTAL / 2,
            'o download retomado gravar a metade dele',
        )
        const segundoGet = conexoes.filter(c => c.metodo === 'GET')[1]

        fechamentoSegurado!()
        expect((await primeiro).success).toBe(false)
        segundoGet.res.end(CONTEUDO.subarray(TOTAL / 2))

        const resultado = await retomado
        expect(resultado.success).toBe(true)
        expect(fs.readFileSync(arquivoFinal()).equals(CONTEUDO)).toBe(true)
    }, 20_000)

    it('pausar durante o HEAD vale: o main lembra da pausa e nem abre o GET', async () => {
        cenario = 'head-mudo'
        const rodando = start('dl-head')
        await esperar(() => conexoes.some(c => c.metodo === 'HEAD'), 'o HEAD chegar ao provedor')

        // Antes: "Download not found" — ainda não havia entrada no main.
        expect(await invoke('download:pause', { id: 'dl-head' })).toEqual({ success: true })

        const resultado = await rodando
        expect(resultado.success).toBe(false)
        expect(conexoes.some(c => c.metodo === 'GET')).toBe(false)
        // E o HEAD pendurado não fica segurando uma conexão da conta.
        await esperar(() => conexoes.every(c => c.fechada), 'o HEAD pendurado cair')
    }, 20_000)

    it('pausar durante o HEAD que foi redirecionado derruba o HEAD do novo endereço', async () => {
        cenario = 'head-redirect-mudo'
        const rodando = start('dl-head-cdn')
        await esperar(() => conexoes.some(c => c.caminho === '/cdn/filme.mp4'), 'o HEAD chegar ao novo endereço')

        expect(await invoke('download:pause', { id: 'dl-head-cdn' })).toEqual({ success: true })

        const resultado = await rodando
        expect(resultado.success).toBe(false)
        expect(conexoes.some(c => c.metodo === 'GET')).toBe(false)
        await esperar(() => conexoes.every(c => c.fechada), 'o HEAD pendurado cair')
    }, 20_000)

    it('caminho paralelo: a pausa solta o start, mantém as partes e o resume continua de onde parou', async () => {
        cenario = 'range-metade'
        const ordem: string[] = []
        const rodando = acompanhar(start('dl-paralelo'), 'start', ordem)
        await esperar(
            () => conexoes.filter(c => c.metodo === 'GET').length === 4
                && partes().every(parte => tamanho(parte) > 0),
            'as 4 partes com bytes no disco',
        )

        const pausa = acompanhar(invoke('download:pause', { id: 'dl-paralelo' }), 'pause', ordem)

        // Antes: pendurado para sempre — o arquivo de cada parte seguia aberto
        // e o renderer nunca devolvia a vaga da fila.
        await esperar(() => rodando.resultado !== null, 'o download:start do pausado terminar')
        expect(pausa.resultado).toEqual({ success: true })
        expect(rodando.resultado!.success).toBe(false)
        expect(ordem).toEqual(['pause', 'start'])
        await esperar(() => conexoes.every(c => c.fechada), 'as 4 conexões com o provedor caírem')

        // A pausa não apaga nada: é destas partes que o resume depende.
        const pedaco = TOTAL / 4
        const gravado = partes().map(tamanho)
        expect(gravado.every(t => t > 0 && t < pedaco)).toBe(true)

        // Retomar: o provedor agora entrega tudo o que for pedido.
        cenario = 'range-inteiro'
        const antes = conexoes.length
        const retomado = await start('dl-paralelo')

        expect(retomado.success).toBe(true)
        expect(fs.readFileSync(retomado.filePath!).equals(CONTEUDO)).toBe(true)
        // E pediu só o que faltava de cada parte, não o pedaço inteiro de novo.
        const faixas = conexoes.slice(antes).filter(c => c.metodo === 'GET').map(c => c.range).sort()
        const esperadas = gravado
            .map((t, i) => `bytes=${i * pedaco + t}-${(i + 1) * pedaco - 1}`)
            .sort()
        expect(faixas).toEqual(esperadas)
    }, 20_000)

    it('pausar um download que o main não conhece continua respondendo "not found"', async () => {
        expect(await invoke('download:pause', { id: 'dl-inexistente' }))
            .toEqual({ success: false, error: 'Download not found' })
    })
})
