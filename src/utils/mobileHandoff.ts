// 📱 Item 39: QR no player — deep link que o app do celular abre pra
// continuar o conteúdo atual (o celular resolve a URL com a conta DELE).
export interface MobileHandoff {
    kind: 'movie' | 'series';
    /** stream_id do filme ou id do episódio (mesma conta nos 2 lados). */
    sid: string;
    container: string;
    name: string;
}

/**
 * Capacidade do QR do player (byte mode, EC nível L): v4 = 80 codewords − 2 de
 * overhead. O encoder próprio só vai até a v4, então o link PRECISA caber aqui,
 * senão o qrToSvg lança e derruba a tela do player.
 */
export const HANDOFF_QR_MAX_BYTES = 78;

/** Monta o deep link neostream://open-content com a posição atual. PURO.
 *  O nome é só cosmético (o celular resolve o conteúdo pelo sid), então é
 *  truncado no que couber no QR — sem nome antes de estourar a capacidade. */
export function buildHandoffLink(handoff: MobileHandoff, positionSec: number): string {
    const pos = Math.max(0, Math.floor(Number.isFinite(positionSec) ? positionSec : 0));
    // Query montada na mão com encodeURIComponent: o URLSearchParams usa
    // form-encoding (espaço vira '+') e o parser de query do expo-router não
    // desfaz isso — o título chegava no celular como "O+Rei+Leão".
    const build = (name: string): string => {
        const parts = [
            `kind=${handoff.kind}`,
            `sid=${encodeURIComponent(handoff.sid)}`,
            `container=${encodeURIComponent(handoff.container || 'mp4')}`,
            ...(name ? [`name=${encodeURIComponent(name)}`] : []),
            `pos=${pos}`,
        ];
        return `neostream://open-content?${parts.join('&')}`;
    };

    // Fatiar por code point (não por unidade UTF-16): cortar no meio de um par
    // substituto gera um surrogate solto — que vira '�' no título e faz o
    // encodeURIComponent LANÇAR. Surrogate solto na entrada também cai fora.
    const chars = Array.from(handoff.name || '')
        .filter(char => !(char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff))
        .slice(0, 120);
    const full = build(chars.join(''));
    if (full.length <= HANDOFF_QR_MAX_BYTES) return full;

    // O nome fez o link estourar o QR — trunca pro maior prefixo que ainda cabe
    // (busca binária; a URL é sempre ASCII, então .length == bytes).
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (build(chars.slice(0, mid).join('')).length <= HANDOFF_QR_MAX_BYTES) lo = mid;
        else hi = mid - 1;
    }
    return build(chars.slice(0, lo).join(''));
}
