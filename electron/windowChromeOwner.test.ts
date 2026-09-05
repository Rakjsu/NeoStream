import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🔒 Um único dono para os estilos do body.
 *
 * Teste estrutural POR AUSÊNCIA (mesmo espírito do "o corpo do servidor não
 * toca no sessionPin" em webRemoteRoutes.test.ts): não tenta entender fluxo
 * de controle, só cobra que ninguém fora de windowChrome.ts escreva
 * opacity/transform em document.body.style.
 *
 * É o que pega "alguém copiou o fade num caminho novo de esconder a janela"
 * — o cenário exato que produziu a tela cinza. Uma variante que exigisse
 * "todo handler que zera também restaura" ficaria verde justamente no caso
 * perigoso (bastaria extrair os handlers para um hook).
 */

// Mora em electron/ (como preloadChannels.test.ts): varre o renderer com
// node:fs, e o tsconfig de src/ não tem os tipos do Node.
const ROOT = path.join(__dirname, '..')
const DONO = path.join('src', 'utils', 'windowChrome.ts')
const PROIBIDO = /document\.body\.style\.(opacity|transform)\s*=/

function arquivosDoRenderer(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) arquivosDoRenderer(full, out)
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
    }
    return out
}

describe('windowChrome é o único que escreve opacity/transform no body', () => {
    const arquivos = arquivosDoRenderer(path.join(ROOT, 'src'))

    it('acha os arquivos do renderer (guarda contra varredura vazia)', () => {
        expect(arquivos.length).toBeGreaterThan(50)
    })

    it('nenhum outro arquivo de src/ escreve document.body.style.opacity|transform', () => {
        const infratores = arquivos
            .filter(f => path.relative(ROOT, f) !== DONO)
            .filter(f => PROIBIDO.test(fs.readFileSync(f, 'utf-8')))
            .map(f => path.relative(ROOT, f))
        expect(infratores).toEqual([])
    })

    it('o handleClose do CustomTitleBar não tem setTimeout nem animação', () => {
        // O setTimeout de 200 ms era a corrida: o foco podia mudar de janela
        // no meio, e o `window:close` ia fechar o PiP em vez da principal.
        const fonte = fs.readFileSync(path.join(ROOT, 'src', 'components', 'CustomTitleBar', 'CustomTitleBar.tsx'), 'utf-8')
        const inicio = fonte.indexOf('const handleClose')
        expect(inicio).toBeGreaterThan(-1)
        const corpo = fonte.slice(inicio, fonte.indexOf('return (', inicio))
        expect(corpo).not.toContain('setTimeout')
        expect(corpo).not.toContain('animarSaida')
        expect(corpo).toContain("invoke('window:close')")
    })
})
