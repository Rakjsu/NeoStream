// Lógica pura do gate de audit de produção (scripts/audit-prod.mjs): recebe o
// relatório do `npm audit --json` e a allowlist e devolve o que imprimir e com
// que código sair. Fica fora do script para poder ser testada com allowlists
// inventadas (electron/auditProdAllowlist.test.ts) — a do script é a real.

const SEVERIDADE_QUE_BLOQUEIA = new Set(['high', 'critical']);

/**
 * - `log`: linhas para o stdout (exceções usadas, exceções obsoletas, o OK).
 * - `erro`: linhas para o stderr (HIGH+ fora da allowlist).
 * - `codigo`: 1 só quando há HIGH+ fora da allowlist. Exceção obsoleta NUNCA
 *   muda o código (D147): o advisory sumir é um evento bom — o fix saiu — e
 *   pintar a main de vermelho por ele seria um vermelho sem commit culpado.
 */
export function avaliarGate(report, allowlist) {
    const vulns = report?.vulnerabilities;
    // Sem `vulnerabilities` o relatório é o JSON de erro do npm (registry fora):
    // não dá pra saber se uma exceção ainda casa, então nada é declarado obsoleto.
    const temRelatorio = typeof vulns === 'object' && vulns !== null;

    const bloqueantes = new Map(); // ghsa -> { title, package }
    const vistas = new Set();

    for (const [pkg, info] of Object.entries(temRelatorio ? vulns : {})) {
        if (!SEVERIDADE_QUE_BLOQUEIA.has(info?.severity)) continue;
        for (const via of info.via || []) {
            // Entradas string em `via` são pacotes transitivos; o objeto da
            // advisory vem na entrada do pacote de origem, que também varremos.
            if (typeof via !== 'object' || via === null || !via.url) continue;
            if (!SEVERIDADE_QUE_BLOQUEIA.has(via.severity)) continue;
            const match = /GHSA-[a-z0-9-]+/i.exec(via.url);
            if (!match) continue;
            const ghsa = match[0];
            if (Object.hasOwn(allowlist, ghsa)) { vistas.add(ghsa); continue; }
            bloqueantes.set(ghsa, { title: via.title, package: via.name || pkg });
        }
    }

    const log = [];
    for (const ghsa of vistas) {
        log.push(`⚠️  Ignorado (allowlist): ${ghsa} — ${allowlist[ghsa]}`);
    }
    if (!temRelatorio) {
        log.push('⚠️  O relatório do npm audit veio sem `vulnerabilities`: não dá pra conferir se a allowlist ainda vale.');
    } else {
        // Anotação do GitHub Actions: aparece no resumo do job/PR como aviso
        // amarelo; fora do Actions é só uma linha legível no terminal.
        for (const ghsa of Object.keys(allowlist)) {
            if (vistas.has(ghsa)) continue;
            log.push(`::warning title=Allowlist do audit::${ghsa} não apareceu no audit (motivo registrado: "${allowlist[ghsa]}") — exceção obsoleta, remova de scripts/audit-prod.mjs.`);
        }
    }

    if (bloqueantes.size === 0) {
        log.push('✅ Audit de produção OK (nenhuma HIGH+ fora da allowlist).');
        return { log, erro: [], codigo: 0 };
    }

    const erro = ['', '❌ Vulnerabilidades HIGH+ de produção fora da allowlist:'];
    for (const [ghsa, v] of bloqueantes) {
        erro.push(`   • ${ghsa} (${v.package}): ${v.title}`);
    }
    erro.push('');
    erro.push('Corrija a dependência ou, se comprovadamente não se aplica ao app,');
    erro.push('adicione o GHSA à ALLOWLIST em scripts/audit-prod.mjs com o motivo.');
    return { log, erro, codigo: 1 };
}
