/**
 * Quem o Escape fecha no player.
 *
 * O atalho era global e incondicional: sem fullscreen, `onClose()` — ou seja,
 * derrubava o FILME. Abrir a engrenagem (Configurações do player), o painel de
 * marcadores (Shift+X) ou o QR de handoff e apertar Esc "pra sair do menu"
 * fechava o player inteiro e perdia a sessão. O `ChannelZapOverlay` se defendia
 * disso com um listener em fase de captura que dá `stopPropagation()` — prova
 * de que o problema já era conhecido, um overlay de cada vez.
 *
 * Aqui a decisão vira uma função pura: sobreposição aberta sempre ganha, e o
 * `onClose` só entra quando não há mais nada na frente.
 */
export type AlvoDoEscape = 'ajustes' | 'marcadores' | 'qr' | 'fullscreen' | 'fechar' | 'nada';

export interface AberturasDoPlayer {
    /** Menu da engrenagem. */
    ajustes: boolean;
    /** Painel de marcadores (Shift+X). */
    marcadores: boolean;
    /** QR de "continuar no celular". */
    qr: boolean;
    fullscreen: boolean;
    /** Há para onde voltar? Sem `onClose`, Esc no player não fecha nada. */
    podeFechar: boolean;
}

/**
 * A sobreposição vem ANTES do fullscreen de propósito: ela é o que está sob a
 * mão do usuário naquele instante, e sair do fullscreen deixando o menu aberto
 * é a mesma surpresa ("o Esc não fez o que eu quis"), só que mais barata.
 *
 * A ordem entre as três sobreposições é arbitrária — na prática só uma fica
 * aberta por vez, porque cada uma é acionada por um caminho diferente.
 */
export function alvoDoEscape(aberturas: AberturasDoPlayer): AlvoDoEscape {
    if (aberturas.ajustes) return 'ajustes';
    if (aberturas.marcadores) return 'marcadores';
    if (aberturas.qr) return 'qr';
    if (aberturas.fullscreen) return 'fullscreen';
    return aberturas.podeFechar ? 'fechar' : 'nada';
}
