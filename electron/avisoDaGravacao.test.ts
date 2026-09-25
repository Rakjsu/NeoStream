import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔇 Botão de gravação que falha tem que dizer alguma coisa.
 *
 * O processo principal devolve o motivo em todo caminho de erro — "já existe
 * uma gravação com esse nome", "arquivo fora da pasta de gravações",
 * "Gravação em andamento", o erro do `unlinkSync`. Renomear, exportar e apagar
 * jogavam esse `error` fora: a linha sumia e voltava igual, ou a lista
 * recarregava com a gravação ainda lá. Só o conversor, vinte linhas acima na
 * mesma tela, já mostrava o motivo — o canal de aviso (`setDvrMsg`) existe e
 * está desenhado.
 *
 * O guarda é estrutural porque isto é fiação de `onClick` num arquivo de 900
 * linhas, e o projeto não tem @testing-library. O comportamento do lado do
 * main está coberto em `electron/renomearGravacao.test.ts`.
 */
const DOWNLOADS = path.join(__dirname, '..', 'src', 'pages', 'Downloads.tsx')

/** Canais de arquivo do DVR: todos podem falhar, e todos explicam por quê. */
const CANAIS = ['dvr:rename-file', 'dvr:export-file', 'dvr:delete-file', 'dvr:convert-mp4']

function fonte(): string {
    return fs.readFileSync(DOWNLOADS, 'utf-8').split('\r\n').join('\n')
}

/**
 * Cada chamada de um canal, com a janela de código que a segue.
 *
 * A faxina automática entra também (D182): ela era a exceção muda — um
 * catch vazio ("keep going") que nem via a falha, porque o main devolve
 * `{ success: false, error }` em vez de lançar. Agora ela conta o que saiu
 * e o que falhou e mostra no painel pelo `setFaxina`.
 */
function chamadas(canal: string): string[] {
    const texto = fonte()
    const achadas: string[] = []
    let de = texto.indexOf(`invoke('${canal}'`)
    while (de !== -1) {
        achadas.push(texto.slice(de, de + 700))
        de = texto.indexOf(`invoke('${canal}'`, de + 1)
    }
    return achadas
}

describe('a tela de gravações conta quando dá errado', () => {
    it.each(CANAIS)('%s mostra o motivo que o main devolveu', (canal) => {
        const usos = chamadas(canal)
        // Canal renomeado não pode deixar o guarda virar enfeite.
        expect(usos.length).toBeGreaterThan(0)
        for (const trecho of usos) {
            expect(/\bres(ult)?\?\.error\b/.test(trecho)).toBe(true)
            expect(trecho.includes('setDvrMsg(') || trecho.includes('setFaxina(')).toBe(true)
        }
    })

    it('nenhuma chamada engole o erro calada — nem a faxina automática (D182)', () => {
        const texto = fonte()
        const semAviso = texto.split('\n').filter(l => l.includes('invoke(\'dvr:') && l.includes('keep going'))
        expect(semAviso).toHaveLength(0)
    })
})
