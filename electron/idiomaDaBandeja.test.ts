/**
 * #D120 (parte do main) — as superfícies de janela falavam só português.
 *
 * O #411/#421 tiraram o português cravado das Configurações e da página do
 * celular, mas o que o processo main desenha sozinho ficou de fora: o menu da
 * bandeja, os dois avisos de fechar-para-a-bandeja, a jump list do botão
 * direito no ícone da taskbar e as dicas dos botões da miniatura. Quem usa o
 * app em inglês ou espanhol via tudo isso em português, pra sempre.
 *
 * O idioma chega ao main pelo `app:language` (languageService, no boot e a
 * cada troca) e fica persistido pelo webRemoteServer no store `web-remote`,
 * chave `webRemoteLang` — é por ele que a bandeja, montada ANTES de o
 * renderer existir, já nasce no idioma certo depois de um restart.
 *
 * O teste é de comportamento: monta a bandeja e a integração com a taskbar
 * sobre um Electron falso e lê o que foi entregue ao sistema (template do
 * menu, Notification, setUserTasks, setThumbarButtons).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'

type Ouvinte = (event: unknown, ...args: unknown[]) => unknown
interface ItemDeMenu { label?: string; type?: string; click?: (item: { checked: boolean }) => void }

const estado = vi.hoisted(() => {
    const ouvintes = new Map<string, ((event: unknown, ...args: unknown[]) => unknown)[]>()
    const menus: { label?: string; type?: string }[][] = []
    const avisos: { title: string; body: string }[] = []
    const tarefas: { title: string; arguments: string }[][] = []
    const botoes: { tooltip: string }[][] = []
    /** Conteúdo dos arquivos do electron-store, por `name`. */
    const discos = new Map<string, Record<string, unknown>>()

    class JanelaFalsa {
        readonly webContents = { send: () => undefined }
        private readonly eventos = new Map<string, ((e: { preventDefault: () => void }) => void)[]>()
        on(evento: string, fn: (e: { preventDefault: () => void }) => void) {
            const lista = this.eventos.get(evento) ?? []
            lista.push(fn)
            this.eventos.set(evento, lista)
            return this
        }
        emitir(evento: string) {
            for (const fn of this.eventos.get(evento) ?? []) fn({ preventDefault: () => undefined })
        }
        isDestroyed() { return false }
        isMinimized() { return false }
        hide() { /* noop */ }
        setThumbarButtons(lista: { tooltip: string }[]) { botoes.push(lista) }
    }

    return { ouvintes, menus, avisos, tarefas, botoes, discos, JanelaFalsa }
})

