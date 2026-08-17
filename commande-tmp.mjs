#!/usr/bin/env node
/**
 * Envoie UNE commande au démon en cours, avec une session d'une heure fabriquée
 * puis retirée. Le jeton est aléatoire et n'est gardé que HACHÉ, comme le font
 * les scripts de vérification du projet.
 *
 *   node commande-tmp.mjs '{"type":"deploy.stop","runId":"…"}'
 */
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
import ws from '/root/haikodev/node_modules/ws/index.js';
import crypto from 'node:crypto';

const PORT = Number(process.env.HAIKODEV_PORT || 7070);
const commande = JSON.parse(process.argv[2]);
const attendre = Number(process.env.ATTENDRE_MS || 4000);

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const db = new Database('/root/haikodev/data/haikodev.db');
const maintenant = Date.now();
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  sha(jeton),
  maintenant,
  maintenant + 3600_000,
  'commande ponctuelle (dépannage)',
);

const recus = [];
const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
  headers: { Cookie: `haikodev_session=${jeton}` },
});

const finir = (code) => {
  try {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
  } catch {}
  try {
    prise.close();
  } catch {}
  console.log(JSON.stringify(recus, null, 2).slice(0, 4000));
  process.exit(code);
};

/*
 * On n'envoie qu'après `ready` : le serveur n'attache son écoute des messages
 * qu'une fois son premier envoi lancé, et une commande postée dès l'ouverture
 * se perd sans un mot.
 */
let envoye = false;
prise.on('message', (donnee) => {
  const message = JSON.parse(String(donnee));
  if (message.type === 'ready' && !envoye) {
    envoye = true;
    prise.send(JSON.stringify({ id: 'depannage-1', cmd: commande }));
    setTimeout(() => finir(0), attendre);
    return;
  }
  // On ne garde que ce qui répond à la commande : le reste est du bruit d'état.
  if (['deploy.upsert', 'error', 'ack', 'toast'].includes(message.type)) {
    recus.push(
      message.type === 'deploy.upsert'
        ? { type: message.type, run: { id: message.run?.id, state: message.run?.state, currentStep: message.run?.currentStep } }
        : message,
    );
  }
});
prise.on('error', (e) => {
  console.error('ERREUR', e.message);
  finir(1);
});
