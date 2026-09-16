import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🚦 A release não sai sem a suíte passar.
 *
 * A tag é empurrada à mão, num evento separado do push da main: dá para tagar
 * um commit cuja CI ainda está correndo — ou que está vermelha — e a release
 * sai PUBLICADA para todo mundo (`draft: false`), não como rascunho. Dentro do
 * `npm run build` o único gate de qualidade é o `tsc -b`, que nem enxerga o
 * processo principal.
 *
 * O portão é um job separado, e não um passo dentro da matriz de três sistemas:
 * com os três empacotando em paralelo, um teste vermelho no Linux ainda
 * deixaria os artefatos de Windows e mac subirem antes.
 */
const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'release.yml')

describe('release.yml: portão antes de publicar', () => {
    const fonte = fs.readFileSync(WORKFLOW, 'utf-8')

    it('existe um job de verificação que roda a suíte', () => {
        expect(fonte).toMatch(/^ {2}verificar:$/m)
        expect(fonte).toMatch(/npx vitest run/)
    })

    it('o job que publica espera o portão', () => {
        // Sem o `needs`, o portão roda em paralelo e não segura nada.
        expect(fonte).toMatch(/^ {2}release:\n {4}needs: verificar$/m)
    })

    it('a release continua saindo publicada (não é rascunho) — por isso o portão importa', () => {
        expect(fonte).toMatch(/draft: false/)
    })
})
