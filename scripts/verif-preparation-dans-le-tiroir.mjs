#!/usr/bin/env node
/**
 * LA PRÉPARATION D'UN LANCEMENT SE VOIT DANS LE TIROIR, dans un VRAI
 * navigateur — et les étapes qui suivent restent GRISES.
 *
 *   npm run build:server && node scripts/verif-preparation-dans-le-tiroir.mjs
 *
 * CE QUI EST JUGÉ. Une carte CADRÉE (deux échanges, un plan rendu) vient
 * d'être lancée : elle est en « En cours », sa marque de vol est posée, et
 * aucun tour ne vit encore. À l'écran, le flux doit montrer :
 *
 *   – un point « Préparation » qui TOURNE, posé après le plan ;
 *   – sa BARRE d'avancement, la même que sur la carte en colonne
 *     (`data-lancement-avancement`), qui avance quand le démon diffuse une
 *     étape plus loin (`card.lancement`) ;
 *   – « Travail » et « Rapport » à l'état « à venir », leur pastille en
 *     toutes lettres, et AUCUNE coche.
 *
 * Avant le correctif, les réponses du CADRAGE — écrites avant le clic —
 * refermaient la préparation : le flux cochait « Le travail est fait » et
 * « Le compte rendu est rendu » à la seconde du lancement (capture du
 * 07.09.2026).
 *
 * Démon et base d'ESSAI à soi, comme `verif-avancement-barre-travail.mjs` :
 * aucun compte réel touché, aucun moteur appelé, pas un jeton dépensé. Le
 * démon servi est celui du dépôt d'où PART le script — lancé depuis une copie
 * de travail, il juge bien ce code-là.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKO_PREPARATION_PORT || 7211);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${process.env.BELUGA_DATA || '/root/beluga/data'}/verification`;
const { TMP, DATA, PROJETS, DEPOT, demon, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-preparation-',
  port: PORT,
});

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 150)}` : ''}`);
};

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-preparation';
const CADRAGE_ID = 'a-preparation-cadrage';
const TACHE_ID = 'a-preparation-tache';
const CARTE_ID = 'c-preparation';
const TITRE_CARTE = 'Essai — préparation dans le tiroir';
/* Le clic sur « Lancer » : le fil de cadrage est ANTÉRIEUR, le vol vient après. */
/* LA CARTE D'ESSAI, telle qu'elle est posée en base : on la renvoie plus bas
   sur le canal, rangée en « Rapport », pour juger ce que l'écran en fait. */
let CARTE_ESSAI = null;
const T = Date.now() - 60_000;
const CLIC = T + 30_000;

/* LE PORT RÉPOND AVANT QUE LE SCHÉMA NE SOIT POSÉ : on attend la table, pas la
   prise réseau — sans quoi le décor s'écrit dans une base encore vide. */
