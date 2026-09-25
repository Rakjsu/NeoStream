/**
 * URL de reprodução de um canal da TV ao vivo que dá pra montar SEM ir à rede.
 *
 * Mora aqui (e não dentro da página) porque dois caminhos precisam da mesma
 * regra: o player (`buildLiveStreamUrl` da TV ao vivo) e a sonda "🩺 Verificar
 * favoritos" — que lê as credenciais UMA vez e monta as URLs de todos os
 * favoritos sem um `auth:get-credentials` por canal (#D175).
 */

/** Espelho da sentinela `STALKER_SENTINEL` de `electron/stalkerProtocol.ts`. */
export const SENTINELA_STALKER = 'stalker';

export interface CredenciaisDoProvedor {
    url: string;
    username: string;
    password: string;
}

export interface CanalParaUrl {
    stream_id: string | number;
    direct_source?: string;
}

/** A playlist ativa é um portal Stalker (MAC + sentinela no lugar da senha). */
export function ehPortalStalker(credenciais: CredenciaisDoProvedor): boolean {
    return credenciais.password === SENTINELA_STALKER;
}

/**
 * URL do canal quando ela sai só das credenciais + do canal. Devolve `null`
 * quando o canal é de portal Stalker com `cmd`: aí a URL só existe depois de um
 * `create_link` no portal — que não é consulta, é efeito colateral (conta no
 * limite de conexões do portal).
 *
 * - M3U (usuário-sentinela `m3u`): a URL de reprodução vem no próprio canal.
 * - Xtream (e o que sobra): a forma clássica `/live/usuário/senha/id.m3u8`,
 *   pra provedores que preenchem `direct_source` não mudarem de comportamento.
 */
export function urlDoCanalAoVivoSemPortal(
    credenciais: CredenciaisDoProvedor,
    canal: CanalParaUrl,
): string | null {
    const { url, username, password } = credenciais;
    if (username === 'm3u' && canal.direct_source?.startsWith('http')) {
        return canal.direct_source;
    }
    if (ehPortalStalker(credenciais) && canal.direct_source) {
        return null;
    }
    return `${url}/live/${username}/${password}/${canal.stream_id}.m3u8`;
}
