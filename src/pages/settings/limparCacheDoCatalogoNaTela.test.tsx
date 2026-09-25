import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DiagnosticsSection } from './DiagnosticsSection';
import { languageService } from '../../services/languageService';

/**
 * 🧹 Configurações → Diagnóstico → Armazenamento → "Cache do catálogo" (#D048),
 * do lado da TELA.
 *
 * O conserto está no main (electron/cacheDoCatalogoNoArmazenamento.test.ts
 * roda os handlers de verdade). Aqui fica a outra ponta do fio: a linha do
 * catálogo só ganha o botão "Limpar" quando o main informa bytes > 0 — por
 * isso ele nunca aparecia enquanto a medição dava 0 — e o clique tem que
 * pedir a limpeza DO CATÁLOGO pelo canal certo e medir de novo, senão a
 * pessoa limpa e continua vendo o tamanho antigo.
 *
 * Só o `window.ipcRenderer` é trocado (nada de trocar o window inteiro).
 */

const MB = 1024 * 1024;

let bytesDoCatalogo = 0;
const invoke = vi.fn(async (canal: string, arg?: unknown) => {
    if (canal === 'storage:usage') {
        return {
            success: true,
            areas: [
                { area: 'downloads', bytes: 3 * MB },
                { area: 'recordings', bytes: 0 },
                { area: 'catalogCache', bytes: bytesDoCatalogo },
                { area: 'epgCache', bytes: 0 },
                { area: 'timeshift', bytes: 0 },
            ],
        };
    }
    if (canal === 'storage:clear-cache' && (arg as { area?: string })?.area === 'catalogCache') {
        bytesDoCatalogo = 44 * 1024;
    }
    return { success: true };
});

const rotulo = (chave: string) => languageService.t('storage', chave);

let container: HTMLDivElement;
let root: Root;

async function esperar(condicao: () => boolean, descricao: string, prazoMs = 3000): Promise<void> {
    const fim = Date.now() + prazoMs;
    while (!condicao()) {
        if (Date.now() > fim) throw new Error(`a condição nunca aconteceu: ${descricao}`);
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
}

/** A linha da área (o <div> que tem o rótulo, o tamanho e os botões). */
function linha(rotuloDaArea: string): HTMLElement | null {
    const span = Array.from(container.querySelectorAll('span'))
        .find(s => s.textContent === rotuloDaArea);
    return (span?.parentElement as HTMLElement | null) ?? null;
}

function botaoLimpar(rotuloDaArea: string): HTMLButtonElement | null {
    const alvo = linha(rotuloDaArea);
    if (!alvo) return null;
    return (Array.from(alvo.querySelectorAll('button'))
        .find(b => b.textContent === rotulo('clear')) as HTMLButtonElement | undefined) ?? null;
}

async function clicar(botao: HTMLElement): Promise<void> {
    await act(async () => { botao.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

async function medir(): Promise<void> {
    const botao = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.includes(rotulo('measure'))) as HTMLButtonElement | undefined;
    expect(botao, 'o botão de medir o armazenamento sumiu').toBeDefined();
    await clicar(botao as HTMLButtonElement);
    await esperar(() => linha(rotulo('catalogCache')) !== null, 'a linha do catálogo aparecer');
}

const chamadas = (canal: string) => invoke.mock.calls.filter(([c]) => c === canal);

beforeEach(async () => {
    ; (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke, send: vi.fn(), on: vi.fn(), off: vi.fn(),
    };
    invoke.mockClear();
    bytesDoCatalogo = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<DiagnosticsSection />); });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
});

describe('linha "Cache do catálogo" na tela de Armazenamento (#D048)', () => {
    it('com o catálogo medido, o Limpar aparece, pede a limpeza DO CATÁLOGO e mede de novo', async () => {
        bytesDoCatalogo = 5 * MB;
        await medir();

        expect(linha(rotulo('catalogCache'))?.textContent).toContain('5.0 MB');
        const limpar = botaoLimpar(rotulo('catalogCache'));
        expect(limpar, 'a linha do catálogo com 5 MB não oferece o Limpar').not.toBeNull();
        const medicoesAntes = chamadas('storage:usage').length;

        await clicar(limpar as HTMLButtonElement);

        await esperar(() => chamadas('storage:usage').length > medicoesAntes, 'a tela medir de novo');
        expect(chamadas('storage:clear-cache')).toEqual([['storage:clear-cache', { area: 'catalogCache' }]]);
        await esperar(
            () => linha(rotulo('catalogCache'))?.textContent?.includes('44 KB') ?? false,
            'a linha mostrar o tamanho depois da limpeza',
        );
    });

    it('sem nada no disco, a linha não oferece Limpar (e downloads nunca oferecem)', async () => {
        await medir();

        expect(botaoLimpar(rotulo('catalogCache'))).toBeNull();
        expect(linha(rotulo('downloads'))?.textContent).toContain('3.0 MB');
        expect(botaoLimpar(rotulo('downloads')), 'downloads ganharam um Limpar').toBeNull();
    });
});
