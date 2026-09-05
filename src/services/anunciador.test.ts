import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { anunciar, textoAnunciado } from './anunciador';

// A região viva é invisível por definição — o único jeito de saber que ela
// funciona é conferir os atributos que o leitor de tela lê e o momento em que
// o texto entra. Errar qualquer um dos dois faz o anúncio ser silenciosamente
// engolido, sem nenhum sintoma na tela.
describe('anunciador', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('a região já existe antes do primeiro anúncio', () => {
        // Se ela nascesse junto com o texto, o leitor não veria mudança
        // nenhuma — região nova com conteúdo não dispara leitura.
        const regiao = document.getElementById('neostream-live-polite');
        expect(regiao).not.toBeNull();
        expect(regiao?.getAttribute('aria-live')).toBe('polite');
        expect(regiao?.getAttribute('role')).toBe('status');
        expect(regiao?.getAttribute('aria-atomic')).toBe('true');
    });

    it('a região está escondida da vista, mas não do leitor', () => {
        const regiao = document.getElementById('neostream-live-polite') as HTMLElement;
        // display:none e visibility:hidden tiram do leitor também.
        expect(regiao.style.display).not.toBe('none');
        expect(regiao.style.visibility).not.toBe('hidden');
        expect(regiao.style.width).toBe('1px');
        expect(regiao.style.overflow).toBe('hidden');
    });

    it('o texto entra num tique seguinte, não no mesmo frame', () => {
        anunciar('episódio novo de Fringe');
        expect(textoAnunciado()).toBe('');
        vi.advanceTimersByTime(100);
        expect(textoAnunciado()).toBe('episódio novo de Fringe');
    });

    // O caso que motiva a limpeza: dois downloads terminando dão a MESMA
    // frase, e um nó que não muda não é lido de novo.
    it('a mesma mensagem duas vezes é anunciada duas vezes', () => {
        anunciar('download concluído');
        vi.advanceTimersByTime(100);
        expect(textoAnunciado()).toBe('download concluído');

        anunciar('download concluído');
        expect(textoAnunciado()).toBe(''); // limpou: é isso que faz o leitor reler
        vi.advanceTimersByTime(100);
        expect(textoAnunciado()).toBe('download concluído');
    });

    it('mensagem vazia ou só espaço não mexe na região', () => {
        anunciar('algo');
        vi.advanceTimersByTime(100);
        anunciar('   ');
        vi.advanceTimersByTime(100);
        expect(textoAnunciado()).toBe('algo');
    });

    // 'assertive' interrompe a fala em curso; é para o que tem prazo — o
    // lembrete que troca o canal sozinho em 10 segundos.
    it('a região urgente é separada, com role=alert', () => {
        anunciar('trocando de canal em 10 segundos', 'assertive');
        vi.advanceTimersByTime(100);
        const urgente = document.getElementById('neostream-live-assertive');
        expect(urgente?.getAttribute('aria-live')).toBe('assertive');
        expect(urgente?.getAttribute('role')).toBe('alert');
        expect(textoAnunciado('assertive')).toBe('trocando de canal em 10 segundos');
        // A calma não foi tocada.
        expect(textoAnunciado('polite')).not.toBe('trocando de canal em 10 segundos');
    });
});
