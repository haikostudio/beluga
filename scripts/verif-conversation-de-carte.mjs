#!/usr/bin/env node
/**
 * LA CONVERSATION D'UNE CARTE SE LIT COMME UNE DISCUSSION (carte du 23/10/2026).
 *
 *   node scripts/verif-conversation-de-carte.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre (`BELUGA_CONVERSATION_PORT`,
 * jamais `BELUGA_URL`), avec une base neuve et un FAUX moteur qui cadre comme un
 * vrai : titre, mémoire, deux lectures, une carte À PART proposée
 * (« board_create_card »), la compréhension, puis le plan. Le parcours est joué
 * dans un vrai navigateur, sur ordinateur puis sur téléphone.
 *
 * Ce qui est vérifié :
 *   1. la carte proposée par l’agent de la carte paraît dans le bloc « Suggestion de carte » du PIED, une seule
 *      fois, avec son bouton « Créer la carte » ;
 *   2. un DOUBLE clic sur ce bouton fait naître UNE seule carte, dans
 *      « Planifié », et rien n'est lancé pour elle ;
 *   3. la carte créée reste dans le bloc « Suggestion de carte » du pied (`[data-carte-nee-du-fil]`) ;
 *   4. le plan se lit dans le fil comme un ENCART (« rien n'est lancé ») et
 *      s'ouvre dans un PANNEAU À DROITE sur ordinateur, en PAGE sur téléphone ;
 *   5. les actions de l'agent sont REPLIÉES derrière une ligne ;
 *   6. toutes les cartes du bloc ont la MÊME HAUTEUR, boutons alignés en bas ;
 *      une carte lancée garde un bouton qui dit son étape ;
 *   7. la CROIX ferme le bloc, et le repère « cartes suggérées ici » du fil le
 *      rouvre par son bouton « Voir ».
 *   8. volet ouvert, la conversation garde sa colonne de 820 px, centrée dans la
 *      place qui reste (1440 px, puis 2056 px de large) — 28/10/2026.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ws from 'ws';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_CONVERSATION_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-conversation-'));
const PROJET_ID = 'projet-conversation';
const TITRE_A_PART = 'Export des factures en PDF';
/* Une seconde proposition, au texte COURT : la rangée doit l'étirer à la hauteur de l'autre. */
const TITRE_COURT = 'Couleur du bouton de tri';
const SHOTS = path.join(RACINE, 'data', 'verification', 'conversation-de-carte');
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le faux moteur : un cadrage complet, par les VRAIS outils du démon   */
/* ------------------------------------------------------------------ */

const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
const TRACE = path.join(TMP, 'pont.log');
for (const dossier of [MAISON, COMPTE]) fs.mkdirSync(dossier, { recursive: true });
fs.writeFileSync(
  path.join(COMPTE, '.credentials.json'),
  JSON.stringify({ claudeAiOauth: { accessToken: 'jeton-d-essai', expiresAt: Date.now() + 3600_000 } }),
);

const CONTEXTE_A_PART =
  'L’utilisateur veut, en plus du tri des factures traité dans la carte d’origine, pouvoir exporter ' +
  'chaque facture en PDF depuis sa fiche, avec le logo et les coordonnées de l’entreprise. Il a choisi ' +
  'en discussion d’en faire une carte séparée pour ne pas retarder le tri. Rien d’autre n’a été tranché : ' +
  'le format de page et la numérotation restent ceux des factures actuelles.';

const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv.includes('--version')) {
  process.stdout.write('faux-moteur 0.0.0 (essai)\\n');
  process.exit(0);
}
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const chemin = process.argv[process.argv.indexOf('--mcp-config') + 1];
const pont = chemin && fs.existsSync(chemin) ? JSON.parse(fs.readFileSync(chemin, 'utf8')).mcpServers?.beluga?.env : null;
const appeler = async (name, args) => {
  if (!pont) return null;
  const res = await fetch(pont.BELUGA_URL + '/internal/call', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-beluga-token': pont.BELUGA_TOKEN,
      'x-beluga-agent': pont.BELUGA_AGENT,
      'x-beluga-tour': pont.BELUGA_TOUR,
    },
    body: JSON.stringify({ name, args }),
  }).catch(() => null);
  const rendu = res ? await res.json().catch(() => null) : null;
  fs.appendFileSync(${JSON.stringify(TRACE)}, JSON.stringify({ name, statut: res?.status, rendu }) + '\\n');
  return rendu;
};