async function attendreLeSchema() {
  const fin = Date.now() + 30_000;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE name = 'sessions'").get();
      db.close();
      if (table) return true;
    } catch {
      /* la base n'existe pas encore */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    T,
    Date.now() + 3_600_000,
    'vérification préparation dans le tiroir',
  );
  /* AUCUN AGENT NE DOIT PARTIR : la carte est « lancée » pour l'affichage
     seulement, jamais confiée à un moteur. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai préparation',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: T,
    updatedAt: T,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), T, T);

  const agent = (id, role, titre) => ({
    id,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role,
    title: titre,
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
    status: 'idle',
    createdAt: T,
    updatedAt: T,
  });
  for (const a of [agent(CADRAGE_ID, 'cadrage', 'Cadrage'), agent(TACHE_ID, 'task', TITRE_CARTE)]) {
    db.prepare(
      'INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(a.id, PROJET_ID, CARTE_ID, a.role, a.status, JSON.stringify(a), T, T);
  }

  /*
   * LE FIL DU CADRAGE, ÉCRIT AVANT LE CLIC : c'est lui qui refermait la
   * préparation à tort. Deux demandes, deux réponses rendues — dont un plan.
   */
  const fil = [
    { id: 'm-p-1', role: 'user', content: 'Voilà ce que je veux', at: T + 1_000 },
    { id: 'm-p-2', role: 'assistant', content: 'Voici ce que j’ai compris de votre demande.', at: T + 2_000 },
    { id: 'm-p-3', role: 'user', content: 'Oui, et aussi ceci', at: T + 3_000 },
    { id: 'm-p-4', role: 'assistant', content: '# Le plan\n\n## Faisabilité\n…', at: T + 4_000 },
  ];
  for (const m of fil) {
    const message = {
      id: m.id,
      agentId: CADRAGE_ID,
      role: m.role,
      content: m.content,
      steps: [],
      todos: [],
      proposals: [],
      questions: [],
      downloads: [],
      attachments: [],
      streaming: false,
      plan: false,
      createdAt: m.at,
    };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      m.id,
      CADRAGE_ID,
      m.role,
      JSON.stringify(message),
      m.at,
    );
  }

  /* LA CARTE, LANCÉE À L'INSTANT : colonne « En cours », marque de vol posée,
     plan rendu et validé sur son parcours — et pas un mot du moteur. */
  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    title: TITRE_CARTE,
    description: 'Carte d’essai posée par le script de vérification.',
    labels: [],
    column: 'running',
    position: 0,
    origin: 'user',
    attachments: [],
    run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
    agentId: TACHE_ID,
    conversationAgentId: CADRAGE_ID,
    scheduling: { tourEnVolDepuis: CLIC },
    parcours: {
      comprehension: { texte: 'Compris.', at: T + 2_000, hypotheses: [], sujets: [] },
      plans: [{ numero: 1, titre: 'Le plan', resume: 'Un plan d’essai', texte: '# Le plan\n…', at: T + 4_000 }],
      planValide: { version: 1, at: CLIC },
    },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: T,
    updatedAt: CLIC,
  };
  CARTE_ESSAI = carte;
  db.prepare(
    'INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(CARTE_ID, PROJET_ID, 'running', 0, TITRE_CARTE, JSON.stringify(carte), T, CLIC);

  db.close();
}

/**
 * LA CARTE EST RANGÉE EN « RAPPORT », EN BASE — pas seulement à l'écran.
 *
 * Ouvrir une carte redemande son état au démon : une carte déplacée par le seul
 * canal reviendrait en « Travail » au premier rafraîchissement, et le contrôle
 * jugerait autre chose que ce qu'il croit. Sa MARQUE DE VOL reste posée : c'est
 * tout le bug — le tour est mort sans passer par sa fin, personne n'a refermé
 * la préparation, et le balayage a rangé la carte avec sa marque.
 */
function rangerLaCarteEnRapport(phrase) {
  const carte = { ...CARTE_ESSAI, column: 'to_deploy', sansModification: phrase, closedAt: Date.now() };
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('UPDATE cards SET column_key = ?, data = ?, updated_at = ? WHERE id = ?').run(
    'done',
    JSON.stringify(carte),
    Date.now(),
    CARTE_ID,
  );
  db.close();
  return carte;
}

/** Le décor d'origine : la carte relancée, sa marque de vol et sa colonne. */
function remettreLaCarteEnTravail() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('UPDATE cards SET column_key = ?, data = ?, updated_at = ? WHERE id = ?').run(
    'running',
    JSON.stringify(CARTE_ESSAI),
    CLIC,
    CARTE_ID,
  );
  db.close();
}

