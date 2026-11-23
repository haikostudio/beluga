#!/usr/bin/env node
/**
 * LES FICHIERS JOINTS ET LE BROUILLON APPARTIENNENT À L'AGENT, PAS À
 * L'APPLICATION.
 *
 * Avant cette règle, la liste des pièces jointes en attente dans le composeur
 * était un simple état local du composant : elle ne se rechargeait ni ne se
 * vidait quand on changeait de projet ou de conversation. Joindre un fichier
 * dans une conversation, puis en ouvrir une AUTRE, faisait réapparaître le
 * même fichier — prêt à partir au mauvais agent.
 *
 * Quatre constats, dans un vrai navigateur, SANS JAMAIS RECHARGER LA PAGE (un
 * rechargement viderait l'état local et ne prouverait rien) :
 *  1. un fichier joint à la conversation d'une carte du projet A écrit son tag ;
 *  2. ouvrir la conversation d'une carte du projet B ne montre AUCUNE de ces
 *     pièces jointes, ni dans le champ ni dans la barre ;
 *  3. revenir à la carte de A retrouve le fichier ET son tag, intacts ;
 *  4. ces ouvertures n'ont renvoyé au serveur AUCUNE liste de pièces : une
 *     liste seulement lue ne se réécrit pas (`draftAttachments.`, 11/10/2026).
 *
 * LA CONVERSATION PERMANENTE DU « CHEF » N'EXISTE PLUS, et la colonne de
 * gauche ne liste les projets que sur les tableaux de bord : les deux
 * conversations sont donc celles de deux CARTES, et l'on passe de l'une à
 * l'autre par leur ADRESSE (`#projet/<id>/tache/<id>`), comme le fait
 * « Précédent » — la page ne se recharge pas. Une pièce ne montre à l'écran
 * que son alias (« #1a0c ») ; le tag enregistré cite le nom et l'alias.
 *
 * DÉMON JETABLE (base neuve, dossier temporaire, aucun quota) : ce contrôle
 * dépose un fichier et enregistre un brouillon. Il ne se lance JAMAIS contre
 * une interface branchée sur le démon en service. Depuis la copie de travail
 * de la carte, jamais depuis le dépôt principal :
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-jointes-suivent-agent.mjs
 *
 * Pour juger le code SOURCE : une interface de développement à soi, branchée
 * sur CE démon (`BELUGA_DEMON_PORT=<port>`), et son adresse dans
 * `BELUGA_VERIF_URL`. La base reste celle du démon d'essai.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { creerResultats } from './lib/verif-resultats.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7243);
const BASE = process.env.BELUGA_VERIF_URL || `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-jointes-agent-', port: PORT });

/* Le champ masque ses tags (entre ⁢ et ⁣) et n'en laisse lire que
   l'alias de la pièce : on démasque avant toute comparaison. */
const lisible = (valeur) =>
  (valeur || '')
    .replace(/⁢[^⁢⁣\n]*⁣/g, (brut) => `[fichier: ${brut.slice(1, -1).replace(/[⁠   ]/g, '')}]`)
    .replace(/ /g, ' ');
