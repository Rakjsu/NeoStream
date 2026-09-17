import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🗑️ Nada apaga uma série baixada fora do handler de confirmação.
 *
 * O ✕ no canto do card da série chamava `downloadService.deleteSeries(...)`
 * direto do `onClick`: um clique apagava todos os episódios e a pasta
 * (`fs.rmSync(..., { recursive: true })` no main), sem perguntar nada. O card
 * do FILME, com a mesma cara e o mesmo ícone, abre um modal de confirmação —
 * quem apaga um arquivo só pergunta; quem apaga uma árvore de dezenas de GB,
 * não.
 *
 * O guarda é estrutural porque o repositório não tem `@testing-library/react`
 * (não há um único `*.test.tsx` na árvore), então não dá pra clicar no botão
 * num teste. Ele mora em `electron/` pelo motivo já documentado no
 * `i18nKeys.test.ts`: o `tsconfig.app.json` não dá `node:fs` a `src/`.
 *
 * O que ele trava não é a implementação: é a invariante que o próximo
 * `onClick={() => apagaTudo()}` vai quebrar.
 */
const DOWNLOADS = path.join(__dirname, '..', 'src', 'pages', 'Downloads.tsx')

function fonte(): string {
    return fs.readFileSync(DOWNLOADS, 'utf-8').split('\r\n').join('\n')
}

describe('excluir série baixada passa pela confirmação', () => {
    it('a exclusão mora no handler do confirm', () => {
        const texto = fonte()
        const confirmacao = texto.slice(
            texto.indexOf('const handleDeleteConfirm'),
            texto.indexOf('const handleDeleteCancel'),
        )
        expect(confirmacao.length).toBeGreaterThan(50) // achou o trecho mesmo
        expect(confirmacao).toContain('deleteSeries(')
    })

    it('e só nele — nenhum onClick chama deleteSeries direto', () => {
        expect((fonte().match(/deleteSeries\(/g) ?? [])).toHaveLength(1)
    })

    it('o modal não chama a série de "arquivo"', () => {
        // Reusar o modal do filme sem tocar no texto trocaria "um clique sem
        // aviso" por "um clique com aviso errado": `deleteConfirmText` diz
        // "Este arquivo será removido permanentemente".
        const texto = fonte()
        const modal = texto.slice(texto.indexOf('{deleteModal.isOpen'), texto.indexOf('{/* Header */}'))
        expect(modal).toContain('deleteSeriesConfirmText')
    })
})
