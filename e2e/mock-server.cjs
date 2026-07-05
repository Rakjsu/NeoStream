'use strict';

/**
 * Tiny mock Xtream-codes server for the Playwright E2E suite.
 *
 * Zero dependencies (node:http only). Mirrors exactly what the app's
 * main process calls (electron/xtreamClient.ts):
 *
 *   GET /player_api.php?username=..&password=..              -> auth response
 *   GET /player_api.php?...&action=get_live_categories       -> fixtures
 *   GET /player_api.php?...&action=get_live_streams
 *   GET /player_api.php?...&action=get_vod_categories
 *   GET /player_api.php?...&action=get_vod_streams
 *   GET /player_api.php?...&action=get_series_categories
 *   GET /player_api.php?...&action=get_series
 *   GET /player_api.php?...&action=get_series_info        -> episodes fixture (any id)
 *   GET /xmltv.php?username=..&password=..                    -> tiny XMLTV EPG
 *
 * The xmltv.php endpoint serves a small, "now"-relative guide for a few of
 * the seeded channels (globo-sp / sbt / record) so the EpgGuide search and
 * time-paging E2E flows have deterministic program data. Anything else
 * (stream URLs, per-channel EPG) answers 404 — the app tolerates that
 * (pages render "Sem programação" / fallbacks).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const USERNAME = 'e2euser';
const PASSWORD = 'e2epass';

function loadFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}

const fixtures = {
    get_live_categories: loadFixture('live_categories.json'),
    get_live_streams: loadFixture('live_streams.json'),
    get_vod_categories: loadFixture('vod_categories.json'),
    get_vod_streams: loadFixture('vod_streams.json'),
    get_series_categories: loadFixture('series_categories.json'),
    get_series: loadFixture('series.json'),
    get_series_info: loadFixture('series_info.json'),
};

function authResponse(port) {
    return {
        user_info: {
            username: USERNAME,
            password: PASSWORD,
            message: '',
            auth: 1,
            status: 'Active',
            exp_date: String(Math.floor(Date.now() / 1000) + 365 * 24 * 3600),
            is_trial: '0',
            active_cons: '0',
            created_at: '1700000000',
            max_connections: '1',
            allowed_output_formats: ['m3u8', 'ts'],
        },
        server_info: {
            url: '127.0.0.1',
            port: String(port),
            https_port: String(port),
            server_protocol: 'http',
            rtmp_port: '0',
            timezone: 'America/Sao_Paulo',
            timestamp_now: Math.floor(Date.now() / 1000),
            time_now: new Date().toISOString(),
        },
    };
}

/** Format a Date as XMLTV time "YYYYMMDDHHMMSS +0000" (UTC). */
function xmltvTime(date) {
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return (
        `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
        `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())} +0000`
    );
}

/**
 * Build a tiny XMLTV document anchored on "now" so the programs always land
 * inside both the provider retention window (now-24h..now+48h) and the guide's
 * visible window (now-30min..now+4h). Each channel gets a handful of 1h
 * programmes with distinctive titles for the search test.
 *
 * The grid for globo-sp spans now-1h .. now+3h, so:
 *  - "Jornal da Globo" (now-1h..now): already aired (replay material),
 *  - "Jornal Nacional" (now..now+1h): airing now (searchable),
 *  - "Novela das Nove" / "Programa Especial": future blocks (paging material).
 */
function buildXmltv() {
    const HOUR = 60 * 60 * 1000;
    const now = Date.now();
    // Floor to the hour so block boundaries line up cleanly with 30-min ticks.
    const base = Math.floor(now / HOUR) * HOUR;

    const grids = {
        'globo-sp': ['Jornal da Globo', 'Jornal Nacional', 'Novela das Nove', 'Programa Especial'],
        sbt: ['SBT Notícias', 'Programa Silvio Santos', 'Cinema em Casa'],
        record: ['Fala Brasil', 'Cidade Alerta', 'Record Esporte']
    };

    let channelsXml = '';
    let programmesXml = '';

    for (const [channelId, titles] of Object.entries(grids)) {
        channelsXml += `  <channel id="${channelId}"><display-name>${channelId}</display-name></channel>\n`;
        titles.forEach((title, i) => {
            // Start the first block 1h before "now" so the second one is airing.
            const start = new Date(base + (i - 1) * HOUR);
            const stop = new Date(base + i * HOUR);
            programmesXml +=
                `  <programme start="${xmltvTime(start)}" stop="${xmltvTime(stop)}" channel="${channelId}">` +
                `<title lang="pt">${title}</title>` +
                `<desc lang="pt">${title} — descrição</desc>` +
                `</programme>\n`;
        });
    }

    return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<tv generator-info-name="e2e-mock">\n${channelsXml}${programmesXml}</tv>\n`
    );
}

