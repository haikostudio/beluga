#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, de l'onglet « Commentaires » d'une
 * carte (`web/src/components/card-panel.tsx`) :
 *
 *  - l'onglet « Commentaires » ne porte AUCUN bouton de lancement
 *    (« Lancer maintenant », « Dès que possible ») : ils tombaient juste sous
 *    le champ de saisie d'une note et se faisaient cliquer par erreur ;
 *  - les mêmes boutons sont TOUJOURS là sur l'onglet « Détails » de la même
 *    carte — c'était la limite de la demande ;
 *  - les notes s'affichent en BULLES, toutes alignées à GAUCHE, aucune à
 *    droite ;
 *  - le champ de saisie accepte un COLLAGE D'IMAGE : la capture collée part
 *    en pièce jointe et s'affiche en attente sous le champ.
 *
 * La carte est INJECTÉE dans le canal temps réel (comme
 * `verif-tiroir-carte-telephone.mjs`) : rien n'est écrit dans la table des
 * cartes. Seuls les commentaires d'essai passent par la base — `comment.list`
 * les lit directement en SQL — et ils sont retirés en partant, avec la
 * session d'une heure.
 *
 *   HAIKO_COMMENTAIRES_URL=http://localhost:7099 node scripts/verif-onglet-commentaires.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* La racine se déduit du script : lancé depuis une copie de travail, il juge CE
   code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_COMMENTAIRES_URL || 'http://localhost:7099';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL. */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

const CARTE = 'essai-onglet-commentaires';

function ouvrirBase() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
}

/** Une session d'une heure (jeton HACHÉ) et deux notes d'essai. */
function poserLeDecor() {
  const db = ouvrirBase();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification onglet commentaires',
  );
  /* `card_comments` référence `cards` : la carte d'essai doit donc EXISTER en
     base le temps du contrôle. Elle n'est pas connue du démon en mémoire, ne
     s'affiche sur aucun tableau, et part avec le reste du décor (la suppression
     en cascade emporte ses notes). */
  db.prepare('DELETE FROM card_comments WHERE card_id = ?').run(CARTE);
  db.prepare('DELETE FROM cards WHERE id = ?').run(CARTE);
  const projet = db.prepare('SELECT id FROM projects LIMIT 1').get();
  if (!projet) throw new Error('aucun projet en base');
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(CARTE, projet.id, 'planned', 1, 'Essai — onglet Commentaires', '{}', maintenant, maintenant);

  const notes = ['Essai — première note', 'Essai — seconde note'];
  notes.forEach((texte, index) => {
    const comment = {
      id: `${CARTE}-${index}`,
      cardId: CARTE,
      projectId: 'essai',
      text: texte,
      attachmentIds: [],
      createdAt: maintenant + index,
    };
    db.prepare(
      'INSERT INTO card_comments (id, card_id, project_id, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(comment.id, CARTE, 'essai', JSON.stringify(comment), comment.createdAt);
  });
  db.close();
  return {
    cookie,
    retirer: () => {
      const base = ouvrirBase();
      base
        .prepare('DELETE FROM sessions WHERE token = ?')
        .run(crypto.createHash('sha256').update(cookie).digest('hex'));
      base.prepare('DELETE FROM card_comments WHERE card_id = ?').run(CARTE);
      base.prepare('DELETE FROM cards WHERE id = ?').run(CARTE);
      base.close();
    },
  };
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const INIT_INJECTION = () => {
  window.__ecouteurs = [];
  const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() {
      return propriete.get.call(this);
    },
    set(ecouteur) {
      window.__ecouteurs.push(ecouteur);
      return propriete.set.call(this, ecouteur);
    },
  });
  window.__injecter = (evenement) => {
    const donnees = JSON.stringify(evenement);
    for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
  };
};

/**
 * LE PROJET QUE LE TABLEAU MONTRE — pas le premier de la colonne de gauche :
 * la rangée surlignée ne se reconnaît pas de façon fiable, alors qu'une carte
 * DÉJÀ AFFICHÉE dit à coup sûr de quel projet le tableau parle.
 */
async function projetDuTableau(page) {
  const premiere = await page.evaluate(() => document.querySelector('[data-carte]')?.getAttribute('data-carte'));
  if (!premiere) throw new Error('aucune carte affichée : impossible de savoir quel projet le tableau montre');
  const db = ouvrirBase();
  const ligne = db.prepare('SELECT project_id FROM cards WHERE id = ?').get(premiere);
  db.close();
  if (!ligne) throw new Error('la carte affichée est introuvable en base');
  return ligne.project_id;
}

