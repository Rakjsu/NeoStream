/**
 * 🔄 Espelho de "continuar assistindo" PC ↔ celular: identidade de perfil e
 * resolução de conflito. Vive fora do WebRemoteBridge porque as MESMAS
 * decisões rodam nos dois lados do fio — o NeoStream Mobile tem uma cópia
 * idêntica de `SYNC_SKEW_TOLERANCE_MS`, `remoteSampleWins` e
 * `acceptsRemoteProfile` em `src/services/progress.ts`. Mudou aqui, muda lá:
 * regras diferentes fazem os dois espelhos divergirem para sempre.
 */
import { profileService } from './profileService';
import { movieProgressService } from './movieProgressService';
import { watchProgressService } from './watchProgressService';

/**
 * Tolerância de skew entre o relógio do PC e o do celular. Abaixo dela os dois
 * carimbos valem como "o mesmo instante"; acima, vale o mais novo.
 */
export const SYNC_SKEW_TOLERANCE_MS = 90_000;

/** Amostra de posição vinda do celular (já validada pelo protocolo). */
export interface RemoteSample {
    positionSec: number;
    durationSec: number;
    updatedAt: number;
    /** Etiqueta do perfil de ORIGEM; ausente = peer numa versão sem o campo. */
    profile?: string;
}

/**
 * Regra ÚNICA de conflito: vence o carimbo de ORIGEM mais novo (por isso o
 * `updatedAt` do push é PERSISTIDO em vez de um `Date.now()` local — sem isso,
 * com o PC adiantado, toda amostra seguinte falhava o teste e o card congelava
 * na primeira). Dentro da tolerância os relógios não são comparáveis e vence a
 * maior posição, senão dois aparelhos tocando junto ficam se puxando pra trás.
 */
export function remoteSampleWins(
    local: { position: number; updatedAt: number } | null | undefined,
    remote: { position: number; updatedAt: number }
): boolean {
    if (!local) return true;
    const delta = remote.updatedAt - local.updatedAt;
    if (delta > SYNC_SKEW_TOLERANCE_MS) return true;
    if (delta < -SYNC_SKEW_TOLERANCE_MS) return false;
    return remote.position > local.position;
}

/**
 * Etiqueta de perfil que viaja no espelho: o NOME em minúsculas, ou 'guest'.
 * Perfil kids sem nome vira 'kids' — "sem nome" é curinga do outro lado, e a
 * criança não pode entrar por essa porta.
 */
export function profileSyncTag(
    profile: { id: string; name: string; isKids?: boolean; isGuest?: boolean } | null | undefined
): string {
    if (!profile) return '';
    if (profile.isGuest || profile.id === 'guest') return 'guest';
    // Roda dentro do onTimeUpdate do player: um throw aqui derruba a
    // reprodução, então nem storage corrompido pode virar TypeError.
    const name = (profile.name ?? '').trim().toLowerCase();
    if (name) return name;
    return profile.isKids ? 'kids' : '';
}

/**
 * O push é do MESMO perfil que está ativo aqui? Sem isso o progresso vazava
 * entre perfis — inclusive do adulto pro infantil. Etiqueta vazia de um dos
 * lados (perfil sem nome, ou peer antigo) segue passando: é quem tem um perfil
 * só. Perfil infantil, não: só aceita quem se identifica com a MESMA etiqueta.
 */
export function acceptsRemoteProfile(remote: string | undefined, local: { tag: string; kids: boolean }): boolean {
    const from = (remote ?? '').trim().toLowerCase();
    const here = local.tag.trim().toLowerCase();
    if (from && from === here) return true;
    if (local.kids) return false;
    return !from || !here;
}

/** Perfil ativo deste PC, na forma que o filtro do espelho consome. */
export function localProfileGate(): { tag: string; kids: boolean } {
    const active = profileService.getActiveProfile();
    return { tag: profileSyncTag(active), kids: active?.isKids === true };
}

/** Etiqueta carimbada nas amostras que SAEM daqui. */
export function localProfileTag(): string {
    return localProfileGate().tag;
}

/** Amostra de FILME vinda do celular → progresso local (true = gravou). */
export function applyRemoteMovieProgress(movieId: string, title: string, sample: RemoteSample): boolean {
    if (!acceptsRemoteProfile(sample.profile, localProfileGate())) return false;
    const local = movieProgressService.getMoviePositionById(movieId);
    const remote = { position: sample.positionSec, updatedAt: sample.updatedAt };
    if (!remoteSampleWins(local && { position: local.currentTime, updatedAt: local.watchedAt }, remote)) return false;
    movieProgressService.saveMovieTime(movieId, title, sample.positionSec, sample.durationSec, sample.updatedAt);
    return true;
}

/** Amostra de EPISÓDIO vinda do celular (série já resolvida) → progresso local. */
export function applyRemoteEpisodeProgress(
    seriesId: string,
    season: number,
    episode: number,
    sample: RemoteSample
): boolean {
    if (!acceptsRemoteProfile(sample.profile, localProfileGate())) return false;
    const local = watchProgressService.getEpisodeProgress(seriesId, season, episode);
    const remote = { position: sample.positionSec, updatedAt: sample.updatedAt };
    if (!remoteSampleWins(local && { position: local.currentTime, updatedAt: local.watchedAt }, remote)) return false;
    watchProgressService.saveVideoTime(seriesId, season, episode, sample.positionSec, sample.durationSec, sample.updatedAt);
    return true;
}
