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
  DOSSIER_DE_LA_SOURCE,
  RAPPORT_D_ANALYSE,
  consigneDuClonage,
  demandeDuPremierTourDuClonage,
  nomDeFichierDeSource,
  type SourceDuClonage,
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
  refusDeFinDuCahier,
  pausePossible,
  reprisePossible,
  resumeDeLaDemandeDeSuite,
  type Card,
  type Project,
} from '@beluga/shared';
import { viderLaFileEnRendant } from './file-rendue.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { PATHS } from './config.js';
import { safeJoin } from './files.js';
import { cheminDuModeDEmploiRea } from './rea.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { ajouterAuJournal, entreesDuJournal } from './journal-carte.js';

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
 * L'AGENT D'UN CAHIER QUI PART D'UN PRODUIT EXISTANT (clonage) : le seul qui
 * reçoit le serveur MCP de REA (`server/src/rea.ts`). Aucun autre agent n'en
 * paie les schémas.
 */
export function estAgentDuClonage(agentId: string): boolean {
  return !!carteDuCahierDeLAgent(agentId)?.cahierDesCharges?.source;
}

/**
 * LA CONSIGNE DU PARCOURS, à ajouter à la consigne système du cadrage de cette
 * carte. Vide pour tout autre agent.
 */
export function consigneSystemeDuCahier(agentId: string): string {
  const carte = carteDuCahierDeLAgent(agentId);
  if (!carte) return '';
  const projet = store.getProject(carte.projectId);
  const source = carte.cahierDesCharges?.source;
  const cahier = consigneDuCahier(cheminDeLaCompetence(), projet?.path ?? '', !!source);
  if (!source) return cahier;
  return `${cahier}\n\n${consigneDuClonage(source, projet?.path ?? '', cheminDuModeDEmploiRea())}`;
}

/**
 * LES FICHIERS DE LA SOURCE (APK, archive, HAR, captures) recopiés dans le
 * projet, sous `docs/inspiration/source/`. Rend leurs chemins relatifs au
 * projet ; un fichier illisible est sauté et dit dans le journal.
 */
function recopierLesFichiersDeLaSource(projet: Project, fichiers: string[]): string[] {
  const copies: string[] = [];
  for (const brut of fichiers) {
    const origine = path.resolve(brut);
    try {
      if (!fs.statSync(origine).isFile()) continue;
      const relatif = path.posix.join(DOSSIER_DE_LA_SOURCE, nomDeFichierDeSource(path.basename(origine)));
      const cible = safeJoin(projet.path, relatif);
      if (!cible) continue;
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.copyFileSync(origine, cible);
      copies.push(relatif);
    } catch (err) {
      log.warn(`fichier de source « ${brut} » non recopié dans « ${projet.name} » : ${(err as Error).message}`);
    }
  }
  return copies;
}

/**
 * LA CARTE NAÎT AU MONTAGE DU PROJET, et son agent ouvre la discussion. Le
 * premier tour passe par `sendPrompt` : choix du compte, file d'attente faute
 * de quota — jamais un envoi direct. Rien n'est attendu : le montage rend la
 * main tout de suite.
 */
