/**
 * 🎬 O mpv precisa aceitar o arquivo que o PRÓPRIO app gravou ou baixou.
 *
 * O mpv é o único player do app que decodifica o `.ts` puro que o DVR grava:
 * o player interno é o Chromium e o `useHls` só liga o hls.js quando a fonte
 * tem `.m3u8`. Mesmo assim o `mpv:play` recusava qualquer coisa que não
 * começasse com http(s) — a gravação caía no player interno e não tocava.
 * Não é regressão do MPV (o `.ts` nunca tocou lá dentro): é capacidade
 * desperdiçada, com o paliativo de abrir no player do sistema.
 *
 * O teste é COMPORTAMENTAL: chama o handler `mpv:play` de verdade, com
 * arquivos de verdade nas pastas de verdade do app (um %TEMP% próprio), e
 * olha o que foi entregue ao `spawn`. E cobra o outro lado da moeda: abrir
 * arquivo do disco não pode virar "abra qualquer coisa que o renderer mandar"
 * — fora das nossas pastas continua recusado.
 *
 * O último bloco é de unidade, no molde do `pareceLegendaNoDisco` em
 * mpvProtocol.test.ts: as formas que NENHUMA pasta de teste consegue montar
 * numa máquina só (UNC de rede, caminho de POSIX rodando no Windows).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { caminhoDeMidiaNoDisco } from './mpvProtocol'
import { urlDeArquivoLocal } from '../src/utils/urlDeArquivoLocal'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type Resultado = { success: boolean; reason?: string }

const estado = vi.hoisted(() => ({
    raiz: '',
    sep: '',
    mpv: '',
    handlers: new Map<string, IpcHandler>(),
    spawns: [] as { comando: string; args: string[] }[],
}))

vi.mock('electron', () => ({
    app: {
        getPath: (nome: string) => `${estado.raiz}${estado.sep}${nome}`,
        on: () => undefined,
        isReady: () => true,
        whenReady: () => Promise.resolve(),
    },
    ipcMain: { handle: (canal: string, fn: IpcHandler) => estado.handlers.set(canal, fn) },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    net: { request: () => new EventEmitter() },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    shell: { openPath: async () => '', showItemInFolder: () => undefined },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
}))

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./store', () => ({
    default: {
        get: (chave: string) => (chave === 'settings' ? { mpvPath: estado.mpv } : undefined),
        set: () => undefined,
    },
}))

vi.mock('node:child_process', () => {
    const spawn = (comando: string, args: string[]) => {
        estado.spawns.push({ comando, args })
        const filho = new EventEmitter() as EventEmitter & { exitCode: number | null; killed: boolean; kill: () => void }
        filho.exitCode = null
        filho.killed = false
        filho.kill = () => { filho.killed = true }
        return filho
    }
    return { default: { spawn }, spawn }
})

vi.mock('node:net', () => {
    const connect = () => {
        const socket = new EventEmitter() as EventEmitter & { destroy: () => void; write: () => boolean; destroyed: boolean }
        socket.destroyed = false
        socket.destroy = () => { socket.destroyed = true }
        socket.write = () => true
        return socket
    }
    return { default: { connect }, connect }
})

/**
 * A URL que o app entrega ao `mpv:play`, montada pela MESMA função que a
 * página de Downloads e o downloadService usam. Uma imitação local (era um
 * `file:///${...}` escrito aqui) divergia do app sem ninguém ver: no Linux ela
 * dava `file:////tmp/...` e o teste acusava o mpv, não a montagem.
 */
const comoUrlDoRenderer = urlDeArquivoLocal

const tocar = (url: string) =>
    (estado.handlers.get('mpv:play') as IpcHandler)({ sender: {} }, { url, title: 'Um título' }) as Promise<Resultado>

/** Último argumento do spawn — o `buildMpvArgs` põe a fonte depois do `--`. */
const fonteEntregueAoMpv = () => estado.spawns.at(-1)?.args.at(-1)

