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
 * A faxina automática fica de fora pelo marcador `keep going` DA PRÓPRIA
 * LINHA: ela também chama `dvr:delete-file`, e excluir "por nome" não
 * distinguiria as duas.
 */
function chamadas(canal: string): string[] {
    const texto = fonte()
    const achadas: string[] = []
    let de = texto.indexOf(`invoke('${canal}'`)
    while (de !== -1) {
        const fimDaLinha = texto.indexOf('\n', de)
        const linha = texto.slice(de, fimDaLinha === -1 ? undefined : fimDaLinha)
        if (!linha.includes('keep going')) achadas.push(texto.slice(de, de + 700))
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
            expect(trecho).toContain('result?.error')
            expect(trecho).toContain('setDvrMsg(')
        }
    })

    it('a única chamada sem aviso é a faxina automática', () => {
        const texto = fonte()
        const semAviso = texto.split('\n').filter(l => l.includes('invoke(\'dvr:') && l.includes('keep going'))
        expect(semAviso).toHaveLength(1)
        expect(semAviso[0]).toContain('dvr:delete-file')
    })
})
