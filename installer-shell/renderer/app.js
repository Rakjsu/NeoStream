// NeoStream IPTV — Installer Shell (renderer)
// Plain DOM, no framework. Steps: welcome → installing → done | error.
'use strict';

const $ = (id) => document.getElementById(id);

const steps = {
    welcome: $('step-welcome'),
    installing: $('step-installing'),
    done: $('step-done'),
    error: $('step-error'),
};

const STATUS_MESSAGES = [
    'Copiando arquivos…',
    'Criando atalhos…',
    'Registrando desinstalador…',
    'Configurando atualizações automáticas…',
    'Quase lá…',
];

let installDir = '';
let statusTimer = null;
let installFinished = false;

function showStep(name) {
    for (const el of Object.values(steps)) el.classList.remove('active');
    steps[name].classList.add('active');
}

function setDirPath(dir) {
    installDir = dir;
    const el = $('dir-path');
    el.textContent = dir;
    el.title = dir;
}

function startStatusRotation() {
    let i = 0;
    const statusEl = $('install-status');
    statusEl.textContent = STATUS_MESSAGES[0];
    statusTimer = setInterval(() => {
        i = Math.min(i + 1, STATUS_MESSAGES.length - 1);
        statusEl.style.opacity = '0';
        setTimeout(() => {
            statusEl.textContent = STATUS_MESSAGES[i];
            statusEl.style.opacity = '1';
        }, 280);
    }, 2600);
}

function stopStatusRotation() {
    if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
    }
}

async function startInstall() {
    installFinished = false;
    showStep('installing');
    startStatusRotation();

    const result = await window.installer.start(installDir);
    if (!result.started) {
        stopStatusRotation();
        if (result.reason === 'already-running') return;
        let detail = 'A instalação não pôde ser iniciada.';
        if (result.reason === 'payload-missing') {
            detail = 'Pacote de instalação não encontrado dentro do instalador.';
        }
        $('error-detail').textContent = detail;
        showStep('error');
    }
}

window.installer.onDone(({ code }) => {
    if (installFinished) return;
    installFinished = true;
    stopStatusRotation();
    if (code === 0) {
        showStep('done');
    } else {
        $('error-detail').textContent =
            `A instalação não foi concluída (código ${code}). ` +
            'Verifique se o NeoStream IPTV não está em execução e tente novamente.';
        showStep('error');
    }
});

// ─── Wire up ────────────────────────────────────────────────────────────

window.installer.getInfo().then((info) => {
    $('app-version').textContent = `Versão ${info.version}`;
    setDirPath(info.defaultDir);
    if (info.preview) {
        document.title += ' (preview)';
    }
});

$('btn-install').addEventListener('click', startInstall);
$('btn-retry').addEventListener('click', startInstall);

$('btn-toggle-dir').addEventListener('click', () => {
    $('dir-row').classList.toggle('hidden');
});

$('btn-browse').addEventListener('click', async () => {
    const dir = await window.installer.chooseDir(installDir);
    if (dir) setDirPath(dir);
});

$('btn-finish').addEventListener('click', async () => {
    if ($('chk-launch').checked) {
        await window.installer.launchApp();
    }
    window.installer.close();
});

$('btn-minimize').addEventListener('click', () => window.installer.minimize());
$('btn-close').addEventListener('click', () => window.installer.close());
$('btn-error-close').addEventListener('click', () => window.installer.close());
