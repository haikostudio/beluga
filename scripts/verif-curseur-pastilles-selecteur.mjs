#!/usr/bin/env node
/**
 * LE CURSEUR DU CHAMP, LES PASTILLES DE L'ENTÊTE, LE TIROIR DES PROJETS.
 *
 * Trois choses, dans un vrai navigateur, à 1280 px comme à 390 px :
 *
 *  1. LE CURSEUR NE SAUTE PLUS À LA FIN. Le brouillon et ses pièces jointes
 *     sont deux réglages (`draft.<agent>`, `draftAttachments.<agent>`), envoyés
 *     l'un après l'autre ; le serveur répond à CHACUN par le bloc ENTIER des
 *     réglages. La réponse au premier ne connaît pas encore le second : elle
 *     défaisait à l'écran ce qu'on venait d'écrire, puis la suivante le
 *     refaisait — deux réécritures du champ, et le curseur finissait au bout
 *     du texte. On joint une image, on pose le curseur au milieu, on attend
 *     trois secondes : il n'a pas bougé. Idem après une frappe au milieu.
 *     ET OUVRIR UNE CONVERSATION NE RÉÉCRIT RIEN (11/10/2026) : ni la liste
 *     des pièces en attente ni le TEXTE du brouillon, seulement LUS, ne
 *     repartent au serveur — aucune trame `prefs.set` ne vise
 *     `draftAttachments.` ni `draft.<agent>` sans geste ; une frappe, elle,
 *     enregistre bien le texte.
 *  2. LES PASTILLES DE COIN DES BOUTONS ont toutes la place et la taille de
 *     celle de la cloche : 8 px, à cheval sur le coin haut droit du bouton
 *     (2 px dehors), jamais rognées. Depuis la refonte, la cloche et le point
 *     du bouton des SERVICES (quelque chose attend) sont dans la barre
 *     d'en-tête, et le point de redémarrage a suivi le bouton des réglages au
 *     PIED DE LA COLONNE DE GAUCHE (dans son panneau sur téléphone) ; l'état
 *     des moteurs n'est une pastille de coin que colonne RÉDUITE — dépliée,
 *     c'est un point en ligne de « LLM en ligne ».
 *  3. LE NOM EN HAUT OUVRE LE TIROIR DES PROJETS : recherche, « Tableaux de
 *     bord » en tête, les projets de la colonne de gauche dans son ordre avec
 *     leur icône, sans les projets mis de côté ; le projet ouvert y est marqué ;
 *     choisir un projet l'ouvre et referme le tiroir.
 *
 * Démon JETABLE (base neuve, aucun quota) : à lancer depuis la copie de travail
 * de la carte, jamais depuis le dépôt principal. Construire avant :
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-curseur-pastilles-selecteur.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-curseur-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;

function projet(db, id, name, rank, extra = {}) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, name, p.path, p.archived ? 1 : 0, JSON.stringify(p), MAINTENANT, MAINTENANT,
  );
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification curseur');
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM project_groups').run();
  // L'ordre de la colonne de gauche : Bêta (1), Alpha (2), le groupe « Clients »
  // (3) et son membre Gamma, puis Élodie (4). « Rangé » est mis de côté.
  db.prepare('INSERT INTO project_groups (id, name, rank, collapsed, color, created_at) VALUES (?, ?, ?, 0, ?, ?)').run('g-clients', 'Clients', 3, null, MAINTENANT);
  projet(db, 'p-alpha', 'Alpha', 2);
  projet(db, 'p-beta', 'Bêta', 1);
  projet(db, 'p-gamma', 'Gamma', 1, { groupId: 'g-clients' });
  projet(db, 'p-elodie', 'Élodie', 4);
  projet(db, 'p-range', 'Rangé', 5, { archived: true });
  const c = {
    id: 'c-champ', projectId: 'p-alpha', title: 'Carte du champ', description: 'Une carte pour écrire.', labels: [], column: 'planned', position: 1,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: MAINTENANT - H, updatedAt: MAINTENANT - H,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    c.id, c.projectId, c.column, 1, c.title, JSON.stringify(c), null, c.createdAt, c.updatedAt,
  );
  const a = { id: 'ag-champ', projectId: 'p-alpha', cardId: 'c-champ', role: 'cadrage', title: 'Cadrage', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: MAINTENANT - H, updatedAt: MAINTENANT - H };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)`).run(
    a.id, a.projectId, a.cardId, a.role, JSON.stringify(a), a.createdAt, a.updatedAt,
  );
  db.close();
}

/** Un PNG d'un pixel : de quoi faire naître une vraie pièce jointe. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * LES TRAMES ENVOYÉES AU SERVEUR, page par page : c'est là qu'on lit ce que le
 * champ d'écriture enregistre vraiment, et quand.
 */
