/**
 * 🍎 D020 — fora do Windows o mpv tocava, mas os controles ficavam mudos.
 *
 * O endereço do --input-ipc-server era SEMPRE o named pipe do Windows
 * (`\\.\pipe\neostream-mpv-<pid>-<n>`). No mac/Linux isso não é pipe nenhum:
 * vira um arquivo de socket RELATIVO ao cwd do mpv (o spawn não passa cwd,
 * herda o do app). No app do macOS aberto pelo Finder o cwd é `/`, onde o
 * usuário não pode criar arquivo: o mpv não sobe o IPC, o connectPipe desiste
 * depois das tentativas e o vídeo toca sem pausa, sem busca, sem faixas.
 * E a busca automática do executável só conhecia pastas do Windows — o mpv do
 * Homebrew (fora do PATH mínimo que o Finder dá ao app) nunca era achado.
 *
 * Três camadas:
 * - unidade: `buildPipeName` / `buildPathCandidates` por plataforma;
 * - o main de verdade: os handlers `mpv:available` e `mpv:play` com a
 *   plataforma fingida, olhando o que chega ao `spawn` e ao `net.connect`
 *   (e o socket que sobra no disco quando o mpv morre);
 * - o socket de verdade: um "mpv de mentira" (processo filho real) abre o
 *   servidor no endereço calculado, rodando com o cwd `/` que o mpv teria.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import {
    buildPathCandidates,
    buildPipeName,
    MAX_UNIX_SOCKET_PATH,
    UNIX_MPV_CANDIDATES,
} from './mpvProtocol'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
type FilhoFalso = EventEmitter & { exitCode: number | null; killed: boolean; kill: () => void }

const estado = vi.hoisted(() => ({
    temp: '',
    mpvConfigurado: undefined as string | undefined,
    /** Caminhos que o `existsSync` do main enxerga como existentes, além do disco real. */
    existentes: new Set<string>(),
    handlers: new Map<string, IpcHandler>(),
    spawns: [] as { comando: string; args: string[]; filho: FilhoFalso }[],
    conexoes: [] as string[],
    /** O que o main mandou apagar do disco (rmSync/unlinkSync). */
    apagados: [] as string[],
}))

vi.mock('electron', () => ({
    app: {
        getPath: (nome: string) => (nome === 'temp' ? estado.temp : `${estado.temp}/${nome}`),
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
        get: (chave: string) => (chave === 'settings' ? { mpvPath: estado.mpvConfigurado } : undefined),
        set: () => undefined,
    },
}))

vi.mock('node:fs', async (importOriginal) => {
    const real = await importOriginal<typeof import('node:fs')>()
    const existsSync = (alvo: import('node:fs').PathLike) => estado.existentes.has(String(alvo)) || real.existsSync(alvo)
    const rmSync: typeof real.rmSync = (alvo, opcoes) => {
        estado.apagados.push(String(alvo))
        return real.rmSync(alvo, opcoes)
    }
    const unlinkSync: typeof real.unlinkSync = (alvo) => {
        estado.apagados.push(String(alvo))
        return real.unlinkSync(alvo)
    }
    const trocados = { existsSync, rmSync, unlinkSync }
    return { ...real, default: { ...real, ...trocados }, ...trocados }
})

vi.mock('node:child_process', async (importOriginal) => {
    const real = await importOriginal<typeof import('node:child_process')>()
    const spawn = (comando: string, args: string[]) => {
        const filho = new EventEmitter() as FilhoFalso
        filho.exitCode = null
        filho.killed = false
        filho.kill = () => { filho.killed = true }
        estado.spawns.push({ comando, args, filho })
        // A sondagem `mpv --version` do PATH: não há mpv no PATH (o Finder dá
        // ao app um PATH mínimo). Sem isto ela esperaria o timeout de 3s.
        if (comando === 'mpv' && args[0] === '--version') {
            process.nextTick(() => filho.emit('error', new Error('ENOENT')))
        }
        return filho
    }
    return { ...real, default: { ...real, spawn }, spawn }
})

vi.mock('node:net', async (importOriginal) => {
    const real = await importOriginal<typeof import('node:net')>()
    const connect = (endereco: string) => {
        estado.conexoes.push(endereco)
        const socket = new EventEmitter() as EventEmitter & { destroy: () => void; write: () => boolean; destroyed: boolean }
        socket.destroyed = false
        socket.destroy = () => { socket.destroyed = true }
        socket.write = () => true
        return socket
    }
    return { ...real, default: { ...real, connect }, connect }
})