describe('mpv:play com arquivo do disco', () => {
    let gravacoes = ''
    let downloads = ''
    let mpvPlayer: typeof import('./mpvPlayer') | null = null

    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.spawns.length = 0
        estado.raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'neostream-mpvlocal-'))
        estado.sep = path.sep
        fs.mkdirSync(path.join(estado.raiz, 'temp'), { recursive: true })

        // mpv "instalado": o caminho configurado que existe é o primeiro que
        // o resolveMpvPath aceita, então nada sonda o PATH da máquina.
        estado.mpv = path.join(estado.raiz, 'mpv.exe')
        fs.writeFileSync(estado.mpv, '')

        // As duas pastas que o app controla, montadas onde o main as procura.
        gravacoes = path.join(estado.raiz, 'videos', 'NeoStream', 'Gravacoes')
        downloads = path.join(estado.raiz, 'userData', 'downloads')
        fs.mkdirSync(gravacoes, { recursive: true })
        fs.mkdirSync(downloads, { recursive: true })

        mpvPlayer = await import('./mpvPlayer')
        mpvPlayer.setupMpvHandlers()
        expect(estado.handlers.get('mpv:play'), 'o canal mpv:play sumiu').toBeDefined()
    })

    afterEach(() => {
        mpvPlayer?.stopMpv()
        mpvPlayer = null
        fs.rmSync(estado.raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    })

    it('a gravacao .ts do DVR chega ao mpv', async () => {
        const arquivo = path.join(gravacoes, 'Canal 5 - 2026-09-17.ts')
        fs.writeFileSync(arquivo, 'mpegts')

        const resultado = await tocar(comoUrlDoRenderer(arquivo))

        expect(resultado.success, `o mpv recusou a gravacao (${resultado.reason})`).toBe(true)
        expect(estado.spawns.length, 'nenhum mpv foi aberto').toBe(1)
        // O caminho NATIVO — o que a guarda conferiu no disco, não a string
        // crua do renderer. Entregar outra coisa seria tocar o que não foi
        // validado.
        expect(fonteEntregueAoMpv()).toBe(arquivo)
    })

    it('o download offline com espaco no nome tambem chega ao mpv', async () => {
        const arquivo = path.join(downloads, 'Meu Filme.mp4')
        fs.writeFileSync(arquivo, 'mp4')

        const resultado = await tocar(comoUrlDoRenderer(arquivo))

        expect(resultado.success, `o mpv recusou o download (${resultado.reason})`).toBe(true)
        expect(fonteEntregueAoMpv()).toBe(arquivo)
    })

    it('arquivo fora das pastas do app continua recusado', async () => {
        const alheio = path.join(estado.raiz, 'alheio')
        fs.mkdirSync(alheio, { recursive: true })
        const arquivo = path.join(alheio, 'coisa.ts')
        fs.writeFileSync(arquivo, 'mpegts')

        const resultado = await tocar(comoUrlDoRenderer(arquivo))

        expect(resultado.success).toBe(false)
        expect(resultado.reason).toBe('invalid-url')
        expect(estado.spawns.length, 'abriu o mpv em arquivo que nao e nosso').toBe(0)
    })

    it('o .. que escapa da pasta de gravacoes e recusado', async () => {
        const alheio = path.join(estado.raiz, 'alheio')
        fs.mkdirSync(alheio, { recursive: true })
        fs.writeFileSync(path.join(alheio, 'coisa.ts'), 'mpegts')

        const resultado = await tocar(`${comoUrlDoRenderer(gravacoes)}/../../../alheio/coisa.ts`)

        expect(resultado.success).toBe(false)
        expect(estado.spawns.length, 'o .. atravessou a guarda').toBe(0)
    })

    it('arquivo que nao e video e recusado mesmo dentro da pasta certa', async () => {
        // O que entrega ao processo externo é o renderer; a pasta do DVR não
        // guarda só vídeo (tem .jpg de miniatura) e a de downloads recebe
        // arquivo com o nome que o provedor mandou.
        const arquivo = path.join(downloads, 'instalador.exe')
        fs.writeFileSync(arquivo, 'MZ')

        const resultado = await tocar(comoUrlDoRenderer(arquivo))

        expect(resultado.success).toBe(false)
        expect(estado.spawns.length, 'o mpv foi aberto em cima de um .exe').toBe(0)
    })

    it('arquivo que nao existe na pasta certa e recusado', async () => {
        const resultado = await tocar(comoUrlDoRenderer(path.join(gravacoes, 'nunca-gravado.ts')))

        expect(resultado.success).toBe(false)
        expect(estado.spawns.length).toBe(0)
    })

    it('o caminho nativo cru, sem file://, tambem e aceito', async () => {
        // Três lugares montam o `file:///` (a página de Downloads e os dois
        // getOffline* do downloadService, todos via urlDeArquivoLocal). A
        // guarda valida a MESMA coisa nas duas grafias, então trocar uma
        // delas pelo caminho nativo não
        // quebra a reprodução — e nem afrouxa nada: o confinamento e o
        // existsSync valem igual (o caso de fora das pastas, acima, entra por
        // esta mesma porta).
        const arquivo = path.join(gravacoes, 'Cru.ts')
        fs.writeFileSync(arquivo, 'mpegts')

        const resultado = await tocar(arquivo)

        expect(resultado.success, `o mpv recusou o caminho nativo (${resultado.reason})`).toBe(true)
        expect(fonteEntregueAoMpv()).toBe(arquivo)
    })

    it('o stream http do provedor continua passando', async () => {
        const resultado = await tocar('http://provedor.exemplo/live/1.m3u8')

        expect(resultado.success, `o caminho http quebrou (${resultado.reason})`).toBe(true)
        expect(fonteEntregueAoMpv()).toBe('http://provedor.exemplo/live/1.m3u8')
    })

    it('url vazia e lixo continuam recusados', async () => {
        for (const url of ['', 'javascript:alert(1)', 'C:/nao/e/url.ts']) {
            estado.spawns.length = 0
            const resultado = await tocar(url)
            expect(resultado.success, `passou com "${url}"`).toBe(false)
            expect(estado.spawns.length).toBe(0)
        }
    })
})

