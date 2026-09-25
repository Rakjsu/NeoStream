import { describe, it, expect } from 'vitest';
import { usageStatsService } from './usageStatsService';
import fonteDoServico from './usageStatsService.ts?raw';

/**
 * D113 — o usageStatsService carregava tres metodos publicos que nenhuma tela
 * chamava, so o proprio teste:
 *  - formatTime: homonimo de outros formatTime vivos (utils/videoHelpers,
 *    MpvPlayerView, epgService), o que fazia o leitor achar que era o mesmo;
 *  - getMostWatchedType: a tela de Estatisticas monta o breakdown sozinha;
 *  - clearStats: "for testing/debug", sem botao nem chamador.
 * O guarda nao lista nomes: todo membro publico do servico (metodo, campo com
 * funcao, getter/setter) precisa de pelo menos um uso de verdade fora dos
 * testes. Membro novo sem consumidor reprova aqui; `private` sem uso o
 * `tsc -b` (noUnusedLocals) ja reprova.
 */

/** Fontes do src/ (sem testes) como texto — `?raw` do proprio Vite. */
const fontes = import.meta.glob(
    ['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'],
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

/** O Vite pode chavear o proprio diretorio como './x.ts' ou '../services/x.ts'. */
const ehOServico = (caminho: string) => /(^|\/)usageStatsService\.ts$/.test(caminho);

/** Tira comentarios (bloco e linha) para sobrar so codigo; preserva "https://". */
function semComentarios(codigo: string): string {
    return codigo
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Membros que existem em runtime no servico, tirando os `private` do TS. */
function membrosPublicos(): string[] {
    const privados = new Set(
        [...semComentarios(fonteDoServico).matchAll(
            /^\s*private\s+(?:(?:static|readonly|async|get|set)\s+)*(\w+)/gm
        )].map(m => m[1])
    );
    const prototipo = Object.getPrototypeOf(usageStatsService) as object;
    const classe = prototipo.constructor;
    const doPrototipo = Object.getOwnPropertyNames(prototipo)
        .filter(nome => nome !== 'constructor');
    // Campo de classe com arrow function mora na instancia, nao no prototipo.
    const daInstancia = Object.getOwnPropertyNames(usageStatsService)
        .filter(nome => typeof Object.getOwnPropertyDescriptor(usageStatsService, nome)?.value === 'function');
    // A classe nao e exportada: um `static` so seria alcancavel por ela mesma.
    const estaticos = Object.getOwnPropertyNames(classe)
        .filter(nome => !['length', 'name', 'prototype'].includes(nome));
    return [...new Set([...doPrototipo, ...daInstancia, ...estaticos])]
        .filter(nome => !privados.has(nome))
        .sort();
}

/** Arquivos (fora o proprio servico e os testes) que usam `usageStatsService.<nome>` em codigo. */
function chamadoresDe(nome: string): string[] {
    const uso = new RegExp(`\\busageStatsService\\s*\\.\\s*${nome}\\b`);
    return Object.entries(fontes)
        .filter(([caminho]) => !ehOServico(caminho))
        .filter(([, fonte]) => uso.test(semComentarios(fonte)))
        .map(([caminho]) => caminho);
}

describe('usageStatsService: superficie publica sem API fantasma (D113)', () => {
    it('a varredura enxerga as fontes do src/ (sanidade do glob)', () => {
        expect(Object.keys(fontes).length).toBeGreaterThan(50);
        expect(Object.keys(fontes).filter(ehOServico)).toHaveLength(1);
        // A tela de Estatisticas e um dos chamadores reais: se sumir da
        // varredura, o guarda passaria sem olhar nada.
        expect(chamadoresDe('getWeeklyStats').some(c => c.endsWith('/pages/settings/StatsSection.tsx'))).toBe(true);
    });

    it('o caminho vivo continua de pe (sessao, leitura e semana)', () => {
        const publicos = membrosPublicos();
        for (const vivo of ['startSession', 'endSession', 'getStats', 'getWeeklyStats']) {
            expect(publicos.includes(vivo)).toBe(true);
        }
        // Os privados nao entram na conta (senao o guarda cobraria chamador deles).
        expect(publicos.includes('loadStats')).toBe(false);
    });

    it('todo membro publico tem pelo menos um uso fora dos testes', () => {
        const semChamador = membrosPublicos().filter(nome => chamadoresDe(nome).length === 0);
        expect(semChamador).toEqual([]);
    });
});