/** La carte d'essai, posée en « Planifié » : c'est là que vivent les boutons. */
async function ouvrirCarte(page, projectId) {

  await page.evaluate(
    ([projectId, cardId]) => {
      window.__injecter({
        type: 'card.upsert',
        card: {
          id: cardId,
          projectId,
          title: 'Essai — onglet Commentaires',
          description: 'Carte d’essai pour juger l’onglet Commentaires.',
          labels: [],
          column: 'planned',
          position: -1000,
          origin: 'user',
          run: { engine: 'codex', mode: 'direct' },
          excludedFromDeploy: false,
          horsTache: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    },
    [projectId, CARTE],
  );
  await page.waitForTimeout(700);
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  const colonne = page.locator('[data-column="planned"]').first();
  await colonne.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator(`[data-carte="${CARTE}"]`).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.locator(`[data-carte="${CARTE}"]`).first().click();
  await page.waitForTimeout(900);
}

async function allerA(page, onglet) {
  await page.locator('[role="tab"]', { hasText: onglet }).first().click();
  await page.waitForTimeout(700);
}

/** Le nombre de boutons de lancement visibles dans le tiroir ouvert. */
const boutonsDeLancement = (page) =>
  page.evaluate(() => {
    const tiroir = document.querySelector('[role="dialog"]');
    if (!tiroir) return -1;
    const mots = ['lancer maintenant', 'reprendre', 'dès que possible'];
    return Array.from(tiroir.querySelectorAll('button')).filter((b) =>
      mots.some((mot) => (b.textContent ?? '').toLowerCase().includes(mot)),
    ).length;
  });

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const decor = poserLeDecor();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const erreurs = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: 'haikodev_session',
      value: decor.cookie,
      url: new URL(BASE).origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  await page.addInitScript(INIT_INJECTION);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  page.setDefaultTimeout(8000);

  await ouvrirCarte(page, await projetDuTableau(page));

  /* --- Les boutons restent sur « Détails » --- */
  await allerA(page, 'Détails');
  record('« Détails » garde ses boutons de lancement', (await boutonsDeLancement(page)) >= 2);

  /* --- …et disparaissent sur « Commentaires » --- */
  await allerA(page, 'Commentaires');
  record('« Commentaires » n’en porte aucun', (await boutonsDeLancement(page)) === 0);

  /* --- Des bulles, toutes à gauche --- */
  const bulles = page.locator('[data-bulle-commentaire]');
  await bulles.first().waitFor().catch(() => {});
  const nombre = await bulles.count();
  record('les notes s’affichent en bulles', nombre === 2, `${nombre} bulle(s)`);

  const alignements = await page.evaluate(() => {
    const liste = document.querySelector('[data-bulles-commentaires]');
    if (!liste) return null;
    const gauche = liste.getBoundingClientRect().left;
    return Array.from(liste.querySelectorAll('[data-bulle-commentaire] > div')).map(
      (bulle) => Math.round(bulle.getBoundingClientRect().left - gauche),
    );
  });
  record(
    'toutes les bulles sont collées à GAUCHE, aucune à droite',
    !!alignements && alignements.length > 0 && alignements.every((ecart) => ecart <= 2),
    JSON.stringify(alignements),
  );

  /* --- Coller une image l'attache à la note --- */
  const champ = page.locator('[role="dialog"] textarea').first();
  await champ.click();
  await page.evaluate(() => {
    // Un PNG d'un pixel, tel que le presse-papiers rend une capture : un
    // fichier image SANS nom, que le composant doit baptiser lui-même.
    const octets = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );
    const fichier = new File([octets], '', { type: 'image/png' });
    const transfert = new DataTransfer();
    transfert.items.add(fichier);
    const champ = document.querySelector('[role="dialog"] textarea');
    champ.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfert, bubbles: true }));
  });
  await page.waitForTimeout(2500);
  const enAttente = await page.locator('[data-pieces-en-attente] img, [data-pieces-en-attente] button').count();
  record('une image collée s’ajoute en pièce jointe', enAttente > 0, `${enAttente} élément(s)`);

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await context.close();
  await browser.close();
  decor.retirer();

  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (rates.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
