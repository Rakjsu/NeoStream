import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useHls } from './useHls';

/**
 * 🔒 A trava que fez o filme voltar a iniciar (#344).
 *
 * O efeito do `useHls` pula uma reinicialização que venha a menos de 500 ms da
 * anterior — a janela existe por causa do double-invoke do Strict Mode. O que
 * quebrou no #344 foi a CHAVE dessa trava: chaveada por `src`, dois `<video>`
 * distintos tocando a MESMA fonte (o player principal e o `<video>` oculto do
 * preview de miniatura) dividiam a mesma marca. Como os efeitos dos filhos
 * rodam antes do pai, o preview marcava primeiro e o player principal caía no
 * `return` — ficava sem fonte nenhuma, e o filme "não iniciava".
 *
 * A correção foi trocar a chave para o ELEMENTO (`WeakMap<HTMLVideoElement>`),
 * e até aqui nada disso tinha teste. Estes casos montam o hook de verdade em
 * `<video>` reais do jsdom: o que se observa é o que o usuário observa — o
 * elemento recebeu a fonte, ou não recebeu.
 *
 * Fonte NÃO-HLS de propósito (`.mp4`, o VOD comum): é o caminho em que a
 * inicialização é visível em `video.src`, sem precisar de hls.js de mentira.
 */

const FONTE = 'http://prov.tv/movie/u/p/42.mp4';
const OUTRA_FONTE = 'http://prov.tv/movie/u/p/99.mp4';

/** Monta o hook num `<video>` que o teste criou (e portanto consegue inspecionar). */
function Player({ src, video }: { src: string; video: HTMLVideoElement }) {
    const videoRef = useRef<HTMLVideoElement | null>(video);
    useHls({ src, videoRef, onStreamError: () => undefined });
    return null;
}

describe('useHls: a trava de inicialização é por ELEMENTO, não por fonte', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        // Relógio falso: a janela da trava é medida com Date.now(), e o efeito
        // deixa um watchdog de 10 s ligado que não deve sobrar para o próximo teste.
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        // Passa da janela de 1 s que a limpeza usa para liberar o elemento, para
        // que nenhum timer pendente atravesse para o teste seguinte.
        act(() => { vi.advanceTimersByTime(2000); });
        vi.useRealTimers();
    });

    it('dois <video> DISTINTOS na MESMA fonte inicializam os dois (#344)', () => {
        // Este é o caso que o #344 quebrou. Com a trava chaveada por `src`, o
        // segundo elemento é pulado e fica com src vazio: o filme não inicia.
        const preview = document.createElement('video');
        const principal = document.createElement('video');

        act(() => {
            root.render(
                <>
                    <Player src={FONTE} video={preview} />
                    <Player src={FONTE} video={principal} />
                </>
            );
        });

        expect(preview.src).toBe(FONTE);
        expect(principal.src).toBe(FONTE);
    });

    it('o MESMO elemento dentro da janela de 500 ms é pulado', () => {
        // A razão de a trava existir: o efeito re-roda em rajada (double-invoke)
        // e a segunda passada não pode desmontar/remontar a fonte por baixo de
        // quem já está tocando.
        const video = document.createElement('video');

        act(() => { root.render(<Player src={FONTE} video={video} />); });
        expect(video.src).toBe(FONTE);

        // 200 ms depois o efeito roda de novo (a fonte mudou) — e é ignorado.
        act(() => { vi.advanceTimersByTime(200); });
        act(() => { root.render(<Player src={OUTRA_FONTE} video={video} />); });

        expect(video.src).toBe(FONTE);
    });

    it('passada a janela, o MESMO elemento volta a inicializar', () => {
        // O outro lado da trava: ela é uma janela curta, não um bloqueio. Se
        // ficasse presa, trocar de filme no mesmo player pararia de funcionar.
        const video = document.createElement('video');

        act(() => { root.render(<Player src={FONTE} video={video} />); });
        act(() => { vi.advanceTimersByTime(600); });
        act(() => { root.render(<Player src={OUTRA_FONTE} video={video} />); });

        expect(video.src).toBe(OUTRA_FONTE);
    });

    it('a marca de um elemento não tranca o outro', () => {
        // Afirmação positiva de que a chave é o elemento: o `preview` acabou de
        // marcar, e isso não pode custar nada ao `principal` — nem na mesma
        // fonte (caso acima) nem em fonte diferente.
        const preview = document.createElement('video');
        const principal = document.createElement('video');

        act(() => { root.render(<Player src={FONTE} video={preview} />); });
        act(() => { vi.advanceTimersByTime(100); });
        act(() => {
            root.render(
                <>
                    <Player src={FONTE} video={preview} />
                    <Player src={OUTRA_FONTE} video={principal} />
                </>
            );
        });

        expect(principal.src).toBe(OUTRA_FONTE);
    });
});
