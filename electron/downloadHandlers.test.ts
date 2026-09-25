/**
 * Testes do `download:start` com `electron` e o módulo http mockados.
 *
 * O que se prova aqui é o vazamento: o `clearInterval` do timer de progresso
 * ficava DEPOIS do `await Promise.all(...)`, então todo caminho que não era o
 * feliz (provedor cortando a conexão, pause, cancelamento) deixava um
 * `setInterval` de 500 ms batendo IPC e na barra de tarefas até o app fechar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type StartResult = { success: boolean; filePath?: string; size?: number; error?: string }

interface FakeOptions {
    method?: string
    headers?: Record<string, string>
}

const h = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events')
    const { Readable } = await import('node:stream')

    const state = {
        /**
         * ok = 206 com os bytes; chunk-error = provedor devolve 500;
         * hang = nunca responde; parcial = manda metade e fica aberto (é o
         * estado em que um download real passa a maior parte do tempo).
         * sem-range = HEAD sem content-length (cai na conexão única) e o GET
         * manda metade do arquivo e fica aberto.
         */
        mode: 'ok' as 'ok' | 'chunk-error' | 'hang' | 'parcial' | 'sem-range',
        totalBytes: 400,
        requests: [] as { options: FakeOptions; destroyed: boolean }[],
        handlers: new Map<string, IpcHandler>(),
        sends: [] as { channel: string; payload: unknown }[],
        taskbar: [] as (number | null)[],
        userData: '',
        /**
         * D066: `destroy()` como o Node de verdade. Com a resposta já
         * entregue, `req.destroy()` NÃO emite 'error' (nem na request, nem no
         * stream de escrita do pipe) — só 'close'. Conferido num servidor http
         * real: a promessa do chunk fica pendurada até alguém fechar o arquivo.
         * Desligado, o fake emite 'error' sempre (é o provedor derrubando a
         * conexão), que é o que os testes mais antigos simulam.
         */
        destroyComoNode: false,
        /** D066: roda DEPOIS de o merge juntar tudo e antes do handler responder. */
        depoisDoMerge: null as null | (() => Promise<void>),
        /** A resposta aberta do modo sem-range (conexão única). */
        respostaUnica: null as null | { destroyed: boolean },
    }

    class FakeRequest extends EventEmitter {
        destroyed = false
        /** A resposta já foi entregue ao callback. */
        respondeu = false
        readonly cb: (res: unknown) => void
        constructor(readonly options: FakeOptions, cb: (res: unknown) => void) {
            super()
            this.cb = res => { this.respondeu = true; cb(res) }
        }
        setTimeout() { return this }
        end() { respond(this) }
        destroy() {
            if (this.destroyed) return
            this.destroyed = true
            if (state.destroyComoNode && this.respondeu) {
                this.emit('close')
                return
            }
            this.emit('error', new Error('conexão destruída'))
        }
    }

    function respond(req: FakeRequest) {
        if (state.mode === 'sem-range') {
            if (req.options.method === 'HEAD') {
                req.cb({ statusCode: 200, headers: {} })
                return
            }
            const aberto = new Readable({ read() { /* empurrado abaixo */ } }) as unknown as {
                statusCode: number
                headers: Record<string, string>
                push: (chunk: Buffer | null) => void
            }
            aberto.statusCode = 200
            aberto.headers = { 'content-length': String(state.totalBytes) }
            state.respostaUnica = aberto as unknown as { destroyed: boolean }
            req.cb(aberto)
            aberto.push(Buffer.alloc(state.totalBytes / 2, 0x42))
            return
        }
        if (req.options.method === 'HEAD') {
            req.cb({
                statusCode: 200,
                headers: { 'content-length': String(state.totalBytes), 'accept-ranges': 'bytes' },
            })
            return
        }
        if (state.mode === 'chunk-error') {
            req.cb({ statusCode: 500, headers: {} })
            return
        }
        // 'hang': fica pendurado até alguém chamar destroy() (pause/cancel).
        if (state.mode === 'hang') return

        const range = /bytes=(\d+)-(\d+)/.exec(String(req.options.headers?.Range ?? ''))
        const start = Number(range?.[1] ?? 0)
        const end = Number(range?.[2] ?? 0)

        // 'parcial': entrega metade do pedaço e NÃO fecha o stream — é assim
        // que um download de verdade passa quase todo o tempo, e é o estado em
        // que a barra ficava parada em 0%.
        if (state.mode === 'parcial') {
            const aberto = new Readable({ read() { /* empurrado abaixo */ } }) as unknown as {
                statusCode: number
                headers: Record<string, string>
                push: (chunk: Buffer | null) => void
            }
            aberto.statusCode = 206
            aberto.headers = {}
            req.cb(aberto)
            aberto.push(Buffer.alloc(Math.floor((end - start + 1) / 2), 0x41))
            return
        }
        const response = Readable.from([Buffer.alloc(end - start + 1, 0x41)]) as unknown as {
            statusCode: number
            headers: Record<string, string>
        }
        response.statusCode = 206
        response.headers = {}
        req.cb(response)
    }

    const request = (options: FakeOptions, cb: (res: unknown) => void) => {
        const req = new FakeRequest(options, cb)
        state.requests.push(req)
        return req
    }

    return { state, request }
})