const TRAMES = new WeakMap();
function ecouterLesTrames(page) {
  const envoyees = [];
  TRAMES.set(page, envoyees);
  page.on('websocket', (canal) => {
    canal.on('framesent', ({ payload }) => {
      try {
        envoyees.push(JSON.parse(String(payload)));
      } catch {
        /* un battement, pas une commande */
      }
    });
  });
}
const trames = (page) => TRAMES.get(page) ?? [];

/** Relève la place du curseur toutes les 100 ms pendant `dureeMs`. */
async function suivreLeCurseur(page, zone, dureeMs) {
  const places = new Set();
  const fin = Date.now() + dureeMs;
  while (Date.now() < fin) {
    places.add(await zone.evaluate((el) => `${el.selectionStart}-${el.selectionEnd}`));
    await page.waitForTimeout(100);
  }
  return [...places];
}

async function ouvrirLeChamp(page) {
  await page.goto(`${BASE}/#projet/p-alpha`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-carte="c-champ"]').first().waitFor({ state: 'visible', timeout: 30000 });
  const zone = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last().locator('textarea').last();
  /* Après un rechargement, le tiroir de la carte se rouvre SEUL (l'adresse le
     retient) : on ne clique la carte que si son champ n'est pas déjà là. */
  const dejaOuvert = await zone.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
  if (!dejaOuvert) {
    await page.locator('[data-carte="c-champ"]').first().click();
    await zone.waitFor({ state: 'visible', timeout: 20000 });
  }
  return zone;
}

