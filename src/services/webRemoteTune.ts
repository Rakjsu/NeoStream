/**
 * Resolução do canal pedido pelo celular ("assistir no PC"). PURO.
 *
 * O celular manda o stream_id da conta DELE; quando os dois lados usam contas
 * diferentes esse id não existe aqui e a sintonia virava no-op silencioso. O
 * nome é o resgate — mesma estratégia que o app já usa ao receber o
 * "enviar pro celular" (id primeiro, nome depois).
 */

export interface TunableChannel {
    stream_id: number | string;
    name: string;
}

const normalize = (value: string) => value.trim().toLowerCase();

/** Canal pedido: id do provedor primeiro, nome normalizado como resgate. */
export function resolveRemoteChannel<T extends TunableChannel>(
    channels: T[],
    channelId: string,
    name?: string,
): T | undefined {
    const byId = channels.find(c => String(c.stream_id) === channelId);
    if (byId) return byId;
    if (!name || !name.trim()) return undefined;
    const wanted = normalize(name);
    return channels.find(c => normalize(c.name) === wanted);
}
