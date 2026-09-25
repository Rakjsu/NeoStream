import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 🔎 D032 — cadastrar uma palavra-chave nas Configurações → EPG dispara a
 * varredura de EPG em segundo plano na hora.
 *
 * Antes o termo novo só valia para as linhas que alguém rolasse no Guia; sem
 * o disparo, ele esperaria o próximo ciclo (horas). A seção é montada de
 * verdade; o que se troca é só a varredura, para contar os disparos.
 */
const dispararVarreduraEpg = vi.fn(async () => ({ canais: 0, agendados: 0, alertas: 0 }));
vi.mock('../../services/epgVarreduraRegras', () => ({
    dispararVarreduraEpg: () => dispararVarreduraEpg()
}));

import { EpgSection } from './EpgSection';
import { listKeywords } from '../../services/epgKeywordAlertService';
import { languageService } from '../../services/languageService';

let container: HTMLDivElement;
let root: Root;
let ipcOriginal: unknown;

async function montar() {
    const nada = () => { /* estado do pai, fora do teste */ };
    await act(async () => {
        root.render(
            <EpgSection
                epgResultsFilter="all"
                setEpgResultsFilter={nada}
                epgCountryFilter="all"
                setEpgCountryFilter={nada}
                epgSearchTerm=""
                setEpgSearchTerm={nada}
                epgCurrentPage={1}
                setEpgCurrentPage={nada}
            />
        );
    });
}

function campoDePalavraChave(): HTMLInputElement {
    const ph = languageService.t('epg', 'keywordPh');
    const campo = container.querySelector(`input[placeholder="${ph}"]`) as HTMLInputElement | null;
    if (!campo) throw new Error('o campo de palavra-chave não está na tela');
    return campo;
}

/** Digita no campo (o React só enxerga o setter nativo + evento de input). */
async function digitar(campo: HTMLInputElement, texto: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
        setter?.call(campo, texto);
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function tecla(campo: HTMLInputElement, key: string) {
    await act(async () => {
        campo.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    dispararVarreduraEpg.mockClear();
    // A seção conta os canais da lista ao montar; só a propriedade é trocada.
    const w = window as unknown as { ipcRenderer?: unknown };
    ipcOriginal = w.ipcRenderer;
    w.ipcRenderer = { invoke: vi.fn(async () => ({ success: false })), on: vi.fn(), off: vi.fn(), send: vi.fn() };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    document.body.innerHTML = '';
    localStorage.clear();
    (window as unknown as { ipcRenderer?: unknown }).ipcRenderer = ipcOriginal;
});

describe('palavra-chave nova dispara a varredura de EPG', () => {
    it('Enter com texto grava o termo e dispara uma varredura', async () => {
        await montar();
        const campo = campoDePalavraChave();

        await digitar(campo, 'Final');
        expect(dispararVarreduraEpg).not.toHaveBeenCalled();
        await tecla(campo, 'Enter');

        expect(listKeywords()).toEqual(['Final']);
        expect(dispararVarreduraEpg).toHaveBeenCalledTimes(1);
        expect(campoDePalavraChave().value).toBe('');
    });

    it('Enter com o campo vazio não grava nem varre', async () => {
        await montar();
        const campo = campoDePalavraChave();

        await digitar(campo, '   ');
        await tecla(campo, 'Enter');

        expect(listKeywords()).toEqual([]);
        expect(dispararVarreduraEpg).not.toHaveBeenCalled();
    });

    it('outra tecla não varre', async () => {
        await montar();
        const campo = campoDePalavraChave();

        await digitar(campo, 'Final');
        await tecla(campo, 'a');

        expect(dispararVarreduraEpg).not.toHaveBeenCalled();
    });
});
