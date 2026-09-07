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

/**
 * O `rotulo` vira o `aria-label` do diálogo — é ele que o leitor de tela
 * anuncia ao abrir. Se a chave de i18n não existir, o `t()` devolve a CHAVE
 * CRUA (languageService.ts, com um console.warn que ninguém lê): o leitor
 * anuncia a palavra "title", e nada na tela denuncia isso.
 *
 * Foi exatamente o que aconteceu com estes dois: `changelog.title` e
 * `wrapped.title` foram usados aqui antes de existirem no dicionário.
 */
describe('os rótulos dos diálogos existem nos três idiomas', () => {
    const ROTULOS: Array<[string, string, string]> = [
        // seção, chave, arquivo que usa
        ['changelog', 'title', 'src/components/PostUpdateChangelog.tsx'],
        ['wrapped', 'title', 'src/components/WrappedOverlay.tsx'],
        ['updates', 'newVersionTitle', 'src/components/UpdateModal.tsx'],
        ['profile', 'createNewProfile', 'src/components/CreateProfileModal.tsx'],
    ];

    it.each(['pt', 'en', 'es'])('%s tem texto de verdade, não a chave crua', async (idioma) => {
        const dicionario = (await import(`../locales/ui/${idioma}.json`)).default as Record<string, Record<string, string>>;
        for (const [secao, chave, arquivo] of ROTULOS) {
            const valor = dicionario[secao]?.[chave];
            expect(valor, `${idioma}: falta ${secao}.${chave} (usada em ${arquivo})`).toBeTruthy();
            expect(valor).not.toBe(chave);
        }
    });
});
