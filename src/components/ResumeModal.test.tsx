import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ResumeModal } from './ResumeModal';
import { useGamepadNavigation } from '../hooks/useGamepadNavigation';
import { languageService, type SupportedLanguage } from '../services/languageService';
import pt from '../locales/ui/pt.json';
import en from '../locales/ui/en.json';
import es from '../locales/ui/es.json';

/**
 * ⏯️ O aviso "Continuar de onde parou?" (D128).
 *
 * Aparece em quatro telas (Início, Favoritos, Séries, Ver depois) e era o
 * único aviso bloqueante do fluxo de assistir que:
 *
 *   - estava 100% em português cravado — quem usa o app em inglês ou
 *     espanhol lia "Parou em", "Restante", "Assistir do Início", "Cancelar";
 *   - ignorava o Esc — só o clique fora ou o "Cancelar" fechavam;
 *   - não se declarava como diálogo: o Tab andava pela página de trás e o
 *     leitor de tela não anunciava nada.
 *
 * E uma armadilha do conserto: virar diálogo põe `data-overlay="modal"` no
 * painel, o que troca o controle (gamepad) para o "modo overlay", onde o A
 * vira um Enter SINTÉTICO — e Enter sintético não aciona botão. Sem cuidar
 * disso, quem assiste com o controle só conseguiria FECHAR o aviso.
 *
 * O componente é montado de verdade e o que se afirma é o que a pessoa VÊ e
 * o que o teclado e o controle FAZEM, não a forma do código.
 */

type Dicionario = Record<string, Record<string, string>>;
const DICIONARIOS: Record<SupportedLanguage, Dicionario> = {
    pt: pt as Dicionario,
    en: en as Dicionario,
    es: es as Dicionario,
};

let container: HTMLDivElement;
let root: Root;

const PROPS = {
    seriesName: 'Série de Teste',
    seasonNumber: 2,
    episodeNumber: 7,
    currentTime: 754, // 12:34
    duration: 2400,
};

type Handlers = { onResume: () => void; onRestart: () => void; onCancel: () => void };

function criarHandlers() {
    return { onResume: vi.fn(), onRestart: vi.fn(), onCancel: vi.fn() };
}

function montar() {
    const handlers = criarHandlers();
    act(() => {
        root.render(<ResumeModal {...PROPS} {...handlers} />);
    });
    return handlers;
}

function dialogo(): HTMLElement {
    const el = container.querySelector<HTMLElement>('[role="dialog"]');
    if (!el) throw new Error('o aviso não se declara como diálogo (role="dialog")');
    return el;
}

function botoes(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll('button'));
}

function teclar(alvo: Element, key: string, shiftKey = false) {
    act(() => {
        alvo.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    });
}

/**
 * Espera uma CONDIÇÃO, não um número de voltas: o dicionário en/es chega por
 * `import()` dinâmico, que não assenta em microtask.
 */
async function esperarAte(cond: () => boolean, oQue: string) {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    throw new Error(`esperei demais: ${oQue}`);
}

/**
 * Troca o idioma e espera o dicionário dele chegar. A prova de chegada é uma
 * chave cujo texto DIFERE do português — "Cancelar" é igual em pt e es, e
 * enquanto o es carrega o `t()` cai no pt em silêncio.
 */
async function usarIdioma(idioma: SupportedLanguage) {
    languageService.setLanguage(idioma);
    if (idioma === 'pt') return;
    const alvo = DICIONARIOS[idioma].common;
    const prova = Object.keys(alvo).find(k => alvo[k] !== DICIONARIOS.pt.common[k]);
    if (!prova) throw new Error(`common de ${idioma} é idêntico ao pt`);
    await esperarAte(() => languageService.t('common', prova) === alvo[prova], `dicionário ${idioma} carregar`);
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    languageService.setLanguage('pt');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    languageService.setLanguage('pt');
});