vi.mock('electron', () => {
    class TrayFalso {
        setToolTip() { /* noop */ }
        on() { /* noop */ }
        setContextMenu() { /* noop */ }
    }
    class NotificationFalsa {
        constructor(private readonly opcoes: { title: string; body: string }) { }
        show() { estado.avisos.push(this.opcoes) }
    }
    return {
        app: {
            on: () => undefined,
            isPackaged: false,
            quit: () => undefined,
            setLoginItemSettings: () => undefined,
            setUserTasks: (lista: { title: string; arguments: string }[]) => { estado.tarefas.push(lista) },
        },
        ipcMain: {
            on: (canal: string, fn: Ouvinte) => {
                const lista = estado.ouvintes.get(canal) ?? []
                lista.push(fn)
                estado.ouvintes.set(canal, lista)
            },
            handle: () => undefined,
        },
        Tray: TrayFalso,
        Menu: { buildFromTemplate: (modelo: { label?: string; type?: string }[]) => { estado.menus.push(modelo); return modelo } },
        Notification: NotificationFalsa,
        nativeImage: {
            createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }),
            createEmpty: () => ({}),
        },
        powerSaveBlocker: { start: () => 1, stop: () => undefined, isStarted: () => false },
        BrowserWindow: { getAllWindows: () => [] },
    }
})
vi.mock('electron-store', () => ({
    default: class {
        private readonly nome: string
        constructor(opcoes?: { name?: string }) { this.nome = opcoes?.name ?? 'config' }
        get(chave: string) { return estado.discos.get(this.nome)?.[chave] }
        set(chave: string, valor: unknown) {
            estado.discos.set(this.nome, { ...(estado.discos.get(this.nome) ?? {}), [chave]: valor })
        }
    },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./dvrHandlers', () => ({ activeRecordingCount: () => 0 }))

/** Simula o renderer mandando um canal pro main (todos os ouvintes, como o Electron). */
const emitir = (canal: string, ...args: unknown[]) => {
    for (const fn of estado.ouvintes.get(canal) ?? []) fn({}, ...args)
}

const rotulos = (modelo: ItemDeMenu[] | undefined) =>
    (modelo ?? []).filter(item => item.type !== 'separator').map(item => item.label)

const ultimoMenu = () => estado.menus[estado.menus.length - 1] as ItemDeMenu[] | undefined
const ultimasTarefas = () => (estado.tarefas[estado.tarefas.length - 1] ?? []).map(t => t.title)
const ultimosBotoes = () => (estado.botoes[estado.botoes.length - 1] ?? []).map(b => b.tooltip)

const plataformaReal = process.platform

describe('#D120 — bandeja, avisos, jump list e miniatura seguem o idioma do app', () => {
    let janela: InstanceType<typeof estado.JanelaFalsa>
    const getWin = () => janela as unknown as BrowserWindow

    beforeEach(() => {
        vi.resetModules()
        estado.ouvintes.clear()
        estado.menus.length = 0
        estado.avisos.length = 0
        estado.tarefas.length = 0
        estado.botoes.length = 0
        estado.discos.clear()
        janela = new estado.JanelaFalsa()
        // A jump list e a miniatura só existem no Windows; a CI também roda no ubuntu.
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    })

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: plataformaReal, configurable: true })
    })

    it('depois de um restart em inglês, a bandeja já nasce em inglês (idioma persistido)', async () => {
        estado.discos.set('web-remote', { webRemoteLang: 'en' })
        const { setupTrayMode } = await import('./trayMode')

        setupTrayMode(getWin)

        expect(rotulos(ultimoMenu())).toEqual([
            'Open NeoStream',
            '⏺ Recordings',
            'Close to tray',
            'Start with Windows',
            'Quit',
        ])
    })

    it('trocar o idioma no app reconstrói o menu da bandeja, inclusive os itens do player', async () => {
        const { setupTrayMode } = await import('./trayMode')
        setupTrayMode(getWin)
        expect(rotulos(ultimoMenu())[0]).toBe('Abrir NeoStream')

        emitir('media:state', { hasMedia: true, playing: true, title: 'Canal X' })
        emitir('app:language', 'es')

        expect(rotulos(ultimoMenu())).toEqual([
            'Abrir NeoStream',
            '⏸ Pausar — Canal X',
            '⏹ Detener reproducción',
            '⏺ Grabaciones',
            'Cerrar a la bandeja',
            'Iniciar con Windows',
            'Salir',
        ])

        emitir('media:state', { hasMedia: true, playing: false, title: 'Canal X' })
        emitir('app:language', 'en')
        expect(rotulos(ultimoMenu()).slice(0, 3)).toEqual([
            'Open NeoStream',
            '▶ Play — Canal X',
            '⏹ Stop playback',
        ])
    })

    it('o aviso de fechar-para-a-bandeja sai no idioma do app', async () => {
        const { setupTrayMode, attachCloseToTray } = await import('./trayMode')
        setupTrayMode(getWin)
        attachCloseToTray(janela as unknown as BrowserWindow)

        emitir('app:language', 'en')
        janela.emitir('close')

        expect(estado.avisos).toHaveLength(1)
        expect(estado.avisos[0].title).toBe('NeoStream is still running')
        expect(estado.avisos[0].body.includes('Use the tray icon to quit')).toBe(true)
    })

    it('o aviso de "gravação protegida" também', async () => {
        const { setupTrayMode, attachCloseToTray } = await import('./trayMode')
        setupTrayMode(getWin)
        attachCloseToTray(janela as unknown as BrowserWindow)

        // Fechar-para-a-bandeja desligado + um agendamento pendente = 'hold'
        // (trayClosePolicy): a janela some, mas o app avisa por que ficou.
        estado.discos.set('system-config', { system: { closeToTray: false, openAtLogin: false } })
        emitir('dvr:schedules-changed', 1)
        emitir('app:language', 'es')
        janela.emitir('close')

        expect(estado.avisos).toHaveLength(1)
        expect(estado.avisos[0].title).toBe('Grabación protegida')
    })

    it('a jump list e os botões da miniatura seguem o idioma e se refazem na troca', async () => {
        estado.discos.set('web-remote', { webRemoteLang: 'en' })
        const { setupWinIntegration } = await import('./winIntegration')

        setupWinIntegration(getWin)
        expect(ultimasTarefas()).toEqual(['📡 Live TV', '🎬 Movies', '📺 Series', '📥 Downloads'])

        emitir('media:state', { hasMedia: true, playing: true })
        expect(ultimosBotoes()).toEqual(['Pause', 'Stop'])

        emitir('app:language', 'es')
        expect(ultimasTarefas()).toEqual(['📡 TV en Vivo', '🎬 Películas', '📺 Series', '📥 Descargas'])
        expect(ultimosBotoes()).toEqual(['Pausar', 'Detener'])

        // A rota de cada tarefa não depende do idioma.
        const args = (estado.tarefas[estado.tarefas.length - 1] ?? []).map(t => t.arguments)
        expect(args).toEqual([
            '--route=/dashboard/live',
            '--route=/dashboard/vod',
            '--route=/dashboard/series',
            '--route=/dashboard/downloads',
        ])
    })

    it('idioma desconhecido ou lixo no canal não derruba nada e mantém o anterior', async () => {
        estado.discos.set('web-remote', { webRemoteLang: 'en' })
        const { setupTrayMode } = await import('./trayMode')
        setupTrayMode(getWin)
        const antes = estado.menus.length

        emitir('app:language', 'fr')
        emitir('app:language', { lang: 'es' })
        emitir('app:language', undefined)
        // Mesmo corte do webRemoteServer: o que ele não persiste, a bandeja
        // também não adota (senão memória e disco divergem no próximo boot).
        emitir('app:language', 'ES')
        // Repetir o idioma que já vale não refaz nada.
        emitir('app:language', 'en')

        expect(estado.menus.length).toBe(antes)
        expect(rotulos(ultimoMenu())[0]).toBe('Open NeoStream')

        // O lixo não contaminou o idioma guardado: a próxima reconstrução
        // (vinda do player) continua em inglês.
        emitir('media:state', { hasMedia: false, playing: false, title: '' })
        expect(estado.menus.length).toBe(antes + 1)
        expect(rotulos(ultimoMenu())[0]).toBe('Open NeoStream')

        // Variante regional vale pelo prefixo, como no webRemoteServer.
        emitir('app:language', 'es-ES')
        expect(rotulos(ultimoMenu())[0]).toBe('Abrir NeoStream')
        expect(rotulos(ultimoMenu())[1]).toBe('⏺ Grabaciones')
    })
})

