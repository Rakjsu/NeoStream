/**
 * 💬 Por que não veio legenda?
 *
 * Toda falha do caminho do OpenSubtitles terminava na mesma frase: **"Nenhuma
 * legenda encontrada"**. Sem chave configurada, o proxy do main responde
 * `{success:false, error:'OpenSubtitles API key is not configured'}`, o
 * `getAuthToken` devolve `null`, o `searchSubtitles` faz `return []` e o motivo
 * real morre num `console.error`. O usuário conclui que o filme não tem legenda
 * e nunca descobre que existe uma tela — Configurações → APIs — esperando a
 * chave dele. A cota diária estourada (406/429 da API) cai exatamente no mesmo
 * lugar e vira a mesma mentira.
 *
 * Este módulo separa os quatro casos. A classificação é pura para poder ser
 * testada; quem lê a configuração do main é a função assíncrona ao lado.
 */

export type MotivoDeLegenda =
    /** Não há chave (ou usuário/senha) salvos: dá para resolver em Configurações → APIs. */
    | 'sem-credencial'
    /** A conta existe, mas a API recusou por limite: 406 (sem downloads) ou 429 (rate limit). */
    | 'cota'
    /** A API respondeu erro por outro motivo, ou não respondeu. */
    | 'provedor'
    /** Chegou até a busca e o título realmente não tem legenda. */
    | 'nada-encontrado'

export interface SinaisDaFalha {
    /** Há chave E usuário E senha salvos no main. */
    temCredencial: boolean
    /** Último status HTTP que a API devolveu numa falha, se houve. */
    status?: number | null
}

/**
 * Sem credencial vence tudo: é a única causa que a pessoa resolve sozinha, e é
 * a mais comum num app que não embute chave nenhuma. Depois vêm os limites da
 * conta, que o OpenSubtitles sinaliza com 406 (acabaram os downloads do dia) e
 * 429 (pedidos demais). Qualquer outro status é problema do provedor —
 * diferente de "esse filme não tem legenda", que é a ausência de falha.
 */
export function classificarFalhaDeLegenda(sinais: SinaisDaFalha): MotivoDeLegenda {
    if (!sinais.temCredencial) return 'sem-credencial'
    const status = sinais.status ?? null
    if (status === 406 || status === 429) return 'cota'
    if (status !== null && status >= 400) return 'provedor'
    return 'nada-encontrado'
}

/** Chave i18n (seção `player`) que explica o motivo para quem está assistindo. */
export function chaveDaMensagem(motivo: MotivoDeLegenda): string {
    switch (motivo) {
        case 'sem-credencial': return 'subtitleNoKey'
        case 'cota': return 'subtitleQuota'
        case 'provedor': return 'subtitleProviderDown'
        default: return 'noSubtitlesFound'
    }
}
