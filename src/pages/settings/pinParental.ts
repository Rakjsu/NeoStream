/**
 * 🔐 O que o modal de PIN do controle parental faz a cada abertura.
 *
 * O botão "🔑 Alterar PIN" abria o modal direto no fluxo de DEFINIÇÃO: digita
 * um PIN novo, confirma, e o `setPin` grava por cima do antigo sem nenhuma
 * verificação. Com o PIN novo na mão, a mesma pessoa desliga o interruptor
 * "Ativar" — que aí sim pede PIN — e o controle parental inteiro cai. O PIN de
 * PERFIL já fazia o certo (`ProfileManager` entra em `verify` quando o perfil
 * tem PIN e só avança depois de acertar); o do parental não.
 *
 * A decisão mora aqui, e não dentro do componente, por dois motivos: ela cabe
 * num teste, e o `pinMode` é estado PEGAJOSO — o `resetPinModal` limpa dígitos
 * e passo, mas não o modo. Quem abre o modal tem de escolher o modo sempre,
 * explicitamente, senão um `verify` de uma abertura anterior vaza para a
 * próxima.
 */

export type ModoDoPin =
    /** Definir um PIN: digitar e confirmar. */
    | 'set'
    /** Conferir o PIN atual para DESLIGAR o controle parental. */
    | 'verify'
    /** Conferir o PIN atual para poder TROCÁ-LO. */
    | 'trocar'

export type DepoisDeVerificar =
    | 'desligar-parental'
    | 'definir-novo-pin'
    | 'pin-incorreto'

/**
 * Modo com que o botão "Alterar PIN" abre o modal.
 *
 * Sem PIN salvo não há o que conferir — é a primeira definição.
 */
export function modoAoTrocarPin(temPin: boolean): ModoDoPin {
    return temPin ? 'trocar' : 'set'
}

/** Este modo mostra a tela de conferir o PIN atual? */
export function pedeePinAtual(modo: ModoDoPin): boolean {
    return modo === 'verify' || modo === 'trocar'
}

/**
 * O que acontece quando a pessoa envia o PIN na tela de conferência.
 *
 * Errou é sempre `pin-incorreto` — inclusive no modo `trocar`, onde a tentação
 * seria deixar passar "porque ela já está nas Configurações". Acertou, o
 * destino depende do porquê de estar conferindo.
 */
export function depoisDeVerificar(modo: ModoDoPin, acertou: boolean): DepoisDeVerificar {
    if (!acertou) return 'pin-incorreto'
    return modo === 'trocar' ? 'definir-novo-pin' : 'desligar-parental'
}
