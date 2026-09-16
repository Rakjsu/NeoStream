import { describe, it, expect } from 'vitest';
import { cargaDeFonteDireta } from './cargaDeFonteDireta';

const estado = (over: Partial<Parameters<typeof cargaDeFonteDireta>[0]> = {}) => ({
    srcAtual: 'http://prov.tv/movie/u/p/42.mp4',
    srcNovo: 'http://prov.tv/movie/u/p/42.mp4',
    tokenMudou: false,
    temErro: false,
    ...over,
});

describe('cargaDeFonteDireta', () => {
    it('fonte nova: troca o src (o carregamento vem junto)', () => {
        expect(cargaDeFonteDireta(estado({ srcNovo: 'http://prov.tv/movie/u/p/99.mp4' }))).toBe('trocar');
    });

    it('MESMA fonte com o botão "Tentar novamente": recarrega', () => {
        // O defeito que este módulo conserta: o retry só bumpa o reloadToken e,
        // sem `load()`, o elemento não faz pedido nenhum — o usuário espera os
        // 10 s do watchdog e recebe a mesma tela de erro.
        expect(cargaDeFonteDireta(estado({ tokenMudou: true }))).toBe('recarregar');
    });

    it('elemento parado num erro de mídia: recarrega mesmo sem token novo', () => {
        expect(cargaDeFonteDireta(estado({ temErro: true }))).toBe('recarregar');
    });

    it('mesma fonte, sem pedido e sem erro: NÃO mexe', () => {
        // Este é o caso que a linha original protegia: o efeito re-roda quando
        // outra dependência muda, e um load() aqui jogaria quem está assistindo
        // de volta para o começo do filme.
        expect(cargaDeFonteDireta(estado())).toBe('nada');
    });

    it('fonte nova vence o token: trocar já recarrega, load() em cima seria pedido duplicado', () => {
        expect(cargaDeFonteDireta(estado({
            srcNovo: 'http://prov.tv/movie/u/p/99.mp4',
            tokenMudou: true,
            temErro: true,
        }))).toBe('trocar');
    });

    it('a mesma URL com timeshift ligado é fonte NOVA', () => {
        // O player troca `src` por `timeshiftUrl` sem desmontar nada.
        expect(cargaDeFonteDireta(estado({
            srcNovo: 'http://prov.tv/timeshift/u/p/60/2026-09-15:10-00/42.ts',
        }))).toBe('trocar');
    });
});