export async function ouvrirLeCahierDesCharges(
  projet: Project,
  description?: string,
  sourceFournie?: SourceDuClonage,
): Promise<Card | null> {
  const dit = String(description ?? '').trim();
  const source = sourceFournie
    ? { ...sourceFournie, fichiers: recopierLesFichiersDeLaSource(projet, sourceFournie.fichiers) }
    : undefined;
  const montrer = source ? [source.url, source.nom, ...source.fichiers].filter(Boolean).join(', ') : '';
  try {
    const { createCard } = await import('./tools.js');
    const { ouvrirLeCadrageDeLaCarte } = await import('./naissance-de-carte.js');
    const { sendPrompt } = await moteur();
    const nee = createCard(projet.id, {
      title: TITRE_CARTE_CAHIER,
      description:
        (source
          ? `Analyser le produit existant (${montrer}), décider entre vrai clone et inspiration, puis établir le cahier des charges du projet « ${projet.name} » à partir de ce qui a été trouvé. `
          : `Établir le cahier des charges du projet « ${projet.name} », question par question, puis le plan de construction. `) +
        `Une fois les deux validés, la carte construit l'application en un seul long travail (compétence « ${COMPETENCE_DU_CAHIER} »).`,
      briefing:
        `Démarrer le projet « ${projet.name} » par un cahier des charges : ce que fait l'application et pour qui, ` +
        `ses interfaces, ses fonctionnalités, ses technologies, son hébergement et son identité visuelle.` +
        (source ? `\n\nLe projet part d'un produit existant : ${montrer}. Rapport d'analyse : ${RAPPORT_D_ANALYSE}.` : '') +
        (dit ? `\n\nCe que l'utilisateur a dit du projet en le créant : ${dit}` : ''),
      origin: 'user',
      cadrage: true,
    });
    const carte = store.saveCard({ ...nee, cahierDesCharges: cahierNeuf(source) });
    bus.emit({ type: 'card.upsert', card: carte });
    const cadrage = await ouvrirLeCadrageDeLaCarte(carte, 'utilisateur', false);
    /* Sous les tests, aucun moteur ne part : la carte et son cadrage suffisent à juger. */
    if (cadrage && !process.env.NODE_TEST_CONTEXT) {
      const premier = source
        ? demandeDuPremierTourDuClonage({ name: projet.name, description: dit }, source)
        : demandeDuPremierTour({ name: projet.name, description: dit });
      void sendPrompt(cadrage.id, premier, { template: 'none', silent: true }).catch((err) =>
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
  // UN CAHIER NE SE TERMINE QUE COMPLET (18/11/2026) : rien « à voir », et les spécificités de chaque type écrites.
  if (lu.cahier.termineA && !carte.cahierDesCharges.termineA) {
    const refus = refusDeFinDuCahier(document, !!carte.cahierDesCharges.source);
    if (refus) return { ok: false, text: `Refusé : ${refus} Rien n'a été enregistré : renvoie le document ENTIER.` };
  }

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
 * coupé comme par la pause. La carte de suite, elle, n'ouvre plus de cadrage :
 * elle attend le clic qui valide les réglages de l'agent et la lance.
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
    suite = await creerLaCarteDeSuite(projet, carte.id);
  } catch (err) {
    log.error(`la carte de suite du cahier de « ${projet.name} » n'a pas pu naître`, err);
    return null;
  }
  const marquee = store.saveCard({
    ...(store.getCard(carte.id) ?? carte),
    cahierDesCharges: { ...cahier, suiteId: suite.id },
  });
  bus.emit({ type: 'card.upsert', card: marquee });
  void rangerLeCahier(carte.id, agentId, suite.id).catch((err) =>
    log.error(`la fin du cahier des charges de « ${projet.name} » n'a pas abouti`, err),
  );
  return suite;
}

/**
 * LA CARTE DE CONSTRUCTION, posée dans « Planifié », PRÊTE À PARTIR (demande du
 * 22/10/2026) : sa demande d'exécution est déjà écrite (`briefing`), elle n'a
 * ni compréhension ni plan à attendre. Son bouton « Lancer » ouvre les
 * réglages de l'agent ; leur validation la lance (`suiteDuCahier`). Rien ne
 * part avant ce clic.
 */
async function creerLaCarteDeSuite(projet: Project, cahierId: string): Promise<Card> {
  // Chargé à la demande, comme au montage : les outils importent ce module.
  const { createCard } = await import('./tools.js');
  const carte = createCard(projet.id, {
    title: titreDeLaCarteDeSuite(projet.name),
    description:
      `Construire l'application « ${projet.name} » à partir de son cahier des charges (${DOCUMENT_DU_CAHIER}), ` +
      `en un seul long travail, dès que les réglages de l'agent sont validés.`,
    briefing: demandeDeLaCarteDeSuite({ name: projet.name }, projet.path, cheminDeLaCompetence()),
    origin: 'user',
    cadrage: true,
  });
  const marquee = store.saveCard({ ...carte, suiteDuCahier: { cahierId } });
  bus.emit({ type: 'card.upsert', card: marquee });
  return (await poserLaDemandeDeLaSuite(marquee, projet)) ?? marquee;
}

/**
 * LA CARTE DE CONSTRUCTION NAÎT AVEC SA DEMANDE ÉCRITE ET LE CAHIER JOINT.
 *
 * Elle n'ouvre pas de cadrage (MEM-4606), donc personne n'écrivait le jalon
 * « Demande » de son journal (`ouvrirLeCadrageDeLaCarte` le fait pour les
 * autres) : le point « Demande » tournait dans le vide jusqu'au lancement. Le
 * jalon est écrit ici, SANS agent (aucun n'existe avant le lancement), avec le
 * briefing entier et le cahier des charges — copie figée du document à la fin
 * des questions — en pièce jointe. La pièce entre aussi dans `attachments` de la
 * carte : le lancement la liste à l'agent d'exécution (« PIÈCES JOINTES »).
 * Aucun moteur ne part (règle « rien ne part au moteur avant le lancement »).
 *
 * Idempotent : une carte qui a déjà son jalon « Demande » n'est pas touchée.
 * Une jointure qui échoue n'empêche ni la naissance ni le jalon. Rend la carte
 * relue, ou `null` si rien n'a été écrit.
 */
const demandesEnCoursDEcriture = new Set<string>();

export async function poserLaDemandeDeLaSuite(carte: Card, projet: Project): Promise<Card | null> {
  /* La jointure est asynchrone : deux rattrapages simultanés (démarrage et
     ouverture) écriraient deux jalons sans ce verrou. */
  if (demandesEnCoursDEcriture.has(carte.id)) return null;
  demandesEnCoursDEcriture.add(carte.id);
  try {
    return await ecrireLaDemandeDeLaSuite(carte, projet);
  } finally {
    demandesEnCoursDEcriture.delete(carte.id);
  }
}

async function ecrireLaDemandeDeLaSuite(carte: Card, projet: Project): Promise<Card | null> {
  if (entreesDuJournal(carte.id).some((e) => e.nature === 'jalon' && e.libelle === 'Demande')) return null;
  const briefing = carte.briefing?.trim();
  if (!briefing) return null;
  let pieces: string[] = [];
  const fichier = safeJoin(projet.path, DOCUMENT_DU_CAHIER);
  if (fichier && fs.existsSync(fichier)) {
    try {
      const jointure = await joindreUnFichier({
        projectId: projet.id,
        cardId: carte.id,
        fichier,
        nom: nomDuCahierExporte(projet.name, 'md'),
      });
      if (jointure.ok) pieces = [jointure.attachment.id];
      else log.warn(`cahier des charges de « ${projet.name} » non joint à sa carte de construction : ${jointure.refus}`);
    } catch (err) {
      log.warn(`cahier des charges de « ${projet.name} » non joint à sa carte de construction`, err);
    }
  }
  const relue = store.getCard(carte.id) ?? carte;
  const jointes = [...new Set([...(relue.attachments ?? []), ...pieces])];
  const avecPiece = jointes.length !== (relue.attachments ?? []).length ? store.saveCard({ ...relue, attachments: jointes }) : relue;
  if (avecPiece !== relue) bus.emit({ type: 'card.upsert', card: avecPiece });
  const jalon = ajouterAuJournal({
    cardId: carte.id,
    // La demande PRÉCÈDE le travail : une phase « exécution » ferait croire la carte déjà partie.
    phase: 'cadrage',
    nature: 'jalon',
    libelle: 'Demande',
    resultat: briefing,
    at: carte.createdAt,
    donnees: {
      resumeDemande: resumeDeLaDemandeDeSuite(projet.name),
      pieces: pieces.length ? pieces : undefined,
    },
  });
  if (!jalon) return null;
  bus.emit({ type: 'journal.entree', entree: jalon });
  return avecPiece;
}

/**
 * AU DÉMARRAGE : les cartes de construction nées AVANT cette règle (sans jalon
 * « Demande », sans agent, encore avant le travail) reçoivent leur demande et
 * leur pièce jointe — rien d'autre, aucun moteur. Rend le nombre de cartes
 * complétées. Idempotent.
 */
export async function completerLesDemandesDesSuites(): Promise<number> {
  let completees = 0;
  for (const projet of store.listProjects(true)) {
    for (const carte of store.listCardsInColumn(projet.id, 'planned')) {
      if (await rattraperLaDemandeDeLaSuite(carte)) completees += 1;
    }
  }
  return completees;
}

/**
 * UNE CARTE DE CONSTRUCTION SANS DEMANDE la reçoit — au démarrage, ou à son
 * ouverture (une carte posée pendant que le démon tourne déjà, par une copie
 * de base ou un ancien démon). Seulement avant le travail, non rangée, sans
 * agent. Rend vrai si la demande a été écrite.
 */
export async function rattraperLaDemandeDeLaSuite(carte: Card): Promise<boolean> {
  if (!carte.suiteDuCahier || carte.archivedAt || carte.column !== 'planned') return false;
  if (carte.agentId || carte.conversationAgentId || store.getLastAgentByCard(carte.id)) return false;
  const projet = store.getProject(carte.projectId);
  if (!projet) return false;
  return (await poserLaDemandeDeLaSuite(carte, projet)) !== null;
}

async function rangerLeCahier(cardId: string, agentId: string, suiteId: string): Promise<void> {
  const { isRunning, arreterLAgent } = await moteur();
  const debut = Date.now();
  while (isRunning(agentId) && Date.now() - debut < ATTENTE_FIN_DU_TOUR_MS) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (isRunning(agentId)) {
    viderLaFileEnRendant(agentId, 'Le cahier des charges est rangé : votre message en attente revient dans le champ.');
    arreterLAgent(agentId);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const { archiveCard } = await import('./archive.js');
  const range = await archiveCard(cardId);
  if (!range.ok) log.warn(`la carte du cahier des charges n'a pas pu être archivée : ${range.error}`);
  /* PLUS DE CADRAGE SUR LA CARTE DE SUITE : elle attend dans « Planifié » le
     clic sur « Valider la configuration et lancer ». Aucun moteur ne part. */
  if (!store.getCard(suiteId)) log.warn(`la carte de construction ${suiteId} a disparu avant la fin du cahier`);
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
    viderLaFileEnRendant(agent.id, 'Le cahier des charges est en pause : votre message en attente revient dans le champ.');
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
