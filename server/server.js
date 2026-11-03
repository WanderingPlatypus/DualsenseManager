// PadBench server: stores the controller database (SQLite) and serves the web app.
// Zero npm dependencies — needs Node.js 22.13 or newer (built-in node:sqlite).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mergeRecords, sameRecord } from '../web/js/merge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8080);
const HTTPS_PORT = +(process.env.HTTPS_PORT || 8443);
const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const WEB_DIR = process.env.WEB_DIR || path.resolve(here, '../web');
const TOKEN = process.env.PADBENCH_TOKEN || '';
const MAX_BODY = 200 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'padbench.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS controllers (
    serial TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS controllers_seq ON controllers(seq);
`);
const qGet = db.prepare('SELECT data FROM controllers WHERE serial = ?');
const qPut = db.prepare(`INSERT INTO controllers (serial, data, updated_at, seq) VALUES (?, ?, ?, ?)
  ON CONFLICT(serial) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, seq = excluded.seq`);
const qSince = db.prepare('SELECT data FROM controllers WHERE seq > ? ORDER BY seq');
const qMaxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM controllers');
const qAll = db.prepare('SELECT data FROM controllers ORDER BY serial');
const qCount = db.prepare('SELECT COUNT(*) AS n FROM controllers');

function applyChanges(changes) {
  let seq = qMaxSeq.get().s;
  db.exec('BEGIN');
  try {
    for (const inc of changes) {
      if (!inc || typeof inc.serial !== 'string' || !inc.serial.trim()) continue;
      const row = qGet.get(inc.serial);
      const cur = row ? JSON.parse(row.data) : null;
      const merged = mergeRecords(cur, inc);
      if (cur && sameRecord(cur, merged)) continue;
      qPut.run(merged.serial, JSON.stringify(merged), merged.updatedAt || Date.now(), ++seq);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Daily JSON snapshot, keeps the last 14.
function backup() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `padbench-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(qAll.all().map((r) => JSON.parse(r.data))));
  const old = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().slice(0, -14);
  old.forEach((f) => fs.unlinkSync(path.join(dir, f)));
}
setTimeout(backup, 60_000);
setInterval(backup, 24 * 3600_000);

// List of web app files with checksums, so the Windows app can update itself from this server.
function appManifest() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files.push({ path: path.relative(WEB_DIR, full).split(path.sep).join('/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
    }
  };
  walk(WEB_DIR);
  let version = '0';
  try { version = JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'version.json'), 'utf8')).version; } catch { /* none */ }
  return { version, files };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, x-padbench-token');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://x');

  if (url.pathname.startsWith('/api/')) {
    if (TOKEN && req.headers['x-padbench-token'] !== TOKEN && url.searchParams.get('token') !== TOKEN) return send(res, 401, { error: 'unauthorized' });
    try {
      if (url.pathname === '/api/health') return send(res, 200, { ok: true, app: 'padbench', version: appManifest().version, controllers: qCount.get().n, seq: qMaxSeq.get().s, time: Date.now() });
      if (url.pathname === '/api/sync' && req.method === 'POST') {
        const { since = 0, changes = [] } = JSON.parse(await readBody(req) || '{}');
        if (Array.isArray(changes) && changes.length) applyChanges(changes);
        const out = qSince.all(+since || 0).map((r) => JSON.parse(r.data));
        return send(res, 200, { seq: qMaxSeq.get().s, changes: out });
      }
      if (url.pathname === '/api/app-manifest') return send(res, 200, appManifest());
      if (url.pathname === '/api/export.json') {
        res.setHeader('content-disposition', 'attachment; filename="padbench-export.json"');
        return send(res, 200, qAll.all().map((r) => JSON.parse(r.data)));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      console.error(e);
      return send(res, 400, { error: String(e.message || e) });
    }
  }

  // Static web app
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(WEB_DIR, p));
  if (!file.startsWith(WEB_DIR)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

http.createServer(handle).listen(PORT, () => console.log(`PadBench http://0.0.0.0:${PORT}  (data: ${DATA_DIR})`));

const cert = path.join(DATA_DIR, 'cert.pem'), key = path.join(DATA_DIR, 'key.pem');
if (fs.existsSync(cert) && fs.existsSync(key)) {
  https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, handle)
    .listen(HTTPS_PORT, () => console.log(`PadBench https://0.0.0.0:${HTTPS_PORT}  (WebHID works in Chrome/Edge here)`));
}
