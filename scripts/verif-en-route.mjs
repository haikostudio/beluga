#!/usr/bin/env node
/**
 * LA PAGE « EN ROUTE » — tout ce qui est entre la demande et le déploiement,
 * tous projets confondus (`shared/src/en-route.ts`, `web/src/components/en-route.tsx`).
 *
 *   node scripts/verif-en-route.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre, avec une base neuve : le
 * démon de production n'est pas touché et aucun moteur réel n'est lancé.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026) :
 *   - la colonne de gauche suit le lieu : l'application s'ouvre sur un projet,
 *     où la ligne « Tableaux de bord » n'est pas à l'écran ; on remonte à la
 *     page par la flèche de retour de la tête de colonne
 *     (`ouvrirLesTableauxDeBord`, `scripts/lib/navigation.mjs`), puis on
 *     vérifie le clic sur la ligne depuis un service (le coffre), où la
 *     colonne garde la liste des projets ;
 *   - le bouton des services a quitté le pied de la colonne pour la barre
 *     d'en-tête (« le bouton des services ouvre le fil d'Ariane, tout à
 *     gauche ») : le point 1 le vérifie là ;
 *   - le « tiroir » d'une carte est une PAGE de la zone principale (toujours
 *     repérée `data-tiroir`) ;
 *   - deux palettes, clair et sombre, au lieu de douze (point 15) ;
 *   - le cadre violet des cartes Système a disparu : même tenue que toute
 *     carte, aucun cadre (point 5, `CLASSE_CADRE_SYSTEME`).
 *
 * Ce qui est vérifié :
 *   1. la colonne n'a PLUS de bouton « Tableaux de bord » (12/10/2026) ; le
 *      bouton des services est dans la barre d'en-tête, plus dans la colonne ;
 *      la pile flottante du pied de colonne a disparu ;
 *   2. un clic ouvre la page ; « Actifs » montre les cartes des DEUX projets en
 *      Demande et Travail, jamais une carte À déployer (elle est dans
 *      « Terminer »), ni une carte archivée, ni celle d'un projet mis de côté ;
 *   3. l'ordre : la DERNIÈRE ACTION en haut (`updated_at`), qu'elle ait rendu
 *      un tour ou non, sans intertitre ;
 *   4. la carte où un agent travaille porte le témoin « Au travail », et son
 *      étape se dit « Travail » ;
 *   5. l'agent sans carte (une mise en ligne) est dans la bande de tête ; un
 *      agent posé sur une carte n'y est JAMAIS, ni dans « Actifs » ni dans
 *      « Archiver » ; il a le FORMAT et la TENUE d'une carte (même bord
 *      gauche, même largeur, même tête, même fond sans cadre, barre de travail
 *      en pied), mais une hauteur au contenu, nettement plus basse
 *      (06/10/2026), à 1500 px comme à 390 px ;
 *   6. un clic sur une carte d'un projet NON affiché ouvre sa page, sans
 *      quitter la page des tableaux de bord (elle reste montée dessous) ;
 *   7. l'adresse « #en-route » rouvre la page après un rechargement ;
 *   8. au-delà de vingt cartes, la suite arrive par paquet, sans doublon ;
 *   9. plus aucune barre d'onglets : TROIS COLONNES côte à côte, « Actifs »,
 *      « Terminer » et « Archiver », visibles en même temps (08/10/2026).
 *      « Terminer » montre TOUT ce qui est fini (À déployer, mis en ligne,
 *      archivé dans son projet) ; « Archiver » ce que l'utilisateur y a rangé,
 *      la dernière action en haut, avec le badge « en ligne » (la date au
 *      survol) ou le badge « archivée » ; une carte publiée pendant qu'on
 *      regarde est archivée dans son PROJET mais RESTE dans « Terminer », avec
 *      son badge ; GLISSÉE à la souris de « Terminer » vers « Archiver » (et
 *      retour), elle y passe sans que sa colonne de projet bouge ; une carte
 *      rendue passe d'« Actifs » à « Terminer », une carte archivée à la main
 *      d'« Actifs » à « Terminer », sans recharger ; la page n'a pas de ligne de titre : « Tableaux de
 *      bord » est dans le bandeau du haut (le nom du projet y revient au
 *      tableau) ; chaque colonne porte son NOMBRE en tête — « en cours/total »
 *      pour « Actifs », paquets non reçus compris ;
 *  10. la mise en page : dans chaque colonne, toutes les cartes au même bord
 *      gauche et à la même largeur, toutes les tuiles à la même hauteur ; à
 *      1500 px les trois colonnes se partagent la largeur, côte à côte ; à
 *      390 px chacune tient l'écran, le rail défile de côté (aimanté) et la
 *      page s'ouvre sur « Actifs » ;
 *  14. la frise des cinq étapes : sur chaque carte d'« Actif », dans la
 *      tuile, à la même hauteur quelle que soit la demande, fidèle à l'étape ;
 *      absente du tableau d'un projet ;
 *  11. la carte porte DEDANS ce qui la coiffait : le projet en haut à gauche,
 *      l'état (témoin ou badge « en ligne ») dans le coin haut droit, le début
 *      de la description sous le titre sur UNE ligne, la frise dessous, aucune
 *      ancienneté en bas — plus aucune ligne AU-DESSUS de la carte ; au
 *      tableau, la carte ne change pas ;
 *  12. la silhouette de chargement a la forme des cartes : à l'arrivée des
 *      cartes (réponse du démon RETENUE puis relâchée), rien ne saute ;
 *  13. sous le titre, le DÉBUT DE LA DEMANDE : le PREMIER message écrit par
 *      l'utilisateur (pastilles « [fichier: …] » et signes retirés), même
 *      quand la carte n'a pas de description, et avant la description quand
 *      elle en a une ; une carte sans message garde sa description ; le texte
 *      reste après une mise à jour en direct de la carte ; la colonne
 *      « Archiver » fait de même ;
 *  16. la carte d'un PROJET RÉUNI montre en haut à gauche la pile des favicons
 *      de ses membres actifs (comme la colonne de gauche), sur la ligne du nom ;
 *      un groupe sans membre actif et un projet ordinaire gardent leur avatar ;
 *  15. une DEMANDE COMMUNE (mère + filles) est UNE pile : la mère au-dessus,
 *      les bords des autres derrière, le nombre en pied ; tant qu'une fille est
 *      en route, la pile est dans « Actifs » avec sa fille déjà en ligne, et
 *      rien d'elle n'est dans « Archiver » ; elle compte pour une dans les
 *      nombres et les paquets ; le premier clic la DÉPLIE sans ouvrir de
 *      tâche, un clic sur une carte dépliée ouvre sa tâche, un clic dehors ou
 *      Échap la rempile ; dépliées, les filles sont dans un BLOC à fond
 *      contrasté et à marge intérieure (la mère reste dehors), distinct de la
 *      zone et d'une carte (≥ 1,10) dans les deux palettes ; ce fond est plein
 *      sur 90 % de la hauteur et s'estompe jusqu'à la transparence au bord
 *      haut, sous la mère ; une fois toutes
 *      ses cartes sorties de la route, la pile passe ENTIÈRE dans « Terminer »,
 *      puis rangée, ENTIÈRE dans « Archiver » — à 1500 px comme à 390 px ;
 *  17. « Tout archiver » (en haut à droite de « Terminer ») range TOUTE la
 *      colonne, mise en ligne ou non, y compris le paquet pas encore reçu,
 *      sans changer la colonne des cartes dans leur projet ; grisé quand
 *      « Terminer » est vide ; il tient dans l'en-tête à 390 px.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { allerVers, ouvrirLesTableauxDeBord, ouvrirNavigation } from './lib/navigation.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7197);

/** Le texte d'une tête de carte, sans les initiales de l'avatar du projet (décoratives). */
async function texteSansAvatar(page, selecteur) {
  return page.evaluate((sel) => {
    const copie = document.querySelector(sel)?.cloneNode(true);
    if (!copie) return '';
    copie.querySelectorAll('[data-initiales-projet]').forEach((el) => el.remove());
    return (copie.textContent ?? '').replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  }, selecteur);
}
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-en-route-', port: PORT });

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;

function projet(db, id, name, rank, archived = false, extra = {}) {
  const p = { id, name, path: path.join(DEPOT), defaultEngine: 'claude', isSelf: false, rank, archived, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, name, `${DEPOT}-${id}`, archived ? 1 : 0, JSON.stringify({ ...p, path: `${DEPOT}-${id}` }), MAINTENANT, MAINTENANT,
  );
}

/** `derniereAction` : la date de la dernière action (`updated_at`), qui range la page. */
function carte(db, id, projectId, column, title, createdAt, renduA, deployedAt, derniereAction = renduA ?? createdAt) {
  const c = {
    id, projectId, title, description: DESCRIPTIONS[id] ?? DESCRIPTION, labels: ETIQUETTES[id] ?? [], column, position: createdAt,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt, updatedAt: derniereAction,
    ...(renduA ? { renduA } : {}),
    ...(deployedAt ? { deployedAt, archivedAt: deployedAt } : {}),
  };
  // Une carte déjà archivée à la pose est rangée sur la page, comme la migration le fait.
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at, rangee_tableau_de_bord_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, projectId, column, createdAt, title, JSON.stringify(c), deployedAt ?? null, createdAt, derniereAction, column === 'archived' ? derniereAction : null,
  );
}

/** La colonne d'une carte DANS SON PROJET, et son rangement de la page, lus en base. */
function enBase(id) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const ligne = db.prepare('SELECT column_key AS colonne, rangee_tableau_de_bord_at AS rangee FROM cards WHERE id = ?').get(id);
  db.close();
  return ligne ?? null;
}

/**
 * GLISSER UNE CARTE À LA SOURIS vers une colonne de la page : de vrais
 * événements de pointeur (`usePointerDrag`), après avoir SONDÉ que le point
 * d'appui tombe bien sur la carte. Rend la sonde et l'éclairage de la cible.
 */
async function glisser(page, selecteur, versColonne) {
  const carte = page.locator(selecteur).first();
  await carte.scrollIntoViewIfNeeded();
  const b = await carte.boundingBox();
  const x = b.x + b.width - 14;
  const y = b.y + b.height - 12;
  const sonde = await page.evaluate(([px, py, sel]) => !!document.elementFromPoint(px, py)?.closest(sel), [x, y, selecteur]);
  const cible = await page.locator(`[data-colonne-en-route="${versColonne}"]`).boundingBox();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 4, { steps: 3 });
  await page.mouse.move(cible.x + cible.width / 2, cible.y + Math.min(cible.height / 2, 320), { steps: 14 });
  const visee = await page.evaluate(
    (c) => document.querySelector(`[data-colonne-en-route="${c}"]`)?.getAttribute('data-colonne-visee') === 'true',
    versColonne,
  );
  const apercu = (await page.locator('[data-apercu-glisse-en-route]').count()) === 1;
  await page.mouse.up();
  return { sonde, visee, apercu };
}

const DESCRIPTION = 'Carte posée par **verif-en-route** : le début de sa description se lit sous le titre.';
/** Une carte dont le cadrage a seulement RÉPONDU : aucune description écrite. */
const DESCRIPTIONS = { 'c-jamais': '' };
/* Une carte à étiquettes longues, comme celles d'ETSigna : elles se coupaient
   dans le corps à hauteur fixe. */
const ETIQUETTES = { 'c-au-travail': ['signature-electronique', 'recurrent', 'facturation-client'] };

/** Un agent au repos (fin de tour), et les messages de sa conversation. */
function conversation(db, agentId, projectId, cardId, role, messages) {
  const a = { id: agentId, projectId, cardId, role, title: 'Conversation', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: MAINTENANT - 10 * H, updatedAt: MAINTENANT - 10 * H };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)`).run(
    agentId, projectId, cardId, role, JSON.stringify(a), a.createdAt, a.updatedAt,
  );
  messages.forEach(([messageRole, content], i) => {
    const m = { id: `${agentId}-m${i}`, agentId, role: messageRole, content, createdAt: MAINTENANT - 10 * H + i * 60_000 };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, agentId, messageRole, JSON.stringify(m), m.createdAt);
  });
}

const PREMIER_MESSAGE = 'Je veux le début de ma demande sous le titre de la carte';

/** Un cadrage FINI qui a rendu sa compréhension, sur une carte jamais rouverte depuis. */
function comprehensionNonLue(db, cardId, projectId, renduA) {
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(cardId);
  const c = JSON.parse(ligne.data);
  c.parcours = { comprehension: { texte: 'Je vais poser la frise sur chaque carte.', at: renduA } };
  db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify(c), cardId);
  const agentId = `ag-comprise-${cardId}`;
  const a = { id: agentId, projectId, cardId, role: 'cadrage', title: 'Cadrage', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: renduA - H, updatedAt: renduA, endedAt: renduA };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)`).run(
    agentId, projectId, cardId, 'cadrage', JSON.stringify(a), a.createdAt, a.updatedAt,
  );
  [['user', 'Pose une frise sur chaque carte'], ['assistant', 'Voici ce que je comprends.']].forEach(([role, content], i) => {
    const m = { id: `${agentId}-m${i}`, agentId, role, content, createdAt: renduA - H + i * 60_000 };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, agentId, role, JSON.stringify(m), m.createdAt);
  });
}

