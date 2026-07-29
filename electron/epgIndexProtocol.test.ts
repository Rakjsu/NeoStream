import { describe, it, expect } from 'vitest';
import { buildXmltvIndex, lookupChannel, nameKey, parseXmltvTime, stripQualityTags } from './epgIndexProtocol';

// O indice descarta o que ja morreu e o que e longe demais, entao o 'agora'
// dos testes e fixo — senao eles quebrariam com a passagem do tempo.
const AGORA = Date.parse('2026-07-28T14:00:00Z');
const XML = `<?xml version="1.0"?>
<tv>
  <channel id="globo.br">
    <display-name>Globo SP</display-name>
    <display-name>Globo São Paulo HD</display-name>
  </channel>
  <channel id="sbt.br"><display-name>SBT [FHD]</display-name></channel>
  <programme channel="globo.br" start="20260728120000 -0300" stop="20260728130000 -0300">
    <title>Jornal Hoje</title><desc>Not&#237;cias</desc><category>Jornalismo</category>
  </programme>
  <programme channel="globo.br" start="20260728100000 -0300" stop="20260728120000 -0300">
    <title>Mais Voc&#234;</title>
  </programme>
  <programme channel="sbt.br" start="20260728120000 -0300" stop="20260728133000 -0300">
    <title>Casos de Fam&#237;lia</title>
  </programme>
  <programme channel="lixo.br" start="SEM_DATA" stop="20260728133000 -0300"><title>Ignorado</title></programme>
</tv>`;

describe('buildXmltvIndex', () => {
    const index = buildXmltvIndex(XML, AGORA);

    it('indexa por canal em vez de varrer o documento por pergunta', () => {
        expect(index.byChannel.get('globo.br')).toHaveLength(2);
        expect(index.byChannel.get('sbt.br')).toHaveLength(1);
    });

    it('ordena por início — o documento não garante ordem', () => {
        const globo = index.byChannel.get('globo.br')!;
        expect(globo[0].title).toBe('Mais Você');
        expect(globo[1].title).toBe('Jornal Hoje');
    });

    it('decodifica entidades no título e na descrição', () => {
        const jornal = index.byChannel.get('globo.br')![1];
        expect(jornal.description).toBe('Notícias');
        expect(jornal.category).toBe('Jornalismo');
    });

    it('descarta programa com data inválida em vez de derrubar o índice', () => {
        expect(index.byChannel.has('lixo.br')).toBe(false);
        // Ele CONTA no total: o número serve de diagnóstico do documento.
        expect(index.total).toBe(4);
    });

    it('mapeia TODOS os display-name para o id, com o principal vencendo', () => {
        expect(index.nameToId.get(nameKey('Globo SP'))).toBe('globo.br');
        expect(index.nameToId.get(nameKey('Globo São Paulo HD'))).toBe('globo.br');
        expect(index.nameToId.get(nameKey('SBT'))).toBe('sbt.br');
    });

    it('documento vazio não explode', () => {
        const vazio = buildXmltvIndex('<tv></tv>', AGORA);
        expect(vazio.byChannel.size).toBe(0);
        expect(vazio.total).toBe(0);
    });
});

describe('lookupChannel', () => {
    const index = buildXmltvIndex(XML, AGORA);

    it('acha por id do EPG', () => {
        expect(lookupChannel(index, { epgChannelId: 'sbt.br' })).toHaveLength(1);
    });

    it('cai pro nome quando o id não bate — com tag de qualidade no caminho', () => {
        expect(lookupChannel(index, { epgChannelId: 'nao-existe', channelName: 'Globo SP [FHD]' })).toHaveLength(2);
    });

    it('id que existe vence o nome (não faz busca à toa)', () => {
        const r = lookupChannel(index, { epgChannelId: 'sbt.br', channelName: 'Globo SP' });
        expect(r[0].title).toBe('Casos de Família');
    });

    // Contrato herdado do caminho antigo: quem pede por nome recebe o NOME de
    // volta em `channel_id`, não o id interno do XMLTV.
    it('devolve o nome pedido em channel_id', () => {
        expect(lookupChannel(index, { epgChannelId: 'globo.br', channelName: 'Globo SP' })[0].channel_id).toBe('Globo SP');
        expect(lookupChannel(index, { epgChannelId: 'globo.br' })[0].channel_id).toBe('globo.br');
    });

    it('canal desconhecido devolve vazio, não o documento inteiro', () => {
        expect(lookupChannel(index, { epgChannelId: 'x', channelName: 'Canal Que Não Existe' })).toEqual([]);
    });
});

