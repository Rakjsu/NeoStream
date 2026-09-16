import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 📜 Cada grade tem UM scroller.
 *
 * As três grades usam `useWindowedGrid`, que monta só as linhas visíveis e
 * escuta o `scroll` de um container — o que estiver em `scrollContainerRef`.
 * Em `LiveTV.tsx` o mesmo ref estava em DOIS divs aninhados: o externo, que só
 * rola quando o painel de detalhe está aberto, e o interno, que é o scroller
 * de verdade da grade. A ordem de anexo do React é de baixo para cima, então o
 * PAI vencia: o listener nunca disparava ao rolar os canais, a janela ficava
 * travada na primeira tela de cards e o resto da grade virava espaço em
 * branco. Pelo mesmo caminho, o `scrollTop = 0` de trocar categoria zerava o
 * div errado e a grade não voltava ao topo.
 *
 * A duplicata nasceu num revert (a03cec1, "revert grid virtualization"), que
 * pôs o ref no div externo sem tirar do interno — por isso o guarda é
 * estrutural: o próximo revert é quem precisa ficar vermelho.
 */
const PAGES = path.join(__dirname, '..', 'src', 'pages')

describe('scrollContainerRef: uma grade, um scroller', () => {
    it.each(['LiveTV.tsx', 'VOD.tsx', 'Series.tsx'])('%s carrega o ref em um único elemento', (arquivo) => {
        const fonte = fs.readFileSync(path.join(PAGES, arquivo), 'utf-8')
        const usos = fonte.match(/ref=\{scrollContainerRef\}/g) ?? []
        expect(usos).toHaveLength(1)
    })

    it('o scroller da TV ao vivo é o container da grade, não o painel de fora', () => {
        const fonte = fs.readFileSync(path.join(PAGES, 'LiveTV.tsx'), 'utf-8')
        const linha = fonte.split('\n').find((l: string) => l.includes('ref={scrollContainerRef}')) ?? ''
        expect(linha).toContain('livetv-scroll-container')
    })
})
