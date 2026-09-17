import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 📺 "Ao vivo" no Chromecast vem do contentType da tela, não da extensão.
 *
 * O LOAD do castv2 manda `streamType: media.live ? 'LIVE' : 'BUFFERED'`
 * (castProtocol.ts) e, quando é LIVE, ignora o currentTime (castHandlers.ts
 * passa 0). O CastDeviceSelector decidia esse flag só pela extensão da URL
 * (`/\.m3u8(\?|$)/`), enquanto RECEBIA `contentType` ('movie'|'series'|'live')
 * como prop e jogava fora. Só o Xtream clássico termina em `.m3u8`: playlist
 * M3U devolve o `direct_source` cru (.ts ou sem extensão), portal Stalker
 * devolve o link do create-link e o timeshift no formato (b) é um `.php` com
 * query. Nesses casos o canal ia BUFFERED — a TV desenhava barra de progresso
 * falsa e ainda recebia como posição inicial o `currentTime` do player local.
 *
 * O guarda é ESTRUTURAL (não há @testing-library/react no repo): lê o fonte e
 * confere que o 3º argumento de `useChromecast(...)` — o `isLive` — consulta o
 * `contentType`. Qualquer forma de escrever a decisão passa; voltar a decidir
 * só pela extensão reprova.
 */
const RAIZ = path.join(__dirname, '..')
const SELETOR = path.join(RAIZ, 'src', 'components', 'CastDeviceSelector.tsx')

/** Argumentos de topo da chamada `nome(`: casa parênteses e quebra por vírgula. */
function argumentosDaChamada(fonte: string, nome: string): string[] {
    const inicio = fonte.indexOf(nome + '(')
    if (inicio < 0) return []
    let i = inicio + nome.length + 1
    let profundidade = 1
    let atual = ''
    const args: string[] = []
    for (; i < fonte.length && profundidade > 0; i++) {
        const c = fonte[i]
        if (c === '(' || c === '[' || c === '{') profundidade++
        else if (c === ')' || c === ']' || c === '}') {
            profundidade--
            if (profundidade === 0) break
        }
        if (c === ',' && profundidade === 1) { args.push(atual.trim()); atual = ''; continue }
        atual += c
    }
    args.push(atual.trim())
    return args
}

describe('canal ao vivo no Chromecast: LIVE vem do contentType, nao da extensao', () => {
    it('o 3o argumento (isLive) do useChromecast consulta o contentType da tela', () => {
        const fonte = fs.readFileSync(SELETOR, 'utf-8')
        const args = argumentosDaChamada(fonte, 'useChromecast')
        expect(args.length).toBeGreaterThanOrEqual(3)
        const isLive = args[2]
        // Qualquer formulação serve (===, includes, helper); o que não pode
        // voltar é decidir "ao vivo" só pela extensão da URL. O segundo
        // `expect` fecha o buraco de passar com `contentType === 'movie'`.
        expect(isLive.includes('contentType')).toBe(true)
        expect(isLive.includes("'live'")).toBe(true)
    })

    it('o seletor continua declarando e desestruturando a prop contentType', () => {
        const fonte = fs.readFileSync(SELETOR, 'utf-8')
        expect(/contentType\?:\s*'movie'\s*\|\s*'series'\s*\|\s*'live'/.test(fonte)).toBe(true)
        expect(/^\s*contentType,\s*\r?$/m.test(fonte)).toBe(true)
    })

    it('o VideoPlayer continua repassando contentType para o CastDeviceSelector', () => {
        const fonte = fs.readFileSync(path.join(RAIZ, 'src', 'components', 'VideoPlayer', 'VideoPlayer.tsx'), 'utf-8')
        const inicio = fonte.indexOf('<CastDeviceSelector')
        expect(inicio).toBeGreaterThan(-1)
        const bloco = fonte.slice(inicio, fonte.indexOf('/>', inicio))
        expect(bloco.includes('contentType={contentType}')).toBe(true)
    })

    it('TV ao vivo e guia continuam declarando contentType="live"', () => {
        for (const arquivo of ['LiveTV.tsx', 'EpgGuide.tsx']) {
            const fonte = fs.readFileSync(path.join(RAIZ, 'src', 'pages', arquivo), 'utf-8')
            expect(fonte.includes('contentType="live"')).toBe(true)
        }
    })
})
