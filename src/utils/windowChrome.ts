/**
 * Estilos de animação da janela — em UM lugar só.
 *
 * O botão X do CustomTitleBar zerava `document.body.style.opacity` como
 * "animação de saída" e assumia que o processo ia morrer em seguida. Era
 * verdade em 12/2025; em 07/2026 entrou o modo bandeja e o X passou a só
 * ESCONDER a janela (trayMode.ts → e.preventDefault() + win.hide()). O mesmo
 * webContents voltava da bandeja com o body em opacity:0 — janela cinza, sem
 * interface, para sempre.
 *
 * O renderer não tem como saber o desfecho: quem decide entre sair, esconder
 * ou segurar (gravação em andamento) é o trayClosePolicy, no main. Por isso:
 *
 * - `close` NÃO é uma fase daqui, de propósito. Fechar não anima o body.
 * - Nenhum componente escreve em document.body.style diretamente — há um
 *   teste estrutural que cobra que este módulo seja o único dono.
 * - Todo estado de saída tem caminho de volta: ESTILO_NEUTRO. O main ainda
 *   avisa o renderer em 'show' pra restaurar, cobrindo qualquer caminho de
 *   volta da bandeja — inclusive os que alguém adicionar depois.
 */

export type FaseJanela = 'minimize' | 'maximize'

export interface EstiloJanela {
    transition: string
    opacity: string
    transform: string
}

/** Só o que o módulo escreve — o alvo real é `document.body.style`. */
export type AlvoDeEstilo = Pick<CSSStyleDeclaration, 'transition' | 'opacity' | 'transform'>

/**
 * `transition: ''` também limpa um resíduo antigo: minimizar/maximizar nunca
 * limpavam a transição, deixando uma transição global de opacity/transform
 * pendurada no body depois do primeiro uso.
 */
export const ESTILO_NEUTRO: EstiloJanela = { transition: '', opacity: '1', transform: 'none' }

export const ESTILOS_DE_SAIDA: Record<FaseJanela, EstiloJanela> = {
    minimize: {
        transition: 'opacity 0.15s ease, transform 0.15s ease',
        opacity: '0',
        transform: 'scale(0.95) translateY(20px)',
    },
    maximize: {
        transition: 'opacity 0.1s ease, transform 0.1s ease',
        opacity: '0.8',
        transform: 'scale(0.98)',
    },
}

export function aplicarEstilo(alvo: AlvoDeEstilo, estilo: EstiloJanela): void {
    alvo.transition = estilo.transition
    alvo.opacity = estilo.opacity
    alvo.transform = estilo.transform
}

export function animarSaida(alvo: AlvoDeEstilo, fase: FaseJanela): void {
    aplicarEstilo(alvo, ESTILOS_DE_SAIDA[fase])
}

/** Idempotente: pode ser chamado a qualquer momento, quantas vezes for. */
export function restaurarJanela(alvo: AlvoDeEstilo): void {
    aplicarEstilo(alvo, ESTILO_NEUTRO)
}
