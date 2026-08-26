#!/usr/bin/env node
/**
 * L'HEURE, LE SÉPARATEUR DE DATE ET LES JETONS SOUS LES MESSAGES — dans un vrai
 * navigateur, sur un fil RÉEL.
 *
 * Trois promesses qu'une relecture ne peut pas tenir :
 *
 *  1. CHAQUE bulle porte son heure, des deux côtés du fil, même quand la bulle
 *     suivante a été écrite dans la même minute (c'est exactement le cas qui
 *     l'avait fait disparaître sous les demandes de l'utilisateur) ;
 *  2. un CHANGEMENT DE JOUR pose un séparateur pleine largeur, la date centrée
 *     dessus — « Aujourd'hui », « Hier », ou la date écrite ;
 *  3. les JETONS d'un message se lisent sous sa bulle, demande comme réponse,
 *     et un message sans mesure n'affiche pas un faux « 0 ».
 *
 * Les messages sont posés EN BASE, sur le chef d'orchestre d'un projet d'essai
 * jetable : aucun moteur n'est appelé, aucun quota n'est dépensé. La session
 * d'une heure est fabriquée puis retirée, le projet et ses messages sont
 * effacés en partant.
 *
 *   HAIKO_MESSAGES_URL=http://localhost:7099 node scripts/verif-heure-jetons-messages.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée, ni
 * HAIKODEV_TOKEN, qui est le jeton d'un agent.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const BASE = process.env.HAIKO_MESSAGES_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';
fs.mkdirSync(SHOTS, { recursive: true });

const db = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

const jeton = crypto.randomBytes(32).toString('base64url');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  sha(jeton),
  Date.now(),
  Date.now() + 3600_000,
  'vérification heure et jetons',
);

const dossier = fs.mkdtempSync('/tmp/heure-messages-');
const projetId = crypto.randomUUID();
const maintenant = Date.now();
const projet = {
  id: projetId,
  name: 'Essai — heure et jetons',
  path: dossier,
  defaultEngine: 'claude',
  isSelf: false,
  miseEnProduction: {},
  archived: false,
  createdAt: maintenant,
  updatedAt: maintenant,
};
db.prepare(
  'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const nettoyer = () => {
  try {
    for (const agent of db.prepare('SELECT id FROM agents WHERE project_id = ?').all(projetId)) {
      db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agent.id);
      db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agent.id);
    }
    db.prepare('DELETE FROM agents WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM cards WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projetId);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
  } catch (err) {
    console.error('ménage : ', err);
  }
  fs.rmSync(dossier, { recursive: true, force: true });
};
process.on('exit', nettoyer);

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
await contexte.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));

await page.goto(`${BASE}/#projet/${projetId}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea[placeholder="Écrivez votre demande…"]', { timeout: 20000 });

/* Le chef d'orchestre du projet d'essai naît à l'ouverture de la conversation :
   son identifiant se lit en base, l'interface ne le porte nulle part. */
let agentId = null;
for (let essai = 0; essai < 40 && !agentId; essai += 1) {
  agentId =
    db.prepare("SELECT id FROM agents WHERE project_id = ? AND role = 'cadrage' LIMIT 1").get(projetId)?.id ??
    null;
  if (!agentId) await page.waitForTimeout(500);
}
if (!agentId) {
  noter('le chef d’orchestre du projet d’essai existe', false, 'aucun agent en base');
  await navigateur.close();
  process.exit(1);
}

/*
 * TROIS MESSAGES, DEUX JOURS. La demande d'HIER et sa réponse sont écrites dans
 * la MÊME MINUTE : c'est le cas qui effaçait l'heure sous la demande. Le dernier
 * message est d'aujourd'hui, et n'a AUCUNE mesure de jetons — il doit rester
 * muet là-dessus plutôt que d'afficher un zéro.
 */
const hier = new Date(maintenant);
hier.setDate(hier.getDate() - 1);
hier.setHours(8, 43, 0, 0);
const hierMs = hier.getTime();

const poser = (role, contenu, createdAt, tokens) => {
  const id = `essai-${crypto.randomUUID()}`;
  const message = {
    id,
    agentId,
    role,
    content: contenu,
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: false,
    plan: false,
    tokens,
    createdAt,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    agentId,
    role,
    JSON.stringify(message),
    createdAt,
  );
  return id;
};