describe('parseXmltvTime', () => {
    it('respeita o fuso do XMLTV', () => {
        expect(parseXmltvTime('20260728120000', '-0300')).toBe('2026-07-28T15:00:00.000Z');
        expect(parseXmltvTime('20260728120000', '+0100')).toBe('2026-07-28T11:00:00.000Z');
    });

    // O padrao XMLTV diz que horario sem fuso e o LOCAL do emissor. Assumir
    // UTC mostraria a grade deslocada em silencio (3 h pra quem esta no Brasil),
    // e horario errado e pior que horario ausente — o parser antigo descartava.
    it('sem fuso DESCARTA, como o parser antigo', () => {
        expect(parseXmltvTime('20260728120000', '')).toBeNull();
    });

    it('fuso com minutos (+0530) e respeitado', () => {
        expect(parseXmltvTime('20260728120000', '+0530')).toBe('2026-07-28T06:30:00.000Z');
    });

    it('carimbo malformado devolve null', () => {
        expect(parseXmltvTime('SEM_DATA', '-0300')).toBeNull();
        expect(parseXmltvTime('2026072812', '-0300')).toBeNull();
    });
});

describe('stripQualityTags', () => {
    // A regra precisa casar com a do renderer: divergir aqui faz o canal
    // simplesmente não achar EPG, sem erro nenhum.
    it.each([
        ['Globo HD', 'Globo'],
        ['Globo [FHD]', 'Globo'],
        ['Globo (H265)', 'Globo'],
        ['Globo (PPV)', 'Globo'],
        ['Globo 4K', 'Globo'],
        ['Globo', 'Globo'],
    ])('%s -> %s', (entrada, saida) => {
        expect(stripQualityTags(entrada)).toBe(saida);
    });

    it('nameKey colapsa espaço e caixa', () => {
        expect(nameKey('  Globo   SP  [HD] ')).toBe('globo sp');
    });
});

// Portados do `epgService`, cujo parser foi removido: a cobertura mudou de
// lugar junto com o comportamento, em vez de sumir.
describe('comportamento herdado do parser antigo do renderer', () => {
    it('decodifica & no título e ignora programa com start inválido', () => {
        const xml = `<tv>
          <channel id="globo.br"><display-name>Globo</display-name></channel>
          <programme start="20260705200000 +0000" stop="20260705210000 +0000" channel="globo.br">
            <title>Jornal &amp; Not&#237;cias</title><desc>Edi&#231;&#227;o da noite</desc>
          </programme>
          <programme start="INVALID" stop="20260705220000 +0000" channel="globo.br"><title>Sem start</title></programme>
        </tv>`;
        const programas = lookupChannel(buildXmltvIndex(xml, Date.parse('2026-07-05T21:00:00Z')), { epgChannelId: 'globo.br', channelName: 'Globo' });
        expect(programas).toHaveLength(1);
        expect(programas[0].title).toBe('Jornal & Notícias');
        expect(programas[0].description).toBe('Edição da noite');
        expect(programas[0].start).toBe('2026-07-05T20:00:00.000Z');
        expect(programas[0].channel_id).toBe('Globo');
    });

    it('casa display-name ignorando tags de qualidade nos DOIS lados', () => {
        const xml = `<tv>
          <channel id="espn.br"><display-name>ESPN</display-name></channel>
          <channel id="globo.br"><display-name>Globo HD</display-name></channel>
          <programme start="20260705200000 +0000" stop="20260705210000 +0000" channel="espn.br"><title>Jogo</title></programme>
          <programme start="20260705200000 +0000" stop="20260705210000 +0000" channel="globo.br"><title>Novela</title></programme>
        </tv>`;
        const index = buildXmltvIndex(xml, Date.parse('2026-07-05T21:00:00Z'));
        expect(lookupChannel(index, { channelName: 'ESPN FHD' })[0].title).toBe('Jogo');
        expect(lookupChannel(index, { channelName: 'Globo' })[0].title).toBe('Novela');
        expect(lookupChannel(index, { channelName: 'Inexistente' })).toEqual([]);
    });
});

