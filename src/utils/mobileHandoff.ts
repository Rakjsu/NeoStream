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
    const build = (name: string): string => {
        const params = new URLSearchParams({
            kind: handoff.kind,
            sid: handoff.sid,
            container: handoff.container || 'mp4',
            ...(name ? { name } : {}),
            pos: String(pos),
        });
        return `neostream://open-content?${params.toString()}`;
    };

    const fullName = (handoff.name || '').slice(0, 120);
    const full = build(fullName);
    if (full.length <= HANDOFF_QR_MAX_BYTES) return full;

    // O nome fez o link estourar o QR — trunca pro maior prefixo que ainda cabe
    // (busca binária; a URL é sempre ASCII, então .length == bytes).
    let lo = 0;
    let hi = fullName.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (build(fullName.slice(0, mid)).length <= HANDOFF_QR_MAX_BYTES) lo = mid;
        else hi = mid - 1;
    }
    return build(fullName.slice(0, lo));
}
