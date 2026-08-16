#!/usr/bin/env node
/**
 * LA FENÊTRE DE CRÉATION D'UNE NOTE RÉPOND AU CLIC EN ENTIER — pas seulement
 * son titre. Vérifié dans un VRAI navigateur, sur son PROPRE démon (base neuve,
 * dossier de projets vide, port libre : le démon de production n'est pas
 * touché, aucun moteur appelé, aucun quota dépensé).
 *
 * Le défaut corrigé : la fenêtre est posée en `absolute` DANS l'entête de
 * colonne, qui porte `isolate` — son `z-index` restait donc enfermé dans le
 * plan d'empilement de l'entête et ne se comparait jamais à celui de la zone
 * qui défile, laquelle vient APRÈS dans le DOM et se peignait par-dessus tout
 * ce qui dépasse sous l'entête. Seul le titre recevait encore les clics.
 *
 * On contrôle donc, au TÉLÉPHONE comme à l'ORDINATEUR, que le point central de
 * chaque élément de la fenêtre (titre, description, « Ajouter la note »,
 * « Joindre », « Annuler ») appartient bien à la fenêtre — puis que la note se
 * crée réellement d'un clic, et qu'« Annuler » referme.
 *
 *   node scripts/verif-fenetre-note.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKODEV_NOTE_PORT || 7203);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-note-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
for (const dossier of [DATA, PROJETS, DEPOT]) fs.mkdirSync(dossier, { recursive: true });

execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], {
  cwd: DEPOT,
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HAIKODEV_PORT: String(PORT),
    HAIKODEV_HOST: '127.0.0.1',
    HAIKODEV_DATA: DATA,
    HAIKODEV_PROJECTS_ROOT: PROJETS,
    HAIKODEV_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

const ranger = () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', ranger);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    ranger();
    process.exit(130);
  });
}

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'haikodev.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      db.close();
      if (table) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-note';

function poserLeProjet() {
  const db = new Database(path.join(DATA, 'haikodev.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification de la fenêtre de note',
  );

  // Aucun agent ne doit pouvoir démarrer : rien ici n'appelle un moteur.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Projet à notes',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  /*
   * Des cartes DANS la colonne qui défile, sous l'entête : c'est justement ce
   * contenu qui, faute de fix, se peignait par-dessus la fenêtre. Une colonne
   * vide masquerait le défaut.
   */
  const poser = db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, description, data, created_at, updated_at)
     VALUES (?, ?, 'notes', ?, ?, ?, '{}', ?, ?)`,
  );
  db.transaction(() => {
    for (let i = 0; i < 6; i += 1) {
      poser.run(`c-note-${i}`, PROJET_ID, i, `Note existante ${i}`, 'Idée en vrac', maintenant, maintenant);
    }
  })();
  db.close();
}

async function ouvrir(navigateur, viewport) {
  const contexte = await navigateur.newContext({
    viewport,
    locale: 'fr-CH',
    serviceWorkers: 'block',
    hasTouch: viewport.width < 700,
    isMobile: viewport.width < 700,
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-column="notes"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { page, erreurs };
}

/**
 * Pour chaque élément de la fenêtre : ce que le navigateur trouve RÉELLEMENT
 * sous le point central. C'est la seule mesure qui dit si un clic arrive.
 */
const qui = (page) =>
  page.evaluate(() => {
    const fenetre = document.querySelector('[data-composer-ouvert="notes"]');
    if (!fenetre) return { fenetre: false, elements: [] };
    const cibles = [
      ['titre', fenetre.querySelector('input:not([type="file"])')],
      ['description', fenetre.querySelector('textarea')],
      ...Array.from(fenetre.querySelectorAll('button')).map((b) => [
        (b.textContent || '').trim() || 'bouton sans texte',
        b,
      ]),
    ];
    return {
      fenetre: true,
      elements: cibles.map(([nom, noeud]) => {
        if (!noeud) return { nom, present: false, atteint: false };
        const r = noeud.getBoundingClientRect();
        const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          nom,
          present: true,
          // Atteint si le point central appartient à la fenêtre : le nœud
          // lui-même, ou l'un de ses enfants (l'icône dans un bouton).
          atteint: !!dessus && (noeud.contains(dessus) || dessus === noeud),
          dessus: dessus ? `${dessus.tagName.toLowerCase()}.${dessus.className}`.slice(0, 90) : 'rien',
        };
      }),
    };
  });

async function ouvrirLaFenetre(page) {
  await page.click('[data-column="notes"] [aria-label="Nouvelle note"]');
  await page.waitForSelector('[data-composer-ouvert="notes"]', { timeout: 5000 });
  await page.waitForTimeout(300);
}

async function passe(navigateur, viewport, etiquette) {
  const { page, erreurs } = await ouvrir(navigateur, viewport);
  try {
    await ouvrirLaFenetre(page);

    /*
     * Le titre est rempli AVANT de mesurer : « Ajouter la note » reste
     * désactivé tant qu'il est vide, et un bouton désactivé ne reçoit aucun
     * clic — c'est voulu, pas le défaut cherché ici.
     */
    await page.fill('[data-composer-ouvert="notes"] input:not([type="file"])', 'Titre de contrôle');
    await page.waitForTimeout(200);

    const vu = await qui(page);
    noter(`${etiquette} · la fenêtre s'ouvre`, vu.fenetre);

    const manquants = vu.elements.filter((e) => !e.present).map((e) => e.nom);
    noter(
      `${etiquette} · la fenêtre porte titre, description et ses trois boutons`,
      vu.elements.length >= 5 && manquants.length === 0,
      `${vu.elements.length} élément(s)${manquants.length ? `, absents : ${manquants.join(', ')}` : ''}`,
    );

    const bloques = vu.elements.filter((e) => e.present && !e.atteint);
    noter(
      `${etiquette} · CHAQUE élément de la fenêtre reçoit le clic`,
      bloques.length === 0,
      bloques.length
        ? bloques.map((e) => `« ${e.nom} » recouvert par ${e.dessus}`).join(' ; ')
        : vu.elements.map((e) => e.nom).join(', '),
    );

    // Le parcours réel : on écrit, on clique « Ajouter la note », la note est là.
    const titre = `Note posée au clic ${etiquette}`;
    await page.fill('[data-composer-ouvert="notes"] input:not([type="file"])', titre);
    await page.fill('[data-composer-ouvert="notes"] textarea', 'Description écrite au clavier.');
    const decrit = await page.inputValue('[data-composer-ouvert="notes"] textarea');
    noter(`${etiquette} · le champ description accepte la saisie`, decrit.length > 0, decrit);

    await page.click('[data-composer-ouvert="notes"] button:has-text("Ajouter la note")');
    await page.waitForTimeout(1500);
    const posee = await page.evaluate(
      (t) =>
        Array.from(document.querySelectorAll('[data-column="notes"] [data-carte]')).some((n) =>
          (n.textContent || '').includes(t),
        ),
      titre,
    );
    noter(`${etiquette} · « Ajouter la note » crée bien la note`, posee, titre);

    // Et « Annuler » referme la fenêtre : on n'y reste jamais bloqué.
    await ouvrirLaFenetre(page);
    await page.click('[data-composer-ouvert="notes"] button:has-text("Annuler")');
    await page.waitForTimeout(400);
    const fermee = await page.evaluate(() => !document.querySelector('[data-composer-ouvert="notes"]'));
    noter(`${etiquette} · « Annuler » referme la fenêtre`, fermee);

    noter(`${etiquette} · aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
  } finally {
    await page.context().close();
  }
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  if (!(await attendreLaBase())) {
    console.error(`La base d’essai est restée vide : le port ${PORT} est peut-être déjà pris.`);
    process.exit(1);
  }
  poserLeProjet();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    await passe(navigateur, { width: 1400, height: 900 }, 'ordinateur');
    await passe(navigateur, { width: 390, height: 844 }, 'téléphone');
  } finally {
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log('');
  console.log(`${resultats.length - echecs.length}/${resultats.length} contrôle(s) au vert.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
