#!/usr/bin/env node
/**
 * LE PLAN SE LIT COMME UNE RÉPONSE, ET LE LANCEMENT SE PROGRAMME — dans un vrai
 * navigateur.
 *
 *   node scripts/verif-plan-replie-et-programmation.mjs
 *
 * (Le nom du script garde l'ancien intitulé, « plan replié » : le plan ne naît
 * plus replié depuis le 12/10/2026, il est posé en texte dans le fil.)
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché. Le plafond d'agents est mis à ZÉRO et le
 * décor est posé EN BASE — aucun moteur n'est appelé, pas un jeton dépensé.
 *
 * Ce qui est prouvé, bout en bout :
 *   1. le plan est un TEXTE posé dans le fil, hors de la carte du passage : ni
 *      bandeau, ni repli, ni bloc gris, ni sommaire, ni retour collant ;
 *   2. l'entête du plan ne porte AUCUNE décision : « Valider et lancer » vit
 *      dans la rangée au-dessus du champ de saisie, et « Refuser » n'existe
 *      plus ;
 *   3. le texte du plan se lit d'emblée, ses titres sont plus marqués que son
 *      texte ;
 *   3 bis. « Valider le plan » LANCE : un seul clic écrit la validation sur la
 *      carte puis demande le départ (ici refusé par le plafond d'agents à zéro,
 *      ce qui se lit en base) ;
 *   4. le lancement est un bouton SCINDÉ : plus aucun bouton « Dès que
 *      possible » à côté, un sous-bouton d'horloge à sa droite ;
 *   5. le tiroir de programmation POSE la date (lue en base, drapeau
 *      « heure automatique » effacé) et la RETIRE.
 *
 * On juge sur l'ÉTAT lu (attributs, valeurs en base), jamais sur des hauteurs —
 * sauf le retour au point, qui est une question de position à l'écran.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* La racine se déduit du script LUI-MÊME : lancé depuis une copie de travail
   (`.worktrees/…`), il juge le code de CETTE copie, jamais celui du dossier
   principal — sinon il déclare bon un changement jamais exécuté. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_PLAN_PORT || 7199);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Un démon à soi                                                      */
/* ------------------------------------------------------------------ */

const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-plan-replie-',
  port: PORT,
  messageCommit: 'plan',
});

/* ------------------------------------------------------------------ */
/* Le décor : un projet, une carte, son plan                            */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const CARTE_ID = 'c-essai-plan';
const AGENT_ID = 'a-essai-cadrage';
const TITRE = 'Carte d’essai — plan replié';
const PHRASE_DU_PLAN = 'Ce plan sert au contrôle du repli.';

/* Un plan LONG : le retour collant ne paraît que si le contenu dépasse la
   hauteur visible, et c'est justement ce qu'on veut éprouver. */
