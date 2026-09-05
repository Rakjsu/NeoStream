// Onde está o ffmpeg — uma resposta só, para os quatro módulos que perguntam.
//
// Isto já foi copiado quatro vezes (DLNA, DVR, timeshift e transcoder) e as
// cópias divergiram: três usavam `createRequire(import.meta.url)` e uma usava
// `require` direto. O empacotador hoje normaliza as duas formas, mas depender
// disso é frágil — e é a mesma classe de detalhe que deixou o DVR morto no
// #242, quando o require inlinado devolveu um caminho dentro de dist-electron
// que não existe.
//
// Duas coisas precisam estar certas ao mesmo tempo:
//
//  1. O require tem que acontecer em TEMPO DE EXECUÇÃO. Um require que o
//     empacotador consegue resolver vira o módulo inlinado, e o caminho do
//     binário passa a ser calculado a partir do __dirname do bundle.
//  2. Num app empacotado o binário fica FORA do asar (asarUnpack), então o
//     caminho que o ffmpeg-static devolve precisa ser reescrito.

import { createRequire } from 'node:module'

const requireRuntime = createRequire(import.meta.url)

/**
 * Reescreve o caminho para o de fora do asar. PURO — a regra que já quebrou o
 * DVR merece teste próprio.
 *
 * Fora de um app empacotado o caminho não contém `app.asar` e volta intacto.
 */
export function foraDoAsar(caminho: string): string {
    // Idempotente de proposito. As quatro copias que isto substitui nao eram:
    // aplicar duas vezes dava `app.asar.unpacked.unpacked`. Cada uma era
    // chamada uma vez so, entao nunca doeu — mas agora que a funcao e
    // compartilhada, a segunda chamada viraria uma armadilha silenciosa.
    if (caminho.includes('app.asar.unpacked')) return caminho
    return caminho.replace('app.asar', 'app.asar.unpacked')
}

/** Caminho do binário do ffmpeg, ou null quando não há ffmpeg disponível. */
export function resolveFfmpegPath(): string | null {
    try {
        const caminho = requireRuntime('ffmpeg-static') as string | null
        return caminho ? foraDoAsar(caminho) : null
    } catch {
        return null
    }
}
