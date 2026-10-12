/**
 * LE CAHIER DES CHARGES D'UN NOUVEAU PROJET, CÔTÉ DÉMON.
 *
 * Les règles et les textes vivent dans `shared/src/cahier-des-charges.ts` ; ce
 * module fait les gestes : faire naître la carte au montage du projet, écrire le
 * document et l'avancement (outil `cahier_des_charges`), mettre en pause,
 * reprendre, et lire le document pour l'écran.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  COMPETENCE_DU_CAHIER,
  DOCUMENT_DU_CAHIER,
  DOSSIER_INSPIRATION,
  TITRE_CARTE_CAHIER,
  cahierNeuf,
  consigneDuCahier,
  demandeDeLaCarteDeSuite,
  demandeDeRepriseDuCahier,
  demandeDuPremierTour,
  htmlDuCahier,
  nomDuCahierExporte,
  titreDeLaCarteDeSuite,
  lireAvancement,
  pausePossible,
  reprisePossible,
  type Card,
  type Project,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { PATHS } from './config.js';
import { safeJoin } from './files.js';

/*
 * LE MOTEUR, LES OUTILS ET LE CADRAGE SE CHARGENT À LA DEMANDE : les outils
 * importent ce module (l'outil `cahier_des_charges`), et le moteur lit la liste
 * des outils dès son chargement. Un import direct ferait tourner la boucle avant
 * que la liste n'existe.
 */
const moteur = () => import('./runtime.js');
const cadrageDuDemon = () => import('./cadrage.js');

/** Le mode d'emploi que l'agent lit en premier. */
function cheminDeLaCompetence(): string {
  return path.join(PATHS.competences, COMPETENCE_DU_CAHIER, 'SKILL.md');
}

/** La carte de cet agent, si c'est le cadrage d'une carte « cahier des charges ». */
function carteDuCahierDeLAgent(agentId: string): Card | null {
  const agent = store.getAgent(agentId);
  if (!agent || agent.role !== 'cadrage' || !agent.cardId) return null;
  const carte = store.getCard(agent.cardId);
  return carte?.cahierDesCharges ? carte : null;
}

/** L'outil `cahier_des_charges` n'est servi qu'à ce cadrage-là. */
export function estAgentDuCahier(agentId: string): boolean {
  return !!carteDuCahierDeLAgent(agentId);
}

/**
 * LA CONSIGNE DU PARCOURS, à ajouter à la consigne système du cadrage de cette
 * carte. Vide pour tout autre agent.
 */
export function consigneSystemeDuCahier(agentId: string): string {
  const carte = carteDuCahierDeLAgent(agentId);
  if (!carte) return '';
  const projet = store.getProject(carte.projectId);
  return consigneDuCahier(cheminDeLaCompetence(), projet?.path ?? '');
}

/**
 * LA CARTE NAÎT AU MONTAGE DU PROJET, et son agent ouvre la discussion. Le
 * premier tour passe par `sendPrompt` : choix du compte, file d'attente faute
 * de quota — jamais un envoi direct. Rien n'est attendu : le montage rend la
 * main tout de suite.
 */
export async function ouvrirLeCahierDesCharges(projet: Project, description?: string): Promise<Card | null> {
  const dit = String(description ?? '').trim();
  try {
    const { createCard } = await import('./tools.js');
    const { ouvrirLeCadrageDeLaCarte } = await import('./naissance-de-carte.js');
    const { sendPrompt } = await moteur();
    const nee = createCard(projet.id, {
      title: TITRE_CARTE_CAHIER,
      description:
        `Établir le cahier des charges du projet « ${projet.name} », question par question, puis le plan de construction. ` +
        `Une fois les deux validés, la carte construit l'application en un seul long travail (compétence « ${COMPETENCE_DU_CAHIER} »).`,
      briefing:
        `Démarrer le projet « ${projet.name} » par un cahier des charges : ce que fait l'application et pour qui, ` +
        `ses interfaces, ses fonctionnalités, ses technologies, son hébergement et son identité visuelle.` +
        (dit ? `\n\nCe que l'utilisateur a dit du projet en le créant : ${dit}` : ''),
      origin: 'user',
      cadrage: true,
    });
    const carte = store.saveCard({ ...nee, cahierDesCharges: cahierNeuf() });
    bus.emit({ type: 'card.upsert', card: carte });
    const cadrage = await ouvrirLeCadrageDeLaCarte(carte, 'utilisateur', false);
    if (cadrage) {
      void sendPrompt(cadrage.id, demandeDuPremierTour({ name: projet.name, description: dit }), { template: 'none', silent: true }).catch((err) =>
        log.error(`le cahier des charges de « ${projet.name} » n'a pas pu partir`, err),
      );
    }
    return store.getCard(carte.id) ?? carte;
  } catch (err) {
    log.error(`carte « cahier des charges » impossible à poser pour « ${projet.name} »`, err);
    return null;
  }
}

