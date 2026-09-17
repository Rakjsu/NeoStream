import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 📜 Escolher uma Apple TV tem que fechar a janela e parar o PC.
 *
 * DLNA e Chromecast passam por `handleCast`/`handleChromecast`, que fazem
 * `setCasting`, `onDeviceSelected`, `onClose` e `setCastError`. O AirPlay era o
 * único que chamava o hook cru (`cast: () => castToAirPlayDevice(device)`), e o
 * hook devolvia `void`. Como o `airplay:cast` NUNCA rejeita (o handler do main
 * devolve `{ success: false }`), a falha era silêncio absoluto: modal aberto,
 * botão sem desabilitar, nenhuma mensagem — e, no sucesso, o filme seguia
 * tocando no PC ao mesmo tempo que na TV.
 *
 * O guarda é estrutural porque o repositório não tem harness de render no
 * renderer (sem `@testing-library/react`) e `castToDevice` vive dentro de um
 * hook. Mesmo molde de `electron/scrollContainerRef.test.ts`, que também lê
 * `src/` com `node:fs`. Limite assumido: isto prova que os três caminhos têm a
 * mesma forma, não o comportamento em runtime.
 */
const SRC = path.join(__dirname, '..', 'src')
const lerFonte = (...partes: string[]) =>
    fs.readFileSync(path.join(SRC, ...partes), 'utf-8').split('\r\n').join('\n')

const hook = lerFonte('hooks', 'useAirPlay.ts')
const seletor = lerFonte('components', 'CastDeviceSelector.tsx')
const player = lerFonte('components', 'VideoPlayer', 'VideoPlayer.tsx')

describe('escolha de aparelho AirPlay', () => {
    it('castToDevice devolve o sucesso ao chamador (igual ao do Chromecast)', () => {
        const corpo = hook.slice(hook.indexOf('const castToDevice'), hook.indexOf('const stopCasting'))
        expect(corpo).toMatch(/castToDevice\s*=\s*async\s*\([^)]*\)\s*:\s*Promise<boolean>/)
        expect(corpo).toMatch(/return\s+!!?result\.success/)
        expect(corpo).toMatch(/return\s+false/)
    })

    it('a lista trata AirPlay pelo mesmo caminho de DLNA/Chromecast', () => {
        expect(seletor).not.toMatch(/cast:\s*\(\)\s*=>\s*castToAirPlayDevice\(device\)/)
        const inicio = seletor.indexOf('const handleAirplay')
        expect(inicio, 'não achei o handleAirplay em CastDeviceSelector.tsx').toBeGreaterThan(-1)
        const handler = seletor.slice(inicio, inicio + 900)
        expect(handler).toContain('onDeviceSelected')
        expect(handler).toContain('onClose')
        expect(handler).toContain("t('cast', 'failedToTransmit')")
    })

    it('o player adota a sessão AirPlay e pausa o vídeo local', () => {
        expect(player).toMatch(/type:\s*'dlna'\s*\|\s*'chromecast'\s*\|\s*'airplay'/)
        const bloco = player.slice(player.indexOf('onDeviceSelected={(device)'), player.indexOf('/* Mini remote'))
        expect(bloco).not.toMatch(/device\.type === 'dlna' \|\| device\.type === 'chromecast'\s*\)/)
        expect(bloco).toContain('setCastingDevice')
        expect(bloco).toContain('controls.togglePlay()')
    })

    it('o mini-remoto do AirPlay continua só na pílula global (sem duplicar)', () => {
        // Cerca do outro lado: `CastControls` já aceita 'airplay' e o
        // GlobalCastIndicator já o monta. Montar outro aqui daria duas
        // instâncias polando `airplay:status`.
        expect(player).toMatch(/castingDevice\.type === 'dlna' &&/)
    })
})