async function jouer() {
  dire({ type: 'system', subtype: 'init', session_id: 'session-essai' });
  /* LA CARTE NÉE DE LA PROPOSITION ouvre son propre cadrage : ici, une simple
     réponse, pour qu'il ne la renomme pas comme la première. */
  if (demande.includes(${JSON.stringify(TITRE_A_PART)})) {
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Bien reçu.' }] } });
    dire({ type: 'result', subtype: 'success', session_id: 'session-essai-2', usage: { input_tokens: 10, output_tokens: 5 } });
    process.exit(0);
  }
  const cardId = /Identifiant de cette carte[^:]*:\\s*([0-9a-f-]{36})/i.exec(demande)?.[1];
  if (cardId) await appeler('board_update_card', { cardId, title: 'Tri des factures', resumeDemande: 'Trier les factures par date et par client.', titreDuPoint: 'Tri des factures' });
  await appeler('memoire', { geste: 'chercher', demande: 'factures tri export pdf', contexte: 'écran des factures' });
  for (const [n, fichier] of [[1, '/depot/README.md'], [2, '/depot/factures.ts']]) {
    dire({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'lecture-' + n, name: 'Read', input: { file_path: fichier } }] } });
    await attendre(120);
    dire({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'lecture-' + n, content: 'contenu ' + n }] } });
  }
  await appeler('board_create_card', {
    title: ${JSON.stringify(TITRE_A_PART)},
    niveau: 'standard',
    description: 'Exporter chaque facture en PDF depuis sa fiche, avec le logo et les coordonnées de l’entreprise, sans toucher au tri traité ailleurs.',
    contexte: ${JSON.stringify(CONTEXTE_A_PART)},
  });
  await appeler('board_create_card', {
    title: ${JSON.stringify(TITRE_COURT)},
    niveau: 'leger',
    description: 'Passer le bouton de tri des factures au violet de l’interface, rien de plus que cette couleur.',
    contexte: ${JSON.stringify(CONTEXTE_A_PART)},
  });
  await appeler('rendre_comprehension', {
    texte: 'Je trie les factures par date, puis par client, avec un menu de tri en tête de liste. L’export PDF part dans sa propre carte.',
    resumeDemande: 'Trier les factures par date et par client.',
    resumeComprehension: 'Un menu de tri en tête de la liste des factures.',
    hypotheses: [],
    questions: [],
    sujets: ['interface'],
    partieTechnique: {
      taches: [{ titre: 'Menu de tri', description: 'En tête de la liste des factures.' }],
      faits: ['Aucun fait particulier.'],
      risques: 'Le tri par client doit garder l’ordre des dates.',
    },
  });
  await appeler('rendre_plan', {
    titre: 'Tri des factures',
    enClair: 'Je pose un menu de tri en tête de la liste des factures, avec deux choix : par date ou par client. Une fois fini, vous choisirez le tri d’un clic, et la liste le gardera à votre prochaine visite. L’export en PDF ne se fait pas ici : il a sa propre carte.',
    cahierDesCharges: [
      { titre: 'Contexte et objectifs', contenu: 'La liste des factures ne se trie pas ; on veut la trier par date ou par client.' },
      { titre: 'Périmètre', contenu: 'Compris : le tri de la liste. Exclu : l’export PDF, porté par sa propre carte.' },
      { titre: 'Fonctionnalités attendues', contenu: 'Un menu de tri à deux choix, retenu d’une visite à l’autre.' },
      { titre: 'Critères de réussite', contenu: 'La liste se trie par date puis par client, et garde le choix.' },
    ],
    synthese: 'Un menu de tri en tête de liste.\\n\\nLe choix est retenu d’une visite à l’autre.',
    resume: 'Un menu de tri en tête de la liste des factures.',
    taches: [
      { titre: 'Menu de tri', description: 'Deux choix : date ou client.' },
      { titre: 'Choix retenu', description: 'Le dernier tri choisi revient à la visite suivante.' },
    ],
    decisions: ['L’export PDF part dans sa propre carte.'],
    verifications: ['La liste se trie par date puis par client.'],
  });
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Le plan est prêt ; l’export PDF attend votre clic dans sa propre carte.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  port: PORT,
  tmp: TMP,
  env: { BELUGA_CLAUDE_BIN: FAUX_MOTEUR, HOME: MAISON },
});

