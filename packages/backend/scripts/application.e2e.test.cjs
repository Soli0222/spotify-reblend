const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHmac, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');

// Explicit opt-in: never fall back to the application's DATABASE_URL or .env.
assert.ok(process.env.E2E_DATABASE_URL, 'E2E_DATABASE_URL must point to a test PostgreSQL instance');
const backendDir = path.resolve(__dirname, '..');
const authSecret = 'application-e2e-only-secret';

async function listen(server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
}

async function unusedPort() {
    const server = net.createServer();
    const port = await listen(server);
    await new Promise(resolve => server.close(resolve));
    return port;
}

function sessionCookie(user) {
    // Seed only the external OAuth boundary. The app still verifies the cookie
    // and executes its real auth middleware, routing, SQL and instrumentation.
    const payload = Buffer.from(JSON.stringify({
        sub: user.id, spotifyId: user.spotify_id, exp: Math.floor(Date.now() / 1000) + 300,
    })).toString('base64url');
    const signature = createHmac('sha256', authSecret).update(payload).digest('base64url');
    return `reblend_session=${payload}.${signature}`;
}

for (const mode of ['enabled', 'disabled', 'no-endpoint']) {
    test(`application API E2E: telemetry ${mode}`, { timeout: 45_000 }, async t => {
        const admin = new Pool({ connectionString: process.env.E2E_DATABASE_URL, connectionTimeoutMillis: 5000 });
        // Each run owns its schema; application startup must create the tables.
        const schema = `e2e_${randomUUID().replaceAll('-', '')}`;
        let db;
        let child;
        let exit;
        let outcome;
        let logs = '';
        const batches = [];
        const collector = http.createServer(async (req, res) => {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            batches.push({ path: req.url, body: Buffer.concat(chunks).toString() });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
        t.after(async () => {
            if (child && !outcome) {
                child.kill('SIGKILL');
                await exit;
            }
            await new Promise(resolve => collector.close(resolve));
            await db?.end();
            try {
                await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            } finally {
                await admin.end();
            }
        });

        await admin.query(`CREATE SCHEMA "${schema}"`);
        const databaseUrl = new URL(process.env.E2E_DATABASE_URL);
        databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
        db = new Pool({ connectionString: databaseUrl.toString(), connectionTimeoutMillis: 5000 });
        const collectorPort = await listen(collector);
        const port = await unusedPort();
        const metricsPort = await unusedPort();
        const origin = `http://127.0.0.1:${port}`;

        // Start the compiled production entrypoint in a fresh Node process.
        // Do not import routers into a test app or replace telemetry with a test SDK.
        child = spawn(process.execPath, ['--require', './dist/telemetry.js', 'dist/index.js'], {
            cwd: backendDir,
            env: {
                PATH: process.env.PATH,
                NODE_ENV: 'production',
                PORT: String(port),
                METRICS_PORT: String(metricsPort),
                DATABASE_URL: databaseUrl.toString(),
                DB_CONNECT_ATTEMPTS: '1',
                AUTH_SECRET: authSecret,
                TOKEN_ENCRYPTION_KEY: 'e2e-only-encryption-key',
                SPOTIFY_CLIENT_ID: 'e2e-client',
                SPOTIFY_CLIENT_SECRET: 'e2e-secret',
                AUTO_UPDATE_ENABLED: 'false',
                OTEL_SDK_DISABLED: String(mode === 'disabled'),
                OTEL_EXPORTER_OTLP_ENDPOINT: mode === 'no-endpoint' ? '' : `http://127.0.0.1:${collectorPort}`,
                OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: mode === 'no-endpoint' ? '' : `http://127.0.0.1:${collectorPort}/v1/traces`,
                OTEL_EXPORTER_OTLP_HEADERS: '',
                OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',
                OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: 'none',
                OTEL_TRACES_SAMPLER: 'always_on',
                OTEL_METRICS_EXPORTER: 'none',
                OTEL_NODE_RESOURCE_DETECTORS: 'env,process',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', chunk => { logs += chunk; });
        child.stderr.on('data', chunk => { logs += chunk; });
        exit = new Promise(resolve => {
            child.once('error', error => { outcome = { error }; resolve(outcome); });
            child.once('exit', (code, signal) => { outcome = { code, signal }; resolve(outcome); });
        });

        async function request(route, options = {}) {
            return fetch(`${origin}${route}`, { ...options, signal: AbortSignal.timeout(2000) });
        }

        const deadline = Date.now() + 15_000;
        let ready = false;
        while (Date.now() < deadline) {
            assert.equal(outcome, undefined, `Application exited before readiness:\n${logs}`);
            try {
                const response = await request('/health');
                if (response.status === 200 && (await response.json()).status === 'ok') {
                    ready = true;
                    break;
                }
            } catch { /* Retry only while the child process is starting. */ }
            await delay(50);
        }
        assert.ok(ready, `Application did not become ready:\n${logs}`);

        const page = await request('/');
        assert.equal(page.status, 200);
        const html = await page.text();
        assert.match(html, /<div id="root"><\/div>/);
        const asset = html.match(/src="([^"]+\.js)"/);
        assert.ok(asset, 'Built frontend entry script is present');
        const script = await request(asset[1]);
        assert.equal(script.status, 200);
        assert.match(script.headers.get('content-type'), /javascript/);
        await script.arrayBuffer();
        assert.equal((await request('/api/playlists')).status, 401);

        const { rows: [user] } = await db.query(
            'INSERT INTO users (spotify_id, display_name) VALUES ($1, $2) RETURNING id, spotify_id',
            ['e2e-owner', 'E2E Owner'],
        );
        const headers = { Cookie: sessionCookie(user), 'Content-Type': 'application/json' };
        const created = await request('/api/playlists', {
            method: 'POST', headers, body: JSON.stringify({ name: 'E2E playlist', description: 'Real database' }),
        });
        assert.equal(created.status, 201, await created.clone().text());
        const playlist = await created.json();
        const list = await request('/api/playlists', { headers });
        assert.equal(list.status, 200);
        assert.ok((await list.json()).some(item => item.id === playlist.id && item.role === 'owner'));
        const details = await request(`/api/playlists/${playlist.id}`, { headers });
        assert.equal(details.status, 200);
        assert.equal((await details.json()).members[0].id, user.id);
        const stored = await db.query('SELECT name FROM playlists WHERE id = $1', [playlist.id]);
        assert.equal(stored.rows[0].name, 'E2E playlist');
        assert.equal((await request(`/api/playlists/${playlist.id}`, { method: 'DELETE', headers })).status, 200);
        assert.equal((await db.query('SELECT id FROM playlists WHERE id = $1', [playlist.id])).rowCount, 0);

        const metrics = await fetch(`http://127.0.0.1:${metricsPort}/metrics`, { signal: AbortSignal.timeout(2000) });
        assert.equal(metrics.status, 200);
        assert.match(await metrics.text(), /reblend_playlist_created_total 1/);

        // Graceful shutdown must flush real auto-instrumented spans to OTLP.
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
        try {
            assert.deepEqual(await exit, { code: 0, signal: null }, logs);
        } finally {
            clearTimeout(timer);
        }
        if (mode === 'enabled') {
            assert.ok(batches.length > 0, 'The real telemetry module must export spans');
            assert.ok(batches.every(batch => batch.path === '/v1/traces'));
            const spans = batches.flatMap(batch => JSON.parse(batch.body).resourceSpans ?? [])
                .flatMap(resource => resource.scopeSpans ?? []).flatMap(scope => scope.spans ?? []);
            assert.ok(spans.some(span => span.kind === 2), 'HTTP server auto-instrumentation must run');
            assert.ok(spans.some(span => span.attributes?.some(attr =>
                ['db.system', 'db.system.name'].includes(attr.key) && attr.value?.stringValue === 'postgresql'
            )), 'PostgreSQL auto-instrumentation must run');
        } else {
            assert.equal(batches.length, 0, 'Disabled telemetry must not export spans');
        }
    });
}
