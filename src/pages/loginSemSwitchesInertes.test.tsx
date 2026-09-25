import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Login } from './Login'
import { languageService } from '../services/languageService'
import pt from '../locales/ui/pt.json'
import en from '../locales/ui/en.json'
import es from '../locales/ui/es.json'

/**
 * D085 — os switches "Incluir canais de TV" e "Incluir VOD" do login não
 * filtravam nada.
 *
 * Eram gravados em localStorage ('includeTV' / 'includeVOD') no sucesso do
 * login e ninguém — nem o renderer nem o main — lia essas chaves: desmarcar
 * TV não tirava a aba de TV, não mudava o catálogo e não economizava um byte
 * de download. O único efeito era ESCONDER os cartões de contagem no resumo
 * do passo seguinte, o que só piorava a mentira: o usuário desmarcava TV, não
 * via a contagem de canais e depois achava todos os canais na Home.
 *
 * O teste é comportamental: monta o Login de verdade, faz o login dar certo e
 * lê a tela e o localStorage.
 */

const CONTAGENS = { live: 111, vod: 222, series: 333 }

/** `window.ipcRenderer` só com o que o Login usa. */
function mockIpc() {
    const invoke = vi.fn((canal: string) => {
        if (canal === 'auth:login') return Promise.resolve({ success: true, playlistId: 'p1' })
        if (canal === 'content:get-counts') return Promise.resolve({ success: true, counts: CONTAGENS })
        return Promise.resolve({ success: false })
    })
    const fake = { invoke, send: vi.fn(), on: vi.fn(), off: vi.fn() }
    ;(window as unknown as { ipcRenderer: unknown }).ipcRenderer = fake
    return invoke
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montarLogin() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(<MemoryRouter><Login /></MemoryRouter>)
    })
}

async function desmontarLogin() {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
}

/**
 * Desmarca, com um clique de usuário, qualquer caixa que a tela de
 * credenciais ofereça. Com a correção não há nenhuma (o primeiro caso prova
 * isso); o laço existe para que os casos do localStorage e do resumo
 * continuem valendo sozinhos se um switch voltar à tela.
 */
async function desmarcarQualquerSwitch() {
    for (const caixa of Array.from(container!.querySelectorAll('input[type="checkbox"]'))) {
        await act(async () => {
            (caixa as HTMLElement).click()
        })
    }
}

/** Envia as credenciais e espera a tela do nome da playlist aparecer. */
async function logarComSucesso() {
    const form = container!.querySelector('form')
    if (!form) throw new Error('formulário de credenciais não está na tela')
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => {
        expect(container!.querySelector('.login-stats')).not.toBe(null)
    })
}

/**
 * Cada cartão VISÍVEL do resumo da biblioteca como "número rótulo", na ordem
 * da tela. Esconder um cartão por atributo ou estilo conta como não mostrar.
 */
function cartoesDoResumo(): string[] {
    return Array.from(container!.querySelectorAll<HTMLElement>('.login-stat'))
        .filter(cartao => !cartao.closest('[hidden]') && getComputedStyle(cartao).display !== 'none')
        .map(cartao => {
            const valor = cartao.querySelector('.login-stat-value')?.textContent ?? ''
            const rotulo = cartao.querySelector('.login-stat-label')?.textContent ?? ''
            return `${valor} ${rotulo}`
        })
}

beforeAll(async () => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // en.json entra por import dinâmico: trocar o idioma não é síncrono.
    languageService.setLanguage('en')
    await vi.waitFor(() => {
        expect(languageService.t('login', 'authError')).toBe('Incorrect username or password')
    })
})

afterEach(async () => {
    await desmontarLogin()
    vi.restoreAllMocks()
    try { localStorage.clear() } catch { /* sem storage no ambiente */ }
})

describe('login sem os switches de TV/VOD que não filtravam nada (D085)', () => {
    it('a tela de credenciais não oferece switch nenhum', async () => {
        mockIpc()
        await montarLogin()

        expect(container!.querySelectorAll('input[type="checkbox"]').length).toBe(0)
        const texto = container!.textContent ?? ''
        expect(texto.includes('Include TV channels')).toBe(false)
        expect(texto.includes('Include VOD')).toBe(false)
    })

    it('o login que dá certo não grava includeTV / includeVOD no localStorage', async () => {
        mockIpc()
        await montarLogin()
        await desmarcarQualquerSwitch()
        await logarComSucesso()

        expect(localStorage.getItem('includeTV')).toBe(null)
        expect(localStorage.getItem('includeVOD')).toBe(null)
    })

    it('o resumo da biblioteca mostra sempre canais, filmes e séries', async () => {
        const invoke = mockIpc()
        await montarLogin()
        await desmarcarQualquerSwitch()
        await logarComSucesso()

        await vi.waitFor(() => {
            expect(cartoesDoResumo()).toEqual(['111 Channels', '222 Movies', '333 Series'])
        })
        expect(invoke).toHaveBeenCalledWith('content:get-counts')
    })

    it('as chaves login.includeTV / login.includeVOD saíram dos três idiomas', () => {
        for (const dicionario of [pt, en, es]) {
            const login = (dicionario as unknown as { login: Record<string, string> }).login
            expect('includeTV' in login).toBe(false)
            expect('includeVOD' in login).toBe(false)
        }
    })
})
