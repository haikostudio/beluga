#!/usr/bin/env node
/**
 * LE TIROIR D'UNE PUBLICATION : SON FIL COMPLET, RELU DEPUIS LE CHEVRON.
 *
 * Ce qui manquait, et que ce contrôle verrouille : ouvrir le déroulé d'une
 * publication donnait sept lignes et un état chacune — pour savoir quelle
 * branche venait d'être fusionnée ou ce qu'un agent de dépannage avait tenté,
 * il fallait ouvrir le journal du serveur.
 *
 * Les cartes archivées, elles, se lisent maintenant à PLAT, sans regroupement
 * par publication (le bandeau, la pile et le texte flottant entre les cartes
 * ont été retirés) : ce contrôle le vérifie aussi.
 *
 * DEUX VOLETS, tous deux joués pour de vrai.
 *
 * A. LE SERVEUR ÉCRIT LE FIL — lecture du code de la publication : chaque étape
 *    note son début et son issue par le passage OBLIGÉ (`setStep`), la fusion
 *    note branche par branche, les commandes partent par `commandeDuFil`, et le
 *    dépannage écrit ses moments. Sans cette écriture, le tiroir serait un beau
 *    contenant vide.
 *
 * B. L'ÉCRAN (vrai navigateur, démon d'essai à soi : base neuve, dossier de
 *    projets vide, port libre — le démon de production n'est PAS touché, aucun
 *    quota dépensé). Une publication TERMINÉE est posée en base avec son fil.
 *    On vérifie alors :
 *      - les cartes archivées à plat, sans bandeau ni pile ;
 *      - le clic sur le chevron de « À déployer » qui ouvre le TIROIR d'historique ;
 *      - le FIL des étapes, avec ses heures ;
 *      - qu'on ne peut RIEN relancer depuis cet historique : on relit.
 *
 * Rien n'est publié ni déployé : le contrôle n'appelle aucune commande de mise
 * en ligne, il pose une publication DÉJÀ terminée dans une base jetable.
 *
 *   node scripts/verif-tiroir-deploiement.mjs
 */

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

/* Le script juge le dépôt d'où il PART, jamais /root/beluga en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7211);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* A. LE SERVEUR ÉCRIT LE FIL                                          */
/* ------------------------------------------------------------------ */

