// 🔒 Gate de auditoria de PRODUÇÃO com allowlist explícita.
//
// Substitui `npm audit --omit=dev --audit-level=high` no CI. Mantém a mesma
// política — QUALQUER vulnerabilidade HIGH+ de runtime derruba o build —
// exceto advisories que comprovadamente NÃO se aplicam a este app. Cada
// exceção fica registrada aqui com o motivo; qualquer HIGH+ nova (fora da
// lista) continua falhando o CI normalmente.
import { execSync } from 'node:child_process';

/** GHSA => por que não se aplica ao NeoStream (SPA Electron). */
const ALLOWLIST = {
    // react-router: "RSC Mode CSRF Bypass". Só afeta o modo React Server
    // Components (RSC). O app é SPA Electron client-side e NÃO usa RSC. Não há
    // correção na linha 7.x; o fix é só no major v8 (breaking). Reavaliar ao
    // migrar pro react-router v8.
    'GHSA-qwww-vcr4-c8h2':
        'react-router RSC Mode CSRF — app é SPA Electron, não usa React Server Components.',
};

function runAudit() {
    try {
        return execSync('npm audit --omit=dev --json', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
        // npm audit sai com código != 0 quando encontra vulns; o JSON vem no stdout.
        if (err.stdout) return err.stdout.toString();
        throw err;
    }
}

const report = JSON.parse(runAudit());
const vulns = report.vulnerabilities || {};

const blocking = new Map(); // ghsa -> { title, package }
const allowedSeen = new Set();

for (const [pkg, info] of Object.entries(vulns)) {
    if (info.severity !== 'high' && info.severity !== 'critical') continue;
    for (const via of info.via || []) {
        // Entradas string em `via` são pacotes transitivos; o objeto da
        // advisory vem na entrada do pacote de origem, que também varremos.
        if (typeof via !== 'object' || !via.url) continue;
        if (via.severity !== 'high' && via.severity !== 'critical') continue;
        const match = /GHSA-[a-z0-9-]+/i.exec(via.url);
        if (!match) continue;
        const ghsa = match[0];
        if (ALLOWLIST[ghsa]) { allowedSeen.add(ghsa); continue; }
        blocking.set(ghsa, { title: via.title, package: via.name || pkg });
    }
}

for (const ghsa of allowedSeen) {
    console.log(`⚠️  Ignorado (allowlist): ${ghsa} — ${ALLOWLIST[ghsa]}`);
}

if (blocking.size > 0) {
    console.error('\n❌ Vulnerabilidades HIGH+ de produção fora da allowlist:');
    for (const [ghsa, v] of blocking) {
        console.error(`   • ${ghsa} (${v.package}): ${v.title}`);
    }
    console.error('\nCorrija a dependência ou, se comprovadamente não se aplica ao app,');
    console.error('adicione o GHSA à ALLOWLIST em scripts/audit-prod.mjs com o motivo.');
    process.exit(1);
}

console.log('✅ Audit de produção OK (nenhuma HIGH+ fora da allowlist).');
