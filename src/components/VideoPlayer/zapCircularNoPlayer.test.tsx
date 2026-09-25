import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PlayerChannel } from './ChannelZapOverlay';

/**
 * 📺 #D029: PageUp/PageDown do player (o LB/RB do controle vira essas teclas)
 * CLAMPAVAM nas pontas da lista — no último canal o PgDn não fazia nada, no
 * primeiro o PgUp também não, sem retorno na tela —, enquanto o
 * "próximo"/"anterior" da bandeja e do controle do celular (LiveTV,
 * `media:control`), o mini player e o PiP davam a volta na mesma lista.
 *
 * Aqui é o `VideoPlayer` de verdade, com a tecla chegando no `document`.
 * Só o hls.js sai de cena (o jsdom não toca mídia) e a ponte do Electron é
 * pendurada no `window` do jsdom, sem trocá-lo.
 */

vi.mock('../../hooks/useHls', () => ({ useHls: () => ({ current: null }) }));

import { VideoPlayer } from './VideoPlayer';

const CANAIS: PlayerChannel[] = [
    { id: 101, name: 'Canal A', num: 1 },
    { id: 102, name: 'Canal B', num: 2 },
    { id: 103, name: 'Canal C', num: 3 },
];

let container: HTMLDivElement;
let root: Root;
let penduramosPonte = false;

function montar(contentId: string, onSwitchChannel: (id: string | number) => void, canais = CANAIS): void {
    act(() => {
        root.render(
            <VideoPlayer
                src="http://prov.tv/live/1.ts"
                title="Canal"
                contentType="live"
                contentId={contentId}
                channelList={canais}
                onSwitchChannel={onSwitchChannel}
            />
        );
    });
}

/** Dispara a tecla no `document` e devolve se o player consumiu o evento. */
function tecla(key: string): boolean {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(ev); });
    return ev.defaultPrevented;
}

function idsTrocados(trocar: ReturnType<typeof vi.fn>): string[] {
    return trocar.mock.calls.map(([id]) => String(id));
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    const w = window as unknown as { ipcRenderer?: unknown };
    penduramosPonte = !w.ipcRenderer;
    if (penduramosPonte) {
        w.ipcRenderer = {
            invoke: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            off: vi.fn(),
            send: vi.fn(),
        };
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks();
    if (penduramosPonte) delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
    localStorage.clear();
});

describe('VideoPlayer: PageUp/PageDown dão a volta na lista, como a bandeja e o celular (#D029)', () => {
    it('PgDn no ÚLTIMO canal vai para o primeiro', () => {
        const trocar = vi.fn();
        montar('103', trocar);
        expect(tecla('PageDown')).toBe(true);
        expect(idsTrocados(trocar)).toEqual(['101']);
    });

    it('PgUp no PRIMEIRO canal vai para o último', () => {
        const trocar = vi.fn();
        montar('101', trocar);
        expect(tecla('PageUp')).toBe(true);
        expect(idsTrocados(trocar)).toEqual(['103']);
    });

    it('lista de dois canais: cada ponta volta para a outra', () => {
        const doisCanais = CANAIS.slice(0, 2);
        const noSegundo = vi.fn();
        montar('102', noSegundo, doisCanais);
        tecla('PageDown');
        expect(idsTrocados(noSegundo)).toEqual(['101']);

        const noPrimeiro = vi.fn();
        montar('101', noPrimeiro, doisCanais);
        tecla('PageUp');
        expect(idsTrocados(noPrimeiro)).toEqual(['102']);
    });

    it('no meio da lista segue andando um canal para cada lado', () => {
        const trocar = vi.fn();
        montar('102', trocar);
        tecla('PageDown');
        tecla('PageUp');
        expect(idsTrocados(trocar)).toEqual(['103', '101']);
    });

    it('lista de um canal só: não "troca" para o próprio canal (não recarrega o stream)', () => {
        const trocar = vi.fn();
        montar('101', trocar, [CANAIS[0]]);
        tecla('PageDown');
        tecla('PageUp');
        expect(trocar).not.toHaveBeenCalled();
    });

    it('canal fora da lista: PgDn/PgUp não chutam nenhum canal', () => {
        const trocar = vi.fn();
        montar('999', trocar);
        tecla('PageDown');
        tecla('PageUp');
        expect(trocar).not.toHaveBeenCalled();
    });
});
