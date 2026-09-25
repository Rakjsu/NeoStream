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
    /** Conferir o PIN atual para DESTRAVAR a seção nesta sessão. */
    | 'destravar'

export type DepoisDeVerificar =
    | 'desligar-parental'
    | 'definir-novo-pin'
    | 'destravar-secao'
    | 'pin-incorreto'

/**
 * Modo com que o botão "Alterar PIN" abre o modal.
 *
 * Sem PIN salvo não há o que conferir — é a primeira definição.
 */
export function modoAoTrocarPin(temPin: boolean): ModoDoPin {
    return temPin ? 'trocar' : 'set'
}

/**
 * A seção de controle parental está trancada para quem não provou o PIN?
 *
 * O interruptor "Ativar" pedia PIN para ser DESLIGADO, e só ele. Todo o resto
 * da seção gravava direto no `onChange`: limite de tela do perfil infantil,
 * janela de horário, auto-kids, limite diário por perfil, o 👁 que desfaz o
 * filtro infantil inteiro e o 🗑 que apaga o log de tentativas de PIN — que
 * existe justamente para os pais auditarem. Sem nunca saber o PIN dava para
 * abrir a janela de horário de par em par e depois varrer o rastro. E a tela
 * de Configurações está no menu de todo perfil, inclusive o infantil
 * (`Sidebar.tsx`, `menuItems`).
 *
 * O destrave é por SESSÃO e some quando o app fecha. Sem PIN salvo não há o
 * que provar: a seção fica aberta como sempre foi.
 */
export function precisaProvarPin(temPin: boolean, sessaoDestravada: boolean): boolean {
    return temPin && !sessaoDestravada
}

/**
 * Este modo mostra a tela de conferir o PIN atual?
 *
 * Escrito pelo avesso de propósito: só DEFINIR dispensa o PIN atual. Um modo
 * novo já nasce pedindo — errar para o lado de pedir demais é barato.
 */
export function pedeePinAtual(modo: ModoDoPin): boolean {
    return modo !== 'set'
}

/**
 * O que acontece quando a pessoa envia o PIN na tela de conferência.
 *
 * Errou é sempre `pin-incorreto` — inclusive no modo `trocar`, onde a tentação
 * seria deixar passar "porque ela já está nas Configurações". Acertou, o
 * destino depende do porquê de estar conferindo.
 *
 * O `switch` cobre os quatro modos e NÃO tem `default`: com um `default` que
 * caísse em "desligar-parental", um modo novo derrubaria o controle parental
 * calado. Sem ele, um modo novo quebra o typecheck aqui — que é onde a decisão
 * precisa ser tomada.
 */
export function depoisDeVerificar(modo: ModoDoPin, acertou: boolean): DepoisDeVerificar {
    if (!acertou) return 'pin-incorreto'
    switch (modo) {
        case 'trocar': return 'definir-novo-pin'
        case 'destravar': return 'destravar-secao'
        case 'verify': return 'desligar-parental'
        // 'set' não confere PIN atual, então não chega aqui pelo componente.
        case 'set': return 'desligar-parental'
    }
}