vi.mock('http', () => ({ default: { request: h.request } }))
vi.mock('https', () => ({ default: { request: h.request } }))
vi.mock('electron', () => ({
    ipcMain: { handle: (channel: string, fn: IpcHandler) => h.state.handlers.set(channel, fn) },
    app: { getPath: () => h.state.userData },
    BrowserWindow: {
        getAllWindows: () => [{
            webContents: {
                send: (channel: string, payload: unknown) => h.state.sends.push({ channel, payload }),
            },
        }],
    },
    shell: { openPath: () => undefined },
    Notification: Object.assign(function FakeNotification() { /* nunca instanciado */ },
        { isSupported: () => false }),
}))
vi.mock('./winIntegration', () => ({
    setTaskbarProgress: (value: number | null) => h.state.taskbar.push(value),
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// O merge é o de verdade (arquivos reais); o gancho só abre a janela entre
// "juntou tudo" e "o handler respondeu" para o teste do D066.
vi.mock('./juntarPartes', async (importOriginal) => {
    const original = await importOriginal<typeof import('./juntarPartes')>()
    return {
        juntarPartes: async (destino: string, partes: string[]) => {
            await original.juntarPartes(destino, partes)
            if (h.state.depoisDoMerge) await h.state.depoisDoMerge()
        },
    }
})

import { setupDownloadHandlers } from './downloadHandlers'

const state = h.state
const invoke = (channel: string, args: unknown) =>
    (state.handlers.get(channel) as IpcHandler)(null, args)

const start = (id = 'dl-1') => invoke('download:start', {
    id, url: 'http://provedor.tv/filme.mp4', name: 'Filme', type: 'movie',
}) as Promise<StartResult>

/** Drena microtasks até as 4 conexões dos chunks existirem (sem timers). */
async function waitForChunkRequests(count = 4) {
    for (let i = 0; i < 50; i++) {
        if (state.requests.filter(r => r.options.method === 'GET').length >= count) return
        await Promise.resolve()
    }
    throw new Error('as conexões dos chunks nunca foram criadas')
}

/**
 * Prova de que nada ficou vivo: nenhum timer pendente e, mesmo avançando 5 s
 * (10 disparos do intervalo de 500 ms), zero IPC e zero toque na taskbar.
 */
function expectNoZombieTimer() {
    expect(vi.getTimerCount()).toBe(0)
    const sends = state.sends.length
    const taskbar = state.taskbar.length
    vi.advanceTimersByTime(5000)
    expect(state.sends.length).toBe(sends)
    expect(state.taskbar.length).toBe(taskbar)
}

describe('download:start — limpeza do intervalo de progresso', () => {
    beforeEach(() => {
        // setImmediate/process.nextTick precisam continuar REAIS: o merge dos
        // chunks usa streams de arquivo de verdade.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        state.mode = 'ok'
        state.totalBytes = 400
        state.requests = []
        state.sends = []
        state.taskbar = []
        state.handlers.clear()
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-dl-'))
        setupDownloadHandlers()
    })

    afterEach(() => {
        vi.useRealTimers()
        fs.rmSync(state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('caminho feliz continua baixando, mesclando e sem deixar timer', async () => {
        const result = await start()

        expect(result.success).toBe(true)
        expect(result.size).toBe(400)
        expect(fs.statSync(result.filePath!).size).toBe(400)
        expect(state.sends.some(s => (s.payload as { progress: number }).progress === 100)).toBe(true)
        expectNoZombieTimer()
    })

    it('a barra anda com os bytes que CHEGAM, não só quando um pedaço termina', async () => {
        // O contador só somava no `.then` de um chunk concluído. Como as quatro
        // conexões dividem a mesma banda e terminam quase juntas, a tela ficava
        // sem barra (ela só aparece com progress > 0) e sem MB/s durante quase
        // todo o download, e depois saltava em degraus de ~25%.
        state.mode = 'parcial'

        const running = start('dl-progresso')
        await waitForChunkRequests()

        // Quantos avisos de progresso já saíram com bytes na conta.
        const andando = () => state.sends.filter(s => {
            const p = s.payload as { progress: number; downloadedBytes: number }
            return s.channel === 'download:progress' && p.downloadedBytes > 0 && p.progress < 100
        }).length

        // Espera por CONDIÇÃO, não por um número fixo de tiques. O caminho do
        // Readable até o `response.on('data')` passa por nextTick, setImmediate
        // e pelo open assíncrono do arquivo de saída — quantas voltas isso leva
        // depende da carga da máquina, e um `for` de 5 tiques passava na minha
        // e falhava na suíte cheia. (setImmediate é REAL aqui: não está na
        // lista do useFakeTimers.)
        for (let volta = 0; volta < 100 && andando() === 0; volta++) {
            await new Promise(r => setImmediate(r))
            vi.advanceTimersByTime(500)
        }

        // Sem o repasse por chunk recebido, o modo 'parcial' nunca fecha um
        // pedaço: nenhum aviso teria bytes e o laço acima esgota.
        expect(andando()).toBeGreaterThan(0)

        await invoke('download:cancel', { id: 'dl-progresso' })
        await running
        expectNoZombieTimer()
    })

    it('chunk falha (provedor corta) → o intervalo de 500 ms morre junto', async () => {
        state.mode = 'chunk-error'

        const result = await start()

        expect(result.success).toBe(false)
        expectNoZombieTimer()
    })

    it('cancelamento no meio → o intervalo de 500 ms morre junto', async () => {
        state.mode = 'hang'

        const running = start('dl-cancel')
        await waitForChunkRequests()
        await invoke('download:cancel', { id: 'dl-cancel' })
        const result = await running

        expect(result.success).toBe(false)
        expectNoZombieTimer()
    })

    it('pause no meio → o intervalo de 500 ms morre junto', async () => {
        state.mode = 'hang'

        const running = start('dl-pause')
        await waitForChunkRequests()
        await invoke('download:pause', { id: 'dl-pause' })
        const result = await running

        expect(result.success).toBe(false)
        expectNoZombieTimer()
    })

    it('duas falhas seguidas não acumulam dois timers zumbis', async () => {
        state.mode = 'chunk-error'

        await start('dl-a')
        await start('dl-b')

        expectNoZombieTimer()
    })
})

/**
 * 💽 `download:get-storage-info` varre a pasta inteira de downloads, síncrono,
 * no event loop do main — o mesmo que está lendo os sockets. A página pedia
 * isso a cada evento de progresso (um por chunk de socket no caminho de
 * conexão única). A tela já deixou de pedir; aqui fica a rede de segurança
 * para o próximo chamador que não souber disso.
 */
describe('download:get-storage-info — uma varredura por rajada', () => {
    beforeEach(() => {
        // Date precisa ser falso: o TTL do cache é medido com Date.now().
        vi.useFakeTimers({ toFake: ['Date'] })
        state.handlers.clear()
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-esp-'))
        const raiz = path.join(state.userData, 'downloads')
        fs.mkdirSync(path.join(raiz, 'series', 'S', 'Temporada 1'), { recursive: true })
        fs.mkdirSync(path.join(raiz, 'movies'), { recursive: true })
        fs.writeFileSync(path.join(raiz, 'movies', 'a.mp4'), Buffer.alloc(100))
        fs.writeFileSync(path.join(raiz, 'series', 'S', 'Temporada 1', 'Ep1.mp4'), Buffer.alloc(200))
        setupDownloadHandlers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        fs.rmSync(state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    const espaco = async () => (await invoke('download:get-storage-info', {})) as { used: number }

    it('vinte pedidos na mesma janela custam UMA varredura', async () => {
        const espiao = vi.spyOn(fs, 'readdirSync')
        expect((await espaco()).used).toBe(300)
        const umaVarredura = espiao.mock.calls.length
        expect(umaVarredura).toBeGreaterThan(1) // desceu nas subpastas mesmo

        for (let i = 0; i < 20; i++) await espaco()

        expect(espiao.mock.calls.length).toBe(umaVarredura)
    })

    it('passado o TTL, o número anda — o cache não mente pra sempre', async () => {
        expect((await espaco()).used).toBe(300)

        fs.rmSync(path.join(state.userData, 'downloads', 'series', 'S', 'Temporada 1', 'Ep1.mp4'))
        expect((await espaco()).used).toBe(300) // ainda na janela

        vi.advanceTimersByTime(1500)
        expect((await espaco()).used).toBe(100)
    })
})

/**
 * 🗑️ D066 — cancelar ou excluir um download que não terminou deixava os
 * pedaços no disco para sempre.
 *
 * O caminho paralelo grava em `<arquivo>.part0..3` e só apagava as partes no
 * merge de um download bem-sucedido. O `download:cancel` destruía as conexões
 * e esquecia os arquivos; e o renderer só mandava apagar `item.filePath`, que
 * só existe no SUCESSO. Resultado: GBs de `.partN` que nenhuma tela lista e
 * que a pessoa nunca mais consegue tirar pelo app.
 *
 * O que NÃO pode mudar: a PAUSA mantém as partes — é o resume do
 * `downloadChunk` (Range a partir do tamanho do `.partN`).
 */
describe('download:cancel — as sobras de um download que não terminou saem do disco', () => {
    /** Todo stream de escrita que o handler abrir (partes, arquivo único, merge). */
    let escritas: { caminho: string; escrita: fs.WriteStream }[] = []

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        state.mode = 'parcial'
        state.totalBytes = 400
        state.requests = []
        state.sends = []
        state.taskbar = []
        state.handlers.clear()
        state.destroyComoNode = true
        state.depoisDoMerge = null
        state.respostaUnica = null
        state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-d066-'))
        escritas = []
        const criar = fs.createWriteStream
        vi.spyOn(fs, 'createWriteStream').mockImplementation(((...args: Parameters<typeof criar>) => {
            const escrita = criar(...args)
            escritas.push({ caminho: String(args[0]), escrita })
            return escrita
        }) as typeof criar)
        setupDownloadHandlers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        state.destroyComoNode = false
        state.depoisDoMerge = null
        fs.rmSync(state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    /** O que o renderer manda: o suficiente pro main recalcular o caminho. */
    const descritor = { name: 'Filme', type: 'movie' }
    const pastaDeFilmes = () => path.join(state.userData, 'downloads', 'movies')
    const partes = () => fs.existsSync(pastaDeFilmes())
        ? fs.readdirSync(pastaDeFilmes()).filter(nome => /\.part\d+$/.test(nome)).sort()
        : []
    const tamanho = (arquivo: string) => {
        try { return fs.statSync(arquivo).size } catch { return 0 }
    }

    /**
     * Espera a CONDIÇÃO, nunca um número fixo de voltas: a escrita passa pelo
     * threadpool do libuv e o tempo depende da carga da máquina. setImmediate
     * e Date são reais neste bloco.
     */
    async function esperar(condicao: () => boolean, oque: string) {
        const limite = Date.now() + 10_000
        while (!condicao()) {
            if (Date.now() > limite) throw new Error(`nunca aconteceu: ${oque}`)
            await new Promise(r => setImmediate(r))
        }
    }

    /**
     * `quantas` escritas cujo caminho casa com `padrao` já gravaram e estão
     * PARADAS — nenhum write em voo. É o estado de um download esperando o
     * próximo pacote, e é nele que o Node não avisa nada ao destruir a
     * request: só fechar o arquivo solta a promessa. (Com um write em voo, o
     * próprio write falha e mascara a falta desse caminho.)
     */
    const ociosas = (padrao: RegExp, quantas: number) => () => {
        const alvo = escritas.filter(e => padrao.test(e.caminho))
        return alvo.length === quantas
            && alvo.every(e => e.escrita.bytesWritten > 0 && e.escrita.writableLength === 0)
    }
    const partesOciosas = ociosas(/\.part\d+$/, 4)

    it('cancelar no meio apaga os .partN e o download:start termina', async () => {
        const rodando = start('dl-d066')
        await esperar(partesOciosas, 'as 4 partes gravadas e paradas')

        // Node real: destruir as requests não derruba o chunk — quem solta a
        // promessa é o arquivo sendo fechado pelo cancel.
        expect(await invoke('download:cancel', { id: 'dl-d066', ...descritor })).toEqual({ success: true })
        const resultado = await rodando

        expect(resultado.success).toBe(false)
        expect(partes()).toEqual([])
    })

    it('o cancel só responde com os arquivos FECHADOS (Windows não apaga arquivo aberto)', async () => {
        const rodando = start('dl-handles')
        await esperar(partesOciosas, 'as 4 partes gravadas e paradas')

        await invoke('download:cancel', { id: 'dl-handles', ...descritor })

        expect(escritas).toHaveLength(4)
        expect(escritas.every(e => e.escrita.closed)).toBe(true)
        await rodando
    })

    it('pausar MANTÉM as partes; excluir o pausado depois as apaga e solta o start', async () => {
        const rodando = start('dl-pausado')
        await esperar(partesOciosas, 'as 4 partes gravadas e paradas')

        await invoke('download:pause', { id: 'dl-pausado' })
        // O resume depende delas — a pausa não pode ter apagado nada.
        expect(partes()).toHaveLength(4)

        // No Node real o start do pausado segue pendurado (nada fecha os
        // arquivos): o main ainda conhece a entrada, e o cancel vai por ela.
        expect(await invoke('download:cancel', { id: 'dl-pausado', ...descritor })).toEqual({ success: true })

        expect(partes()).toEqual([])
        expect((await rodando).success).toBe(false)
    })

    it('download que o main já ESQUECEU (falhou, app reaberto): o descritor acha as partes', async () => {
        // Provedor derrubando a conexão: o start falha e o `finally` tira a
        // entrada do mapa — as partes ficam para o resume.
        state.destroyComoNode = false
        const rodando = start('dl-esquecido')
        await esperar(partesOciosas, 'as 4 partes gravadas e paradas')
        await invoke('download:pause', { id: 'dl-esquecido' })
        expect((await rodando).success).toBe(false)
        expect(partes()).toHaveLength(4)

        const resposta = await invoke('download:cancel', { id: 'dl-esquecido', ...descritor })

        expect(resposta).toEqual({ success: false, error: 'Download not found' })
        expect(partes()).toEqual([])
    })

    it('episódio esquecido: série, temporada e episódio do descritor levam às partes certas', async () => {
        state.destroyComoNode = false
        const episodio = { name: 'Dark', type: 'episode', seriesName: 'Dark', season: 2, episode: 5 }
        const pasta = path.join(state.userData, 'downloads', 'series', 'Dark', 'Temporada 2')
        const partesDoEp = () => fs.existsSync(pasta)
            ? fs.readdirSync(pasta).filter(nome => /^Ep5\.mp4\.part\d+$/.test(nome))
            : []
        const rodando = invoke('download:start', {
            id: 'dl-ep', url: 'http://provedor.tv/ep.mp4', ...episodio,
        }) as Promise<StartResult>
        await esperar(ociosas(/Ep5\.mp4\.part\d+$/, 4), 'as 4 partes do episódio gravadas e paradas')
        await invoke('download:pause', { id: 'dl-ep' })
        await rodando
        expect(partesDoEp()).toHaveLength(4)

        await invoke('download:cancel', { id: 'dl-ep', ...episodio })

        expect(partesDoEp()).toEqual([])
    })

    it('cancelar a conexão única apaga o arquivo pela metade e NÃO devolve sucesso', async () => {
        // Antes: `stream.close()` chamava end(), o 'finish' disparava e o
        // download cancelado voltava como SUCESSO com um arquivo truncado.
        state.mode = 'sem-range'
        const rodando = start('dl-unico')
        const arquivo = path.join(pastaDeFilmes(), 'Filme.mp4')
        await esperar(ociosas(/Filme\.mp4$/, 1), 'metade do arquivo gravada e parada')

        await invoke('download:cancel', { id: 'dl-unico', ...descritor })
        const resultado = await rodando

        expect(resultado.success).toBe(false)
        expect(fs.existsSync(arquivo)).toBe(false)
        // E a conexão com o provedor cai: sem isto o socket ficava aberto,
        // parado pelo backpressure, ocupando uma das conexões da conta.
        expect(state.respostaUnica?.destroyed).toBe(true)
    })

    it('cancelar no fim da junção leva o arquivo final e NÃO devolve sucesso', async () => {
        // A janela: o merge já copiou a última parte (o arquivo final tem
        // todos os bytes) e o handler ainda não respondeu. Sem apagar o final
        // aqui, a checagem de integridade passava e o cancelado virava SUCESSO.
        state.mode = 'ok'
        let noFimDoMerge = false
        let soltarMerge: () => void = () => undefined
        state.depoisDoMerge = () => new Promise<void>(resolve => {
            noFimDoMerge = true
            soltarMerge = resolve
        })
        const rodando = start('dl-merge')
        await esperar(() => noFimDoMerge, 'o merge terminar de juntar')
        const arquivo = path.join(pastaDeFilmes(), 'Filme.mp4')
        expect(tamanho(arquivo)).toBe(400)

        await invoke('download:cancel', { id: 'dl-merge', ...descritor })
        soltarMerge()
        const resultado = await rodando

        expect(resultado.success).toBe(false)
        expect(fs.existsSync(arquivo)).toBe(false)
    })

    it('o arquivo de um download CONCLUÍDO nunca é apagado pelo cancel', async () => {
        state.mode = 'ok'
        const resultado = await start('dl-pronto')
        expect(resultado.success).toBe(true)

        await invoke('download:cancel', { id: 'dl-pronto', ...descritor })

        expect(tamanho(resultado.filePath!)).toBe(400)
    })

    it('cancelar na fase das PARTES não leva um arquivo que já estava no destino', async () => {
        // Outro título que sanitiza pro mesmo nome, ou um concluído que saiu da
        // lista: o arquivo final já existe antes da junção. Até o merge começar
        // ele não é DESTE download — o cancel só pode levar as partes.
        fs.mkdirSync(pastaDeFilmes(), { recursive: true })
        const destino = path.join(pastaDeFilmes(), 'Filme.mp4')
        fs.writeFileSync(destino, 'já estava aqui')
        const rodando = start('dl-por-cima')
        await esperar(partesOciosas, 'as 4 partes gravadas e paradas')

        await invoke('download:cancel', { id: 'dl-por-cima', ...descritor })
        await rodando

        expect(partes()).toEqual([])
        expect(fs.readFileSync(destino, 'utf8')).toBe('já estava aqui')
    })

    it('não apaga as partes de OUTRO download ativo com o mesmo destino', async () => {
        const rodando = start('dl-vivo')
        await esperar(partesOciosas, 'as 4 partes gravadas e paradas')

        // Outro id, mesmo nome/tipo: o main não conhece `dl-fantasma`, mas as
        // partes que o descritor aponta são do `dl-vivo`, que segue baixando.
        await invoke('download:cancel', { id: 'dl-fantasma', ...descritor })
        expect(partes()).toHaveLength(4)

        await invoke('download:cancel', { id: 'dl-vivo', ...descritor })
        await rodando
    })

    it('🔒 descritor hostil não apaga nada fora da pasta de downloads', async () => {
        // `type` chega do renderer e entra no caminho: `..` sobe para userData.
        const fora = path.join(state.userData, 'Filme.mp4.part0')
        fs.writeFileSync(fora, 'não é do app')

        await invoke('download:cancel', { id: 'dl-hostil', name: 'Filme', type: '..' })

        expect(fs.existsSync(fora)).toBe(true)
    })
})
