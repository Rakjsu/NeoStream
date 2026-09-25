import { describe, it, expect } from 'vitest';
import { epgService } from './epgService';
import fonte from './epgService.ts?raw';

/**
 * D027 — o epgService carregava ~130 linhas que ninguem chamava:
 *  - testEPGMappings: diagnostico antigo, substituido pelo epgTestService
 *    (Configuracoes -> EPG), com uma lista de canais no formato do provedor
 *    cravada no codigo;
 *  - getMappingsInfo: so existia para esse diagnostico;
 *  - getNextProgram: nenhuma tela usa (quem mostra "a seguir" e o
 *    getUpcomingPrograms).
 * O guarda impede que voltem e que o servico volte a embutir nomes de canal.
 */

/** Tira comentarios (bloco e linha) para sobrar so codigo; preserva "https://". */
function semComentarios(codigo: string): string {
    return codigo
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

describe('epgService: superficie publica sem codigo morto (D027)', () => {
    it('nao expoe mais os metodos que ninguem chama', () => {
        const svc = epgService as unknown as Record<string, unknown>;
        expect('testEPGMappings' in svc).toBe(false);
        expect('getMappingsInfo' in svc).toBe(false);
        expect('getNextProgram' in svc).toBe(false);
    });

    it('o caminho vivo continua de pe (grade atual / a seguir / progresso / Open-EPG)', () => {
        expect(typeof epgService.getCurrentProgram).toBe('function');
        expect(typeof epgService.getUpcomingPrograms).toBe('function');
        expect(typeof epgService.getProgramProgress).toBe('function');
        expect(typeof epgService.getOpenEpgPortugalId).toBe('function');
        expect(typeof epgService.getOpenEpgArgentinaId).toBe('function');
        expect(typeof epgService.getOpenEpgUSAId).toBe('function');
    });

    it('o codigo do servico nao embute nomes de canal no formato do provedor', () => {
        // Literal (aspas simples, duplas ou crase) com prefixo de pais + dois-pontos,
        // como os nomes de canal do provedor. Comentarios ficam de fora.
        const literalDeCanal = /(['"`])[A-Z]{2,3}: [^'"`\n]+\1/;
        const achado = semComentarios(fonte).match(literalDeCanal);
        expect(achado ? achado[0] : null).toBeNull();
    });
});