describe('buildPipeName — endereço do IPC por plataforma', () => {
    it('no Windows continua o named pipe de sempre', () => {
        expect(buildPipeName(1234, 2, 'win32', 'C:\\Users\\x\\AppData\\Local\\Temp'))
            .toBe('\\\\.\\pipe\\neostream-mpv-1234-2')
    })

    it('no mac vira socket unix com caminho absoluto na pasta temporária', () => {
        expect(buildPipeName(1234, 2, 'darwin', '/var/folders/ab/cdef/T'))
            .toBe('/var/folders/ab/cdef/T/neostream-mpv-1234-2.sock')
    })

    it('no Linux também, e aceita a pasta com barra no fim', () => {
        expect(buildPipeName(77, 1, 'linux', '/run/user/1000')).toBe('/run/user/1000/neostream-mpv-77-1.sock')
        expect(buildPipeName(77, 1, 'linux', '/run/user/1000/')).toBe('/run/user/1000/neostream-mpv-77-1.sock')
    })

    it('fora do Windows nunca depende do cwd: sempre absoluto e sem contrabarra', () => {
        for (const platform of ['darwin', 'linux', 'freebsd'] as const) {
            const nome = buildPipeName(4321, 9, platform, '/home/user/.cache/tmp')
            expect(nome).toBe('/home/user/.cache/tmp/neostream-mpv-4321-9.sock')
        }
    })

    it('o teto cabe no sun_path do macOS (104 bytes contando o NUL do fim)', () => {
        expect(MAX_UNIX_SOCKET_PATH).toBeLessThanOrEqual(103)
        // E sobra espaço pro $TMPDIR típico do mac (~49 chars) + o nome do socket.
        expect(buildPipeName(99999, 999, 'darwin', '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T/'))
            .toBe('/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T/neostream-mpv-99999-999.sock')
    })

    it('pasta temporária no limite do sun_path ainda serve; um byte a mais cai em /tmp', () => {
        const arquivo = '/neostream-mpv-1234-2.sock'
        const cabe = `/${'x'.repeat(MAX_UNIX_SOCKET_PATH - arquivo.length - 1)}`
        expect(buildPipeName(1234, 2, 'darwin', cabe)).toBe(`${cabe}${arquivo}`)
        expect(`${cabe}${arquivo}`.length).toBe(MAX_UNIX_SOCKET_PATH)

        const passa = `${cabe}y`
        expect(buildPipeName(1234, 2, 'darwin', passa)).toBe('/tmp/neostream-mpv-1234-2.sock')
    })

    it('o limite conta BYTES, não caracteres (pasta com acento no nome do usuário)', () => {
        const arquivo = '/neostream-mpv-1234-2.sock'
        // Cabe em caracteres, estoura em bytes: cada "ç" vale 2 bytes em UTF-8.
        const pasta = `/${'ç'.repeat(MAX_UNIX_SOCKET_PATH - arquivo.length - 1)}`
        expect(`${pasta}${arquivo}`.length).toBe(MAX_UNIX_SOCKET_PATH)
        expect(buildPipeName(1234, 2, 'darwin', pasta)).toBe('/tmp/neostream-mpv-1234-2.sock')
    })

    it('pasta temporária vazia ou relativa também cai em /tmp (nunca relativo ao cwd)', () => {
        expect(buildPipeName(5, 1, 'linux', '')).toBe('/tmp/neostream-mpv-5-1.sock')
        expect(buildPipeName(5, 1, 'linux', 'tmp')).toBe('/tmp/neostream-mpv-5-1.sock')
    })

    it('lançamentos seguidos na mesma sessão não colidem', () => {
        expect(buildPipeName(10, 1, 'darwin', '/tmp')).not.toBe(buildPipeName(10, 2, 'darwin', '/tmp'))
    })
})

