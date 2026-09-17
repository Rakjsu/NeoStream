import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🖼️ A vitrine não pode acordar no meio de um filme no MPV.
 *
 * O protetor de tela (ShowcaseScreensaver) só se segura enquanto encontra um
 * `<video>` no DOM. O motor MPV não põe `<video>` nenhum: ele cola uma janela
 * NATIVA do mpv sobre a área do app e marca presença no DOM só com a classe
 * `.mpv-view-backdrop`. Com "Player MPV" + "protetor de tela em N min" (os dois
 * interruptores vivem no MESMO painel, Configurações → Reprodução), a vitrine
 * ativava durante a reprodução e, como teclado e mouse vão para a janela do
 * mpv e não para o `document`, o `onActivity` não disparava: ela ficava ativa o
 * filme inteiro puxando o catálogo VOD por IPC e re-renderizando a cada 8 s.
 *
 * O invariante atravessa DOIS arquivos, então o guarda ancora as duas pontas:
 *   A) MpvPlayerView continua invisível para um seletor `video` e continua
 *      marcando presença com `.mpv-view-backdrop` (se isso mudar, a premissa
 *      do seletor da vitrine mudou e alguém tem que reavaliar);
 *   B) o teste de ativação da vitrine olha as DUAS marcas — e, ao encontrar
 *      reprodução, RE-ARMA o timer em vez de ligar a vitrine.
 *
 * Guarda estrutural (lê o fonte) porque não há @testing-library no repositório
 * e a decisão mora dentro do `useEffect` do componente: é a ponta B, o fio
 * entre o `if` e o `arm()`, que precisa ficar vermelha — e ela não existe fora
 * do componente para ser chamada num teste.
 */
const COMPONENTS = path.join(__dirname, '..', 'src', 'components')

describe('vitrine x player MPV', () => {
    it('ponta A: o MpvPlayerView não deixa <video> no DOM, só a marca .mpv-view-backdrop', () => {
        const fonte = fs.readFileSync(path.join(COMPONENTS, 'MpvPlayerView.tsx'), 'utf-8')
        expect(fonte.includes('className="mpv-view-backdrop"')).toBe(true)
        expect(/<video[\s>]/.test(fonte)).toBe(false)
    })

    it('ponta B: a vitrine só ativa se não houver <video> NEM janela do MPV', () => {
        const fonte = fs.readFileSync(path.join(COMPONENTS, 'ShowcaseScreensaver.tsx'), 'utf-8')
        const linhas = fonte.split('\n')
        const i = linhas.findIndex(l => l.includes('document.querySelector('))
        expect(i, 'o guarda de reprodução sumiu do ShowcaseScreensaver').toBeGreaterThan(-1)

        const seletor = linhas[i].match(/querySelector\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ?? ''
        expect(seletor.includes('video')).toBe(true)
        expect(seletor.includes('.mpv-view-backdrop')).toBe(true)

        // E o corpo do guarda RE-ARMA o timer; nunca liga a vitrine.
        const corpo = linhas.slice(i + 1, i + 4).join(' ')
        expect(corpo.includes('arm()')).toBe(true)
        expect(corpo.includes('setActive(true)')).toBe(false)
    })
})
