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

import { STRINGS, type RemoteLang } from './webRemoteStrings'

export type { RemoteLang } from './webRemoteStrings'

/** Accent colors mirrored from the desktop theme (falls back to indigo). */
export interface RemoteAccent {
    main: string
    dark: string
    rgb: string
}

const DEFAULT_ACCENT: RemoteAccent = { main: '#6366f1', dark: '#4f46e5', rgb: '99, 102, 241' }

/** Render the phone page in the app's language (anything unknown falls back to pt). */
export function renderRemotePage(lang?: string, accent?: RemoteAccent): string {
    const code: RemoteLang = lang === 'en' || lang === 'es' ? lang : 'pt'
    const t = STRINGS[code]
    const a = accent && accent.main && accent.dark && accent.rgb ? accent : DEFAULT_ACCENT
    return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>NeoStream — ${t.brandSuffix}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.png">
<meta name="theme-color" content="#0a0a0f">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  :root { --accent: ${a.main}; --accent-dark: ${a.dark}; --accent-rgb: ${a.rgb}; }
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
  .tab.active { background: linear-gradient(135deg, var(--accent-dark), var(--accent)); color: #fff; border-color: transparent; }
  /* 🌓 Tema claro: overrides por cima do dark (inline styles caem no !important) */
  body.light { background: #eef1f7 !important; color: #15151f; }
  body.light .ctl { background: rgba(0,0,0,.06) !important; color: #1c1c28 !important; border-color: rgba(0,0,0,.14) !important; }
  body.light .tab { background: rgba(0,0,0,.05); color: rgba(0,0,0,.6); }
  body.light .hint { color: rgba(0,0,0,.55) !important; }
  body.light input { background: rgba(0,0,0,.05) !important; color: #15151f !important; border-color: rgba(0,0,0,.15) !important; }
  body.light .card, body.light [class*="card"] { background: rgba(0,0,0,.04) !important; }
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
  button.ctl.primary { background: linear-gradient(135deg, var(--accent-dark), var(--accent)); width: 80px; height: 80px; font-size: 30px; }
  button.ctl.wide { width: auto; padding: 0 22px; font-size: 15px; font-weight: 600; height: 52px; }
  .seek button.ctl { font-size: 15px; font-weight: 600; }
  .hint { font-size: 12px; color: rgba(255,255,255,.4); max-width: 420px; text-align: center; }
  .hidden { display: none !important; }
  /* Guide */
  #guide, #catalog, #series, #episodes, #continue, #search { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
  .gsearch { width: 100%; max-width: 420px; }
  .cobar { height: 4px; border-radius: 2px; background: rgba(255,255,255,.12); margin-top: 6px; overflow: hidden; }
  .cobar > span { display: block; height: 100%; background: var(--accent); }
  .rechead { font-size: 12px; font-weight: 600; color: rgba(255,255,255,.55); text-transform: uppercase; letter-spacing: .4px; margin: 16px 0 2px; }
  .castvol { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
  .castvol span { font-size: 14px; }
  .castvol input { flex: 1; }
  .castprog { margin-top: 12px; }
  .casttime { font-size: 12px; color: rgba(255,255,255,.5); margin-top: 6px; text-align: center; }
  .castseek { -webkit-appearance: none; appearance: none; width: 100%; height: 5px; border-radius: 3px;
    background: rgba(255,255,255,.15); outline: none; cursor: pointer; }
  .castseek::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px;
    border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px rgba(var(--accent-rgb),.6); }
  .castseek::-moz-range-thumb { width: 16px; height: 16px; border: none; border-radius: 50%; background: var(--accent); }
  .nowbar {
    background: linear-gradient(135deg, rgba(var(--accent-rgb),.25), rgba(var(--accent-rgb),.12));
    border: 1px solid rgba(var(--accent-rgb),.3); border-radius: 16px; padding: 14px 16px; text-align: left;
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
  .chitem.playing { border-color: var(--accent); background: rgba(var(--accent-rgb),.16); }
  .chitem img { width: 40px; height: 40px; border-radius: 8px; object-fit: contain; background: rgba(0,0,0,.3); flex: none; }
  .chitem .ph { width: 40px; height: 40px; border-radius: 8px; background: rgba(255,255,255,.08); display: flex; align-items: center; justify-content: center; font-size: 18px; flex: none; }
  .chitem .nm { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chinfo { flex: none; width: 34px; height: 34px; border-radius: 8px; border: none; cursor: pointer;
    background: rgba(255,255,255,.08); color: #fff; font-size: 15px; }
  .chinfo:active { background: rgba(255,255,255,.18); }
  .chepg { margin: 6px 4px 2px 52px; font-size: 12px; color: rgba(255,255,255,.6); line-height: 1.5; }
  .chepg .p { color: #fff; font-weight: 600; }
  .empty { font-size: 13px; color: rgba(255,255,255,.4); text-align: center; padding: 24px 0; }
  /* Device selector bar */
  .devbar { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 420px; }
  .devlbl { font-size: 12px; color: rgba(255,255,255,.55); white-space: nowrap; }
  .devsel {
    flex: 1; min-width: 0; padding: 8px 10px; border-radius: 10px; font-size: 13px;
    background: rgba(255,255,255,.06); color: #fff; border: 1px solid rgba(255,255,255,.12);
  }
  .devsel option { color: #000; }
  /* Toast */
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    max-width: 90%; padding: 12px 18px; border-radius: 12px; font-size: 14px; font-weight: 600;
    background: rgba(20,20,30,.95); color: #fff; border: 1px solid rgba(255,255,255,.15);
    box-shadow: 0 8px 30px rgba(0,0,0,.5); z-index: 50; text-align: center;
  }
  .toast.ok { border-color: rgba(52,211,153,.5); }
  .toast.err { border-color: rgba(252,165,165,.5); }
</style>
</head>
<body>
  <div class="brand">Neo<span>Stream</span> · ${t.brandSuffix}</div>

  <div class="card" id="pin-card" style="display:none">
    <div class="title">${t.pinTitle}</div>
    <div class="status">${t.pinHint}</div>
    <input id="pin-input" inputmode="numeric" maxlength="4" placeholder="0000"
      style="margin-top:16px;width:140px;font-size:28px;text-align:center;letter-spacing:8px;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;">
    <div><button class="ctl wide" id="pin-ok" style="margin-top:16px">${t.pinConnect}</button></div>
    <div class="status off" id="pin-err" style="margin-top:10px;min-height:16px"></div>
  </div>

  <div id="connected" style="display:none">
    <div class="tabs">
      <div class="tab active" id="tab-ctl" data-view="control">🎛️ ${t.tabControl}</div>
      <div class="tab" id="tab-guide" data-view="guide">📺 ${t.tabGuide}</div>
      <div class="tab" id="tab-catalog" data-view="catalog">🎬 ${t.tabMovies}</div>
      <div class="tab" id="tab-series" data-view="series">🎞️ ${t.tabSeries}</div>
      <div class="tab" id="tab-continue" data-view="continue">⏯️ ${t.tabContinue}</div>
    </div>

    <div class="devbar">
      <span class="devlbl">📡 ${t.castTo}</span>
      <select id="devsel" class="devsel"><option value="">${t.devAuto}</option></select>
    </div>

    <input class="chsearch gsearch" id="gsearch" placeholder="🔍 ${t.searchAllPh}" autocomplete="off">
    <div id="search" class="hidden">
      <div class="chlist" id="srlist"></div>
      <div class="empty" id="sr-empty">${t.searchPrompt}</div>
    </div>

    <div id="control">
      <div class="card">
        <div class="title" id="title">—</div>
        <div class="status" id="status">${t.connecting}</div>
        <div class="castprog hidden" id="castprog">
          <input type="range" id="castseek" class="castseek" min="0" max="1000" value="0">
          <div class="casttime" id="casttime">0:00 / 0:00</div>
        </div>
        <div class="castvol hidden" id="castvolrow">
          <span>🔊</span>
          <input type="range" id="castvol" class="castseek" min="0" max="100" value="50">
        </div>
        <select id="castaud" class="devsel hidden" title="${t.audio}"></select>
        <div class="row seek">
          <button class="ctl" data-cmd="previous" title="${t.prev}">⏮</button>
          <button class="ctl" data-cmd="seek" data-sec="-30" title="-30s">-30s</button>
          <button class="ctl primary" data-cmd="togglePlay" id="play" title="${t.playPause}">⏯</button>
          <button class="ctl" data-cmd="seek" data-sec="30" title="+30s">+30s</button>
          <button class="ctl" data-cmd="next" title="${t.next}">⏭</button>
        </div>
        <div class="row">
          <button class="ctl" data-cmd="volumeDown" title="${t.volDown}">🔉</button>
          <button class="ctl" data-cmd="mute" title="${t.mute}">🔇</button>
          <button class="ctl" data-cmd="volumeUp" title="${t.volUp}">🔊</button>
          <button class="ctl hidden" data-cmd="subtitle" id="castsub" title="${t.subtitle}">💬</button>
          <button class="ctl wide" data-cmd="stop" title="${t.stop}">⏹ ${t.stop}</button>
        </div>
        <div class="row">
          <button class="ctl" data-sleep="30" title="${t.sleepBtn}">😴 30</button>
          <button class="ctl" data-sleep="60" title="${t.sleepBtn}">😴 60</button>
          <button class="ctl" data-sleep="90" title="${t.sleepBtn}">😴 90</button>
          <button class="ctl" data-sleep="0" title="${t.sleepOff}">😴 ✕</button>
          <button class="ctl" id="focusapp" title="${t.openApp}">🖥️</button>
          <button class="ctl" id="mvbtn" title="${t.openMultiview}">🎛️</button>
          <button class="ctl" id="ssbtn" title="${t.screenshotPc}">📷</button>
          <button class="ctl" id="themetoggle" title="${t.themeToggle}">🌓</button>
        </div>
        <div class="row">
          <input id="zapnum" type="number" inputmode="numeric" placeholder="${t.zapNumPh}" style="flex:1;min-width:0;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-size:16px" />
          <button class="ctl" id="zapgo">📺 ${t.zapGo}</button>
        </div>
        <div class="hint hidden" id="statsline" style="margin-top:10px"></div>
        <div class="hint hidden" id="remtitle" style="margin-top:10px"></div>
        <div id="remlist"></div>
      </div>
      <div id="trackpad" style="margin-top:14px;height:130px;border:1px dashed rgba(255,255,255,.25);border-radius:12px;display:flex;align-items:center;justify-content:center;gap:10px;color:rgba(255,255,255,.4);font-size:12px;user-select:none;touch-action:none">
        <span>${t.trackpadHint}</span>
        <button class="ctl" id="navback" title="${t.navBack}" style="flex:none">↩</button>
      </div>
      <div id="hostsRow" style="margin-top:10px;font-size:12px;color:rgba(255,255,255,.5)"></div>
      <div class="hint" style="margin-top:16px">${t.hint}</div>
      <div class="card hidden" id="reccard" style="margin-top:14px;text-align:left">
        <div class="title">📼 ${t.recCardTitle}</div>
        <div class="chlist" id="reclive"></div>
        <div class="rechead hidden" id="recreadyhead">${t.recReady}</div>
        <div class="chlist" id="recfiles"></div>
        <div class="rechead hidden" id="recschedhead">📅 ${t.recScheduled}</div>
        <div class="chlist" id="recsched"></div>
      </div>
    </div>

    <div id="guide" class="hidden">
      <div class="nowbar" id="nowbar">
        <div class="lbl">${t.nowOnTv}</div>
        <div class="ch" id="now-ch">${t.noChannel}</div>
        <div class="prog" id="now-prog"></div>
        <div class="time" id="now-time"></div>
        <div class="nxt" id="now-next"></div>
      </div>
      <input class="chsearch" id="chsearch" placeholder="${t.searchChannel}" autocomplete="off">
      <div class="chlist" id="chlist"></div>
      <div class="empty hidden" id="guide-empty">${t.guideEmpty}</div>
    </div>

    <div id="catalog" class="hidden">
      <input class="chsearch" id="mvsearch" placeholder="${t.searchMovie}" autocomplete="off">
      <div class="chlist" id="mvlist"></div>
      <div class="empty" id="mv-empty">${t.loadingMovies}</div>
      <button class="ctl wide hidden" id="mvqueue" style="margin: 4px auto 0; background: linear-gradient(135deg,var(--accent-dark),var(--accent));">📡 ${t.castQueue}</button>
    </div>

    <div id="series" class="hidden">
      <input class="chsearch" id="sesearch" placeholder="${t.searchSeries}" autocomplete="off">
      <div class="chlist" id="selist"></div>
      <div class="empty" id="se-empty">${t.loadingSeries}</div>
    </div>

    <div id="episodes" class="hidden">
      <button class="ctl wide" id="ep-back" style="margin: 0 auto 2px">← ${t.back}</button>
      <div class="chlist" id="eplist"></div>
      <div class="empty" id="ep-empty">${t.loadingEpisodes}</div>
    </div>

    <div id="continue" class="hidden">
      <div class="chlist" id="colist"></div>
      <div class="empty" id="co-empty">${t.loading}</div>
      <div class="chlist" id="reclist"></div>
    </div>
  </div>

  <div id="toast" class="toast hidden"></div>
<script>
  (function () {
    var L = ${JSON.stringify(t)};
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
    var activeRecs = {}; // channelName → recording id (guia marca 🔴)
    var recsData = { items: [], files: [], scheduled: [] }; // card 📼 da aba Controle
    var pendingDelete = '';      // nome aguardando o 2º toque do 🗑
    var pendingDeleteTimer = null;
    var pendingCancel = '';      // id de agendada aguardando o 2º toque do ✖
    var pendingCancelTimer = null;
    var srChannels = [];         // canais ao vivo na busca global
    var reccardEl = document.getElementById('reccard');
    var recliveEl = document.getElementById('reclive');
    var recfilesEl = document.getElementById('recfiles');
    var recreadyheadEl = document.getElementById('recreadyhead');
    var recschedEl = document.getElementById('recsched');
    var recschedheadEl = document.getElementById('recschedhead');
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
    var castprogEl = document.getElementById('castprog');
    var castseekEl = document.getElementById('castseek');
    var casttimeEl = document.getElementById('casttime');
    var castsubEl = document.getElementById('castsub');
    var lastCastTime = 0, lastCastDur = 0, seekingCast = false;
    var castvolrowEl = document.getElementById('castvolrow');
    var castvolEl = document.getElementById('castvol');
    var castaudEl = document.getElementById('castaud');
    var draggingVol = false, volSendTimer = null;
    var lastAudKey = '';  // signature of the last rendered track list
    var coEl = document.getElementById('continue');
    var colistEl = document.getElementById('colist');
    var coEmptyEl = document.getElementById('co-empty');
    var continueList = [];  // [{ kind, castId, name, cover, pct }]
    var reclistEl = document.getElementById('reclist');
    var recGroups = [];     // [{ seed, items: [{ kind, id, name, cover }] }]
    var gsearchEl = document.getElementById('gsearch');
    var searchEl = document.getElementById('search');
    var srlistEl = document.getElementById('srlist');
    var srEmptyEl = document.getElementById('sr-empty');
    var gFilter = '', searchMode = false, activeView = 'control', gSearchTimer = null;
    var srMovies = [], srSeries = [];  // global-search results (kept apart from the tabs' data)
    var devselEl = document.getElementById('devsel');
    var toastEl = document.getElementById('toast');
    var devices = [];      // [{ id, name, type }]
    var devicesRequested = false;
    var selDev = localStorage.getItem('neostream_remote_device') || '';  // "type:id" or ''
    var toastTimer = null;

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
        statusEl.textContent = L.connected; statusEl.className = 'status on';
        if (!devicesRequested) { devicesRequested = true; sendCmd('requestDevices'); }
        sendCmd('requestStats');
        sendCmd('requestReminders');
        // Land on the last tab the user was using (Guia/Filmes/Séries).
        var savedTab = localStorage.getItem('neostream_remote_tab');
        if (savedTab === 'guide' || savedTab === 'catalog' || savedTab === 'series' || savedTab === 'continue') activateTab(savedTab);
      };
      ws.onclose = function () {
        // 1006 with no prior open + wrong PIN → the server refused (401).
        if (connectedEl.style.display === 'none') {
          showPinPrompt(L.pinWrong);
          return;
        }
        statusEl.textContent = L.reconnecting; statusEl.className = 'status off';
        setTimeout(function () { connect(pin); }, 1500);
      };
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === 'state') {
            var cast = msg.casting ? '📡 ' : '';
            titleEl.textContent = msg.hasMedia ? (msg.title || L.playing)
              : (msg.casting && msg.castTitle ? msg.castTitle : L.nothingPlaying);
            statusEl.textContent = cast + (msg.hasMedia ? (msg.playing ? '▶ ' + L.playing : '⏸ ' + L.paused) : (msg.casting ? (msg.castDevice ? L.castingToast + L.onDevice + msg.castDevice : L.castingOnTv) : L.connected));
            statusEl.className = 'status on';
            updateCastProgress(msg);
          } else if (msg.type === 'guide') {
            guide = { channels: msg.channels || [], playingId: msg.playingId || '', epg: msg.epg || null };
            renderGuide();
          } else if (msg.type === 'stats') {
            var sl = document.getElementById('statsline');
            if (sl) {
              sl.textContent = '📊 ' + L.statsToday + ' ' + fmtHours(msg.todaySeconds) + ' · ' + L.statsWeek + ' ' + fmtHours(msg.weekSeconds) + (msg.streak > 0 ? ' · 🔥 ' + msg.streak : '');
              sl.classList.remove('hidden');
            }
          } else if (msg.type === 'reminders') {
            renderReminders(msg.items || []);
          } else if (msg.type === 'channelEpg') {
            epgCache[msg.channelId] = { now: msg.now, nowStart: msg.nowStart, nowEnd: msg.nowEnd, next: msg.next };
            if (openEpg[msg.channelId]) renderGuide();
          } else if (msg.type === 'catalog') {
            // Route by mode so global search doesn't clobber the Filmes tab data.
            if (searchMode) { srMovies = msg.items || []; renderSearch(); }
            else { movies = msg.items || []; renderCatalog(); }
          } else if (msg.type === 'series') {
            if (searchMode) { srSeries = msg.items || []; renderSearch(); }
            else { seriesList = msg.items || []; renderSeries(); }
          } else if (msg.type === 'seriesInfo') {
            if (msg.seriesId === currentSeriesId) { episodes = msg.episodes || []; renderEpisodes(); }
          } else if (msg.type === 'continue') {
            continueList = msg.items || [];
            renderContinue();
          } else if (msg.type === 'recommended') {
            recGroups = msg.groups || [];
            renderRecommended();
          } else if (msg.type === 'screenshot') {
            showScreenshot(msg.dataUrl);
          } else if (msg.type === 'devices') {
            devices = msg.items || [];
            renderDevices();
          } else if (msg.type === 'recordResult') {
            if (msg.status === 'ok') {
              if (msg.name && msg.id) activeRecs[msg.name] = msg.id;
              showToast('⏺ ' + L.recStarted + (msg.name ? ': ' + msg.name : ''), 'ok');
              renderGuide();
              sendCmd('requestRecordings');
            } else if (msg.status === 'deleted') {
              pendingDelete = '';
              showToast('🗑 ' + L.recDeleted, 'ok');
              sendCmd('requestRecordings');
            } else if (msg.status === 'stopped') {
              for (var rn in activeRecs) { if (activeRecs[rn] === msg.id) delete activeRecs[rn]; }
              showToast('⏹ ' + L.recStopped, 'ok');
              renderGuide();
              sendCmd('requestRecordings');
            } else if (msg.status === 'renamed') {
              showToast('\u270f\ufe0f ' + L.recRenamed, 'ok');
              sendCmd('requestRecordings');
            } else if (msg.status === 'protected') {
              pendingDelete = '';
              showToast('\ud83d\udd10 ' + L.recProtected, 'ok');
              sendCmd('requestRecordings');
            } else if (msg.status === 'unprotected') {
              showToast('\ud83d\udd13 ' + L.recUnprotected, 'ok');
              sendCmd('requestRecordings');
            } else if (msg.status === 'cancelled') {
              pendingCancel = '';
              showToast('✖ ' + L.schedCancelled, 'ok');
              sendCmd('requestRecordings');
            } else showToast(L.recFail, 'err');
          } else if (msg.type === 'liveResults') {
            if (searchMode) { srChannels = msg.items || []; renderSearch(); }
          } else if (msg.type === 'recordings') {
            activeRecs = {};
            for (var ri = 0; ri < (msg.items || []).length; ri++) activeRecs[msg.items[ri].channelName] = msg.items[ri].id;
            recsData = { items: msg.items || [], files: msg.files || [], scheduled: msg.scheduled || [] };
            renderGuide();
            renderRecCard();
          } else if (msg.type === 'scheduleResult') {
            // Refresh the card so the fresh schedule shows up under 📅.
            if (msg.status === 'ok') { showToast('📅 ' + L.schedOk + msg.title, 'ok'); sendCmd('requestRecordings'); }
            else showToast(L.schedFail, 'err');
          } else if (msg.type === 'castResult') {
            if (msg.status === 'ok') showToast('📡 ' + L.castingToast + (msg.deviceName ? L.onDevice + msg.deviceName : ''), 'ok');
            else if (msg.status === 'no-device') showToast(L.noTvFound, 'err');
            else showToast(L.castFailed, 'err');
          }
        } catch (e) {}
      };
    }

    function fmtTime(s) {
      s = Math.max(0, Math.floor(s || 0));
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      var mm = (h > 0 && m < 10 ? '0' : '') + m, ss = (sec < 10 ? '0' : '') + sec;
      return (h > 0 ? h + ':' : '') + mm + ':' + ss;
    }

    // Cast progress + scrubber on the Controle card (only while casting).
    function updateCastProgress(msg) {
      var dur = msg.castDuration || 0, cur = msg.castTime || 0;
      lastCastTime = cur; lastCastDur = dur;
      if (msg.casting && dur > 0) {
        castprogEl.classList.remove('hidden');
        if (!seekingCast) castseekEl.value = String(Math.round((cur / dur) * 1000));
        casttimeEl.textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
      } else {
        castprogEl.classList.add('hidden');
      }
      // 💬 only while casting media that carries a subtitle track; lit = active.
      if (msg.casting && msg.castSubAvailable) {
        castsubEl.classList.remove('hidden');
        castsubEl.style.background = msg.castSubEnabled !== false
          ? 'linear-gradient(135deg, var(--accent-dark), var(--accent))' : '';
      } else {
        castsubEl.classList.add('hidden');
      }
      // 🔊 absolute volume slider (only while casting and the receiver reports it).
      if (msg.casting && typeof msg.castVolume === 'number') {
        castvolrowEl.classList.remove('hidden');
        if (!draggingVol) castvolEl.value = String(Math.round(msg.castVolume * 100));
      } else {
        castvolrowEl.classList.add('hidden');
      }
      // Audio-track picker — only when the media carries more than one track.
      var tracks = (msg.casting && msg.castAudioTracks) || [];
      if (tracks.length > 1) {
        var key = tracks.map(function (t) { return t.trackId + ':' + t.name; }).join('|');
        if (key !== lastAudKey) {
          lastAudKey = key;
          var opts = '';
          for (var i = 0; i < tracks.length; i++) {
            var t = tracks[i];
            var label = t.name || t.language || (L.audio + ' ' + (i + 1));
            opts += '<option value="' + t.trackId + '">🎧 ' + esc(label) + '</option>';
          }
          castaudEl.innerHTML = opts;
        }
        if (typeof msg.castAudioActive === 'number') castaudEl.value = String(msg.castAudioActive);
        castaudEl.classList.remove('hidden');
      } else {
        castaudEl.classList.add('hidden');
        lastAudKey = '';
      }
    }

    // Volume: live preview while dragging, throttled sends so the receiver
    // isn't flooded; a final send lands on release.
    castvolEl.addEventListener('input', function () {
      draggingVol = true;
      if (volSendTimer) return;
      volSendTimer = setTimeout(function () {
        volSendTimer = null;
        sendCmd('setVolume', Number(castvolEl.value) / 100);
      }, 200);
    });
    castvolEl.addEventListener('change', function () {
      draggingVol = false;
      if (volSendTimer) { clearTimeout(volSendTimer); volSendTimer = null; }
      sendCmd('setVolume', Number(castvolEl.value) / 100);
    });

    castaudEl.addEventListener('change', function () {
      var id = Number(castaudEl.value);
      if (isFinite(id)) sendCmd('setAudioTrack', id);
    });

    // Scrubbing: preview the time while dragging, then seek on release. Cast seek
    // is relative on the wire, so we send the delta from the last known position.
    castseekEl.addEventListener('input', function () {
      if (lastCastDur <= 0) return;
      seekingCast = true;
      var target = (Number(castseekEl.value) / 1000) * lastCastDur;
      casttimeEl.textContent = fmtTime(target) + ' / ' + fmtTime(lastCastDur);
    });
    castseekEl.addEventListener('change', function () {
      if (lastCastDur <= 0) { seekingCast = false; return; }
      var target = (Number(castseekEl.value) / 1000) * lastCastDur;
      var delta = Math.round(target - lastCastTime);
      if (delta !== 0) sendCmd('seek', delta);
      lastCastTime = target;
      seekingCast = false;
    });

    function showToast(text, kind) {
      toastEl.textContent = text;
      toastEl.className = 'toast ' + (kind || '');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.className = 'toast hidden'; }, 3500);
    }

    function devIcon(type) { return type === 'dlna' ? '📺' : (type === 'airplay' ? '🍎' : '📡'); }

    function renderDevices() {
      var cur = selDev;
      var html = '<option value="">' + L.devAuto + '</option>';
      for (var i = 0; i < devices.length; i++) {
        var d = devices[i];
        var val = d.type + ':' + d.id;
        html += '<option value="' + esc(val) + '">' + devIcon(d.type) + ' ' + esc(d.name) + '</option>';
      }
      devselEl.innerHTML = html;
      // Keep the saved choice if it is still present; otherwise fall back to auto.
      var found = false;
      for (var j = 0; j < devices.length; j++) { if (devices[j].type + ':' + devices[j].id === cur) { found = true; break; } }
      devselEl.value = found ? cur : '';
      if (!found && cur) { selDev = ''; localStorage.removeItem('neostream_remote_device'); }
    }

    if (devselEl) devselEl.addEventListener('change', function () {
      selDev = devselEl.value || '';
      if (selDev) localStorage.setItem('neostream_remote_device', selDev);
      else localStorage.removeItem('neostream_remote_device');
    });

    document.getElementById('pin-ok').addEventListener('click', function () {
      var pin = (pinInput.value || '').trim();
      if (pin.length === 4) connect(pin);
      else pinErr.textContent = L.pinLen;
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
      document.getElementById('now-ch').textContent = playing ? playing.name : L.noChannel;
      document.getElementById('now-prog').textContent = epg && epg.now ? epg.now : '';
      document.getElementById('now-time').textContent = epg && epg.nowStart ? (epg.nowStart + (epg.nowEnd ? ' – ' + epg.nowEnd : '')) : '';
      document.getElementById('now-next').textContent = epg && epg.next ? L.nextUp + epg.next : '';

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
            epgHtml = '<div class="chepg"><div class="p">' + esc(e.now || L.noInfo) + '</div>'
              + (e.nowStart ? '<div>' + esc(e.nowStart + (e.nowEnd ? ' – ' + e.nowEnd : '')) + '</div>' : '')
              + (e.next ? '<div>' + L.nextUp + esc(e.next)
                + ' <button class="chinfo" data-sched="' + esc(c.id) + '" title="' + L.schedNext + '" style="width:26px;height:26px;font-size:12px">⏺</button></div>' : '') + '</div>';
          } else {
            epgHtml = '<div class="chepg">' + L.loading + '</div>';
          }
        }
        html += '<div class="chrow">'
          + '<div class="chitem' + (isPlaying ? ' playing' : '') + '" data-id="' + esc(c.id) + '">'
          + logo + '<div class="nm">' + esc(c.name) + '</div>'
          + (activeRecs[c.name]
            ? '<button class="chinfo" data-recstop="' + esc(activeRecs[c.name]) + '" title="' + L.recStop + '" style="background:rgba(239,68,68,.35)">🔴</button>'
            : '<button class="chinfo" data-rec="' + esc(c.id) + '" data-nm="' + esc(c.name) + '" title="' + L.recTitle + '">⏺</button>')
          + '<button class="chinfo" data-info="' + esc(c.id) + '" title="' + L.programming + '">ⓘ</button></div>'
          + epgHtml + '</div>';
      }
      chlistEl.innerHTML = html || '<div class="empty">' + L.noChannelFound + '</div>';
    }

    chsearchEl.addEventListener('input', function () { filter = chsearchEl.value; renderGuide(); });

    function renderCatalog() {
      if (!movies.length) { mvlistEl.innerHTML = ''; mvEmptyEl.classList.remove('hidden'); mvEmptyEl.textContent = catalogRequested ? L.noMovies : L.loadingMovies; return; }
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
          + '<button class="chinfo" data-party="' + esc(m.id) + '" title="Fila da festa">🎉</button>'
          + '<button class="chinfo" data-cast="' + esc(m.id) + '" title="' + L.castToTv + '">📡</button></div>';
      }
      mvlistEl.innerHTML = html || '<div class="empty">' + L.noMovieFound + '</div>';
      updateQueueBar();
    }

    function updateQueueBar() {
      var n = Object.keys(selected).length;
      if (n > 0) { mvqueueEl.classList.remove('hidden'); mvqueueEl.textContent = '📡 ' + L.castQueue + ' (' + n + ')'; }
      else mvqueueEl.classList.add('hidden');
    }

    mvsearchEl.addEventListener('input', function () {
      mvFilter = mvsearchEl.value;
      renderCatalog();                                  // instant refine on loaded items
      debouncedSearch('requestCatalog', mvFilter);      // full-catalog search
    });

    mvlistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      // 📡 casts just that movie; tapping the rest of the row toggles selection.
      var castBtn = ev.target.closest('.chinfo');
      var partyBtn = e.target.closest('[data-party]');
      if (partyBtn) { var pid = partyBtn.getAttribute('data-party'); if (pid) { sendCmd('partyAdd', null, null, pid); partyBtn.textContent = '✓'; } return; }
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
        seEmptyEl.textContent = seriesRequested ? L.noSeries : L.loadingSeries; return;
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
          + '<span class="chinfo" title="' + L.seeEpisodes + '">›</span></div>';
      }
      selistEl.innerHTML = html || '<div class="empty">' + L.noSeriesFound + '</div>';
    }

    sesearchEl.addEventListener('input', function () {
      seFilter = sesearchEl.value;
      renderSeries();                                   // instant refine on loaded items
      debouncedSearch('requestSeries', seFilter);       // full-catalog search
    });

    selistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var item = ev.target.closest('.chitem');
      if (!item) return;
      var sid = item.getAttribute('data-se');
      if (!sid) return;
      currentSeriesId = sid;
      episodes = [];
      document.getElementById('ep-empty').textContent = L.loadingEpisodes;
      document.getElementById('ep-empty').classList.remove('hidden');
      eplistEl.innerHTML = '';
      seriesEl.classList.add('hidden');
      episodesEl.classList.remove('hidden');
      sendCmd('requestSeriesInfo', null, null, null, sid);
    });

    function renderEpisodes() {
      if (!episodes.length) {
        eplistEl.innerHTML = ''; epEmptyEl.classList.remove('hidden');
        epEmptyEl.textContent = L.noEpisodes; return;
      }
      epEmptyEl.classList.add('hidden');
      var html = '';
      for (var j = 0; j < episodes.length; j++) {
        var e = episodes[j];
        html += '<div class="chitem" data-ep="' + esc(e.id) + '">'
          + '<div class="ph">▶️</div><div class="nm">' + esc(e.label) + '</div>'
          + '<button class="chinfo" data-castep="' + esc(e.id) + '" title="' + L.castToTv + '">📡</button></div>';
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

    // ----------------------------------------------------- Continuar assistindo --
    function renderContinue() {
      if (!continueList.length) {
        colistEl.innerHTML = ''; coEmptyEl.classList.remove('hidden');
        coEmptyEl.textContent = L.nothingInProgress; return;
      }
      coEmptyEl.classList.add('hidden');
      var html = '';
      for (var j = 0; j < continueList.length; j++) {
        var c = continueList[j];
        var icon = c.kind === 'series' ? '🎞️' : '🎬';
        var logo = c.cover
          ? '<img src="' + esc(c.cover) + '" onerror="this.style.display=\\'none\\'" alt="">'
          : '<div class="ph">' + icon + '</div>';
        var pct = Math.max(0, Math.min(100, c.pct || 0));
        html += '<div class="chitem" data-co="' + esc(c.castId) + '" data-kind="' + esc(c.kind) + '">'
          + logo
          + '<div style="flex:1;min-width:0">'
          + '<div class="nm">' + esc(c.name) + '</div>'
          + '<div class="cobar"><span style="width:' + pct + '%"></span></div></div>'
          + '<button class="chinfo" data-cocast="' + esc(c.castId) + '" data-kind="' + esc(c.kind) + '" title="' + L.resumeOnTv + '">📡</button></div>';
      }
      colistEl.innerHTML = html;
    }

    colistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var btn = ev.target.closest('.chinfo') || ev.target.closest('.chitem');
      if (!btn) return;
      var id = btn.getAttribute('data-cocast') || btn.getAttribute('data-co');
      var kind = btn.getAttribute('data-kind');
      if (!id) return;
      if (kind === 'series') sendCmd('castEpisode', null, null, null, null, id);
      else sendCmd('castMovie', null, null, id);
    });

    // -------------------------------------------- Recomendados ("porque você assistiu") --
    // "24/12 21:30" (só "21:30" quando é hoje) pra linha de agendada.
    function fmtSched(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var now = new Date();
      var hm = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
      var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      if (sameDay) return hm;
      return ((d.getDate() < 10 ? '0' : '') + d.getDate()) + '/' + ((d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1)) + ' ' + hm;
    }

    function renderRecCard() {
      var hasAny = recsData.items.length || recsData.files.length || recsData.scheduled.length;
      if (!hasAny) { reccardEl.classList.add('hidden'); return; }
      reccardEl.classList.remove('hidden');
      var html = '';
      for (var i = 0; i < recsData.items.length; i++) {
        var r = recsData.items[i];
        html += '<div class="chitem"><div class="ph">🔴</div>'
          + '<div class="nm">' + esc(r.channelName) + ' · ' + fmtTime(r.seconds || 0) + '</div>'
          + '<button class="chinfo" data-recstop="' + esc(r.id) + '" title="' + L.recStop + '">⏹</button></div>';
      }
      recliveEl.innerHTML = html;
      var fhtml = '';
      for (var fi = 0; fi < recsData.files.length; fi++) {
        var f = recsData.files[fi];
        var confirming = pendingDelete === f.name;
        fhtml += '<div class="chitem"><div class="ph">📼</div>'
          + '<div class="nm">' + (f.locked ? '\ud83d\udd10 ' : '') + esc(f.name) + '</div>'
          + '<span style="flex:none;font-size:12px;color:rgba(255,255,255,.5)">' + (f.sizeMb || 0) + ' MB</span>'
          + '<a class="chinfo" style="text-decoration:none" href="/recording?name=' + encodeURIComponent(f.name) + '&pin=' + encodeURIComponent(localStorage.getItem('neostream_remote_pin') || '') + '" download title="' + L.recDownload + '">\u2b07\ufe0f</a>'
          + '<button class="chinfo" data-ren="' + esc(f.name) + '" title="' + L.recRename + '">\u270f\ufe0f</button>'
          + '<button class="chinfo" data-lock="' + esc(f.name) + '" title="' + L.recProtect + '">' + (f.locked ? '\ud83d\udd10' : '\ud83d\udd13') + '</button>'
          + '<button class="chinfo" data-del="' + esc(f.name) + '" title="' + (confirming ? L.recDeleteConfirm : L.recDelete) + '"'
          + (confirming ? ' style="background:rgba(239,68,68,.45)"' : '') + '>' + (confirming ? '❗' : '🗑') + '</button></div>';
      }
      recfilesEl.innerHTML = fhtml;
      recreadyheadEl.classList.toggle('hidden', !recsData.files.length);
      var shtml = '';
      for (var si = 0; si < recsData.scheduled.length; si++) {
        var s = recsData.scheduled[si];
        var canceling = pendingCancel === s.id;
        var when = fmtSched(s.startIso);
        shtml += '<div class="chitem"><div class="ph">📅</div>'
          + '<div class="nm">' + esc(s.title) + (s.channelName ? ' · ' + esc(s.channelName) : '') + '</div>'
          + (when ? '<span style="flex:none;font-size:12px;color:rgba(255,255,255,.5)">' + when + '</span>' : '')
          + '<button class="chinfo" data-cancel="' + esc(s.id) + '" title="' + (canceling ? L.recDeleteConfirm : L.schedCancel) + '"'
          + (canceling ? ' style="background:rgba(239,68,68,.45)"' : '') + '>' + (canceling ? '❗' : '✖') + '</button></div>';
      }
      recschedEl.innerHTML = shtml;
      recschedheadEl.classList.toggle('hidden', !recsData.scheduled.length);
    }

    recliveEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var stop = ev.target.closest('[data-recstop]');
      if (stop) sendCmd('stopRecord', null, stop.getAttribute('data-recstop'));
    });

    recfilesEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var ren = ev.target.closest('[data-ren]');
      if (ren) {
        var rname = ren.getAttribute('data-ren');
        var newName = prompt(L.recRenamePrompt, rname || '');
        if (newName && newName.trim() && rname) sendCmd('renameRecording', null, rname, null, newName.trim());
        return;
      }
      var lockBtn = ev.target.closest('[data-lock]');
      if (lockBtn) {
        var lname = lockBtn.getAttribute('data-lock');
        if (lname) sendCmd('toggleProtectRecording', null, lname);
        return;
      }
      var del = ev.target.closest('[data-del]');
      if (!del) return;
      var name = del.getAttribute('data-del');
      if (pendingDelete === name) {
        pendingDelete = '';
        if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
        sendCmd('deleteRecording', null, name);
      } else {
        // 1º toque só arma a confirmação (desarma sozinha em 4s).
        pendingDelete = name;
        if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = setTimeout(function () { pendingDelete = ''; renderRecCard(); }, 4000);
      }
      renderRecCard();
    });

    recschedEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var btn = ev.target.closest('[data-cancel]');
      if (!btn) return;
      var sid = btn.getAttribute('data-cancel');
      if (pendingCancel === sid) {
        pendingCancel = '';
        if (pendingCancelTimer) clearTimeout(pendingCancelTimer);
        sendCmd('cancelSchedule', null, sid);
      } else {
        // 1º toque só arma a confirmação (desarma sozinha em 4s).
        pendingCancel = sid;
        if (pendingCancelTimer) clearTimeout(pendingCancelTimer);
        pendingCancelTimer = setTimeout(function () { pendingCancel = ''; renderRecCard(); }, 4000);
      }
      renderRecCard();
    });

    function renderRecommended() {
      var html = '';
      for (var g = 0; g < recGroups.length; g++) {
        var grp = recGroups[g];
        if (!grp.items || !grp.items.length) continue;
        html += '<div class="rechead">' + L.becauseWatched + ' ' + esc(grp.seed) + '</div>';
        for (var j = 0; j < grp.items.length; j++) {
          var r = grp.items[j];
          var icon = r.kind === 'series' ? '🎞️' : '🎬';
          var logo = r.cover
            ? '<img src="' + esc(r.cover) + '" onerror="this.style.display=\\'none\\'" alt="">'
            : '<div class="ph">' + icon + '</div>';
          if (r.kind === 'series') {
            html += '<div class="chitem" data-recse="' + esc(r.id) + '">'
              + logo + '<div class="nm">' + esc(r.name) + '</div>'
              + '<span class="chinfo" title="' + L.seeEpisodes + '">›</span></div>';
          } else {
            html += '<div class="chitem" data-recmv="' + esc(r.id) + '">'
              + logo + '<div class="nm">' + esc(r.name) + '</div>'
              + '<button class="chinfo" data-reccast="' + esc(r.id) + '" title="' + L.castToTv + '">📡</button></div>';
          }
        }
      }
      reclistEl.innerHTML = html;
    }

    reclistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      // 📡 (or the movie row itself) casts the movie; a series row drills into
      // its episodes, same flow as tapping a series in the Séries tab.
      var cast = ev.target.closest('.chinfo');
      if (cast && cast.getAttribute('data-reccast')) { sendCmd('castMovie', null, null, cast.getAttribute('data-reccast')); return; }
      var se = ev.target.closest('[data-recse]');
      if (se) {
        var sid = se.getAttribute('data-recse');
        currentSeriesId = sid; episodes = [];
        document.getElementById('ep-empty').textContent = L.loadingEpisodes;
        document.getElementById('ep-empty').classList.remove('hidden');
        eplistEl.innerHTML = '';
        coEl.classList.add('hidden');
        episodesEl.classList.remove('hidden');
        sendCmd('requestSeriesInfo', null, null, null, sid);
        return;
      }
      var mv = ev.target.closest('[data-recmv]');
      if (mv) sendCmd('castMovie', null, null, mv.getAttribute('data-recmv'));
    });

    chlistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      // 🔴 second tap: finalize that recording on the computer.
      var recStop = ev.target.closest('[data-recstop]');
      if (recStop) { sendCmd('stopRecord', null, recStop.getAttribute('data-recstop')); return; }
      // ⏺ in the expanded EPG: schedule the channel's NEXT program.
      var sched = ev.target.closest('[data-sched]');
      if (sched) { sendCmd('scheduleNext', null, sched.getAttribute('data-sched')); return; }
      // ⏺ starts a DVR recording of that channel on the computer.
      var rec = ev.target.closest('[data-rec]');
      if (rec) { sendCmd('recordChannel', null, rec.getAttribute('data-rec'), null, rec.getAttribute('data-nm')); return; }
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

    // ------------------------------------------------------ Busca unificada --
    function renderSearch() {
      if (!gFilter) { srlistEl.innerHTML = ''; srEmptyEl.classList.remove('hidden'); srEmptyEl.textContent = L.searchPrompt; return; }
      var html = '';
      for (var ci = 0; ci < srChannels.length; ci++) {
        var ch = srChannels[ci];
        var clogo = ch.logo ? '<img src="' + esc(ch.logo) + '" onerror="this.style.display='none'" alt="">' : '<div class="ph">📺</div>';
        html += '<div class="chitem" data-srch="' + esc(ch.id) + '">' + clogo
          + '<div class="nm">' + esc(ch.name) + '</div>'
          + '<span class="chinfo" title="▶">📺</span></div>';
      }
      for (var i = 0; i < srMovies.length; i++) {
        var m = srMovies[i];
        var logo = m.cover ? '<img src="' + esc(m.cover) + '" onerror="this.style.display=\\'none\\'" alt="">' : '<div class="ph">🎬</div>';
        html += '<div class="chitem" data-srmv="' + esc(m.id) + '">' + logo
          + '<div class="nm">' + esc(m.name) + '</div>'
          + '<button class="chinfo" data-srcast="' + esc(m.id) + '" title="' + L.castToTv + '">📡</button></div>';
      }
      for (var j = 0; j < srSeries.length; j++) {
        var s = srSeries[j];
        var slogo = s.cover ? '<img src="' + esc(s.cover) + '" onerror="this.style.display=\\'none\\'" alt="">' : '<div class="ph">🎞️</div>';
        html += '<div class="chitem" data-srse="' + esc(s.id) + '" data-nm="' + esc(s.name) + '">' + slogo
          + '<div class="nm">' + esc(s.name) + '</div>'
          + '<span class="chinfo" title="' + L.seeEpisodes + '">›</span></div>';
      }
      if (!html) { srlistEl.innerHTML = ''; srEmptyEl.classList.remove('hidden'); srEmptyEl.textContent = L.noResults; return; }
      srEmptyEl.classList.add('hidden');
      srlistEl.innerHTML = html;
    }

    gsearchEl.addEventListener('input', function () {
      gFilter = gsearchEl.value.trim();
      if (gFilter) {
        searchMode = true;
        // Hide every tab view; show the combined results.
        controlEl.classList.add('hidden'); guideEl.classList.add('hidden'); catalogEl.classList.add('hidden');
        seriesEl.classList.add('hidden'); episodesEl.classList.add('hidden'); coEl.classList.add('hidden');
        searchEl.classList.remove('hidden');
        srEmptyEl.textContent = L.searching; srEmptyEl.classList.remove('hidden');
        if (gSearchTimer) clearTimeout(gSearchTimer);
        gSearchTimer = setTimeout(function () {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ action: 'requestCatalog', query: gFilter }));
            ws.send(JSON.stringify({ action: 'requestSeries', query: gFilter }));
            ws.send(JSON.stringify({ action: 'requestLiveSearch', query: gFilter }));
          }
        }, 300);
      } else {
        if (gSearchTimer) clearTimeout(gSearchTimer);
        searchMode = false; srMovies = []; srSeries = []; srChannels = [];
        searchEl.classList.add('hidden');
        activateTab(activeView || 'control');
      }
    });

    srlistEl.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var cast = ev.target.closest('.chinfo');
      if (cast && cast.getAttribute('data-srcast')) { sendCmd('castMovie', null, null, cast.getAttribute('data-srcast')); return; }
      var se = ev.target.closest('[data-srse]');
      if (se) {
        // Drill into the series' episodes (leaves search, like tapping in Séries).
        var sid = se.getAttribute('data-srse');
        gsearchEl.value = ''; gFilter = ''; searchMode = false; searchEl.classList.add('hidden');
        currentSeriesId = sid; episodes = [];
        document.getElementById('ep-empty').textContent = L.loadingEpisodes;
        document.getElementById('ep-empty').classList.remove('hidden');
        eplistEl.innerHTML = '';
        episodesEl.classList.remove('hidden');
        sendCmd('requestSeriesInfo', null, null, null, sid);
        return;
      }
      var chn = ev.target.closest('[data-srch]');
      if (chn) { sendCmd('playChannel', null, chn.getAttribute('data-srch')); return; }
      var mv = ev.target.closest('[data-srmv]');
      if (mv) sendCmd('castMovie', null, null, mv.getAttribute('data-srmv'));
    });

    // Switch to a tab (also used to restore the last tab after reconnecting).
    function activateTab(view) {
      activeView = view;
      // Leaving a tab exits any active search.
      searchMode = false; searchEl.classList.add('hidden');
      if (gsearchEl.value) gsearchEl.value = '';
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-view') === view);
      });
      controlEl.classList.add('hidden'); guideEl.classList.add('hidden'); catalogEl.classList.add('hidden');
      seriesEl.classList.add('hidden'); episodesEl.classList.add('hidden'); coEl.classList.add('hidden');
      if (view === 'guide') { guideEl.classList.remove('hidden'); sendCmd('requestRecordings'); renderGuide(); }
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
      else if (view === 'continue') {
        // Always re-request: progress (and habits) change as you watch on the PC.
        coEl.classList.remove('hidden');
        coEmptyEl.textContent = L.loading; coEmptyEl.classList.remove('hidden');
        sendCmd('requestContinue');
        sendCmd('requestRecommended');
        renderContinue();
        renderRecommended();
      }
      else { controlEl.classList.remove('hidden'); sendCmd('requestRecordings'); }
    }

    // Tab switching (remembers the choice so a reconnect lands on the same tab).
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var view = tab.getAttribute('data-view');
        activateTab(view);
        if (view && view !== 'control') localStorage.setItem('neostream_remote_tab', view);
        else localStorage.removeItem('neostream_remote_tab');
      });
    });

    // arg5 carries movieIds (castMovieQueue) or seriesId (requestSeriesInfo);
    // arg6 carries episodeId (castEpisode). Positions are disjoint per action.
    function fmtHours(totalSeconds) {
      var s = Number(totalSeconds) || 0;
      var h = Math.floor(s / 3600);
      var m = Math.floor((s % 3600) / 60);
      return h > 0 ? h + 'h' + (m < 10 ? '0' : '') + m : m + 'min';
    }

    // 😴 sleep remoto + 🖥️ trazer o app + 📺 zap por número (W2)
    document.querySelectorAll('button[data-sleep]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = Number(b.getAttribute('data-sleep')) || 0;
        sendCmd('sleep', m);
        showToast(m > 0 ? '😴 ' + m + ' min' : L.sleepOff, 'ok');
      });
    });
    var focusBtn = document.getElementById('focusapp');
    if (focusBtn) focusBtn.addEventListener('click', function () { sendCmd('focusApp'); showToast('🖥️ ' + L.openApp, 'ok'); });
    var mvBtn = document.getElementById('mvbtn');
    if (mvBtn) mvBtn.addEventListener('click', function () { sendCmd('openMultiview'); showToast('🎛️ ' + L.openMultiview, 'ok'); });
    var trackpadEl = document.getElementById('trackpad');
    if (trackpadEl) {
      var tpStart = null;
      trackpadEl.addEventListener('touchstart', function (ev) {
        var t0 = ev.touches[0];
        tpStart = { x: t0.clientX, y: t0.clientY };
      }, { passive: true });
      trackpadEl.addEventListener('touchend', function (ev) {
        if (!tpStart) return;
        if (ev.target && ev.target.id === 'navback') { tpStart = null; return; }
        var t1 = ev.changedTouches[0];
        var dx = t1.clientX - tpStart.x;
        var dy = t1.clientY - tpStart.y;
        tpStart = null;
        var key;
        if (Math.abs(dx) < 24 && Math.abs(dy) < 24) key = 'ok';
        else if (Math.abs(dx) > Math.abs(dy)) key = dx > 0 ? 'right' : 'left';
        else key = dy > 0 ? 'down' : 'up';
        sendCmd('navKey', null, key);
      }, { passive: true });
    }
    var navBackBtn = document.getElementById('navback');
    if (navBackBtn) navBackBtn.addEventListener('click', function () { sendCmd('navKey', null, 'back'); });
    try {
      var hostsKey = 'ns_remote_hosts';
      var savedHosts = JSON.parse(localStorage.getItem(hostsKey) || '[]');
      if (savedHosts.indexOf(location.origin) === -1) {
        savedHosts.push(location.origin);
        localStorage.setItem(hostsKey, JSON.stringify(savedHosts.slice(-5)));
      }
      var hostsEl = document.getElementById('hostsRow');
      if (hostsEl && savedHosts.length > 1) {
        var hostsHtml = '\ud83d\udda5\ufe0f ';
        for (var hi = 0; hi < savedHosts.length; hi++) {
          var host = savedHosts[hi];
          var shortHost = host.replace('https://', '').replace('http://', '');
          hostsHtml += host === location.origin
            ? '<b style="color:#fff">' + shortHost + '</b> '
            : '<a href="' + host + '" style="color:rgba(129,140,248,.9)">' + shortHost + '</a> ';
        }
        hostsEl.innerHTML = hostsHtml;
      }
    } catch (e) { /* sem localStorage o switcher s\u00f3 n\u00e3o aparece */ }
    var ssBtn = document.getElementById('ssbtn');
    if (ssBtn) ssBtn.addEventListener('click', function () { sendCmd('screenshot'); showToast('📷 ' + L.screenshotPc + '…', 'ok'); });
    function showScreenshot(dataUrl) {
      if (!dataUrl) { showToast('📷 ✗', 'err'); return; }
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:12px';
      var shot = document.createElement('img');
      shot.src = dataUrl;
      shot.style.cssText = 'max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.6)';
      overlay.appendChild(shot);
      overlay.addEventListener('click', function () { overlay.remove(); });
      document.body.appendChild(overlay);
    }
    // 🌓 Tema claro/escuro persistido no aparelho
    function applyTheme(mode) { document.body.classList.toggle('light', mode === 'light'); }
    try { applyTheme(localStorage.getItem('nsTheme') || 'dark'); } catch (e) { /* storage bloqueado */ }
    var themeBtn = document.getElementById('themetoggle');
    if (themeBtn) themeBtn.addEventListener('click', function () {
      var next = document.body.classList.contains('light') ? 'dark' : 'light';
      try { localStorage.setItem('nsTheme', next); } catch (e) { /* idem */ }
      applyTheme(next);
    });
    // ⏰ Lembretes do guia (lista com cancelar)
    function renderReminders(items) {
      var box = document.getElementById('remlist');
      var title = document.getElementById('remtitle');
      if (!box || !title) return;
      box.innerHTML = '';
      if (!items.length) { title.classList.add('hidden'); return; }
      title.textContent = '⏰ ' + L.remindersTitle;
      title.classList.remove('hidden');
      items.forEach(function (r) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px';
        var when = new Date(r.startIso);
        var label = document.createElement('span');
        label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        label.textContent = ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2) + ' · ' + r.title + ' (' + r.channelName + ')';
        var btn = document.createElement('button');
        btn.className = 'ctl';
        btn.textContent = '✕';
        btn.title = L.reminderCancel;
        btn.addEventListener('click', function () { sendCmd('cancelReminder', 0, r.id); });
        row.appendChild(label); row.appendChild(btn);
        box.appendChild(row);
      });
    }
    var zapNumEl = document.getElementById('zapnum');
    var zapGoEl = document.getElementById('zapgo');
    function zapByNumber() {
      var n = Number(zapNumEl && zapNumEl.value);
      if (!n) return;
      var ch = null;
      for (var zi = 0; zi < guide.channels.length; zi++) {
        if (Number(guide.channels[zi].num) === n) { ch = guide.channels[zi]; break; }
      }
      if (ch) { sendCmd('playChannel', null, ch.id); showToast('📺 ' + ch.name, 'ok'); zapNumEl.value = ''; }
      else showToast(L.zapNumMiss, 'err');
    }
    if (zapGoEl) zapGoEl.addEventListener('click', zapByNumber);
    if (zapNumEl) zapNumEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') zapByNumber(); });

    function sendCmd(action, sec, channelId, movieId, arg5, arg6) {
      if (!ws || ws.readyState !== 1) return;
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) { /* sem vibra */ }
      var payload = { action: action };
      if (action === 'seek') payload.seconds = sec;
      if (action === 'sleep') payload.minutes = sec;
      if (action === 'setVolume') payload.level = sec;
      if (action === 'setAudioTrack') payload.trackId = sec;
      if (action === 'playChannel' || action === 'requestEpg') payload.channelId = channelId;
      if (action === 'recordChannel') { payload.channelId = channelId; payload.channelName = arg5; }
      if (action === 'stopRecord') payload.id = channelId;
      if (action === 'deleteRecording') payload.name = channelId;
      if (action === 'renameRecording') { payload.name = channelId; payload.newName = arg5; }
      if (action === 'toggleProtectRecording') payload.name = channelId;
      if (action === 'navKey') payload.key = channelId;
      if (action === 'requestLiveSearch') payload.query = channelId;
      if (action === 'scheduleNext') payload.channelId = channelId;
      if (action === 'cancelSchedule') payload.id = channelId;
      if (action === 'cancelReminder') payload.id = channelId;
      if (action === 'castMovie') payload.movieId = movieId;
      if (action === 'partyAdd') payload.movieId = movieId;
      if (action === 'castMovieQueue') payload.movieIds = arg5;
      if (action === 'requestSeriesInfo') payload.seriesId = arg5;
      if (action === 'castEpisode') payload.episodeId = arg6;
      // Attach the chosen cast target (type:id) to any cast action.
      if ((action === 'castMovie' || action === 'castMovieQueue' || action === 'castEpisode') && selDev) {
        var sep = selDev.indexOf(':');
        if (sep > 0) { payload.deviceType = selDev.slice(0, sep); payload.deviceId = selDev.slice(sep + 1); }
      }
      ws.send(JSON.stringify(payload));
    }

    // Full-catalog search: ask the app to filter the WHOLE list server-side
    // (not just the ≤400 items already loaded here), debounced per keystroke.
    var searchTimer = null;
    function debouncedSearch(action, query) {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ action: action, query: query || '' }));
      }, 300);
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
}

/** Default PT page (server picks the real language at request time). */
export const REMOTE_PAGE_HTML = renderRemotePage('pt')
