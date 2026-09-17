import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 💾 O PiP jogava fora a posição do filme.
 *
 * `saveProgress()` só era chamado por `handleClose` (o ✕) e `handleExpand`
 * (o ⧉) — os dois botões da barra interna, que é justamente a barra que o
 * CustomTitleBar do app cobre (App.tsx:339 monta o title bar FORA do
 * HashRouter, então ele existe também na janela do PiP). O X do title bar,
 * Alt+F4 e o fechar pela taskbar (`skipTaskbar: false` em pipHandlers.ts)
 * derrubavam a janela sem passar por eles, e o currentTime que o main recebia
 * em 'pip:state' era descartado (MiniPlayer zera o ref no 'pip:closed'). O
 * progresso vive no localStorage do renderer, por perfil e por playlist, então
 * só o próprio PipWindow pode gravar.
 *
 * Guarda estrutural (o repo não monta componente em teste: não há
 * @testing-library/react). Duas precauções para ele não passar por tabela:
 * só olha o trecho ANTES de `const handleClose` (senão o último bloco encosta
 * nos `saveProgress()` dos botões) e casa em `addEventListener('timeupdate'`,
 * não na palavra solta (senão um comentário citando 'timeupdate' já bastaria —
 * e o comentário da própria correção cita).
 */
const PIP = path.join(__dirname, '..', 'src', 'pages', 'PipWindow.tsx')

function efeitosAntesDosBotoes(fonte: string): string[] {
    const corte = fonte.indexOf('const handleClose')
    expect(corte).toBeGreaterThan(0)
    return fonte.slice(0, corte).split('useEffect(').slice(1)
}

describe('progresso do PiP sobrevive ao fechamento por fora', () => {
    it('grava a partir de um evento do vídeo, não só dos botões da barra interna', () => {
        const fonte = fs.readFileSync(PIP, 'utf-8')
        const comTimeupdate = efeitosAntesDosBotoes(fonte)
            .filter(b => b.includes("addEventListener('timeupdate'"))
        expect(comTimeupdate.length).toBeGreaterThan(0)
        expect(comTimeupdate.some(b => b.includes('saveProgress('))).toBe(true)
    })

    it('a gravação é amostrada, não uma por timeupdate', () => {
        // O 'timeupdate' dispara ~4x/s; sem amostragem viram 4 read-modify-write
        // do array de progresso por segundo, cada um podendo disparar sync do
        // Trakt (movieProgressService.ts:144) e CustomEvent.
        // Booleano, não `toContain`: o segundo despeja o arquivo inteiro no
        // log quando falha.
        const fonte = fs.readFileSync(PIP, 'utf-8')
        expect(fonte.includes('shouldSampleProgress')).toBe(true)
    })
})