describe('caminhoDeMidiaNoDisco', () => {
    // As formas que a pasta temporária do teste não consegue montar: uma é
    // uma máquina na rede, a outra é outro sistema operacional.
    it('desmonta o file:/// das duas famílias de caminho', () => {
        expect(caminhoDeMidiaNoDisco('file:///C:/Videos/NeoStream/a.ts')).toBe('C:/Videos/NeoStream/a.ts')
        // Sem isto o app só funcionaria no Windows: o terceiro `/` do
        // `file:///` É a raiz no Linux e no macOS, e comê-lo transforma
        // `/home/rak/a.mp4` no caminho relativo `home/rak/a.mp4`.
        expect(caminhoDeMidiaNoDisco('file:///home/rak/Vídeos/a.mp4')).toBe('/home/rak/Vídeos/a.mp4')
    })

    it('a URL que o app monta volta ao mesmo caminho nas duas famílias', () => {
        // A pasta temporária desta máquina só exercita UM estilo de caminho;
        // o outro sai daqui, com strings puras. Era o POSIX que quebrava: o
        // app montava `file:////home/...` e a guarda (com razão) lia UNC.
        const posix = '/home/rak/Vídeos/NeoStream/Gravacoes/Canal 5 - 2026-09-17.ts'
        expect(urlDeArquivoLocal(posix)).toBe('file:///home/rak/Vídeos/NeoStream/Gravacoes/Canal 5 - 2026-09-17.ts')
        expect(caminhoDeMidiaNoDisco(urlDeArquivoLocal(posix))).toBe(posix)

        const macos = '/Users/rak/Library/Application Support/NeoStream/downloads/Meu Filme.mp4'
        expect(caminhoDeMidiaNoDisco(urlDeArquivoLocal(macos))).toBe(macos)

        // Nada é codificado de um lado nem decodificado do outro: `%` e
        // acento chegam iguais ao que está no disco.
        const windows = 'C:\\Users\\rak\\Videos\\NeoStream\\Gravações\\Promo 50%.ts'
        expect(urlDeArquivoLocal(windows)).toBe('file:///C:/Users/rak/Videos/NeoStream/Gravações/Promo 50%.ts')
        expect(caminhoDeMidiaNoDisco(urlDeArquivoLocal(windows))).toBe('C:/Users/rak/Videos/NeoStream/Gravações/Promo 50%.ts')
    })

    it('recusa UNC — o mpv abriria uma conexão de rede', () => {
        expect(caminhoDeMidiaNoDisco('file://servidor/share/a.ts')).toBeNull()
        // Quatro barras continuam recusadas, de propósito: no Windows
        // `file:////servidor/share` É a grafia de UNC, e aceitar "comendo uma
        // barra" daria à guarda duas leituras para a mesma string. Quem
        // montava quatro barras era o app — consertado na montagem
        // (urlDeArquivoLocal), não afrouxando aqui.
        expect(caminhoDeMidiaNoDisco('file:////servidor/share/a.ts')).toBeNull()
        expect(caminhoDeMidiaNoDisco('file:////home/rak/a.ts')).toBeNull()
        expect(caminhoDeMidiaNoDisco('\\\\servidor\\share\\a.ts')).toBeNull()
        // `file://C:/...` tem DUAS barras: o que vem depois delas é o nome da
        // máquina, e "C:" como host não é o disco local.
        expect(caminhoDeMidiaNoDisco('file://C:/Videos/a.ts')).toBeNull()
    })

    it('recusa esquema de rede, relativo, extensão de fora e lixo', () => {
        expect(caminhoDeMidiaNoDisco('http://provedor.exemplo/a.ts')).toBeNull()
        expect(caminhoDeMidiaNoDisco('gravacoes/a.ts')).toBeNull()
        expect(caminhoDeMidiaNoDisco('file:///C:/Windows/System32/cmd.exe')).toBeNull()
        expect(caminhoDeMidiaNoDisco('file:///C:/')).toBeNull()
        expect(caminhoDeMidiaNoDisco('')).toBeNull()
        expect(caminhoDeMidiaNoDisco(null)).toBeNull()
    })
})

