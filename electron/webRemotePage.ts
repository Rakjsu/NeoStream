/**
 * The phone control page — a single self-contained HTML string served by the
 * web-remote HTTP server. Connects back over WebSocket to receive media state
 * and send commands. No external assets (works fully offline on the LAN).
 */

export const REMOTE_PAGE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>NeoStream — Controle</title>
<style>
  :root { --accent: #6366f1; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; min-height: 100vh; font-family: -apple-system, system-ui, sans-serif;
    background: radial-gradient(120% 80% at 50% 0%, #1a1a2e, #0a0a0f);
    color: #fff; display: flex; flex-direction: column; align-items: center;
    padding: 24px; gap: 20px; user-select: none;
  }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: .5px; margin-top: 12px; }
  .brand span { color: var(--accent); }
  .card {
    width: 100%; max-width: 420px; background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.1); border-radius: 20px; padding: 22px;
    text-align: center;
  }
  .title { font-size: 16px; font-weight: 600; min-height: 22px; margin-bottom: 6px; }
  .status { font-size: 13px; color: rgba(255,255,255,.55); }
  .status.on { color: #34d399; }
  .status.off { color: #fca5a5; }
  .row { display: flex; gap: 14px; justify-content: center; margin-top: 18px; }
  button {
    border: none; border-radius: 16px; color: #fff; font-size: 24px;
    background: rgba(255,255,255,.08); width: 68px; height: 68px; cursor: pointer;
    transition: transform .08s ease, background .15s ease;
  }
  button:active { transform: scale(.92); background: rgba(255,255,255,.16); }
  button.primary { background: linear-gradient(135deg, #4f46e5, var(--accent)); width: 84px; height: 84px; font-size: 32px; }
  button.wide { width: auto; padding: 0 22px; font-size: 15px; font-weight: 600; height: 52px; }
  .seek button { font-size: 15px; font-weight: 600; }
  .hint { font-size: 12px; color: rgba(255,255,255,.4); max-width: 420px; text-align: center; }
</style>
</head>
<body>
  <div class="brand">Neo<span>Stream</span> · Controle</div>
  <div class="card">
    <div class="title" id="title">—</div>
    <div class="status" id="status">Conectando…</div>
    <div class="row seek">
      <button data-cmd="previous" title="Anterior">⏮</button>
      <button data-cmd="seek" data-sec="-30" title="-30s">-30s</button>
      <button class="primary" data-cmd="togglePlay" id="play" title="Play/Pause">⏯</button>
      <button data-cmd="seek" data-sec="30" title="+30s">+30s</button>
      <button data-cmd="next" title="Próximo">⏭</button>
    </div>
    <div class="row">
      <button data-cmd="volumeDown" title="Volume -">🔉</button>
      <button data-cmd="mute" title="Mudo">🔇</button>
      <button data-cmd="volumeUp" title="Volume +">🔊</button>
      <button class="wide" data-cmd="stop" title="Parar">⏹ Parar</button>
    </div>
  </div>
  <div class="hint">Mantenha o app aberto no computador. Este controle funciona na mesma rede Wi-Fi.</div>
<script>
  (function () {
    var titleEl = document.getElementById('title');
    var statusEl = document.getElementById('status');
    var ws;

    function connect() {
      ws = new WebSocket('ws://' + location.host + '/');
      ws.onopen = function () { statusEl.textContent = 'Conectado'; statusEl.className = 'status on'; };
      ws.onclose = function () {
        statusEl.textContent = 'Reconectando…'; statusEl.className = 'status off';
        setTimeout(connect, 1500);
      };
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === 'state') {
            titleEl.textContent = msg.hasMedia ? (msg.title || 'Reproduzindo') : 'Nada tocando';
            statusEl.textContent = msg.hasMedia ? (msg.playing ? '▶ Reproduzindo' : '⏸ Pausado') : 'Conectado';
            statusEl.className = 'status on';
          }
        } catch (e) {}
      };
    }
    connect();

    function send(action, sec) {
      if (!ws || ws.readyState !== 1) return;
      var payload = { action: action };
      if (action === 'seek') payload.seconds = sec;
      ws.send(JSON.stringify(payload));
    }

    document.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.getAttribute('data-cmd');
        var sec = btn.getAttribute('data-sec');
        send(cmd, sec ? Number(sec) : undefined);
      });
    });
  })();
</script>
</body>
</html>`
