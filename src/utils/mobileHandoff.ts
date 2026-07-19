// 📱 Item 39: QR no player — deep link que o app do celular abre pra
// continuar o conteúdo atual (o celular resolve a URL com a conta DELE).
export interface MobileHandoff {
    kind: 'movie' | 'series';
    /** stream_id do filme ou id do episódio (mesma conta nos 2 lados). */
    sid: string;
    container: string;
    name: string;
}

/** Monta o deep link neostream://open-content com a posição atual. PURO. */
export function buildHandoffLink(handoff: MobileHandoff, positionSec: number): string {
    const pos = Math.max(0, Math.floor(Number.isFinite(positionSec) ? positionSec : 0));
    const params = new URLSearchParams({
        kind: handoff.kind,
        sid: handoff.sid,
        container: handoff.container || 'mp4',
        name: handoff.name.slice(0, 120),
        pos: String(pos),
    });
    return `neostream://open-content?${params.toString()}`;
}
