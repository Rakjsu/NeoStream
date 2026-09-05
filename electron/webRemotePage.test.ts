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

/**
 * A página do celular é uma template string gigante que gera JS — e nada nunca
 * COMPILOU esse JS. Foi assim que uma aspas sem escape (`display='none'`, no
 * meio de sete irmãs escapadas corretamente) matou o `<script>` INTEIRO em
 * produção: a página carregava, mostrava a marcação, e não fazia nada. Sem
 * erro no build, sem teste vermelho, sem log.
 */
describe('renderRemotePage: o JS servido precisa compilar', () => {
    /** O miolo do único par <script>/</script> da página. */
    function scriptDa(pagina: string): string {
        const ini = pagina.indexOf('<script>')
        const fim = pagina.indexOf('</script>')
        expect(ini).toBeGreaterThan(-1)
        expect(fim).toBeGreaterThan(ini)
        return pagina.slice(ini + '<script>'.length, fim)
    }

    // `new Function` compila sem executar: não precisa de DOM nem WebSocket.
    it.each(['pt', 'en', 'es'])('o script servido em %s compila', (lang) => {
        const src = scriptDa(renderRemotePage(lang))
        expect(() => new Function(src)).not.toThrow()
    })

    it('nenhuma aspas de atributo escapa sem barra (foi assim que a página morreu)', () => {
        // Dentro da template string do TS, `\'` é o que chega ao navegador
        // como `\'`. Sem as barras, a aspas fecha a string do JS gerado.
        expect(renderRemotePage()).not.toContain("display='none'")
    })

    it('mensagem de WS que estoura é reportada, não engolida', () => {
        expect(renderRemotePage()).toContain("console.error('[NeoStream] mensagem WS ignorada:'")
    })

    it('a página servida não tem nenhum catch totalmente vazio', () => {
        expect(renderRemotePage()).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/)
    })

    it('o payload logado sai recortado — um screenshot em dataUrl não inunda o console', () => {
        expect(renderRemotePage()).toContain('String(ev.data).slice(0, 200)')
    })
})
