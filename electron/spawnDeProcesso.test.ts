import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 🧯 Todo `spawn` do processo principal precisa de ouvinte de 'error'.
 *
 * O evento 'error' do ChildProcess é ASSÍNCRONO e não tem nada a ver com o
 * try/catch em volta do spawn: ele avisa que o processo não chegou a nascer
 * (binário sumido ou movido pelo antivírus, EACCES, caminho errado fora do
 * asar). E um EventEmitter que emite 'error' sem ouvinte LANÇA — no main isso
 * é `uncaughtException`, ou seja, o app inteiro cai: reprodução, DVR,
 * downloads e cast junto.
 *
 * O `windowsHide` é o vizinho barato: sem ele, cada processo pisca uma janela
 * de console preta por cima do que estiver na tela.
 *
 * O que este teste faz é modesto de propósito. Ele NÃO tenta amarrar cada
 * ouvinte ao seu spawn — isso exigiria entender escopo, e um teste estrutural
 * que "quase" entende escopo passa em falso (foi o que já aconteceu aqui com
 * janela de tamanho fixo). Ele cobra o inventário: mexeu no número de
 * processos que o main abre, alguém precisa olhar no olho e atualizar a lista.
 */

/** Quantos `spawn(` cada arquivo do main tem hoje, e por quê. */
const SPAWNS: Record<string, number> = {
    'dlnaHandlers.ts': 1,  // remux pro cast (ffmpeg -c copy → mpegts)
    'dvrHandlers.ts': 4,   // sonda, gravação, remux pra mp4, miniatura
    'mpvDownloader.ts': 1, // tar -xf do pacote do mpv
    'mpvPlayer.ts': 2,     // `mpv --version` e o player em si
    'timeshiftHandlers.ts': 1, // buffer circular de 30 min
}

const RAIZ = path.resolve(__dirname)

function fontes(): string[] {
    return fs.readdirSync(RAIZ)
        .filter(nome => nome.endsWith('.ts') && !nome.endsWith('.test.ts'))
}

function ler(nome: string): string {
    return fs.readFileSync(path.join(RAIZ, nome), 'utf-8').split('\r\n').join('\n')
}

/** Chamadas de `spawn(` — a linha do import não conta. */
function quantosSpawns(fonte: string): number {
    return (fonte.match(/(?<!import \{ )\bspawn\(/g) ?? []).length
}

describe('processos que o main abre', () => {
    const arquivos = fontes()

    it('acha os arquivos do main (guarda contra varredura vazia)', () => {
        expect(arquivos.length).toBeGreaterThan(20)
    })

    it('o inventário de spawns bate com o código', () => {
        const encontrado: Record<string, number> = {}
        for (const nome of arquivos) {
            const total = quantosSpawns(ler(nome))
            if (total > 0) encontrado[nome] = total
        }
        expect(encontrado, 'spawn novo (ou removido): atualize o inventário e confira o ouvinte de error')
            .toEqual(SPAWNS)
    })

    it('todo arquivo que abre processo ouve o "error" dele', () => {
        for (const nome of Object.keys(SPAWNS)) {
            expect(ler(nome), `${nome} dá spawn sem ouvir 'error' — 'error' sem ouvinte derruba o main`)
                .toContain(`on('error'`)
        }
    })

    it('cada spawn decide sobre a janela de console (windowsHide)', () => {
        // `windowsHide: false` também conta: o player do mpv PRECISA da janela.
        // O que não pode é o campo simplesmente não existir.
        for (const [nome, total] of Object.entries(SPAWNS)) {
            const fonte = ler(nome)
            const decisoes = (fonte.match(/windowsHide:/g) ?? []).length
            expect(decisoes, `${nome}: ${total} spawn(s) e ${decisoes} windowsHide`).toBeGreaterThanOrEqual(total)
        }
    })
})
