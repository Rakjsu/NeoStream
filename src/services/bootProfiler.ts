// ⏱️ Item 20: profiling do boot — mede do início do renderer (performance
// timeOrigin) até a Home pintar, e guarda o último boot pra exibir no Sobre.
// Zero dependências e zero custo fora do boot (cada marca grava uma vez).

const STORAGE_KEY = 'neostream_boot_profile_v1';

export interface BootProfile {
    /** Quando esse boot aconteceu (epoch ms). */
    at: number;
    /** Nome da marca → ms desde o início do renderer. */
    marks: Record<string, number>;
}

const marks: Record<string, number> = {};

export const bootProfiler = {
    /** Registra uma marca — só a PRIMEIRA ocorrência de cada nome vale. */
    mark(name: string): void {
        if (marks[name] !== undefined) return;
        marks[name] = Math.round(performance.now());
        // A Home pronta encerra o boot — persiste o resumo pro Sobre.
        if (name === 'homeReady') this.persist();
    },

    persist(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), marks: { ...marks } }));
        } catch {
            // storage indisponível — o boot segue sem métrica
        }
    },

    /** Resumo do último boot completo (null antes do primeiro). */
    getLast(): BootProfile | null {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (!parsed || typeof parsed !== 'object') return null;
            const profile = parsed as BootProfile;
            return typeof profile.at === 'number' && profile.marks ? profile : null;
        } catch {
            return null;
        }
    },

    /** Test-only. */
    _reset(): void {
        for (const key of Object.keys(marks)) delete marks[key];
    }
};