/**
 * Starts the mock server on an ephemeral port.
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
function startMockServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');

        // Extended-M3U playlist (M3U playlist support, round 22+).
        if (url.pathname === '/lista.m3u') {
            const origin = `http://${req.headers.host}`;
            const m3u = [
                '#EXTM3U',
                '#EXTINF:-1 tvg-id="m3u-um" tvg-logo="" group-title="Abertos M3U",Canal M3U Um',
                `${origin}/live/stream-um.m3u8`,
                '#EXTINF:-1 group-title="Abertos M3U",Canal M3U Dois',
                `${origin}/live/stream-dois.m3u8`,
                '#EXTINF:-1 group-title="Esportes M3U",Canal M3U Esporte',
                `${origin}/live/stream-esporte.m3u8`,
                '#EXTINF:-1 tvg-logo="" group-title="SÉRIES M3U",Serie Mock S01E01',
                `${origin}/series/serie-mock-s01e01.mp4`,
                '#EXTINF:-1 group-title="SÉRIES M3U",Serie Mock S01E02',
                `${origin}/series/serie-mock-s01e02.mp4`,
                '#EXTINF:-1 group-title="SÉRIES M3U",Serie Mock S02E01',
                `${origin}/series/serie-mock-s02e01.mp4`,
                ''
            ].join('\n');
            res.writeHead(200, { 'Content-Type': 'application/x-mpegurl; charset=utf-8' });
            res.end(m3u);
            return;
        }

        // Stalker/Ministra portal (round 26+). Single endpoint keyed by
        // type/action, JSON wrapped in {js: ...} like the real middleware.
        if (url.pathname === '/portal.php') {
            const origin = `http://${req.headers.host}`;
            const action = url.searchParams.get('action');
            const reply = (js) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ js }));
            };
            if (action === 'handshake') {
                reply({ token: 'E2E-STALKER-TOKEN' });
                return;
            }
            if (action === 'get_profile') {
                reply({ id: 1, name: 'e2e' });
                return;
            }
            if (action === 'get_genres') {
                reply([
                    { id: '*', title: 'All' },
                    { id: '1', title: 'Abertos STK' },
                    { id: '2', title: 'Esportes STK' }
                ]);
                return;
            }
            if (action === 'get_all_channels') {
                reply({
                    data: [
                        { id: 501, name: 'Canal STK Um', number: 1, logo: '', tv_genre_id: '1', cmd: `ffmpeg ${origin}/live/stk-um.m3u8`, xmltv_id: 'stk-um' },
                        { id: 502, name: 'Canal STK Dois', number: 2, logo: '', tv_genre_id: '1', cmd: `ffmpeg ${origin}/live/stk-dois.m3u8`, xmltv_id: '' },
                        { id: 503, name: 'Canal STK Esporte', number: 3, logo: '', tv_genre_id: '2', cmd: `ffmpeg ${origin}/live/stk-esporte.m3u8`, xmltv_id: '' }
                    ]
                });
                return;
            }
            if (action === 'create_link') {
                const cmd = url.searchParams.get('cmd') || '';
                const match = cmd.match(/https?:\/\/\S+/);
                reply({ cmd: `ffmpeg ${match ? match[0] : `${origin}/live/stk-um.m3u8`}?play_token=E2E` });
                return;
            }
            reply({});
            return;
        }

        // Provider XMLTV EPG (main process: electron/providerEpg.ts).
        if (url.pathname === '/xmltv.php') {
            const user = url.searchParams.get('username');
            const pass = url.searchParams.get('password');
            if (user !== USERNAME || pass !== PASSWORD) {
                res.writeHead(401, { 'Content-Type': 'text/plain' });
                res.end('unauthorized');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            res.end(buildXmltv());
            return;
        }

        if (url.pathname !== '/player_api.php') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
        }

        const user = url.searchParams.get('username');
        const pass = url.searchParams.get('password');
        const action = url.searchParams.get('action');

        const send = (body) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };

        if (user !== USERNAME || pass !== PASSWORD) {
            // Real Xtream servers answer 200 with auth: 0
            send({ user_info: { auth: 0 } });
            return;
        }

        if (!action) {
            send(authResponse(server.address().port));
            return;
        }

        if (Object.prototype.hasOwnProperty.call(fixtures, action)) {
            send(fixtures[action]);
            return;
        }

        // Unknown action: empty list, like many providers do
        send([]);
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({
                url: `http://127.0.0.1:${port}`,
                port,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}

module.exports = { startMockServer, USERNAME, PASSWORD };
