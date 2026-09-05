// Região viva (ARIA live region) — o canal por onde o app FALA.
//
// O app tinha zero: nada do que aparece sozinho na tela (episódio novo,
// lembrete que disparou, download que terminou) chegava a quem usa leitor de
// tela. Um toast que só existe visualmente é, para essa pessoa, um evento que
// não aconteceu.
//
// A região vive fora do React de propósito. Montá-la num componente exigiria
// tocar no App.tsx, e — mais importante — leitor de tela só anuncia mudança de
// conteúdo numa região que JÁ ESTAVA no documento: uma região criada junto com
// o texto costuma ser engolida. Aqui ela nasce na primeira importação do
// módulo e o texto entra depois, num tick seguinte.

/** Duas regiões: 'polite' espera a fala atual terminar, 'assertive' interrompe. */
type Urgencia = 'polite' | 'assertive';

const regioes: Partial<Record<Urgencia, HTMLElement>> = {};

/** Esconde da vista sem esconder do leitor (display:none seria mudo). */
function esconderVisualmente(el: HTMLElement): void {
    el.style.position = 'absolute';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.margin = '-1px';
    el.style.padding = '0';
    el.style.overflow = 'hidden';
    el.style.border = '0';
    el.style.clip = 'rect(0 0 0 0)';
    el.style.whiteSpace = 'nowrap';
}

function regiao(urgencia: Urgencia): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    const existente = regioes[urgencia];
    if (existente && existente.isConnected) return existente;

    const el = document.createElement('div');
    el.id = `neostream-live-${urgencia}`;
    el.setAttribute('role', urgencia === 'assertive' ? 'alert' : 'status');
    el.setAttribute('aria-live', urgencia);
    // O texto é sempre curto e trocado por inteiro; ler só o que mudou faria a
    // frase chegar pela metade.
    el.setAttribute('aria-atomic', 'true');
    esconderVisualmente(el);
    document.body.appendChild(el);
    regioes[urgencia] = el;
    return el;
}

// Cria as duas regiões assim que o módulo carrega, antes de qualquer anúncio.
regiao('polite');

/**
 * Anuncia uma mensagem para quem usa leitor de tela.
 *
 * Repetir o MESMO texto não dispara leitura nenhuma (o nó não mudou), então a
 * região é limpa antes — é o que faz "download concluído" ser falado duas
 * vezes quando dois downloads terminam.
 */
export function anunciar(texto: string, urgencia: Urgencia = 'polite'): void {
    const alvo = regiao(urgencia);
    if (!alvo || !texto.trim()) return;
    alvo.textContent = '';
    // Um tick de folga: limpar e escrever no mesmo frame é uma mudança só, e
    // o leitor não vê diferença nenhuma.
    setTimeout(() => {
        if (alvo.isConnected) alvo.textContent = texto;
    }, 60);
}

/** Só para teste: devolve o que a região está falando agora. */
export function textoAnunciado(urgencia: Urgencia = 'polite'): string {
    return regioes[urgencia]?.textContent ?? '';
}