// A premissa "cada arquivo tem canais diferentes" e FALSA: medido nos arquivos
// reais, 116 de 847 canais brasileiros e 409 de 5172 americanos aparecem em
// mais de um, e ficar com o primeiro jogava fora ate 23 h de grade.
describe('uniao entre arquivos do mesmo grupo', () => {
    const AGORA = Date.parse('2026-07-28T14:00:00Z');
    const arq1 = `<tv>
      <channel id="amc.br"><display-name>AMC HD</display-name></channel>
      <programme channel="amc.br" start="20260728100000 +0000" stop="20260728110000 +0000"><title>Cedo</title></programme>
    </tv>`;
    const arq2 = `<tv>
      <channel id="amc.br"><display-name>AMC HD</display-name></channel>
      <programme channel="amc.br" start="20260728100000 +0000" stop="20260728110000 +0000"><title>Cedo</title></programme>
      <programme channel="amc.br" start="20260728200000 +0000" stop="20260728220000 +0000"><title>Filme da Noite</title></programme>
    </tv>`;

    it('acumula os dois arquivos em vez de parar no primeiro', () => {
        const index = buildXmltvIndex([arq1, arq2], AGORA);
        const programas = lookupChannel(index, { epgChannelId: 'amc.br' });
        expect(programas.map(p => p.title)).toEqual(['Cedo', 'Filme da Noite']);
    });

    it('o programa repetido entre arquivos entra UMA vez', () => {
        const index = buildXmltvIndex([arq1, arq2], AGORA);
        expect(lookupChannel(index, { epgChannelId: 'amc.br' }).filter(p => p.title === 'Cedo')).toHaveLength(1);
    });

    it('so o primeiro arquivo perderia a grade da noite', () => {
        // Prova do que o "primeiro vence" custava: o arquivo 1 sozinho nao tem
        // o filme, e era ele que respondia.
        expect(lookupChannel(buildXmltvIndex([arq1], AGORA), { epgChannelId: 'amc.br' })).toHaveLength(1);
    });
});

describe('janela de retencao', () => {
    const AGORA = Date.parse('2026-07-28T12:00:00Z');
    const xml = `<tv>
      <channel id="c1"><display-name>Canal</display-name></channel>
      <programme channel="c1" start="20260720100000 +0000" stop="20260720110000 +0000"><title>Semana passada</title></programme>
      <programme channel="c1" start="20260728110000 +0000" stop="20260728130000 +0000"><title>Agora</title></programme>
      <programme channel="c1" start="20260729100000 +0000" stop="20260729110000 +0000"><title>Amanha</title></programme>
      <programme channel="c1" start="20260810100000 +0000" stop="20260810110000 +0000"><title>Daqui a duas semanas</title></programme>
    </tv>`;

    it('descarta o que ja morreu e o que e longe demais', () => {
        const titulos = lookupChannel(buildXmltvIndex(xml, AGORA), { epgChannelId: 'c1' }).map(p => p.title);
        expect(titulos).toEqual(['Agora', 'Amanha']);
    });

    it('o total conta o documento inteiro, nao so o que ficou', () => {
        // O numero serve de diagnostico do arquivo — nao pode ser afetado pelo corte.
        expect(buildXmltvIndex(xml, AGORA).total).toBe(4);
    });
});
