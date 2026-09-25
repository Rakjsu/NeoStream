import { describe, it, expect } from 'vitest';
import { normalizeTitle, resolveCatalogIds, sobraEhRuidoDoProvedor } from './personSearchHelpers';

/**
 * 🔗 Casador da ficha (#D169): título TMDB → id do catálogo, tolerando o nome
 * sujo do provedor sem abrir a obra errada.
 *
 * O índice aqui é montado como o real (`catalogTitleIndex`): chave =
 * normalizeTitle(nome do provedor), o primeiro id vence.
 */
function indice(linhas: [string, string][]): Map<string, string> {
    const m = new Map<string, string>();
    for (const [nome, id] of linhas) {
        const chave = normalizeTitle(nome);
        if (chave && !m.has(chave)) m.set(chave, id);
    }
    return m;
}

describe('resolveCatalogIds', () => {
    it('igualdade exata continua valendo (inclusive título curto)', () => {
        const idx = indice([['Duna', '1'], ['Up', '2']]);
        expect(resolveCatalogIds(idx, [{ title: 'Duna' }, { title: 'Up' }])).toEqual(['1', '2']);
    });

    it('casa o nome com ano, idioma e qualidade pendurados', () => {
        const idx = indice([
            ['Oppenheimer - 2023 - Dublado', '10'],
            ['Extermínio 4K', '11'],
            ['Cidade de Deus 2002 Legendado 1080p', '12'],
        ]);
        expect(resolveCatalogIds(idx, [
            { title: 'Oppenheimer' },
            { title: 'Extermínio' },
            { title: 'Cidade de Deus' },
        ])).toEqual(['10', '11', '12']);
    });

    it('sequência e subtítulo NÃO são ruído: "Toy Story" não abre "Toy Story 2"', () => {
        const idx = indice([['Toy Story 2', '1'], ['Alien Covenant', '2'], ['It Chapter Two', '3']]);
        expect(resolveCatalogIds(idx, [{ title: 'Toy Story' }, { title: 'Alien' }, { title: 'It' }]))
            .toEqual([undefined, undefined, undefined]);
    });

    it('ano no futuro distante não é ano de lançamento: "Blade Runner" não abre "Blade Runner 2049"', () => {
        const idx = indice([['Blade Runner 2049', '1']]);
        expect(resolveCatalogIds(idx, [{ title: 'Blade Runner' }])).toEqual([undefined]);
    });

    it('com a data do TMDB, a listagem de OUTRO ano não casa (remake não é a mesma obra)', () => {
        const idx = indice([['Halloween 2018 Dublado', '1'], ['Duna 1984 Dublado', '2']]);
        expect(resolveCatalogIds(idx, [
            { title: 'Halloween', release_date: '1978-10-25' },
            { title: 'Duna', release_date: '2021-09-15' },
        ])).toEqual([undefined, undefined]);
        expect(resolveCatalogIds(idx, [
            { title: 'Halloween', release_date: '2018-10-19' },
            { title: 'Duna', release_date: '1984-12-14' },
        ])).toEqual(['1', '2']);
    });

    it('estreia em outro país (ano ±1) ainda é a mesma obra', () => {
        const idx = indice([['Oppenheimer 2024 Dublado', '1']]);
        expect(resolveCatalogIds(idx, [{ title: 'Oppenheimer', release_date: '2023-07-19' }])).toEqual(['1']);
    });

    it('data vazia ou lixo do TMDB vale como ano desconhecido', () => {
        const idx = indice([['Oppenheimer 2023 Dublado', '1']]);
        expect(resolveCatalogIds(idx, [
            { title: 'Oppenheimer', release_date: '' },
            { title: 'Oppenheimer', release_date: 'sem-data' },
        ])).toEqual(['1', '1']);
    });

    it('igualdade exata vence o prefixo, mesmo vindo depois no catálogo', () => {
        const idx = indice([['Matrix 1999 Dublado 4K', '1'], ['Matrix 1999', '2'], ['Matrix', '3']]);
        expect(resolveCatalogIds(idx, [{ title: 'Matrix' }])).toEqual(['3']);
    });

    it('entre prefixos vence o nome mais curto, em qualquer ordem do catálogo', () => {
        const idx = indice([
            ['Duna 2021 Legendado', '1'],
            ['Duna 2021', '2'],
            ['Oppenheimer 2023', '3'],
            ['Oppenheimer 2023 Dublado 4K', '4'],
        ]);
        expect(resolveCatalogIds(idx, [{ title: 'Duna' }, { title: 'Oppenheimer' }])).toEqual(['2', '3']);
    });

    it('no empate de tamanho, vence o primeiro do catálogo', () => {
        const idx = indice([['Duna 2021 Dub', '1'], ['Duna 2021 Leg', '2']]);
        expect(resolveCatalogIds(idx, [{ title: 'Duna' }])).toEqual(['1']);
    });

    it('o mais curto vence mesmo vindo DEPOIS na ordem alfabética', () => {
        // "duna dublado 2021" < "duna leg" no alfabeto, mas "duna leg" é mais curto.
        const idx = indice([['Duna Dublado 2021', '1'], ['Duna Leg', '2']]);
        expect(resolveCatalogIds(idx, [{ title: 'Duna' }])).toEqual(['2']);
    });

    it('o prefixo respeita a fronteira de palavra: "Ali" não abre "Alien" ("en" seria etiqueta de idioma)', () => {
        const idx = indice([['Alien 1979', '1']]);
        expect(resolveCatalogIds(idx, [{ title: 'Ali' }])).toEqual([undefined]);
    });

    it('uma sequência antes na ordem não esconde a listagem certa que vem depois', () => {
        // "duna 2" < "duna 2021 dublado": o candidato que não serve é pulado, não encerra a busca.
        const idx = indice([['Duna 2', '5'], ['Duna 2021 Dublado', '6']]);
        expect(resolveCatalogIds(idx, [{ title: 'Duna', release_date: '2021-09-15' }])).toEqual(['6']);
    });

    it('no empate vale a ordem do CATÁLOGO, não a alfabética', () => {
        // "leg" vem depois de "dub" no alfabeto, mas está antes no catálogo.
        const idx = indice([['Duna 2021 Leg', '1'], ['Duna 2021 Dub', '2']]);
        expect(resolveCatalogIds(idx, [{ title: 'Duna' }])).toEqual(['1']);
    });

    it('índice que ganha títulos depois de consultado é relido (a ordenação não fica velha)', () => {
        const idx = indice([['Duna', '1']]);
        expect(resolveCatalogIds(idx, [{ title: 'Oppenheimer' }])).toEqual([undefined]);
        idx.set(normalizeTitle('Oppenheimer 2023 Dublado'), '9');
        expect(resolveCatalogIds(idx, [{ title: 'Oppenheimer' }])).toEqual(['9']);
    });

    it('título curto demais não casa por prefixo (falso positivo em massa)', () => {
        const idx = indice([['Up 2009 Dublado', '1']]);
        expect(resolveCatalogIds(idx, [{ title: 'Up' }])).toEqual([undefined]);
    });

    it('mantém a ordem da entrada e resolve títulos repetidos', () => {
        const idx = indice([['Oppenheimer 2023', '1'], ['Duna', '2']]);
        expect(resolveCatalogIds(idx, [
            { title: 'Nada Aqui' },
            { title: 'Oppenheimer' },
            { title: 'Duna' },
            { title: 'Oppenheimer' },
        ])).toEqual([undefined, '1', '2', '1']);
    });
});

describe('sobraEhRuidoDoProvedor', () => {
    it('sobra vazia não é ruído (isso é igualdade, não prefixo)', () => {
        expect(sobraEhRuidoDoProvedor('')).toBe(false);
    });

    it('ano ±1 do conhecido é ruído; fora disso, não', () => {
        expect(sobraEhRuidoDoProvedor('2024 dublado', 2023)).toBe(true);
        expect(sobraEhRuidoDoProvedor('2022 dublado', 2023)).toBe(true);
        expect(sobraEhRuidoDoProvedor('2020 dublado', 2023)).toBe(false);
    });

    it('todas as palavras da sobra têm de ser ruído', () => {
        expect(sobraEhRuidoDoProvedor('dublado 4k')).toBe(true);
        expect(sobraEhRuidoDoProvedor('dublado parte')).toBe(false);
    });

    it('só 19xx/20xx conta como ano: outro número de 4 dígitos é parte do título', () => {
        expect(sobraEhRuidoDoProvedor('1492')).toBe(false);
        expect(sobraEhRuidoDoProvedor('1999')).toBe(true);
    });
});
