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
 *
 * Anything else (xmltv.php, stream URLs, EPG) answers 404 — the app
 * tolerates that (pages render "Sem programação" / fallbacks).
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

/**
 * Starts the mock server on an ephemeral port.
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
function startMockServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');

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
