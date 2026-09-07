import { describe, it, expect } from 'vitest';
import { novidadesDaRelease, pareceAutoGerada } from './releaseNotes';

/**
 * O corpo da release tem duas formas, e tratá-las igual é o defeito:
 *
 *  - escrita à mão (o caso normal deste repo): prosa em português com títulos;
 *  - auto-gerada pelo GitHub, que fica no ar entre a tag subir e o dono
 *    reescrever a release.
 *
 * As fixtures são corpos reais, não inventados.
 */

// Corpo real da v4.47.1 — escrito à mão.
const ESCRITA_A_MAO = `## 🩹 NeoStream v4.47.1 — correção do aviso de expiração

Duas correções pequenas e uma proteção contra arquivo órfão.

### "Sua lista expirou" com a lista em dia — corrigido

O aviso aparecia mesmo com a assinatura renovada.

### Fechar o app durante uma gravação não deixa mais processo órfão

---
_Atualização automática: o app avisa quando houver versão nova._`;

// Forma auto-gerada do GitHub (generate_release_notes do release.yml).
const AUTO_GERADA = `## What's Changed
* fix(home): "sua lista expirou" com lista renovada by @Rakjsu in https://github.com/Rakjsu/NeoStream/pull/375
* chore(deps): bump the minor-e-patch group with 12 updates by @dependabot[bot] in https://github.com/Rakjsu/NeoStream/pull/379
* feat(player): legenda externa do disco by @Rakjsu in https://github.com/Rakjsu/NeoStream/pull/380
* fix(ci): gerar o playwright-report no CI by @Rakjsu in https://github.com/Rakjsu/NeoStream/pull/377

## New Contributors
* @alguem made their first contribution in https://github.com/Rakjsu/NeoStream/pull/376

**Full Changelog**: https://github.com/Rakjsu/NeoStream/compare/v4.47.0...v4.47.1`;

describe('pareceAutoGerada', () => {
    it('reconhece a forma do GitHub', () => {
        expect(pareceAutoGerada(AUTO_GERADA)).toBe(true);
    });

    it('não confunde prosa escrita à mão com auto-gerada', () => {
        expect(pareceAutoGerada(ESCRITA_A_MAO)).toBe(false);
    });
});

describe('novidadesDaRelease: release escrita à mão', () => {
    const itens = novidadesDaRelease(ESCRITA_A_MAO);

    // Os títulos de seção são a parte MAIS legível do modal. Um parser que
    // descartasse toda linha `#` deixaria só parágrafos densos e órfãos.
    it('mantém os títulos de seção', () => {
        expect(itens).toContain('🩹 NeoStream v4.47.1 — correção do aviso de expiração');
        expect(itens).toContain('"Sua lista expirou" com a lista em dia — corrigido');
        expect(itens).toContain('Fechar o app durante uma gravação não deixa mais processo órfão');
    });

    it('descarta a régua e o rodapé em itálico', () => {
        expect(itens).not.toContain('---');
        expect(itens.some(i => i.startsWith('_'))).toBe(false);
        expect(itens.some(i => i.includes('Atualização automática'))).toBe(false);
    });

    // A limpeza agressiva é só para o corpo automático: aplicada aqui, comeria
    // texto bom (uma frase que comece com "Corrigido:" viraria outra coisa).
    it('não mexe na prosa', () => {
        expect(itens).toContain('Duas correções pequenas e uma proteção contra arquivo órfão.');
    });
});

describe('novidadesDaRelease: release auto-gerada', () => {
    const itens = novidadesDaRelease(AUTO_GERADA);

    it('tira o "by @fulano in <url do PR>" de cada linha', () => {
        expect(itens.some(i => i.includes('by @'))).toBe(false);
        expect(itens.some(i => i.includes('github.com'))).toBe(false);
    });

    it('tira o prefixo de conventional commit', () => {
        // Sem maiúscula forçada: a linha começa com aspas, e capitalizar
        // pulando pontuação seria mais frágil que útil.
        expect(itens).toContain('"sua lista expirou" com lista renovada');
        expect(itens).toContain('Legenda externa do disco');
    });

    it('descarta o que não é novidade para quem usa o app', () => {
        // chore(deps) e fix(ci) são a maioria da janela numa release típica.
        expect(itens.some(i => /bump the minor-e-patch/.test(i))).toBe(false);
        expect(itens.some(i => /playwright-report/.test(i))).toBe(false);
    });

    it('descarta os títulos e o rodapé do formato automático', () => {
        expect(itens.some(i => /what's changed/i.test(i))).toBe(false);
        expect(itens.some(i => /new contributors/i.test(i))).toBe(false);
        expect(itens.some(i => /full changelog/i.test(i))).toBe(false);
        expect(itens.some(i => /made their first contribution/i.test(i))).toBe(false);
    });
});

describe('novidadesDaRelease: bordas', () => {
    it('corpo vazio não vira item', () => {
        expect(novidadesDaRelease('')).toEqual([]);
        expect(novidadesDaRelease('\n\n   \n')).toEqual([]);
    });

    it('respeita o limite', () => {
        const corpo = Array.from({ length: 40 }, (_, i) => `Novidade ${i}`).join('\n');
        expect(novidadesDaRelease(corpo, 5)).toHaveLength(5);
    });

    it('rodapé do bot e links soltos não viram item', () => {
        expect(novidadesDaRelease('🤖 gerado por robô\n[algum link]: http://x\nUma novidade'))
            .toEqual(['Uma novidade']);
    });
});
