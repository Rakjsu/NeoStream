import { beforeEach, describe, expect, it } from 'vitest';
import { bootProfiler } from './bootProfiler';

describe('bootProfiler (item 20)', () => {
    beforeEach(() => {
        localStorage.clear();
        bootProfiler._reset();
    });

    it('a primeira marca de cada nome vale; repetições não sobrescrevem', () => {
        bootProfiler.mark('rendererStart');
        bootProfiler.mark('homeReady');
        const first = bootProfiler.getLast();
        expect(first?.marks.homeReady).toBeDefined();
        const original = first!.marks.homeReady;
        bootProfiler.mark('homeReady'); // repetida — ignorada, não re-persiste
        expect(bootProfiler.getLast()?.marks.homeReady).toBe(original);
    });

    it('homeReady persiste o resumo com timestamp', () => {
        bootProfiler.mark('homeReady');
        const profile = bootProfiler.getLast();
        expect(profile).not.toBeNull();
        expect(profile!.at).toBeGreaterThan(0);
        expect(typeof profile!.marks.homeReady).toBe('number');
    });

    it('sem boot completo retorna null', () => {
        expect(bootProfiler.getLast()).toBeNull();
    });

    it('ignora lixo no localStorage', () => {
        localStorage.setItem('neostream_boot_profile_v1', '{broken');
        expect(bootProfiler.getLast()).toBeNull();
    });
});