describe('ResumeModal — é um diálogo de verdade', () => {
    it('se declara como diálogo modal, com o título como rótulo', () => {
        montar();
        const el = dialogo();
        expect(el.getAttribute('aria-modal')).toBe('true');
        expect(el.getAttribute('aria-label')).toBeTruthy();
        expect(el.getAttribute('aria-label')).toBe(DICIONARIOS.pt.resume?.title);
        // A convenção que a navegação espacial e a do controle leem para
        // parar de mover o foco pela página de trás.
        expect(el.getAttribute('data-overlay')).toBe('modal');
    });

    it('Esc cancela — e não vaza para a tela de trás', () => {
        // Na página Séries o aviso abre POR CIMA da ficha, que escuta Esc em
        // `window`. O mesmo Esc não pode fechar as duas.
        const telaDeTras = vi.fn();
        window.addEventListener('keydown', telaDeTras);
        try {
            const { onCancel, onResume, onRestart } = montar();
            teclar(document.activeElement ?? document.body, 'Escape');
            expect(onCancel).toHaveBeenCalledTimes(1);
            expect(onResume).not.toHaveBeenCalled();
            expect(onRestart).not.toHaveBeenCalled();
            expect(telaDeTras).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', telaDeTras);
        }
    });

    it('abre com o foco no "Continuar" e o Tab não escapa para a página de trás', () => {
        const atras = document.createElement('button');
        atras.textContent = 'botão da página';
        document.body.appendChild(atras);
        try {
            montar();
            const [continuar, , cancelar] = botoes();
            expect(document.activeElement).toBe(continuar);

            act(() => cancelar.focus());
            teclar(cancelar, 'Tab');
            expect(document.activeElement).toBe(continuar);

            teclar(continuar, 'Tab', true);
            expect(document.activeElement).toBe(cancelar);
        } finally {
            atras.remove();
        }
    });

    it('ao fechar, o foco volta para quem abriu', () => {
        const abridor = document.createElement('button');
        document.body.appendChild(abridor);
        try {
            abridor.focus();
            montar();
            expect(document.activeElement).not.toBe(abridor);
            act(() => root.render(<></>));
            expect(document.activeElement).toBe(abridor);
        } finally {
            abridor.remove();
        }
    });
});

describe('ResumeModal — fala o idioma escolhido', () => {
    it.each(['pt', 'en', 'es'] as SupportedLanguage[])('%s: todos os textos vêm do dicionário', async (idioma) => {
        await usarIdioma(idioma);
        const d = DICIONARIOS[idioma];
        const r = d.resume ?? {};
        for (const chave of ['title', 'episodeLine', 'stoppedAt', 'remaining', 'resumeFrom', 'startOver']) {
            expect(r[chave], `${idioma}: falta resume.${chave}`).toBeTruthy();
        }

        montar();
        const texto = container.textContent ?? '';

        expect(texto.includes(r.title)).toBe(true);
        expect(texto.includes(r.episodeLine.replace('{season}', '2').replace('{episode}', '7'))).toBe(true);
        expect(texto.includes(r.stoppedAt)).toBe(true);
        expect(texto.includes(r.remaining)).toBe(true);
        expect(texto.includes(r.startOver)).toBe(true);
        expect(dialogo().getAttribute('aria-label')).toBe(r.title);

        const [continuar, recomecar, cancelar] = botoes();
        expect(continuar.textContent?.includes(r.resumeFrom.replace('{time}', '12:34'))).toBe(true);
        expect(recomecar.textContent?.includes(r.startOver)).toBe(true);
        expect(cancelar.textContent?.trim()).toBe(d.common.cancel);
        // Nenhum marcador de interpolação sobra na tela.
        expect(/\{(season|episode|time)\}/.test(texto)).toBe(false);
    });

    it.each(['en', 'es'] as SupportedLanguage[])('%s: não sobra nenhum texto em português', async (idioma) => {
        await usarIdioma(idioma);
        montar();
        const texto = container.textContent ?? '';
        // Só o que DIFERE do pt pode provar alguma coisa: "Restante" e
        // "Cancelar" são iguais em espanhol.
        const cravados = ['Continuar de onde parou', 'Episódio', 'Parou em', 'Restante', 'Assistir do', 'Cancelar']
            .filter(s => idioma === 'en' || (s !== 'Restante' && s !== 'Cancelar'));
        for (const cravado of cravados) {
            expect(texto.includes(cravado), `${idioma}: sobrou "${cravado}"`).toBe(false);
        }
    });
});

