/**
 * 💬 Ler o VTT e entregar o texto que vai para a tela.
 *
 * O player NÃO usa `<track>` nativo (ele não sobrevive à troca de fonte do
 * HLS): o `SubtitleOverlay` interpreta o VTT à mão e desenha o texto como nó
 * de TEXTO do React. Isso é seguro — o React escapa tudo, nada de HTML de
 * terceiro entra na página — mas significa que **toda marcação aparece
 * literalmente**. Legenda de OpenSubtitles usa `<i>…</i>` para fala fora de
 * quadro o tempo inteiro, e arquivo antigo carrega `{\an8}` de posicionamento
 * e `<font color="#fff">`: o que o usuário lia era `<i>Ele sussurra</i>`.
 *
 * A limpeza mora AQUI, na leitura do overlay, e não no `srtToVtt` do
 * `subtitleService`: aquele VTT também é enviado para a TV no cast, e um
 * receptor entende `<i>` nativamente — apagar a marcação lá tiraria o itálico
 * de quem consegue mostrá-lo.
 *
 * Módulo separado do componente para poder ser testado sem montar React nem
 * simular um elemento de vídeo.
 */

export interface CueDeLegenda {
    /** Segundos. */
    startTime: number
    endTime: number
    text: string
}

/** `HH:MM:SS.mmm` ou `MM:SS.mmm` → segundos. */
export function lerMarcaDeTempo(timestamp: string): number {
    const parts = timestamp.split(':')
    if (parts.length === 3) {
        const hours = parseInt(parts[0], 10)
        const minutes = parseInt(parts[1], 10)
        const seconds = parseFloat(parts[2])
        return hours * 3600 + minutes * 60 + seconds
    }
    if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10)
        const seconds = parseFloat(parts[1])
        return minutes * 60 + seconds
    }
    return 0
}

/**
 * Tag de marcação: `<i>`, `</i>`, `<font color=…>`, `<c.amarelo>`, `<v Ana>`.
 *
 * Exige uma LETRA logo depois do `<` (ou do `</`) de propósito: diálogo com
 * comparação — "5 < 10 e 3 > 2" — não é marcação e não pode ser comido.
 */
const TAG = /<\/?[a-zA-Z][^>]*>/g

/** Bloco de override do SSA/ASS que sobrevive à conversão: `{\an8}`, `{\pos(1,2)}`. */
const OVERRIDE_SSA = /\{\\[^}]*\}/g

const ENTIDADES: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&nbsp;': ' ',
}

/**
 * Tira a marcação de uma linha de legenda, preservando o texto.
 *
 * As entidades são decodificadas DEPOIS das tags: um `&lt;i&gt;` escrito no
 * arquivo é texto que o autor quis mostrar, e continua aparecendo.
 */
export function limparMarcacaoDaLegenda(linha: string): string {
    const semMarcacao = String(linha ?? '')
        .replace(OVERRIDE_SSA, '')
        .replace(TAG, '')
    const semEntidades = semMarcacao.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENTIDADES[m] ?? m)
    return semEntidades.replace(/[ \t]+/g, ' ').trim()
}

/**
 * VTT → cues prontos para a tela.
 *
 * Sobre a linha de número: num arquivo bem formado o número do cue vem ANTES
 * da marca de tempo, e o laço de texto nem chega nele. Ele só aparece aqui
 * quando o arquivo não tem linha em branco entre os cues — e aí é sempre a
 * ÚLTIMA linha antes do próximo `-->`. Descartar TODA linha só-dígitos, como
 * era antes, engolia diálogo numérico: uma legenda cuja fala é "1945" ou "911"
 * simplesmente sumia da tela.
 */
export function lerCuesDoVtt(vttContent: string): CueDeLegenda[] {
    const cues: CueDeLegenda[] = []
    const lines = String(vttContent ?? '').split('\n')

    let i = 0
    while (i < lines.length && !lines[i].includes('-->')) i++

    while (i < lines.length) {
        const line = lines[i].trim()
        if (!line.includes('-->')) { i++; continue }

        const [startStr, endStr] = line.split('-->').map(s => s.trim().split(' ')[0])
        const startTime = lerMarcaDeTempo(startStr)
        const endTime = lerMarcaDeTempo(endStr)

        const textLines: string[] = []
        i++
        while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
            const textLine = lines[i].trim()
            const proxima = lines[i + 1]
            const numeroDoProximoCue = /^\d+$/.test(textLine) && proxima !== undefined && proxima.includes('-->')
            if (!numeroDoProximoCue) {
                const limpa = limparMarcacaoDaLegenda(textLine)
                if (limpa) textLines.push(limpa)
            }
            i++
        }

        if (textLines.length > 0) {
            cues.push({ startTime, endTime, text: textLines.join('\n') })
        }
    }

    return cues
}
