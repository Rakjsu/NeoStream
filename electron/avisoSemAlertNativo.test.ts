import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🚫 Nenhuma tela do renderer abre diálogo NATIVO do navegador.
 *
 * O app roda numa janela sem moldura, com barra de título própria. O diálogo
 * nativo do Chromium ignora isso: abre com o visual do navegador, título com o
 * caminho `file://`, e — o que importa de verdade — PARA o JS do renderer até
 * alguém clicar OK. As recusas das telas de perfil e da aba de diagnóstico
 * eram as últimas cinco do app a usá-lo; o resto já avisa in-app.
 *
 * O guarda tem DUAS pontas de propósito:
 *
 *  A) nenhum arquivo de `src/` chama `alert`/`confirm`/`prompt` — varre o
 *     padrão, não a lista de arquivos, senão a próxima tela reintroduz o
 *     defeito num arquivo que ninguém listou aqui;
 *  B) cada tela que perdeu o diálogo continua AVISANDO. Sem a ponta B, apagar
 *     a chamada e deixar a recusa silenciosa — que é pior que o diálogo feio —
 *     passaria no teste.
 *
 * A ponta B checa também que o aviso fica por CIMA de tudo: ele é
 * `position: fixed` e a recusa da cor do perfil sai de dentro de um modal, e um
 * aviso escondido atrás do overlay é o mesmo que não avisar.
 */
const RAIZ = path.join(__dirname, '..')

/** Os fontes são CRLF; normalizar antes de fatiar, senão o `\r` entra nos recortes. */
function ler(rel: string): string {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf-8').split('\r\n').join('\n')
}

function fontesDoRenderer(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) return fontesDoRenderer(p)
        return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
    })
}

/** Maior z-index declarado num template de estilos. */
function maiorZIndex(fonte: string): number {
    return Math.max(0, ...[...fonte.matchAll(/z-index:\s*(\d+)/g)].map(m => Number(m[1])))
}

describe('avisos do renderer: nada de diálogo nativo', () => {
    it('ponta A: nenhum fonte de src/ chama alert/confirm/prompt', () => {
        const culpados: string[] = []
        for (const arquivo of fontesDoRenderer(path.join(RAIZ, 'src'))) {
            const fonte = fs.readFileSync(arquivo, 'utf-8')
            for (const [linha, i] of fonte.split('\n').map((l, i) => [l, i] as const)) {
                // `window.` na frente não salva: é o mesmo diálogo.
                if (/(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/.test(linha) && !linha.trim().startsWith('//') && !linha.trim().startsWith('*')) {
                    culpados.push(`${path.basename(arquivo)}:${i + 1} ${linha.trim().slice(0, 70)}`)
                }
            }
        }
        expect(culpados).toEqual([])
    })

    it.each([
        ['src/components/ProfileManager.tsx', 'pm-aviso', 10002],
        ['src/pages/ProfileSelector.tsx', 'profile-aviso', 1000],
    ])('ponta B: %s avisa in-app, por cima dos modais', (rel, classe, zDosModais) => {
        const fonte = ler(rel)
        // A recusa continua avisando (não virou silêncio).
        expect(fonte.includes('setAviso(')).toBe(true)
        expect(fonte.includes(`className="${classe}"`)).toBe(true)
        // E o aviso fica acima do overlay de quem pode tê-lo disparado.
        const regra = fonte.slice(fonte.indexOf(`.${classe} {`))
        const z = Number(/z-index:\s*(\d+)/.exec(regra)?.[1] ?? 0)
        expect(z).toBeGreaterThan(zDosModais)
        expect(z).toBeGreaterThanOrEqual(maiorZIndex(fonte))
    })

    it('ponta B: a aba de diagnóstico usa o banner que ela já tinha', () => {
        const fonte = ler('src/pages/settings/DiagnosticsSection.tsx')
        const inicio = fonte.indexOf('const handleExportLog')
        expect(inicio).toBeGreaterThan(-1)
        const corpo = fonte.slice(inicio, inicio + 700)
        expect(corpo.includes('setErrorMessage(')).toBe(true)
    })
})