const aliasDuTag = (texte) => texte.match(/\[fichier: (#[0-9a-z]{4,})\]/i)?.[1] ?? null;

const { results, record } = creerResultats();

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const NOM_JOINT = 'notes-agent.txt';
const A = { projet: 'p-jointes-a', nom: 'Projet A', carte: 'c-jointes-a', titre: 'Carte de A', agent: 'ag-jointes-a' };
const B = { projet: 'p-jointes-b', nom: 'Projet B', carte: 'c-jointes-b', titre: 'Carte de B', agent: 'ag-jointes-b' };

/** Le décor : une session d'une heure (jeton HACHÉ), deux projets, une carte et sa conversation chacun. */
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3600_000, 'vérification pièces jointes par agent');
  db.prepare('DELETE FROM projects').run();
  [A, B].forEach((lieu, rang) => {
    const p = { id: lieu.projet, name: lieu.nom, path: `${DEPOT}-${lieu.projet}`, defaultEngine: 'claude', isSelf: false, rank: rang + 1, archived: false, createdAt: t, updatedAt: t };
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(p.id, p.name, p.path, JSON.stringify(p), t, t);
    const c = {
      id: lieu.carte, projectId: lieu.projet, title: lieu.titre, description: 'Une carte pour écrire.', labels: [], column: 'planned', position: 1,
      origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: t - 3600_000, updatedAt: t - 3600_000,
    };
    db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      c.id, c.projectId, c.column, 1, c.title, JSON.stringify(c), null, c.createdAt, c.updatedAt,
    );
    const a = { id: lieu.agent, projectId: lieu.projet, cardId: lieu.carte, role: 'cadrage', title: 'Cadrage', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: t - 3600_000, updatedAt: t - 3600_000 };
    db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)`).run(
      a.id, a.projectId, a.cardId, a.role, JSON.stringify(a), a.createdAt, a.updatedAt,
    );
  });
  db.close();
}

async function champVisible(page) {
  const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
  const zone = barre.locator('textarea').last();
  await zone.waitFor({ state: 'visible', timeout: 20000 });
  return { barre, zone };
}

/**
 * Ouvre la conversation d'une carte PAR SON ADRESSE, sans recharger la page :
 * seul le fragment change, l'application suit — exactement ce que fait
 * « Précédent ». On attend que la page affichée soit bien celle de CETTE carte.
 */
async function ouvrirLaConversation(page, lieu) {
  await page.evaluate((fragment) => {
    window.location.hash = fragment;
  }, `#projet/${lieu.projet}/tache/${lieu.carte}`);
  await page.waitForFunction(
    (titre) => [...document.querySelectorAll('[data-page-de-zone]')].some((p) => (p.textContent ?? '').includes(titre)),
    lieu.titre,
    { timeout: 20000 },
  );
  await page.waitForTimeout(1200);
  return champVisible(page);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  /* Ce que le champ ENREGISTRE vraiment : les réglages partis au serveur. */
  const reglages = [];
  page.on('websocket', (canal) => {
    canal.on('framesent', ({ payload }) => {
      try {
        const trame = JSON.parse(String(payload));
        if (trame?.cmd?.type === 'prefs.set') reglages.push({ cle: String(trame.cmd.key ?? ''), valeur: trame.cmd.value });
      } catch {
        /* un battement, pas une commande */
      }
    });
  });

  try {
    await page.goto(`${BASE}/#projet/${A.projet}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator(`[data-carte="${A.carte}"]`).first().waitFor({ state: 'visible', timeout: 30000 });
    /* LE TÉMOIN DE LA PAGE : posé maintenant, relu à la fin. S'il a disparu,
       la page s'est rechargée en route et les constats ne prouvent plus rien. */
    await page.evaluate(() => {
      window.__memePage = true;
    });

    const { barre, zone } = await ouvrirLaConversation(page, A);
    // On part d'un champ propre.
    await zone.fill('');
    await page.waitForTimeout(400);

    await barre.locator('input[data-composer-file]').setInputFiles({
      name: NOM_JOINT,
      mimeType: 'text/plain',
      buffer: Buffer.from(`Contrôle pièce jointe par agent — ${crypto.randomBytes(12).toString('hex')}\n`),
    });
    await page.waitForFunction((el) => /#[0-9a-z]{4}/i.test(el.value), await zone.elementHandle(), { timeout: 45000 }).catch(() => {});
    // Le temps que la persistance (débounce 600 ms) parte vers le serveur.
    await page.waitForTimeout(1500);
    const alias = aliasDuTag(lisible(await zone.inputValue()));
    const brouillonDeA = String(reglages.filter((r) => r.cle === `draft.${A.agent}`).at(-1)?.valeur ?? '').replace(/ /g, ' ');
    record(
      `Le fichier joint à la conversation de « ${A.titre} » écrit son tag`,
      !!alias && brouillonDeA.includes(`[fichier: ${NOM_JOINT} ${alias}]`) && (await barre.locator(`[data-piece-etiquette="${alias}"]`).count()) === 1,
      `champ : ${alias ?? 'aucun tag'} · brouillon : ${JSON.stringify(brouillonDeA).slice(0, 70)}`,
    );
    const piecesPosees = reglages.filter((r) => r.cle === `draftAttachments.${A.agent}` && (r.valeur?.length ?? 0) === 1).length;
    const depuis = reglages.length;

    const chezB = await ouvrirLaConversation(page, B);
    const texteChezB = lisible(await chezB.zone.inputValue());
    record(
      `La conversation de « ${B.titre} » ne voit AUCUNE pièce jointe de « ${A.titre} »`,
      !texteChezB.includes('[fichier:') && !texteChezB.includes(NOM_JOINT) && (!alias || !texteChezB.includes(alias)),
      `champ : ${JSON.stringify(texteChezB).slice(0, 80)}`,
    );
    record(
      `Aucune pastille de pièce jointe visible chez « ${B.titre} »`,
      (await chezB.barre.locator('[data-piece-etiquette]').count()) === 0 && (await chezB.barre.locator('button[title="Retirer ce fichier"]').count()) === 0,
      `${await chezB.barre.locator('[data-piece-etiquette]').count()} pastille(s)`,
    );

    const chezA = await ouvrirLaConversation(page, A);
    const texteChezA = lisible(await chezA.zone.inputValue());
    record(
      `De retour chez « ${A.titre} », le tag du fichier est toujours là, avec sa pièce`,
      !!alias && texteChezA.includes(`[fichier: ${alias}]`) && (await chezA.barre.locator(`[data-piece-etiquette="${alias}"]`).count()) === 1,
      `champ : ${JSON.stringify(texteChezA).slice(0, 80)}`,
    );

    /* UNE LISTE SEULEMENT LUE NE SE RÉÉCRIT PAS : depuis le dépôt du fichier,
       personne n'a touché une pièce — aucun réglage `draftAttachments.` ne
       doit être reparti, ni pour A ni pour B. */
    await page.waitForTimeout(1500);
    const reparties = reglages.slice(depuis).filter((r) => r.cle.startsWith('draftAttachments.'));
    record(
      'Ouvrir une conversation puis en revenir ne renvoie aucune liste de pièces au serveur',
      piecesPosees >= 1 && reparties.length === 0,
      `posée par le dépôt : ${piecesPosees} · reparties sans geste : ${reparties.map((r) => r.cle).join(', ') || 'aucune'}`,
    );
    record(
      'La page ne s’est jamais rechargée : c’est bien le même écran qui a changé de conversation',
      (await page.evaluate(() => window.__memePage === true)) === true,
    );

    // On efface ce qu'on a posé, pour ne rien laisser traîner.
    await chezA.zone.fill('');
    await page.waitForTimeout(1200);

    record('Aucune erreur de page pendant le contrôle', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }

  const ratés = results.filter((r) => !r.ok);
  console.log(`\n${results.length - ratés.length}/${results.length} constats tenus — dépôt ${RACINE}`);
  process.exit(ratés.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.slice(-10).join(''));
  process.exit(1);
});