function voletDuServeur() {
  const deploy = fs.readFileSync(path.join(RACINE, 'server', 'src', 'deploy.ts'), 'utf8');
  const regle = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'journal-publication.ts'), 'utf8');

  noter(
    'chaque étape note son début et son issue par le passage obligé (setStep)',
    /function setStep[\s\S]{0,3000}?ajouterAuJournal\(/.test(deploy),
  );
  noter(
    'la progression laisse sa trace au lieu de s’effacer (progresser)',
    /function progresser\([\s\S]{0,600}?ajouterAuJournal\(/.test(deploy),
  );
  noter('la fusion note branche par branche', /noter\(current, 'merge'/.test(deploy));
  noter('les commandes réellement lancées entrent dans le fil', /noter\(current, '(merge|build|publish)', `\$ [^`]*`, 'commande'\)/.test(deploy));
  noter("le passage d'un agent de dépannage est écrit", /function noterLaReparation[\s\S]{0,400}?genre: 'depannage'/.test(deploy));
  noter(
    'le fil vit à côté de la publication, pas dans la copie promenée par le tour',
    /const journaux = new Map/.test(deploy) && /function journalDuRun/.test(deploy),
  );
  noter(
    'une publication rangée rend sa mémoire',
    /journaux\.delete\(current\.id\)/.test(deploy),
  );
  noter('le fil est BORNÉ, et la règle le dit', /EVENEMENTS_PAR_ETAPE_MAX = \d+/.test(regle));
  const modeles = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'models.ts'), 'utf8');
  noter(
    'un fil vide n’est pas une panne : le champ reste optionnel',
    /journal: z[\s\S]{0,900}?\.optional\(\)/.test(modeles),
  );
  /*
   * UN MOMENT QUI DURE PORTE SON ÉTAT. Une sous-étape de construction
   * (« shared », « server », « web ») part « en cours » et se referme en
   * « fait » ou « échec » : c'est cet état, et non le genre, qui décide de son
   * rond. On juge le SCHÉMA (le champ existe et reste optionnel, donc tout fil
   * écrit avant cette règle se relit) et l'ÉCRAN (l'état passe avant le genre).
   */
  noter(
    'un moment peut DIRE où il en est — et le champ reste optionnel',
    /genre: z\.enum\(\[[^\]]*'sous-etape'/.test(modeles) &&
      /* Les états d'un moment se sont ENRICHIS depuis (« sauté », « rattrapé ») :
         on exige les trois d'origine et le caractère optionnel, jamais la liste
         figée — sans quoi ce contrôle tombe à chaque état ajouté. */
      /etat: z\.enum\(\['encours', 'fait', 'echec'[^\]]*\]\)\.optional\(\)/.test(modeles),
  );
  const regleDuFil = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'journal-publication.ts'), 'utf8');
  noter(
    'une sous-étape se REFERME à sa place, elle ne laisse pas un rond tourner',
    /export function acheverLeMoment\(/.test(regleDuFil) && /suite\[i\] = \{ \.\.\.fil\[i\], texte, etat: issue\.etat \}/.test(regleDuFil),
  );
  const tiroirSource = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'tiroir-deploiement.tsx'), 'utf8');
  noter(
    'le rond d’un moment suit son ÉTAT avant son genre',
    /function IconeMoment\(\{ genre, etat \}[\s\S]{0,400}?etat === 'encours'[\s\S]{0,200}?etat === 'fait'[\s\S]{0,200}?etat === 'echec'/.test(tiroirSource) &&
      /function bordureRondMoment\(genre: GenreDEvenement, etat\?: EtatDuMoment\)/.test(tiroirSource),
  );
  const voletSource = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'volet-publication.tsx'), 'utf8');
  noter(
    'le fil d’une étape se lit SOUS elle, dans le détail déplié',
    /data-fil-etape=\{etape\.cle\}/.test(voletSource) && /data-detail-etape=\{etape\.cle\}/.test(voletSource),
  );
  noter(
    'le volet est le MÊME pour les deux étapes : une seule liste dépliable',
    !/data-deux-colonnes/.test(voletSource) &&
      /data-parcours-etapes=\{etape\.cible\}/.test(voletSource) &&
      /data-etape-depliee=\{ouverte \? 'oui' : undefined\}/.test(voletSource) &&
      /export function CorpsDuVolet\(/.test(voletSource),
  );
  const parcoursRegle = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'parcours-de-publication.ts'), 'utf8');
  noter(
    'chaque étape déroule ses PROPRES étapes, décrites en données',
    /const PARCOURS_DEV: readonly DescriptionDEtape\[\]/.test(parcoursRegle) &&
      /const PARCOURS_PRODUCTION: readonly DescriptionDEtape\[\]/.test(parcoursRegle) &&
      /export function etapesDuParcours\(/.test(parcoursRegle),
  );
  noter(
    'une étape faite d’avance est reconnue à son MOTIF, jamais à sa clé',
    /export function etapeFaiteALEcart\(motif\?: string\)/.test(parcoursRegle) &&
      /texte\.startsWith\(RECIT_CONTROLES_A_LECART\)/.test(parcoursRegle),
  );
  noter(
    'le serveur ne recopie plus ces récits : il les lit dans les règles pures',
    /* Le serveur ne ré-exporte plus ces récits : il suffit qu'il n'en
       recopie pas le texte, qui ne vit que dans les règles pures. */
    !/Contrôles déjà passés à l’écart/.test(deploy) && !/Construction déjà faite à l’écart/.test(deploy) &&
      /export const RECIT_CONTROLES_A_LECART/.test(parcoursRegle),
  );

  const ws = fs.readFileSync(path.join(RACINE, 'server', 'src', 'ws.ts'), 'utf8');
  const casHistorique = ws.slice(ws.indexOf("case 'deploy.historique'"), ws.indexOf("case 'deploy.historique'") + 900);
  noter(
    'lire l’historique ne peut RIEN déclencher (lecture en base seule)',
    /store\.recentDeploys\(/.test(casHistorique) && !/startDeploy|runCommand|exec/.test(casHistorique),
  );

  const panneau = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'deploy-panel.tsx'), 'utf8');
  noter(
    'le déroulé n’est plus dessiné deux fois : le panneau passe par le volet',
    /VoletDePublication/.test(panneau) && /CorpsDuVolet/.test(panneau) && !/function ProcessusEtapes/.test(panneau),
  );

  const tiroir = voletSource;
  noter("c'est un vrai tiroir, pas un panneau posé sur les cartes", /<Drawer/.test(tiroir));
  /*
   * ON NE RÉÉCRIT PAS LE PASSÉ. La CONVERSATION du conducteur est un point du
   * parcours ; une publication d'AVANT ce changement n'en a pas, et doit
   * continuer de se lire — ses étapes et leurs fils, sans ligne de
   * conversation. Tout le volet B de ce contrôle joue précisément ce cas : le
   * décor pose une publication sans `agentId`.
   */
  noter(
    'une publication SANS conducteur ne propose pas d’en parler',
    /\{conducteur \? \(/.test(tiroir) &&
      /data-point-conversation=\{questions \? 'question' : 'libre'\}/.test(tiroir) &&
      !/<LigneDeConversation/.test(tiroir),
  );
  const briques = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'tiroir-deploiement.tsx'), 'utf8');
  noter('chaque étape porte son fil, horodaté', /filDeLEtape\(/.test(tiroir) && /heureDeLEvenement\(/.test(briques));

  /* LA LIGNE DE DÉPANNAGE OUVRE LA CONVERSATION DE SON AGENT, en direct — pas
     de cardId sur cet agent, le mécanisme générique `agent.open`/`Chat`
     suffit. Depuis la réparation silencieuse, l'agentId voyage de l'issue de
     l'essai (`issue.agentId`) jusqu'au fil par `noterLaReparation`. */
  noter(
    "l'agentId de la passe voyage jusqu'au fil (issue.agentId → noterLaReparation)",
    /function noterLaReparation\([^)]*agentId\?: string\)[\s\S]{0,400}?\.\.\.\(agentId \? \{ agentId \} : \{\}\)/.test(deploy) &&
      /noterLaReparation\(acces\.lire\(\), err\.cle, recitDeLEssai\(\{ essai \}\), issue\.agentId\)/.test(deploy),
  );
  /* Motif de retrait : la ligne « CONFLIT… un agent de dépannage est appelé »
     n'existe plus (plus de dépanneur appelé après la chute, DEC-255) ; son
     équivalent est la ligne de réparation sur place d'un heurt de fusion. */
  noter(
    'le heurt de fusion réglé sur place note sa réparation avec l’agentId',
    /noterLaReparation\(current, 'merge', recitDeLEssai\(\{ essai, heurt: card\.title \}\), agentId\)/.test(deploy),
  );
  noter(
    'un moment de dépannage avec agentId se clique, et ouvre le second tiroir',
    /data-moment-agent={agentId}/.test(tiroir) && /onOuvrirAgent/.test(tiroir),
  );
  noter(
    "le second tiroir montre l'agent SUR PLACE (journal, question, champ), SANS cardId (jamais celui d'une carte)",
    /<AgentEnLigne agentId={agentOuvert} projectId={run\?\.projectId/.test(tiroir),
  );

  /* LE CHIFFRE : la règle vit dans `shared`, pure, et l'écran ne fait que
     l'afficher — aucun pourcentage recalculé à la main dans le composant. */
  const regleChiffre = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'avancement-publication.ts'), 'utf8');
  noter(
    'le pourcentage est une règle PURE, sans base ni disque',
    /export function avancementDuFlux/.test(regleChiffre) &&
      /export function avancementDeLaBranche/.test(regleChiffre) &&
      !/import .*(store|fs|better-sqlite3)/.test(regleChiffre),
  );
  noter(
    'ce qui est ÉCARTÉ n’a pas de pourcentage : il n’avance plus',
    /natureDeLEtat\(etat\) === 'ecart'\) return null/.test(regleChiffre),
  );
  noter(
    'le tiroir affiche le chiffre du flux et celui de chaque branche',
    /avancementDuFlux\(/.test(voletSource) &&
      /avancementDeLaBranche\(/.test(
        fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'tiroir-deploiement.tsx'), 'utf8'),
      ),
  );
}

/* ------------------------------------------------------------------ */
/* B. L'ÉCRAN                                                          */
/* ------------------------------------------------------------------ */

const { TMP, DATA, PROJETS, DEPOT, demon, journal, nettoyer, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-tiroir-deploiement-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai-tiroir';
const RUN_ID = 'run-essai-1';
const AUTRE_RUN = 'run-essai-2';
/* L'agent de dépannage appelé sur le conflit — SANS cardId, comme le vrai
   (sujet « publication » de la mémoire) : ce n'est jamais l'agent d'une carte. */
const AGENT_DEPANNAGE = 'a-essai-depannage';
/* Une heure FIXE, jamais sur « maintenant ». */
const DEPLOYE_LE = new Date(2026, 7, 17, 14, 32, 5).getTime();

/** Les étapes d'une publication terminée, la fusion portant son fil. */
function etapesAvecFil() {
  const t0 = DEPLOYE_LE;
  return [
    {
      key: 'merge',
      state: 'done',
      log: '',
      startedAt: t0,
      endedAt: t0 + 9000,
      journal: [
        { at: t0, genre: 'debut', texte: 'L’étape « Fusion des branches » commence.' },
        { at: t0 + 1000, genre: 'progression', texte: 'Branche 1 sur 2 : tache/premiere' },
        { at: t0 + 2000, genre: 'commande', texte: '$ git merge --no-edit tache/premiere' },
        { at: t0 + 3000, genre: 'issue', texte: 'tache/premiere : fusionnée (« Première carte »).' },
        {
          at: t0 + 4000,
          genre: 'depannage',
          texte: 'Conflit reconnu : un agent de dépannage est parti.',
          agentId: AGENT_DEPANNAGE,
        },
        { at: t0 + 8000, genre: 'issue', texte: 'tache/seconde : fusionnée après réparation.' },
      ],
    },
    ...['commit', 'push', 'verify', 'build', 'publish'].map((key, i) => ({
      key,
      state: 'done',
      log: '',
      startedAt: t0 + 10000 + i * 1000,
      endedAt: t0 + 10500 + i * 1000,
    })),
    { key: 'restart', state: 'skipped', log: '', startedAt: t0 + 20000, endedAt: t0 + 20001 },
  ];
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();

  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification tiroir de déploiement',
  );

  /* Aucun agent ne doit pouvoir démarrer : ce contrôle ne dépense rien. */
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const projet = {
    id: PROJET_ID,
    name: 'Essai — tiroir de déploiement',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    /* Depuis le 10/10/2026 un projet sans processus ne déploie pas : le décor est « hérité » (déploiement déjà en place), sinon l'en-tête n'offre que « Configuration de la procédure », sans chevron. */
    deploiement: { herite: true },
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const carte = (id, titre, position) => {
    const donnees = {
      id,
      projectId: PROJET_ID,
      title: titre,
      description: 'Carte d’essai posée en base.',
      column: 'archived',
      position,
      origin: 'user',
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      scheduling: { asap: false, attempts: 1, restarts: 0, suspendu: false },
      excludedFromDeploy: false,
      horsTache: false,
      deployedAt: DEPLOYE_LE,
      createdAt: maintenant,
      updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, PROJET_ID, 'archived', position, titre, JSON.stringify(donnees), DEPLOYE_LE, maintenant, maintenant);
  };
  carte('c-1', 'Première carte', 1);
  carte('c-2', 'Seconde carte', 2);
  carte('c-3', 'Carte posée à la main', 3);

  const run = {
    id: RUN_ID,
    projectId: PROJET_ID,
    state: 'success',
    cible: 'dev',
    cardIds: ['c-1', 'c-2'],
    steps: etapesAvecFil(),
    /*
     * OÙ EN EST CHAQUE TÂCHE DU LOT. Le compte de cartes ne disait qu'un
     * NOMBRE, et les sept étapes racontaient le PARCOURS : devant un lot, il
     * fallait déplier la fusion et lire son fil ligne à ligne pour savoir
     * laquelle était passée et laquelle était restée au bord. Le décor porte
     * les trois cas qui comptent : une passée, une recollée toute seule (sans
     * qu'aucun agent n'ait été appelé), une écartée du lot.
     */
    taches: [
      { cardId: 'c-1', titre: 'Première carte', branche: 'tache/premiere', etat: 'en-ligne' },
      {
        cardId: 'c-2',
        titre: 'Seconde carte',
        branche: 'tache/seconde',
        etat: 'recollee',
        detail: 'CLAUDE.md',
      },
      {
        cardId: 'c-9',
        titre: 'Carte laissée de côté',
        branche: 'tache/ecartee',
        etat: 'ecartee',
        detail: 'conflit toujours présent après passage de l’agent',
      },
    ],
    queued: false,
    startedAt: DEPLOYE_LE,
    endedAt: DEPLOYE_LE + 21000,
  };
  db.prepare(
    'INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(run.id, PROJET_ID, run.state, JSON.stringify(run), run.startedAt, run.endedAt);

  /* Une publication TOMBÉE, plus récente, sur une AUTRE étape (« production ») :
     elle ne doit pas passer pour la dernière publication de l'étape « dev »
     relue par le chevron. */
  const rate = {
    id: AUTRE_RUN,
    projectId: PROJET_ID,
    state: 'failed',
    cible: 'production',
    cardIds: ['c-1'],
    steps: [{ key: 'merge', state: 'failed', log: 'conflit', startedAt: DEPLOYE_LE + 60000 }],
    queued: false,
    error: 'conflit de fusion',
    startedAt: DEPLOYE_LE + 60000,
    endedAt: DEPLOYE_LE + 61000,
  };
  db.prepare(
    'INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(rate.id, PROJET_ID, rate.state, JSON.stringify(rate), rate.startedAt, rate.endedAt);

  /* L'AGENT DE DÉPANNAGE, sans cardId — c'est sa conversation que la ligne
     « CONFLIT… » du fil doit ouvrir. */
  const agentDepannage = {
    id: AGENT_DEPANNAGE,
    projectId: PROJET_ID,
    role: 'deploy',
    title: 'Conflit de fusion — Seconde carte',
    run: { engine: 'claude', model: 'claude-haiku-4-5', thinking: 'medium', mode: 'direct' },
    account: 'compte-essai-depannage',
    status: 'done',
    startedAt: DEPLOYE_LE + 4000,
    endedAt: DEPLOYE_LE + 8000,
    createdAt: DEPLOYE_LE + 4000,
    updatedAt: DEPLOYE_LE + 8000,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    agentDepannage.id,
    PROJET_ID,
    agentDepannage.role,
    agentDepannage.status,
    JSON.stringify(agentDepannage),
    DEPLOYE_LE + 4000,
    DEPLOYE_LE + 8000,
  );
  const messageDepannage = {
    id: 'm-essai-depannage-1',
    agentId: AGENT_DEPANNAGE,
    role: 'assistant',
    content: 'Conflit recollé sur CLAUDE.md : les deux intentions sont gardées, tests relancés.',
    createdAt: DEPLOYE_LE + 7500,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    messageDepannage.id,
    AGENT_DEPANNAGE,
    messageDepannage.role,
    JSON.stringify(messageDepannage),
    messageDepannage.createdAt,
  );

  db.close();
}

/* La feuille du volet de publication et sa zone qui défile : `vide` est la
   place laissée sous le contenu, `deborde` ce qui ne tient pas et défile. */
const MESURE_FEUILLE = () => {
  const volet = [...document.querySelectorAll('[data-volet-publication]')].pop();
  const feuille = volet?.closest('[data-tiroir]');
  const zone = volet?.querySelector('[data-parcours-etapes]')?.parentElement;
  if (!feuille || !zone) return null;
  return {
    mode: feuille.getAttribute('data-tiroir'),
    ecran: window.innerHeight,
    feuille: Math.round(feuille.getBoundingClientRect().height),
    vide: zone.clientHeight - zone.scrollHeight,
    deborde: zone.scrollHeight - zone.clientHeight,
  };
};

async function ouvrirLeTableau(navigateur) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1500, height: 950 },
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
  await page.waitForTimeout(3000);
  return { page, erreurs };
}

async function voletDeLEcran() {
  if (!(await attendrePort())) {
    noter('le démon d’essai répond', false, journal.join('').slice(-600));
    return;
  }
  noter('le démon d’essai répond', true);
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  try {
    const { page, erreurs } = await ouvrirLeTableau(navigateur);

    /* Depuis la refonte, la colonne montre les services du projet ouvert, pas la
       liste des projets : on ouvre son tableau par son adresse. */
    await page.evaluate((id) => { window.location.hash = `#projet/${id}`; }, PROJET_ID);
    await page.waitForTimeout(2500);

    /* LES CARTES ARCHIVÉES SE LISENT À PLAT : le regroupement par publication
       (bandeau, pile, texte flottant entre les cartes) a été retiré — les
       trois cartes posées en base se voient toutes, sans rien qui s'interpose. */
    const cartesArchivees = await page.locator('[data-carte]').count();
    noter(
      'les cartes archivées se lisent en LISTE PLATE, sans regroupement',
      cartesArchivees === 3,
      `${cartesArchivees} carte(s)`,
    );
    noter(
      'aucun bandeau de groupe ne se pose plus entre les cartes',
      (await page.locator('[data-groupe-production]').count()) === 0,
    );
    noter(
      'aucun décor de pile ne se pose plus derrière une carte',
      (await page.locator('[data-pile-groupe]').count()) === 0,
    );

    /* LE DÉROULÉ D'UNE PUBLICATION PASSÉE, RELU DEPUIS LE CHEVRON DE
       « À DÉPLOYER » — la porte d'entrée générale du tiroir, indépendante du
       regroupement retiré. Une publication tombée existe aussi, sur l'AUTRE
       étape (« production ») : elle ne doit pas passer pour la dernière
       publication de l'étape « dev » relue ici. */
    const bouton = page.locator('[data-chevron-process]').first();
    noter('la colonne « À déployer » porte sa porte d’entrée vers le tiroir', (await bouton.count()) === 1);
    if (await bouton.count()) {
      await bouton.click();
      await page.waitForTimeout(1200);

      const ouvert = page.locator('[data-volet-publication]');
      noter('le clic ouvre un vrai TIROIR', (await ouvert.count()) === 1);
      noter(
        'et il s’ouvre en UNE LISTE : chaque étape porte son détail, replié',
        (await page.locator('[data-volet-publication] [data-deux-colonnes]').count()) === 0 &&
          (await page.locator('[data-parcours-etapes="dev"]').count()) === 1 &&
          (await page.locator('[data-volet-publication] [data-detail-etape]').count()) <= 1,
      );

      /* ---------------------------------------------------------------- */
      /* LA FEUILLE SUIT SON CONTENU, ELLE NE S'OUVRE PLUS EN PLEIN ÉCRAN  */
      /* ---------------------------------------------------------------- */
      /* Un parcours court ne laisse plus de grande zone vide sous le lot : la
         zone qui défile vaut exactement son contenu (en mode `plein`, elle
         était bien plus haute que lui). Mesuré après la montée (~700 ms). */
      const hauteurs = await page.evaluate(MESURE_FEUILLE);
      noter(
        'le tiroir n’est plus en mode plein',
        hauteurs?.mode === 'normal',
        hauteurs?.mode,
      );
      /* Le parcours s'est allongé : sur ce décor il atteint le PLAFOND de 92 %
         (la zone défile, `deborde` > 0). On juge donc « jamais au-delà du
         plafond, jamais de vide sous le contenu », plus « strictement sous ». */
      noter(
        'la feuille s’arrête sur son contenu, sans zone vide',
        !!hauteurs && hauteurs.vide <= 2 && hauteurs.feuille <= Math.ceil(hauteurs.ecran * 0.92),
        JSON.stringify(hauteurs),
      );

      /* ---------------------------------------------------------------- */
      /* OÙ EN EST CHAQUE TÂCHE DU LOT — la première chose qu'on voit      */
      /* ---------------------------------------------------------------- */
      const lignesDuLot = page.locator('[data-tache-du-lot]');
      const combienDeTaches = await lignesDuLot.count();
      noter(
        'le tiroir montre UNE LIGNE PAR TÂCHE du lot, sans rien déplier',
        combienDeTaches === 3,
        `${combienDeTaches} ligne(s)`,
      );

      const titresDuLot = (await page.locator('[data-taches-du-lot]').first().textContent()) ?? '';
      noter(
        'chaque tâche est nommée par son TITRE, pas par un identifiant',
        /Première carte/.test(titresDuLot) &&
          /Seconde carte/.test(titresDuLot) &&
          /Carte laissée de côté/.test(titresDuLot),
        titresDuLot.replace(/\s+/g, ' ').slice(0, 120),
      );

      noter(
        'et chaque tâche DIT où elle en est, en français simple',
        /en ligne/.test(titresDuLot) && /recollée toute seule/.test(titresDuLot) && /écartée du lot/.test(titresDuLot),
        titresDuLot.replace(/\s+/g, ' ').slice(0, 160),
      );

      const ecartee = page.locator('[data-etat-tache="ecartee"]');
      noter(
        'ce qui est resté au bord se distingue des tâches passées',
        (await ecartee.count()) === 1 &&
          (await page.locator('[data-etat-tache="en-ligne"]').count()) === 1 &&
          (await page.locator('[data-etat-tache="recollee"]').count()) === 1,
      );

      /* ---------------------------------------------------------------- */
      /* LE CHIFFRE : tout le flux en tête, chaque branche sur sa ligne     */
      /* ---------------------------------------------------------------- */
      const pourcentFlux = page.locator('[data-pourcent-flux]');
      const texteFlux = (await pourcentFlux.count()) ? ((await pourcentFlux.first().textContent()) ?? '').trim() : '';
      noter(
        'le tiroir donne, EN TÊTE, le pourcentage de tout le flux',
        /^100\s*%$/.test(texteFlux),
        texteFlux,
      );

      const resumeFlux = page.locator('[data-resume-flux]');
      const texteResumeFlux = (await resumeFlux.count())
        ? ((await resumeFlux.first().textContent()) ?? '').trim()
        : '';
      noter(
        'le pourcentage dit d’où il sort : les étapes comptées (la sautée ne pèse pas)',
        /6.*sur 6/.test(texteResumeFlux),
        texteResumeFlux,
      );

      const pastilles = page.locator('[data-avancement-branche]');
      noter(
        'chaque branche embarquée porte SON pourcentage — sauf celle qui est écartée',
        (await pastilles.count()) === 2,
        `${await pastilles.count()} pastille(s) pour 3 tâches`,
      );
      noter(
        'une branche écartée ne se chiffre pas : elle n’avance plus',
        (await page.locator('[data-etat-tache="ecartee"] [data-avancement-branche]').count()) === 0,
      );

      const resumeLot = page.locator('[data-resume-du-lot]');
      const texteResume = (await resumeLot.count()) ? ((await resumeLot.first().textContent()) ?? '').trim() : '';
      noter(
        'un résumé compte, en tête, ce que la liste montre',
        /2 passées/.test(texteResume) && /1 écartée/.test(texteResume),
        texteResume,
      );

      /* ---------------------------------------------------------------- */
      /* LE PARCOURS RACONTE, LE DÉTAIL NOMME L'OPÉRATION                   */
      /* ---------------------------------------------------------------- */
      const titres = await page.locator('[data-etape-phrase]').allInnerTexts();
      noter(
        'chaque étape dit à la première personne ce qu’elle fait',
        titres.length > 0 && titres.every((titre) => /^J(?:e |’)/u.test(titre.trim())),
        titres.join(' | ').slice(0, 160),
      );
      noter(
        'les SIX étapes sont là, sautées comprises : aucune ne disparaît',
        titres.length === 6,
        `${titres.length} étape(s)`,
      );

      /* L'étape de fusion se choisit à la main : son détail doit s'afficher
         à droite, avec son nom d'opération et son fil. */
      const ligneFusion = page.locator('[data-etape-parcours="merge"]').first();
      noter('le parcours montre les étapes de cette publication', (await ligneFusion.count()) === 1);
      if (await ligneFusion.count()) {
        await ligneFusion.click();
        await page.waitForTimeout(500);
      }

      /* UN ÉCRAN BAS : la feuille plafonne à 92 % et c'est le parcours qui
         défile — jamais la feuille qui déborde de l'écran. */
      await page.setViewportSize({ width: 1500, height: 480 });
      await page.waitForTimeout(400);
      const bas = await page.evaluate(MESURE_FEUILLE);
      noter(
        'sur un écran bas, la feuille plafonne et le parcours défile',
        !!bas && bas.feuille <= bas.ecran * 0.92 + 1 && bas.deborde > 0,
        JSON.stringify(bas),
      );
      await page.setViewportSize({ width: 1500, height: 950 });
      await page.waitForTimeout(400);

      const nomOperation = page.locator('[data-etape-nom="merge"]');
      noter(
        'le détail NOMME l’opération, que le parcours raconte',
        (await nomOperation.count()) === 1 &&
          /Fusion des branches/.test(((await nomOperation.first().textContent()) ?? '').trim()),
      );
      const explication = page.locator('[data-description-etape="merge"]');
      noter(
        'et il explique LONGUEMENT ce que cette étape fait',
        (await explication.count()) === 1 &&
          ((await explication.first().textContent()) ?? '').trim().length > 120,
      );
      const compteDuFil = page.locator('[data-fil-compte="merge"]');
      noter(
        'le détail ne répète plus le compte de ses moments (allègement du 19/10/2026)',
        (await compteDuFil.count()) === 0,
      );

      const moments = page.locator('[data-fil-etape="merge"] [data-moment-fil]');
      const combien = await moments.count();
      noter('le FIL de l’étape se lit, moment par moment', combien === 6, `${combien} moments`);

      const heures = page.locator('[data-fil-etape="merge"] [data-heure-moment]');
      const premiere = (await heures.count()) ? ((await heures.first().textContent()) ?? '').trim() : '';
      noter('chaque moment porte son heure, secondes comprises', /^14:32:0\d$/.test(premiere), premiere);

      const commande = page.locator('[data-fil-etape="merge"] [data-moment-fil="commande"]');
      noter('les commandes réellement lancées se lisent', (await commande.count()) >= 1);
      const depannage = page.locator('[data-fil-etape="merge"] [data-moment-fil="depannage"]');
      noter('le passage d’un agent de dépannage se lit', (await depannage.count()) === 1);

      /* ---------------------------------------------------------------- */
      /* LA LIGNE DE DÉPANNAGE OUVRE LA CONVERSATION DE SON AGENT           */
      /* ---------------------------------------------------------------- */
      const ligneAgent = page.locator(`[data-moment-agent="${AGENT_DEPANNAGE}"]`);
      noter('la ligne de dépannage porte son agentId et se clique', (await ligneAgent.count()) === 1);
      if (await ligneAgent.count()) {
        await ligneAgent.click();
        await page.waitForTimeout(1200);

        const secondTiroir = page.locator('[data-tiroir-depannage]');
        noter('le clic ouvre un SECOND tiroir, empilé', (await secondTiroir.count()) === 1);

        const texteAgent = (await secondTiroir.count())
          ? ((await secondTiroir.first().textContent()) ?? '')
          : '';
        noter(
          'ce second tiroir montre la conversation de l’agent, en direct',
          /Conflit recollé sur CLAUDE\.md/.test(texteAgent),
          texteAgent.replace(/\s+/g, ' ').slice(0, 140),
        );

        /* LE RÉGLAGE RÉEL EN TÊTE DU FIL, EN LECTURE SEULE : moteur, modèle
           et compte lus sur l'agent — et aucun bouton pour les changer. */
        const reglage = secondTiroir.locator('[data-reglage-agent]');
        const texteReglage = (await reglage.count()) ? ((await reglage.first().textContent()) ?? '') : '';
        noter(
          'le tiroir de dépannage affiche le réglage réel de son agent',
          /Claude/.test(texteReglage) && /haiku/i.test(texteReglage) && /compte-essai-depannage/.test(texteReglage),
          texteReglage.replace(/\s+/g, ' ').slice(0, 140),
        );
        noter(
          'ce réglage se lit sans pouvoir se modifier',
          (await reglage.count()) === 1 && (await reglage.locator('button, select, input').count()) === 0,
        );
        /* UNE ÉTAPE MÉMOIRE N'Y A PAS SA PLACE : ce dépannage n'a reçu aucune mémoire. */
        noter(
          'aucun bloc « Base de connaissances » dans le fil du dépannage',
          !/Base de connaissances/.test(texteAgent),
        );

        /* Fermer le second tiroir laisse le premier ouvert : deux tiroirs
           empilés se referment chacun pour soi. */
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        noter(
          'refermer le tiroir de l’agent laisse celui de la publication ouvert',
          (await page.locator('[data-tiroir-depannage]').count()) === 0 &&
            (await page.locator('[data-volet-publication]').count()) === 1,
        );
      }

      /* UN HISTORIQUE NE SE REJOUE PAS : aucun bouton de décision dedans. */
      const texteTiroir = (await ouvert.first().textContent()) ?? '';
      noter(
        'l’historique ne propose ni « Relancer » ni « Arrêter » : on relit',
        !/Relancer|Arrêter/.test(texteTiroir),
      );

      /* UNE ÉTAPE SAUTÉE RESTE DANS LE PARCOURS. La retirer ferait croire
         qu'on l'a oubliée ; elle garde sa ligne et son état. */
      const sautee = page.locator('[data-etape-parcours="restart"]');
      noter(
        'une étape sautée garde sa ligne dans le parcours',
        (await sautee.count()) === 1 &&
          (await sautee.first().getAttribute('data-etat-process')) === 'skipped',
      );
      /* Celle-ci a été sautée SANS motif de préparation : elle ne doit donc
         PAS porter la mention « déjà faite en coulisses ». */
      noter(
        'une étape sautée sans motif de préparation ne se dit pas « en coulisses »',
        (await sautee.first().getAttribute('data-etape-preparee')) === null,
      );
    }

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
  }
}

/* ------------------------------------------------------------------ */

try {
  voletDuServeur();
  await voletDeLEcran();
} catch (erreur) {
  noter('le contrôle est allé au bout', false, String(erreur?.message ?? erreur));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
/* Le démon d'essai tourne en tuyaux : sa boucle garderait ce script vivant
   indéfiniment. On nettoie et on sort explicitement. */
nettoyer();
process.exit(echecs.length ? 1 : 0);
