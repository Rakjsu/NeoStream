import { describe, it, expect } from 'vitest'
import { renderRemotePage, REMOTE_PAGE_HTML } from './webRemotePage'

describe('renderRemotePage (i18n da página do celular)', () => {
    it('serve pt por padrão e pra idiomas desconhecidos', () => {
        expect(renderRemotePage()).toContain('Digite o PIN')
        expect(renderRemotePage('fr')).toContain('lang="pt-BR"')
        expect(REMOTE_PAGE_HTML).toContain('Transmitir fila')
    })

    it('serve en com os textos traduzidos (estáticos e do runtime)', () => {
        const page = renderRemotePage('en')
        expect(page).toContain('<html lang="en">')
        expect(page).toContain('Enter the PIN')
        expect(page).toContain('Cast queue')
        // Dicionário do runtime injetado como `var L = {...}`.
        expect(page).toContain('"becauseWatched":"Because you watched"')
        expect(page).not.toContain('Digite o PIN')
    })

    it('serve es com os textos traduzidos', () => {
        const page = renderRemotePage('es')
        expect(page).toContain('<html lang="es">')
        expect(page).toContain('Ingresa el PIN')
        expect(page).toContain('Películas')
        expect(page).toContain('"noTvFound":"No se encontró ninguna TV en la red"')
    })
})
