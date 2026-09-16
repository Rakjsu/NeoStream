/**
 * ▶️ O que fazer com um `<video>` de fonte DIRETA quando o efeito do `useHls`
 * roda — trocar a fonte, recarregar a mesma, ou não mexer.
 *
 * Fonte direta é o caminho do VOD comum (`.mp4`/`.mkv` do Xtream): sem HLS,
 * sem MSE, o `<video>` recebe a URL e pronto. O efeito tratava esse caso com
 * uma linha só — `if (video.src !== src) video.src = src` —, escrita para não
 * reiniciar a reprodução quando o efeito re-roda por outro motivo. O preço
 * apareceu no botão **Tentar novamente** da tela de falha: ele só incrementa
 * o `reloadToken`, o efeito roda de novo com a MESMA URL, a comparação dá
 * falso e o elemento não faz pedido nenhum. Nenhum `load()` existia no player
 * inteiro, então o usuário esperava mais 10 segundos de watchdog e recebia a
 * mesma tela de erro. Em canal ao vivo (HLS) o retry funciona — um `new Hls()`
 * é criado do zero —, o que escondia o defeito no caminho mais usado.
 *
 * A regra é separada do efeito porque o que importa aqui é a DECISÃO, e ela
 * cabe num teste sem precisar de um elemento de mídia de mentira (mesmo
 * motivo do `windowedGridMath` ao lado do `useWindowedGrid`).
 */

export type AcaoDeCarga = 'trocar' | 'recarregar' | 'nada'

export interface EstadoDaFonteDireta {
    /** `video.src` — o navegador devolve sempre a URL absoluta. */
    srcAtual: string
    /** A fonte que o efeito quer tocar agora. */
    srcNovo: string
    /** O `reloadToken` mudou desde a última vez que este efeito rodou. */
    tokenMudou: boolean
    /** `video.error !== null` — o elemento está parado num erro de mídia. */
    temErro: boolean
}

export function cargaDeFonteDireta(estado: EstadoDaFonteDireta): AcaoDeCarga {
    // Fonte nova: atribuir o src já dispara o carregamento sozinho.
    if (estado.srcAtual !== estado.srcNovo) return 'trocar'
    // Mesma fonte, mas alguém PEDIU de novo (o botão "Tentar novamente"), ou o
    // elemento está travado num erro: só `load()` refaz o pedido.
    if (estado.tokenMudou || estado.temErro) return 'recarregar'
    // Mesma fonte, sem pedido e sem erro: o efeito re-rodou por outro motivo
    // (uma preferência mudou). Mexer aqui zeraria a posição de quem está
    // assistindo — é justamente o que a linha original protegia.
    return 'nada'
}
