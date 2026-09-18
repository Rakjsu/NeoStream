import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RaizDoApp } from './RaizDoApp';

/**
 * 📺 As setas do Modo TV estavam mortas na PRIMEIRA tela depois do boot.
 *
 * A navegação geométrica por setas — que É o Modo TV no teclado — era montada
 * num lugar só: `useSpatialNavigation()` dentro do `Dashboard`. Só que o
 * `ProfileSelector` ("Quem está assistindo?") é devolvido pelo `App` ANTES do
 * `<HashRouter>`, e `/welcome` e `/login` são rotas IRMÃS de `/dashboard`.
 * Nas três o ouvinte simplesmente não existia: quem liga o Modo TV e dá boot
 * ficava sem setas justamente na tela de onde ainda não dá para chegar ao
 * Dashboard.
 *
 * Os casos abaixo montam a RAIZ de verdade (`RaizDoApp`, o componente que o
 * `main.tsx` renderiza) sobre um DOM no formato da tela de perfis, com o `App`
 * trocado por um vazio — o que se observa é o ouvinte que a raiz instala, não
 * o conteúdo da tela. Os dois últimos amarram a fiação nas pontas que um
 * teste montado não alcança: o `main.tsx` renderiza a raiz, e nenhuma tela
 * remonta o hook por baixo.
 */

// O `App` inteiro é pesado (IPC, router, providers) e não é o que está sob
// teste: sob teste está o ouvinte que a raiz instala POR CIMA dele.
vi.mock('./App', () => ({ default: () => null }));

const CHAVE_MODO_TV = 'neostream_tv_mode';

let container: HTMLDivElement;
let root: Root;

/** Um "perfil" da tela: botão focável com retângulo próprio (jsdom não mede). */
function perfil(id: string, left: number, top: number): HTMLButtonElement {
    const el = document.createElement('button');
    el.id = id;
    el.textContent = id;
    document.body.appendChild(el);
    // jsdom devolve `offsetParent === null` e retângulo zerado para tudo; sem
    // estes dois stubs o filtro `visibleCandidates` descartaria a tela inteira.
    Object.defineProperty(el, 'offsetParent', { value: document.body, configurable: true });
    const rect = {
        left, top, right: left + 120, bottom: top + 120,
        width: 120, height: 120, x: left, y: top, toJSON: () => ({})
    } as DOMRect;
    el.getBoundingClientRect = () => rect;
    el.scrollIntoView = () => { /* jsdom não implementa */ };
    return el;
}

function seta(key: string): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev;
}

/** Dá boot no app: é isto que o `main.tsx` faz com `createRoot(...).render()`. */
function darBoot(): void {
    act(() => { root.render(<RaizDoApp />); });
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem(CHAVE_MODO_TV, '1'); // Modo TV ligado
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    document.body.innerHTML = '';
    localStorage.removeItem(CHAVE_MODO_TV);
    vi.restoreAllMocks();
});

