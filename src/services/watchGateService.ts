/**
 * ⏰ "Este perfil pode assistir AGORA?" — a decisão, fora de qualquer componente.
 *
 * A regra (limite diário de tela + janela de horário do perfil infantil) nasceu
 * DENTRO do `VideoPlayer`. Só que o player interno não é o único jeito de
 * assistir: o PiP abre uma janela própria com `useHls` dela mesma, o mosaico
 * monta um `<video>` por célula, o MPV toca num processo fora do DOM e o cast
 * joga direto no aparelho da sala. Nenhum desses caminhos passava por lá —
 * bastava à criança abrir o PiP, o multi-view, ligar o MPV nas Configurações
 * ou mandar pra TV para seguir assistindo depois do limite.
 *
 * Aqui a decisão vira uma função só, que TODA superfície de reprodução
 * consulta antes de tocar. Mora em `services/` (e não junto do hook) porque
 * `mpvService` e os hooks de cast também precisam dela, e serviço não importa
 * de `hooks/`.
 *
 * Não fica em `watchLimitsService` de propósito: aquele arquivo é de helpers
 * puros sobre storage; este lê o perfil ativo e as estatísticas de uso.
 */

import { profileService } from './profileService';
import { usageStatsService } from './usageStatsService';
import {
    effectiveDailyLimitMinutes,
    isLimitExceeded,
    getKidsAllowedHours,
    isHourWithinWindow,
} from './watchLimitsService';
import { diaLocal } from '../utils/diaLocal';

/**
 * True quando o perfil ativo NÃO pode assistir neste instante — por ter
 * estourado o limite diário (vale pro perfil adulto que tenha limite próprio)
 * ou por estar fora da janela de horário do perfil infantil.
 *
 * Lê storage, mas não guarda estado: dá pra chamar de qualquer lugar, inclusive
 * fora do React.
 */
export function isWatchBlockedNow(now: Date = new Date()): boolean {
    const profile = profileService.getActiveProfile();
    if (!profile) return false;

    // ⏳ Limite diário efetivo: o do perfil vence; kids sem limite próprio
    // herda o global do parental.
    const limitMinutes = effectiveDailyLimitMinutes(profile.id, !!profile.isKids);
    if (limitMinutes > 0) {
        const hoje = diaLocal(now);
        const segundosHoje = usageStatsService.getStats().dailyStats
            .find(d => d.date === hoje)?.totalSeconds || 0;
        if (isLimitExceeded(segundosHoje, limitMinutes)) return true;
    }

    // 🕗 Janela de horário do perfil kids (fora dela, mesmo bloqueio).
    if (profile.isKids) {
        const janela = getKidsAllowedHours();
        if (janela && !isHourWithinWindow(now.getHours(), janela)) return true;
    }

    return false;
}