describe('buildPathCandidates — onde procurar o mpv em cada plataforma', () => {
    it('no mac acha o mpv do Homebrew, do MacPorts e o mpv.app (inclusive em ~/Applications)', () => {
        const candidatos = buildPathCandidates({ HOME: '/Users/ana' }, 'darwin')
        expect(candidatos).toContain('/opt/homebrew/bin/mpv')
        expect(candidatos).toContain('/usr/local/bin/mpv')
        expect(candidatos).toContain('/opt/local/bin/mpv')
        expect(candidatos).toContain('/Applications/mpv.app/Contents/MacOS/mpv')
        expect(candidatos).toContain('/Users/ana/Applications/mpv.app/Contents/MacOS/mpv')
    })

    it('no Linux olha as pastas de pacote do sistema e não inventa ~/Applications', () => {
        const candidatos = buildPathCandidates({ HOME: '/home/ana' }, 'linux')
        expect(candidatos).toContain('/usr/bin/mpv')
        expect(candidatos).toContain('/usr/local/bin/mpv')
        expect(candidatos).toContain('/snap/bin/mpv')
        expect(candidatos.some((c) => c.startsWith('/home/ana'))).toBe(false)
    })

    it('HOME ausente ou relativo não vira candidato relativo ao cwd', () => {
        for (const env of [{}, { HOME: '' }, { HOME: 'ana' }]) {
            const candidatos = buildPathCandidates(env, 'darwin')
            expect(candidatos).toEqual([...UNIX_MPV_CANDIDATES])
        }
    })

    it('fora do Windows não sobra caminho de Windows na lista', () => {
        const envDeWindows = { ProgramFiles: 'C:\\Program Files', HOME: '/home/ana' }
        for (const platform of ['darwin', 'linux'] as const) {
            const candidatos = buildPathCandidates(envDeWindows, platform)
            expect(candidatos.length).toBeGreaterThan(0)
            expect(candidatos.every((c) => path.posix.isAbsolute(c))).toBe(true)
            expect(candidatos.some((c) => c.endsWith('.exe') || c.includes('\\'))).toBe(false)
        }
    })

    it('no Windows a lista continua só de Windows', () => {
        const candidatos = buildPathCandidates({ ProgramFiles: 'C:\\Program Files', HOME: '/home/ana' }, 'win32')
        expect(candidatos).toEqual(['C:\\Program Files\\mpv\\mpv.exe', 'C:\\ProgramData\\chocolatey\\bin\\mpv.exe'])
    })
})

/**
 * O main de verdade: `setupMpvHandlers` com Electron, spawn e net falsos, e a
 * plataforma fingida. Aqui o que conta é o que o main ENTREGA — os helpers
 * puros certos não servem de nada se a chamada no mpvPlayer não passar a
 * plataforma e a pasta temporária.
 */
describe('o main fora do Windows', () => {
    const descritorPlataforma = Object.getOwnPropertyDescriptor(process, 'platform')!
    const fingirPlataforma = (valor: NodeJS.Platform) =>
        Object.defineProperty(process, 'platform', { ...descritorPlataforma, value: valor })

    let mpvPlayer: typeof import('./mpvPlayer') | null = null

    beforeEach(async () => {
        vi.resetModules()
        estado.handlers.clear()
        estado.spawns.length = 0
        estado.conexoes.length = 0
        estado.apagados.length = 0
        estado.existentes.clear()
        estado.mpvConfigurado = undefined
        // Pasta temporária de mentira, mas com cara de POSIX: é o que o
        // app.getPath('temp') devolve no mac/Linux.
        estado.temp = '/var/folders/ab/cdef/T'
        mpvPlayer = await import('./mpvPlayer')
        mpvPlayer.setupMpvHandlers()
    })

    afterEach(() => {
        mpvPlayer?.stopMpv()
        mpvPlayer = null
        Object.defineProperty(process, 'platform', descritorPlataforma)
    })

    const chamar = (canal: string, ...args: unknown[]) => {
        const handler = estado.handlers.get(canal)
        expect(handler, `o canal ${canal} sumiu`).toBeDefined()
        return handler!({ sender: {} }, ...args)
    }

    const spawnDoMpv = () => estado.spawns.filter((s) => !(s.comando === 'mpv' && s.args[0] === '--version'))

    it('no mac, o mpv do Homebrew fora do PATH é achado pelo mpv:available', async () => {
        fingirPlataforma('darwin')
        estado.existentes.add('/opt/homebrew/bin/mpv')

        const resposta = await chamar('mpv:available') as { path: string | null }

        expect(resposta.path).toBe('/opt/homebrew/bin/mpv')
    })

    it('no mac, o mpv:play manda o mpv abrir o IPC num socket absoluto da pasta temporária — e conecta nele', async () => {
        fingirPlataforma('darwin')
        estado.existentes.add('/opt/homebrew/bin/mpv')

        const resultado = await chamar('mpv:play', { url: 'http://host/stream.ts', title: 'Um título' }) as { success: boolean }
        expect(resultado.success).toBe(true)

        const esperado = `/var/folders/ab/cdef/T/neostream-mpv-${process.pid}-1.sock`
        const [mpv] = spawnDoMpv()
        expect(mpv?.comando).toBe('/opt/homebrew/bin/mpv')
        expect(mpv?.args).toContain(`--input-ipc-server=${esperado}`)
        expect(estado.conexoes).toEqual([esperado])
    })

    it('no Windows o mpv:play segue no named pipe', async () => {
        fingirPlataforma('win32')
        estado.mpvConfigurado = 'C:\\mpv\\mpv.exe'
        estado.existentes.add('C:\\mpv\\mpv.exe')

        await chamar('mpv:play', { url: 'http://host/stream.ts' })

        const esperado = `\\\\.\\pipe\\neostream-mpv-${process.pid}-1`
        expect(spawnDoMpv()[0]?.args).toContain(`--input-ipc-server=${esperado}`)
        expect(estado.conexoes).toEqual([esperado])
    })

    it('no Linux, o socket que o mpv morto deixou na pasta temporária é apagado', async () => {
        fingirPlataforma('linux')
        estado.existentes.add('/usr/bin/mpv')

        await chamar('mpv:play', { url: 'http://host/stream.ts' })
        const endereco = `/var/folders/ab/cdef/T/neostream-mpv-${process.pid}-1.sock`
        const [mpv] = spawnDoMpv()
        expect(mpv?.comando).toBe('/usr/bin/mpv')
        expect(mpv?.args).toContain(`--input-ipc-server=${endereco}`)
        expect(estado.apagados).not.toContain(endereco)

        // mpv morto (kill, crash): o arquivo do socket pode ter ficado.
        mpv!.filho.emit('exit', null)

        expect(estado.apagados, 'o socket do mpv morto ficou na pasta temporária').toContain(endereco)
    })

    it('no Windows o fim do mpv não tenta apagar o named pipe como se fosse arquivo', async () => {
        fingirPlataforma('win32')
        estado.mpvConfigurado = 'C:\\mpv\\mpv.exe'
        estado.existentes.add('C:\\mpv\\mpv.exe')

        await chamar('mpv:play', { url: 'http://host/stream.ts' })
        const [mpv] = spawnDoMpv()
        expect(mpv?.comando).toBe('C:\\mpv\\mpv.exe')
        mpv!.filho.emit('exit', 0)

        expect(estado.apagados.some((a) => a.includes('neostream-mpv-'))).toBe(false)
    })
})

