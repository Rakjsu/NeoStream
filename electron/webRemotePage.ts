/**
 * The phone control page — a single self-contained HTML string served by the
 * web-remote HTTP server. Connects back over WebSocket to receive media state
 * and send commands. No external assets (works fully offline on the LAN).
 *
 * Flow: a PIN gate first (the code shown on the desktop), then two views —
 * "Controle" (transport buttons) and "Guia", a second screen that lists the
 * live channels with the now/next EPG of the playing channel and lets you tap
 * a channel to switch (the LiveTV page pushes the guide data).
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
    padding: 20px 16px 32px; gap: 16px; user-select: none;
  }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: .5px; margin-top: 8px; }
  .brand span { color: var(--accent); }
  #connected { display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%; }
  .tabs { display: flex; gap: 8px; width: 100%; max-width: 420px; }
  .tab {
    flex: 1; padding: 12px 0; border-radius: 14px; border: 1px solid rgba(255,255,255,.1);
    background: rgba(255,255,255,.04); color: rgba(255,255,255,.6); font-size: 14px;
    font-weight: 600; cursor: pointer; text-align: center; transition: all .15s ease;
  }
  .tab.active { background: linear-gradient(135deg, #4f46e5, var(--accent)); color: #fff; border-color: transparent; }
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
  button.ctl {
    border: none; border-radius: 16px; color: #fff; font-size: 24px;
    background: rgba(255,255,255,.08); width: 64px; height: 64px; cursor: pointer;
    transition: transform .08s ease, background .15s ease;
  }
  button.ctl:active { transform: scale(.92); background: rgba(255,255,255,.16); }
  button.ctl.primary { background: linear-gradient(135deg, #4f46e5, var(--accent)); width: 80px; height: 80px; font-size: 30px; }
  button.ctl.wide { width: auto; padding: 0 22px; font-size: 15px; font-weight: 600; height: 52px; }
  .seek button.ctl { font-size: 15px; font-weight: 600; }
  .hint { font-size: 12px; color: rgba(255,255,255,.4); max-width: 420px; text-align: center; }
  .hidden { display: none !important; }
  /* Guide */
  #guide { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
  .nowbar {
    background: linear-gradient(135deg, rgba(79,70,229,.25), rgba(99,102,241,.12));
    border: 1px solid rgba(99,102,241,.3); border-radius: 16px; padding: 14px 16px; text-align: left;
  }
  .nowbar .lbl { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #a5b4fc; font-weight: 700; }
  .nowbar .ch { font-size: 15px; font-weight: 700; margin-top: 4px; }
  .nowbar .prog { font-size: 14px; color: rgba(255,255,255,.85); margin-top: 2px; }
  .nowbar .time { font-size: 12px; color: rgba(255,255,255,.5); margin-top: 2px; }
  .nowbar .nxt { font-size: 12px; color: rgba(255,255,255,.55); margin-top: 8px; }
  .chsearch {
    width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.1);
    background: rgba(255,255,255,.04); color: #fff; font-size: 14px;
  }
  .chsearch::placeholder { color: rgba(255,255,255,.4); }
  .chlist { display: flex; flex-direction: column; gap: 8px; }
  .chitem {
    display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); cursor: pointer;
    transition: background .12s ease, transform .08s ease; text-align: left;
  }
  .chitem:active { transform: scale(.98); background: rgba(255,255,255,.1); }
  .chitem.playing { border-color: var(--accent); background: rgba(99,102,241,.16); }
  .chitem img { width: 40px; height: 40px; border-radius: 8px; object-fit: contain; background: rgba(0,0,0,.3); flex: none; }
  .chitem .ph { width: 40px; height: 40px; border-radius: 8px; background: rgba(255,255,255,.08); display: flex; align-items: center; justify-content: center; font-size: 18px; flex: none; }
  .chitem .nm { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { font-size: 13px; color: rgba(255,255,255,.4); text-align: center; padding: 24px 0; }
</style>
</head>
<body>
  <div class="brand">Neo<span>Stream</span> · Controle</div>

  <div class="card" id="pin-card" style="display:none">
    <div class="title">Digite o PIN</div>
    <div class="status">O código aparece em Configurações → Rede no computador</div>
    <input id="pin-input" inputmode="numeric" maxlength="4" placeholder="0000"
      style="margin-top:16px;width:140px;font-size:28px;text-align:center;letter-spacing:8px;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;">
    <div><button class="ctl wide" id="pin-ok" style="margin-top:16px">Conectar</button></div>
    <div class="status off" id="pin-err" style="margin-top:10px;min-height:16px"></div>
  </div>

  <div id="connected" style="display:none">
    <div class="tabs">
      <div class="tab active" id="tab-ctl" data-view="control">🎛️ Controle</div>
      <div class="tab" id="tab-guide" data-view="guide">📺 Guia</div>
    </div>

    <div id="control">
      <div class="card">
        <div class="title" id="title">—</div>
        <div class="status" id="status">Conectando…</div>
        <div class="row seek">
          <button class="ctl" data-cmd="previous" title="Anterior">⏮</button>
          <button class="ctl" data-cmd="seek" data-sec="-30" title="-30s">-30s</button>
          <button class="ctl primary" data-cmd="togglePlay" id="play" title="Play/Pause">⏯</button>
          <button class="ctl" data-cmd="seek" data-sec="30" title="+30s">+30s</button>
          <button class="ctl" data-cmd="next" title="Próximo">⏭</button>
        </div>
        <div class="row">
          <button class="ctl" data-cmd="volumeDown" title="Volume -">🔉</button>
          <button class="ctl" data-cmd="mute" title="Mudo">🔇</button>
          <button class="ctl" data-cmd="volumeUp" title="Volume +">🔊</button>
          <button class="ctl wide" data-cmd="stop" title="Parar">⏹ Parar</button>
        </div>
      </div>
      <div class="hint" style="margin-top:16px">Mantenha o app aberto no computador. Este controle funciona na mesma rede Wi-Fi.</div>
    </div>

    <div id="guide" class="hidden">
      <div class="nowbar" id="nowbar">
        <div class="lbl">Agora na TV</div>
        <div class="ch" id="now-ch">Nenhum canal tocando</div>
        <div class="prog" id="now-prog"></div>
        <div class="time" id="now-time"></div>
        <div class="nxt" id="now-next"></div>
      </div>
      <input class="chsearch" id="chsearch" placeholder="Buscar canal…" autocomplete="off">
      <div class="chlist" id="chlist"></div>
      <div class="empty hidden" id="guide-empty">Abra a <b>TV ao vivo</b> no computador para ver os canais aqui.</div>
    </div>
  </div>
<script>
  (function () {
    var titleEl = document.getElementById('title');
    var statusEl = document.getElementById('status');
    var pinCard = document.getElementById('pin-card');
    var connectedEl = document.getElementById('connected');
    var pinInput = document.getElementById('pin-input');
    var pinErr = document.getElementById('pin-err');
    var controlEl = document.getElementById('control');
    var guideEl = document.getElementById('guide');
    var chlistEl = document.getElementById('chlist');
    var chsearchEl = document.getElementById('chsearch');
    var emptyEl = document.getElementById('guide-empty');
    var ws;
    var guide = { channels: [], playingId: '', epg: null };
    var filter = '';

    function showPinPrompt(message) {
      pinCard.style.display = 'block';
      connectedEl.style.display = 'none';
      pinErr.textContent = message || '';
      pinInput.value = '';
      pinInput.focus();
    }

    function connect(pin) {
      ws = new WebSocket('ws://' + location.host + '/?pin=' + encodeURIComponent(pin));
      ws.onopen = function () {
        localStorage.setItem('neostream_remote_pin', pin);
        pinCard.style.display = 'none';
        connectedEl.style.display = 'flex';
        statusEl.textContent = 'Conectado'; statusEl.className = 'status on';
      };
      ws.onclose = function () {
        // 1006 with no prior open + wrong PIN → the server refused (401).
        if (connectedEl.style.display === 'none') {
          showPinPrompt('PIN incorreto. Confira o código no computador.');
          return;
        }
        statusEl.textContent = 'Reconectando…'; statusEl.className = 'status off';
        setTimeout(function () { connect(pin); }, 1500);
      };
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === 'state') {
            titleEl.textContent = msg.hasMedia ? (msg.title || 'Reproduzindo') : 'Nada tocando';
            statusEl.textContent = msg.hasMedia ? (msg.playing ? '▶ Reproduzindo' : '⏸ Pausado') : 'Conectado';
            statusEl.className = 'status on';
          } else if (msg.type === 'guide') {
            guide = { channels: msg.channels || [], playingId: msg.playingId || '', epg: msg.epg || null };
            renderGuide();
          }
        } catch (e) {}
      };
    }

    document.getElementById('pin-ok').addEventListener('click', function () {
      var pin = (pinInput.value || '').trim();
      if (pin.length === 4) connect(pin);
      else pinErr.textContent = 'O PIN tem 4 dígitos.';
    });
    pinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('pin-ok').click(); });

    // Try the remembered PIN first; prompt only if it fails.
    var saved = localStorage.getItem('neostream_remote_pin');
    if (saved && saved.length === 4) connect(saved);
    else showPinPrompt('');

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function renderGuide() {
      var channels = guide.channels;
      var playing = null;
      for (var i = 0; i < channels.length; i++) { if (channels[i].id === guide.playingId) { playing = channels[i]; break; } }
      var epg = guide.epg;
      document.getElementById('now-ch').textContent = playing ? playing.name : 'Nenhum canal tocando';
      document.getElementById('now-prog').textContent = epg && epg.now ? epg.now : '';
      document.getElementById('now-time').textContent = epg && epg.nowStart ? (epg.nowStart + (epg.nowEnd ? ' – ' + epg.nowEnd : '')) : '';
      document.getElementById('now-next').textContent = epg && epg.next ? 'A seguir: ' + epg.next : '';

      if (!channels.length) { chlistEl.innerHTML = ''; emptyEl.classList.remove('hidden'); return; }
      emptyEl.classList.add('hidden');

      var f = filter.toLowerCase();
      var html = '';
      for (var j = 0; j < channels.length; j++) {
        var c = channels[j];
        if (f && c.name.toLowerCase().indexOf(f) === -1) continue;
        var isPlaying = c.id === guide.playingId;
        var logo = c.logo
          ? '<img src="' + esc(c.logo) + '" onerror="this.style.display=\\'none\\'" alt="">'
          : '<div class="ph">📺</div>';
        html += '<div class="chitem' + (isPlaying ? ' playing' : '') + '" data-id="' + esc(c.id) + '">'
          + logo + '<div class="nm">' + esc(c.name) + '</div></div>';
      }
      chlistEl.innerHTML = html || '<div class="empty">Nenhum canal encontrado.</div>';
    }

    chsearchEl.addEventListener('input', function () { filter = chsearchEl.value; renderGuide(); });

    chlistEl.addEventListener('click', function (ev) {
      var item = ev.target.closest ? ev.target.closest('.chitem') : null;
      if (!item) return;
      var id = item.getAttribute('data-id');
      if (id) sendCmd('playChannel', null, id);
    });

    // Tab switching
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var view = tab.getAttribute('data-view');
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        if (view === 'guide') { controlEl.classList.add('hidden'); guideEl.classList.remove('hidden'); renderGuide(); }
        else { guideEl.classList.add('hidden'); controlEl.classList.remove('hidden'); }
      });
    });

    function sendCmd(action, sec, channelId) {
      if (!ws || ws.readyState !== 1) return;
      var payload = { action: action };
      if (action === 'seek') payload.seconds = sec;
      if (action === 'playChannel') payload.channelId = channelId;
      ws.send(JSON.stringify(payload));
    }

    document.querySelectorAll('button.ctl[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.getAttribute('data-cmd');
        var sec = btn.getAttribute('data-sec');
        sendCmd(cmd, sec ? Number(sec) : undefined);
      });
    });
  })();
</script>
</body>
</html>`
