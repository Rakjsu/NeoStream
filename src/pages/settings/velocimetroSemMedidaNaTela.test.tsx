import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DiagnosticsSection } from './DiagnosticsSection';
import { languageService } from '../../services/languageService';

/**
 * 🚀 Configurações → Diagnóstico → "Velocímetro do provedor" (#D204), do lado
 * da TELA.
 *
 * Em portal Stalker e em lista M3U de arquivo não há o que medir — o main
 * sabe disso e agora diz (`speedSupported: false` + motivo; o lado dele está
 * em electron/velocimetroSemMedida.test.ts). Antes a tela oferecia o botão
 * pra todo mundo e a única saída pra `speed: null` era o "⚠️" vermelho de
 * "o provedor não respondeu com dados suficientes": um erro garantido, que
 * mandava a pessoa desconfiar de um provedor que está bom.
 *
 * Só o `window.ipcRenderer` é trocado (nada de trocar o window inteiro).
 */

type Motivo = 'stalker' | 'm3u_file' | null;
let motivo: Motivo = null;

// Mesmo contrato do handler real (electron/ipcHandlers.ts): só a pergunta
// { speedSupportOnly } e o pedido de medida numa playlist SEM medida trazem
// `speedSupported`; a medida de verdade volta só com `speed`.
const invoke = vi.fn(async (canal: string, arg?: unknown) => {
    if (canal !== 'diagnostics:provider-health') return { success: true };
    const opts = (arg ?? {}) as { speedTest?: boolean; speedSupportOnly?: boolean };
    if (opts.speedSupportOnly || (opts.speedTest && motivo)) {
        return motivo
            ? { success: true, speed: null, speedSupported: false, speedUnsupportedReason: motivo }
            : { success: true, speed: null, speedSupported: true };
    }
    if (opts.speedTest) return { success: true, results: [], speed: { mbps: 42, bytes: 8 * 1024 * 1024, seconds: 1.6 } };
    return { success: true, results: [], speed: null };
});

const d = (chave: string) => languageService.t('diagnostics', chave);

let container: HTMLDivElement;
let root: Root;

async function esperar(condicao: () => boolean, descricao: string, prazoMs = 3000): Promise<void> {
    const fim = Date.now() + prazoMs;
    while (!condicao()) {
        if (Date.now() > fim) throw new Error(`a condição nunca aconteceu: ${descricao}`);
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
}

function botaoVelocidade(): HTMLButtonElement {
    const botao = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.includes(d('speedTest'))) as HTMLButtonElement | undefined;
    expect(botao, 'o botão "Testar velocidade" sumiu').toBeDefined();
    return botao as HTMLButtonElement;
}

const texto = () => container.textContent ?? '';
const perguntas = () => invoke.mock.calls.filter(([c, a]) =>
    c === 'diagnostics:provider-health' && (a as { speedSupportOnly?: boolean } | undefined)?.speedSupportOnly === true);

async function montar(): Promise<void> {
    await act(async () => { root.render(<DiagnosticsSection />); });
    await esperar(() => perguntas().length > 0, 'a aba perguntar ao main se há o que medir');
}

beforeEach(() => {
    ; (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    ; (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
        invoke, send: vi.fn(), on: vi.fn(), off: vi.fn(),
    };
    invoke.mockClear();
    motivo = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
});

describe('velocímetro do provedor na aba de Diagnóstico (#D204)', () => {
    it('portal Stalker: botão desabilitado com a explicação, e nenhum erro vermelho', async () => {
        motivo = 'stalker';
        await montar();

        await esperar(() => botaoVelocidade().disabled, 'o botão ficar desabilitado para portal Stalker');
        expect(texto().includes(d('speedUnsupportedStalker'))).toBe(true);
        expect(texto().includes(d('speedError'))).toBe(false);
    });

    it('M3U de arquivo: botão desabilitado com a explicação de arquivo', async () => {
        motivo = 'm3u_file';
        await montar();

        await esperar(() => botaoVelocidade().disabled, 'o botão ficar desabilitado para lista de arquivo');
        expect(texto().includes(d('speedUnsupportedFile'))).toBe(true);
        expect(texto().includes(d('speedUnsupportedStalker'))).toBe(false);
        expect(texto().includes(d('speedError'))).toBe(false);
    });

    it('se a playlist ativa virou Stalker sem recarregar, o clique explica em vez de acusar o provedor (e some a medida velha)', async () => {
        await montar();
        const botao = botaoVelocidade();
        expect(botao.disabled).toBe(false);
        await act(async () => { botao.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        await esperar(() => texto().includes('42.0 Mbps') && !botaoVelocidade().disabled, 'a primeira medição aparecer');

        // A playlist ativa mudou depois de a aba abrir (a pergunta inicial disse "tem").
        motivo = 'stalker';
        await act(async () => { botaoVelocidade().dispatchEvent(new MouseEvent('click', { bubbles: true })); });

        await esperar(() => texto().includes(d('speedUnsupportedStalker')), 'a explicação do Stalker aparecer');
        expect(texto().includes(d('speedError')), 'a tela ainda pinta o erro vermelho').toBe(false);
        expect(texto().includes('42.0 Mbps'), 'a medida do provedor anterior ficou na tela').toBe(false);
        expect(botaoVelocidade().disabled).toBe(true);
    });

    it('Xtream: o botão continua e mede', async () => {
        await montar();
        const botao = botaoVelocidade();
        expect(botao.disabled).toBe(false);
        expect(texto().includes(d('speedUnsupportedStalker'))).toBe(false);
        expect(texto().includes(d('speedUnsupportedFile'))).toBe(false);

        await act(async () => { botao.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

        await esperar(() => texto().includes('42.0 Mbps'), 'o resultado da medição aparecer');
        expect(texto().includes(d('speedError'))).toBe(false);
    });
});