/**
 * Comportamental de ponta a ponta: um "mpv de mentira" (processo filho REAL)
 * abre o servidor de IPC no endereço que o app calcula, rodando com o cwd que
 * o mpv teria — `/` fora do Windows (o do app aberto pelo Finder) — e o lado
 * do app conecta e troca uma linha JSON, como o connectPipe faz. Com o
 * endereço antigo, no Linux da CI o filho nem abre o servidor (EACCES no `/`).
 */
describe('IPC de verdade no endereço calculado', () => {
    let filho: ChildProcess | null = null
    let pastaTemp = ''

    afterEach(async () => {
        const vivo = filho
        filho = null
        if (vivo && vivo.exitCode === null && vivo.signalCode === null) {
            // Espera o filho MORRER antes de apagar a pasta: um processo vivo
            // segura o que estiver aberto por ele.
            await new Promise<void>((resolve) => {
                vivo.once('exit', () => resolve())
                vivo.kill()
            })
        }
        if (pastaTemp) {
            fs.rmSync(pastaTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
            pastaTemp = ''
        }
    })

    it('o mpv (de mentira) abre o IPC com o cwd que teria e o app conversa com ele', async () => {
        const { spawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
        const net = await vi.importActual<typeof import('node:net')>('node:net')

        pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-mpv-ipc-'))
        const endereco = buildPipeName(process.pid, Date.now() % 100000, process.platform, pastaTemp)
        const cwdDoMpv = process.platform === 'win32' ? os.tmpdir() : '/'

        const falsoMpv = [
            "const net = require('node:net')",
            'const alvo = process.argv[1]',
            'const srv = net.createServer((s) => s.on("data", (d) => s.write(d)))',
            'srv.on("error", (e) => { process.stdout.write("erro:" + e.code + "\\n"); process.exit(1) })',
            'srv.listen(alvo, () => process.stdout.write("pronto\\n"))',
        ].join('\n')

        filho = spawn(process.execPath, ['-e', falsoMpv, endereco], {
            cwd: cwdDoMpv,
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        })

        const estadoDoFilho = await new Promise<string>((resolve) => {
            let saida = ''
            filho!.stdout!.on('data', (d: Buffer) => {
                saida += d.toString('utf8')
                if (saida.includes('\n')) resolve(saida.split('\n')[0])
            })
            filho!.on('exit', (code) => resolve(`saiu:${code}`))
        })
        expect(estadoDoFilho).toBe('pronto')

        const resposta = await new Promise<string>((resolve, reject) => {
            const cliente = net.connect(endereco)
            let buffer = ''
            cliente.on('error', reject)
            cliente.on('connect', () => cliente.write('{"command":["get_property","pause"]}\n'))
            cliente.on('data', (d) => {
                buffer += d.toString('utf8')
                if (buffer.includes('\n')) {
                    cliente.destroy()
                    resolve(buffer.trim())
                }
            })
        })
        expect(resposta).toBe('{"command":["get_property","pause"]}')
    }, 20000)
})
