import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UpdatesSection } from './UpdatesSection'
import { ParentalSection } from './ParentalSection'
import { StatsSection } from './StatsSection'
import { WrappedOverlay } from '../../components/WrappedOverlay'
import { languageService, type SupportedLanguage } from '../../services/languageService'
import { logParentalEvent } from '../../services/parentalLogService'

/**
 * D130 — residuos de portugues dentro das proprias Configuracoes.
 *
 * 1. Os selos de salvo de "Instalar automaticamente", "Fechar para a bandeja"
 *    e "Iniciar com o Windows" eram `✓ Salvo` escrito a mao, enquanto o selo
 *    do idioma, no MESMO componente, ja usava `t('settings', 'saved')`. Em
 *    ingles/espanhol so esses tres ficavam em portugues.
 * 2. A "Ultima verificacao" das Atualizacoes e o log do Controle dos pais
 *    formatavam a data com `toLocaleString('pt-BR')` cravado: quem usa o app em
 *    ingles le 04/03/2026 e entende 3 de abril.
 * 3. As iniciais do grafico "Ultimos 7 dias" das Estatisticas eram a lista
 *    ['D','S','T','Q','Q','S','S'] — o W de Wednesday virava Q.
 *
 * A tabela idioma -> localidade das datas morava so no StatsSection (e uma
 * copia no WrappedOverlay); agora e `languageService.getLocale()`. Ela e
 * DIFERENTE da tabela do `lang` do <html>: 'en' cru deixaria o formato da data
 * a cargo do sistema, entao aqui e en-US / es-ES, com pt-BR de reserva. Os dois
 * antigos donos da tabela (dia mais assistido das Estatisticas e da
 * Retrospectiva) tambem sao conferidos, pra a troca de dono nao quebra-los.
 *
 * Tudo montado de verdade (react-dom/client + act). O esperado e calculado com
 * o proprio Intl — o teste nao depende da versao do ICU do Node.
 */

// 4 de marco de 2026 (uma QUARTA-feira), 15:06:07 no fuso do teste (o
// vitest.config fixa o TZ). Dia <= 12 de proposito: em pt-BR sai 04/03, em
// en-US sai 3/4 — sem ambiguidade.
const QUANDO = new Date(2026, 2, 4, 15, 6, 7).getTime()

const LOCALE: Record<SupportedLanguage, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }

let raizes: Root[] = []
let lixo: HTMLElement[] = []

function ipcFalso() {
    return {
        invoke: vi.fn(async (canal: string) => {
            if (canal === 'update:get-config') return { checkFrequency: 'on-open', autoInstall: false, lastCheck: QUANDO }
            if (canal === 'update:auto-install-supported') return { supported: true, releaseUrl: '' }
            if (canal === 'system:get-config') return { success: true, config: { closeToTray: true, openAtLogin: false } }
            return { success: true }
        }),
        send: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
        removeAllListeners: vi.fn(),
    }
}

/** Uso gravado so numa QUARTA (04/03/2026): o "dia mais assistido" e quarta. */
function semearUsoNaQuarta() {
    localStorage.setItem('usage_stats_default', JSON.stringify({
        totalWatchTimeSeconds: 36000,
        totalWatchTimeThisMonth: 0,
        sessionsThisMonth: [],
        contentBreakdown: { movies: 36000, series: 0, live: 0 },
        watchStreak: 0,
        longestStreak: 3,
        dailyStats: [{ date: '2026-03-04', totalSeconds: 36000, movies: 36000, series: 0, live: 0 }],
        lastWatchDate: '2026-03-04',
    }))
}

const quartaEm = (locale: string) => new Date(2026, 2, 4, 12).toLocaleDateString(locale, { weekday: 'long' })

