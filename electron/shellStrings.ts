/**
 * 🪟 Textos que o PROCESSO MAIN desenha sozinho, fora de qualquer janela:
 * menu da bandeja, os avisos de fechar-para-a-bandeja, a jump list do ícone
 * da taskbar e as dicas dos botões da miniatura (#D120).
 *
 * Não dá pra usar os JSON de src/locales/ui: quem lê aqueles é o
 * languageService do renderer, e a bandeja existe antes de qualquer janela.
 * Mesmo arranjo do webRemoteStrings (a página do celular), mas separado dele
 * porque aquele dicionário vai inteiro, como `L`, dentro do HTML servido ao
 * celular — isto aqui não tem nada que fazer lá.
 *
 * Os termos repetem os do app (TV ao Vivo, Baixados, "Fechar para a bandeja",
 * "Iniciar com o Windows"...): a bandeja e as Configurações têm que dizer a
 * mesma coisa com as mesmas palavras. Mantenha os três idiomas com as mesmas
 * chaves — o teste idiomaDaBandeja.test.ts cobra.
 */
import type { RemoteLang } from './webRemoteStrings'

export type ShellLang = RemoteLang

export interface ShellStrings {
    // Menu da bandeja
    trayOpen: string
    trayRecordings: string
    trayCloseToTray: string
    trayOpenAtLogin: string
    trayQuit: string
    trayStopPlayback: string
    // Player (menu da bandeja e botões da miniatura)
    play: string
    pause: string
    stop: string
    // Avisos ao fechar a janela
    notifyHoldTitle: string
    notifyHoldBody: string
    notifyTrayTitle: string
    notifyTrayBody: string
    // Jump list (botão direito no ícone da taskbar)
    jumpLive: string
    jumpMovies: string
    jumpSeries: string
    jumpDownloads: string
}

export const SHELL_STRINGS: Record<ShellLang, ShellStrings> = {
    pt: {
        trayOpen: 'Abrir NeoStream',
        trayRecordings: 'Gravações',
        trayCloseToTray: 'Fechar para a bandeja',
        trayOpenAtLogin: 'Iniciar com o Windows',
        trayQuit: 'Sair',
        trayStopPlayback: 'Parar reprodução',
        play: 'Reproduzir',
        pause: 'Pausar',
        stop: 'Parar',
        notifyHoldTitle: 'Gravação protegida',
        notifyHoldBody: 'Há gravação em andamento ou agendada — o NeoStream segue na bandeja até terminar. Use a bandeja para sair de vez.',
        notifyTrayTitle: 'NeoStream continua rodando',
        notifyTrayBody: 'Gravações agendadas e lembretes seguem ativos. Use a bandeja para sair de vez.',
        jumpLive: 'TV ao Vivo',
        jumpMovies: 'Filmes',
        jumpSeries: 'Séries',
        jumpDownloads: 'Baixados',
    },
    en: {
        trayOpen: 'Open NeoStream',
        trayRecordings: 'Recordings',
        trayCloseToTray: 'Close to tray',
        trayOpenAtLogin: 'Start with Windows',
        trayQuit: 'Quit',
        trayStopPlayback: 'Stop playback',
        play: 'Play',
        pause: 'Pause',
        stop: 'Stop',
        notifyHoldTitle: 'Recording protected',
        notifyHoldBody: 'A recording is running or scheduled — NeoStream stays in the tray until it finishes. Use the tray icon to quit for good.',
        notifyTrayTitle: 'NeoStream is still running',
        notifyTrayBody: 'Scheduled recordings and reminders stay active. Use the tray icon to quit for good.',
        jumpLive: 'Live TV',
        jumpMovies: 'Movies',
        jumpSeries: 'Series',
        jumpDownloads: 'Downloads',
    },
    es: {
        trayOpen: 'Abrir NeoStream',
        trayRecordings: 'Grabaciones',
        trayCloseToTray: 'Cerrar a la bandeja',
        trayOpenAtLogin: 'Iniciar con Windows',
        trayQuit: 'Salir',
        trayStopPlayback: 'Detener reproducción',
        play: 'Reproducir',
        pause: 'Pausar',
        stop: 'Detener',
        notifyHoldTitle: 'Grabación protegida',
        notifyHoldBody: 'Hay una grabación en curso o programada — NeoStream sigue en la bandeja hasta que termine. Usa la bandeja para salir del todo.',
        notifyTrayTitle: 'NeoStream sigue en ejecución',
        notifyTrayBody: 'Las grabaciones programadas y los recordatorios siguen activos. Usa la bandeja para salir del todo.',
        jumpLive: 'TV en Vivo',
        jumpMovies: 'Películas',
        jumpSeries: 'Series',
        jumpDownloads: 'Descargas',
    },
}

/**
 * Normaliza o que chega pelo `app:language` (ou do disco) num idioma
 * suportado; qualquer outra coisa vira null — quem chama mantém o que tinha.
 * EXATAMENTE o mesmo corte do webRemoteServer ('pt-BR' → 'pt'): o que ele
 * recusa de persistir, este aqui também recusa — memória e disco não
 * divergem.
 */
export function normalizeShellLang(raw: unknown): ShellLang | null {
    if (typeof raw !== 'string') return null
    const code = raw.slice(0, 2)
    return code === 'pt' || code === 'en' || code === 'es' ? code : null
}

export function shellStrings(lang: ShellLang): ShellStrings {
    return SHELL_STRINGS[lang]
}