/* ------------------------------------------------------------------ */
/* La base : une session d'une heure (jeton HACHÉ), un projet, un compte */
/* ------------------------------------------------------------------ */

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification conversation de carte',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai conversation',
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
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: COMPTE }),
    maintenant,
  );
  db.close();
}

/* Une commande au démon par sa prise, avec la session du décor. */
function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 20000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      if (evenement.error) reject(new Error(evenement.error));
      else resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

function idDeCarte(titre) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT id FROM cards WHERE project_id = ? AND title = ?').get(PROJET_ID, titre);
  db.close();
  return ligne?.id;
}

function cartes() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const lignes = db.prepare('SELECT title, column_key FROM cards WHERE project_id = ?').all(PROJET_ID);
  db.close();
  return lignes;
}

/* ------------------------------------------------------------------ */

const boutonNouvelleTache = (page) => page.locator('[data-nouvelle-carte="planned"]:visible').first();

async function ouvrir(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    /* Trois pixels par point, comme l'iPhone : c'est là que le voile d'une zone qui défile laissait un pixel net (#2d5b). */
    ...(telephone ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}),
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  return { contexte, page, erreurs };
}

/** Le parcours ENTIER, sur ordinateur : une demande, le cadrage, la carte à part. */
async function jouerOrdinateur(navigateur) {
  const { contexte, page, erreurs } = await ouvrir(navigateur, false);
  await boutonNouvelleTache(page).click();
  const champ = page.locator('[data-composer] textarea').last();
  await champ.waitFor({ timeout: 15000 });
  await champ.click();
  await champ.fill('Trier les factures par date et par client, et pouvoir les exporter en PDF à part.');
  await page.locator('[data-composer] button[title="Envoyer"]').last().click();

  /* 1. La carte proposée paraît DANS LE FIL, là où l'agent l'a proposée (14/11/2026), avec « Créer la carte ». */
  const toutes = page.locator('[data-fil="parcours"] [data-suggestions-du-fil] [data-vignette="proposition"]');
  const bandeau = toutes.filter({ hasText: TITRE_A_PART });
  const vu = await bandeau.first().waitFor({ timeout: 45000 }).then(() => true, () => false);
  await toutes.nth(1).waitFor({ timeout: 10000 }).catch(() => undefined);
  noter('elle n’y paraît qu’une fois', (await bandeau.count()) === 1, `${await bandeau.count()} vignette(s)`);
  noter('aucun bandeau ne mange le pied de la carte', (await page.locator('[data-bandeau="propositions"]').count()) === 0);
  noter('le pied ne porte plus de bloc de suggestions', (await page.locator('[data-pied-de-conversation] [data-cartes-du-fil]').count()) === 0);
  noter('la carte à part proposée paraît dans la conversation de la carte', vu);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'ordinateur-1-proposition.png') });
  if (!vu) {
    console.log(fs.existsSync(TRACE) ? fs.readFileSync(TRACE, 'utf8').slice(0, 4000) : '(aucun appel au pont)');
    return { contexte, erreurs };
  }
  const creer = bandeau.getByRole('button', { name: 'Créer la carte' }).first();
  noter('la vignette porte le bouton « Créer la carte »', (await creer.count()) === 1);

  /* 2. Un double clic ne fait qu'UNE carte, dans « Planifié ». */
  const avant = cartes().length;
  await creer.dblclick().catch(() => creer.click());
  await page.waitForTimeout(2500);
  const apres = cartes();
  const nees = apres.filter((c) => c.title === TITRE_A_PART);
  noter('un double clic fait naître UNE seule carte', nees.length === 1 && apres.length === avant + 1, `${nees.length} carte(s) — ${JSON.stringify(apres)}`);
  noter('la carte née attend dans « Planifié »', nees[0]?.column_key === 'planned', nees[0]?.column_key);

  /* 3. LA CARTE CRÉÉE SE LIT DANS LE FIL (14/11/2026 : le bloc « Suggestion de carte » du pied a disparu), à
     l'endroit où l'agent l'a proposée, avec son bouton « Lancer ». */
  const trace = page.locator('[data-fil="parcours"] [data-suggestions-du-fil] [data-carte-nee-du-fil]');
  noter('la carte créée se lit dans le fil', await trace.waitFor({ timeout: 8000 }).then(() => true, () => false));
  noter('la vignette « Créer la carte » a laissé place à la carte créée', (await bandeau.count()) === 0);
  noter('le pied ne porte plus de bloc de suggestions', (await page.locator('[data-pied-de-conversation] [data-cartes-du-fil]').count()) === 0);
  await page.locator('[data-suggestions-du-fil]').first().screenshot({ path: path.join(SHOTS, 'ordinateur-4-cartes-du-fil.png') }).catch(() => undefined);

  /* Une carte lancée garde son bouton, qui dit son étape RÉELLE. */
  const lancer = trace.locator('[data-carte-proposee-bouton="lancer"]');
  noter('la carte créée porte « Lancer »', (await lancer.count()) === 1);
  await lancer.click().catch(() => undefined);
  const etat = trace.locator('[data-carte-proposee-bouton="etat"]');
  let etatVu = await etat.waitFor({ timeout: 20000 }).then(() => true, () => false);
  /* Une machine trop chargée REFUSE le lancement (garde de mémoire) : la carte
     reste dans « Planifié ». Ce n'est pas ce que juge ce contrôle — on la pose
     alors soi-même dans une colonne d'après, et c'est le bouton qu'on juge. */
  if (!etatVu) {
    const id = idDeCarte(TITRE_A_PART);
    if (id && cartes().find((c) => c.title === TITRE_A_PART)?.column_key === 'planned') {
      console.log('  (lancement refusé par la machine : la carte est déplacée à la main)');
      await commande({ type: 'card.move', id, column: 'to_deploy' }).catch((e) => console.log(`  (déplacement refusé : ${e.message})`));
      etatVu = await etat.waitFor({ timeout: 20000 }).then(() => true, () => false);
    }
  }
  noter('une fois lancée, la carte garde un bouton qui dit son étape', etatVu && ((await etat.textContent()) ?? '').trim().length > 0, etatVu ? (await etat.textContent()) ?? '' : 'aucun bouton');
  noter('plus de « Lancer » une fois la carte partie', (await lancer.count()) === 0);

  /* 4. Le plan : un encart dans le fil, un panneau à droite. */
  const encart = page.locator('[data-encart-du-plan]').last();
  const encartVu = await encart.waitFor({ timeout: 15000 }).then(() => true, () => false);
  noter('le plan se lit dans le fil comme un encart', encartVu);
  if (encartVu) {
    noter('l’encart dit que rien n’est lancé', /rien n.est lancé/i.test((await encart.textContent()) ?? ''));
    await encart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'ordinateur-2-fil.png') });
    await encart.click();
    const panneau = page.locator('[data-panneau-du-plan]');
    const ouvert = await panneau.waitFor({ timeout: 8000 }).then(() => true, () => false);
    noter('un clic ouvre le plan dans un panneau', ouvert);
    if (ouvert) {
      const geo = await page.evaluate(() => {
        const p = document.querySelector('[data-panneau-du-plan]')?.getBoundingClientRect();
        const f = document.querySelector('[data-fil="parcours"]')?.getBoundingClientRect();
        return p && f ? { gaucheDuPanneau: p.left, droiteDuFil: f.right, largeur: p.width } : null;
      });
      noter('le panneau du plan se tient À DROITE du fil', !!geo && geo.gaucheDuPanneau >= geo.droiteDuFil - 2, JSON.stringify(geo));
      /*
       * LA CONVERSATION GARDE SA COLONNE DE 820 PX, VOLET OUVERT (28/10/2026 :
       * « un tchat, même si on ouvre un volet à droite, doit avoir une largeur
       * maximale »), centrée dans la place qui reste — à 1440 px, puis sur un
       * grand écran de 2056 px, où l'excédent se partage en marges.
       */
      const colonne = async () =>
        page.evaluate(() => {
          const c = document.querySelector('[data-colonne-de-conversation]')?.getBoundingClientRect();
          const rangee = document.querySelector('[data-colonne-de-conversation]')?.parentElement?.getBoundingClientRect();
          const volet = document.querySelector('[data-volet-du-document]')?.getBoundingClientRect();
          const poignee = document.querySelector('[data-document-poignee]')?.getBoundingClientRect();
          if (!c || !rangee || !volet) return null;
          const fin = poignee ? poignee.left : volet.left;
          return { largeur: Math.round(c.width), gauche: Math.round(c.left - rangee.left), droite: Math.round(fin - c.right) };
        });
      const a1440 = await colonne();
      noter('volet ouvert, la conversation ne dépasse pas 820 px (1440 px de large)', !!a1440 && a1440.largeur <= 821, JSON.stringify(a1440));
      await page.setViewportSize({ width: 2056, height: 1100 });
      await page.waitForTimeout(500);
      const a2056 = await colonne();
      noter(
        'sur un grand écran, la conversation garde 820 px, centrée entre le bord et le volet',
        !!a2056 && a2056.largeur <= 821 && a2056.largeur >= 800 && Math.abs(a2056.gauche - a2056.droite) <= 2,
        JSON.stringify(a2056),
      );
      await page.screenshot({ path: path.join(SHOTS, 'ordinateur-3-plan-grand-ecran.png') });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(400);
      /* LA CROIX DU VOLET, LA MÊME PARTOUT (28/10/2026) : le plan garde la sienne, repérée comme les autres. */
      noter('le volet du plan porte sa croix', (await page.locator('[data-croix-du-volet="plan"]').count()) === 1);
      await page.screenshot({ path: path.join(SHOTS, 'ordinateur-3-plan.png') });
      /* Le volet est À PART : fond gris de zone, plan dans une fenêtre arrondie d'un autre fond. */
      const habit = await page.evaluate(() => {
        const volet = document.querySelector('[data-volet-du-document]');
        const fenetre = document.querySelector('[data-emplacement-du-document]');
        if (!volet || !fenetre) return null;
        const v = getComputedStyle(volet);
        const f = getComputedStyle(fenetre);
        return { fondVolet: v.backgroundColor, fondFenetre: f.backgroundColor, rayon: parseFloat(f.borderTopLeftRadius) };
      });
      noter(
        'le volet du plan a son fond, et le plan sa fenêtre arrondie d’un autre fond',
        !!habit && habit.fondVolet !== habit.fondFenetre && habit.rayon >= 8,
        JSON.stringify(habit),
      );
      /* La poignée règle la largeur — de VRAIS événements de pointeur — et la largeur se garde. */
      const poignee = page.locator('[data-document-poignee]');
      const boite = await poignee.boundingBox();
      const largeurAvant = (await page.locator('[data-volet-du-document]').boundingBox())?.width ?? 0;
      if (boite) {
        const x = boite.x + boite.width / 2;
        const y = boite.y + boite.height / 2;
        const sonde = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('[data-document-poignee]'), [x, y]);
        noter('la poignée du volet est bien sous le pointeur', sonde);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x - 60, y, { steps: 6 });
        await page.mouse.move(x - 120, y, { steps: 6 });
        await page.mouse.up();
      }
      await page.waitForTimeout(800);
      const largeurApres = (await page.locator('[data-volet-du-document]').boundingBox())?.width ?? 0;
      noter('la poignée élargit le volet du plan', largeurApres >= largeurAvant + 100, `${Math.round(largeurAvant)} → ${Math.round(largeurApres)} px`);
      await page.reload();
      const encartRecharge = page.locator('[data-encart-du-plan]').last();
      if (await encartRecharge.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
        await encartRecharge.click();
        await page.locator('[data-panneau-du-plan]').waitFor({ timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(600);
      }
      const largeurRechargee = (await page.locator('[data-volet-du-document]').boundingBox())?.width ?? 0;
      noter('la largeur choisie se retrouve après un rechargement', Math.abs(largeurRechargee - largeurApres) <= 2, `${Math.round(largeurRechargee)} px`);
      await page.screenshot({ path: path.join(SHOTS, 'ordinateur-4-volet-elargi.png') });
    }
  }

  await page.evaluate(() => {
    const fil = document.querySelector('[data-fil="parcours"]');
    if (fil) fil.scrollTop = 0;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, 'ordinateur-0-haut.png') });

  /* 5. Les actions de l'agent sont repliées derrière une ligne. */
  const lignes = await page.locator('[data-point-bascule] [data-point-phrase]').allInnerTexts();
  noter(
    'les actions de l’agent sont repliées derrière une ligne qui les compte',
    lignes.some((ligne) => /a fait \d+ actions?/.test(ligne)),
    lignes.join(' | ').slice(0, 160),
  );
  const marques = await page.locator('[data-marque-d-etape]').evaluateAll((els) =>
    els.filter((el) => el.getBoundingClientRect().width > 2 && el.closest('[data-point]:not([hidden])')).map((el) => el.getAttribute('data-marque-d-etape')),
  );
  noter('aucun séparateur d’étape entre les messages du cadrage', !marques.some((m) => ['demande', 'comprehension', 'plan'].includes(m)), marques.join(', '));
  /* Le travail se lit comme UN SEUL FLUX : aucune pastille « Travail », même
     quand l'agent a fait plusieurs tours. */
  const passagesDeTravail = await page.locator('[data-point="travail"]:not([hidden])').count();
  noter(
    `aucune pastille « Travail » entre les tours (${passagesDeTravail} passage(s) de travail)`,
    !marques.includes('travail'),
    marques.join(', '),
  );
  await contexte.close();
  return { erreurs };
}