beforeEach(() => {
    ; (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    try { localStorage.clear() } catch { /* jsdom sem storage */ }
    const ipc = ipcFalso()
        ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = ipc
        ; (window as unknown as { electronAPI: unknown }).electronAPI = ipc
})

afterEach(() => {
    for (const r of raizes) { try { act(() => r.unmount()) } catch { /* ja foi */ } }
    raizes = []
    for (const el of lixo) el.remove()
    lixo = []
    languageService.setLanguage('pt')
    vi.restoreAllMocks()
    try { localStorage.clear() } catch { /* jsdom sem storage */ }
})

/** Espera uma CONDICAO (nunca um numero fixo de voltas). */
async function esperar(condicao: () => boolean, oQue: string, limiteMs = 3000) {
    const inicio = Date.now()
    while (!condicao()) {
        if (Date.now() - inicio > limiteMs) throw new Error(`tempo esgotado esperando: ${oQue}`)
        await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
}

/** Troca o idioma e espera o dicionario (en/es sao carregados sob demanda). */
async function falar(lang: SupportedLanguage) {
    await act(async () => { languageService.setLanguage(lang) })
    const esperado = { pt: '✓ Salvo', en: '✓ Saved', es: '✓ Guardado' }[lang]
    await esperar(() => languageService.t('settings', 'saved') === esperado, `dicionario "${lang}" carregar`)
}

async function montar(no: React.ReactNode) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    lixo.push(container)
    const root = createRoot(container)
    raizes.push(root)
    await act(async () => { root.render(no) })
    return container
}

const limpo = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

describe('D130 — languageService.getLocale()', () => {
    it('da a localidade COMPLETA das datas para cada idioma', async () => {
        for (const lang of ['en', 'es', 'pt'] as const) {
            await falar(lang)
            expect(languageService.getLocale()).toBe(LOCALE[lang])
        }
    })

    it('nao reaproveita o lang do <html> ("en" cru deixaria a data a cargo do sistema)', async () => {
        await falar('en')
        expect(document.documentElement.lang).toBe('en')
        expect(languageService.getLocale()).toBe('en-US')
    })
})

describe('D130 — Atualizacoes no idioma da tela', () => {
    const renderizar = () => montar(<UpdatesSection checking={false} setChecking={() => { }} />)

    it('os tres interruptores mostram o selo de salvo traduzido, igual ao do idioma', async () => {
        await falar('en')
        const container = await renderizar()

        for (const chave of ['autoInstall', 'closeToTray', 'openAtLogin']) {
            const rotulo = languageService.t('updates', chave)
            const input = container.querySelector(`input[aria-label="${rotulo}"]`) as HTMLInputElement | null
            expect(input, `interruptor "${rotulo}" nao encontrado`).not.toBeNull()
            await esperar(() => !input!.disabled, `"${rotulo}" habilitar`)

            await act(async () => { input!.click() })
            const linha = input!.closest('.setting-item') as HTMLElement
            await esperar(() => !!linha.querySelector('.save-indicator'), `selo de salvo em "${rotulo}"`)

            expect(limpo(linha.querySelector('.save-indicator')!.textContent), `selo de "${rotulo}"`).toBe('✓ Saved')
        }
    })

    it('a data da ultima verificacao sai no formato do idioma escolhido', async () => {
        await falar('en')
        const container = await renderizar()
        const data = () => limpo(container.querySelector('.last-check strong')?.textContent)
        await esperar(() => data() !== '', 'a ultima verificacao aparecer')

        expect(data()).toBe(limpo(new Date(QUANDO).toLocaleString('en-US')))
        expect(data()).not.toBe(limpo(new Date(QUANDO).toLocaleString('pt-BR')))
    })

    it('trocar o idioma com a tela aberta reformata a data (nao fica presa ao formato da carga)', async () => {
        await falar('pt')
        const container = await renderizar()
        const data = () => limpo(container.querySelector('.last-check strong')?.textContent)
        await esperar(() => data() !== '', 'a ultima verificacao aparecer')
        expect(data()).toBe(limpo(new Date(QUANDO).toLocaleString('pt-BR')))

        await falar('es')
        await esperar(() => data() === limpo(new Date(QUANDO).toLocaleString('es-ES')), 'a data virar es-ES')
    })
})

describe('D130 — log do Controle dos pais no idioma da tela', () => {
    it('a data de cada tentativa segue o idioma, nao pt-BR cravado', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(QUANDO)
        logParentalEvent('pin_fail', 'perfil infantil')
        vi.restoreAllMocks()

        // espanhol de proposito: nem pt-BR nem o en-US que costuma ser o padrao
        // do sistema na CI — um locale indefinido nao passaria por acaso.
        await falar('es')
        const container = await montar(<ParentalSection />)

        const linhas = Array.from(container.querySelectorAll('div'))
            .map(d => limpo(d.textContent))
            .filter(texto => texto.endsWith('perfil infantil') && texto.includes('❌'))
        expect(linhas.length, 'a linha do log nao apareceu').toBeGreaterThan(0)
        const linha = linhas[linhas.length - 1]

        expect(linha.startsWith(limpo(new Date(QUANDO).toLocaleString('es-ES'))), linha).toBe(true)
        expect(linha.includes(limpo(new Date(QUANDO).toLocaleString('pt-BR'))), linha).toBe(false)
    })
})

