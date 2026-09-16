import { describe, it, expect } from 'vitest';
import { limparMarcacaoDaLegenda, lerCuesDoVtt, lerMarcaDeTempo } from './legendaVtt';

describe('limparMarcacaoDaLegenda', () => {
    it('tira o itálico que o OpenSubtitles usa em toda fala fora de quadro', () => {
        // O que o usuário lia na tela, literalmente: "<i>Ele sussurra</i>".
        expect(limparMarcacaoDaLegenda('<i>Ele sussurra algo</i>')).toBe('Ele sussurra algo');
        expect(limparMarcacaoDaLegenda('<b>PERIGO</b>')).toBe('PERIGO');
        expect(limparMarcacaoDaLegenda('<font color="#ffff00">Amarelo</font>')).toBe('Amarelo');
        expect(limparMarcacaoDaLegenda('<c.amarelo>Ana</c>')).toBe('Ana');
        expect(limparMarcacaoDaLegenda('<v Ana>Oi</v>')).toBe('Oi');
    });

    it('tira o posicionamento do SSA/ASS que sobrevive à conversão', () => {
        expect(limparMarcacaoDaLegenda('{\\an8}No alto da tela')).toBe('No alto da tela');
        expect(limparMarcacaoDaLegenda('{\\pos(120,400)}{\\b1}Texto')).toBe('Texto');
    });

    it('NÃO come diálogo com sinal de menor ou maior', () => {
        // A regra exige letra logo depois do "<" justamente por causa disto.
        expect(limparMarcacaoDaLegenda('5 < 10 e 3 > 2')).toBe('5 < 10 e 3 > 2');
        expect(limparMarcacaoDaLegenda('x <= y')).toBe('x <= y');
    });

    it('decodifica as entidades comuns', () => {
        expect(limparMarcacaoDaLegenda('Tom &amp; Jerry')).toBe('Tom & Jerry');
        expect(limparMarcacaoDaLegenda('Ele&#39;s aqui')).toBe("Ele's aqui");
        expect(limparMarcacaoDaLegenda('a&nbsp;b')).toBe('a b');
    });

    it('entidade escapada continua sendo texto — o autor quis mostrar a tag', () => {
        expect(limparMarcacaoDaLegenda('&lt;i&gt;')).toBe('<i>');
    });

    it('linha só de marcação vira vazia (e o cue a descarta)', () => {
        expect(limparMarcacaoDaLegenda('{\\an8}')).toBe('');
        expect(limparMarcacaoDaLegenda('   ')).toBe('');
    });
});

describe('lerMarcaDeTempo', () => {
    it('lê HH:MM:SS.mmm e MM:SS.mmm', () => {
        expect(lerMarcaDeTempo('01:02:03.500')).toBeCloseTo(3723.5);
        expect(lerMarcaDeTempo('02:03.250')).toBeCloseTo(123.25);
        expect(lerMarcaDeTempo('lixo')).toBe(0);
    });
});

describe('lerCuesDoVtt', () => {
    it('lê os cues e entrega o texto já limpo', () => {
        const vtt = [
            'WEBVTT',
            '',
            '00:00:01.000 --> 00:00:03.000',
            '<i>Alguém vem aí.</i>',
            '',
            '00:00:04.000 --> 00:00:06.000',
            '{\\an8}Lá em cima',
            'segunda linha',
            '',
        ].join('\n');
        const cues = lerCuesDoVtt(vtt);
        expect(cues).toHaveLength(2);
        expect(cues[0]).toMatchObject({ startTime: 1, endTime: 3, text: 'Alguém vem aí.' });
        expect(cues[1].text).toBe('Lá em cima\nsegunda linha');
    });

    it('descarta o número do PRÓXIMO cue em arquivo sem linha em branco', () => {
        const vtt = [
            'WEBVTT',
            '',
            '00:00:01.000 --> 00:00:02.000',
            'Primeira fala',
            '2',
            '00:00:03.000 --> 00:00:04.000',
            'Segunda fala',
        ].join('\n');
        const cues = lerCuesDoVtt(vtt);
        expect(cues.map(c => c.text)).toEqual(['Primeira fala', 'Segunda fala']);
    });

    it('fala que é só um número NÃO some mais', () => {
        // O descarte antigo era "toda linha só-dígitos": uma legenda cuja fala
        // é o ano ou o telefone simplesmente não aparecia.
        const vtt = [
            'WEBVTT',
            '',
            '00:00:01.000 --> 00:00:02.000',
            '1945',
            '',
            '00:00:03.000 --> 00:00:04.000',
            '911',
            '',
        ].join('\n');
        expect(lerCuesDoVtt(vtt).map(c => c.text)).toEqual(['1945', '911']);
    });

    it('cue que só tinha marcação não vira cue vazio na tela', () => {
        const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:02.000', '{\\an8}', '', ''].join('\n');
        expect(lerCuesDoVtt(vtt)).toHaveLength(0);
    });

    it('conteúdo vazio ou sem marca de tempo não quebra', () => {
        expect(lerCuesDoVtt('')).toEqual([]);
        expect(lerCuesDoVtt('WEBVTT\n\nsó texto solto')).toEqual([]);
    });
});
