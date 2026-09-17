import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * ♿ "Reduzir animações" tem que PARAR o laço, não só encurtá-lo.
 *
 * O interruptor de Aparência estampa `data-motion="reduced"` no `<html>`
 * (themeService.apply) e quem responde é um bloco de `src/index.css`. Ele
 * zerava só a DURAÇÃO — `animation-duration: 0.001s !important` —, o que não
 * para animação `infinite` nenhuma: ela completa ~1000 voltas por segundo
 * amostradas a 60 fps, ou seja, tremulação. Com 114 declarações `... infinite`
 * no app, a opção de acessibilidade entregava o contrário do que promete.
 *
 * `animation-play-state: paused` NÃO serve: congelaria no quadro arbitrário em
 * que a pessoa ligou o interruptor. Com `fill-mode` padrão (`none`, e nenhuma
 * dessas animações usa `forwards`/`both`), uma única volta de 1 ms devolve o
 * elemento ao estilo base.
 *
 * O guarda é estrutural porque o jsdom NÃO expande o atalho `animation:` em
 * longhands: `getComputedStyle(el).animationIterationCount` já devolve `"1"`
 * (o valor inicial) mesmo sem a correção, então um teste de comportamento
 * passaria verde sozinho. Não tente de novo por ali.
 */
const SRC = path.join(__dirname, '..', 'src')

/** Cada `seletor { corpo }` do arquivo (o index.css não tem regra aninhada). */
function regras(css: string) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map((m) => ({ seletor: m[1].trim().replace(/\s+/g, ' '), corpo: m[2] }))
}

function arquivosDeEstilo(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) return arquivosDeEstilo(p)
        return /\.(css|tsx)$/.test(e.name) ? [p] : []
    })
}

describe('Reduzir animações: encurtar a duração sem cortar o laço é estroboscópio', () => {
    it('toda regra que encurta animation-duration também limita a iteração', () => {
        const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf-8')
        const encurtam = regras(css).filter((r) => /animation-duration:\s*0?\.0\d*m?s/.test(r.corpo))
        // Se um dia o bloco virar `animation: none !important`, este guarda
        // fica vermelho sem haver defeito — é troca deliberada: sem ele, o
        // laço abaixo não roda e o teste passa com zero regras conferidas.
        expect(encurtam.length).toBeGreaterThan(0)
        for (const r of encurtam) {
            expect(r.corpo, r.seletor).toMatch(/animation-iteration-count:\s*1\s*!important/)
            // `paused` congelaria no quadro em que a pessoa ligou o interruptor.
            expect(r.corpo, r.seletor).not.toMatch(/animation-play-state/)
        }
    })

    it('o corte importa: o app continua cheio de animações infinitas', () => {
        const infinitas = arquivosDeEstilo(SRC)
            .flatMap((f) => fs.readFileSync(f, 'utf-8').split('\n'))
            .filter((l) => /animation[^;]*\binfinite\b/.test(l))
        expect(infinitas.length).toBeGreaterThan(50)
    })
})
