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
  #guide, #catalog, #series, #episodes { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
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
  .chitem .nm { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chinfo { flex: none; width: 34px; height: 34px; border-radius: 8px; border: none; cursor: pointer;
    background: rgba(255,255,255,.08); color: #fff; font-size: 15px; }
  .chinfo:active { background: rgba(255,255,255,.18); }
  .chepg { margin: 6px 4px 2px 52px; font-size: 12px; color: rgba(255,255,255,.6); line-height: 1.5; }
  .chepg .p { color: #fff; font-weight: 600; }
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
      <div class="tab" id="tab-catalog" data-view="catalog">🎬 Filmes</div>
      <div class="tab" id="tab-series" data-view="series">🎞️ Séries</div>
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

    <div id="catalog" class="hidden">
      <input class="chsearch" id="mvsearch" placeholder="Buscar filme…" autocomplete="off">
      <div class="chlist" id="mvlist"></div>
      <div class="empty" id="mv-empty">Carregando filmes…</div>
      <button class="ctl wide hidden" id="mvqueue" style="margin: 4px auto 0; background: linear-gradient(135deg,#4f46e5,var(--accent));">📡 Transmitir fila</button>
    </div>

    <div id="series" class="hidden">
      <input class="chsearch" id="sesearch" placeholder="Buscar série…" autocomplete="off">
      <div class="chlist" id="selist"></div>
      <div class="empty" id="se-empty">Carregando séries…</div>
    </div>

    <div id="episodes" class="hidden">
      <button class="ctl wide" id="ep-back" style="margin: 0 auto 2px">← Voltar</button>
      <div class="chlist" id="eplist"></div>
      <div class="empty" id="ep-empty">Carregando episódios…</div>
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
    var catalogEl = document.getElementById('catalog');
    var mvlistEl = document.getElementById('mvlist');
    var mvsearchEl = document.getElementById('mvsearch');
    var mvEmptyEl = document.getElementById('mv-empty');
    var ws;
    var guide = { channels: [], playingId: '', epg: null };
    var filter = '';
    var epgCache = {};   // channelId → { now, nowStart, nowEnd, next }
    var openEpg = {};    // channelId → true while its EPG panel is expanded
    var movies = [];     // catalog: [{ id, name, cover }]
    var mvFilter = '';
    var catalogRequested = false;
    var selected = {};   // movieId → true (multi-select for the cast queue)
    var mvqueueEl = document.getElementById('mvqueue');
    var seriesEl = document.getElementById('series');
    var episodesEl = document.getElementById('episodes');
    var selistEl = document.getElementById('selist');
    var sesearchEl = document.getElementById('sesearch');
    var seEmptyEl = document.getElementById('se-empty');
    var eplistEl = document.getElementById('eplist');
    var epEmptyEl = document.getElementById('ep-empty');
    var seriesList = [];   // [{ id, name, cover }]
    var seFilter = '';
    var seriesRequested = false;
    var episodes = [];     // [{ id, label }]
    var currentSeriesId = '';

    function showPinPrompt(message) {
      pinCard.style.display = 'block';
      connectedEl.style.display = 'none';
      pinErr.textContent = message || '';
      pinInput.value = '';
      pinInput.focus();
    }

    function connect(pin) {
      var wsScheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
      ws = new WebSocket(wsScheme + location.host + '/?pin=' + encodeURIComponent(pin));
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
            var cast = msg.casting ? '📡 ' : '';
            titleEl.textContent = msg.hasMedia ? (msg.title || 'Reproduzindo') : 'Nada tocando';
            statusEl.textContent = cast + (msg.hasMedia ? (msg.playing ? '▶ Reproduzindo' : '⏸ Pausado') : (msg.casting ? 'Transmitindo na TV' : 'Conectado'));
            statusEl.className = 'status on';
          } else if (msg.type === 'guide') {
            guide = { channels: msg.channels || [], playingId: msg.playingId || '', epg: msg.epg || null };
            renderGuide();
          } else if (msg.type === 'channelEpg') {
            epgCache[msg.channelId] = { now: msg.now, nowStart: msg.nowStart, nowEnd: msg.nowEnd, next: msg.next };
            if (openEpg[msg.channelId]) renderGuide();
          } else if (msg.type === 'catalog') {
            movies = msg.items || [];
            renderCatalog();
          } else if (msg.type === 'series') {
            seriesList = msg.items || [];
            renderSeries();
          } else if (msg.type === 'seriesInfo') {
            if (msg.seriesId === currentSeriesId) { episodes = msg.episodes || []; renderEpisodes(); }
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
        var epgHtml = '';
        if (openEpg[c.id]) {
          var e = epgCache[c.id];
          if (e) {
            epgHtml = '<div class="chepg"><div class="p">' + esc(e.now || 'Sem informação') + '</div>'
              + (e.nowStart ? '<div>' + esc(e.nowStart + (e.nowEnd ? ' – ' + e.nowEnd : '')) + '</div>' : '')
              + (e.next ? '<div>A seguir: ' + esc(e.next) + '</div>' : '') + '</div>';
          } else {
            epgHtml = '<div class="chepg">Carregando…</div>';
          }
        }
        html += '<div class="chrow">'
          + '<div class="chitem' + (isPlaying ? ' playing' : '') + '" data-id="' + esc(c.id) + '">'
          + logo + '<div class="nm">' + esc(c.name) + '</div>'
          + '<button class="chinfo" data-info="' + esc(c.id) + '" title="Programação">ⓘ</button></div>'
          + epgHtml + '</div>';
      }
      chlistEl.innerHTML = html || '<div class="empty">Nenhum canal encontrado.</div>';
    }

    chsearchEl.addEventListener('input', function () { filter = chsearchEl.value; renderGuide(); });

    function renderCatalog() {
      if (!movies.length) { mvlistEl.innerHTML = ''; mvEmptyEl.classList.remove('hidden'); mvEmptyEl.textContent = catalogRequested ? 'Nenhum filme.' : 'Carregando filmes…'; return; }
      mvEmptyEl.classList.add('hidden');
      var f = mvFilter.toLowerCase();
      var html = '';
      for (var j = 0; j < movies.length; j++) {
        var m = movies[j];
        if (f && m.name.toLowerCase().indexOf(f) === -1) continue;
        var logo = m.cover
          ? '<img src="' + esc(m.cover) + '" onerror="this.style.display=\\'none\\'" alt="">'
          : '<div class="ph">🎬</div>';
        var sel = selected[m.id];
        html += '<div class="chitem' + (sel ? ' playing' : '') + '" data-mv="' + esc(m.id) + '">'
          + logo + '<div class="nm">' + (sel ? '✓ ' : '') + esc(m.name) + '</div>'
          + '<button class="chinfo" data-cast="' + esc(m.id) + '" title="Transmitir na TV">📡</button></div>';
      }
      mvlistEl.innerHTML = html || '<div class="empty">Nenhum filme encontrado.</div>';
      updateQueueBar();
    }

    function updateQueueBar() {
      var n = Object.keys(selected).length;
      if (n > 0) { mvqueueEl.classList.remove('hidden'); mvqueueEl.textContent = '📡 Transmitir fila (' + n + ')'; }
      else mvqueueEl.classList.add('hidden');
    }

    mvsearchEl.addEventListener('input', function () { mvFilter = mvsearchEl.value; renderCatalog(); });

    mvlistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      // 📡 casts just that movie; tapping the rest of the row toggles selection.
      var castBtn = ev.target.closest('.chinfo');
      if (castBtn) { var mid = castBtn.getAttribute('data-cast'); if (mid) sendCmd('castMovie', null, null, mid); return; }
      var row = ev.target.closest('.chitem');
      if (!row) return;
      var id = row.getAttribute('data-mv');
      if (selected[id]) delete selected[id]; else selected[id] = true;
      renderCatalog();
    });

    mvqueueEl.addEventListener('click', function () {
      var ids = Object.keys(selected);
      if (ids.length) { sendCmd('castMovieQueue', null, null, null, ids); selected = {}; renderCatalog(); }
    });

    // ------------------------------------------------------------- Séries --
    function renderSeries() {
      if (!seriesList.length) {
        selistEl.innerHTML = ''; seEmptyEl.classList.remove('hidden');
        seEmptyEl.textContent = seriesRequested ? 'Nenhuma série.' : 'Carregando séries…'; return;
      }
      seEmptyEl.classList.add('hidden');
      var f = seFilter.toLowerCase();
      var html = '';
      for (var j = 0; j < seriesList.length; j++) {
        var s = seriesList[j];
        if (f && s.name.toLowerCase().indexOf(f) === -1) continue;
        var logo = s.cover
          ? '<img src="' + esc(s.cover) + '" onerror="this.style.display=\\'none\\'" alt="">'
          : '<div class="ph">🎞️</div>';
        html += '<div class="chitem" data-se="' + esc(s.id) + '" data-nm="' + esc(s.name) + '">'
          + logo + '<div class="nm">' + esc(s.name) + '</div>'
          + '<span class="chinfo" title="Ver episódios">›</span></div>';
      }
      selistEl.innerHTML = html || '<div class="empty">Nenhuma série encontrada.</div>';
    }

    sesearchEl.addEventListener('input', function () { seFilter = sesearchEl.value; renderSeries(); });

    selistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var item = ev.target.closest('.chitem');
      if (!item) return;
      var sid = item.getAttribute('data-se');
      if (!sid) return;
      currentSeriesId = sid;
      episodes = [];
      document.getElementById('ep-empty').textContent = 'Carregando episódios…';
      document.getElementById('ep-empty').classList.remove('hidden');
      eplistEl.innerHTML = '';
      seriesEl.classList.add('hidden');
      episodesEl.classList.remove('hidden');
      sendCmd('requestSeriesInfo', null, null, null, sid);
    });

    function renderEpisodes() {
      if (!episodes.length) {
        eplistEl.innerHTML = ''; epEmptyEl.classList.remove('hidden');
        epEmptyEl.textContent = 'Nenhum episódio.'; return;
      }
      epEmptyEl.classList.add('hidden');
      var html = '';
      for (var j = 0; j < episodes.length; j++) {
        var e = episodes[j];
        html += '<div class="chitem" data-ep="' + esc(e.id) + '">'
          + '<div class="ph">▶️</div><div class="nm">' + esc(e.label) + '</div>'
          + '<button class="chinfo" data-castep="' + esc(e.id) + '" title="Transmitir na TV">📡</button></div>';
      }
      eplistEl.innerHTML = html;
    }

    eplistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var castBtn = ev.target.closest('.chinfo');
      if (castBtn) { var eid = castBtn.getAttribute('data-castep'); if (eid) sendCmd('castEpisode', null, null, null, null, eid); }
    });

    var epBackEl = document.getElementById('ep-back');
    epBackEl.addEventListener('click', function () {
      episodesEl.classList.add('hidden');
      seriesEl.classList.remove('hidden');
      currentSeriesId = '';
    });

    chlistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      // The ⓘ button toggles the on-demand EPG panel (fetch once, then cached).
      var info = ev.target.closest('.chinfo');
      if (info) {
        var iid = info.getAttribute('data-info');
        if (openEpg[iid]) delete openEpg[iid];
        else { openEpg[iid] = true; if (!epgCache[iid]) sendCmd('requestEpg', null, iid); }
        renderGuide();
        return;
      }
      // Tapping the rest of the row switches to that channel.
      var item = ev.target.closest('.chitem');
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
        controlEl.classList.add('hidden'); guideEl.classList.add('hidden'); catalogEl.classList.add('hidden');
        seriesEl.classList.add('hidden'); episodesEl.classList.add('hidden');
        if (view === 'guide') { guideEl.classList.remove('hidden'); renderGuide(); }
        else if (view === 'catalog') {
          catalogEl.classList.remove('hidden');
          if (!catalogRequested) { catalogRequested = true; sendCmd('requestCatalog'); }
          renderCatalog();
        }
        else if (view === 'series') {
          // Drill-down always re-enters at the series list, not a stale episodes view.
          seriesEl.classList.remove('hidden'); currentSeriesId = '';
          if (!seriesRequested) { seriesRequested = true; sendCmd('requestSeries'); }
          renderSeries();
        }
        else { controlEl.classList.remove('hidden'); }
      });
    });

    // arg5 carries movieIds (castMovieQueue) or seriesId (requestSeriesInfo);
    // arg6 carries episodeId (castEpisode). Positions are disjoint per action.
    function sendCmd(action, sec, channelId, movieId, arg5, arg6) {
      if (!ws || ws.readyState !== 1) return;
      var payload = { action: action };
      if (action === 'seek') payload.seconds = sec;
      if (action === 'playChannel' || action === 'requestEpg') payload.channelId = channelId;
      if (action === 'castMovie') payload.movieId = movieId;
      if (action === 'castMovieQueue') payload.movieIds = arg5;
      if (action === 'requestSeriesInfo') payload.seriesId = arg5;
      if (action === 'castEpisode') payload.episodeId = arg6;
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