describe('ResumeModal — os botões continuam fazendo o que faziam', () => {
    it('Continuar, Recomeçar e Cancelar chamam cada um o seu', () => {
        const { onResume, onRestart, onCancel } = montar();
        const [continuar, recomecar, cancelar] = botoes();
        act(() => continuar.click());
        act(() => recomecar.click());
        act(() => cancelar.click());
        expect(onResume).toHaveBeenCalledTimes(1);
        expect(onRestart).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

/**
 * 🎮 Com o controle na mão — o modo sofá, que é justamente onde esse aviso
 * mais aparece.
 *
 * O `useGamepadNavigation` de verdade é montado; só o hardware é falso: o
 * `navigator.getGamepads()` devolve um pad cujos botões o teste aperta, e o
 * `requestAnimationFrame` guarda o quadro para o teste rodar na mão.
 */
describe('ResumeModal — com o controle', () => {
    const A = 0;
    const B = 1;
    const BAIXO = 13;

    let pad: { connected: boolean; buttons: { pressed: boolean }[]; axes: number[] };
    let quadro: FrameRequestCallback | null;
    let agora: number;
    let scrollOriginal: PropertyDescriptor | undefined;

    beforeEach(() => {
        pad = { connected: true, buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0, 0] };
        quadro = null;
        agora = 1000;
        Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
        vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { quadro = cb; return 1; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        // O jsdom não tem scrollIntoView, e o foco do controle rola até o alvo.
        scrollOriginal = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
        Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {}, configurable: true, writable: true });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        if (scrollOriginal) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollOriginal);
        else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    /** O jsdom não tem layout: cada botão ganha a caixa que teria na tela. */
    function posicionar(el: HTMLElement, top: number) {
        const caixa = { left: 100, right: 300, top, bottom: top + 40, width: 200, height: 40, x: 100, y: top };
        Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ ...caixa, toJSON: () => caixa }), configurable: true });
    }

    /** Aperta e solta um botão do pad, um quadro para cada lado. */
    function apertar(botao: number) {
        if (!quadro) throw new Error('o laço do controle não acendeu');
        pad.buttons[botao].pressed = true;
        agora += 100;
        act(() => quadro!(agora));
        pad.buttons[botao].pressed = false;
        agora += 100;
        act(() => quadro!(agora));
    }

    function ComControle(handlers: Handlers) {
        useGamepadNavigation();
        return <ResumeModal {...PROPS} {...handlers} />;
    }

    function montarComControle() {
        const handlers = criarHandlers();
        act(() => { root.render(<ComControle {...handlers} />); });
        const [continuar, recomecar, cancelar] = botoes();
        posicionar(continuar, 300);
        posicionar(recomecar, 360);
        posicionar(cancelar, 420);
        return handlers;
    }

    it('A no "Continuar" retoma o episódio', () => {
        const { onResume, onRestart, onCancel } = montarComControle();
        expect(document.activeElement).toBe(botoes()[0]);
        apertar(A);
        expect(onResume).toHaveBeenCalledTimes(1);
        expect(onRestart).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('o direcional anda entre os botões do aviso — não foge para a página de trás', () => {
        // Um botão da página logo abaixo do "Continuar", MAIS PERTO que o
        // "Assistir do início": um direcional solto pela página inteira
        // pularia para ele.
        const atras = document.createElement('button');
        atras.textContent = 'botão da página';
        document.body.appendChild(atras);
        posicionar(atras, 330);
        try {
            const { onResume, onRestart } = montarComControle();
            const [, recomecar] = botoes();
            apertar(BAIXO);
            expect(document.activeElement).toBe(recomecar);
            apertar(A);
            expect(onRestart).toHaveBeenCalledTimes(1);
            expect(onResume).not.toHaveBeenCalled();
        } finally {
            atras.remove();
        }
    });

    it('fora de um diálogo de verdade (a ficha: overlay sem papel de diálogo), o A continua virando Enter', () => {
        // A ficha de Séries é `data-overlay="modal"` sem role="dialog" e toca
        // o episódio escolhido pelo Enter que ouve em `window`. O conserto do
        // diálogo não pode mudar o que o A faz lá.
        function SoControle() {
            useGamepadNavigation();
            return null;
        }
        const ficha = document.createElement('div');
        ficha.setAttribute('data-overlay', 'modal');
        const botaoDaFicha = document.createElement('button');
        const clicou = vi.fn();
        botaoDaFicha.addEventListener('click', clicou);
        ficha.appendChild(botaoDaFicha);
        document.body.appendChild(ficha);
        const enter = vi.fn();
        const ouvir = (e: KeyboardEvent) => { if (e.key === 'Enter') enter(); };
        window.addEventListener('keydown', ouvir);
        try {
            act(() => { root.render(<SoControle />); });
            act(() => botaoDaFicha.focus());
            apertar(A);
            expect(enter).toHaveBeenCalled();
            expect(clicou).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', ouvir);
            ficha.remove();
        }
    });

    it('B cancela — e não vaza para a tela de trás', () => {
        const telaDeTras = vi.fn((e: KeyboardEvent) => e.key);
        window.addEventListener('keydown', telaDeTras);
        try {
            const { onCancel, onResume, onRestart } = montarComControle();
            apertar(B);
            expect(onCancel).toHaveBeenCalledTimes(1);
            expect(onResume).not.toHaveBeenCalled();
            expect(onRestart).not.toHaveBeenCalled();
            expect(telaDeTras).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', telaDeTras);
        }
    });
});