describe('navegação por setas na tela "Quem está assistindo?"', () => {
    it('depois do boot, com o Modo TV ligado, a seta anda entre os perfis', () => {
        const ana = perfil('ana', 100, 300);
        perfil('bia', 300, 300);
        darBoot();

        ana.focus();
        expect(document.activeElement?.id).toBe('ana');

        const ev = seta('ArrowRight');

        expect(document.activeElement?.id).toBe('bia');
        expect(ev.defaultPrevented).toBe(true);
    });

    it('o DEFEITO: sem a raiz montada, a mesma tecla não faz nada', () => {
        // Retrato do que o usuário via: a tela de perfis existe, o Modo TV está
        // ligado, e a seta não mexe o foco porque ninguém instalou o ouvinte.
        // Também garante que o ouvinte NÃO nasce de um efeito colateral de
        // import — quem o instala é a raiz, e só ela.
        const ana = perfil('ana', 100, 300);
        perfil('bia', 300, 300);

        ana.focus();
        const ev = seta('ArrowRight');

        expect(document.activeElement?.id).toBe('ana');
        expect(ev.defaultPrevented).toBe(false);
    });

    it('sem nada focado, a primeira seta já pega o perfil mais próximo do canto', () => {
        perfil('bia', 300, 300);
        perfil('ana', 100, 300);
        darBoot();

        expect(document.activeElement).toBe(document.body);

        seta('ArrowDown');

        // Semeia do canto superior esquerdo: ganha o perfil mais à esquerda.
        expect(document.activeElement?.id).toBe('ana');
    });

    it('Backspace volta — o atalho de 10 pés também vale antes do Dashboard', () => {
        perfil('ana', 100, 300);
        const voltar = vi.spyOn(window.history, 'back').mockImplementation(() => { });
        darBoot();

        const ev = seta('Backspace');

        expect(voltar).toHaveBeenCalledTimes(1);
        expect(ev.defaultPrevented).toBe(true);
    });

    it('com o Modo TV DESLIGADO a tela de perfis segue com as setas nativas', () => {
        localStorage.setItem(CHAVE_MODO_TV, '0');
        const ana = perfil('ana', 100, 300);
        perfil('bia', 300, 300);
        darBoot();

        ana.focus();
        const ev = seta('ArrowRight');

        expect(document.activeElement?.id).toBe('ana');
        expect(ev.defaultPrevented).toBe(false);
    });

    it('fechar a janela devolve as setas: desmontar a raiz tira o ouvinte', () => {
        const ana = perfil('ana', 100, 300);
        perfil('bia', 300, 300);
        darBoot();
        act(() => { root.unmount(); });
        root = createRoot(container); // o afterEach ainda desmonta algo válido

        ana.focus();
        const ev = seta('ArrowRight');

        expect(document.activeElement?.id).toBe('ana');
        expect(ev.defaultPrevented).toBe(false);
    });

    it('duas raízes montadas não fazem a seta pular DOIS perfis', () => {
        // Por que isto passa sem nenhuma trava de "já instalado": o próprio
        // ouvinte começa com `if (e.defaultPrevented) return`, então o segundo
        // se cala sozinho. Uma flag de módulo para isto seria peso morto.
        const outro = document.createElement('div');
        document.body.appendChild(outro);
        const segundaRaiz = createRoot(outro);
        const ana = perfil('ana', 100, 300);
        perfil('bia', 300, 300);
        perfil('caio', 500, 300);
        darBoot();
        act(() => { segundaRaiz.render(<RaizDoApp />); });

        ana.focus();
        seta('ArrowRight');

        expect(document.activeElement?.id).toBe('bia');
        act(() => { segundaRaiz.unmount(); });
    });
});

/**
 * As DUAS pontas da fiação. Não dá para importar o `main.tsx` num teste (ele
 * faz `createRoot(...).render(...)` na hora), então aqui a garantia é textual
 * — mas presa dos dois lados, que é o que impede o conserto de se desfazer
 * sozinho: a raiz é o que o boot renderiza, e mais ninguém monta o hook.
 */
describe('onde a navegação por setas é montada', () => {
    /** Fontes do `src/` (sem testes) como texto — `?raw` do próprio Vite. */
    const fontes = import.meta.glob(
        ['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'],
        { query: '?raw', import: 'default', eager: true }
    ) as Record<string, string>;

    /** Chamadas de verdade — `(?<!function )` tira a própria declaração. */
    const chamadasEm = (fonte: string) =>
        (fonte.match(/(?<!function )useSpatialNavigation\(\)/g) ?? []).length;

    it('o main.tsx dá boot pela raiz, e não pelo App direto', () => {
        const main = fontes['./main.tsx'];
        expect(typeof main).toBe('string');
        expect(main.includes("from './RaizDoApp'")).toBe(true);
        expect(main.includes('<RaizDoApp />')).toBe(true);
    });

    it('o Dashboard não monta mais a navegação por setas', () => {
        const dashboard = fontes['./pages/Dashboard.tsx'];
        expect(typeof dashboard).toBe('string');
        expect(dashboard.includes('useSpatialNavigation')).toBe(false);
    });

    it('em todo o src/ existe UMA única montagem — a da raiz', () => {
        const ondeMonta = Object.entries(fontes)
            .filter(([, fonte]) => chamadasEm(fonte) > 0)
            .map(([caminho]) => caminho);

        expect(ondeMonta).toEqual(['./RaizDoApp.tsx']);
    });
});
