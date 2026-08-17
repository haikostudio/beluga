import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import ws from '/root/haikodev/node_modules/ws/index.js';
import crypto from 'node:crypto';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const db = new Database('/root/haikodev/data/haikodev.db');
const n = Date.now();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), n, n + 3600_000, 'debug');
const p = new ws.WebSocket('ws://127.0.0.1:7070/ws', { headers: { Cookie: `haikodev_session=${jeton}` } });
let envoye = false;
p.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.type === 'ready' && !envoye) {
    envoye = true;
    console.log('>>> envoi deploy.stop');
    p.send(JSON.stringify({ id: 'x', cmd: { type: 'deploy.stop', runId: 'd4a2f7c8-31a8-4e50-a37a-fe7cbea20bcc' } }));
    return;
  }
  if (envoye) console.log('APRÈS ENVOI:', m.type, JSON.stringify(m).slice(0, 400));
});
p.on('error', (e) => console.log('ERREUR:', e.message));
setTimeout(() => { db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)); process.exit(0); }, 8000);
