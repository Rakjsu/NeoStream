import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UpNextList } from './UpNextList';
import fonteLiveTV from '../pages/LiveTV.tsx?raw';

/**
 * 🖱️ "A seguir" da ficha do canal prometia um clique que não existia (D026).
 *
 * Cada programa da lista "A seguir" era um `<div>` com `cursor: pointer` e a
 * classe `epg-item` — cujo `:hover` (no `<style>` da LiveTV) desliza o card
 * 8px pro lado. Tudo dizia "clique aqui"; nenhum `onClick` existia. A pessoa
 * clicava, nada acontecia, e ficava achando que o app travou.
 *
 * O teste monta a lista de verdade e cobra a regra que a pessoa sente: o que
 * PARECE clicável (mãozinha ou o hover deslizante), em QUALQUER nível da
 * lista, tem que SER clicável — um `<button>`/`role="button"` ou algo dentro
 * de um. Hoje os itens são só informativos, então nenhum nó pode carregar
 * essas pistas. Se um dia ganharem lembrete/gravação, a pista volta junto com
 * o botão e o teste segue verde. O que a lista MOSTRA (título, horário, a
 * animação de entrada) não pode se perder no conserto.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

// Horários LOCAIS fixos: `epgService.formatTime` formata no fuso da máquina,
// então montar a data no fuso local deixa o texto esperado estável.
const PROGRAMAS = [
    { id: 'p1', title: 'Jornal da Noite', start: new Date(2026, 8, 25, 21, 30).toISOString(), hora: '21:30' },
    { id: 'p2', title: 'Futebol ao Vivo', start: new Date(2026, 8, 25, 23, 5).toISOString(), hora: '23:05' },
];

async function montar(programas: { id?: string; title: string; start: string }[] = PROGRAMAS) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<UpNextList programs={programas} heading="A seguir" />); });
}

/** O card de cada programa: o pai do nó-folha que traz o título. */
function cardDe(titulo: string): HTMLElement {
    const noTitulo = Array.from(container!.querySelectorAll('div'))
        .find(d => d.children.length === 0 && d.textContent === titulo);
    if (!noTitulo) throw new Error(`programa "${titulo}" não está na tela: ${container!.textContent}`);
    return noTitulo.parentElement as HTMLElement;
}

function pareceClicavel(el: HTMLElement): boolean {
    return el.style.cursor === 'pointer' || el.classList.contains('epg-item');
}

function eClicavel(el: HTMLElement): boolean {
    return el.closest('button, [role="button"]') !== null;
}

function descrever(el: HTMLElement): string {
    return `<${el.tagName.toLowerCase()} cursor=${el.style.cursor || '-'} class="${el.className}"> ${(el.textContent ?? '').slice(0, 30)}`;
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container?.remove();
    root = null;
    container = null;
});

describe('D026: "A seguir" da TV ao vivo não promete clique que não existe', () => {
    it('mostra o cabeçalho e, em cada card, o título e o horário do próximo programa', async () => {
        await montar();
        expect(container!.textContent?.startsWith('A seguir')).toBe(true);
        for (const p of PROGRAMAS) {
            const texto = cardDe(p.title).textContent ?? '';
            expect(texto.includes('🕐')).toBe(true);
            expect(texto.includes(p.hora)).toBe(true);
        }
    });

    it('nenhum nó da lista parece clicável sem ser clicável (sem mãozinha nem hover deslizante à toa)', async () => {
        await montar();
        const enganosos = Array.from(container!.querySelectorAll<HTMLElement>('*'))
            .filter(el => pareceClicavel(el) && !eClicavel(el))
            .map(descrever);
        expect(enganosos).toEqual([]);
    });

    it('os cards mantêm a animação de entrada (epg-program-item) escalonada', async () => {
        await montar();
        const cards = PROGRAMAS.map(p => cardDe(p.title));
        expect(cards.every(c => c.classList.contains('epg-program-item'))).toBe(true);
        expect(cards.map(c => c.style.animationDelay)).toEqual(['0s', '0.1s']);
    });

    it('lista vazia não desenha o cabeçalho sozinho', async () => {
        await montar([]);
        expect(container!.textContent).toBe('');
        expect(container!.childElementCount).toBe(0);
    });

    it('a LiveTV desenha o "A seguir" por este componente, no lugar do antigo bloco inline', () => {
        const fonte = fonteLiveTV.replace(/\r\n/g, '\n');
        const ligacao = /\{\/\* Upcoming Programs \*\/\}\n[ \t]*<UpNextList programs=\{upcomingPrograms\} heading=\{t\('liveTV', 'upNext'\)\} \/>\n[ \t]*<\/>/;
        expect(ligacao.test(fonte)).toBe(true);
        expect(fonte.includes('upcomingPrograms.map(')).toBe(false);
    });
});
