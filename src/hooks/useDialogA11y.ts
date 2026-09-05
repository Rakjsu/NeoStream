import { useEffect, useRef } from 'react';

/**
 * Acessibilidade de diálogo: papel, trava de foco, Esc e devolução do foco.
 *
 * O app tem dez modais bloqueantes e apenas dois se declaram como diálogo
 * (`GlobalSearch` e `ShortcutsOverlay`). Nos outros oito, para quem navega por
 * teclado ou leitor de tela, o modal não existe: o Tab continua andando pela
 * página **atrás** do overlay, e o leitor lê o conteúdo de trás como se nada
 * tivesse aberto.
 *
 * Opt-in de propósito. A alternativa — envolver os dez num componente `<Modal>`
 * único — foi descartada: o `ContentDetailModal` tem 1 700 linhas, e uma
 * refatoração desse tamanho num PR de acessibilidade esconde o que importa
 * atrás do que é arriscado.
 */

/**
 * O elemento é um alvo de Tab de verdade?
 *
 * PURO, e é aqui que mora a armadilha: um `<input type="file">` com
 * `display:none` casa com o seletor de focáveis, mas `focus()` nele é no-op —
 * o foco cai no `body` e o Tab seguinte volta ao começo, deixando os botões do
 * fim do diálogo inalcançáveis.
 */
export function ehFocavelDeVerdade(el: HTMLElement): boolean {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('disabled')) return false;
    if (el.tabIndex < 0) return false;

    // Escondido no próprio elemento OU num ancestral.
    //
    // NÃO uso `offsetParent`, que é o critério do useSpatialNavigation: ele
    // depende de LAYOUT, que só existe no navegador. Num teste com jsdom todo
    // elemento tem offsetParent nulo — a função ficaria sem cobertura, e é
    // justamente esta regra que decide se a trava ajuda ou atrapalha.
    for (let atual: HTMLElement | null = el; atual; atual = atual.parentElement) {
        const estilo = getComputedStyle(atual);
        if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
    }
    return true;
}

const SELETOR_FOCAVEL = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Focáveis de verdade dentro do container, na ordem do DOM. */
export function focaveisEm(raiz: HTMLElement): HTMLElement[] {
    return Array.from(raiz.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL))
        .filter(ehFocavelDeVerdade);
}

interface OpcoesDialogo {
    /** Falso enquanto o diálogo não está na tela: nada é registrado. */
    aberto: boolean;
    /** Esc fecha. Sem isto, o Esc não é interceptado. */
    aoFechar?: () => void;
    /** Rótulo do diálogo para o leitor de tela. */
    rotulo?: string;
}

/**
 * Devolve as props para espalhar no painel do diálogo, mais o `ref` do
 * container. Enquanto `aberto`, o Tab circula dentro dele e o Esc fecha; ao
 * fechar, o foco volta para quem abriu.
 */
export function useDialogA11y({ aberto, aoFechar, rotulo }: OpcoesDialogo) {
    const containerRef = useRef<HTMLDivElement>(null);
    // A callback vive num ref pra o efeito nao se re-registrar a cada render do
    // pai. A atribuicao vai num efeito proprio: mexer em ref durante o render
    // e o que a regra react-hooks/refs proibe, com razao.
    const aoFecharRef = useRef(aoFechar);
    useEffect(() => { aoFecharRef.current = aoFechar; }, [aoFechar]);

    useEffect(() => {
        if (!aberto) return;
        const container = containerRef.current;
        if (!container) return;

        // Quem tinha o foco antes: é para cá que ele volta ao fechar. Sem isso,
        // fechar o diálogo joga o foco no body e o próximo Tab recomeça do topo
        // da página.
        const anterior = document.activeElement as HTMLElement | null;

        const primeiros = focaveisEm(container);
        (primeiros[0] ?? container).focus();

        const aoTeclar = (evento: KeyboardEvent) => {
            if (evento.key === 'Escape' && aoFecharRef.current) {
                evento.preventDefault();
                aoFecharRef.current();
                return;
            }
            if (evento.key !== 'Tab') return;

            const itens = focaveisEm(container);
            // Sem nada focável, deixar o Tab nativo em paz: engolir a tecla
            // aqui deixaria o teclado PIOR do que sem a trava.
            if (itens.length === 0) return;

            const primeiro = itens[0];
            const ultimo = itens[itens.length - 1];
            const ativo = document.activeElement;

            if (evento.shiftKey && (ativo === primeiro || !container.contains(ativo))) {
                evento.preventDefault();
                ultimo.focus();
            } else if (!evento.shiftKey && (ativo === ultimo || !container.contains(ativo))) {
                evento.preventDefault();
                primeiro.focus();
            }
        };

        document.addEventListener('keydown', aoTeclar, true);
        return () => {
            document.removeEventListener('keydown', aoTeclar, true);
            // `isConnected`: o elemento anterior pode ter sido desmontado junto.
            if (anterior?.isConnected) anterior.focus();
        };
    }, [aberto]);

    return {
        containerRef,
        /**
         * `data-overlay="modal"` não é enfeite: é a convenção que o
         * useSpatialNavigation e o useGamepadNavigation já leem para parar de
         * mover o foco pela página de trás.
         */
        dialogProps: {
            role: 'dialog' as const,
            'aria-modal': true,
            'aria-label': rotulo,
            'data-overlay': 'modal',
            tabIndex: -1,
        },
    };
}
