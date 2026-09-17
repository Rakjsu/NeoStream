import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔐 Todo chamador do `dvr:rename-file` migra a marca de protegida.
 *
 * A proteção contra a auto-faxina é guardada por CAMINHO COMPLETO
 * (`neostream_dvr_protected`, no localStorage) e o `dvr:rename-file` MOVE o
 * arquivo: o caminho antigo deixa de existir. Sem migrar a entrada, o 🔐 fica
 * apontando pro nada — a gravação que a pessoa marcou pra guardar volta a ser
 * candidata da faxina que roda sozinha ao abrir a página, e o 🗑 do celular,
 * que também consulta essa marca, passa a aceitar apagá-la.
 *
 * O main já devolve o caminho novo (`{ success: true, path: target }`); os dois
 * chamadores é que jogavam fora.
 *
 * O guarda varre `src/` inteiro em vez de cobrar dois arquivos conhecidos: um
 * TERCEIRO chamador do canal nasce vermelho também. O segundo caso trava a
 * lista atual, para que sumir com um call site seja decisão consciente, não
 * acidente. Guarda estrutural porque o repositório não tem
 * `@testing-library/react`; a REGRA em si (renomeado continua fora da faxina,
 * sem fantasma no storage, e renomear não protege o que não estava protegido)
 * é testada de verdade em `src/services/dvrSweep.test.ts`.
 */
const SRC = path.join(__dirname, '..', 'src')
const CANAL = "invoke('dvr:rename-file'"

function arquivosTsx(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) return arquivosTsx(p)
        return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
    })
}

/** Quem invoca o canal, e se migra a marca nas linhas seguintes. */
function chamadores(): { arquivo: string; migra: boolean }[] {
    const achados: { arquivo: string; migra: boolean }[] = []
    for (const arquivo of arquivosTsx(SRC)) {
        const fonte = fs.readFileSync(arquivo, 'utf-8').split('\r\n').join('\n')
        let at = fonte.indexOf(CANAL)
        while (at > -1) {
            // Janela generosa: o `path` da resposta costuma ser usado 2-6
            // linhas depois, junto do tratamento de sucesso.
            const janela = fonte.slice(at, at + 900)
            achados.push({ arquivo: path.basename(arquivo), migra: janela.includes('renameProtectedRecording(') })
            at = fonte.indexOf(CANAL, at + 1)
        }
    }
    return achados
}

describe('renomear gravação não pode desligar a proteção', () => {
    it('todo chamador do dvr:rename-file migra a marca pro caminho novo', () => {
        const esquecidos = chamadores().filter(c => !c.migra).map(c => c.arquivo)
        expect(esquecidos).toEqual([])
    })

    it('os chamadores conhecidos continuam sendo esses (mexeu, é de propósito)', () => {
        const nomes = [...new Set(chamadores().map(c => c.arquivo))].sort()
        expect(nomes).toEqual(['Downloads.tsx', 'WebRemoteBridge.tsx'])
    })
})
