// Tipos de scripts/audit-prod-avaliar.mjs. O .mjs roda direto no Node, sem
// transpilar; o tsc -b resolve por aqui o import do teste
// electron/auditProdAllowlist.test.ts (sem precisar ligar allowJs).

export interface SaidaDoGate {
    /** Linhas para o stdout. */
    log: string[];
    /** Linhas para o stderr. */
    erro: string[];
    /** 1 só quando há HIGH+ fora da allowlist. */
    codigo: 0 | 1;
}

export function avaliarGate(report: unknown, allowlist: Readonly<Record<string, string>>): SaidaDoGate;