describe('#D120 — um ouvinte de idioma que falha não trava os outros', () => {
    beforeEach(() => {
        vi.resetModules()
        estado.discos.clear()
        estado.ouvintes.clear()
    })

    it('a bandeja (ou a miniatura) que lança na troca não impede os demais de trocarem', async () => {
        const { onAppLanguageChange } = await import('./appLanguage')
        const recebidos: string[] = []
        // Ex.: reconstruir o menu de uma bandeja já destruída lança
        // "Object has been destroyed".
        onAppLanguageChange(() => { throw new Error('Object has been destroyed') })
        onAppLanguageChange(lang => { recebidos.push(lang) })

        expect(() => emitir('app:language', 'en')).not.toThrow()
        expect(recebidos).toEqual(['en'])
    })
})

describe('#D120 — dicionário das superfícies de janela', () => {
    it('os 3 idiomas têm exatamente as mesmas chaves e nenhum valor vazio', async () => {
        const { SHELL_STRINGS } = await import('./shellStrings')
        const pt = Object.keys(SHELL_STRINGS.pt).sort()
        for (const lang of ['en', 'es'] as const) {
            expect(Object.keys(SHELL_STRINGS[lang]).sort()).toEqual(pt)
            for (const [chave, valor] of Object.entries(SHELL_STRINGS[lang])) {
                expect(valor.trim().length, `${lang}.${chave}`).toBeGreaterThan(0)
            }
        }
    })

    it('lê o idioma do MESMO store/chave que o webRemoteServer persiste', () => {
        // Se alguém renomear lá, a bandeja volta a nascer em português depois
        // de todo restart — e nenhum outro teste percebe.
        const fonte = fs.readFileSync(path.join(__dirname, 'webRemoteServer.ts'), 'utf-8')
        expect(fonte.includes("name: 'web-remote'")).toBe(true)
        expect(fonte.includes("store.set('webRemoteLang', code)")).toBe(true)
        const idioma = fs.readFileSync(path.join(__dirname, 'appLanguage.ts'), 'utf-8')
        expect(idioma.includes("name: 'web-remote'")).toBe(true)
        expect(idioma.includes("'webRemoteLang'")).toBe(true)
    })
})