async function ouvrirLeTiroir(navigateur, telephone = false) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

  /* On se greffe sur le canal temps réel pour DIFFUSER l'étape de préparation
     (`card.lancement`) : elle n'est jamais enregistrée, seulement diffusée. */
  await page.addInitScript(() => {
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
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3_500);

  /* LA CARTE SE VISE PAR SON IDENTIFIANT, jamais par son titre : sur téléphone
     la colonne « En cours » n'est pas celle qu'on voit d'abord, et il faut
     l'amener à l'écran. Sur une machine chargée, le premier affichage peut
     tarder : on recharge une fois plutôt que d'échouer sur une lenteur qui
     n'est pas le sujet. */
  const carteVue = page.locator(`[data-carte="${CARTE_ID}"]`).first();
  try {
    await carteVue.waitFor({ state: 'attached', timeout: 45_000 });
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4_000);
    await carteVue.waitFor({ state: 'attached', timeout: 45_000 });
  }
  /* L'APPLICATION ROUVRE LE DERNIER PANNEAU CONSULTÉ : sur le second passage
     (téléphone), le tiroir est déjà là et intercepterait le clic. */
  const dejaOuvert = await page.locator('[role="dialog"] [data-flux-points]').count();
  if (!dejaOuvert) {
    await carteVue.scrollIntoViewIfNeeded().catch(() => undefined);
    await carteVue.click();
  }
  await page.waitForTimeout(2_000);
  return { contexte, page, erreurs };
}