const LIGNES = Array.from({ length: 40 }, (_, i) => `- Ligne de plan numéro ${i + 1}, écrite pour occuper la hauteur.`);
const TEXTE_DU_PLAN = [
  '# Plan d’essai',
  `_${PHRASE_DU_PLAN}_`,
  '',
  '## Faisabilité',
  ...LIGNES,
  '',
  '## Chemin à suivre',
  ...LIGNES,
  '',
  '## Conséquences',
  ...LIGNES,
  '',
  '## Améliorations apportées',
  '- Une idée à retenir.',
].join('\n');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification plan replié',
  );

  /* Plafond d'agents à ZÉRO : rien ne peut partir, quoi qu'on clique. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai plan replié',
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

  const carte = {
    id: CARTE_ID,
    projectId: PROJET_ID,
    agentId: AGENT_ID,
    title: TITRE,
    description: 'Carte du contrôle.',
    labels: [],
    column: 'planned',
    position: 1,
    origin: 'user',
    /* UN MODÈLE ET SON NIVEAU DE RÉFLEXION sont posés sur la carte : le bouton
       de lancement doit les dire tous les deux, comme sa configuration. */
    run: { engine: 'claude', model: 'claude-sonnet-5-5', thinking: 'high', mode: 'plan' },
    scheduling: { asap: false, attempts: 0, restarts: 0 },
    parcours: {
      /* LA COMPRÉHENSION EST LE PIVOT DE LA DÉCISION : sans elle, le bouton
         reste éteint, plan rendu ou non. */
      comprehension: {
        texte: 'Compris.',
        hypotheses: [],
        sujets: [],
        resumeDemande: 'Vous demandez un essai.',
        resumeComprehension: 'Je comprends qu’il faut un essai.',
        at: maintenant - 10,
      },
      plans: [{ id: 'plan-1', numero: 1, titre: 'Plan d’essai', texte: TEXTE_DU_PLAN, at: maintenant }],
    },
    excludedFromDeploy: false,
    horsTache: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE_ID, PROJET_ID, 'planned', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);

  const agent = {
    id: AGENT_ID,
    projectId: PROJET_ID,
    cardId: CARTE_ID,
    role: 'cadrage',
    title: TITRE,
    run: { engine: 'claude', thinking: 'none', mode: 'plan' },
    status: 'idle',
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, CARTE_ID, 'cadrage', 'idle', JSON.stringify(agent), maintenant, maintenant);

  /* UNE DEMANDE DÉJÀ ENVOYÉE : sans elle, le tiroir s'ouvre sur la carte de
     configuration de l'agent, et le flux n'est pas encore affiché. */
  const demande = {
    id: 'm-demande',
    agentId: AGENT_ID,
    role: 'user',
    content: 'Fais l’essai du plan replié.',
    steps: [],
    todos: [],
    proposals: [],
    questions: [],
    downloads: [],
    attachments: [],
    createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id,
    AGENT_ID,
    'user',
    JSON.stringify(demande),
    maintenant,
  );

  /* LE JALON « Plan proposé » DONNE SON POINT AU FLUX : c'est lui que le
     parcours range sous l'étape « plan » (`shared/src/journal-carte.ts`). */
  db.prepare(
    `INSERT INTO card_journal
       (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'j-plan-1',
    CARTE_ID,
    0,
    'cadrage',
    'jalon',
    maintenant,
    AGENT_ID,
    'cadrage',
    'tour-1',
    'Plan proposé',
    TEXTE_DU_PLAN.slice(0, 400),
    1,
    JSON.stringify({ version: 1, titre: 'Plan d’essai' }),
  );
  db.close();
}

/** L'ordonnancement de la carte, lu en base — la seule preuve qui vaille. */
function ordonnancement() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE_ID);
  db.close();
  try {
    return JSON.parse(ligne?.data ?? '{}')?.scheduling ?? {};
  } catch {
    return {};
  }
}

/**
 * Combien de messages ont été envoyés à l'agent EN PLUS du décor ? Doit rester
 * à zéro : rien de ce contrôle ne parle à un moteur.
 */
function messagesEnvoyes() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const n = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role = 'user'").get()?.n ?? 0;
  db.close();
  return Math.max(0, n - 1);
}

/* ------------------------------------------------------------------ */
/* Le navigateur                                                       */
/* ------------------------------------------------------------------ */

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });

  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(1500);
  }

  /* -------- 1. Le plan est un texte du fil, hors de la carte du passage -------- */

  await page.locator('article').filter({ hasText: TITRE.slice(0, 24) }).first().click();
  await page.waitForTimeout(4000);

  const bloc = page.locator('[data-bloc-du-plan]');
  noter('le fil porte bien le plan de la carte', (await bloc.count()) === 1, `${await bloc.count()} bloc(s)`);
  noter(
    'le plan est posé HORS de la carte du passage (le bloc de travail de l’agent)',
    (await page.locator('[data-carte-du-passage] [data-bloc-du-plan]').count()) === 0,
  );
  noter(
    'il se lit d’emblée : aucun repli, aucun bandeau à ouvrir',
    (await bloc.first().getAttribute('data-bloc-du-plan-repli')) === 'ouvert' &&
      (await page.locator('[data-bloc-du-plan-bascule], [data-entete-plan]').count()) === 0,
    (await bloc.first().getAttribute('data-bloc-du-plan-repli')) ?? '—',
  );
  const corps = page.locator('[data-bloc-du-plan-corps]');
  noter(
    'son corps est visible, et dit le plan',
    (await corps.count()) === 1 && (await corps.first().isVisible()) && (await corps.first().innerText()).includes(PHRASE_DU_PLAN),
  );
  noter(
    'sans sommaire, sans carte ni icône par partie : des titres nus',
    (await corps.locator('nav').count()) === 0 && (await corps.locator('section').count()) === 0,
    `${await corps.locator('nav').count()} sommaire(s), ${await corps.locator('section').count()} carte(s)`,
  );
  const fondDuPlan = await bloc.first().evaluate((n) => {
    let courant = n;
    const fonds = [];
    /* Du bloc jusqu'au point : aucun ancêtre ne peint un fond propre. */
    while (courant && !courant.matches('[data-point]')) {
      const fond = getComputedStyle(courant).backgroundColor;
      if (fond && fond !== 'rgba(0, 0, 0, 0)' && fond !== 'transparent') fonds.push(fond);
      courant = courant.parentElement;
    }
    return fonds;
  });
  noter('aucun bloc gris autour du plan : il est posé sur le fond de la page', fondDuPlan.length === 0, fondDuPlan.join(', '));
  const titres = await corps.first().evaluate((n) => {
    const taille = (el) => parseFloat(getComputedStyle(el).fontSize);
    const paragraphe = n.querySelector('p');
    const titre = n.querySelector('h1, h2');
    return {
      titre: titre ? taille(titre) : null,
      texte: paragraphe ? taille(paragraphe) : null,
      gras: titre ? Number(getComputedStyle(titre).fontWeight) : null,
    };
  });
  noter(
    'les titres sont DISTINCTS : plus grands et plus gras que le texte',
    titres.titre !== null && titres.texte !== null && titres.titre > titres.texte && titres.gras >= 600,
    JSON.stringify(titres),
  );

  /* -------- 2. La décision a quitté le bandeau pour la rangée du bas -------- */

  noter(
    'l’entête du plan ne porte PLUS aucun bouton de décision',
    (await page.locator('[data-entete-plan] [data-boutons-plan]').count()) === 0 &&
      (await page.locator('[data-plan-valider]').count()) === 0 &&
      (await page.locator('[data-entete-plan] [data-plan-refuser]').count()) === 0,
  );

  const valider = page.locator('[data-barre-action] [data-geste-principal="valider-et-lancer"]');
  noter(
    '« Valider et lancer » se lit dans la rangée au-dessus du champ',
    (await valider.count()) === 1 && (await valider.first().isVisible()),
  );
  /* « REFUSER » N'EXISTE PLUS : le plan n'est plus une étape validable à part,
     et faire affiner se fait en écrivant un message ordinaire. */
  noter(
    'plus aucun bouton « Refuser » nulle part',
    (await page.locator('[data-plan-refuser]').count()) === 0,
  );
  noter(
    '« Valider et lancer » est ALLUMÉ : la compréhension est rendue et le tour est fini',
    (await valider.first().getAttribute('aria-disabled')) === 'false',
    (await valider.first().getAttribute('aria-disabled')) ?? '—',
  );
  noter(
    '…et il rappelle le modèle qui partira, celui de la configuration',
    /·\s*\S/.test((await valider.first().innerText()) ?? ''),
    (await valider.first().innerText()).trim() || 'sans texte',
  );
  /* LE NIVEAU DE RÉFLEXION SE LIT À CÔTÉ DU MODÈLE : « Valider et lancer · modèle ·
     niveau », le niveau étant celui de la configuration de l'agent. */
  const libelleDuBouton = ((await valider.first().innerText()) ?? '').trim();
  const morceauxDuBouton = libelleDuBouton.split('·').map((m) => m.trim()).filter(Boolean);
  noter(
    '…et le niveau de réflexion se lit à côté du modèle : « lancer · modèle · niveau »',
    morceauxDuBouton.length === 3 && /high|haut|élev/i.test(morceauxDuBouton[2]),
    libelleDuBouton,
  );

  /* SUR UN TÉLÉPHONE, LE GESTE TIENT SUR UNE LIGNE (l'horloge a quitté l'écran le 13/11/2026). */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(900);
  const surTelephone = await page.evaluate(() => {
    const rangee = document.querySelector('[data-barre-action]');
    if (!rangee) return null;
    const cadre = rangee.getBoundingClientRect();
    const gestes = Array.from(rangee.querySelectorAll('[data-geste-principal]'))
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.height > 0);
    return {
      nombre: gestes.length,
      memeLigne: gestes.every((r) => Math.abs(r.y - gestes[0].y) < 6),
      dansLeCadre: gestes.every((r) => r.left >= cadre.left - 2 && r.right <= cadre.right + 2),
    };
  });
  noter(
    'sur un téléphone, le geste tient sur UNE ligne, sans déborder',
    !!surTelephone && surTelephone.nombre >= 1 && surTelephone.memeLigne && surTelephone.dansLeCadre,
    JSON.stringify(surTelephone),
  );
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(900);
  noter('rien n’est parti : la décision n’envoie aucun message', messagesEnvoyes() === 0, `${messagesEnvoyes()} message(s)`);

  /* -------- 3. Plus de repli, plus de retour collant -------- */

  noter('AUCUN choix de niveau sous le plan : un plan validé part avec le modèle de sa configuration', (await page.locator('[data-niveau-plan], [data-pied-plan]').count()) === 0);
  noter('plus de retour collant : un plan lu comme une réponse n’en a pas besoin', (await page.locator('[data-retour-au-point]').count()) === 0);

  /* -------- 3 bis. « Valider le plan » VALIDE PUIS LANCE, d'un seul clic ---- */

  noter(
    'AVANT la décision, aucun bouton « Lancer la tâche » à côté : un seul geste',
    (await page.locator('[data-geste-principal="lancer"]').count()) === 0,
  );
  await valider.first().click();
  await page.waitForTimeout(2500);
  const etatDeLaCarte = () => {
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(CARTE_ID);
    db.close();
    return ligne ? JSON.parse(ligne.data) : {};
  };
  const apresClic = etatDeLaCarte();
  noter(
    '« Valider et lancer » écrit la compréhension validée SUR LA CARTE',
    !!apresClic?.parcours?.comprehensionValidee,
    JSON.stringify(apresClic?.parcours?.comprehensionValidee ?? null),
  );
  noter('…sans envoyer AUCUN message à l’agent', messagesEnvoyes() === 0, `${messagesEnvoyes()} message(s)`);
  /* LE MÊME CLIC A DEMANDÉ LE DÉPART : ici le plafond d'agents est à zéro, le
     lancement est donc REFUSÉ — et ce refus, écrit sur la carte, prouve que la
     demande est bien partie. Sans le second geste, la carte n'aurait aucune
     raison d'attente. */
  noter(
    '…et le MÊME clic a demandé le lancement : la carte porte son refus de départ',
    typeof apresClic?.scheduling?.waitingReason === 'string' && apresClic.scheduling.waitingReason.length > 0,
    apresClic?.scheduling?.waitingReason ?? 'aucune raison d’attente',
  );
  noter('la décision ne s’offre plus une seconde fois', (await page.locator('[data-geste-principal="valider-et-lancer"]').count()) === 0);
  noter('plus aucune phrase « Plan validé : lancez quand vous voulez »', (await page.locator('[data-plan-valide]').count()) === 0);
  const lancerApres = page.locator('[data-geste-principal="lancer"]');
  noter(
    'le départ refusé laisse « Lancer la tâche », allumé, pour réessayer',
    (await lancerApres.count()) === 1 && (await lancerApres.first().getAttribute('aria-disabled')) === 'false',
  );
  /* « LANCER » DIT AUSSI CE QUI PART : le modèle posé sur la carte, puis son niveau. */
  const libelleLancer = ((await lancerApres.first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  noter(
    '…et il dit le modèle et le niveau qui partiront, comme « Valider et lancer »',
    /Claude Sonnet 5\.5 · High$/.test(libelleLancer) && /^(Lancer|Reprendre)/.test(libelleLancer),
    libelleLancer,
  );

  /* -------- 4. « Auto » et l'horloge de programmation ont quitté l'écran (refonte du 13/11/2026) -------- */

  noter('aucun message n’est parti de tout le contrôle', messagesEnvoyes() === 0, `${messagesEnvoyes()} message(s)`);
  noter('aucune erreur de page pendant tout le parcours', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join(''));
  process.exit(1);
});
