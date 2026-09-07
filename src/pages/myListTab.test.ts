import { describe, it, expect } from 'vitest'
import { resolveMyListTab, MY_LIST_TABS } from './myListTab'

describe('resolveMyListTab', () => {
    it('a URL vence a aba salva', () => {
        // O caso que motivou o helper: o atalho da Home pede "Ver depois" e o
        // usuário tinha deixado a Fila aberta. Antes, a salva ganhava e o
        // atalho abria outra aba.
        expect(resolveMyListTab('watchLater', 'queue')).toBe('watchLater')
    })

    it('sem URL, cai na aba salva', () => {
        expect(resolveMyListTab(null, 'queue')).toBe('queue')
        expect(resolveMyListTab(undefined, 'watchLater')).toBe('watchLater')
    })

    it('sem nada, abre Favoritos', () => {
        expect(resolveMyListTab(null, null)).toBe('favorites')
    })

    it('valor inventado é ignorado dos dois lados', () => {
        // `?tab=` vem da barra de endereço e o localStorage sobrevive a
        // renomeação de aba — os dois podem trazer lixo.
        expect(resolveMyListTab('historico', 'queue')).toBe('queue')
        expect(resolveMyListTab('', '')).toBe('favorites')
        expect(resolveMyListTab('WATCHLATER', null)).toBe('favorites')
    })

    it('toda aba declarada é aceita pelos dois caminhos', () => {
        for (const aba of MY_LIST_TABS) {
            expect(resolveMyListTab(aba, null)).toBe(aba)
            expect(resolveMyListTab(null, aba)).toBe(aba)
        }
    })
})
