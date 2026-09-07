import { describe, it, expect, beforeEach } from 'vitest';
import { ehFocavelDeVerdade, focaveisEm } from './useDialogA11y';

/**
 * A trava de foco depende inteiramente de acertar QUEM é focável. Errar para
 * mais é pior que não ter trava: um elemento que casa com o seletor mas não
 * aceita foco (o clássico `<input type="file">` escondido) engole o Tab, o foco
 * cai no `body`, e o Tab seguinte volta ao começo — os botões do fim do diálogo
 * ficam inalcançáveis.
 */
describe('ehFocavelDeVerdade', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    function monta(html: string): HTMLElement {
        document.body.innerHTML = `<div id="raiz">${html}</div>`;
        return document.getElementById('raiz') as HTMLElement;
    }

    it('botão e link comuns são focáveis', () => {
        const raiz = monta('<button id="b">ok</button><a id="a" href="#x">ir</a>');
        expect(focaveisEm(raiz).map(el => el.id)).toEqual(['b', 'a']);
    });

    it('desabilitado não entra no ciclo', () => {
        const raiz = monta('<button id="b">ok</button><button id="c" disabled>não</button>');
        expect(focaveisEm(raiz).map(el => el.id)).toEqual(['b']);
    });

    it('aria-hidden não entra no ciclo', () => {
        const raiz = monta('<button id="b">ok</button><button id="c" aria-hidden="true">não</button>');
        expect(focaveisEm(raiz).map(el => el.id)).toEqual(['b']);
    });

    it('tabindex negativo não entra no ciclo', () => {
        const raiz = monta('<button id="b">ok</button><button id="c" tabindex="-1">não</button>');
        expect(focaveisEm(raiz).map(el => el.id)).toEqual(['b']);
    });

    it('visibility:hidden não entra no ciclo', () => {
        const raiz = monta('<button id="b">ok</button><button id="c" style="visibility:hidden">não</button>');
        expect(focaveisEm(raiz).map(el => el.id)).toEqual(['b']);
    });

    // O caso concreto: o CreateProfileModal renderiza um `<input type="file">`
    // com display:none INCONDICIONALMENTE, para o botão de escolher avatar.
    it('input de arquivo escondido não entra no ciclo', () => {
        const raiz = monta(
            '<button id="b">ok</button>'
            + '<input id="arquivo" type="file" style="display:none">'
            + '<button id="c">criar</button>'
        );
        expect(focaveisEm(raiz).map(el => el.id)).toEqual(['b', 'c']);
    });

    it('a ordem é a do DOM — é ela que o Tab segue', () => {
        const raiz = monta('<button id="tres">3</button><button id="um">1</button>');
        expect(focaveisEm(raiz).map(el => el.id)).toEqual(['tres', 'um']);
    });

    it('diálogo sem nada focável devolve lista vazia', () => {
        const raiz = monta('<p>só texto</p>');
        expect(focaveisEm(raiz)).toEqual([]);
    });

    // O critério sobe a árvore de propósito: o painel do diálogo inteiro pode
    // estar escondido enquanto o componente pai ainda o renderiza.
    it('ancestral escondido esconde os filhos', () => {
        const raiz = monta('<div style="display:none"><button id="b">ok</button></div><button id="c">visível</button>');
        expect(focaveisEm(raiz).map(el => el.id)).toEqual(['c']);
    });

    it('elemento posicionado continua focável', () => {
        monta('<button id="b" style="position:fixed">ok</button>');
        expect(ehFocavelDeVerdade(document.getElementById('b') as HTMLElement)).toBe(true);
    });
});
