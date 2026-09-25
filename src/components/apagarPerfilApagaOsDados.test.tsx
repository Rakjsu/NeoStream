import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ProfileManager } from './ProfileManager'
import { ProfileSelector } from '../pages/ProfileSelector'
import { profileService } from '../services/profileService'
import { playlistScopedKeyFor } from '../services/activePlaylistService'

/**
 * 🗑️ D077 pela PONTA: o diálogo de "Excluir perfil" promete que "o progresso de
 * exibição e os favoritos deste perfil serão perdidos". Aqui a pessoa clica na
 * lixeira e confirma, nas DUAS telas que apagam perfil (o gerenciador de dentro
 * do app, com e sem PIN, e o "Gerenciar" da tela de boot), e o que se confere é
 * o que sobrou no storage — não o que o React desenhou.
 */

// Folga para a suíte inteira rodando em paralelo; o teste acaba assim que a
// condição vale (o timeout do `it` acompanha).
const ESPERA = { timeout: 8000, interval: 10 }
const PRAZO_DO_TESTE = 15_000

let root: Root | null = null
let container: HTMLDivElement | null = null

async function montar(elemento: ReactElement) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root!.render(elemento) })
}

async function clicar(el: Element) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/** Digita no input controlado do React (o setter nativo + evento `input`). */
async function digitar(input: HTMLInputElement, texto: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
        setter.call(input, texto)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function achar<T extends Element>(seletor: string, dentro: ParentNode = container!): T {
    const el = dentro.querySelector<T>(seletor)
    if (!el) throw new Error(`"${seletor}" não está na tela`)
    return el
}

/** Favoritos, progresso e estatística do perfil, nos dois formatos de chave. */
function semear(id: string): string[] {
    const chaves = [
        playlistScopedKeyFor('neostream_profile', id, 'pl_a'),
        playlistScopedKeyFor('movie_watch_progress', id, 'pl_a'),
        `usage_stats_${id}`,
    ]
    chaves.forEach(chave => localStorage.setItem(chave, '{"x":1}'))
    return chaves
}

const presentes = (chaves: string[]) => chaves.filter(chave => localStorage.getItem(chave) !== null)

async function criarDonoEFilho(pinDoFilho?: string) {
    const dono = await profileService.createProfile({ name: 'Dono', avatar: '👨' })
    const filho = await profileService.createProfile({ name: 'Filho', avatar: '🧒', pin: pinDoFilho })
    expect(profileService.getActiveProfile()?.id).toBe(dono!.id)
    return { doDono: semear(dono!.id), doFilho: semear(filho!.id), filhoId: filho!.id }
}

beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
})

describe('Excluir perfil apaga os dados que o diálogo promete (D077)', { timeout: PRAZO_DO_TESTE }, () => {
    it('gerenciador do app: lixeira + confirmar some com favoritos e progresso', async () => {
        const { doDono, doFilho, filhoId } = await criarDonoEFilho()
        await montar(<ProfileManager onClose={() => undefined} />)

        const cartao = Array.from(container!.querySelectorAll('.pm-profile-card'))
            .find(c => (c.querySelector('.pm-profile-name')?.textContent ?? '').startsWith('Filho'))!
        await clicar(achar('button.pm-btn-delete', cartao))
        await clicar(achar('.pm-modal-delete button.pm-btn-danger'))

        expect(profileService.getAllProfiles().some(p => p.id === filhoId)).toBe(false)
        expect(presentes(doFilho)).toEqual([])
        expect(presentes(doDono)).toEqual(doDono)
    })

    it('gerenciador do app, perfil com PIN: o PIN certo apaga os dados junto', async () => {
        const { doDono, doFilho, filhoId } = await criarDonoEFilho('4321')
        await montar(<ProfileManager onClose={() => undefined} />)

        const cartao = Array.from(container!.querySelectorAll('.pm-profile-card'))
            .find(c => (c.querySelector('.pm-profile-name')?.textContent ?? '').startsWith('Filho'))!
        await clicar(achar('button.pm-btn-delete', cartao))
        await digitar(achar<HTMLInputElement>('#pm-delete-pin-input'), '4321')
        await clicar(achar('.pm-pin-btn.submit'))

        // verifyPin passa por crypto.subtle: espera a CONDIÇÃO, não voltas.
        await vi.waitFor(() => expect(presentes(doFilho)).toEqual([]), ESPERA)
        expect(profileService.getAllProfiles().some(p => p.id === filhoId)).toBe(false)
        expect(presentes(doDono)).toEqual(doDono)
    })

    it('"Gerenciar" da tela de perfis: lixeira + confirmar some com os dados', async () => {
        const { doDono, doFilho, filhoId } = await criarDonoEFilho()
        await montar(<ProfileSelector onProfileSelected={() => undefined} />)

        // A lista entra depois de um atraso de animação: espera os cartões.
        await vi.waitFor(() => expect(container!.querySelectorAll('.profile-card-wrapper').length).toBe(2), ESPERA)
        await clicar(achar('button.manage-btn:not(.guest-btn)'))
        const cartao = Array.from(container!.querySelectorAll('.profile-card-wrapper'))
            .find(c => (c.textContent ?? '').includes('Filho'))!
        await clicar(achar('button.delete-profile-btn', cartao))
        await clicar(achar('.pin-modal button.btn-danger'))

        expect(profileService.getAllProfiles().some(p => p.id === filhoId)).toBe(false)
        expect(presentes(doFilho)).toEqual([])
        expect(presentes(doDono)).toEqual(doDono)
    })
})