/** Sur téléphone, la carte déjà cadrée : le plan s'ouvre en FEUILLE DU BAS, la conversation derrière (#f41f). */
async function jouerTelephone(navigateur) {
  const { contexte, page, erreurs } = await ouvrir(navigateur, true);
  const carte = page.getByText('Tri des factures').first();
  await carte.click({ timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const encart = page.locator('[data-encart-du-plan]').last();
  const encartVu = await encart.waitFor({ timeout: 15000 }).then(() => true, () => false);
  noter('téléphone : l’encart du plan est dans le fil', encartVu);
  /* LE VOILE COUVRE JUSQU'AU BORD (#2d5b) : il déborde d'un pixel au-delà de la zone qui défile, et son enveloppe le rogne. */
  {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('[data-voile-defilement^="vertical"]')].filter((voile) => voile.parentElement.getBoundingClientRect().height > 0).map((voile) => {
        const enveloppe = voile.parentElement;
        const zone = [...enveloppe.children].find((e) => e !== voile && !e.hasAttribute('data-voile-defilement') && !e.hasAttribute('data-barre-defilement'));
        const v = voile.getBoundingClientRect();
        const z = zone?.getBoundingClientRect();
        const fin = voile.getAttribute('data-voile-defilement').endsWith('fin');
        return { voile: voile.getAttribute('data-voile-defilement'), v: [v.top, v.bottom], z: z ? [z.top, z.bottom] : null, couvre: !!z && (fin ? v.bottom >= z.bottom + 0.5 : v.top <= z.top - 0.5), rogne: getComputedStyle(enveloppe).overflowY === 'clip' || getComputedStyle(enveloppe).overflow === 'clip' };
      }),
    );
    noter('téléphone : chaque voile couvre la zone jusqu’à son dernier pixel, rogné par son enveloppe', r.length > 0 && r.every((x) => x.couvre && x.rogne), JSON.stringify(r.slice(0, 4)));
  }
  await page.screenshot({ path: path.join(SHOTS, 'telephone-1-fil.png') });
  if (encartVu) {
    await encart.click();
    const panneau = page.locator('[data-panneau-du-plan]');
    const ouvert = await panneau.waitFor({ timeout: 8000 }).then(() => true, () => false);
    const largeur = ouvert ? (await panneau.boundingBox())?.width ?? 0 : 0;
    noter('téléphone : le plan s’ouvre en feuille du bas, pleine largeur', ouvert && largeur >= 380 && (await page.locator('[data-feuille-du-volet="plan"][role="dialog"]').count()) === 1, `${Math.round(largeur)} px`);
    noter('téléphone : la conversation reste visible derrière la feuille', await page.locator('[data-encart-du-plan]').last().isVisible());
    await page.screenshot({ path: path.join(SHOTS, 'telephone-2-plan.png') });
  }
  await contexte.close();
  return { erreurs };
}

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const a = await jouerOrdinateur(navigateur);
    const b = await jouerTelephone(navigateur);
    const erreurs = [...(a.erreurs ?? []), ...(b.erreurs ?? [])];
    noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } catch (err) {
    noter('le parcours est allé au bout', false, String(err).split('\n')[0]);
  } finally {
    await navigateur.close();
  }
  console.log(`Captures : ${SHOTS}`);
  const rates = resultats.filter((r) => !r.ok).length;
  if (rates && process.env.BELUGA_CONVERSATION_JOURNAL) console.log(journal.join('').slice(-6000));
  console.log(rates ? `\n${rates} contrôle(s) en échec.` : '\nTout est vert.');
  process.exit(rates ? 1 : 0);
}

await principal();