/** Pose sur une carte déjà créée les champs d'une demande commune (mère ou fille). */
function regrouper(db, cardId, champs) {
  const c = JSON.parse(db.prepare('SELECT data FROM cards WHERE id = ?').get(cardId).data);
  db.prepare('UPDATE cards SET data = ? WHERE id = ?').run(JSON.stringify({ ...c, ...champs }), cardId);
  // Le lien fille → mère est une vraie colonne (`carte_mere_id`) : c'est elle que la page lit.
  if (champs.carteMereId) db.prepare('UPDATE cards SET carte_mere_id = ? WHERE id = ?').run(champs.carteMereId, cardId);
}

function agent(db, id, projectId, cardId, role, title) {
  const a = { id, projectId, ...(cardId ? { cardId } : {}), role, title, run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', startedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = 'running', data = excluded.data, updated_at = excluded.updated_at`,
  ).run(id, projectId, cardId, role, JSON.stringify(a), a.createdAt, a.updatedAt);
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification en route');
  db.prepare('DELETE FROM projects').run();
  projet(db, 'p-alpha', 'Alpha', 1);
  projet(db, 'p-beta', 'Beta', 2);
  projet(db, 'p-rangé', 'Rangé', 3, true);
  // UN PROJET RÉUNI (point 16) : deux membres actifs (un troisième mis de côté),
  // un groupe vide, et une carte sur chacun.
  projet(db, 'p-groupe', 'Groupe', 4, false, { regroupement: true });
  projet(db, 'p-membre-1', 'Membre un', 5, false, { regroupementId: 'p-groupe' });
  projet(db, 'p-membre-2', 'Membre deux', 6, false, { regroupementId: 'p-groupe' });
  projet(db, 'p-membre-range', 'Membre rangé', 7, true, { regroupementId: 'p-groupe' });
  projet(db, 'p-groupe-vide', 'Groupe vide', 8, false, { regroupement: true });
  // En « Demande » : une carte en « Travail » sans agent est rangée en « À
  // déployer » par le balayage du démon, et quitterait « Actifs » en cours d'essai.
  carte(db, 'c-groupe', 'p-groupe', 'planned', 'Carte posée sur le groupe', MAINTENANT - 80 * H, MAINTENANT - 70 * H);
  carte(db, 'c-groupe-vide', 'p-groupe-vide', 'planned', 'Carte posée sur un groupe vide', MAINTENANT - 80 * H, MAINTENANT - 70 * H);
  carte(db, 'c-rendue-recente', 'p-beta', 'to_deploy', 'Rendue il y a une heure', MAINTENANT - 50 * H, MAINTENANT - 1 * H);
  carte(db, 'c-au-travail', 'p-alpha', 'running', 'Au travail maintenant', MAINTENANT - 40 * H, MAINTENANT - 5 * H);
  carte(db, 'c-rendue-vieille', 'p-alpha', 'planned', 'Rendue il y a deux jours', MAINTENANT - 60 * H, MAINTENANT - 48 * H);
  carte(db, 'c-jamais', 'p-beta', 'planned', 'Jamais lancée', MAINTENANT - 2 * H);
  carte(db, 'c-archivee', 'p-alpha', 'archived', 'Carte archivée', MAINTENANT - 3 * H, MAINTENANT);
  carte(db, 'c-projet-range', 'p-rangé', 'running', 'Carte d’un projet mis de côté', MAINTENANT - 3 * H, MAINTENANT);
  // « Archiver » : deux mises en ligne et la carte archivée à la main ci-dessus ;
  // « Terminer » : la carte « À déployer », publiée pendant qu'on regarde.
  // Mise en ligne hier, mais RETOUCHÉE il y a une heure et demie : la dernière
  // action la fait passer devant une mise en ligne plus récente.
  carte(db, 'c-en-ligne-vieille', 'p-alpha', 'archived', 'En ligne depuis hier', MAINTENANT - 80 * H, MAINTENANT - 30 * H, MAINTENANT - 30 * H, MAINTENANT - 1.5 * H);
  carte(db, 'c-en-ligne-recente', 'p-beta', 'archived', 'En ligne depuis deux heures', MAINTENANT - 70 * H, MAINTENANT - 3 * H, MAINTENANT - 2 * H);
  carte(db, 'c-en-ligne-rangee', 'p-rangé', 'archived', 'En ligne, projet mis de côté', MAINTENANT - 70 * H, MAINTENANT - 3 * H, MAINTENANT - 1 * H);
  // Assez de demandes jamais lancées pour dépasser un paquet de vingt.
  for (let i = 0; i < 22; i += 1) carte(db, `c-lot-${String(i).padStart(2, '0')}`, 'p-alpha', 'planned', `Demande en lot ${i}`, MAINTENANT - (100 + i) * H);
  // UNE DEMANDE COMMUNE : une mère (trois étiquettes en plus) et sa fille. Ni
  // étiquette ni pastille de regroupement ne paraît sur leurs cartes.
  // Une seconde fille, DÉJÀ en ligne : tant que sa sœur est en route, elle
  // reste dans la pile d'« Actifs », jamais seule dans « Archiver » (point 15).
  carte(db, 'c-lot-fille-en-ligne', 'p-beta', 'archived', 'Fille déjà en ligne', MAINTENANT - 130 * H, MAINTENANT - 125 * H, MAINTENANT - 125 * H);
  regrouper(db, 'c-lot-00', {
    labels: ['signature-electronique', 'recurrent', 'facturation-client'],
    cartesFilles: [{ projectId: 'p-beta', cardId: 'c-lot-01' }, { projectId: 'p-beta', cardId: 'c-lot-fille-en-ligne' }],
  });
  regrouper(db, 'c-lot-01', { carteMereId: 'c-lot-00' });
  regrouper(db, 'c-lot-fille-en-ligne', { carteMereId: 'c-lot-00' });
  // Le début de la demande : le PREMIER message écrit, jamais la relance.
  conversation(db, 'ag-cadrage-jamais', 'p-beta', 'c-jamais', 'cadrage', [
    ['user', '[fichier: capture.png] Je veux **le début** de ma demande sous le titre de la carte'],
    ['assistant', 'Voici ce que je comprends.'],
    ['user', 'tu peux lancer le travail'],
  ]);
  conversation(db, 'ag-cadrage-travail', 'p-alpha', 'c-au-travail', 'cadrage', [['user', 'Premier message de la carte au travail']]);
  conversation(db, 'ag-cadrage-en-ligne', 'p-beta', 'c-en-ligne-recente', 'cadrage', [['user', 'Mettre la page en ligne ce soir']]);
  // Une compréhension RENDUE et jamais consultée : la carte attend « Valider et
  // lancer », sa frise le dit, et elle se secoue (point 14).
  comprehensionNonLue(db, 'c-rendue-vieille', 'p-alpha', MAINTENANT - 48 * H);
  // UN TOUR COUPÉ PAR LA LIMITE D'UN COMPTE, reprise encore ouverte : la carte
  // attend un quota, et son badge le dit. En « Demande », la relève automatique
  // ne la relance pas (seule une carte « En cours » repart).
  conversation(db, 'ag-sans-quota', 'p-alpha', 'c-lot-03', 'task', [['user', 'Travail coupé par la limite']]);
  const coupe = {
    id: 'ag-sans-quota-limite', agentId: 'ag-sans-quota', role: 'assistant', content: 'Limite du compte atteinte.',
    createdAt: MAINTENANT - 9 * H,
    repriseCompte: { at: MAINTENANT - 9 * H, engine: 'claude', compteEpuise: 'compte-essai', compteEpuiseLabel: 'Compte d’essai', motif: 'texte-de-limite' },
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(coupe.id, coupe.agentId, coupe.role, JSON.stringify(coupe), coupe.createdAt);
  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
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

/** Les identifiants portés par `attribut`, dans toute la page ou dans une colonne (`OngletEnRoute`). */
const idsDe = (page, attribut, colonne) =>
  page
    .locator(`${colonne ? `[data-colonne-en-route="${colonne}"] ` : ''}[${attribut}]`)
    .evaluateAll((els, a) => els.map((el) => el.getAttribute(a)), attribut);

function reposerLesAgents() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  agent(db, 'ag-tache', 'p-alpha', 'c-au-travail', 'task', 'Au travail maintenant');
  agent(db, 'ag-publication', 'p-beta', null, 'deploy', 'Mise en ligne de Beta');
  db.close();
}

/**
 * L'AGENT SANS CARTE, AU FORMAT D'UNE CARTE. La vignette de la bande part du
 * même bord gauche que les cartes et a leur largeur ; elle porte la même tête
 * (projet · rôle, « Au travail » et l'arrêt), le titre, une description et la
 * barre de travail en pied. Sa hauteur suit son contenu : nettement plus basse
 * qu'une carte (06/10/2026). Son seul bouton est l'arrêt : l'ouverture passe
 * par le cadre.
 *
 * LE CADRE VIOLET A DISPARU AVEC LA REFONTE (11/10/2026, « un état ne se dit
 * plus par une couleur ») : une carte Système a « la même tenue que toute
 * carte — un fond pâle, aucun cadre » (`CLASSE_CADRE_SYSTEME`,
 * `web/src/lib/gabarit-tableau.ts`), et c'est sa tête qui dit ce qu'elle est
 * (« Mise en ligne »). On vérifie donc cette tenue : aucun trait autour, et le
 * fond d'une carte ordinaire.
 */
async function verifierLaVignette(page, libelle) {
  // Souris à l'écart : une carte survolée change de fond, et fausserait la comparaison.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(250);
  const mesure = await page.evaluate(() => {
    const vignette = document.querySelector('[data-vignette-agent-en-route="ag-publication"]');
    const carte = document.querySelector('[data-carte-en-route]');
    if (!vignette || !carte) return null;
    const v = vignette.getBoundingClientRect();
    const c = carte.getBoundingClientRect();
    const cadre = vignette.querySelector('[data-ouvrir-agent-en-route]')?.getBoundingClientRect();
    return {
      vignette: { x: Math.round(v.left), l: Math.round(v.width), h: Math.round(v.height) },
      carte: { x: Math.round(c.left), l: Math.round(c.width), h: Math.round(c.height) },
      cadre: cadre ? Math.round(cadre.height) : null,
      description: vignette.querySelector('[data-description-carte]')?.textContent?.trim() ?? '',
      tenue: (() => {
        const cadreEl = vignette.querySelector('[data-ouvrir-agent-en-route]');
        const tuile = carte.querySelector('[data-carte]');
        if (!cadreEl || !tuile) return null;
        const s = getComputedStyle(cadreEl);
        const traits = ['Top', 'Right', 'Bottom', 'Left'].map((c) => (s[`border${c}Style`] === 'none' ? 0 : parseFloat(s[`border${c}Width`])));
        return {
          trait: Math.max(...traits, s.outlineStyle === 'none' ? 0 : parseFloat(s.outlineWidth)),
          fond: s.backgroundColor,
          fondCarte: getComputedStyle(tuile).backgroundColor,
        };
      })(),
      role: vignette.querySelector('[data-role-agent-en-route]')?.textContent?.trim() ?? null,
      projet: vignette.querySelector('[data-tete-gauche] [data-projet-carte]')?.textContent?.trim() ?? null,
      temoin: !!vignette.querySelector('[data-tete-droite] [data-temoin-en-route="travail"]'),
      arret: !!vignette.querySelector('[data-tete-droite] [data-arret-agent-en-route]'),
      boutons: vignette.querySelectorAll('button').length,
      barre: !!vignette.querySelector('[data-barre-agent-en-route] [data-barre-progression]'),
    };
  });
  noter(
    `${libelle} : l'agent sans carte a le bord gauche et la largeur d'une carte`,
    !!mesure && mesure.vignette.x === mesure.carte.x && mesure.vignette.l === mesure.carte.l,
    JSON.stringify(mesure),
  );
  noter(
    `${libelle} : il est nettement plus bas qu'une carte, avec une description, et la tenue d'une carte (aucun cadre, même fond)`,
    /* 0,9 depuis le 25/10/2026 : la carte a perdu sa demande (150 px), la
       vignette a gardé la sienne et pris le même espace intérieur. */
    !!mesure && mesure.vignette.h < mesure.carte.h * 0.9 && mesure.description.length > 0 &&
      !!mesure.tenue && mesure.tenue.trait === 0 && mesure.tenue.fond === mesure.tenue.fondCarte,
    mesure ? `${mesure.vignette.h} px / ${mesure.carte.h} px, « ${mesure.description} », tenue ${JSON.stringify(mesure.tenue)}` : 'absent',
  );
  noter(
    `${libelle} : projet · rôle à gauche, « Au travail » et l'arrêt à droite, barre de travail en pied`,
    !!mesure && mesure.projet === 'Beta' && mesure.role === 'Mise en ligne' && mesure.temoin && mesure.arret && mesure.barre && mesure.boutons === 1,
  );
}

/**
 * UNE COLONNE DE LA PAGE. Toutes ses cartes partent du même bord gauche et ont
 * la même largeur ; toutes leurs tuiles ont la même hauteur. Sur grand écran,
 * les trois colonnes se partagent la largeur, côte à côte ; sur téléphone,
 * chacune prend l'écran moins ses marges.
 */
async function verifierLaColonne(page, onglet, attribut, largeurEcran) {
  const cle = attribut === 'data-carte-terminee' ? 'archive' : 'actif';
  const mesure = await page.evaluate(([a, c]) => {
    const boites = [...document.querySelectorAll(`[data-colonne-en-route="${c}"] [${a}]`)].map((el) => {
      const b = el.getBoundingClientRect();
      const tuile = el.querySelector('[data-carte]')?.parentElement?.getBoundingClientRect();
      return { x: Math.round(b.left), l: Math.round(b.width), h: tuile ? Math.round(tuile.height) : null };
    });
    const boite = (sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? { x: Math.round(r.left), d: Math.round(r.right), y: Math.round(r.top), l: Math.round(r.width) } : null;
    };
    return {
      boites,
      actif: boite('[data-colonne-en-route="actif"]'),
      terminer: boite('[data-colonne-en-route="terminer"]'),
      archive: boite('[data-colonne-en-route="archive"]'),
      page: Math.round(document.querySelector('[data-page-en-route]').getBoundingClientRect().width),
    };
  }, [attribut, cle]);
  const { boites, actif, terminer, archive } = mesure;
  const xs = new Set(boites.map((b) => b.x));
  const ls = new Set(boites.map((b) => b.l));
  const hs = new Set(boites.map((b) => b.h));
  const etiquette = `${onglet}, ${largeurEcran} px`;
  noter(`${etiquette} : les cartes s'alignent dans la colonne`, boites.length > 1 && xs.size === 1 && ls.size === 1, `${boites.length} cartes, x ${[...xs].join('/')}, largeur ${[...ls].join('/')}`);
  noter(`${etiquette} : toutes les tuiles ont la même hauteur`, hs.size === 1 && !hs.has(null), [...hs].join('/'));
  if (largeurEcran > 1000) {
    noter(
      `${etiquette} : les trois colonnes sont côte à côte, à parts égales`,
      !!actif && !!terminer && !!archive &&
        actif.y === terminer.y && terminer.y === archive.y &&
        Math.abs(actif.l - terminer.l) <= 2 && Math.abs(terminer.l - archive.l) <= 2 &&
        terminer.x > actif.d && archive.x > terminer.d && actif.l >= 340,
      JSON.stringify({ actif, terminer, archive }),
    );
  } else {
    const colonne = cle === 'archive' ? archive : actif;
    noter(
      `${etiquette} : la colonne tient l'écran`,
      !!colonne && colonne.l >= mesure.page - 60 && colonne.l <= mesure.page,
      JSON.stringify({ colonne, page: mesure.page }),
    );
  }
}

/**
 * LA DISPOSITION DANS LA CARTE : rien au-dessus d'elle ; en haut à gauche le
 * projet, dans le coin haut droit l'état ; sous le titre — sur DEUX lignes au
 * plus — directement la frise des étapes : la demande ne s'écrit plus sur la
 * vignette (25/10/2026), elle se lit dans la pastille « i ». AUCUNE ancienneté en bas (12/10/2026,
 * « gagner un peu en hauteur ») ; seule l'heure du rendu (26/10/2026, `verifierLHeureDuRendu`). Mesuré sur des boîtes, par rapport à la tuile.
 */
async function verifierLaDisposition(page, onglet, attribut, id) {
  const m = await page.evaluate(
    ([a, cle]) => {
      const bloc = document.querySelector(`[${a}="${cle}"]`);
      const tuile = bloc?.querySelector('[data-carte]');
      const r = (sel) => {
        const el = tuile?.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { g: Math.round(b.left), d: Math.round(b.right), h: Math.round(b.top), b: Math.round(b.bottom) };
      };
      const t = tuile?.getBoundingClientRect();
      return {
        bloc: bloc ? Math.round(bloc.getBoundingClientRect().top) : null,
        tuile: t ? { g: Math.round(t.left), d: Math.round(t.right), h: Math.round(t.top), b: Math.round(t.bottom) } : null,
        projet: r('[data-tete-gauche]'),
        droite: r('[data-tete-droite]'),
        titre: r('h3'),
        description: tuile?.querySelector('[data-description-carte]') ? 1 : 0,
        frise: r('[data-frise-suivi]'),
        anciennete: tuile?.querySelector('[data-anciennete-carte]') ? 1 : 0,
      };
    },
    [attribut, id],
  );
  const { tuile, projet, droite, titre, description, frise, anciennete } = m;
  const ok =
    !!tuile && !!projet && !!droite && !!titre && description === 0 && !!frise &&
    m.bloc === tuile.h &&
    projet.g - tuile.g <= 16 && projet.h - tuile.h <= 18 &&
    // Une carte jamais rendue n'a rien dans le coin droit : il n'y a rien à y mesurer.
    (droite.d === droite.g || (tuile.d - droite.d <= 16 && droite.h - tuile.h <= 18)) &&
    projet.b <= titre.h + 2 &&
    frise.h >= titre.b - 1 && frise.g - tuile.g <= 16 &&
    anciennete === 0;
  noter(`${onglet} : projet en haut à gauche, état en haut à droite, frise sous le titre, ni description ni ancienneté`, ok, JSON.stringify(m));
}

/**
 * LE PIED D'UNE CARTE EST VIDE. Sur « Tableaux de bord », la tuile ne porte plus
 * d'ancienneté en bas à gauche (12/10/2026) ; ni étiquette ni pastille de
 * demande commune (« Beta · … » sur la mère, « Part d'une demande de … » sur la
 * fille) ne s'y posent non plus : la pile dépliée montre déjà la mère et ses
 * filles. La frise est le dernier mot de la tuile.
 */
async function verifierLePied(page, onglet, ids) {
  const m = await page.evaluate((cles) =>
    cles.map((cle) => {
      const tuile = document.querySelector(`[data-carte-en-route="${cle}"] [data-carte]`);
      return {
        cle,
        anciennete: tuile?.querySelectorAll('[data-anciennete-carte]').length ?? -1,
        frise: tuile?.querySelectorAll('[data-frise-suivi]').length ?? -1,
        pastilles: tuile?.querySelectorAll(
          '[data-etiquettes-carte], [data-fille-badge], [data-carte-mere], [data-cartes-filles], .rounded-md.border:not([data-badge-etape])',
        ).length ?? -1,
      };
    }),
    ids,
  );
  noter(
    `${onglet} : le pied des cartes n'a ni ancienneté, ni étiquette, ni pastille de sous-carte`,
    m.every((c) => c.anciennete === 0 && c.frise === 1 && c.pastilles === 0),
    JSON.stringify(m),
  );
}

/**
 * L'HEURE DU RENDU EN BAS À GAUCHE (26/10/2026, capture #c866) : une carte
 * rendue la porte sous sa frise, alignée sur elle, entière dans la tuile, en
 * « il y a … » (« il y a 2 jours » pour la carte rendue il y a 48 h) ; une
 * carte jamais rendue n'en a pas ; une carte à bande de travail non plus.
 */
async function verifierLHeureDuRendu(page, onglet) {
  /* Toutes les cartes montées : sur téléphone, toutes ne le sont pas, et
     l'agent factice de « c-au-travail » peut avoir été refermé (sa bande part). */
  const m = await page.evaluate(() =>
    [...document.querySelectorAll('[data-carte-en-route]')].map((carte) => {
      const tuile = carte.querySelector('[data-carte]');
      const heure = tuile?.querySelector('[data-heure-de-rendu]');
      const frise = tuile?.querySelector('[data-frise-suivi]')?.getBoundingClientRect();
      const base = { cle: carte.getAttribute('data-carte-en-route'), bande: !!tuile?.nextElementSibling, heure: !!heure };
      if (!heure || !frise) return base;
      const h = heure.getBoundingClientRect();
      const t = tuile.getBoundingClientRect();
      return { ...base, texte: heure.textContent, gauche: Math.round(h.left - frise.left), sous: Math.round(h.top - frise.bottom), dedans: Math.round(t.bottom - h.bottom) };
    }),
  );
  const avecHeure = m.filter((c) => c.heure);
  const vieille = m.find((c) => c.cle === 'c-rendue-vieille');
  noter(
    `${onglet} : l'heure du rendu en bas à gauche, sous la frise, entière dans la carte, en « il y a … » ; ni sur une carte jamais rendue, ni sous une bande de travail`,
    avecHeure.length > 0 &&
      avecHeure.every((c) => /^(à l’instant|il y a \d+ (min|h|jours?))$/.test(c.texte ?? '') && Math.abs(c.gauche) <= 2 && c.sous >= 4 && c.dedans >= 2) &&
      m.every((c) => !(c.bande && c.heure)) &&
      !m.find((c) => c.cle === 'c-jamais')?.heure &&
      (!vieille || (vieille.heure && vieille.texte === 'il y a 2 jours')),
    JSON.stringify({ avecHeure: avecHeure.slice(0, 3), vieille, sansHeure: m.filter((c) => !c.heure).map((c) => c.cle) }),
  );
}

/**
 * LE BADGE DE STATUT (18/10/2026) : jaune à la Compréhension, violet au Travail,
 * avec un trait et un léger fond de la même teinte, jamais la carte entière.
 * Il tient dans la tête de 18 px sans la faire bouger.
 */
async function verifierLeBadgeDEtape(page, onglet, ids) {
  const m = await page.evaluate((cles) =>
    cles.map((cle) => {
      const tuile = document.querySelector(`[data-carte-en-route="${cle}"] [data-carte]`);
      const badge = tuile?.querySelector('[data-badge-etape]');
      const tete = tuile?.querySelector('[data-tete-carte-en-route]');
      if (!badge || !tete) return { cle, badge: false };
      const style = getComputedStyle(badge);
      const carte = getComputedStyle(tuile);
      return {
        cle,
        ton: badge.getAttribute('data-badge-etape'),
        etape: tuile.closest('[data-carte-en-route]')?.getAttribute('data-etape'),
        trait: style.borderTopWidth !== '0px' && style.borderTopColor !== 'rgba(0, 0, 0, 0)',
        fond: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
        carteNeutre: carte.borderTopWidth === '0px',
        hauteur: Math.round(badge.getBoundingClientRect().height),
        dansLaTete: badge.getBoundingClientRect().height <= tete.getBoundingClientRect().height + 0.5,
      };
    }),
    ids,
  );
  const attendu = { comprehension: 'comprehension', travail: 'travail' };
  noter(
    `${onglet} : le badge de statut prend la couleur de l'étape (jaune Compréhension, violet Travail), trait et fond, sans agrandir la tête`,
    m.length > 0 &&
      m.every((c) => c.badge !== false && c.ton === attendu[c.etape] && c.trait && c.fond && c.carteNeutre && c.dansLaTete),
    JSON.stringify(m),
  );
}

/**
 * LES CARTES D'UN PROJET RÉUNI (point 16) : en haut à gauche, la pile des
 * favicons de ses membres actifs — comme sa ligne de la colonne de gauche —
 * au lieu d'une lettre ; un groupe sans membre actif et un projet ordinaire
 * gardent leur avatar simple. La ligne du haut ne saute pas : le nom reste sur
 * la même ligne que la pile.
 */
async function verifierLesCartesDeGroupe(page, onglet) {
  const m = await page.evaluate(() => {
    const lire = (id) => {
      const tete = document.querySelector(`[data-carte-en-route="${id}"] [data-tete-gauche]`);
      const pile = tete?.querySelector('[data-pile-favicons]');
      const nom = tete?.querySelector('[data-projet-carte]');
      const rp = pile?.getBoundingClientRect();
      const rn = nom?.getBoundingClientRect();
      return {
        id,
        pile: pile ? Number(pile.getAttribute('data-pile-favicons')) : 0,
        largeur: rp ? Math.round(rp.width) : 0,
        simple: !!tete?.querySelector('[data-favicon-projet], [data-initiales-projet]'),
        memeLigne: !!rp && !!rn && Math.abs((rp.top + rp.bottom) / 2 - (rn.top + rn.bottom) / 2) < 3,
      };
    };
    return ['c-groupe', 'c-groupe-vide', 'c-au-travail'].map(lire);
  });
  const [groupe, vide, ordinaire] = m;
  noter(
    `${onglet} : la carte d'un groupe montre la pile de ses deux membres actifs, sur la ligne du nom`,
    groupe.pile === 2 && groupe.largeur === 22 && groupe.memeLigne,
    JSON.stringify(groupe),
  );
  noter(
    `${onglet} : un groupe sans membre actif et un projet ordinaire gardent leur avatar simple`,
    vide.pile === 0 && vide.simple && ordinaire.pile === 0 && ordinaire.simple,
    JSON.stringify([vide, ordinaire]),
  );
}

/** Déplie la pile de la demande commune d'« Actifs » (le voile capte le clic). */
async function deplierLaPile(page) {
  const pile = page.locator('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]');
  if ((await pile.getAttribute('data-pile-ouverte')) === 'true') return;
  await pile.locator('[data-masque-pile]').scrollIntoViewIfNeeded();
  await pile.locator('[data-masque-pile]').click();
  await page.waitForFunction(() => document.querySelector('[data-pile-en-route="c-lot-00"]')?.getAttribute('data-pile-ouverte') === 'true');
  await page.waitForTimeout(500);
}

/**
 * LA PILE D'UNE DEMANDE COMMUNE (point 15), dans « Actifs » : la mère au-dessus,
 * repliée, trois cartes ; rien d'elle dans « Terminer » ni « Archiver » ; le premier clic la
 * déplie sans ouvrir la tâche ; une carte dépliée ouvre sa tâche ; un clic
 * dehors, puis Échap, la rempilent.
 */
async function verifierLaPile(page, libelle) {
  const pile = page.locator('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]');
  await pile.scrollIntoViewIfNeeded();
  const repliee = await page.evaluate(() => {
    const el = document.querySelector('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]');
    return {
      piles: document.querySelectorAll('[data-pile-en-route="c-lot-00"]').length,
      ouverte: el?.getAttribute('data-pile-ouverte') ?? null,
      nombre: el?.getAttribute('data-nombre-pile') ?? null,
      cartes: [...(el?.querySelectorAll('[data-carte]') ?? [])].map((c) => c.getAttribute('data-carte')),
      pastille: el?.querySelector('[data-compte-pile]')?.textContent?.trim() ?? null,
      horsPile: document.querySelectorAll('[data-carte="c-lot-01"], [data-carte="c-lot-fille-en-ligne"]').length,
      enTermine: document.querySelectorAll(
        '[data-colonne-en-route="terminer"] [data-carte="c-lot-fille-en-ligne"], [data-colonne-en-route="archive"] [data-carte="c-lot-fille-en-ligne"]',
      ).length,
    };
  });
  noter(
    `${libelle} : la demande commune est UNE pile repliée, la mère au-dessus, avec son nombre`,
    repliee.piles === 1 && repliee.ouverte === 'false' && repliee.nombre === '3' && repliee.pastille === '3' &&
      JSON.stringify(repliee.cartes) === JSON.stringify(['c-lot-00']) && repliee.horsPile === 0,
    JSON.stringify(repliee),
  );
  noter(`${libelle} : sa fille déjà en ligne n’est ni dans « Terminer » ni dans « Archiver »`, repliee.enTermine === 0, JSON.stringify(repliee));

  await pile.locator('[data-masque-pile]').click();
  await page.waitForTimeout(700);
  const depliee = await page.evaluate(() => {
    const el = document.querySelector('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]');
    const cartes = [...(el?.querySelectorAll('[data-carte]') ?? [])];
    const boites = cartes.map((c) => c.getBoundingClientRect());
    return {
      ouverte: el?.getAttribute('data-pile-ouverte') ?? null,
      cartes: cartes.map((c) => c.getAttribute('data-carte')),
      lesUnesSousLesAutres: boites.every((b, i) => i === 0 || b.top >= boites[i - 1].bottom - 1),
      /* Les filles partagent un même bord et une même largeur ; la mère, hors du bloc, est plus large. */
      memeLargeur:
        boites.slice(1).every((b) => Math.abs(b.width - boites[1].width) < 1 && Math.abs(b.left - boites[1].left) < 1) &&
        boites[0].width > boites[1].width + 8 && boites[0].left < boites[1].left - 4,
      tiroir: document.querySelectorAll('[data-tiroir]').length,
      masque: el?.querySelectorAll('[data-masque-pile]').length ?? -1,
      badgeEnLigne: !!el?.querySelector('[data-carte-terminee="c-lot-fille-en-ligne"] [data-date-mise-en-ligne]'),
    };
  });
  noter(
    `${libelle} : le premier clic DÉPLIE la pile, sans ouvrir de tâche`,
    depliee.ouverte === 'true' && depliee.tiroir === 0 && depliee.masque === 0 &&
      JSON.stringify([...depliee.cartes].sort()) === JSON.stringify(['c-lot-00', 'c-lot-01', 'c-lot-fille-en-ligne']) &&
      depliee.cartes[0] === 'c-lot-00',
    JSON.stringify(depliee),
  );
  noter(
    `${libelle} : dépliées, les cartes sont l’une sous l’autre, au même bord, la fille publiée avec son badge`,
    depliee.lesUnesSousLesAutres && depliee.memeLargeur && depliee.badgeEnLigne,
    JSON.stringify(depliee),
  );

  /* LE BLOC DES SOUS-CARTES : un fond à lui, une marge intérieure, les filles
     dedans et la mère dehors, et dans les DEUX palettes (clair, sombre) un
     contraste d'au moins 1,10 avec la zone ET avec une carte — mesuré sur la couleur CALCULÉE
     (un `color-mix` se lit en canaux 0-1 : on passe par un canevas).
     Ce fond est un DÉGRADÉ (plein jusqu'à 90 %, transparent au bord haut) : le
     `background-color` du bloc est donc transparent, et la couleur PLEINE se
     lit sur une sonde qui porte `--fond-bloc-sous-cartes` en fond. */
  const bloc = await page.evaluate(() => {
    const el = document.querySelector('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]');
    const b = el?.querySelector('[data-bloc-sous-cartes]');
    const style = b ? getComputedStyle(b) : null;
    return {
      present: !!b,
      cartes: [...(b?.querySelectorAll('[data-carte]') ?? [])].map((c) => c.getAttribute('data-carte')).sort(),
      mereDehors: !!el?.querySelector('[data-carte="c-lot-00"]') && !b?.querySelector('[data-carte="c-lot-00"]'),
      // Les côtés et le bas gardent leur marge ; le haut, lui, est court (plus bas).
      padding: style ? Math.min(...['Right', 'Bottom', 'Left'].map((c) => parseFloat(style[`padding${c}`]))) : 0,
      /* L'ÉCART SOUS LA MÈRE : du haut de la zone dépliée (collée sous la mère)
         au haut de la première fille. Court — les filles sortent de la mère —
         sans être nul : elles ne s'y collent pas. */
      ecart: (() => {
        const dessous = el?.querySelector('[data-dessous-pile]');
        const fille = b?.querySelector('[data-carte]');
        return dessous && fille ? Math.round((fille.getBoundingClientRect().top - dessous.getBoundingClientRect().top) * 10) / 10 : -1;
      })(),
      fondu: style?.backgroundImage ?? '',
      masque: style?.maskImage ?? '',
      debordeLateral: b ? [...b.querySelectorAll('[data-carte]')].some((c) => c.getBoundingClientRect().right > b.getBoundingClientRect().right + 0.5) : true,
      debordeEcran: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  noter(
    `${libelle} : dépliée, les filles sont dans un bloc à marge intérieure, la mère au-dessus et hors du bloc`,
    bloc.present && bloc.mereDehors && bloc.padding >= 8 && !bloc.debordeLateral && !bloc.debordeEcran &&
      JSON.stringify(bloc.cartes) === JSON.stringify(['c-lot-01', 'c-lot-fille-en-ligne']),
    JSON.stringify(bloc),
  );
  noter(
    `${libelle} : la première fille est à moins de 10 px sous la mère, sans s'y coller`,
    bloc.ecart >= 4 && bloc.ecart <= 10,
    `${bloc.ecart} px`,
  );
  noter(
    `${libelle} : le fond du bloc est plein jusqu'à 90 % puis s'estompe vers le haut, sans masque sur les filles`,
    /^linear-gradient\(to top, .+ 90%, (transparent|rgba\(0, 0, 0, 0\))( 100%)?\)$/.test(bloc.fondu) && bloc.masque === 'none',
    JSON.stringify({ fondu: bloc.fondu, masque: bloc.masque }),
  );
  /* SOURIS À L'ÉCART : depuis la refonte une carte survolée change de FOND
     (`hover:bg-raised`). Le clic qui déplie la pile laisse la souris sur une
     fille : mesurée ainsi, elle paraissait se détacher du bloc. On juge la
     carte au repos. */
  await page.mouse.move(2, 2);
  await page.waitForTimeout(350);
  const contrastes = await page.evaluate(() => {
    const el = document.querySelector('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]');
    const b = el.querySelector('[data-bloc-sous-cartes]');
    const carte = b.querySelector('[data-carte]');
    /* Le fond RÉEL sous le bloc : la colonne, qui porte son propre fond depuis le 12/10/2026, sinon la zone. */
    const zone = b.closest('.fond-de-colonne-tableau, [data-zone]');
    /* La sonde hérite la couleur pleine du bloc, hors flux : elle ne déplace rien. */
    const sonde = document.createElement('div');
    sonde.style.cssText = 'position:absolute;width:0;height:0;background-color:var(--fond-bloc-sous-cartes)';
    b.append(sonde);
    const canevas = document.createElement('canvas');
    canevas.width = canevas.height = 1;
    const g = canevas.getContext('2d', { willReadFrequently: true });
    const rgb = (css) => {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = '#000';
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const lum = ([r, v, bl]) => {
      const f = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(v) + 0.0722 * f(bl);
    };
    const rapport = (a, c) => (Math.max(lum(a), lum(c)) + 0.05) / (Math.min(lum(a), lum(c)) + 0.05);
    const racine = document.documentElement;
    const avant = { theme: racine.dataset.theme, sombre: racine.classList.contains('dark') };
    /* Les cartes ont `transition-colors` : sans l'éteindre, on lirait une couleur à mi-course. */
    const sansTransition = document.createElement('style');
    sansTransition.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.append(sansTransition);
    /* DEUX PALETTES depuis la refonte (noir et blanc) : les six ambiances ont disparu. */
    const palettes = { sombre: 1, clair: 0 };
    const pires = {};
    for (const [theme, sombre] of Object.entries(palettes)) {
      racine.dataset.theme = theme;
      racine.classList.toggle('dark', !!sombre);
      const zoneRgb = rgb(getComputedStyle(zone).backgroundColor);
      const blocRgb = rgb(getComputedStyle(sonde).backgroundColor);
      const carteRgb = rgb(getComputedStyle(carte).backgroundColor);
      pires[theme] = [Number(rapport(zoneRgb, blocRgb).toFixed(3)), Number(rapport(blocRgb, carteRgb).toFixed(3))];
    }
    racine.dataset.theme = avant.theme;
    racine.classList.toggle('dark', avant.sombre);
    sansTransition.remove();
    sonde.remove();
    return pires;
  });
  const faibles = Object.entries(contrastes).filter(([, [zone, carte]]) => zone < 1.1 || carte < 1.1);
  noter(
    `${libelle} : le fond du bloc se distingue de la zone et d'une carte (≥ 1,10) dans les deux palettes, clair et sombre`,
    Object.keys(contrastes).length === 2 && faibles.length === 0,
    faibles.length ? JSON.stringify(faibles) : `pire : ${Math.min(...Object.values(contrastes).flat())} — ${JSON.stringify(contrastes)}`,
  );
  /* Le fondu se juge À L'ŒIL : la pile dépliée, en sombre puis en clair. */
  const taille = libelle.includes('390') ? 'telephone' : 'bureau';
  const poserPalette = (theme, sombre) =>
    page.evaluate(([t, s]) => {
      const avant = [document.documentElement.dataset.theme, document.documentElement.classList.contains('dark')];
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', s);
      return avant;
    }, [theme, sombre]);
  /* Les cartes ont `transition-colors` : on attend la fin avant chaque capture. */
  const paletteAvant = await poserPalette('sombre', true);
  await page.waitForTimeout(400);
  await pile.screenshot({ path: `/tmp/verif-en-route-bloc-${taille}-sombre.png` });
  await poserPalette('clair', false);
  await page.waitForTimeout(400);
  await pile.screenshot({ path: `/tmp/verif-en-route-bloc-${taille}-clair.png` });
  await poserPalette(...paletteAvant);

  await page.locator('[data-colonne-en-route="actif"] header').click();
  await page.waitForTimeout(500);
  noter(
    `${libelle} : un clic dehors la rempile`,
    (await pile.getAttribute('data-pile-ouverte')) === 'false' && (await page.locator('[data-carte="c-lot-01"]').count()) === 0,
  );

  await pile.locator('[data-masque-pile]').click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  noter(`${libelle} : Échap la rempile aussi`, (await pile.getAttribute('data-pile-ouverte')) === 'false');

  await pile.locator('[data-masque-pile]').click();
  await page.waitForTimeout(600);
  await page.locator('[data-carte="c-lot-01"]').click();
  await page.waitForTimeout(1200);
  const tiroir = page.locator('[data-tiroir]');
  const texte = (await tiroir.count()) ? await tiroir.first().innerText() : '';
  noter(`${libelle} : dépliée, une carte ouvre sa tâche`, texte.includes('Demande en lot 1'), texte.slice(0, 60).replace(/\s+/g, ' '));
  await page.screenshot({ path: `/tmp/verif-en-route-pile-${libelle.includes('390') ? 'telephone' : 'bureau'}.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  if ((await pile.getAttribute('data-pile-ouverte')) === 'true') {
    await page.locator('[data-colonne-en-route="actif"] header').click();
    await page.waitForTimeout(400);
  }
}

/**
 * DE L'AIR SOUS LA FRISE : entre le bas de ses ronds et le bord bas de la tuile,
 * au moins 4 px, sur toutes les cartes de l'onglet. La tuile passe PAR-DESSUS la
 * bande de travail (`z-10`, bande en `-mt-1`) : son bord bas est la limite
 * visible, bande en pied ou non. C'est la hauteur fixe d'une carte
 * (`CLASSE_HAUTEUR_CARTE_EN_ROUTE`) qui le garantit : une bande ne doit jamais
 * couper la frise.
 */
async function verifierLAirSousLHeure(page, onglet, remettreAuTravail) {
  const mesurer = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-carte-en-route]')].map((carte) => {
        const tuile = carte.querySelector('[data-carte]');
        const ronds = [...(tuile?.querySelectorAll('[data-frise-suivi] [data-etape-suivi]') ?? [])].map((r) => r.getBoundingClientRect());
        const bande = !!tuile?.nextElementSibling;
        const bas = (tuile?.getBoundingClientRect().bottom ?? 0) - (tuile?.clientTop ?? 0);
        const basDesRonds = ronds.length ? Math.max(...ronds.map((r) => r.bottom)) : null;
        return { id: carte.getAttribute('data-carte-en-route'), bande, air: basDesRonds !== null ? Math.round((bas - basDesRonds) * 10) / 10 : null };
      }),
    );
  let m = await mesurer();
  /* IL FAUT UNE CARTE À BANDE AU MOMENT DE LA MESURE. L'agent factice est
     refermé par l'ordonnanceur (un passage toutes les quinze secondes) : la
     bande a pu partir pendant les essais qui précèdent. On repose alors
     l'agent, on recharge, et on remesure — trois fois au plus. La règle ne
     bouge pas : une carte à bande au moins, et de l'air sur toutes. */
  for (let essai = 0; essai < 3 && remettreAuTravail && !m.some((c) => c.bande); essai += 1) {
    await remettreAuTravail();
    m = await mesurer();
  }
  /* La preuve à l'œil : la carte au travail, sa bande en pied (souris à l'écart, sans survol). */
  await page.mouse.move(2, 2);
  await page
    .locator('[data-carte-en-route="c-au-travail"]')
    .first()
    .screenshot({ path: `/tmp/verif-en-route-frise-${onglet.includes('téléphone') ? 'telephone' : 'bureau'}.png` })
    .catch(() => {});
  noter(
    `${onglet} : la frise respire, au moins 4 px au-dessus de la bande de travail ou du bord`,
    m.length > 0 && m.some((c) => c.bande) && m.every((c) => c.air != null && c.air >= 4),
    JSON.stringify(m.filter((c) => c.bande || c.air == null || c.air < 4).concat(m.slice(0, 1))),
  );
}

/**
 * RIEN NE SAUTE À L'ARRIVÉE DES CARTES. La réponse du démon à la page (celle
 * qui porte `restant`) est RETENUE dans la page, le temps de mesurer la
 * silhouette, puis relâchée : on compare gauche, largeur, hauteur et haut
 * (relatif à la liste) des six premières boîtes, à 2 px près.
 */
async function verifierLaSilhouette(contexte) {
  const page = await contexte.newPage();
  await page.addInitScript(() => {
    const file = [];
    let retenir = true;
    const Natif = window.WebSocket;
    window.WebSocket = class extends Natif {
      constructor(...args) {
        super(...args);
        const garder = (ev) => retenir && typeof ev.data === 'string' && ev.data.includes('"restant":');
        const ajouter = this.addEventListener.bind(this);
        this.addEventListener = (type, h, o) =>
          ajouter(type, type === 'message' ? (ev) => (garder(ev) ? file.push(() => h.call(this, ev)) : h.call(this, ev)) : h, o);
        let courant = null;
        ajouter('message', (ev) => {
          if (!courant) return;
          if (garder(ev)) file.push(() => courant.call(this, ev));
          else courant.call(this, ev);
        });
        Object.defineProperty(this, 'onmessage', { get: () => courant, set: (h) => (courant = h) });
      }
    };
    window.__relacherEnRoute = () => {
      retenir = false;
      for (const f of file.splice(0)) f();
    };
  });
  const boites = (selecteur, liste) =>
    page.evaluate(
      ([sel, l]) => {
        const haut = document.querySelector(l).getBoundingClientRect().top;
        return [...document.querySelectorAll(sel)].slice(0, 6).map((el) => {
          const b = el.getBoundingClientRect();
          return { g: Math.round(b.left), l: Math.round(b.width), t: Math.round(b.height), h: Math.round(b.top - haut) };
        });
      },
      [selecteur, liste],
    );
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-silhouette="en-route"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  const avant = await boites('[data-silhouette="en-route"] > div', '[data-silhouette="en-route"]');
  await page.evaluate(() => window.__relacherEnRoute());
  await page.locator('[data-carte-en-route]').first().waitFor({ state: 'attached', timeout: 20_000 });
  const apres = await boites('[data-liste-en-route] > [data-carte-en-route]', '[data-liste-en-route]');
  const ecart = Math.max(
    ...avant.map((b, i) => (apres[i] ? Math.max(...['g', 'l', 't', 'h'].map((k) => Math.abs(b[k] - apres[i][k]))) : Infinity)),
  );
  noter(
    'la silhouette a la forme des cartes : rien ne saute à leur arrivée',
    avant.length === 6 && apres.length === 6 && ecart <= 2,
    `${avant.length}/${apres.length} boîtes, écart max ${ecart} px`,
  );
  await page.close();
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1500, height: 950 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  // Un agent fabriqué sans moteur est refermé par la veille du démon au bout de
  // quelques secondes : on le repose juste avant de regarder l'écran.
  reposerLesAgents();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  /* L'application s'ouvre sur un projet, où la colonne de gauche porte SES options :
     on remonte à la page de tous les projets par la flèche de retour de la tête. */
  await ouvrirLesTableauxDeBord(page);
  await page.locator('[data-liste-en-route]').waitFor({ timeout: 20_000 });

  /* 1. La colonne n'a PLUS de bouton « Tableaux de bord » (12/10/2026) : on y
     va par le fil d'Ariane, le menu du titre ou la grille des services. Le
     bouton des services est dans la barre d'en-tête, tout à gauche du fil. */
  const places = await page.evaluate(() => {
    const colonne = document.querySelector('aside[data-zone="gauche"]');
    const visible = (el) => !!el && el.getClientRects().length > 0;
    const y = (el) => (visible(el) ? Math.round(el.getBoundingClientRect().top) : null);
    const nav = [...document.querySelectorAll('[data-navigation-compacte]')].filter(visible);
    return {
      tete: y(colonne?.querySelector('[data-titre-projets]')),
      bouton: colonne?.querySelectorAll('[data-ouvrir-en-route]').length ?? -1,
      projet: y([...(colonne?.querySelectorAll('[data-projet-cible]') ?? [])].find(visible)),
      navDansLaColonne: nav.filter((el) => colonne?.contains(el)).length,
      navDansLaBarre: nav.filter((el) => !!el.closest('[data-entete-de-zone]')).length,
    };
  });
  noter(
    'la colonne n’a plus de bouton « Tableaux de bord » ; les services sont dans la barre d’en-tête',
    places.bouton === 0 && places.navDansLaColonne === 0 && places.navDansLaBarre === 1,
    JSON.stringify(places),
  );
  noter('la pile flottante du pied de colonne a disparu', (await page.locator('[data-pile-agents-colonne]').count()) === 0);

  /* 2. La page s'ouvre : d'un service (le coffre), la ligne « Tableaux de bord »
     de la grille des services — éteinte hors de la page — y ramène ; une fois
     sur la page, cette même ligne est « courante » (`aria-current`). */
  await allerVers(page, 'coffre');
  await page.locator('[data-page-en-route]').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  /* La grille qui vient de servir se referme : on attend qu'elle ait fini. */
  await page.locator('[data-navigation-panneau="ouvert"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  await ouvrirNavigation(page);
  const ligneEteinte = await page.evaluate(() => {
    const visible = (el) => el.getClientRects().length > 0;
    const lignes = [...document.querySelectorAll('[data-navigation-panneau="ouvert"] [data-ouvrir-en-route]')].filter(visible);
    return {
      lignes: lignes.length,
      courantes: lignes.filter((el) => el.hasAttribute('aria-current')).length,
      adresse: location.hash,
      page: document.querySelectorAll('[data-page-en-route]').length,
    };
  });
  noter(
    'hors de la page, la ligne « Tableaux de bord » de la grille est éteinte',
    ligneEteinte.lignes === 1 && ligneEteinte.courantes === 0 && ligneEteinte.page === 0 && ligneEteinte.adresse !== '#en-route',
    JSON.stringify(ligneEteinte),
  );
  reposerLesAgents();
  await page.locator('[data-navigation-panneau="ouvert"] [data-ouvrir-en-route]:visible').first().click();
  await page.locator('[data-liste-en-route]').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  noter('l’adresse devient « #en-route »', page.url().endsWith('#en-route'), page.url());
  await ouvrirNavigation(page);
  noter(
    'la ligne de la grille s’allume sur la page',
    (await page.locator('[data-navigation-panneau="ouvert"] [data-ouvrir-en-route][aria-current]:visible').count()) === 1,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const ids = await idsDe(page, 'data-carte-en-route', 'actif');
  noter('les deux projets en service y sont', ids.includes('c-jamais') && ids.includes('c-au-travail'), ids.slice(0, 5).join(', '));
  noter('ni carte À déployer, ni carte archivée, ni projet mis de côté', !ids.includes('c-rendue-recente') && !ids.includes('c-archivee') && !ids.includes('c-projet-range'));
  noter('un premier paquet de vingt, pas plus', ids.length === 20, `${ids.length} cartes`);
  await page.locator('[data-liste-a-terminer]').waitFor({ timeout: 20_000 });
  const aTerminer = await idsDe(page, 'data-carte-en-route', 'terminer');
  noter('« Terminer » : la carte À déployer, et elle seule', JSON.stringify(aTerminer) === JSON.stringify(['c-rendue-recente']), aTerminer.join(', '));

  /* 3. L'ordre : la dernière action, rendue ou non. */
  noter(
    'la dernière action en haut, qu’elle ait rendu un tour ou non',
    JSON.stringify(ids.slice(0, 3)) === JSON.stringify(['c-jamais', 'c-au-travail', 'c-rendue-vieille']),
    ids.slice(0, 3).join(' → '),
  );
  noter('aucun intertitre dans la liste', (await page.locator('[data-page-en-route] [data-liste-en-route] h2').count()) === 0);

  /* 11. La disposition DANS la carte, colonne « Actifs ». */
  await verifierLaDisposition(page, 'Actif', 'data-carte-en-route', 'c-rendue-recente');
  noter(
    'le projet et l’étape sont en haut à gauche',
    (await texteSansAvatar(page, '[data-carte-en-route="c-rendue-recente"] [data-tete-gauche]')) === 'Beta · À déployer',
    await texteSansAvatar(page, '[data-carte-en-route="c-rendue-recente"] [data-tete-gauche]'),
  );
  /* L'AVATAR DU PROJET, PAS LE DOSSIER GÉNÉRIQUE : favicon ou initiales, comme
     dans la colonne de gauche, posé devant le nom. */
  const avatar = await page.evaluate(() => {
    const tete = document.querySelector('[data-carte-en-route="c-rendue-recente"] [data-tete-gauche]');
    const premier = tete?.firstElementChild;
    return {
      avatar: !!premier && (premier.hasAttribute('data-favicon-projet') || premier.hasAttribute('data-initiales-projet')),
      initiales: premier?.textContent ?? '',
      dossier: !!tete?.querySelector('svg.lucide-folder'),
    };
  });
  noter(
    'l’avatar du projet précède son nom, plus aucune icône de dossier',
    avatar.avatar && !avatar.dossier,
    JSON.stringify(avatar),
  );
  noter(
    '« Rendue il y a… » est dans le coin haut droit',
    /^Rendue il y a/.test((await page.locator('[data-carte-en-route="c-rendue-recente"] [data-tete-droite]').innerText()).trim()),
  );
  /* 13. Le début de la demande ne s'écrit plus sur la vignette (25/10/2026) :
     il se lit dans la pastille « i », toujours là dès qu'il existe. */
  const extrait = async (attribut, id) => {
    await page.mouse.move(2, 2);
    await page.waitForFunction(() => !document.querySelector('[data-bulle-info]'), null, { timeout: 3000 }).catch(() => {});
    const bouton = page.locator(`[${attribut}="${id}"] [data-texte-coupe] button`);
    if (!(await bouton.count())) return null;
    await bouton.hover();
    const el = page.locator('[data-bulle-info] [data-description-carte]');
    await el.waitFor({ timeout: 5000 }).catch(() => {});
    const lu = (await el.count()) ? { texte: (await el.innerText()).trim(), source: await el.getAttribute('data-source-extrait') } : null;
    await page.mouse.move(2, 2);
    return lu;
  };
  noter(
    'la vignette n’écrit plus la demande',
    (await page.locator('[data-carte-en-route] [data-carte] [data-description-carte]').count()) === 0,
  );
  noter(
    'la description se lit dans la pastille « i », en texte simple, sans ses signes',
    ((await extrait('data-carte-en-route', 'c-rendue-recente'))?.texte ?? '').startsWith('Carte posée par verif-en-route :'),
  );
  const jamais = await extrait('data-carte-en-route', 'c-jamais');
  noter(
    'une carte sans description montre le début du premier message écrit, sans pastille ni signe',
    jamais?.texte === PREMIER_MESSAGE && jamais.source === 'demande',
    JSON.stringify(jamais),
  );
  const auTravail = await extrait('data-carte-en-route', 'c-au-travail');
  noter(
    'le premier message passe avant la description',
    auTravail?.texte === 'Premier message de la carte au travail' && auTravail.source === 'demande',
    JSON.stringify(auTravail),
  );
  const sansMessage = await extrait('data-carte-en-route', 'c-rendue-recente');
  noter('une carte sans message garde sa description', sansMessage?.source === 'description', JSON.stringify(sansMessage));
  await commande({ type: 'card.update', id: 'c-jamais', patch: { title: 'Jamais lancée, retouchée' } });
  await page
    .locator('[data-carte-en-route="c-jamais"]', { hasText: 'Jamais lancée, retouchée' })
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  const apresMiseAJour = await extrait('data-carte-en-route', 'c-jamais');
  noter(
    'le début de la demande reste après une mise à jour en direct',
    (await page.locator('[data-carte-en-route="c-jamais"]').innerText()).includes('Jamais lancée, retouchée') &&
      apresMiseAJour?.texte === PREMIER_MESSAGE,
    JSON.stringify(apresMiseAJour),
  );

  /* La pastille « i » est TOUJOURS là quand la carte a une demande à lire ; un
     titre COUPÉ s'y lit aussi en entier. */
  const carteCoupee = page.locator('[data-carte-en-route="c-jamais"]');
  noter('une carte qui a une demande porte sa pastille « i », même si son titre tient', (await carteCoupee.locator('[data-texte-coupe]').count()) === 1);
  const TITRE_LONG = 'Un titre de carte vraiment très long, écrit pour dépasser la ligne que la carte lui laisse et ainsi être coupé par des points de suspension. '.repeat(3).trim();
  await commande({ type: 'card.update', id: 'c-jamais', patch: { title: TITRE_LONG } });
  await carteCoupee.locator('[data-texte-coupe]').waitFor({ timeout: 15_000 }).catch(() => {});
  noter('un titre coupé garde une seule pastille « i »', (await carteCoupee.locator('[data-texte-coupe]').count()) === 1);
  /* LE TITRE TIENT SUR DEUX LIGNES (25/10/2026), terminé par « … » : deux
     lignes de haut au plus, et le titre entier en info-bulle (`title`). */
  const titreCoupe = await page.evaluate(() => {
    const h3 = document.querySelector('[data-carte-en-route="c-jamais"] h3');
    if (!h3) return null;
    const style = getComputedStyle(h3);
    const ligne = parseFloat(style.lineHeight);
    return {
      hauteur: Math.round(h3.getBoundingClientRect().height),
      ligne: Math.round(ligne),
      pli: style.webkitLineClamp,
      titre: h3.getAttribute('title'),
    };
  });
  noter(
    'un titre trop long tient sur DEUX lignes, repliées par « … »',
    !!titreCoupe && titreCoupe.pli === '2' && titreCoupe.hauteur <= 2 * titreCoupe.ligne + 2,
    JSON.stringify(titreCoupe),
  );
  noter(
    'le titre coupé porte son texte entier en info-bulle',
    titreCoupe?.titre === TITRE_LONG,
    JSON.stringify(titreCoupe)?.slice(0, 160),
  );
  await carteCoupee.locator('[data-texte-coupe] button').hover();
  await page.waitForSelector('[data-bulle-info]', { timeout: 5000 }).catch(() => {});
  const bulleTexte = (await page.locator('[data-bulle-info]').innerText().catch(() => '')) ?? '';
  noter('au survol, la pastille donne le titre ET le début de la demande en entier', bulleTexte.includes(TITRE_LONG) && bulleTexte.includes(PREMIER_MESSAGE), bulleTexte.slice(0, 80));
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-en-route-pastille-i.png') });
  await page.mouse.move(2, 2);
  await commande({ type: 'card.update', id: 'c-jamais', patch: { title: 'Jamais lancée, retouchée' } });
  await page.locator('[data-carte-en-route="c-jamais"]', { hasText: 'Jamais lancée, retouchée' }).waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-carte-en-route="c-jamais"] h3[title]'), null, { timeout: 5000 }).catch(() => {});
  noter('remis à un titre court, la pastille reste pour la demande', (await carteCoupee.locator('[data-texte-coupe]').count()) === 1);
  noter(
    'remis à un titre court, plus d’info-bulle sur le titre',
    (await page.locator('[data-carte-en-route="c-jamais"] h3').getAttribute('title')) === null,
  );

  /* Une MENTION (ici : un rapport rendu sans code) ne se pose plus en bandeau sous le
     titre, où elle était coupée et rognée par la frise : elle se lit dans la pastille « i »,
     qui paraît dès qu'une mention existe, même si le texte de la carte tient en entier. */
  const PHRASE_SANS_CODE = 'Rapport rendu, aucun fichier du projet modifié : la carte est terminée, mais rien n’a été livré — il n’y a donc rien à déployer.';
  await commande({ type: 'card.update', id: 'c-jamais', patch: { sansModification: PHRASE_SANS_CODE } });
  await carteCoupee.locator('[data-texte-coupe]').waitFor({ timeout: 15_000 }).catch(() => {});
  noter('une carte qui porte une mention a sa pastille « i »', (await carteCoupee.locator('[data-texte-coupe]').count()) === 1);
  noter('…et plus de bandeau de mention sous le titre', (await carteCoupee.locator('[data-mention-carte]').count()) === 0);
  await carteCoupee.locator('[data-texte-coupe] button').hover();
  await page.waitForSelector('[data-bulle-info] [data-mention-carte]', { timeout: 5000 }).catch(() => {});
  const mentionDansLaBulle = page.locator('[data-bulle-info] [data-mention-carte]');
  noter(
    '…la bulle dit la phrase en entier, sur le ton « information »',
    (await mentionDansLaBulle.getAttribute('data-mention-carte').catch(() => null)) === 'information' &&
      ((await mentionDansLaBulle.innerText().catch(() => '')) ?? '').includes(PHRASE_SANS_CODE),
  );
  noter(
    '…avec le début de la demande',
    ((await page.locator('[data-bulle-info]').innerText().catch(() => '')) ?? '').includes(PREMIER_MESSAGE),
  );
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-en-route-mention-dans-le-i.png') });
  await page.mouse.move(2, 2);
  await commande({ type: 'card.update', id: 'c-jamais', patch: { sansModification: '' } });
  await page.waitForFunction(() => !document.querySelector('[data-carte-en-route="c-jamais"] [data-mention-carte]'), null, { timeout: 5000 }).catch(() => {});
  noter('sans mention, la pastille reste pour la demande', (await carteCoupee.locator('[data-texte-coupe]').count()) === 1);

  /* 10. La mise en page, colonne « Actifs ». */
  await verifierLaColonne(page, 'Actif', 'data-carte-en-route', 1500);
  await deplierLaPile(page);
  await verifierLePied(page, 'Actif', ['c-au-travail', 'c-lot-00', 'c-lot-01']);
  await verifierLHeureDuRendu(page, 'Actif');
  await verifierLeBadgeDEtape(page, 'Actif', ['c-au-travail']);
  /* Remettre la carte au travail : l'agent reposé, la page rechargée (elle ne
     l'apprend qu'en se chargeant), sa bande attendue, la pile redépliée. */
  const remettreAuTravail = async () => {
    reposerLesAgents();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-carte-en-route="c-au-travail"] [data-barre-travail]').waitFor({ timeout: 20_000 }).catch(() => {});
    await deplierLaPile(page);
  };
  await verifierLAirSousLHeure(page, 'Actif', remettreAuTravail);
  await verifierLesCartesDeGroupe(page, 'Actif');

  /* 14. La frise des cinq étapes : sur chaque carte, à la MÊME hauteur dans la
     tuile quelle que soit la longueur de la demande, et fidèle à l'étape. */
  const frises = await page.evaluate(() =>
    [...document.querySelectorAll('[data-carte-en-route]')].map((carte) => {
      const tuile = carte.querySelector('[data-carte]')?.getBoundingClientRect();
      const frise = carte.querySelector('[data-frise-suivi]');
      const boite = frise?.getBoundingClientRect();
      return {
        id: carte.getAttribute('data-carte-en-route'),
        ronds: frise ? frise.querySelectorAll('[data-etape-suivi]').length : 0,
        courante: frise?.getAttribute('data-frise-courante'),
        allure: frise?.getAttribute('data-frise-allure'),
        haut: boite && tuile ? Math.round(boite.top - tuile.top) : null,
        dedans: !!(boite && tuile && boite.bottom <= tuile.bottom + 0.5),
        /* L'AIR autour des ronds : du bas du corps (titre + demande) au rond le
           plus haut, et du rond le plus bas au bord bas de la tuile. */
        airDessus: (() => {
          const corps = carte.querySelector('[data-corps-carte]')?.getBoundingClientRect();
          const ronds = [...(frise?.querySelectorAll('[data-etape-suivi]') ?? [])].map((r) => r.getBoundingClientRect());
          return corps && ronds.length ? Math.round(Math.min(...ronds.map((r) => r.top)) - corps.bottom) : null;
        })(),
        airDessous: (() => {
          const ronds = [...(frise?.querySelectorAll('[data-etape-suivi]') ?? [])].map((r) => r.getBoundingClientRect());
          return tuile && ronds.length ? Math.round(tuile.bottom - Math.max(...ronds.map((r) => r.bottom))) : null;
        })(),
        bande: !!carte.querySelector('[data-carte]')?.classList.contains('rounded-b-none'),
      };
    }),
  );
  /* La frise n'est jamais collée à la demande (au moins 8 px au-dessus), et
     aucune carte — bande de travail en pied ou non — ne la coupe par le bas :
     au moins 4 px entre ses ronds et le bord bas de la tuile. */
  const aerees = frises.filter((f) => f.airDessus != null && f.airDessous != null);
  noter(
    'la frise respire : jamais collée à la demande (≥ 8 px), jamais coupée par le bas (≥ 4 px)',
    aerees.length > 0 && aerees.every((f) => f.airDessus >= 8 && f.airDessous >= 4),
    JSON.stringify(frises.map(({ id, airDessus, airDessous, bande }) => ({ id, airDessus, airDessous, bande }))),
  );
  noter(
    'chaque carte porte sa frise de cinq ronds, dans la tuile',
    frises.length > 0 && frises.every((f) => f.ronds === 5 && f.dedans),
    JSON.stringify(frises.filter((f) => f.ronds !== 5 || !f.dedans).slice(0, 3)),
  );
  noter(
    'la frise est à la même hauteur sur toutes les cartes',
    new Set(frises.map((f) => f.haut)).size === 1,
    JSON.stringify([...new Set(frises.map((f) => f.haut))]),
  );
  const friseDe = (id) => frises.find((f) => f.id === id);
  /* 14 bis. UNE COMPRÉHENSION RENDUE ET JAMAIS CONSULTÉE : la carte attend
     « Valider et lancer » — sa frise le dit, sa tête dit « Compréhension », et
     elle se secoue (la classe est posée par intervalles : on l'attend). */
  noter(
    'une compréhension non consultée : la frise est sur « Compréhension », en attente',
    friseDe('c-rendue-vieille')?.courante === 'comprehension' && friseDe('c-rendue-vieille')?.allure === 'attend',
    JSON.stringify(friseDe('c-rendue-vieille')),
  );
  noter(
    'et la tête de la carte le dit : « Compréhension », plus le nom de la colonne',
    (await page.locator('[data-carte-en-route="c-rendue-vieille"] [data-etape-libelle]').innerText()).trim() === 'Compréhension',
  );
  const secoue = await page
    .waitForSelector('[data-carte-secoue="c-rendue-vieille"]', { state: 'attached', timeout: 9000 })
    .then(() => true)
    .catch(() => false);
  noter('et elle se secoue', secoue);
  noter(
    'la frise suit l’étape : « Travail » animé pour la carte au travail, « À déployer » pour la carte rendue',
    friseDe('c-au-travail')?.courante === 'travail' &&
      friseDe('c-au-travail')?.allure === 'travaille' &&
      friseDe('c-rendue-recente')?.courante === 'a_deployer',
    JSON.stringify([friseDe('c-au-travail'), friseDe('c-rendue-recente')]),
  );

  /* 4. Le témoin. */
  const temoin = page.locator('[data-carte-en-route="c-au-travail"]');
  noter('la carte au travail porte le témoin', (await temoin.locator('[data-temoin-en-route="travail"]').count()) === 1);
  noter('et son étape se dit « Travail »', (await temoin.locator('[data-etape-libelle]').innerText()).trim() === 'Travail');
  noter(
    'une carte au repos n’a pas de témoin',
    (await page.locator('[data-carte-en-route="c-rendue-recente"] [data-temoin-en-route="repos"]').count()) === 1,
  );

  /* 4 bis. Une carte bloquée par le quota : le badge le dit, sans point qui bat. */
  const sansQuota = page.locator('[data-carte-en-route="c-lot-03"] [data-temoin-en-route="quota"]');
  await sansQuota.waitFor({ timeout: 15_000 }).catch(() => {});
  noter(
    'une carte coupée par la limite d’un compte dit « En attente de quota »',
    (await sansQuota.count()) === 1 && (await sansQuota.innerText()).includes('En attente de quota') && (await sansQuota.locator('.animate-pulse-soft').count()) === 0,
    (await sansQuota.count()) ? await sansQuota.innerText() : 'absent',
  );

  /* 5. La bande. */
  noter('la mise en ligne, sans carte, est dans la bande', (await page.locator('[data-vignette-agent-en-route="ag-publication"]').count()) === 1);
  noter('l’agent posé sur une carte n’y est pas', (await page.locator('[data-vignette-agent-en-route="ag-tache"]').count()) === 0);
  await verifierLaVignette(page, 'Actif, 1500 px');
  await page.screenshot({ path: "/tmp/verif-en-route.png" });

  /* 6. Le tiroir d'une carte d'un projet non affiché. */
  await page.locator('[data-carte-en-route="c-rendue-recente"] [data-carte-texte]').first().click();
  await page.locator('[data-tiroir]').first().waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const tiroir = page.locator('[data-tiroir]');
  const texteTiroir = (await tiroir.count()) ? await tiroir.first().innerText() : '';
  noter('le tiroir s’ouvre sur la bonne carte', texteTiroir.includes('Rendue il y a une heure'), texteTiroir.slice(0, 80).replace(/\s+/g, ' '));
  noter('la page reste derrière le tiroir', (await page.locator('[data-page-en-route]').count()) === 1);
  await page.screenshot({ path: "/tmp/verif-en-route-tiroir.png" });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  /* 8. La suite, par paquet. */
  await page.locator('[data-suite-en-route="actif"]').click();
  await page.waitForTimeout(1500);
  const tous = await idsDe(page, 'data-carte-en-route', 'actif');
  // 27 cartes en Demande ou Travail, dont une demande commune de deux : 26 entrées.
  noter('la suite arrive : les 26 entrées, sans doublon, la pile comptant pour une', tous.length === 26 && new Set(tous).size === 26, `${tous.length} cartes`);
  noter('plus de bouton de suite quand tout est là', (await page.locator('[data-suite-en-route="actif"]').count()) === 0);
  await verifierLaPile(page, 'Actifs, 1500 px');

  /* 7. Le rechargement. L'agent factice est reposé juste avant : la page ne
     l'apprend qu'en se chargeant, et la veille du démon l'aurait refermé
     pendant les essais de la pile (point 9, « en cours/total »). */
  reposerLesAgents();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-page-en-route]').waitFor({ timeout: 30_000 }).catch(() => {});
  noter('« #en-route » rouvre la page après un rechargement', (await page.locator('[data-page-en-route]').count()) === 1);

  /* 9. Les trois colonnes « Actifs » / « Terminer » / « Archiver ». */
  await page.locator('[data-liste-en-route]').waitFor({ timeout: 20_000 });
  await page.locator('[data-liste-terminee]').waitFor({ timeout: 20_000 });
  const tete = await page.evaluate(() => ({
    onglets: document.querySelectorAll('[data-onglets-en-route], [data-page-en-route] [role="tablist"]').length,
    colonnes: [...document.querySelectorAll('[data-colonne-en-route]')].map((el) => ({
      cle: el.getAttribute('data-colonne-en-route'),
      titre: el.querySelector('header h2')?.textContent?.trim() ?? null,
    })),
    titres: document.querySelectorAll('[data-page-en-route] h1').length,
    bandeau: document.querySelector('[data-titre-bandeau]')?.textContent?.trim() ?? null,
    phrase: document.querySelector('[data-page-en-route]')?.textContent?.includes('au travail sur') ?? null,
  }));
  noter('plus aucune barre d’onglets, ni ligne de titre', tete.onglets === 0 && tete.titres === 0 && tete.phrase === false, JSON.stringify(tete));
  noter(
    'trois colonnes, « Actifs », « Terminer » puis « Archiver », visibles en même temps',
    JSON.stringify(tete.colonnes) ===
      JSON.stringify([
        { cle: 'actif', titre: 'Actifs' },
        { cle: 'terminer', titre: 'Terminer' },
        { cle: 'archive', titre: 'Archiver' },
      ]),
    JSON.stringify(tete.colonnes),
  );
  noter('le bandeau du haut dit « Tableaux de bord »', tete.bandeau === 'Tableaux de bord', String(tete.bandeau));
  const compteDe = async (cle) => (await page.locator(`[data-compte-en-route="${cle}"]`).count())
    ? (await page.locator(`[data-compte-en-route="${cle}"]`).innerText()).trim()
    : null;
  const compteActif = () => compteDe('actif');
  /* « en cours/total » : le total compte les paquets non reçus, le premier
     nombre suit le témoin orange des cartes — lus au MÊME instant, car la
     veille du démon referme les agents factices au bout de quelques secondes. */
  reposerLesAgents();
  await page
    .waitForFunction(() => document.querySelector('[data-carte-en-route="c-au-travail"] [data-temoin-en-route="travail"]'), null, { timeout: 15_000 })
    .catch(() => {});
  const lecture = await page.evaluate(() => ({
    compte: document.querySelector('[data-compte-en-route="actif"]')?.textContent?.trim() ?? null,
    enCours: document.querySelector('[data-compte-en-route="actif"] [data-compte-en-cours]')?.textContent?.trim() ?? null,
    // Les témoins des CARTES : la vignette d'un agent sans carte porte le
    // même témoin, mais n'entre pas dans le nombre de cartes en cours.
    temoins: document.querySelectorAll('[data-carte-en-route] [data-temoin-en-route="travail"]').length,
  }));
  const compteAvant = lecture.compte;
  noter('« Actifs » porte « en cours/total », paquets non reçus compris, une pile pour une', /^\d+\/26$/.test(String(compteAvant)), String(compteAvant));
  noter(
    'le nombre « en cours » suit les témoins orange des cartes',
    lecture.enCours === String(lecture.temoins) && lecture.temoins >= 1,
    JSON.stringify(lecture),
  );
  noter('« Terminer » porte son nombre de cartes', (await compteDe('terminer')) === '1', `${await compteDe('terminer')} : ${(await idsDe(page, 'data-carte-en-route', 'terminer')).join(', ')}`);
  noter('« Archiver » porte son nombre de cartes', (await compteDe('archive')) === '3', String(await compteDe('archive')));
  const terminees = await idsDe(page, 'data-carte-terminee', 'archive');
  noter(
    '« Archiver » : la dernière action en haut, pas la dernière mise en ligne',
    JSON.stringify(terminees) === JSON.stringify(['c-archivee', 'c-en-ligne-vieille', 'c-en-ligne-recente']),
    terminees.join(' → '),
  );
  noter(
    'une archivée sans mise en ligne y est, avec le badge « archivée » et sans badge « en ligne »',
    (await page.locator('[data-carte-terminee="c-archivee"] [data-tete-droite] [data-carte-archivee-sans-mise-en-ligne]').innerText().catch(() => '')).trim() === 'archivée' &&
      (await page.locator('[data-carte-terminee="c-archivee"] [data-date-mise-en-ligne]').count()) === 0,
  );
  noter('ni la mise en ligne d’un projet mis de côté', !terminees.includes('c-en-ligne-rangee'));
  const badge = page.locator('[data-carte-terminee="c-en-ligne-recente"] [data-tete-droite] [data-date-mise-en-ligne]');
  noter(
    'le badge « en ligne » est dans le coin haut droit, et porte la date de mise en ligne',
    (await badge.count()) === 1 && (await badge.innerText()).trim() === 'en ligne' && Number(await badge.getAttribute('data-date-mise-en-ligne')) > 0,
  );
  noter(
    'la phrase « Mise en ligne le… » a disparu',
    !(await page.locator('[data-liste-terminee]').innerText()).includes('Mise en ligne le'),
  );
  noter(
    'le projet est en haut à gauche, à la place du badge',
    (await texteSansAvatar(page, '[data-carte-terminee="c-en-ligne-recente"] [data-tete-gauche]')) === 'Beta',
  );
  await verifierLaDisposition(page, 'Archiver', 'data-carte-terminee', 'c-en-ligne-recente');
  const enLigne = await extrait('data-carte-terminee', 'c-en-ligne-recente');
  noter(
    '« Archiver » : le début de la demande sous le titre',
    enLigne?.texte === 'Mettre la page en ligne ce soir' && enLigne.source === 'demande',
    JSON.stringify(enLigne),
  );
  noter('aucune carte en route dans « Archiver »', (await page.locator('[data-colonne-en-route="archive"] [data-carte-en-route]').count()) === 0);
  noter(
    'aucune carte archivée dans « Actifs »',
    (await page.locator('[data-colonne-en-route="actif"] [data-carte-terminee]').count()) === 0,
  );
  noter('l’agent d’une carte en route n’est dans aucune bande', (await page.locator('[data-vignette-agent-en-route="ag-tache"]').count()) === 0);
  await verifierLaColonne(page, 'Archiver', 'data-carte-terminee', 1500);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/verif-en-route-colonnes.png' });

  // Archivée À LA MAIN depuis le menu (`card.move`) : rangée tout de suite dans « Archiver »,
  // sans passer par « Terminer ». (L'archivage de la mise en ligne, lui, laisse la carte dans
  // « Terminer » : le contrôle en est dans `en-route-store.test.ts`, la publication ne passe pas par ici.)
  await commande({ type: 'card.update', id: 'c-rendue-recente', patch: { deployedAt: Date.now() } });
  await commande({ type: 'card.move', id: 'c-rendue-recente', column: 'archived' });
  const rangeeDirect = await page
    .waitForFunction(
      () => !!document.querySelector('[data-colonne-en-route="archive"] [data-carte-terminee="c-rendue-recente"] [data-date-mise-en-ligne]'),
      null,
      { timeout: 15_000 },
    )
    .then(() => true, () => false);
  await page
    .waitForFunction(() => document.querySelector('[data-compte-en-route="terminer"]')?.textContent?.trim() === '0', null, { timeout: 15_000 })
    .catch(() => {});
  noter(
    'archivée à la main depuis le menu, la carte entre tout de suite dans « Archiver », sans recharger, avec son badge « en ligne »',
    rangeeDirect && enBase('c-rendue-recente')?.colonne === 'archived' && enBase('c-rendue-recente')?.rangee > 0 && (await compteDe('terminer')) === '0' && (await compteDe('archive')) === '4',
    `${JSON.stringify(enBase('c-rendue-recente'))} · ${await compteDe('terminer')} · ${await compteDe('archive')}`,
  );
  // Retour : « Archiver » → « Terminer » à la souris, la page seule bouge.
  await glisser(page, '[data-colonne-en-route="archive"] [data-carte-terminee="c-rendue-recente"]', 'terminer');
  const ressortie = await page
    .waitForFunction(() => !!document.querySelector('[data-colonne-en-route="terminer"] [data-carte-terminee="c-rendue-recente"]'), null, { timeout: 15_000 })
    .then(() => true, () => false);
  noter('glissée vers « Terminer », la carte y revient et n’est plus rangée', ressortie && !enBase('c-rendue-recente')?.rangee, JSON.stringify(enBase('c-rendue-recente')));

  // Le GLISSER à la souris : « Terminer » → « Archiver », la page seule bouge.
  const geste1 = await glisser(page, '[data-colonne-en-route="terminer"] [data-carte-terminee="c-rendue-recente"]', 'archive');
  noter('glisser : le point d’appui est sur la carte, l’aperçu suit, « Archiver » s’éclaire', geste1.sonde && geste1.apercu && geste1.visee, JSON.stringify(geste1));
  const arrivee = await page
    .waitForFunction(() => document.querySelector('[data-colonne-en-route="archive"] [data-carte-terminee]')?.getAttribute('data-carte-terminee') === 'c-rendue-recente', null, { timeout: 15_000 })
    .then(() => true, () => false);
  await page
    .waitForFunction(() => document.querySelector('[data-compte-en-route="terminer"]')?.textContent?.trim() === '0', null, { timeout: 15_000 })
    .catch(() => {});
  const apres = await idsDe(page, 'data-carte-terminee', 'archive');
  noter('glissée, la carte entre en tête d’« Archiver » sans recharger', arrivee && apres.length === 4, apres.join(' → '));
  noter('et elle a quitté « Terminer », dont le nombre tombe à zéro', (await compteDe('terminer')) === '0' && (await idsDe(page, 'data-carte-terminee', 'terminer')).length === 0, String(await compteDe('terminer')));
  noter('et celui d’« Archiver » en gagne une', (await compteDe('archive')) === '4', String(await compteDe('archive')));
  const rangeeEnBase = enBase('c-rendue-recente');
  noter('ranger sur la page ne change pas la colonne du projet', rangeeEnBase?.colonne === 'archived' && rangeeEnBase.rangee > 0, JSON.stringify(rangeeEnBase));
  // Une carte d'« Actifs » ne se dépose nulle part.
  await glisser(page, '[data-colonne-en-route="actif"] [data-carte-en-route="c-jamais"]', 'archive');
  await page.waitForTimeout(600);
  noter('une carte encore en route ne se range pas en la glissant', (await idsDe(page, 'data-carte-en-route', 'actif')).includes('c-jamais') && !enBase('c-jamais')?.rangee);

  // Une carte RENDUE pendant qu'on regarde : d'« Actifs » à « Terminer ».
  await commande({ type: 'card.move', id: 'c-jamais', column: 'to_deploy' }).catch((e) => noter('la carte se range en « À déployer »', false, e.message));
  const rendue = await page
    .waitForFunction(() => !!document.querySelector('[data-colonne-en-route="terminer"] [data-carte-en-route="c-jamais"]'), null, { timeout: 15_000 })
    .then(() => true, () => false);
  const compteRendue = await page
    .waitForFunction(() => /\/25$/.test(document.querySelector('[data-compte-en-route="actif"]')?.textContent?.trim() ?? ''), null, { timeout: 15_000 })
    .then(() => compteActif(), () => compteActif());
  noter(
    'une carte rendue passe d’« Actifs » à « Terminer » sans recharger, et les nombres suivent',
    rendue && !(await idsDe(page, 'data-carte-en-route', 'actif')).includes('c-jamais') && /^\d+\/25$/.test(String(compteRendue)) && (await compteDe('terminer')) === '1',
    `${compteRendue} · ${await compteDe('terminer')}`,
  );

  // Une carte ARCHIVÉE À LA MAIN dans son projet, sans mise en ligne : d'« Actifs » directement à « Archiver ».
  await commande({ type: 'card.move', id: 'c-rendue-vieille', column: 'archived' }).catch((e) => noter('la carte se range en « Archivé »', false, e.message));
  const archiveeALaMain = await page
    .waitForFunction(
      () => !!document.querySelector('[data-colonne-en-route="archive"] [data-carte-terminee="c-rendue-vieille"] [data-carte-archivee-sans-mise-en-ligne]'),
      null,
      { timeout: 15_000 },
    )
    .then(() => true, () => false);
  noter(
    'une carte archivée à la main entre directement dans « Archiver » sans recharger, avec le badge « archivée »',
    archiveeALaMain &&
      !(await idsDe(page, 'data-carte-en-route', 'actif')).includes('c-rendue-vieille') &&
      (await compteDe('archive')) === '5' &&
      (await compteDe('terminer')) === '1' &&
      enBase('c-rendue-vieille')?.rangee > 0,
    `${await compteDe('terminer')} · ${await compteDe('archive')}`,
  );

  /* 10. Sur téléphone : chaque colonne tient l'écran, et le rail défile de
     côté, aimanté, colonne par colonne. La page s'ouvre sur « Actifs ». */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-liste-en-route]').waitFor({ timeout: 20_000 });
  await page.locator('[data-liste-terminee]').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const rail = await page.evaluate(() => {
    const r = document.querySelector('[data-rail-en-route]');
    const s = r ? getComputedStyle(r) : null;
    return r
      ? { gauche: r.scrollLeft, largeur: r.clientWidth, contenu: r.scrollWidth, snap: s.scrollSnapType, vertical: s.overflowY }
      : null;
  });
  noter(
    'téléphone : le rail défile de côté, aimanté, et s’ouvre sur « Actifs »',
    !!rail && rail.gauche === 0 && rail.contenu > rail.largeur * 1.5 && /x/.test(rail.snap) && /mandatory/.test(rail.snap) && rail.vertical === 'hidden',
    JSON.stringify(rail),
  );
  await verifierLaColonne(page, 'Actifs', 'data-carte-en-route', 390);
  // Deux glissers de côté amènent « Archiver » à l'écran, en entier : c'est la
  // dernière colonne, elle se cale sur la marge DROITE du rail (comme la
  // dernière colonne du tableau), et « Actifs » en sort.
  await page.evaluate(() => document.querySelector('[data-rail-en-route]').scrollBy({ left: 10_000 }));
  await page.waitForTimeout(900);
  const bascule = await page.evaluate(() => {
    const rail = document.querySelector('[data-rail-en-route]').getBoundingClientRect();
    const termine = document.querySelector('[data-colonne-en-route="archive"]').getBoundingClientRect();
    const actif = document.querySelector('[data-colonne-en-route="actif"]').getBoundingClientRect();
    return {
      gauche: Math.round(termine.left - rail.left),
      droite: Math.round(rail.right - termine.right),
      actifVisible: Math.round(Math.max(0, actif.right - rail.left)),
    };
  });
  noter(
    'téléphone : en glissant de côté, « Archiver » arrive en entier à l’écran',
    bascule.gauche >= 0 && Math.abs(bascule.droite - 12) <= 2 && bascule.actifVisible <= 20,
    JSON.stringify(bascule),
  );
  await verifierLaColonne(page, 'Archiver', 'data-carte-terminee', 390);
  await page.screenshot({ path: '/tmp/verif-en-route-telephone-termines.png' });
  await page.evaluate(() => document.querySelector('[data-rail-en-route]').scrollTo({ left: 0 }));
  await page.waitForTimeout(600);
  // L'agent factice a pu être refermé par la veille du démon : on le repose
  // et on recharge, pour mesurer une vignette AU TRAVAIL.
  reposerLesAgents();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-vignette-agent-en-route="ag-publication"] [data-barre-agent-en-route]').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await verifierLaVignette(page, 'Actif, 390 px');
  await page.screenshot({ path: '/tmp/verif-en-route-telephone.png' });

  await verifierLaDisposition(page, 'Actif, téléphone', 'data-carte-en-route', 'c-jamais');
  await verifierLaPile(page, 'Actifs, 390 px');
  await deplierLaPile(page);
  await verifierLePied(page, 'Actif, téléphone', ['c-au-travail', 'c-lot-00', 'c-lot-01']);
  await verifierLHeureDuRendu(page, 'Actif, téléphone');
  await verifierLeBadgeDEtape(page, 'Actif, téléphone', ['c-au-travail']);
  await verifierLAirSousLHeure(page, 'Actif, téléphone', remettreAuTravail);
  await verifierLesCartesDeGroupe(page, 'Actif, téléphone');

  /* 15. La pile passe ENTIÈRE dans « Terminer » quand sa dernière fille est
     publiée, puis ENTIÈRE dans « Archiver » une fois rangée. */
  await commande({ type: 'card.update', id: 'c-lot-01', patch: { deployedAt: Date.now() } });
  await commande({ type: 'card.move', id: 'c-lot-01', column: 'archived' });
  await commande({ type: 'card.move', id: 'c-lot-00', column: 'archived' }).catch(() => {});
  // Archivées à la main, elles seraient rangées d'office : on les remet dans « Terminer »,
  // là où les laisse l'archivage de la mise en ligne (`rangerTableauDeBord`, range: false).
  await commande({ type: 'card.rangerTableauDeBord', ids: ['c-lot-00', 'c-lot-01'], range: false });
  const versTerminer = await page
    .waitForFunction(
      () =>
        !!document.querySelector('[data-colonne-en-route="terminer"] [data-pile-en-route="c-lot-00"]') &&
        !document.querySelector('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]') &&
        !document.querySelector('[data-colonne-en-route="archive"] [data-pile-en-route="c-lot-00"]'),
      null,
      { timeout: 15_000 },
    )
    .then(() => true, () => false);
  noter('toutes ses cartes finies, la pile passe entière dans « Terminer », sans recharger', versTerminer);
  await commande({ type: 'card.rangerTableauDeBord', ids: ['c-lot-00', 'c-lot-01', 'c-lot-fille-en-ligne'], range: true });
  const passee = await page
    .waitForFunction(
      () =>
        !!document.querySelector('[data-colonne-en-route="archive"] [data-pile-en-route="c-lot-00"]') &&
        !document.querySelector('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]'),
      null,
      { timeout: 15_000 },
    )
    .then(() => true, () => false);
  const enTermine = await page.evaluate(() => {
    const pile = document.querySelector('[data-colonne-en-route="archive"] [data-pile-en-route="c-lot-00"]');
    return { nombre: pile?.getAttribute('data-nombre-pile') ?? null, dessus: pile?.querySelector('[data-carte]')?.getAttribute('data-carte') ?? null };
  });
  noter(
    'rangée, la pile passe entière dans « Archiver », la mère au-dessus, sans recharger',
    passee && enTermine.nombre === '3' && enTermine.dessus === 'c-lot-00',
    JSON.stringify(enTermine),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-liste-terminee]').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  const apresRechargement = await page.evaluate(() => ({
    termine: !!document.querySelector('[data-colonne-en-route="archive"] [data-pile-en-route="c-lot-00"][data-nombre-pile="3"]'),
    actif: document.querySelectorAll('[data-colonne-en-route="actif"] [data-pile-en-route="c-lot-00"]').length,
  }));
  noter('et le démon la range de même après un rechargement', apresRechargement.termine && apresRechargement.actif === 0, JSON.stringify(apresRechargement));

  /* 11. Au tableau, la carte ne change pas : ni tête intégrée, ni description. */
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${BASE}/#projet/p-alpha`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-carte="c-en-ligne-vieille"], [data-carte="c-au-travail"]').first().waitFor({ timeout: 30_000 }).catch(() => {});
  const auTableau = await page.evaluate(() => ({
    cartes: document.querySelectorAll('[data-carte]').length,
    tetes: document.querySelectorAll('[data-carte] [data-tete-carte-en-route]').length,
    descriptions: document.querySelectorAll('[data-carte] [data-description-carte]').length,
    anciennetes: document.querySelectorAll('[data-carte] [data-anciennete-carte]').length,
    frises: document.querySelectorAll('[data-frise-suivi]').length,
  }));
  const titreAuTableau = await page.locator('[data-titre-bandeau]').innerText().catch(() => null);
  noter('au tableau, le bandeau du haut redit le nom du projet', !!titreAuTableau && titreAuTableau.trim() !== 'Tableaux de bord', String(titreAuTableau));
  noter(
    'au tableau, la carte reste celle d’avant',
    auTableau.cartes > 0 && auTableau.tetes === 0 && auTableau.descriptions === 0 && auTableau.anciennetes === 0 && auTableau.frises === 0,
    JSON.stringify(auTableau),
  );

  /* 12. La silhouette : mêmes boîtes que les cartes qui la remplacent. */
  await verifierLaSilhouette(contexte);

  /* 17. « Tout archiver », en haut à droite de « Terminer » (08/10/2026) : il
     ne range QUE les cartes déjà archivées dans leur projet, sur la page
     seulement — la colonne des cartes dans leur projet ne bouge pas, et une
     carte « À déployer » reste dans « Terminer ». Les cartes que la page n'a
     pas encore reçues (au-delà du premier paquet de vingt) sont rangées
     aussi. Grisé quand « Terminer » n'a aucune carte archivée. Sur téléphone, il tient dans
     l'en-tête sans écraser le nombre. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-colonne-en-route="terminer"] [data-carte-en-route="c-jamais"]').waitFor({ timeout: 20_000 });
  const boutonTout = page.locator('[data-tout-archiver-en-route]');
  const geste = await page.evaluate(() => {
    const b = document.querySelector('[data-tout-archiver-en-route]');
    const tete = b?.closest('header');
    const compte = tete?.querySelector('[data-compte-en-route]');
    const rb = b?.getBoundingClientRect();
    const rt = tete?.getBoundingClientRect();
    const rc = compte?.getBoundingClientRect();
    return {
      dansTerminer: !!b?.closest('[data-colonne-en-route="terminer"]'),
      disabled: !!b?.disabled,
      dedans: !!rb && !!rt && rb.left >= rt.left && rb.right <= rt.right + 0.5 && rb.top >= rt.top && rb.bottom <= rt.bottom + 0.5,
      droite: !!rb && !!rt && rt.right - rb.right <= 16,
      sansRecouvrir: !!rb && !!rc && rc.right <= rb.left + 0.5,
    };
  });
  noter('« Tout archiver » : un seul bouton, dans l’en-tête de « Terminer »', (await boutonTout.count()) === 1 && geste.dansTerminer, JSON.stringify(geste));
  noter('il est grisé tant que « Terminer » ne contient qu’une carte pas encore archivée', geste.disabled);
  // Le démon refuse aussi : une carte « À déployer » ne se range pas.
  await commande({ type: 'card.rangerTableauDeBord', ids: ['c-jamais'], range: true });
  await page.waitForTimeout(500);
  noter('le démon refuse de ranger une carte « À déployer »', enBase('c-jamais')?.colonne === 'to_deploy' && !(enBase('c-jamais')?.rangee > 0), JSON.stringify(enBase('c-jamais')));
  noter('téléphone : il tient dans l’en-tête, à droite, sans recouvrir le nombre', geste.dedans && geste.droite && geste.sansRecouvrir, JSON.stringify(geste));

  // Vingt cartes archivées de plus : l'une dépasse le premier paquet de la page.
  const cartesEnLigne = Array.from({ length: 20 }, (_, i) => `c-lot-${String(i + 2).padStart(2, '0')}`);
  for (const id of cartesEnLigne) {
    await commande({ type: 'card.move', id, column: 'to_deploy' });
    await commande({ type: 'card.move', id, column: 'archived' });
  }
  // Archivées à la main, ces cartes seraient déjà rangées : on les remet dans « Terminer »,
  // comme les laisse l'archivage de la mise en ligne (`rangerTableauDeBord`, range: false).
  await commande({ type: 'card.rangerTableauDeBord', ids: cartesEnLigne, range: false });
  // « Jamais lancée » reste la carte la plus fraîche : celle qui attend sa publication.
  await commande({ type: 'card.update', id: 'c-jamais', patch: { description: 'attend sa publication' } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-colonne-en-route="terminer"] [data-carte-en-route="c-jamais"]').waitFor({ timeout: 20_000 });
  const chargees = await page.locator('[data-colonne-en-route="terminer"] [data-carte-en-route], [data-colonne-en-route="terminer"] [data-carte-terminee]').count();
  noter('une carte de « Terminer » n’est pas encore reçue par la page (paquet de vingt)', chargees === 20, String(chargees));
  // Les vingt cartes archivées dépassent le paquet : une n'est pas reçue.
  noter('le bouton est allumé', !(await boutonTout.isDisabled()));
  await boutonTout.click();
  const dialogue = page.locator('[role="dialog"]');
  await dialogue.waitFor({ timeout: 15_000 });
  const questionDit = (await dialogue.innerText()).includes('20');
  noter('la confirmation dit le nombre de cartes de la colonne, celles du paquet suivant comprises', questionDit, (await dialogue.innerText()).replace(/\s+/g, ' '));
  await dialogue.getByRole('button', { name: 'Archiver', exact: true }).click();
  const toutRange = await page
    .waitForFunction(
      (ids) => ids.every((id) => !!document.querySelector(`[data-colonne-en-route="archive"] [data-carte-terminee="${id}"]`)),
      cartesEnLigne,
      { timeout: 60_000 },
    )
    .then(() => true, () => false);
  const resteDansTerminer = await idsDe(page, 'data-carte', 'terminer');
  noter('les vingt cartes archivées sont dans « Archiver », seule celle « À déployer » reste dans « Terminer »', toutRange && resteDansTerminer.join(' ') === 'c-jamais', resteDansTerminer.join(' '));
  const jamaisEnBase = enBase('c-jamais');
  noter(
    'la carte qui attend sa publication reste « À déployer » et non rangée',
    jamaisEnBase?.colonne === 'to_deploy' && !(jamaisEnBase.rangee > 0) && enBase('c-lot-02')?.colonne === 'archived' && enBase('c-lot-02')?.rangee > 0,
    JSON.stringify(jamaisEnBase),
  );
  await page
    .waitForFunction(() => document.querySelector('[data-tout-archiver-en-route]')?.disabled === true, null, { timeout: 15_000 })
    .catch(() => {});
  noter('et le bouton se grise', await boutonTout.isDisabled());

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const passes = resultats.filter((r) => r.ok).length;
  console.log(`\n${passes}/${resultats.length} vérifications passées`);
  console.log("(captures : /tmp/verif-en-route*.png)");
  process.exitCode = passes === resultats.length ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