/** Le document d'un PROJET, lu tel qu'il est sur le disque — absent : `null`. */
export function lireLeDocumentDuProjet(projectId: string): { chemin: string; texte: string } | null {
  const projet = store.getProject(projectId);
  const cible = projet ? safeJoin(projet.path, DOCUMENT_DU_CAHIER) : null;
  if (!cible || !fs.existsSync(cible)) return null;
  return { chemin: DOCUMENT_DU_CAHIER, texte: fs.readFileSync(cible, 'utf8') };
}

/** Le document du projet de cette carte. */
export function lireLeDocument(carte: Card): { chemin: string; texte: string } | null {
  return lireLeDocumentDuProjet(carte.projectId);
}

/**
 * L'EXPORT : le document tel quel (`md`), ou mis en page en PDF par le Chrome
 * du système (`playwright`, `channel: 'chrome'`). Le navigateur se referme dans
 * TOUS les cas. Un projet sans document rend `null` : le bouton est caché.
 */
export async function exporterLeCahier(
  projectId: string,
  format: 'pdf' | 'md',
): Promise<{ nom: string; type: string; contenu: Buffer } | null> {
  const projet = store.getProject(projectId);
  const lu = lireLeDocumentDuProjet(projectId);
  if (!projet || !lu) return null;
  const nom = nomDuCahierExporte(projet.name, format);
  if (format === 'md') return { nom, type: 'text/markdown; charset=utf-8', contenu: Buffer.from(lu.texte, 'utf8') };
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await navigateur.newPage();
    await page.setContent(htmlDuCahier(lu.texte, `${TITRE_CARTE_CAHIER} — ${projet.name}`), { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    return { nom, type: 'application/pdf', contenu: Buffer.from(pdf) };
  } finally {
    await navigateur.close().catch(() => {});
  }
}

/**
 * L'OUTIL : le document ENTIER et l'avancement, après chaque réponse. Le
 * fichier s'écrit dans le dossier du projet (le cadrage n'a pas de branche) ;
 * la carte porte l'avancement, et l'écran se met à jour par `card.upsert`.
 */
export async function ecrireLeCahier(agentId: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const carte = carteDuCahierDeLAgent(agentId);
  if (!carte?.cahierDesCharges) {
    return { ok: false, text: 'Cet outil n’appartient qu’au cadrage d’une carte « cahier des charges ».' };
  }
  const lu = lireAvancement(args, carte.cahierDesCharges, Date.now());
  if (!lu.ok) return { ok: false, text: lu.raison };
  const document = typeof args.document === 'string' ? args.document : '';
  if (!document.trim()) return { ok: false, text: 'Le document ENTIER est obligatoire : il remplace le fichier.' };

  const projet = store.getProject(carte.projectId);
  const cible = projet ? safeJoin(projet.path, DOCUMENT_DU_CAHIER) : null;
  if (!cible) return { ok: false, text: 'Dossier du projet introuvable.' };
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  fs.writeFileSync(cible, document.endsWith('\n') ? document : `${document}\n`, 'utf8');

  const fraiche = store.getCard(carte.id) ?? carte;
  const ecrite = store.saveCard({ ...fraiche, cahierDesCharges: lu.cahier });
  bus.emit({ type: 'card.upsert', card: ecrite });
  const c = lu.cahier;
  if (!c.termineA) {
    return {
      ok: true,
      text: `Enregistré : ${c.faites} question(s) tranchée(s)${c.total ? ` sur ${c.total}` : ''}, document ${DOCUMENT_DU_CAHIER} à jour. Pose la question suivante.`,
    };
  }
  const suite = await passerLaMain(ecrite, agentId);
  return {
    ok: true,
    text:
      `Cahier des charges complet, enregistré dans ${DOCUMENT_DU_CAHIER}. Cette carte part dans « Archivé »` +
      (suite ? ` et la carte « ${suite.title} » prend la suite : c'est elle qui rendra la compréhension et le plan.` : '.') +
      ` Ne rends ni compréhension ni plan : termine ton tour par une phrase qui dit que le cahier est complet.`,
  };
}

/** Combien de temps on laisse au tour du cahier pour se refermer seul, avant de le couper. */
const ATTENTE_FIN_DU_TOUR_MS = 60_000;

/**
 * LA FIN DU CAHIER PASSE LA MAIN, UNE SEULE FOIS. La carte de construction naît
 * TOUT DE SUITE (son identifiant est écrit sur le cahier : un second « termine »
 * n'en fait pas naître une autre) ; le rangement de la carte du cahier, lui,
 * attend que son tour se referme — l'outil est appelé EN PLEIN tour, et
 * l'archivage refuse un agent qui parle encore. Passé un délai, le tour est
 * coupé comme par la pause. Puis la carte de suite ouvre son cadrage.
 */
async function passerLaMain(carte: Card, agentId: string): Promise<Card | null> {
  const cahier = carte.cahierDesCharges;
  if (!cahier) return null;
  const deja = cahier.suiteId ? store.getCard(cahier.suiteId) : undefined;
  if (deja) return deja;
  const projet = store.getProject(carte.projectId);
  if (!projet) return null;
  let suite: Card;
  try {
    suite = await creerLaCarteDeSuite(projet);
  } catch (err) {
    log.error(`la carte de suite du cahier de « ${projet.name} » n'a pas pu naître`, err);
    return null;
  }
  const marquee = store.saveCard({
    ...(store.getCard(carte.id) ?? carte),
    cahierDesCharges: { ...cahier, suiteId: suite.id },
  });
  bus.emit({ type: 'card.upsert', card: marquee });
  void rangerPuisLancer(carte.id, agentId, suite.id).catch((err) =>
    log.error(`la fin du cahier des charges de « ${projet.name} » n'a pas abouti`, err),
  );
  return suite;
}

/** La carte de construction, posée dans « Planifié » : elle ne part pas avant la validation de son plan. */
async function creerLaCarteDeSuite(projet: Project): Promise<Card> {
  // Chargé à la demande, comme au montage : les outils importent ce module.
  const { createCard } = await import('./tools.js');
  return createCard(projet.id, {
    title: titreDeLaCarteDeSuite(projet.name),
    description:
      `Construire l'application « ${projet.name} » à partir de son cahier des charges (${DOCUMENT_DU_CAHIER}) : ` +
      `compréhension, plan de construction, puis, une fois le plan validé, la construction en un seul long travail.`,
    briefing:
      `Le cahier des charges du projet « ${projet.name} » est terminé : ${projet.path}/${DOCUMENT_DU_CAHIER}. ` +
      `Sources d'inspiration fournies : ${projet.path}/${DOSSIER_INSPIRATION}/. ` +
      `Rendre la compréhension, puis le plan de construction (compétence « ${COMPETENCE_DU_CAHIER} »).`,
    origin: 'user',
    cadrage: true,
  });
}

async function rangerPuisLancer(cardId: string, agentId: string, suiteId: string): Promise<void> {
  const { isRunning, arreterLAgent, sendPrompt } = await moteur();
  const debut = Date.now();
  while (isRunning(agentId) && Date.now() - debut < ATTENTE_FIN_DU_TOUR_MS) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (isRunning(agentId)) {
    const vides = store.clearQueue(agentId);
    if (vides) bus.emit({ type: 'queue.etat', agentId, queue: [] });
    arreterLAgent(agentId);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const { archiveCard } = await import('./archive.js');
  const range = await archiveCard(cardId);
  if (!range.ok) log.warn(`la carte du cahier des charges n'a pas pu être archivée : ${range.error}`);

  const suite = store.getCard(suiteId);
  const projet = suite ? store.getProject(suite.projectId) : undefined;
  if (!suite || !projet) return;
  const { ouvrirLeCadrageDeLaCarte } = await import('./naissance-de-carte.js');
  const cadrage = await ouvrirLeCadrageDeLaCarte(suite, 'utilisateur', false);
  /* Sous les tests, aucun moteur ne part : la carte et son cadrage suffisent à juger. */
  if (!cadrage || process.env.NODE_TEST_CONTEXT) return;
  await sendPrompt(cadrage.id, demandeDeLaCarteDeSuite({ name: projet.name }, projet.path, cheminDeLaCompetence()), {
    template: 'none',
    silent: true,
  });
}

/**
 * METTRE EN PAUSE : la file se vide AVANT la coupe (règle de l'arrêt), puis
 * l'agent s'arrête s'il tournait. La colonne ne bouge pas — la carte est avant
 * le travail —, et la marque de pause empêche tout rattrapage de la relancer.
 */
export async function mettreEnPause(cardId: string): Promise<Card> {
  const carte = store.getCard(cardId);
  if (!carte) throw new Error('Carte introuvable.');
  const verdict = pausePossible(carte.cahierDesCharges);
  if (!verdict.possible) throw new Error(verdict.raison);
  const pausee = store.saveCard({ ...carte, cahierDesCharges: { ...carte.cahierDesCharges!, enPauseA: Date.now() } });
  bus.emit({ type: 'card.upsert', card: pausee });
  const { cadrageDeLaCarte } = await cadrageDuDemon();
  const agent = cadrageDeLaCarte(cardId);
  if (agent) {
    const { arreterLAgent, isRunning } = await moteur();
    const vides = store.clearQueue(agent.id);
    if (vides) bus.emit({ type: 'queue.etat', agentId: agent.id, queue: [] });
    if (isRunning(agent.id) || agent.status === 'running') arreterLAgent(agent.id);
  }
  return pausee;
}

/** REPRENDRE : la marque tombe, et l'agent repart avec le document et l'avancement. */
export async function reprendre(cardId: string): Promise<Card> {
  const carte = store.getCard(cardId);
  if (!carte) throw new Error('Carte introuvable.');
  const verdict = reprisePossible(carte.cahierDesCharges);
  if (!verdict.possible) throw new Error(verdict.raison);
  const cahier = { ...carte.cahierDesCharges!, enPauseA: undefined };
  const reprise = store.saveCard({ ...carte, cahierDesCharges: cahier });
  bus.emit({ type: 'card.upsert', card: reprise });
  const { cadrageDeLaCarte, ouvrirLeCadrage } = await cadrageDuDemon();
  const agent = cadrageDeLaCarte(cardId) ?? (await ouvrirLeCadrage(cardId));
  if (!agent) throw new Error('Aucun agent de cadrage pour reprendre ce cahier des charges.');
  const { sendPrompt } = await moteur();
  void sendPrompt(agent.id, demandeDeRepriseDuCahier(cahier, lireLeDocument(reprise)?.texte), {
    template: 'none',
    silent: true,
  }).catch((err) => log.error(`la reprise du cahier des charges « ${carte.title} » n'a pas pu partir`, err));
  return reprise;
}

/**
 * UN MESSAGE DE L'UTILISATEUR VAUT REPRISE : il parle à l'agent, la carte
 * n'est donc plus en pause. Sans effet sur toute autre carte.
 */
export function leverLaPauseSurMessage(cardId: string | undefined): void {
  if (!cardId) return;
  const carte = store.getCard(cardId);
  if (!carte?.cahierDesCharges?.enPauseA) return;
  const reprise = store.saveCard({ ...carte, cahierDesCharges: { ...carte.cahierDesCharges, enPauseA: undefined } });
  bus.emit({ type: 'card.upsert', card: reprise });
}