async function verifierLeCurseur(page, libelle) {
  const zone = await ouvrirLeChamp(page);
  const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
  await zone.focus();
  await zone.fill('');
  await page.keyboard.type('Bonjour tout le monde ici');
  await page.waitForTimeout(1200);

  /* 1a. Une image jointe : son tag s'écrit, puis le brouillon ET la liste des
     pièces partent au serveur 600 ms plus tard. Le curseur, posé au milieu
     entre-temps, ne doit plus bouger. */
  await barre.locator('input[data-composer-file]').setInputFiles({ name: 'capture.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForFunction(
    (el) => /capture\.png|#[0-9a-f]{4}/.test(el.value),
    await zone.elementHandle(),
    { timeout: 20000 },
  );
  await zone.evaluate((el) => {
    el.focus();
    el.setSelectionRange(7, 7);
  });
  const apresJointe = await suivreLeCurseur(page, zone, 3000);
  noter(
    `${libelle} : après une image jointe, le curseur posé au milieu y reste trois secondes`,
    apresJointe.length === 1 && apresJointe[0] === '7-7',
    apresJointe.join(' → '),
  );

  /* 1b. Une frappe au milieu, puis l'attente : le curseur reste derrière la
     lettre tapée, et le texte n'a rien perdu. */
  await zone.evaluate((el) => {
    el.focus();
    el.setSelectionRange(7, 7);
  });
  await page.keyboard.type('X');
  const apresFrappe = await suivreLeCurseur(page, zone, 2500);
  const valeur = await zone.inputValue();
  noter(
    `${libelle} : après une frappe au milieu, le curseur reste derrière la lettre`,
    apresFrappe.length === 1 && apresFrappe[0] === '8-8' && valeur.startsWith('BonjourX tout le monde ici'),
    `${apresFrappe.join(' → ')} · « ${valeur.slice(0, 26)} »`,
  );

  /* 1c. Retirer le tag (texte ET pièces changent ensemble), curseur au milieu. */
  const croix = barre.locator('[data-prompt-file-close]');
  if (await croix.count()) {
    await croix.first().click({ force: true });
    await page.waitForTimeout(150);
    await zone.evaluate((el) => {
      el.focus();
      el.setSelectionRange(3, 3);
    });
    const apresRetrait = await suivreLeCurseur(page, zone, 2500);
    noter(
      `${libelle} : après le retrait d'une image, le curseur posé au milieu y reste`,
      apresRetrait.length === 1 && apresRetrait[0] === '3-3',
      apresRetrait.join(' → '),
    );
  } else {
    noter(`${libelle} : la croix du tag est là pour le retrait`, false, 'absente');
  }

  /* 1d. Le brouillon a bien été retenu : un rechargement le rend. */
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const zone2 = await ouvrirLeChamp(page);
  await page.waitForTimeout(1200);
  const rendu = await zone2.inputValue();
  noter(`${libelle} : le brouillon est retrouvé après rechargement`, rendu.includes('BonjourX tout le monde ici'), `« ${rendu.slice(0, 40)} »`);
  await zone2.fill('');
  await page.waitForTimeout(1000);

  /* 1e. UN AUTRE ÉCRAN écrit dans la même conversation : le champ resté vierge
     le suit, et quand cet écran-là continue d'écrire, le curseur posé ici au
     milieu ne part pas à la fin. Un envoi ou un effacement là-bas vide ici. */
  const autre = await page.context().newPage();
  const zoneAutre = await ouvrirLeChamp(autre);
  await zoneAutre.focus();
  await autre.keyboard.type('Depuis ailleurs');
  await page.waitForFunction((el) => el.value === 'Depuis ailleurs', await zone2.elementHandle(), { timeout: 8000 }).catch(() => {});
  noter(`${libelle} : un brouillon écrit sur un autre écran remplit le champ vierge`, (await zone2.inputValue()) === 'Depuis ailleurs', `« ${await zone2.inputValue()} »`);
  await zone2.evaluate((el) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });
  await autre.keyboard.type(' encore');
  await page.waitForFunction((el) => el.value === 'Depuis ailleurs encore', await zone2.elementHandle(), { timeout: 8000 }).catch(() => {});
  const suivi = await zone2.evaluate((el) => `${el.value} @ ${el.selectionStart}-${el.selectionEnd}`);
  noter(`${libelle} : quand l'autre écran continue d'écrire, le curseur posé au milieu y reste`, suivi === 'Depuis ailleurs encore @ 3-3', suivi);
  await zoneAutre.fill('');
  await page.waitForFunction((el) => el.value === '', await zone2.elementHandle(), { timeout: 8000 }).catch(() => {});
  noter(`${libelle} : effacé là-bas, le champ se vide ici`, (await zone2.inputValue()) === '', `« ${await zone2.inputValue()} »`);
  await autre.close();

  /* 1f. OUVRIR UNE CONVERSATION NE RÉÉCRIT NI SES PIÈCES NI SON TEXTE
     (11/10/2026). Le champ renvoyait au serveur, 600 ms après CHAQUE
     ouverture, la liste des pièces en attente ET le texte du brouillon tels
     qu'il venait de les lire : un écran réveillé avec une vieille copie
     reposait ainsi des pièces déjà parties, ou un texte déjà envoyé
     d'ailleurs. On écrit, on joint une image, on laisse l'enregistrement
     partir, on recharge — puis on écoute : le texte et la pièce sont revenus
     dans le champ, et aucune trame `prefs.set` ne vise `draftAttachments.` ni
     `draft.<agent>` tant que personne n'a rien touché. Une frappe, ensuite,
     enregistre bien le texte : le verrou ne retient que ce qui a été LU. */
  /* Le champ ne garde du tag que son ALIAS lisible (« #16d7 ») : le nom est
     dessiné par le calque. La pièce se reconnaît donc à son drapeau et à sa
     croix, jamais au nom cherché dans la valeur du champ. */
  const barreDuChamp = () => page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
  const estUnReglage = (trame, debut) => trame?.cmd?.type === 'prefs.set' && String(trame.cmd.key ?? '').startsWith(debut);
  await zone2.focus();
  await page.keyboard.type('Texte relu ');
  await barreDuChamp().locator('input[data-composer-file]').setInputFiles({ name: 'relue.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForFunction((el) => /#[0-9a-f]{4}/.test(el.value), await zone2.elementHandle(), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const posee = trames(page).some((trame) => estUnReglage(trame, 'draftAttachments.') && (trame.cmd.value?.length ?? 0) === 1);
  const ecrit = trames(page).some((trame) => estUnReglage(trame, 'draft.') && String(trame.cmd.value ?? '').includes('Texte relu'));
  const depuis = trames(page).length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const zone3 = await ouvrirLeChamp(page);
  /* Deux fois le délai de l'enregistrement différé, et de la marge. */
  await page.waitForTimeout(2500);
  const revenue =
    /#[0-9a-f]{4}/.test(await zone3.inputValue()) &&
    (await barreDuChamp().locator('[data-prompt-file-close]').count()) === 1 &&
    /* Sa vignette porte son étiquette d'écran — l'alias (« #16d7 »), plus le nom. */
    (await barreDuChamp().locator('img[alt^="#"]').count()) >= 1;
  const reecrites = trames(page).slice(depuis).filter((trame) => estUnReglage(trame, 'draftAttachments.'));
  noter(
    `${libelle} : rouvrir la conversation rend la pièce en attente, sans la renvoyer au serveur`,
    posee && revenue && reecrites.length === 0,
    `pièce enregistrée par le geste : ${posee} · revenue : ${revenue} · ${reecrites.length} trame(s) « draftAttachments. » sans geste`,
  );
  /* LE JUMEAU, POUR LE TEXTE. « draft. » ne se confond pas avec
     « draftAttachments. » : le point fait la différence. */
  const texteRevenu = (await zone3.inputValue()).includes('Texte relu');
  const texteReecrit = trames(page).slice(depuis).filter((trame) => estUnReglage(trame, 'draft.'));
  noter(
    `${libelle} : rouvrir la conversation rend le texte du brouillon, sans le renvoyer au serveur`,
    ecrit && texteRevenu && texteReecrit.length === 0,
    `texte enregistré par la frappe : ${ecrit} · revenu : ${texteRevenu} · ${texteReecrit.length} trame(s) « draft. » sans geste`,
  );
  /* …ET UNE FRAPPE L'ENREGISTRE : le verrou ne rend pas le champ muet. */
  const avantFrappe = trames(page).length;
  await zone3.focus();
  await zone3.press('Control+End');
  await page.keyboard.type(' encore');
  await page.waitForTimeout(1500);
  const parties = trames(page).slice(avantFrappe).filter((trame) => estUnReglage(trame, 'draft.') && String(trame.cmd.value ?? '').includes('encore'));
  noter(
    `${libelle} : une frappe, elle, enregistre bien le texte`,
    parties.length >= 1 && trames(page).slice(avantFrappe).filter((trame) => estUnReglage(trame, 'draftAttachments.')).length === 0,
    `${parties.length} trame(s) « draft. » après la frappe`,
  );
  /* On ne laisse rien : la pièce est retirée, le champ vidé. */
  const croixF = barreDuChamp().locator('[data-prompt-file-close]');
  if (await croixF.count()) await croixF.first().click({ force: true });
  await zone3.fill('');
  await page.waitForTimeout(1000);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

/**
 * Chaque pastille de COIN visible d'un bouton — barre d'en-tête et pied de la
 * colonne de gauche — : 8 × 8 px, son coin haut droit dépasse de 2 px celui du
 * bouton, et rien ne la rogne.
 */
async function verifierLesPastilles(page, libelle, attendues) {
  const mesures = await page.evaluate(() => {
    const selecteurs = ['[data-point-etat]', '[data-point-redemarrage]', '[data-point-notifications]', '[data-assistant-question]', '[data-alerte-navigation]'];
    return [...document.querySelectorAll(selecteurs.join(','))]
      .filter((el) => el.getClientRects().length && el.closest('button') && el.closest('[data-entete-de-zone], [data-pied-colonne]'))
      /* LES PASTILLES DE COIN SEULEMENT : colonne dépliée, l'état des moteurs
         est un point EN LIGNE de son libellé (« LLM en ligne ● »), pas un
         point posé sur le coin d'un bouton. */
      .filter((el) => getComputedStyle(el).position === 'absolute')
      .map((el) => {
        const bouton = el.closest('button');
        const p = el.getBoundingClientRect();
        const b = bouton.getBoundingClientRect();
        const s = getComputedStyle(bouton);
        /* Rien ne la rogne : un cadre qui coupe ce qui déborde ne la rogne que
           si elle en SORT (la colonne défile, sans toucher le pied). Le point
           ignore la souris : on ne peut pas le chercher par `elementFromPoint`. */
        let rogne = false;
        for (let n = el.parentElement; n; n = n.parentElement) {
          const style = getComputedStyle(n);
          if (![style.overflowX, style.overflowY].some((o) => o !== 'visible')) continue;
          const r = n.getBoundingClientRect();
          if (p.top < r.top - 0.5 || p.right > r.right + 0.5 || p.left < r.left - 0.5 || p.bottom > r.bottom + 0.5) rogne = true;
        }
        return {
          nom: [...el.attributes].map((a) => a.name).find((n) => n.startsWith('data-')),
          l: Math.round(p.width * 10) / 10,
          h: Math.round(p.height * 10) / 10,
          /* Mesuré depuis le cadre INTÉRIEUR du bouton : un liseré, s'il y en a un, ne change pas la règle. */
          dx: Math.round((p.right - (b.right - (parseFloat(s.borderRightWidth) || 0))) * 10) / 10,
          dy: Math.round((b.top + (parseFloat(s.borderTopWidth) || 0) - p.top) * 10) / 10,
          rogne,
        };
      });
  });
  const noms = mesures.map((m) => m.nom);
  noter(`${libelle} : les pastilles attendues sont à l'écran`, attendues.every((a) => noms.includes(a)), noms.join(', '));
  /* 2 px hors du cadre INTÉRIEUR du bouton (les boutons n'ont plus de liseré : 2 px hors du bouton). */
  const justes = mesures.every((m) => m.l === 8 && m.h === 8 && m.dx === 2 && m.dy === 2 && !m.rogne);
  noter(`${libelle} : chaque pastille fait 8 px, à cheval sur le coin haut droit, exactement comme celle de la cloche`, mesures.length > 0 && justes, JSON.stringify(mesures));
}

/**
 * LE POINT DU BOUTON DES SERVICES ne paraît que si quelque chose ATTEND. Une
 * demande posée par le canal de l'application, sans carte Beluga, met la
 * Messagerie « à traiter » : le point s'allume, et reste pour l'écran suivant
 * (la demande vit dans la base d'essai). Rend la raison d'un refus, sinon ''.
 */
async function faireAttendreLaMessagerie(page) {
  const point = page.locator('[data-entete-de-zone] [data-navigation-compacte] [data-alerte-navigation]');
  if (await point.count()) return '';
  const refus = await page
    .evaluate(
      (projectId) =>
        new Promise((resolve) => {
          const canal = new WebSocket(`ws://${location.host}/ws`);
          const id = `essai-${Math.random().toString(36).slice(2)}`;
          const minuteur = setTimeout(() => {
            canal.close();
            resolve('commande sans réponse');
          }, 15000);
          canal.onopen = () => canal.send(JSON.stringify({ id, cmd: { type: 'espace.demande.creer', projectId, titre: 'Demande d’essai, à traiter' } }));
          canal.onmessage = (message) => {
            const event = JSON.parse(message.data);
            if (event.type !== 'ack' || event.id !== id) return;
            clearTimeout(minuteur);
            canal.close();
            resolve(event.ok ? '' : String(event.error ?? 'refus'));
          };
          canal.onerror = () => resolve('canal refusé');
        }),
      'p-alpha',
    )
    .catch((err) => String(err?.message ?? err));
  if (!refus) await point.first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  return refus;
}

async function verifierLeTiroir(page, libelle, telephone) {
  await page.goto(`${BASE}/#projet/p-alpha`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const titre = page.locator('[data-titre-bandeau]');
  await titre.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-titre-bandeau]')?.textContent?.includes('Alpha'), null, { timeout: 20000 });
  const estUnBouton = await titre.evaluate((el) => el.tagName === 'BUTTON' || !!el.closest('button'));
  noter(`${libelle} : le nom en haut est un bouton`, estUnBouton);

  /* Le titre ne repousse pas les boutons de droite hors de l'écran. */
  const dedans = await page.evaluate(() => {
    const entete = document.querySelector('header');
    const dernier = [...entete.querySelectorAll('button')].filter((b) => b.getClientRects().length).pop();
    return dernier.getBoundingClientRect().right <= window.innerWidth + 0.5;
  });
  noter(`${libelle} : les boutons de droite restent dans l'écran`, dedans);

  await titre.click();
  const tiroir = page.locator('[data-tiroir-projets]');
  await tiroir.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  const lignes = () =>
    tiroir.locator('[data-ligne-tiroir-projets]').evaluateAll((els) => els.map((el) => el.getAttribute('data-ligne-tiroir-projets')));
  const toutes = await lignes();
  /* « Plan de travail » en tête (il remplace « Tableaux de bord »), puis les
     projets — rangés par dernière ouverture, à défaut dans l'ordre de la
     colonne : les mêmes quatre, sans les mis de côté. */
  noter(
    `${libelle} : « Plan de travail » en tête, puis les quatre projets, sans les mis de côté`,
    toutes[0] === 'plan-de-travail' &&
      JSON.stringify(toutes.slice(1).sort()) === JSON.stringify(['p-alpha', 'p-beta', 'p-elodie', 'p-gamma']),
    toutes.join(', '),
  );
  const icones = await tiroir.locator('[data-ligne-tiroir-projets]:not([data-ligne-tiroir-projets="plan-de-travail"])').evaluateAll((els) =>
    els.every((el) => !!el.querySelector('[data-pastille-projet], [data-initiales-projet], img')),
  );
  noter(`${libelle} : chaque projet porte son icône à gauche`, icones);
  const marque = await tiroir.locator('[data-ligne-tiroir-projets][aria-current="true"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-ligne-tiroir-projets')));
  noter(`${libelle} : le projet ouvert est marqué`, JSON.stringify(marque) === JSON.stringify(['p-alpha']), marque.join(', '));

  await page.screenshot({ path: `/tmp/verif-curseur-tiroir-${telephone ? 'telephone' : 'ordinateur'}.png` });
  const champ = tiroir.locator('[data-recherche-tiroir-projets]');
  if (!telephone) {
    await page.waitForTimeout(200);
    noter(`${libelle} : la recherche a le curseur à l'ouverture`, await champ.evaluate((el) => document.activeElement === el));
  }
  await champ.fill('elo');
  await page.waitForTimeout(200);
  const filtrees = await lignes();
  noter(`${libelle} : « elo » ne garde qu'« Élodie » (sans accent ni majuscule)`, JSON.stringify(filtrees) === JSON.stringify(['p-elodie']), filtrees.join(', '));
  await champ.fill('zzz');
  await page.waitForTimeout(200);
  noter(`${libelle} : une recherche sans résultat le dit`, (await lignes()).length === 0 && (await tiroir.locator('[data-tiroir-projets-vide]').count()) === 1);
  await champ.fill('');
  await page.waitForTimeout(200);

  await tiroir.locator('[data-ligne-tiroir-projets="p-beta"]').click();
  await page.waitForFunction(() => document.querySelector('[data-titre-bandeau]')?.textContent?.includes('Bêta'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  noter(
    `${libelle} : choisir « Bêta » l'ouvre et referme le tiroir`,
    (await titre.textContent())?.includes('Bêta') && !(await tiroir.isVisible().catch(() => false)) && page.url().includes('p-beta'),
    `${await titre.textContent()} · ${page.url().split('#')[1] ?? ''}`,
  );

  await titre.click();
  await tiroir.waitFor({ state: 'visible', timeout: 10000 });
  await tiroir.locator('[data-ligne-tiroir-projets="plan-de-travail"]').click();
  await page.waitForTimeout(600);
  noter(
    `${libelle} : « Plan de travail » ouvre le tableau du projet regardé et referme la liste`,
    (await titre.textContent())?.includes('Bêta') && !(await tiroir.isVisible().catch(() => false)) && page.url().includes('p-beta'),
    `${await titre.textContent()} · ${page.url().split('#')[1] ?? ''}`,
  );
  /* Depuis « Tableaux de bord » aussi, le nom ouvre la liste : aucun projet n'y
     est marqué, et « Plan de travail » y mène au dernier projet utilisé. */
  await page.evaluate(() => {
    location.hash = '#en-route';
  });
  await page.waitForFunction(() => document.querySelector('[data-titre-bandeau]')?.textContent?.includes('Tableaux de bord'), null, { timeout: 10000 }).catch(() => {});
  await titre.click();
  await tiroir.waitFor({ state: 'visible', timeout: 10000 });
  const marqueVue = await tiroir.locator('[data-ligne-tiroir-projets][aria-current="true"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-ligne-tiroir-projets')));
  noter(`${libelle} : sur « Tableaux de bord », aucun projet n'est marqué`, marqueVue.length === 0, marqueVue.join(', '));
  noter(`${libelle} : sur « Tableaux de bord », « Plan de travail » reste proposé`, (await tiroir.locator('[data-ligne-tiroir-projets="plan-de-travail"]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  noter(`${libelle} : Échap referme le tiroir`, !(await tiroir.isVisible().catch(() => false)));
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  // Le démon a créé sa base : on y pose le décor, puis on le laisse le relire.
  poserLeDecor();

  const seulement = process.env.BELUGA_VERIF_SEULEMENT;
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const ecran of [
      { libelle: 'Ordinateur', viewport: { width: 1280, height: 900 }, telephone: false },
      { libelle: 'Téléphone', viewport: { width: 390, height: 844 }, telephone: true },
    ]) {
      const context = await browser.newContext({
        viewport: ecran.viewport,
        locale: 'fr-CH',
        serviceWorkers: 'block',
        ...(ecran.telephone ? { hasTouch: true, isMobile: true } : {}),
      });
      await context.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      /* Une annonce à lire, rangée dans le navigateur : le point de la CLOCHE
         paraît, et sert de modèle aux autres. */
      await context.addInitScript(() => {
        localStorage.setItem('beluga.notifications', JSON.stringify([{ id: 'a-essai', titre: 'Tâche terminée', corps: 'Essai', a: Date.now() }]));
      });
      const page = await context.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      ecouterLesTrames(page);
      if (!seulement || seulement === 'curseur') await verifierLeCurseur(page, ecran.libelle);
      if (!seulement || seulement === 'tiroir') await verifierLeTiroir(page, ecran.libelle, ecran.telephone);
      if (!seulement || seulement === 'pastilles') {
        await page.goto(`${BASE}/#projet/p-alpha`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.locator('[data-point-notifications]').first().waitFor({ state: 'visible', timeout: 30000 });
        /* Le point du bouton des services a besoin d'une raison de s'allumer. */
        const refus = await faireAttendreLaMessagerie(page);
        if (refus) noter(`${ecran.libelle} : une demande à traiter se pose, pour allumer le point des services`, false, refus);
        /* LE POINT DE REDÉMARRAGE VIT AU PIED DE LA COLONNE DE GAUCHE, sur le
           bouton des réglages. Sur téléphone la colonne est un panneau fermé :
           on l'ouvre (et on ne vise que le point VISIBLE — la colonne fixe,
           cachée, en porte un second). */
        if (ecran.telephone) await page.locator('button[aria-label="Projets"]:visible').first().click();
        await page.locator('[data-point-redemarrage]:visible').first().waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(600);
        await verifierLesPastilles(page, ecran.libelle, ['data-point-redemarrage', 'data-point-notifications', 'data-alerte-navigation']);
        await page.screenshot({ path: `/tmp/verif-curseur-entete-${ecran.telephone ? 'telephone' : 'ordinateur'}.png` });
        if (!ecran.telephone) {
          /* COLONNE RÉDUITE À SA BANDE : l'état des moteurs devient à son tour
             une pastille de coin, la même que les deux autres. */
          const replier = page.locator('[data-replier-colonne]:visible').first();
          await replier.click();
          await page.waitForTimeout(800);
          await verifierLesPastilles(page, `${ecran.libelle}, colonne réduite`, ['data-point-etat', 'data-point-redemarrage', 'data-point-notifications', 'data-alerte-navigation']);
          await page.locator('[data-replier-colonne]:visible').first().click();
          await page.waitForTimeout(400);
        } else {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(400);
        }
      }
      noter(`${ecran.libelle} : aucune erreur dans la page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
