/**
 * Decisões puras do mini-guia da TV ao vivo — "qual canal é esse?" e "essa
 * busca de EPG ainda faz sentido?".
 *
 * O efeito de EPG da LiveTV dependia dos OBJETOS do canal, que mudam de
 * identidade a cada render: qualquer re-render (tick de 10 s, scroll, zap
 * pro mesmo canal) remontava o efeito e refazia a cadeia inteira. A chave
 * abaixo é só de primitivas, então ela só muda quando o canal muda DE FATO.
 */

export interface EpgChannelRef {
    epg_channel_id?: string;
    name?: string;
    stream_id?: number | string;
}

export interface EpgProgramWindow {
    start: string;
    end: string;
}

/** Identidade do canal pro efeito/memo de EPG (só primitivas). */
export function channelEpgKey(channel: EpgChannelRef | null | undefined): string {
    if (!channel) return '';
    const id = channel.epg_channel_id ?? '';
    const name = channel.name ?? '';
    const streamId = channel.stream_id ?? '';
    if (!id && !name) return '';
    // Separador que não aparece em nome de canal (escrito como escape: byte
    // cru no fonte faria o git tratar o arquivo como binário).
    return [id, name, streamId].join('\u0000');
}

/**
 * Precisa bater na rede de novo? Só quando o guia que já está em memória
 * deixou de dizer algo sobre o AGORA — enquanto houver programa terminando
 * no futuro, o "agora/a seguir" sai do array que já temos (é o que o tick de
 * 10 s da página faz). O dado de origem tem TTL de horas: refazer a cadeia a
 * cada 60 s não traz informação nova.
 */
export function needsEpgRefetch(programs: EpgProgramWindow[], nowMs: number): boolean {
    if (programs.length === 0) return true;
    for (const program of programs) {
        const end = Date.parse(program.end);
        if (Number.isNaN(end)) continue;
        if (end > nowMs) return false;
    }
    return true;
}