const compter = (page, selecteur) => page.locator(selecteur).count();
const avancementLu = async (page) => {
  const barre = page.locator('[data-flux-points] [data-lancement-avancement]').first();
  return (await barre.count()) ? Number(await barre.getAttribute('data-lancement-avancement')) : null;
};

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  if (!(await attendrePort())) throw new Error('le démon d’essai ne répond pas');
  if (!(await attendreLeSchema())) throw new Error('la base d’essai n’a pas été créée');
  poserDecor();
  fs.mkdirSync(SHOTS, { recursive: true });

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const { contexte, page, erreurs } = await ouvrirLeTiroir(navigateur);

  try {
    /* ---------- 1. Sans le moindre signal reçu ---------- */

    noter(
      'le flux de la carte lancée montre un point « Préparation » qui tourne',
      (await compter(page, '[data-point="preparation"][data-point-etat="encours"]')) === 1,
      `${await compter(page, '[data-point="preparation"]')} point(s) « Préparation »`,
    );
    const sansSignal = await avancementLu(page);
    noter(
      '…avec sa barre d’avancement, jamais vide même sans signal reçu',
      sansSignal !== null && sansSignal > 0,
      `${sansSignal ?? '—'} %`,
    );

    /* ---------- 2. « Travail » et « Rapport » restent gris ---------- */

    const etat = (etape) =>
      page
        .locator(`[data-point="${etape}"]`)
        .last()
        .getAttribute('data-point-etat')
        .catch(() => null);
    const travail = await etat('travail');
    const rapport = await etat('rapport');
    noter(
      '« Travail » et « Rapport » sont à VENIR, pas cochés',
      travail === 'avenir' && rapport === 'avenir',
      `travail : ${travail} · rapport : ${rapport}`,
    );
    noter(
      '…et ils le DISENT, au lieu de compter sur le seul gris',
      (await compter(page, '[data-point="travail"] [data-point-avenir]')) === 1 &&
        (await compter(page, '[data-point="rapport"] [data-point-avenir]')) === 1,
    );
    noter(
      'aucune étape n’est annoncée « faite » alors que rien n’a tourné',
      (await compter(page, '[data-point="travail"][data-point-etat="fait"]')) === 0 &&
        (await compter(page, '[data-point="rapport"][data-point-etat="fait"]')) === 0,
    );

    /* ---------- 3. Le point se pose SOUS le plan, avant la suite ---------- */

    const ordre = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-flux-points] [data-point]')).map((n) =>
        n.getAttribute('data-point'),
      ),
    );
    noter(
      'le point « Préparation » se pose après le plan et avant « Travail »',
      ordre.indexOf('preparation') > ordre.lastIndexOf('plan') &&
        ordre.indexOf('preparation') < ordre.indexOf('travail'),
      ordre.join(' → '),
    );

    await page.screenshot({ path: `${SHOTS}/preparation-tiroir-1-sans-signal.png` });

    /* ---------- 4. La barre AVANCE quand le démon diffuse une étape ---------- */

    /* LE SIGNAL PORTE L'INSTANT OÙ IL PART, comme le vrai démon
       (`etapeDeLancement`, qui diffuse toujours `Date.now()`). Une préparation
       datée d'AVANT le démarrage du démon est morte par construction, et
       l'écran l'écarte (`preparationAAfficher`). */
    await page.evaluate(
      ([cardId, projectId]) => {
        window.__injecter({ type: 'card.lancement', cardId, projectId, etape: 'moteur', depuis: Date.now() });
      },
      [CARTE_ID, PROJET_ID],
    );
    await page.waitForTimeout(1_200);
    const avecSignal = await avancementLu(page);
    noter(
      'la barre AVANCE quand l’étape franchie est diffusée',
      avecSignal !== null && sansSignal !== null && avecSignal > sansSignal,
      `${sansSignal ?? '—'} % → ${avecSignal ?? '—'} %`,
    );
    const phrase = await page
      .locator('[data-point="preparation"] [data-point-phrase]')
      .first()
      .innerText()
      .catch(() => '');
    noter('…et la phrase dit l’étape franchie', /moteur/i.test(phrase), phrase || '—');

    await page.screenshot({ path: `${SHOTS}/preparation-tiroir-2-avec-signal.png` });

    /* ---------- 5. Le premier mot de l’agent referme la préparation ---------- */

    await page.evaluate(
      ([agentId, at]) => {
        window.__injecter({
          type: 'message.upsert',
          message: {
            id: 'm-p-lance',
            agentId,
            role: 'assistant',
            content: 'Travail terminé.',
            steps: [],
            todos: [],
            proposals: [],
            questions: [],
            downloads: [],
            attachments: [],
            streaming: false,
            plan: false,
            createdAt: at,
          },
        });
      },
      [TACHE_ID, CLIC + 10_000],
    );
    await page.waitForTimeout(1_500);
    noter(
      'le premier mot de l’agent lancé referme la préparation',
      (await compter(page, '[data-point="preparation"]')) === 0 &&
        (await compter(page, '[data-flux-points] [data-lancement-avancement]')) === 0,
      `${await compter(page, '[data-point="preparation"]')} point(s) restant(s)`,
    );

    /* ---------- 5 bis. LE BUG D'ORIGINE : UNE CARTE TERMINÉE NE PRÉPARE PLUS RIEN ----------
     *
     * Le signal `card.lancement` est diffusé, jamais enregistré : quand un tour
     * meurt sans passer par sa fin, personne ne le referme. L'écran gardait
     * alors sa barre jaune une demi-heure — sur une carte DÉJÀ rangée en
     * « Rapport ». On rejoue exactement cela : un signal encore frais, mais une
     * carte qui a quitté « Travail ». La barre doit rester éteinte.
     *
     * Et la carte close porte sa PHRASE (`sansModification`) : elle ne se lisait
     * que sur la vignette du tableau, le tiroir n'en disait pas un mot. Elle doit
     * maintenant se lire dans le flux, au dernier point.
     */
    /* LA PHRASE EXACTE DU DÉMON, prise à sa source : `natureDeLaMention` la
       reconnaît au caractère près, et une phrase recopiée à la main retomberait
       en « attente » — soit une alerte jaune sur un simple constat. */
    const { RAISON_RENDU_SANS_CODE: PHRASE_DE_LA_CARTE } = await import(
      pathToFileURL(path.join(RACINE, 'shared', 'dist', 'suivi-colonne.js')).href
    );
    const carteRangee = rangerLaCarteEnRapport(PHRASE_DE_LA_CARTE);
    await page.evaluate(
      ([carte, projectId]) => {
        window.__injecter({ type: 'card.upsert', card: carte });
        window.__injecter({
          type: 'card.lancement',
          cardId: carte.id,
          projectId,
          etape: 'moteur',
          depuis: Date.now(),
        });
      },
      [carteRangee, PROJET_ID],
    );
    await page.waitForTimeout(1_500);
    /* LA VIGNETTE DU TABLEAU, DERRIÈRE LE TIROIR : c'est là que la barre jaune
       survivait. Le tiroir, lui, éteint déjà sa préparation par le chapitre du
       parcours (`chapitreDuParcours` ne la rend qu'en « Travail ») ; la carte en
       colonne n'avait, elle, que la péremption d'une demi-heure. */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1_200);
    const vignettesVues = await compter(page, `[data-carte="${CARTE_ID}"]`);
    noter(
      'la carte close est bien À L\u2019ÉCRAN, dans « Rapport » : sans elle, l\u2019absence de barre ne prouverait rien',
      vignettesVues > 0,
      `${vignettesVues} vignette(s)`,
    );
    /* La barre de la vignette est posée SOUS l'article de la carte, pas dedans :
       elle se vise par sa propre marque (`data-lancement-en-cours`). */
    const barresDeLaVignette = await compter(page, `[data-lancement-en-cours="${CARTE_ID}"]`);
    noter(
      'une carte rangée en « Rapport » n’affiche AUCUNE préparation sur sa vignette, signal frais ou non',
      barresDeLaVignette === 0,
      `${barresDeLaVignette} barre(s) sur la vignette`,
    );
    await page.screenshot({ path: `${SHOTS}/preparation-tiroir-4-carte-terminee.png` });
    /* Puis on rouvre le tiroir : la phrase de la carte s'y juge. */
    const vignette = page.locator(`[data-carte="${CARTE_ID}"]`).first();
    await vignette.scrollIntoViewIfNeeded().catch(() => undefined);
    await vignette.click();
    await page.waitForTimeout(1_500);
    noter(
      '…et le tiroir de cette carte close ne montre plus de préparation non plus',
      (await compter(page, '[data-point="preparation"]')) === 0 &&
        (await compter(page, '[data-flux-points] [data-lancement-avancement]')) === 0,
      `${await compter(page, '[data-point="preparation"]')} point(s)`,
    );
    const mention = page.locator('[data-flux-points] [data-mention-point]').first();
    const texteMention = await mention.innerText().catch(() => '');
    noter(
      'la phrase portée par la carte se lit DANS le tiroir, comme sur sa vignette',
      texteMention.includes('rien n’a été livré'),
      texteMention.slice(0, 90) || '—',
    );
    noter(
      '…avec le ton de sa nature, jamais une alerte de plus',
      (await mention.getAttribute('data-mention-point').catch(() => null)) === 'information',
      (await mention.getAttribute('data-mention-point').catch(() => null)) ?? '—',
    );
    await page.screenshot({ path: `${SHOTS}/preparation-tiroir-5-phrase-de-la-carte.png` });

    /* LE DÉCOR EST REMIS COMME IL ÉTAIT : la passe téléphone, qui vient après,
       juge une préparation VIVANTE, donc une carte en « Travail ». */
    remettreLaCarteEnTravail();

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await contexte.close();
  }

  /* ---------- 6. Sur téléphone, la barre tient dans la largeur ---------- */

  const petit = await ouvrirLeTiroir(navigateur, true);
  try {
    const mesures = await petit.page.evaluate(() => {
      const barre = document.querySelector('[data-flux-points] [data-lancement-avancement]')?.parentElement;
      if (!barre) return null;
      const b = barre.getBoundingClientRect();
      return { gauche: b.left, droite: b.right, largeur: b.width, ecran: window.innerWidth };
    });
    noter(
      'sur un écran de 390 px, la barre de préparation tient dans la largeur',
      !!mesures && mesures.largeur > 40 && mesures.gauche >= 0 && mesures.droite <= mesures.ecran + 1,
      mesures ? `${Math.round(mesures.largeur)} px, de ${Math.round(mesures.gauche)} à ${Math.round(mesures.droite)} sur ${mesures.ecran}` : 'barre absente',
    );
    await petit.page.screenshot({ path: `${SHOTS}/preparation-tiroir-3-telephone.png` });
  } finally {
    await petit.contexte.close();
    await navigateur.close();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles au vert`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