poser('user', 'Une demande écrite hier matin.', hierMs, 12_480);
poser('assistant', 'La réponse, écrite dans la même minute.', hierMs + 20_000, 34_900);
poser('user', 'Une demande d’aujourd’hui, sans mesure.', maintenant - 5 * 60_000, undefined);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-heure-message]', { timeout: 20000 });
await page.waitForTimeout(600);

/* L'application monte deux conversations — grand écran et téléphone —, dont une
   seule occupe des pixels : on ne juge QUE ce qui se voit vraiment. */
const vu = await page.evaluate(() => {
  const visible = (n) => n.getBoundingClientRect().height > 0;
  const heures = Array.from(document.querySelectorAll('[data-heure-message]'))
    .filter(visible)
    .map((n) => ({ texte: (n.textContent ?? '').trim(), infobulle: n.getAttribute('title') ?? '' }));
  const jetons = Array.from(document.querySelectorAll('[data-jetons-message]'))
    .filter(visible)
    .map((n) => (n.textContent ?? '').trim());
  const separateurs = Array.from(document.querySelectorAll('[data-separateur-jour]'))
    .filter(visible)
    .map((n) => {
      const r = n.getBoundingClientRect();
      const traits = Array.from(n.querySelectorAll('span[aria-hidden]')).map((t) => t.getBoundingClientRect().width);
      const mot = Array.from(n.querySelectorAll('span:not([aria-hidden])')).map((t) => (t.textContent ?? '').trim());
      return { largeur: r.width, traits, mot: mot[0] ?? '', gauche: r.x };
    });
  const fil = document.querySelector('[data-separateur-jour]')?.parentElement?.getBoundingClientRect();
  return { heures, jetons, separateurs, largeurFil: fil?.width ?? 0 };
});

noter(
  'chaque bulle du fil porte son heure, même écrite dans la même minute que la suivante',
  vu.heures.length >= 3,
  `${vu.heures.length} heure(s) visible(s)`,
);

noter(
  'l’heure reste courte, jamais une phrase',
  vu.heures.every((h) => h.texte.length > 0 && h.texte.length <= 20),
  vu.heures.map((h) => h.texte).join(' | '),
);

noter(
  'un message récent se dit en minutes écoulées',
  vu.heures.some((h) => /il y a \d+ min/.test(h.texte)),
  vu.heures.map((h) => h.texte).join(' | '),
);

noter(
  'un message de la veille porte sa date ET son heure',
  // Le séparateur de date suit le format régional : « 18.08.26 » en fr-CH,
  // « 08/18/26 » en anglais. On juge la FORME, pas le signe qui sépare.
  vu.heures.some((h) => /\d{2}[./-]\d{2}[./-]\d{2}\s+\d{1,2}:\d{2}/.test(h.texte)),
  vu.heures.map((h) => h.texte).join(' | '),
);

noter(
  'l’heure exacte reste en infobulle',
  vu.heures.every((h) => /\d{4}/.test(h.infobulle) && /\d{2}:\d{2}/.test(h.infobulle)),
  vu.heures[0]?.infobulle ?? '',
);

noter(
  'deux jours différents posent un séparateur de date, pas un de plus',
  vu.separateurs.length === 2,
  `${vu.separateurs.length} séparateur(s)`,
);

noter(
  'le séparateur traverse toute la largeur du fil, la date au milieu',
  vu.separateurs.length === 2 &&
    vu.separateurs.every(
      (s) => s.largeur > vu.largeurFil * 0.9 && s.traits.length === 2 && s.traits.every((t) => t > 20),
    ),
  vu.separateurs.map((s) => `${Math.round(s.largeur)}px`).join(' | '),
);

noter(
  'la date du jour se dit « Aujourd’hui » et la veille « Hier »',
  vu.separateurs.map((s) => s.mot).includes('Hier') &&
    vu.separateurs.map((s) => s.mot).some((m) => m.startsWith('Aujourd')),
  vu.separateurs.map((s) => s.mot).join(' | '),
);

noter(
  'les jetons se lisent sous les messages mesurés, demande comme réponse',
  vu.jetons.length === 2 && vu.jetons.every((j) => /jetons/.test(j)),
  vu.jetons.join(' | '),
);

noter(
  'un message sans mesure n’affiche aucun jeton, jamais un faux zéro',
  !vu.jetons.some((j) => /\b0\s+jetons/.test(j)),
  vu.jetons.join(' | '),
);

await page.screenshot({ path: `${SHOTS}/heure-jetons-messages.png` });

noter('aucune erreur de page pendant l’essai', erreurs.length === 0, erreurs[0] ?? '');

await navigateur.close();

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
