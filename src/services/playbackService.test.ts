import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { playbackService } from './playbackService';

/**
 * O "buffer inteligente" media LATÊNCIA ATÉ A GOOGLE e apresentava como banda:
 * baixava o logo do google.com a cada 5 min, com um tamanho chutado (10 KB, não
 * o tamanho real) e o cronômetro disparado antes do laço.
 *
 * Agora a banda vem do hls.js, que já a estima de graça enquanto reproduz. O
 * que estes testes protegem é a fronteira: o que entra como medida, o que é
 * recusado, e por quanto tempo uma medida vale.
 */
describe('playbackService: banda medida → buffer', () => {
    beforeEach(() => {
        localStorage.clear();
        playbackService.setConfig({ bufferSize: 'intelligent' });
        // Zera a medida entre os casos: o serviço é singleton.
        playbackService.reportMeasuredBandwidth(Number.NaN);
        vi.useRealTimers();
    });
    afterEach(() => vi.useRealTimers());

    it('sem medida ainda, não há buffer em cache', () => {
        expect(playbackService.getCachedBufferSeconds()).toBeNull();
    });

    it.each([
        [60, 5],   // conexão excelente: buffer mínimo
        [30, 10],
        [12, 15],
        [6, 20],
        [2, 30],   // conexão ruim: buffer máximo
    ])('%d Mbps → %ds de buffer', (mbps, esperado) => {
        playbackService.reportMeasuredBandwidth(mbps);
        expect(playbackService.getCachedBufferSeconds()).toBe(esperado);
    });

    // Valor inválido não pode virar medida: seria pior que não ter medida —
    // um NaN vindo do player derrubaria a conta do buffer inteiro.
    it.each([Number.NaN, 0, -5, Number.POSITIVE_INFINITY])('%s não vira medida', (valor) => {
        playbackService.reportMeasuredBandwidth(30);
        const antes = playbackService.getCachedBufferSeconds();
        playbackService.reportMeasuredBandwidth(valor as number);
        // Infinity é finito? Não — e 0/negativo também são recusados, então a
        // medida boa continua valendo.
        expect(playbackService.getCachedBufferSeconds()).toBe(antes);
    });

    /**
     * O TTL existia, era testável e ficava num caminho que a produção NÃO
     * percorria: o `useHls` lê pelo `getCachedBufferSeconds`, que devolvia
     * qualquer medida, de qualquer idade. Medida velha é de outra rede.
     */
    it('medida com mais de 5 minutos deixa de valer', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
        playbackService.reportMeasuredBandwidth(60);
        expect(playbackService.getCachedBufferSeconds()).toBe(5);

        vi.setSystemTime(new Date('2026-09-05T12:04:59Z'));
        expect(playbackService.getCachedBufferSeconds()).toBe(5);

        vi.setSystemTime(new Date('2026-09-05T12:05:01Z'));
        expect(playbackService.getCachedBufferSeconds()).toBeNull();
    });

    it('sem medida, o buffer cai no padrão de 15s', async () => {
        await expect(playbackService.getBufferSeconds()).resolves.toBe(15);
    });

    it('buffer fixo ignora a medida', async () => {
        playbackService.setConfig({ bufferSize: '10' });
        playbackService.reportMeasuredBandwidth(60);
        await expect(playbackService.getBufferSeconds()).resolves.toBe(10);
    });

    // "Analisando conexão…" era mentira: ninguém analisava nada até a
    // reprodução começar.
    it('a descrição não promete análise que não acontece', () => {
        playbackService.setConfig({ bufferSize: 'intelligent' });
        expect(playbackService.getBufferDescription()).not.toMatch(/analisando/i);
        playbackService.reportMeasuredBandwidth(30);
        expect(playbackService.getBufferDescription()).toContain('30.0 Mbps');
    });
});
