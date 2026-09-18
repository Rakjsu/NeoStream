import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ProfileManager } from './ProfileManager'
import { profileService } from '../services/profileService'

/**
 * 👶 O modo infantil era o unico campo do perfil sem porta de entrada: o tipo
 * declarava `isKids`, o `createProfile` gravava, e nenhuma tela mandava o campo
 * (o `updateProfile` ainda o descartava em silencio). Quem ja tinha perfis
 * ficava preso ao `kids-default` do primeiro boot.
 *
 * Aqui o alvo e a PONTA: o crachá "👶 Kids" do cartao virou interruptor. Teste
 * de componente de verdade (react-dom/client + act), clicando no que a pessoa
 * clica e conferindo o que ficou GRAVADO no storage — nao o que o React
 * desenhou.
 */

let root: Root | null = null
let container: HTMLDivElement | null = null
const aoFechar = vi.fn()

async function montar() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root!.render(<ProfileManager onClose={aoFechar} />) })
}

function cartao(nome: string): HTMLElement {
    const cartoes = Array.from(container!.querySelectorAll('.pm-profile-card')) as HTMLElement[]
    const alvo = cartoes.find(c => (c.querySelector('.pm-profile-name')?.textContent ?? '').startsWith(nome))
    if (!alvo) throw new Error(`cartao "${nome}" nao esta na tela: ${cartoes.map(c => c.textContent).join(' | ')}`)
    return alvo
}

/** O interruptor do crachá, ou null quando aquele cartao so tem o selo fixo. */
function interruptor(nome: string): HTMLButtonElement | null {
    return cartao(nome).querySelector('button.pm-kids-toggle')
}

async function clicar(el: HTMLElement) {
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await Promise.resolve() })
}

const lido = (id: string) => profileService.getAllProfiles().find(p => p.id === id)!

beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    aoFechar.mockClear()
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
    if (root) await act(async () => { root!.unmount() })
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
})

describe('ProfileManager — o crachá Kids liga o modo infantil', () => {
    it('um clique vira o perfil infantil; outro desfaz', async () => {
        const pai = await profileService.createProfile({ name: 'Pai', avatar: '👨' })
        const filho = await profileService.createProfile({ name: 'Filho', avatar: '🧒' })
        await montar()

        const botao = interruptor('Filho')
        expect(botao).not.toBeNull()
        expect(botao!.getAttribute('aria-pressed')).toBe('false')

        await clicar(botao!)
        expect(lido(filho!.id).isKids).toBe(true)
        expect(interruptor('Filho')!.getAttribute('aria-pressed')).toBe('true')

        await clicar(interruptor('Filho')!)
        expect(lido(filho!.id).isKids).toBe(false)
        expect(interruptor('Filho')!.getAttribute('aria-pressed')).toBe('false')
        expect(profileService.getActiveProfile()?.id).toBe(pai!.id)
    })

    it('clicar no crachá NAO troca de perfil (o cartao inteiro e que faz isso)', async () => {
        const pai = await profileService.createProfile({ name: 'Pai', avatar: '👨' })
        await profileService.createProfile({ name: 'Filho', avatar: '🧒' })
        await montar()

        await clicar(interruptor('Filho')!)

        expect(profileService.getActiveProfile()?.id).toBe(pai!.id)
        expect(aoFechar).not.toHaveBeenCalled()
    })

    it('o perfil promovido entra na lista que os portoes de conteudo leem', async () => {
        await profileService.createProfile({ name: 'Pai', avatar: '👨' })
        await profileService.createProfile({ name: 'Filho', avatar: '🧒' })
        profileService.initialize() // nao recria nada: ja existem perfis
        await montar()

        await clicar(interruptor('Filho')!)

        expect(profileService.getAllProfiles().filter(p => p.isKids).map(p => p.name)).toEqual(['Filho'])
    })

    it('o perfil EM USO nao ganha interruptor — so o selo fixo quando e kids', async () => {
        await profileService.createProfile({ name: 'Pai', avatar: '👨' })
        await profileService.createProfile({ name: 'Filho', avatar: '🧒' })
        await montar()

        expect(interruptor('Pai')).toBeNull()
        expect(interruptor('Filho')).not.toBeNull()
    })

    it('de dentro de um perfil infantil nao existe interruptor nenhum', async () => {
        await profileService.createProfile({ name: 'Pai', avatar: '👨' })
        const filho = await profileService.createProfile({ name: 'Filho', avatar: '🧒' })
        await profileService.updateProfile(filho!.id, { isKids: true })
        profileService.setActiveProfile(filho!.id)
        await act(async () => { await new Promise(r => setTimeout(r, 0)) }) // import() do themeService
        await montar()

        expect(container!.querySelectorAll('button.pm-kids-toggle').length).toBe(0)
        // e o selo continua la, so que como selo
        expect(cartao('Filho').querySelector('.pm-kids-badge')).not.toBeNull()
    })
})