describe('ninguém monta file:// na mão', () => {
    // Guarda estrutural: os sete pontos que concatenavam
    // `file:///${caminho.replace(...)}` (Downloads, downloadService,
    // NotificationsPanel, a capa em cache do downloadHandlers) passaram a
    // chamar urlDeArquivoLocal. Os de caminho vindo do renderer têm caso
    // POSIX com strings puras (gravacaoSaiDaTelaComoArquivo, downloadService);
    // os do main só veem o caminho do sistema em que rodam, então no Windows
    // é esta guarda que pega a volta da concatenação — em qualquer grafia:
    // template (`file:///${`) ou soma (`'file:///' +`).
    const CONCATENA_FILE_URL = /file:\/\/\/?(?:\$\{|['"`]\s*\+)/
    const RAIZ = path.join(__dirname, '..')
    const AJUDANTE = path.join(RAIZ, 'src', 'utils', 'urlDeArquivoLocal.ts')

    const fontes = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap(entrada => {
            const cheio = path.join(dir, entrada.name)
            if (entrada.isDirectory()) return fontes(cheio)
            return /\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name) ? [cheio] : []
        })

    it('só o urlDeArquivoLocal concatena `file://` com um caminho', () => {
        const culpados = [...fontes(path.join(RAIZ, 'src')), ...fontes(path.join(RAIZ, 'electron'))]
            .filter(arquivo => arquivo !== AJUDANTE)
            .filter(arquivo => CONCATENA_FILE_URL.test(fs.readFileSync(arquivo, 'utf-8')))
            .map(arquivo => path.relative(RAIZ, arquivo))
        expect(culpados).toEqual([])
    })

    it('a guarda reconhece as grafias da concatenação', () => {
        // Sem isto, uma regex quebrada deixaria a lista acima vazia pra sempre.
        expect(CONCATENA_FILE_URL.test('`file:///${p.replace(/\\\\/g, "/")}`')).toBe(true)
        expect(CONCATENA_FILE_URL.test("'file:///' + p")).toBe(true)
        expect(CONCATENA_FILE_URL.test('"file://" + p')).toBe(true)
        expect(CONCATENA_FILE_URL.test('urlDeArquivoLocal(p)')).toBe(false)
        expect(CONCATENA_FILE_URL.test("url.startsWith('file://')")).toBe(false)
    })
})
