// 🔒 Gate de auditoria de PRODUÇÃO com allowlist explícita.
//
// Substitui `npm audit --omit=dev --audit-level=high` no CI. Mantém a mesma
// política — QUALQUER vulnerabilidade HIGH+ de runtime derruba o build —
// exceto advisories que comprovadamente NÃO se aplicam a este app. Cada
// exceção fica registrada aqui com o motivo; qualquer HIGH+ nova (fora da
// lista) continua falhando o CI normalmente.
//
// Exceção que parou de aparecer no audit (advisory corrigida ou rebaixada,
// dependência removida) vira AVISO "exceção obsoleta, remova" — nunca falha o
// CI (D147). A lógica vive em audit-prod-avaliar.mjs.
//
//   node scripts/audit-prod.mjs               roda o `npm audit` e avalia
//   node scripts/audit-prod.mjs relatorio.json avalia um relatório já salvo
//                                             (`npm audit --omit=dev --json`),
//                                             sem rede — é assim que o teste
//                                             exercita o gate de ponta a ponta
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { avaliarGate } from './audit-prod-avaliar.mjs';

/** GHSA => por que não se aplica ao NeoStream (SPA Electron). */
const ALLOWLIST = {
    // react-router: GHSA-qwww-vcr4-c8h2 ("RSC Mode CSRF Bypass", só o modo
    // React Server Components, que este SPA não usa) já esteve aqui com o
    // motivo "não há correção na linha 7.x". Houve: com o lock em 7.18.4 o
    // `npm audit --omit=dev` não devolve mais nada — a exceção estava morta e
    // ninguém via, porque o gate só listava as que casavam (D147).
    //
    // js-yaml (via electron-updater, que lê o latest.yml do feed) já esteve
    // aqui por GHSA-5p4m-2wfm-xmqj, quando o fix "não tinha sido retroportado
    // pro 4.x". Foi: 4.3.1 fecha esse e 4.3.2 fecha o GHSA-2883-xcg3-v3hh que
    // apareceu depois — e como electron-updater aceita ^4.1.0, o lock passou a
    // apontar pro 4.3.2. Uma exceção com motivo falso é pior que nenhuma: se
    // o pacote regredir, o gate tem que barrar.
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

const relatorioSalvo = process.argv[2];
const report = JSON.parse(relatorioSalvo ? fs.readFileSync(relatorioSalvo, 'utf-8') : runAudit());
const { log, erro, codigo } = avaliarGate(report, ALLOWLIST);

for (const linha of log) console.log(linha);
for (const linha of erro) console.error(linha);
process.exitCode = codigo;
