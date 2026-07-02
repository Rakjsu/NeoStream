import { describe, it, expect, beforeEach } from 'vitest';
import { searchConfigService, normalizeSearchConfig, DEFAULT_SEARCH_CONFIG } from './searchConfigService';

describe('normalizeSearchConfig', () => {
    it('usa os padrões (tudo ligado) para valores inválidos', () => {
        expect(normalizeSearchConfig(null)).toEqual(DEFAULT_SEARCH_CONFIG);
        expect(normalizeSearchConfig('x')).toEqual(DEFAULT_SEARCH_CONFIG);
        expect(normalizeSearchConfig([])).toEqual(DEFAULT_SEARCH_CONFIG);
        expect(normalizeSearchConfig({ live: 'sim', epg: 1 })).toEqual(DEFAULT_SEARCH_CONFIG);
    });

    it('aplica só os campos booleanos válidos', () => {
        expect(normalizeSearchConfig({ live: false, epg: false, extra: true }))
            .toEqual({ live: false, vod: true, series: true, epg: false });
    });
});

describe('searchConfigService', () => {
    beforeEach(() => localStorage.clear());

    it('persiste alterações parciais e faz merge no get', () => {
        expect(searchConfigService.getConfig()).toEqual(DEFAULT_SEARCH_CONFIG);

        searchConfigService.setConfig({ vod: false });
        expect(searchConfigService.getConfig()).toEqual({ live: true, vod: false, series: true, epg: true });

        searchConfigService.setConfig({ epg: false });
        expect(searchConfigService.getConfig()).toEqual({ live: true, vod: false, series: true, epg: false });
    });

    it('sobrevive a JSON corrompido no storage', () => {
        localStorage.setItem('neostream_search_config', '{corrompido');
        expect(searchConfigService.getConfig()).toEqual(DEFAULT_SEARCH_CONFIG);
    });
});
