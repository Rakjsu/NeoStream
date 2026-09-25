/**
 * Quando uma sessao DLNA acabou SOZINHA (o filme terminou na TV, alguem parou
 * pelo controle dela, ou a TV foi desligada). PURO: so relogio e estados.
 *
 * O `castSession` do main so voltava a null no `dlna:stop` e no `stop` do
 * controle pelo celular. O CastControls do renderer percebia o fim (4 polls
 * STOPPED/NO_MEDIA ou 6 falhas seguidas) e fechava a UI, mas ninguem avisava
 * o main: a sessao ficava viva pra sempre, sequestrando os comandos do
 * celular pra uma TV parada, mantendo o remux de ffmpeg e os tokens do proxy.
 *
 * As janelas sao medidas em RELOGIO, nao em numero de consultas — mesma licao
 * do AirPlay (D094): o mini-remoto do desktop e o controle do celular batem no
 * MESMO status, e contar chamadas cortaria a tolerancia pela metade quando os
 * dois estao abertos.
 *
 * O relogio de cada consulta e o INICIO dela, nao a chegada da resposta. O
 * CastControls decide a carencia no inicio de cada poll e os polls dele saem
 * a cada 2 s; a resposta e que varia — a TV entrando em standby primeiro
 * estoura o prazo de 5 s e depois recusa na hora, e as respostas chegam fora
 * de ordem. Por isso a rajada guarda o inicio MAIS ANTIGO e o MAIS NOVO que
 * viu (e nao "o primeiro que chegou"): 4 polls STOPPED do renderer abrangem
 * 6 s de inicio e 6 falhas abrangem 10 s, chegue a resposta quando chegar.
 *
 * As janelas ficam de proposito ABAIXO desses 6 s e 10 s: o renderer desmonta
 * quando desiste e para de consultar, entao o main tem que chegar a mesma
 * conclusao ate a ultima consulta dele — se ficasse acima, sobraria a sessao
 * viva de novo, agora sem ninguem perguntando. E ACIMA de 4 s e 8 s (uma
 * consulta a menos), pra nao fechar o mini-remoto antes da hora de sempre.
 */

/** STOPPED/NO_MEDIA_PRESENT continuo por este tempo = o filme acabou. */
export const DLNA_PARADA_PARA_ENCERRAR_MS = 5000
/** Nenhuma resposta da TV por este tempo = TV desligada / fora da rede. */
export const DLNA_SILENCIO_PARA_ENCERRAR_MS = 9000
/**
 * Depois do cast e de cada comando (play/pausa/seek) a TV reposiciona e pode
 * dizer STOPPED ou recusar o status por alguns segundos — o mesmo
 * COMMAND_GRACE_MS do CastControls.
 */
export const DLNA_CARENCIA_APOS_COMANDO_MS = 12000

export interface RelogioDoFimDlna {
    /** Ultimo cast/comando: abre a carencia. */
    ultimoComandoEm: number
    /** Inicio mais antigo e mais novo da rajada atual de STOPPED (0 = sem rajada). */
    paradaDe: number
    paradaAte: number
    /** Inicio mais antigo e mais novo da rajada atual de falhas de SOAP (0 = sem rajada). */
    silencioDe: number
    silencioAte: number
}

export type ObservacaoDlna =
    | { tipo: 'estado'; estado: string }
    | { tipo: 'falha' }

export type MotivoDoFimDlna = 'parada' | 'silencio'

export function novoRelogioDoFimDlna(agora: number): RelogioDoFimDlna {
    return { ultimoComandoEm: agora, paradaDe: 0, paradaAte: 0, silencioDe: 0, silencioAte: 0 }
}

/** Play/pausa/seek: reabre a carencia e zera as rajadas (markCommand do renderer). */
export function marcarComandoDlna(agora: number): RelogioDoFimDlna {
    return novoRelogioDoFimDlna(agora)
}

export function estadoDeParadaDlna(estado: string): boolean {
    return /STOPPED|NO_MEDIA/i.test(estado)
}

/** Rajada [de, ate] depois de mais uma consulta iniciada em `inicio`. */
function estenderRajada(de: number, ate: number, inicio: number): [number, number] {
    return de === 0 ? [inicio, inicio] : [Math.min(de, inicio), Math.max(ate, inicio)]
}

/**
 * Registra uma consulta de status (pelo instante em que ela COMECOU) e diz se
 * a sessao acabou. As zeragens valem sempre e na ordem de chegada, como os
 * contadores do CastControls (resposta boa zera o silencio; estado tocando
 * zera a parada); ESTENDER uma rajada so fora da carencia — igual ao
 * `!inGrace && ++...` de la.
 */
export function registrarObservacaoDlna(
    relogio: RelogioDoFimDlna,
    observacao: ObservacaoDlna,
    inicio: number,
): { relogio: RelogioDoFimDlna; encerrar: MotivoDoFimDlna | null } {
    const emCarencia = inicio - relogio.ultimoComandoEm < DLNA_CARENCIA_APOS_COMANDO_MS

    if (observacao.tipo === 'falha') {
        if (emCarencia) return { relogio, encerrar: null }
        const [silencioDe, silencioAte] = estenderRajada(relogio.silencioDe, relogio.silencioAte, inicio)
        const encerrar = silencioAte - silencioDe >= DLNA_SILENCIO_PARA_ENCERRAR_MS ? 'silencio' : null
        return { relogio: { ...relogio, silencioDe, silencioAte }, encerrar }
    }

    const semSilencio = { ...relogio, silencioDe: 0, silencioAte: 0 }
    if (!estadoDeParadaDlna(observacao.estado)) {
        return { relogio: { ...semSilencio, paradaDe: 0, paradaAte: 0 }, encerrar: null }
    }
    if (emCarencia) return { relogio: semSilencio, encerrar: null }
    const [paradaDe, paradaAte] = estenderRajada(semSilencio.paradaDe, semSilencio.paradaAte, inicio)
    const encerrar = paradaAte - paradaDe >= DLNA_PARADA_PARA_ENCERRAR_MS ? 'parada' : null
    return { relogio: { ...semSilencio, paradaDe, paradaAte }, encerrar }
}