describe('D130 — Estatisticas no idioma da tela', () => {
    /** Iniciais das 7 barras do grafico "Ultimos 7 dias". */
    async function iniciaisDaSemana() {
        const container = await montar(<StatsSection />)
        const titulo = Array.from(container.querySelectorAll('h3'))
            .find(h => limpo(h.textContent) === languageService.t('stats', 'last7Days'))
        expect(titulo, 'grafico dos ultimos 7 dias nao encontrado').toBeTruthy()
        const barras = Array.from(titulo!.nextElementSibling!.children) as HTMLElement[]
        expect(barras.length).toBe(7)
        return barras.map(b => limpo((b.lastElementChild as HTMLElement).textContent))
    }

    /** Mesma janela que o servico monta: hoje e os 6 dias anteriores. */
    const diasDaJanela = () => Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() - (6 - i))
        d.setHours(12, 0, 0, 0)
        return d
    })

    it('em ingles as iniciais sao as do ingles (W de Wednesday, nao Q de quarta)', async () => {
        await falar('en')
        const iniciais = await iniciaisDaSemana()
        expect(iniciais).toEqual(diasDaJanela().map(d => d.toLocaleDateString('en-US', { weekday: 'narrow' })))
    })

    it('em portugues continuam as de sempre (D S T Q Q S S)', async () => {
        await falar('pt')
        const iniciais = await iniciaisDaSemana()
        expect(iniciais).toEqual(diasDaJanela().map(d => ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()]))
    })

    it('o "dia mais assistido" sai no idioma da tela', async () => {
        semearUsoNaQuarta()
        await falar('en')
        const container = await montar(<StatsSection />)

        const rotulo = limpo(`📅 ${languageService.t('stats', 'busiestDay')}`)
        const cabeca = Array.from(container.querySelectorAll('div')).find(d => limpo(d.textContent) === rotulo)
        expect(cabeca, 'bloco do dia mais assistido nao encontrado').toBeTruthy()
        expect(limpo(cabeca!.nextElementSibling?.textContent)).toBe(quartaEm('en-US'))
    })
})

describe('D130 — Retrospectiva no idioma da tela', () => {
    it('o dia mais assistido da Retrospectiva sai no idioma da tela', async () => {
        semearUsoNaQuarta()
        await falar('es')
        const container = await montar(<WrappedOverlay onClose={() => { }} />)

        // anda ate o ultimo slide (o dos habitos, onde fica o dia da semana)
        const proximo = () => container.querySelector(`button[aria-label="${languageService.t('wrapped', 'next')}"]`) as HTMLButtonElement | null
        for (let i = 0; i < 10 && proximo(); i++) {
            await act(async () => { proximo()!.click() })
        }
        const sub = () => limpo(container.querySelector('.wrapped-sub')?.textContent)
        await esperar(() => sub().includes(quartaEm('es-ES')), `o dia virar "${quartaEm('es-ES')}" (veio "${sub()}")`)
        expect(sub().includes(quartaEm('pt-BR'))).toBe(false)
    })
})
