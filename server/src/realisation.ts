/**
 * LE MODE « RÉALISATION » CÔTÉ DÉMON (bouton caméra, carte du 18/10/2026) —
 * l'outil « realiser » de l'agent de tâche, la dépense, le rangement des
 * fichiers et la liste lue par la page « Médias ».
 *
 * Les règles (catalogue, budget, seuil, accord, noms de fichiers) sont PURES
 * et vivent dans `shared/src/services-de-generation.ts` et
 * `shared/src/mode-realisation.ts`. Ici, on les applique au vrai monde :
 * clés du coffre, appels réseau, disque de stockage, table `medias_realisation`.
 *
 * AUCUN APPEL PAYANT SANS DEVIS VALIDÉ (décision de l'utilisateur du
 * 24/10/2026, studio créatif) : « generer » ne part que pour un devis inscrit
 * dans un LOT que l'utilisateur a validé d'un clic (`shared/src/production.ts`,
 * `server/src/production.ts`) — refus sans budget ou au-delà, question BLOQUANTE
 * (DEC-026) pour chaque lot, prix non publié compris. La réservation, le débit
 * et la libération sont tenus ici, sous le verrou de la carte.
 *
 * LES FICHIERS vont sous `PATHS.medias/<projet>/<branche de la carte>/`
 * (disque de stockage), une version par essai d'un plan (`plan-v1`, `plan-v2`) ;
 * chacun est aussi joint au fil de la carte, où il se lit sur place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AgentQuestion,
  Message,
  IDS_SERVICES_CREATION,
  CATEGORIES_FAL_LUES,
  lireReponseDeLumiere,
  ceQueRecoitLeModele,
  corpsEnDirect,
  catalogueVisible,
  entreesDeLaPageKie,
  entreesDuSchemaJson,
  estServiceCache,
  KIE_ENVOI,
  DOLLARS_PAR_CREDIT,
  lireEnvoiKie,
  lireSoldeKie,
  modeleKie,
  modelesKieDeLaDoc,
  prixKie,
  requeteDuSoldeKie,
  TAILLE_MAX_ENVOI_KIE,
  entreesDuModeleFal,
  entreesEnClair,
  filtrerLesModelesLus,
  modelesFalLus,
  modelesHiggsfieldDeLaDoc,
  requeteEnDirect,
  type EntreeDeModele,
  type ModeleLuEnDirect,
  type Attachment,
  type Card,
  type CapaciteDeGeneration,
  type EtatDeGeneration,
  type FormatDeMedia,
  type IdServiceCreation,
  type IdServiceGeneration,
  type ModeleDeGeneration,
  type SourceDuPrix,
  CAPACITES_DE_GENERATION,
  DATE_DES_NOTES,
  accordDeRealisationDonne,
  adresseDeSuiviDeGeneration,
  arrondi,
  budgetDuCahier,
  rubriquesDuDocumentDeRealisation,
  consigneDeFabrication,
  consigneDuQuestionnaire,
  carteDeMedia,
  passagesDuMedia,
  placementDansUnPlan,
  decoupageDuMedia,
  animationPermise,
  etapesDuMedia,
  etapeCouranteDuMedia,
  phaseDesEsquisses,
  sonDuBrief,
  elementsCourants,
  questionDUneGeneration,
  reessaiDOfficePermis,
  PROPOSITIONS_MIN_D_UN_MEDIA,
  typesDeMediaDeLaRealisation,
  resumeDeLaProduction,
  decisionDApercu,
  estUnApercu,
  formatLePlusProche,
  genreDePieceDuFil,
  planDePieceDuFil,
  MODELE_DES_APERCUS,
  PHASES_DE_REALISATION,
  PREFIXE_DES_APERCUS,
  PREFIXE_DES_EXEMPLES,
  ENVELOPPE_DES_EXEMPLES,
  realisationDeLaCarte,
  type PhaseDeRealisation,
  dossierRelatifDesMedias,
  dureeAjustee,
  extensionDuMedia,
  genreDuMedia,
  libelleDuPrix,
  lireCreationDeGeneration,
  lireResultatImageFal,
  lireSuiviDeGeneration,
  modeleDeGeneration,
  modeleVideoDeService,
  modelesOpenRouterLus,
  modelesProposes,
  nomDuFichierDeMedia,
  prixImageFal,
  questionDeBudget,
  ratioAjuste,
  requeteDeGeneration,
  serviceDeGeneration,
  texteSansAttente,
  type BudgetDeRealisation,
  type GenreDeMedia,
  CAPACITES_DE_GENERATION as CAPACITES,
  ETAPES_DU_SUIVI,
  GENRES_D_ELEMENT,
  REPONSE_SANS_BRANCHEMENT,
  capacitesDesTypes,
  capacitesSansService,
  catalogueDeGeneration,
  decisionDuLot,
  issueDePanne,
  lotValideParLaReponse,
  porteDeGeneration,
  questionDuLotDeDevis,
  reservationPossible,
  servicesPourLesCapacites,
  totalDuLot,
  type EtatDeProduction,
  type GenreDElement,
  type LotDeDevis,
  type MediaDuSuivi,
  activationAccordee,
  contenuEncadre,
  contenuNettoye,
  DOMAINES_DE_METHODE,
  langueDeDeclinaison,
  libelleDeNote,
  ligneDeMethodePourConsigne,
  planDeDeclinaison,
  prixALUniteFal,
  questionDActivationDeMethode,
  questionDAvisDeProduction,
  requeteDEnvoiFal,
  SOURCES_DE_METHODES,
  sourceDeMethodes,
  TAILLE_MAX_ENVOI_FAL,
  texteDuPlanDeDeclinaison,
  verdictDeProduction,
  type DomaineDeMethode,
  type LangueDeDeclinaison,
  angleDeVue,
  directionBornee,
  directionPermise,
  estUneRetoucheDImage,
  libelleDeDirection,
  lireMesureFfprobe,
  nombreDePropositions,
  phraseDAngle,
  phraseDeVisageCible,
  type BoiteDeVisage,
  phraseDeLumiere,
  PARAMETRES_DES_ANGLES,
  PROPOSITIONS_PAR_GENERATION,
  ANGLES_DE_VUE,
  type AngleDeVue,
  type DirectionDeLumiere,
  type MesureDeMedia,
  BIBLIOTHEQUES_DE_COMPOSITION,
  CAPACITE_COMPOSITION,
  VOIX_FINALES,
  VOIX_FINALE_PAR_DEFAUT,
  idDeComposition,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { getDb } from './db.js';
import { PATHS } from './config.js';
import { log } from './logger.js';
import { cleDuService, fabriquerClipChezLeService, plafondDuClip, servicesDeGenerationBranches, tarifsKie } from './studio-services.js';
import { apercusDeLaComposition, compositionDisponible, controlerComposition, dossierDeComposition, livrerLeFilm, preparerComposition, rendreComposition } from './composition.js';
import { MODELE_VOIX_OPENROUTER, cleOpenRouter, motsDeLaVoix, prixEstimeDeLaVoix, voixParOpenRouter } from './voix-de-realisation.js';
import { fabriquerDesSons } from './sons-de-composition.js';
import { consigneAEnvoyer } from './traduction-des-consignes.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { annoncerUnMedia, terminerUnMedia } from './medias-en-fabrication.js';
import { cheminAbsoluDuDocument, lireLeDocumentDeRealisation } from './realisation-questionnaire.js';
import {
  avecLeVerrouDeLaCarte,
  creerUnLot,
  deciderDuLot,
  elementsDeLaCarte,
  evenementsDeLaCarte,
  lotParId,
  lotsDeLaCarte,
  marquerLOperation,
  noterUnElement,
  noterUnEvenement,
  operationDuMedia,
  poserLaQuestionDuLot,
  prevenirLesEcrans,
} from './production.js';
import {
  avisDuMedia,
  deciderVersion,
  enregistrerAvis,
  enregistrerUsages,
  methodeParNom,
  methodesEnService,
  noteDeLaVersion,
  poserQuestionDAvis,
  poserQuestionDeVersion,
  proposerVersion,
  versionActive,
  versionParId,
  versionsDuMedia,
  versionsProposees,
} from './methodes-creatives.js';

/* ------------------------------------------------------------------ */
/* L'état de la carte                                                  */
/* ------------------------------------------------------------------ */

/** Le mode est-il allumé sur la carte de cet agent ? */
export function realisationAllumeePourLAgent(agentId: string): boolean {
  const agent = store.getAgent(agentId);
  if (!agent?.cardId) return false;
  return !!store.getCard(agent.cardId)?.parcours?.realisationSouhaitee;
}

/**
 * Le budget en vigueur : celui accepté pendant la fabrication, sinon celui du
 * document de réalisation, sinon celui du cahier vivant (cartes d'avant le
 * questionnaire à document). Le premier montant trouvé l'emporte.
 */
export function budgetDeLaCarte(card: Card): BudgetDeRealisation {
  /* UNE CRÉATION DE MÉDIA N'A PLUS DE BUDGET NI DE PLAFOND (26/10/2026) : ce
     qui peut partir, c'est exactement ce que l'utilisateur a accepté, clic par
     clic — la somme des lots validés. */
  if (carteDeMedia(card)) return { budget: totalDesLotsAcceptes(card.id), seuil: null };
  const fixe = card.parcours?.realisationBudget;
  if (fixe) return { budget: fixe.budget, seuil: fixe.seuil };
  const duDocument = budgetDuCahier(rubriquesDuDocumentDeRealisation(lireLeDocumentDeRealisation(card)?.texte));
  const duCahier = budgetDuCahier(card.parcours?.comprehension?.cahierDesCharges);
  return { budget: duDocument.budget ?? duCahier.budget, seuil: duDocument.seuil ?? duCahier.seuil };
}

/** Ce que l'utilisateur a accepté d'un clic sur une création de média : les lots validés, au prix annoncé. */
export function totalDesLotsAcceptes(cardId: string): number {
  const total = lotsDeLaCarte(cardId)
    .filter((l) => l.etat === 'valide')
    .reduce((somme, l) => somme + totalDuLot(l.operations).connu, 0);
  return Math.round(total * 1e4) / 1e4;
}

/** Ce que la carte a déjà engagé : les générations lancées ou finies, au coût réel quand il est connu. */
export function depenseDeLaCarte(cardId: string): number {
  const ligne = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(cout_reel, prix, 0)), 0) AS total FROM medias_realisation
        WHERE card_id = ? AND etat IN ('en-cours', 'fini') AND plan NOT LIKE '${PREFIXE_DES_APERCUS}%'`,
    )
    .get(cardId) as { total: number } | undefined;
  return Math.round((ligne?.total ?? 0) * 1e4) / 1e4;
}

/** Ce que les APERÇUS du questionnaire ont engagé : pris sur l'enveloppe, jamais sur le budget principal. */
export function depenseDesApercus(cardId: string): number {
  const ligne = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(cout_reel, prix, 0)), 0) AS total FROM medias_realisation
        WHERE card_id = ? AND etat IN ('en-cours', 'fini') AND plan LIKE '${PREFIXE_DES_APERCUS}%' AND plan NOT LIKE '${PREFIXE_DES_EXEMPLES}%'`,
    )
    .get(cardId) as { total: number } | undefined;
  return Math.round((ligne?.total ?? 0) * 1e4) / 1e4;
}

/**
 * CE QUE LES EXEMPLES PAYANTS D'UNE CARTE ONT DÉJÀ COÛTÉ (`exemples-de-choix.ts`),
 * au coût réel quand il est connu — à part de l'enveloppe du mode caméra.
 */
export function depenseDesExemples(cardId: string): number {
  const ligne = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(cout_reel, prix, 0)), 0) AS total FROM medias_realisation
        WHERE card_id = ? AND etat IN ('en-cours', 'fini') AND plan LIKE '${PREFIXE_DES_EXEMPLES}%'`,
    )
    .get(cardId) as { total: number } | undefined;
  return Math.round((ligne?.total ?? 0) * 1e4) / 1e4;
}

/** Les services branchés, en une ligne par service et ce qu'ils savent faire. */
function resumeDesServices(): string {
  const branches = servicesDeGenerationBranches();
  if (!branches.length) return '';
  return branches
    .map((id) => {
      const capacites = [...new Set(modelesProposes([id]).map((m) => m.capacite))];
      return `${serviceDeGeneration(id)?.nom ?? id} (« ${id} »)${capacites.length ? ` : ${capacites.join(', ')}` : ''}`;
    })
    .join(' ; ');
}

/**
 * LA CONSIGNE DU MODE, prête à partir avec la demande du tour : le
 * questionnaire au cadrage, la méthode du réalisateur à l'exécution.
 */
export function consigneDeRealisationDeLaCarte(card: Card, role: string): string {
  if (!card.parcours?.realisationSouhaitee) return '';
  const document = cheminAbsoluDuDocument(card);
  /* LE DIRECTEUR ARTISTIQUE, QUEL QUE SOIT SON RÔLE (26/10/2026) : la même
     consigne, celle de l'étape où se trouve la carte. */
  if (role === 'cadrage' || carteDeMedia(card)) {
    const types = typesDeMediaDeLaRealisation(card.realisation);
    const elements = elementsDeLaCarte(card.id);
    const etape = etapeCouranteDuMedia(etapesDuMedia({ carte: card, elements, lots: lotsDeLaCarte(card.id) }));
    const production = elements.length ? resumeDeLaProduction(elements, types) : '';
    const consigne = consigneDuQuestionnaire({
      medias: types,
      document,
      capacites: capacitesCouvertes(),
      etape,
      phase: phaseDesEsquisses(types, card.realisation),
      son: sonDuBrief(elementsCourants(elements).find((e) => e.genre === 'brief')?.contenu),
      ...(card.realisation?.style ? { style: card.realisation.style } : {}),
      methodes: lignesDesMethodesEnService(),
    });
    return production ? `${consigne}\nL’ÉTAT DE LA PRODUCTION, LU EN BASE :\n${production}` : consigne;
  }
  const elements = elementsDeLaCarte(card.id);
  return consigneDeFabrication({
    ...budgetDeLaCarte(card),
    prixAccorde: card.parcours?.realisationBudget?.prixAccorde,
    production: elements.length ? resumeDeLaProduction(elements, typesDeMediaDeLaRealisation(card.realisation)) : '',
    depense: depenseDeLaCarte(card.id),
    services: resumeDesServices(),
    document: lireLeDocumentDeRealisation(card) ? document : undefined,
    methodes: lignesDesMethodesEnService(),
    ...(card.realisation?.style ? { style: card.realisation.style } : {}),
  });
}

/** Une ligne par méthode en service, pour la consigne de l'agent. */
function lignesDesMethodesEnService(): string[] {
  return methodesEnServiceSansPanne().map((m) =>
    ligneDeMethodePourConsigne({ nom: m.methode.nom, domaine: m.methode.domaine, numero: m.version.numero, note: m.note }),
  );
}

/** Les méthodes en service ; une base qui n'a pas encore la migration 140 n'en a aucune. */
function methodesEnServiceSansPanne() {
  try {
    return methodesEnService();
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* La table                                                            */
/* ------------------------------------------------------------------ */

export type EtatDeMedia = 'devis' | 'en-cours' | 'fini' | 'echec' | 'refuse';

export interface MediaDeRealisation {
  id: string;
  projectId: string;
  cardId: string;
  agentId: string | null;
  branche: string | null;
  plan: string;
  version: number;
  capacite: CapaciteDeGeneration;
  genre: GenreDeMedia;
  /** « montage » : assemblé par l'agent ; « serveur » : une composition écrite par l'agent et rendue sur le serveur, sans frais. */
  /** « fil » : une pièce du fil inscrite au premier geste de son menu « … », sans fabrication. */
  service: IdServiceGeneration | 'montage' | 'serveur' | 'fil';
  modele: string;
  modeleNom: string;
  demande: {
    /** La consigne ENVOYÉE au service : en anglais pour une image, une vidéo, une musique ou un bruitage. */
    consigne: string;
    /** La consigne écrite par l'agent, quand elle a été traduite avant l'envoi (`consigneAEnvoyer`). */
    consigneOriginale?: string;
    format: FormatDeMedia;
    duree?: number;
    voix?: string;
    avatar?: string;
    son?: boolean;
    /** La langue parlée (déclinaison) : code à deux lettres. */
    langue?: string;
    /** Synchronisation labiale : les médias finis de la vidéo d'origine et de la nouvelle voix. */
    video?: string;
    audio?: string;
    /**
     * ANIMATION ET RETOUCHES (24/10/2026) : les images d'entrée — l'image
     * animée ou retouchée d'abord (un média fini de la carte), puis les photos
     * de référence d'un visage (médias ou pièces jointes du projet).
     */
    sources?: string[];
    /** Autres angles : l'angle demandé (et son nom, quand il vient de la liste). */
    angle?: AngleDeVue & { nom?: string };
    /** Lumière : la direction choisie sur la sphère et la valeur fixe envoyée au modèle. */
    lumiere?: DirectionDeLumiere & { valeur?: string };
    typeDeLumiere?: string;
    /** Visage : qui remplacer dans l'image (les numéros choisis, ou la description). */
    cible?: string;
    /** Animation : l'IMAGE DE FIN du plan (un média image fini de la carte, ou une pièce jointe du projet). */
    fin?: string;
    /** Contrôle du mouvement : la VIDÉO DE RÉFÉRENCE (média vidéo du projet ou pièce jointe) dont le personnage reprend les gestes. */
    mouvement?: string;
    orientation?: 'image' | 'video';
    /**
     * MODÈLE LU EN DIRECT (24/10/2026) : son schéma d'entrée, gardé avec la
     * demande pour que la fabrication construise la requête sans relire le
     * catalogue, et les réglages de l'agent vérifiés contre lui.
     */
    entrees?: EntreeDeModele[];
    parametres?: Record<string, unknown>;
  };
  raison: string;
  prix: number | null;
  sourcePrix: SourceDuPrix | 'aucun';
  coutReel: number | null;
  etat: EtatDeMedia;
  questionId: string | null;
  echec: string | null;
  fichier: string | null;
  taille: number | null;
  attachmentId: string | null;
  /** L'étape du volet de suivi que ce média sert (« plans », « son »…), nommée au devis. */
  etape: string | null;
  /** Le lot de devis qui l'autorise (`production_lots`) ; nul tant qu'il n'est dans aucun lot. */
  lotId: string | null;
  /**
   * AJOUTÉ AU SUIVI (24/10/2026) : le suivi de la production ne montre que les
   * médias retenus par l'utilisateur, d'un clic sur « Ajouter au suivi ».
   * Retirer remet `null` : le fichier reste dans le fil.
   */
  retenuLe?: number | null;
  /**
   * LE PLAN OÙ L'UTILISATEUR L'A PLACÉ (28/10/2026), qui l'emporte sur `plan`
   * dans le suivi (`planEffectif`). Retirer la validation le remet à `null`.
   */
  planPlace?: string | null;
  /** Le média d'origine d'une retouche ou d'une animation. */
  sourceId?: string | null;
  /** Ce qu'on sait du fichier rangé (dimensions, durée, débit…), mesuré par ffprobe. */
  mesure?: MesureDeMedia | null;
  creeLe: number;
  modifieLe: number;
}

function lireLigne(r: any): MediaDeRealisation {
  let demande: MediaDeRealisation['demande'] = { consigne: '', format: '16:9' };
  try {
    demande = JSON.parse(r.demande);
  } catch {
    /* une demande illisible garde la forme vide */
  }
  return {
    id: r.id,
    projectId: r.project_id,
    cardId: r.card_id,
    agentId: r.agent_id ?? null,
    branche: r.branche ?? null,
    plan: r.plan,
    version: r.version,
    capacite: r.capacite,
    genre: r.genre,
    service: r.service,
    modele: r.modele,
    modeleNom: r.modele_nom,
    demande,
    raison: r.raison ?? '',
    prix: r.prix ?? null,
    sourcePrix: r.source_prix,
    coutReel: r.cout_reel ?? null,
    etat: r.etat,
    questionId: r.question_id ?? null,
    echec: r.echec ?? null,
    fichier: r.fichier ?? null,
    taille: r.taille ?? null,
    attachmentId: r.attachment_id ?? null,
    etape: r.etape ?? null,
    lotId: r.lot_id ?? null,
    retenuLe: r.retenu_le ?? null,
    planPlace: r.plan_place ?? null,
    sourceId: r.source_id ?? null,
    mesure: lireJson(r.mesure),
    creeLe: r.cree_le,
    modifieLe: r.modifie_le,
  };
}

function lireJson<T>(brut: unknown): T | null {
  if (typeof brut !== 'string' || !brut) return null;
  try {
    return JSON.parse(brut) as T;
  } catch {
    return null;
  }
}

function enregistrer(m: MediaDeRealisation): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO medias_realisation
        (id, project_id, card_id, agent_id, branche, plan, version, capacite, genre, service, modele, modele_nom, demande, raison,
         prix, source_prix, cout_reel, etat, question_id, echec, fichier, taille, attachment_id, etape, lot_id, retenu_le, plan_place, source_id, mesure,
         cree_le, modifie_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.id, m.projectId, m.cardId, m.agentId, m.branche, m.plan, m.version, m.capacite, m.genre, m.service, m.modele, m.modeleNom,
      JSON.stringify(m.demande), m.raison, m.prix, m.sourcePrix, m.coutReel, m.etat, m.questionId, m.echec, m.fichier, m.taille,
      m.attachmentId, m.etape, m.lotId, m.retenuLe ?? null, m.planPlace ?? null, m.sourceId ?? null, m.mesure ? JSON.stringify(m.mesure) : null, m.creeLe, m.modifieLe,
    );
  /* Le volet de suivi ouvert relit : un devis, un départ, une fin, un échec. */
  prevenirLesEcrans(m.cardId);
}

function maj(m: MediaDeRealisation, champs: Partial<MediaDeRealisation>): MediaDeRealisation {
  const nouveau = { ...m, ...champs, modifieLe: Date.now() };
  enregistrer(nouveau);
  return nouveau;
}

export function mediaParId(id: string): MediaDeRealisation | null {
  const r = getDb().prepare(`SELECT * FROM medias_realisation WHERE id = ?`).get(id);
  return r ? lireLigne(r) : null;
}

export function mediasDeLaCarte(cardId: string): MediaDeRealisation[] {
  return (getDb().prepare(`SELECT * FROM medias_realisation WHERE card_id = ? ORDER BY cree_le`).all(cardId) as any[]).map(lireLigne);
}

/** La prochaine version d'un plan : les versions FINIES déjà rangées, plus une. */
function versionSuivante(cardId: string, plan: string): number {
  const r = getDb()
    .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM medias_realisation WHERE card_id = ? AND plan = ? AND etat = 'fini'`)
    .get(cardId, plan) as { v: number } | undefined;
  return (r?.v ?? 0) + 1;
}

/* ------------------------------------------------------------------ */
/* La page « Médias » : les médias FINIS d'un projet, rangés par carte  */
/* ------------------------------------------------------------------ */

export interface GroupeDeMedias {
  cardId: string;
  titre: string;
  colonne: string | null;
  depense: number;
  dernier: number;
  medias: {
    id: string;
    plan: string;
    version: number;
    genre: GenreDeMedia;
    modele: string;
    service: string;
    prix: number | null;
    attachmentId: string | null;
    nom: string | null;
    taille: number | null;
    creeLe: number;
  }[];
}

/**
 * LES MÉDIAS D'UN PROJET, une carte par groupe, la plus récente d'abord.
 * Paginé PAR CARTE (`limite` cartes à partir de `avant`, une date) : un projet
 * qui a beaucoup produit ne charge jamais tout d'un coup. `genre` filtre.
 */
export function mediasDuProjet(projectId: string, opts: { genre?: GenreDeMedia; avant?: number; limite?: number } = {}): {
  groupes: GroupeDeMedias[];
  suite: number | null;
  totaux: { image: number; video: number; son: number };
} {
  const limite = Math.min(Math.max(opts.limite ?? 12, 1), 50);
  const filtreGenre = opts.genre ? ' AND genre = ?' : '';
  const params: unknown[] = [projectId];
  if (opts.genre) params.push(opts.genre);
  const avant = opts.avant ?? Number.MAX_SAFE_INTEGER;
  const cartes = getDb()
    .prepare(
      `SELECT card_id, MAX(cree_le) AS dernier FROM medias_realisation
        WHERE project_id = ? AND etat = 'fini'${filtreGenre}
        GROUP BY card_id HAVING dernier < ? ORDER BY dernier DESC LIMIT ?`,
    )
    .all(...params, avant, limite + 1) as { card_id: string; dernier: number }[];
  const page = cartes.slice(0, limite);
  const groupes = page.map(({ card_id, dernier }) => {
    const carte = store.getCard(card_id);
    const lignes = (
      getDb()
        .prepare(`SELECT * FROM medias_realisation WHERE card_id = ? AND etat = 'fini'${filtreGenre} ORDER BY cree_le`)
        .all(card_id, ...(opts.genre ? [opts.genre] : [])) as any[]
    ).map(lireLigne);
    return {
      cardId: card_id,
      titre: carte?.title ?? 'Carte retirée',
      colonne: carte?.column ?? null,
      depense: depenseDeLaCarte(card_id),
      dernier,
      medias: lignes.map((m) => ({
        id: m.id,
        plan: m.plan,
        version: m.version,
        genre: m.genre,
        modele: m.modeleNom,
        service: m.service,
        prix: m.coutReel ?? m.prix,
        attachmentId: m.attachmentId,
        nom: m.fichier ? path.basename(m.fichier) : null,
        taille: m.taille,
        creeLe: m.creeLe,
      })),
    };
  });
  const totaux = { image: 0, video: 0, son: 0 };
  for (const r of getDb()
    .prepare(`SELECT genre, COUNT(*) AS n FROM medias_realisation WHERE project_id = ? AND etat = 'fini' GROUP BY genre`)
    .all(projectId) as { genre: GenreDeMedia; n: number }[]) {
    if (r.genre in totaux) totaux[r.genre] = r.n;
  }
  return { groupes, suite: cartes.length > limite ? page[page.length - 1]!.dernier : null, totaux };
}

/** Les projets qui ont des médias, avec leur nombre : la colonne de gauche de la page. */
export function projetsAvecMedias(): { projectId: string; nombre: number }[] {
  return (
    getDb()
      .prepare(`SELECT project_id AS projectId, COUNT(*) AS nombre FROM medias_realisation WHERE etat = 'fini' GROUP BY project_id`)
      .all() as { projectId: string; nombre: number }[]
  ).filter((p) => !!store.getProject(p.projectId));
}

/* ------------------------------------------------------------------ */
/* Les appels                                                          */
/* ------------------------------------------------------------------ */

async function appeler(requete: { methode: string; adresse: string; entetes: Record<string, string>; corps?: unknown }, delai = 30_000): Promise<{ statut: number; corps: any }> {
  const r = await fetch(requete.adresse, {
    method: requete.methode,
    headers: requete.entetes,
    ...(requete.corps !== undefined ? { body: JSON.stringify(requete.corps) } : {}),
    signal: AbortSignal.timeout(delai),
  });
  const texte = await r.text().catch(() => '');
  let corps: any = texte;
  try {
    corps = texte ? JSON.parse(texte) : {};
  } catch {
    /* une page d'erreur en HTML reste du texte */
  }
  return { statut: r.status, corps };
}

/** Les modèles d'image d'OpenRouter, relus au plus toutes les heures (liste publique). */
let openrouterLu: { le: number; modeles: ModeleDeGeneration[] } | null = null;
async function modelesOpenRouter(): Promise<ModeleDeGeneration[]> {
  if (openrouterLu && Date.now() - openrouterLu.le < 3_600_000) return openrouterLu.modeles;
  try {
    const { statut, corps } = await appeler({ methode: 'GET', adresse: 'https://openrouter.ai/api/v1/models?output_modalities=image', entetes: {} }, 15_000);
    if (statut === 200) openrouterLu = { le: Date.now(), modeles: modelesOpenRouterLus(corps) };
  } catch (err) {
    log.warn('réalisation : liste des modèles d’image OpenRouter illisible', String((err as Error)?.message ?? err));
  }
  return openrouterLu?.modeles ?? [];
}

/*
 * LE CATALOGUE LU EN DIRECT (24/10/2026, `shared/src/catalogue-en-direct.ts`) :
 * fal.ai par sa liste publique, Higgsfield par sa documentation publique —
 * deux lectures GRATUITES, sans clé, gardées six heures. Un échec de lecture
 * rend la dernière liste connue (ou rien) : le catalogue choisi reste servi.
 */
const DUREE_DU_CATALOGUE_EN_DIRECT = 6 * 3_600_000;
type ServiceEnDirect = 'fal' | 'higgsfield' | 'kie';
const SERVICES_EN_DIRECT: readonly ServiceEnDirect[] = ['kie', 'fal', 'higgsfield'];
const estEnDirect = (s: unknown): s is ServiceEnDirect => (SERVICES_EN_DIRECT as readonly unknown[]).includes(s);
const catalogueLu = new Map<ServiceEnDirect, { le: number; modeles: ModeleLuEnDirect[] }>();
export async function catalogueEnDirect(service: ServiceEnDirect): Promise<ModeleLuEnDirect[]> {
  const deja = catalogueLu.get(service);
  if (deja && Date.now() - deja.le < DUREE_DU_CATALOGUE_EN_DIRECT) return deja.modeles;
  try {
    let modeles: ModeleLuEnDirect[] = [];
    if (service === 'fal') {
      for (const categorie of CATEGORIES_FAL_LUES) {
        let curseur = '';
        for (let page = 0; page < 3; page++) {
          const { statut, corps } = await appeler(
            { methode: 'GET', adresse: `https://api.fal.ai/v1/models?category=${categorie}&status=active&limit=100${curseur ? `&cursor=${encodeURIComponent(curseur)}` : ''}`, entetes: {} },
            20_000,
          );
          if (statut !== 200) break;
          modeles.push(...modelesFalLus(corps));
          if (!corps?.has_more || !corps?.next_cursor) break;
          curseur = String(corps.next_cursor);
        }
      }
    } else if (service === 'kie') {
      /* kie.ai : la liste de sa documentation publique ; le schéma de chaque modèle se lit sur sa page, à la demande. */
      const r = await fetch('https://docs.kie.ai/llms.txt', { signal: AbortSignal.timeout(30_000) });
      if (r.ok) {
        modeles = modelesKieDeLaDoc(await r.text()).map((m) => ({
          service: 'kie' as const,
          id: m.page,
          page: m.page,
          nom: `${m.nom} (kie.ai)`.slice(0, 90),
          capacite: m.capacite,
          categorie: m.categorie,
          qualite: 3,
          usage: `${m.famille} — ${m.nom}`.slice(0, 160),
          prix: 'credits-kie' as const,
          entrees: [],
        }));
      }
    } else {
      const r = await fetch('https://docs.higgsfield.ai/llms-full.txt', { signal: AbortSignal.timeout(30_000) });
      if (r.ok) modeles = modelesHiggsfieldDeLaDoc(await r.text());
    }
    const uniques = [...new Map(modeles.map((m) => [`${m.id}|${m.capacite}`, m])).values()];
    if (uniques.length) catalogueLu.set(service, { le: Date.now(), modeles: uniques });
  } catch (err) {
    log.warn(`réalisation : catalogue en direct de ${service} illisible`, String((err as Error)?.message ?? err));
  }
  return catalogueLu.get(service)?.modeles ?? [];
}

/** Le schéma d'un modèle kie.ai, lu une fois par page : son vrai identifiant et ses entrées. */
const schemasKie = new Map<string, { id: string; entrees: EntreeDeModele[] }>();
async function schemaDeLaPageKie(page: string): Promise<{ id: string; entrees: EntreeDeModele[] } | null> {
  const deja = schemasKie.get(page);
  if (deja) return deja;
  try {
    const r = await fetch(`https://docs.kie.ai/market/${page}.md`, { signal: AbortSignal.timeout(20_000) });
    const lu = r.ok ? entreesDeLaPageKie(await r.text(), (schema) => entreesDuSchemaJson(schema)) : null;
    if (lu) schemasKie.set(page, lu);
    return lu;
  } catch {
    return null;
  }
}

/** Le schéma d'entrée d'un modèle fal, lu une fois par modèle (Higgsfield l'a déjà dans sa documentation). */
const schemasFal = new Map<string, EntreeDeModele[]>();
async function entreesDuModeleLu(m: ModeleLuEnDirect): Promise<EntreeDeModele[]> {
  if (m.service === 'kie' && !m.entrees.length) return (await schemaDeLaPageKie(m.page ?? m.id))?.entrees ?? [];
  if (m.entrees.length || m.service !== 'fal') return m.entrees;
  const deja = schemasFal.get(m.id);
  if (deja) return deja;
  try {
    const { statut, corps } = await appeler({ methode: 'GET', adresse: `https://api.fal.ai/v1/models?endpoint_id=${encodeURIComponent(m.id)}&expand=openapi-3.0`, entetes: {} }, 20_000);
    const entrees = statut === 200 ? entreesDuModeleFal(corps, m.id) : [];
    if (entrees.length) schemasFal.set(m.id, entrees);
    return entrees;
  } catch {
    return [];
  }
}

/** Un modèle lu en direct, par service et identifiant (la capacité tranche quand il en sert plusieurs). */
async function modeleLuEnDirect(service: string, id: string, capacite?: unknown): Promise<(ModeleLuEnDirect & { entrees: EntreeDeModele[] }) | null> {
  if (!estEnDirect(service) || estServiceCache(service)) return null;
  /* kie.ai : l'agent désigne un modèle par sa page (« kling/v3-omni-text-to-video ») ou par son vrai identifiant, une fois la page lue. */
  const tous = (await catalogueEnDirect(service)).filter((m) => m.id === id || m.page === id || (service === 'kie' && schemasKie.get(m.page ?? '')?.id === id));
  const m = (capacite ? tous.find((x) => x.capacite === capacite) : undefined) ?? tous[0];
  if (!m) return null;
  if (service === 'kie') {
    const lu = await schemaDeLaPageKie(m.page ?? m.id);
    return lu ? { ...m, id: lu.id, entrees: lu.entrees } : null;
  }
  const entrees = await entreesDuModeleLu(m);
  return entrees.length ? { ...m, entrees } : null;
}

/** Le solde de kie.ai, en crédits (lecture gratuite) ; `null` s'il est illisible. */
async function soldeKie(cle: string): Promise<number | null> {
  try {
    const { corps } = await appeler(requeteDuSoldeKie(cle), 15_000);
    return lireSoldeKie(corps);
  } catch {
    return null;
  }
}

/** Le prix PUBLIÉ d'une génération : fal.ai seulement (vidéo, image, voix, synchronisation), jamais deviné ailleurs. */
async function prixPublie(modele: ModeleDeGeneration, duree: number, quantite: { secondes?: number; caracteres?: number; texte?: string } = {}): Promise<number | null> {
  if (modele.service === 'openrouter' && modele.id === MODELE_VOIX_OPENROUTER) return quantite.texte ? prixEstimeDeLaVoix(quantite.texte) : null;
  if (modele.prix === 'credits-kie') {
    /* kie.ai : la liste publique des prix, par la ligne du modèle choisi (ou, lu en direct, par son lien). */
    const k = modeleKie(modele.id, modele.capacite);
    const secondes = quantite.secondes ?? (modele.capacite === 'video' || modele.capacite === 'animation' ? duree : undefined);
    return prixKie(await tarifsKie(), k ? { tarif: k.tarif } : { id: modele.id }, { ...quantite, ...(secondes ? { secondes } : {}) });
  }
  if (modele.prix !== 'api-fal') return null;
  if (modele.capacite === 'video') return plafondDuClip('fal', modele.id, duree);
  const cle = cleDuService('fal');
  if (!cle) return null;
  try {
    const { statut, corps } = await appeler({ methode: 'GET', adresse: `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(modele.id)}`, entetes: { Authorization: `Key ${cle}` } }, 15_000);
    if (statut !== 200) return null;
    const tarif = corps?.prices?.find((p: any) => p.endpoint_id === modele.id);
    return modele.capacite === 'image' || estUneRetoucheDImage(modele.capacite) ? prixImageFal(tarif) : prixALUniteFal(tarif, quantite);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* La fabrication — APRÈS une dépense validée seulement                */
/* ------------------------------------------------------------------ */

/** Le rythme du suivi d'un travail (réglable par les tests seulement). */
export const RYTHME_REALISATION = { pauseMs: 6_000, delaiMaxMs: 25 * 60_000, attenteSuiviMs: 100_000 };

/** Les fabrications en vol, par devis : un redémarrage les perd, et `suivre` le dit. */
const enVol = new Map<string, Promise<void>>();

function brancheDeLaCarte(card: Card, agentId: string | null): string {
  if (card.github?.branch) return card.github.branch;
  const dossier = agentId ? (store.getAgent(agentId) as { workdir?: string } | null)?.workdir : undefined;
  if (dossier) {
    try {
      const b = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dossier, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (b && b !== 'HEAD') return b;
    } catch {
      /* pas un dépôt : le nom de la carte suffit */
    }
  }
  return `carte-${card.id.slice(0, 8)}`;
}

/** Le dossier des médias d'une carte, créé au besoin, sur le disque de stockage. */
export function dossierDesMediasDeLaCarte(card: Card, agentId: string | null): string {
  const projet = store.getProject(card.projectId);
  const dossier = path.join(PATHS.medias, dossierRelatifDesMedias(projet?.name ?? card.projectId, brancheDeLaCarte(card, agentId)));
  fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

async function telecharger(url: string, entetes: Record<string, string> = {}): Promise<{ data: Buffer; type: string }> {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error('le service a rendu une image illisible');
    return { data: m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!)), type: m[1] ?? '' };
  }
  const r = await fetch(url, { headers: entetes, signal: AbortSignal.timeout(5 * 60_000) });
  if (!r.ok) throw new Error(`le média est prêt mais son téléchargement a échoué (${r.status})`);
  return { data: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') ?? '' };
}

/**
 * Fabrique le média d'un devis : appel, suivi borné, téléchargement, rangement
 * sur le disque, puis jointure au fil. Une panne se dit avec sa raison.
 */
async function fabriquer(m: MediaDeRealisation, attente: (ms: number) => Promise<void>): Promise<{ data: Buffer; type: string; coutReel?: number }> {
  const service = m.service as IdServiceGeneration;
  /* LA VOIX FINALE PAR OPENROUTER : le texte validé, une des vingt voix Gemini, le coût réel relevé (MEM-4350). */
  if (service === 'openrouter' && m.capacite === 'voix') {
    const sortie = path.join(PATHS.medias, `.en-cours-${m.id}.wav`);
    fs.mkdirSync(PATHS.medias, { recursive: true });
    try {
      const cout = await voixParOpenRouter(m.demande.voix || VOIX_FINALE_PAR_DEFAUT, m.demande.consigneOriginale ?? m.demande.consigne, sortie);
      return { data: fs.readFileSync(sortie), type: 'audio/wav', coutReel: cout };
    } finally {
      fs.rmSync(sortie, { force: true });
    }
  }
  const cle = cleDuService(service);
  if (!cle) throw new Error(`${serviceDeGeneration(service)?.nom ?? service} n’est plus branché : sa clé a été retirée`);

  // LA VIDÉO DES SERVICES DU STUDIO passe par leur chemin éprouvé, inchangé.
  /* kie.ai passe par le chemin commun, qui relève le coût RÉEL de chaque travail. */
  if (m.capacite === 'video' && service !== 'kie' && (IDS_SERVICES_CREATION as readonly string[]).includes(service)) {
    const video = modeleVideoDeService(service, m.modele);
    if (!video) throw new Error(`modèle vidéo inconnu chez ${service} : ${m.modele}`);
    const temporaire = path.join(PATHS.medias, `.en-cours-${m.id}.mp4`);
    fs.mkdirSync(PATHS.medias, { recursive: true });
    try {
      await fabriquerClipChezLeService(
        {
          service: service as IdServiceCreation,
          modele: video,
          consigne: m.demande.consigne,
          duree: dureeAjustee(video, m.demande.duree ?? video.durees[0]!),
          ratio: ratioAjuste(video, m.demande.format === '4:5' ? '9:16' : m.demande.format),
          son: m.demande.son ?? video.son,
        },
        temporaire,
        attente,
      );
      return { data: fs.readFileSync(temporaire), type: 'video/mp4' };
    } finally {
      fs.rmSync(temporaire, { force: true });
    }
  }

  if (service === 'kie') {
    /* Un solde vide se dit AVANT la commande (la lecture est gratuite). */
    const solde = await soldeKie(cle);
    if (solde !== null && solde <= 0) throw new Error('le crédit de votre compte kie.ai est épuisé : rechargez-le sur kie.ai, rien n’a été lancé');
  }
  const adresses =
    m.capacite === 'synchro' && service === 'fal'
      ? await envoyerChezFal(cle, m)
      : m.capacite === 'synchro' && service === 'kie'
        ? await envoyerChezKie(cle, m)
        : {};
  /* L'ANIMATION ET LES RETOUCHES partent d'images : déposées chez le service (gratuit) juste avant l'appel payant, déjà accordé. */
  const imageUrls = m.demande.sources?.length ? await deposerLesSources(service, cle, m.demande.sources) : undefined;
  /* L'IMAGE DE FIN et LA VIDÉO DE MOUVEMENT sont déposées de la même façon, juste avant l'appel. */
  const imageDeFinUrl = m.demande.fin ? (await deposerLesSources(service, cle, [m.demande.fin]))[0] : undefined;
  const videoDeMouvementUrl = m.demande.mouvement ? (await deposerLesSources(service, cle, [m.demande.mouvement]))[0] : undefined;
  const demande = {
    ...m.demande,
    ...adresses,
    ...(imageUrls ? { imageUrls } : {}),
    ...(imageDeFinUrl ? { imageDeFinUrl } : {}),
    ...(videoDeMouvementUrl ? { videoDeMouvementUrl } : {}),
  };
  let forme: ReturnType<typeof requeteDeGeneration>;
  const k = service === 'kie' && !m.demande.entrees?.length ? modeleKie(m.modele, m.capacite) : undefined;
  if (m.demande.entrees?.length && (service === 'fal' || service === 'higgsfield' || service === 'kie')) {
    /* UN MODÈLE LU EN DIRECT : la requête suit son schéma, gardé avec la demande. */
    const corps = corpsEnDirect(m.demande.entrees, demande);
    if (!corps.ok) throw new Error(`commande refusée avant l’envoi : ${corps.raison}`);
    forme = { requete: requeteEnDirect(service, m.modele, cle, corps.corps), forme: 'travail' };
  } else if (k) {
    /* Un modèle kie.ai choisi : son schéma recopié et ses réglages d'office (`shared/src/kie.ts`). */
    const corps = corpsEnDirect(k.entrees, demande, k.defauts);
    if (!corps.ok) throw new Error(`commande refusée avant l’envoi : ${corps.raison}`);
    forme = { requete: requeteEnDirect('kie', k.id, cle, corps.corps), forme: 'travail' };
  } else {
    forme = requeteDeGeneration({ service, id: m.modele, capacite: m.capacite }, cle, demande);
  }
  if (!forme) throw new Error(`${serviceDeGeneration(service)?.nom ?? service} ne sait pas fabriquer « ${m.capacite} » par cette voie`);

  if (forme.forme === 'fichier') {
    const r = await fetch(forme.requete.adresse, {
      method: forme.requete.methode,
      headers: forme.requete.entetes,
      body: JSON.stringify(forme.requete.corps),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!r.ok) {
      const texte = await r.text().catch(() => '');
      let corps: any = texte;
      try {
        corps = JSON.parse(texte);
      } catch {
        /* texte brut */
      }
      const e = lireCreationDeGeneration({ service: 'heygen', capacite: m.capacite }, r.status, corps);
      throw new Error(e.etat === 'echec' ? e.raison : `refus du service (${r.status})`);
    }
    return { data: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') ?? 'audio/mpeg' };
  }

  const creation = await appeler(forme.requete, 3 * 60_000);
  let etat: EtatDeGeneration = lireCreationDeGeneration({ service, capacite: m.capacite }, creation.statut, creation.corps);
  const fin = Date.now() + RYTHME_REALISATION.delaiMaxMs;
  const entetes = forme.requete.entetes;
  // Le suivi est une lecture : sans corps, donc sans type de contenu.
  const entetesDeLecture = Object.fromEntries(Object.entries(entetes).filter(([k]) => k.toLowerCase() !== 'content-type'));
  while (etat.etat === 'attente') {
    if (Date.now() > fin) throw new Error('le service n’a pas rendu le média dans le délai : il se retrouve peut-être plus tard dans votre compte chez lui');
    await attente(RYTHME_REALISATION.pauseMs);
    const suivi = etat.suivi;
    const r = await appeler({ methode: 'GET', adresse: adresseDeSuiviDeGeneration(service, suivi), entetes: entetesDeLecture }).catch(() => ({ statut: 503, corps: {} }));
    etat = lireSuiviDeGeneration({ service }, r.statut, r.corps, suivi);
    if (etat.etat === 'fini' && service === 'fal') {
      const resultat = await appeler({ methode: 'GET', adresse: suivi.split('\n')[1]!, entetes: entetesDeLecture });
      etat = resultat.statut === 200 ? lireResultatImageFal(resultat.corps) : { etat: 'echec', raison: `fal.ai n’a pas rendu le résultat (${resultat.statut})` };
    }
  }
  if (etat.etat === 'echec') throw new Error(etat.raison);
  const fichier = await telecharger(etat.url, service === 'replicate' ? { Authorization: `Bearer ${cle}` } : {});
  return { ...fichier, ...(etat.coutReel !== undefined ? { coutReel: etat.coutReel } : {}) };
}

/**
 * LA SYNCHRONISATION LABIALE attend des ADRESSES : la vidéo d'origine et la
 * nouvelle voix, deux médias finis du projet, sont déposés chez fal.ai
 * (envoi gratuit) juste avant l'appel payant, déjà accordé.
 */
async function envoyerChezFal(cle: string, m: MediaDeRealisation): Promise<{ videoUrl: string; audioUrl: string }> {
  const deposer = async (id: string | undefined, quoi: string): Promise<string> => {
    const source = id ? mediaParId(id) : null;
    if (!source?.fichier || !fs.existsSync(source.fichier)) throw new Error(`${quoi} à synchroniser est introuvable sur le disque`);
    const data = fs.readFileSync(source.fichier);
    if (data.length > TAILLE_MAX_ENVOI_FAL) throw new Error(`${quoi} dépasse 90 Mo : raccourcis-la avant de la synchroniser`);
    const ext = path.extname(source.fichier).slice(1).toLowerCase();
    const type = ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : ext === 'wav' ? 'audio/wav' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
    const demande = await appeler(requeteDEnvoiFal(cle, type, path.basename(source.fichier)), 60_000);
    const depot = demande.corps?.upload_url;
    const adresse = demande.corps?.file_url;
    if (demande.statut !== 200 || typeof depot !== 'string' || typeof adresse !== 'string') throw new Error(`fal.ai refuse l’envoi du fichier (${demande.statut})`);
    const r = await fetch(depot, { method: 'PUT', body: data, headers: { 'Content-Type': type }, signal: AbortSignal.timeout(5 * 60_000) });
    if (!r.ok) throw new Error(`l’envoi du fichier chez fal.ai a échoué (${r.status})`);
    return adresse;
  };
  return { videoUrl: await deposer(m.demande.video, 'la vidéo'), audioUrl: await deposer(m.demande.audio, 'la voix') };
}

/**
 * LE DÉPÔT D'UN FICHIER CHEZ kie.ai (gratuit, gardé 24 h) : envoi en flux
 * (`multipart`), l'adresse publique revient dans `data.downloadUrl`. Appelé
 * seulement APRÈS l'accord de dépense, juste avant la commande.
 */
async function deposerChezKie(cle: string, fichier: string, type: string): Promise<string> {
  const data = fs.readFileSync(fichier);
  if (data.length > TAILLE_MAX_ENVOI_KIE) throw new Error('un fichier d’entrée dépasse 100 Mo : raccourcis-le avant de l’envoyer');
  const formulaire = new FormData();
  formulaire.append('file', new Blob([data], { type }), path.basename(fichier));
  formulaire.append('uploadPath', 'beluga');
  formulaire.append('fileName', `${Date.now()}-${path.basename(fichier)}`.slice(0, 120));
  const r = await fetch(KIE_ENVOI, { method: 'POST', headers: { Authorization: `Bearer ${cle}` }, body: formulaire, signal: AbortSignal.timeout(5 * 60_000) });
  const texte = await r.text().catch(() => '');
  let corps: any = {};
  try {
    corps = JSON.parse(texte);
  } catch {
    /* page d'erreur */
  }
  const lu = lireEnvoiKie(r.status, corps);
  if (!lu.ok) throw new Error(lu.raison);
  return lu.url;
}

/** La synchronisation labiale chez kie.ai : la vidéo d'origine et la nouvelle voix, déposées juste avant l'appel payant, déjà accordé. */
async function envoyerChezKie(cle: string, m: MediaDeRealisation): Promise<{ videoUrl: string; audioUrl: string }> {
  const deposer = async (id: string | undefined, quoi: string): Promise<string> => {
    const source = id ? mediaParId(id) : null;
    if (!source?.fichier || !fs.existsSync(source.fichier)) throw new Error(`${quoi} à synchroniser est introuvable sur le disque`);
    const ext = path.extname(source.fichier).slice(1).toLowerCase();
    const type = ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : ext === 'wav' ? 'audio/wav' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
    return deposerChezKie(cle, source.fichier, type);
  };
  return { videoUrl: await deposer(m.demande.video, 'la vidéo'), audioUrl: await deposer(m.demande.audio, 'la voix') };
}

/** Le fichier d'une source : un média de la carte (son fichier rangé) ou une pièce jointe du projet. */
export function fichierDUneSource(id: string): { fichier: string; type: string } | null {
  const media = mediaParId(id);
  if (media?.fichier && fs.existsSync(media.fichier)) {
    const ext = path.extname(media.fichier).slice(1).toLowerCase();
    return {
      fichier: media.fichier,
      type: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'image/png',
    };
  }
  const piece = store.getAttachment(id);
  if (piece) {
    const chemin = cheminDePieceJointe(piece);
    if (fs.existsSync(chemin)) return { fichier: chemin, type: piece.mime };
  }
  return null;
}

/**
 * LES IMAGES D'ENTRÉE d'une animation ou d'une retouche, rendues en adresses
 * que le service sait lire : déposées chez fal.ai ou chez Higgsfield (adresse
 * d'envoi signée, gratuite), ou jointes en `data:` pour OpenRouter.
 */
async function deposerLesSources(service: IdServiceGeneration, cle: string, ids: readonly string[]): Promise<string[]> {
  const adresses: string[] = [];
  for (const [i, id] of ids.entries()) {
    const source = fichierDUneSource(id);
    if (!source) throw new Error(i === 0 ? 'le fichier d’entrée (image de départ, de fin ou vidéo de référence) est introuvable sur le disque' : `la photo de référence n° ${i} est introuvable`);
    const data = fs.readFileSync(source.fichier);
    if (data.length > TAILLE_MAX_ENVOI_FAL) throw new Error('un fichier d’entrée dépasse 90 Mo');
    if (service === 'openrouter') {
      adresses.push(`data:${source.type};base64,${data.toString('base64')}`);
    } else if (service === 'kie') {
      adresses.push(await deposerChezKie(cle, source.fichier, source.type));
    } else if (service === 'fal') {
      const demande = await appeler(requeteDEnvoiFal(cle, source.type, path.basename(source.fichier)), 60_000);
      const depot = demande.corps?.upload_url;
      const adresse = demande.corps?.file_url;
      if (demande.statut !== 200 || typeof depot !== 'string' || typeof adresse !== 'string') throw new Error(`fal.ai refuse l’envoi de l’image (${demande.statut})`);
      const r = await fetch(depot, { method: 'PUT', body: data, headers: { 'Content-Type': source.type }, signal: AbortSignal.timeout(5 * 60_000) });
      if (!r.ok) throw new Error(`l’envoi de l’image chez fal.ai a échoué (${r.status})`);
      adresses.push(adresse);
    } else if (service === 'higgsfield') {
      /* docs.higgsfield.ai, « Upload files » (relu le 24/10/2026) : une adresse signée, puis un PUT avec les en-têtes rendus. */
      const demande = await appeler(
        { methode: 'POST', adresse: 'https://api.higgsfield.ai/files/generate-upload-url', entetes: { Authorization: `Key ${cle}`, 'Content-Type': 'application/json' }, corps: { content_type: source.type } },
        60_000,
      );
      const depot = demande.corps?.upload_url;
      const publique = demande.corps?.public_url;
      if (demande.statut !== 200 || typeof depot !== 'string' || typeof publique !== 'string') throw new Error(`Higgsfield refuse l’envoi de l’image (${demande.statut})`);
      const entetes: Record<string, string> = { 'Content-Type': source.type };
      for (const [k, v] of Object.entries(demande.corps?.upload_headers ?? {})) if (typeof v === 'string') entetes[k] = v;
      const r = await fetch(depot, { method: 'PUT', body: data, headers: entetes, signal: AbortSignal.timeout(5 * 60_000) });
      if (!r.ok) throw new Error(`l’envoi de l’image chez Higgsfield a échoué (${r.status})`);
      adresses.push(publique);
    } else {
      throw new Error(`${serviceDeGeneration(service)?.nom ?? service} ne reçoit pas d’image par cette voie`);
    }
  }
  return adresses;
}

/** Range le fichier, le joint au fil, et marque le média fini. */
async function ranger(m: MediaDeRealisation, data: Buffer, type: string, coutReel?: number): Promise<MediaDeRealisation> {
  const card = store.getCard(m.cardId);
  if (!card) throw new Error('la carte a disparu pendant la fabrication');
  /* Un aperçu du questionnaire n'a pas de branche : il se range sous le nom de la carte. */
  const dossier = dossierDesMediasDeLaCarte(card, estUnApercu(m.plan) ? null : m.agentId);
  const version = versionSuivante(m.cardId, m.plan);
  const fichier = path.join(dossier, nomDuFichierDeMedia(m.plan, version, extensionDuMedia(m.capacite, type)));
  fs.writeFileSync(fichier, data);
  let attachmentId: string | null = null;
  try {
    const jointe = await joindreUnFichier({ projectId: m.projectId, agentId: m.agentId ?? undefined, cardId: m.cardId, fichier, deLAgent: true });
    if (jointe.ok) attachmentId = jointe.attachment.id;
  } catch (err) {
    log.warn('réalisation : média rangé mais non joint au fil', String((err as Error)?.message ?? err));
  }
  const mesure = await mesurerLeFichier(fichier);
  const fini = maj(mediaParId(m.id) ?? m, { etat: 'fini', version, fichier, taille: data.length, attachmentId, mesure, ...(coutReel !== undefined ? { coutReel } : {}) });
  return fini;
}

const execFileAsync = promisify(execFile);

/**
 * CE QU'ON SAIT DU FICHIER RANGÉ — dimensions, durée, images par seconde,
 * débit —, lu UNE fois par ffprobe et gardé en base : la ligne d'informations
 * sous le média n'affiche que cela, jamais une estimation. Ne lève jamais.
 */
async function mesurerLeFichier(fichier: string): Promise<MesureDeMedia | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', fichier], { timeout: 30_000 });
    const mesure = lireMesureFfprobe(JSON.parse(stdout));
    return Object.keys(mesure).length ? mesure : null;
  } catch {
    return null;
  }
}

/** LA LIBÉRATION : le média passe en échec et son opération rend sa réservation, d'un seul geste. */
function liberer(m: MediaDeRealisation, raison: string): MediaDeRealisation {
  return getDb().transaction(() => {
    const op = operationDuMedia(m.id);
    if (op?.etat === 'reservee') marquerLOperation(op.id, 'liberee');
    return maj(mediaParId(m.id) ?? m, { etat: 'echec', echec: raison });
  })();
}

function lancer(m: MediaDeRealisation, attente: (ms: number) => Promise<void>): void {
  /* LE BLOC D'ATTENTE DU FIL (`medias-en-fabrication.ts`) : il paraît au départ,
     montre l'aperçu à la fin. Le démon le suit lui-même : la fabrication peut
     durer au-delà du tour de l'agent. */
  annoncerUnMedia({
    id: m.id,
    projectId: m.projectId,
    cardId: m.cardId,
    agentId: m.agentId,
    sujet: m.plan,
    outil: `${m.modeleNom} · ${serviceDeGeneration(m.service as IdServiceGeneration)?.nom ?? m.service}`,
    prix: m.prix,
    format: m.demande.format,
    genre: m.genre,
    suivi: 'service',
  });
  const travail = (async () => {
    try {
      const { data, type, coutReel } = await fabriquer(m, attente);
      const fini = await ranger(m, data, type, coutReel);
      /* LE DÉBIT : le montant réel quand le service le rend, l'annoncé sinon. */
      const op = operationDuMedia(m.id);
      if (op?.etat === 'reservee') marquerLOperation(op.id, 'debitee', coutReel ?? m.prix);
      terminerUnMedia(m.id, { attachmentId: fini.attachmentId, ...(coutReel !== undefined ? { prix: coutReel } : {}) });
      log.info(`réalisation : « ${m.plan} » fabriqué (${m.modeleNom})`);
    } catch (err) {
      const raison = String((err as Error)?.message ?? err).slice(0, 400);
      terminerUnMedia(m.id, { echec: raison });
      liberer(m, raison);
      log.warn(`réalisation : « ${m.plan} » en échec : ${raison}`);
    } finally {
      enVol.delete(m.id);
    }
  })();
  enVol.set(m.id, travail);
}

/* ------------------------------------------------------------------ */
/* L'outil « realiser »                                                */
/* ------------------------------------------------------------------ */

export interface ContexteRealisation {
  agentId: string;
  projectId: string;
  cardId?: string;
}

export interface ResultatRealisation {
  ok: boolean;
  text: string;
  question?: AgentQuestion;
  attachment?: Attachment;
}

const REFUS_MODE_ETEINT = 'Le mode Réalisation n’est pas allumé sur cette carte : l’outil « realiser » ne sert que là où l’utilisateur a allumé la caméra.';

const FORMATS: readonly FormatDeMedia[] = ['16:9', '9:16', '1:1', '4:5'];

function reponseALaQuestion(agentId: string | null, questionId: string): string | undefined {
  if (!agentId) return undefined;
  for (const message of store.listMessages(agentId)) {
    for (const q of message.questions ?? []) if (q.id === questionId) return q.answer;
  }
  return undefined;
}

function questionPosee(
  forme: { question: string; description: string; options: { label: string; description: string }[] },
  enPlus: Pick<AgentQuestion, 'devis' | 'branchement' | 'lumiere'> = {},
): AgentQuestion {
  return AgentQuestion.parse({
    id: store.newId(),
    question: forme.question,
    description: forme.description,
    kind: 'single',
    options: forme.options.map((o, i) => ({ id: `o${i}`, ...o })),
    allowFreeText: true,
    ...enPlus,
  });
}

/** Ce que les services branchés savent fabriquer, d'après le catalogue. */
export function capacitesCouvertes(): CapaciteDeGeneration[] {
  return [...new Set(modelesProposes(servicesDeGenerationBranches()).map((m) => m.capacite))];
}

/**
 * CE QUE LE DIRECTEUR SAIT FABRIQUER : les capacités des services branchés,
 * la composition sur le serveur (sans frais) dès que le moteur est installé, et
 * la voix finale par OpenRouter dès qu'une clé existe (branchée ou relais).
 */
export function capacitesDuDirecteur(): string[] {
  const capacites: string[] = capacitesCouvertes();
  if (!capacites.includes('voix') && voixParOpenRouterPossible()) capacites.push('voix');
  if (compositionDisponible()) capacites.push(CAPACITE_COMPOSITION);
  return capacites;
}

/** La voix finale par OpenRouter part avec la clé branchée ou, à défaut, celle du relais de Beluga Build. */
function voixParOpenRouterPossible(): boolean {
  return !estServiceCache('openrouter') && !!cleOpenRouter();
}

const LIBELLES_CAPACITES: Record<CapaciteDeGeneration, string> = {
  image: 'des images',
  video: 'des vidéos',
  voix: 'des voix',
  son: 'des bruitages',
  musique: 'de la musique',
  avatar: 'des présentateurs',
  synchro: 'des synchronisations labiales',
  animation: 'des plans animés à partir d’une image',
  mouvement: 'des gestes repris d’une vidéo de référence',
  retouche: 'une image refaite d’après elle-même',
  angles: 'd’autres angles d’une image',
  lumiere: 'une autre lumière sur une image',
  visage: 'un visage remplacé',
};
function libelleDeCapacite(c: CapaciteDeGeneration): string {
  return LIBELLES_CAPACITES[c] ?? c;
}

/**
 * UNE PANNE SE RÉPARE SEULE DANS LA MARGE (décision du 25/10/2026) : le texte
 * rendu à l'agent dit quoi faire — réessayer le même modèle, puis passer à un
 * modèle équivalent de même capacité — tant que le nouvel essai tient dans ce
 * qui reste du prix accordé, marge comprise (`issueDePanne`). Un mot à
 * l'utilisateur, jamais une question ; au-delà, l'accord est redemandé.
 */
function texteDePanne(card: Card, m: MediaDeRealisation): string {
  if (carteDeMedia(card)) {
    const raison = `Échec de « ${m.plan} » (${m.modeleNom}) : ${m.echec ?? 'sans raison'}.`;
    noterUnEvenement(card.id, 'panne', { media: m.id, plan: m.plan, raison: (m.echec ?? '').slice(0, 200) });
    const deja = dejaReessaye(card.id, m);
    if (!deja && !(m.coutReel !== null && m.coutReel > 0)) {
      return `${raison} RÉESSAI D’OFFICE, UNE SEULE FOIS : refais le « devis » à l’identique (même service, même modèle, même consigne, même plan) puis « lot » avec « reessai » = « ${m.id} » — il part sans nouveau clic. Écris UNE ligne à l’utilisateur (« La génération a raté chez le service, je la relance une fois au même prix. »).`;
    }
    return `${raison} Le réessai d’office a déjà servi (ou la génération a été facturée) : dis-le à l’utilisateur en une phrase et propose la suite par un nouveau « lot » à prix (un autre modèle, une consigne ajustée) — son clic décide.`;
  }
  const budget = budgetDeLaCarte(card);
  const reste = budget.budget === null ? null : budget.budget - depenseDeLaCarte(card.id);
  const echecsDuPlan = mediasDeLaCarte(card.id).filter((x) => x.plan === m.plan && x.etat === 'echec').length;
  const issue = issueDePanne({ echecsDuPlan, prix: m.prix, reste });
  noterUnEvenement(card.id, 'panne', { media: m.id, plan: m.plan, issue, raison: (m.echec ?? '').slice(0, 200) });
  const raison = `Échec de « ${m.plan} » (${m.modeleNom}) : ${m.echec ?? 'sans raison'}.`;
  if (issue === 'reessayer') {
    return `${raison} RÉPARE SEUL : refais un « devis » au même modèle (version suivante) puis « lot » — il part d’office dans la marge. Écris UNE ligne à l’utilisateur (« Le plan X a raté chez le service, je le relance. »), sans question.`;
  }
  if (issue === 'autre-modele') {
    return `${raison} RÉPARE SEUL : choisis un modèle ÉQUIVALENT de même capacité (« modeles », capacité « ${m.capacite} »), refais le « devis » et le « lot » — il part d’office s’il tient dans ce qui reste (${reste === null ? 'inconnu' : `${arrondi(Math.max(0, reste))} $`}). Une ligne à l’utilisateur pour dire le changement d’outil.`;
  }
  return `${raison} La réparation dépasse ce qui reste du prix accordé (${reste === null ? 'aucun budget' : `${arrondi(Math.max(0, reste))} $ restants`}) ou le plan a déjà raté ${echecsDuPlan} fois : ARRÊTE-TOI et demande à l’utilisateur avec « ask_user » (réessayer avec une rallonge, changer le plan, ou s’en passer).`;
}

/**
 * PROPOSE UN LOT DE DEVIS : la liste fermée des générations qu'un clic
 * autorisera. Refusé sans budget ou au-delà de ce qui reste ; sinon la
 * question part avec son bloc « Devis » et arrête l'agent jusqu'au clic.
 */
function proposerUnLot(
  card: Card,
  agentId: string,
  medias: readonly MediaDeRealisation[],
  e: { titre: string; etape: string | null },
): ResultatRealisation {
  const budget = budgetDeLaCarte(card);
  const depense = depenseDeLaCarte(card.id);
  const lignes = medias.map((m) => ({ mediaId: m.id, plan: m.plan, service: m.service, modeleNom: m.modeleNom, capacite: m.capacite, prix: m.prix }));
  const total = totalDuLot(lignes);
  /* UNE CRÉATION DE MÉDIA : ni budget ni décision d'office — le bouton « Générer · prix » est la seule porte. */
  if (carteDeMedia(card)) {
    const lot = creerUnLot({ cardId: card.id, projectId: card.projectId, titre: e.titre, etape: e.etape, lignes });
    const forme = questionDUneGeneration({
      lotId: lot.id,
      titre: lot.titre,
      lignes: medias.map((m) => ({ plan: m.plan, modele: m.modeleNom, service: serviceDeGeneration(m.service)?.nom ?? m.service, prix: m.prix })),
      depense,
    });
    const question = AgentQuestion.parse({
      id: store.newId(),
      question: forme.question,
      description: forme.description,
      kind: 'text',
      options: [],
      allowFreeText: true,
      devis: forme.devis,
    });
    poserLaQuestionDuLot(lot.id, question.id);
    void agentId;
    /* NON BLOQUANTE (27/10/2026) : la validation reste dans le fil, l'agent continue — une par plan, dans le même tour. */
    return {
      ok: true,
      text: `Validation « ${lot.titre} » posée dans le fil (bouton « Valider · prix »). Elle NE T’ARRÊTE PAS : pose dans ce même tour la validation de chaque autre plan ou élément prévu pour ce temps, puis termine ton tour en UNE phrase. Le clic de l’utilisateur lance la génération sans toi et le démon la suit : n’appelle ni « generer » ni « suivre » pour ce lot.`,
      question,
    };
  }
  const accordDeFabrication = card.parcours?.realisationBudget?.prixAccorde !== undefined;
  const decision = decisionDuLot({ total: total.connu, sansPrix: total.sansPrix, budget: budget.budget, depense, accordDeFabrication });
  if (decision.verdict === 'refus') return { ok: false, text: `Devis impossible en l’état : ${decision.raison}` };
  const lot = creerUnLot({ cardId: card.id, projectId: card.projectId, titre: e.titre, etape: e.etape, lignes });
  /* DANS LE PRIX ACCORDÉ À L'ARRÊT 2, MARGE COMPRISE : le lot part d'office, sans question (25/10/2026). */
  if (decision.verdict === 'auto') {
    deciderDuLot(lot.id, true, `Validé d’office : dans le prix accordé (${arrondi(budget.budget ?? 0)} $ marge comprise)`);
    noterUnEvenement(card.id, 'lot.auto', { lot: lot.id, total: total.connu, reste: (budget.budget ?? 0) - depense });
    return {
      ok: true,
      text: `Lot « ${lot.titre} » (« ${lot.id} ») validé d’office : ${arrondi(total.connu)} $, dans le prix accordé à l’arrêt 2 (il reste ${arrondi(Math.max(0, (budget.budget ?? 0) - depense - total.connu))} $ marge comprise). Lance-le avec « generer » (« lot » = « ${lot.id} »), sans rien demander.`,
    };
  }
  const forme = questionDuLotDeDevis({
    lotId: lot.id,
    titre: lot.titre,
    lignes: medias.map((m) => ({ plan: m.plan, modele: m.modeleNom, service: serviceDeGeneration(m.service)?.nom ?? m.service, prix: m.prix })),
    budget: budget.budget,
    depense,
  });
  const question = questionPosee(forme, { devis: forme.devis });
  poserLaQuestionDuLot(lot.id, question.id);
  void agentId;
  return { ok: true, text: texteSansAttente(), question };
}

/**
 * LANCE UN DEVIS — la seule porte vers un appel payant. Le devis doit être
 * une opération PRÉVUE d'un lot VALIDÉ (`porteDeGeneration`) ; hors lot, un
 * lot d'un seul devis est proposé. Sous le verrou de la carte, la réservation
 * (budget relu, média « en cours », opération « réservée ») est une seule
 * transaction : deux appels simultanés ou une reprise ne partent qu'une fois.
 */
async function genererUnDevis(
  card: Card,
  ctx: ContexteRealisation,
  devis: MediaDeRealisation,
  attente: (ms: number) => Promise<void>,
): Promise<ResultatRealisation> {
  return avecLeVerrouDeLaCarte(card.id, async () => {
    const m = mediaParId(devis.id) ?? devis;
    if (m.etat === 'en-cours') return { ok: true, text: `Ce devis est déjà lancé : « suivre » avec l’identifiant « ${m.id} ».` };
    if (m.etat === 'fini') return { ok: false, text: 'Ce devis a déjà été fabriqué : pour refaire le plan, fais un nouveau devis (version suivante).' };
    if (m.etat === 'refuse') return { ok: false, text: 'L’utilisateur a refusé ce devis : propose autre chose (un autre modèle, moins cher).' };
    if (m.etat === 'echec') return { ok: false, text: texteDePanne(card, m) };
    let lot: LotDeDevis | null = m.lotId ? lotParId(m.lotId) : null;
    if (lot?.etat === 'propose') {
      const reponse = lot.questionId ? (reponseALaQuestion(ctx.agentId, lot.questionId) ?? reponseALaQuestion(m.agentId, lot.questionId)) : undefined;
      if (reponse === undefined) return { ok: true, text: `Le devis « ${lot.titre} » attend la réponse de l’utilisateur : rien ne part avant son clic.` };
      lot = deciderDuLot(lot.id, lotValideParLaReponse(reponse), reponse);
    }
    const porte = porteDeGeneration(lot, m.id);
    if (porte === 'hors-lot') return proposerUnLot(card, ctx.agentId, [m], { titre: m.plan, etape: m.etape });
    if (porte === 'refuse') return { ok: false, text: `L’utilisateur a refusé le devis « ${lot!.titre} » : rien n’est lancé. Propose autre chose (un autre modèle, moins cher).` };
    if (porte === 'attente') return { ok: true, text: `Le devis « ${lot!.titre} » attend la réponse de l’utilisateur.` };
    if (porte === 'deja') return { ok: true, text: `Ce devis est déjà lancé : « suivre » avec l’identifiant « ${m.id} ».` };
    if (porte === 'liberee') return { ok: false, text: 'Cette génération a échoué : fais un nouveau devis pour refaire le plan.' };
    if (!fs.existsSync(PATHS.medias)) {
      try {
        fs.mkdirSync(PATHS.medias, { recursive: true });
      } catch {
        return { ok: false, text: `Le dossier des médias (${PATHS.medias}) est inaccessible : le disque de stockage est peut-être démonté. Rien n’est lancé.` };
      }
    }
    const op = lot!.operations.find((o) => o.mediaId === m.id)!;
    const budget = budgetDeLaCarte(card);
    const reservation = getDb().transaction((): { lance: MediaDeRealisation } | { refus: string } | { deja: true } => {
      const frais = mediaParId(m.id)!;
      if (frais.etat !== 'devis') return { deja: true };
      const verdict = reservationPossible({ montant: frais.prix ?? 0, budget: budget.budget, depense: depenseDeLaCarte(card.id) });
      if (!verdict.ok) return { refus: verdict.raison };
      const lance = maj(frais, { etat: 'en-cours' });
      marquerLOperation(op.id, 'reservee', frais.prix ?? 0);
      return { lance };
    })();
    if ('deja' in reservation) return { ok: true, text: `Ce devis est déjà lancé : « suivre » avec l’identifiant « ${m.id} ».` };
    if ('refus' in reservation) return { ok: false, text: `Refusé : ${reservation.refus}.` };
    lancer(reservation.lance, attente);
    return { ok: true, text: `Génération « ${m.id} » lancée (${m.modeleNom}). Attends le résultat avec « suivre » (une vidéo prend plusieurs minutes).` };
  });
}

/** Ce média a-t-il déjà eu son réessai d'office, ou en est-il un lui-même ? */
function dejaReessaye(cardId: string, m: MediaDeRealisation): boolean {
  const reessais = evenementsDeLaCarte(cardId, 500).filter((e) => e.genre === 'lot.reessai');
  return reessais.some((e) => e.details.rate === m.id || (!!m.lotId && e.details.lot === m.lotId));
}

/**
 * LE RÉESSAI D'OFFICE (26/10/2026) : une génération en panne, non facturée,
 * repart UNE fois au même modèle et au même prix, sans nouveau clic
 * (`reessaiDOfficePermis`). Sinon, le lot repasse par le bouton à prix.
 */
async function reessayerDOffice(
  card: Card,
  ctx: ContexteRealisation,
  medias: readonly MediaDeRealisation[],
  rateId: string,
  titre: string,
  etape: string | null,
  attente: (ms: number) => Promise<void>,
): Promise<ResultatRealisation> {
  const rate = mediaParId(rateId);
  if (!rate || rate.cardId !== card.id) return { ok: false, text: `« reessai » : le média « ${rateId} » est introuvable sur cette carte.` };
  const verdict = reessaiDOfficePermis({
    rate: { etat: rate.etat, coutReel: rate.coutReel, modele: rate.modele, prix: rate.prix, plan: rate.plan },
    devis: medias.map((m) => ({ modele: m.modele, prix: m.prix, plan: m.plan })),
    dejaReessaye: dejaReessaye(card.id, rate),
  });
  if (!verdict.ok) {
    const propose = proposerUnLot(card, ctx.agentId, medias, { titre, etape });
    return { ...propose, text: `Pas de réessai d’office : ${verdict.raison}. ${propose.text}` };
  }
  const lignes = medias.map((m) => ({ mediaId: m.id, plan: m.plan, service: m.service, modeleNom: m.modeleNom, capacite: m.capacite, prix: m.prix }));
  const lot = creerUnLot({ cardId: card.id, projectId: card.projectId, titre, etape, lignes });
  deciderDuLot(lot.id, true, `Réessai d’office de « ${rate.plan} » (panne non facturée, même modèle, même prix)`);
  noterUnEvenement(card.id, 'lot.reessai', { lot: lot.id, rate: rate.id });
  const textes: string[] = [];
  for (const m of medias) {
    const r = await genererUnDevis(card, ctx, mediaParId(m.id) ?? m, attente);
    textes.push(`- ${m.plan} : ${r.text}`);
  }
  return { ok: true, text: [`Réessai d’office lancé (une seule fois, même modèle, même prix) :`, ...textes].join('\n') };
}

/**
 * LE CLIC SUR « GÉNÉRER · PRIX » (26/10/2026) : la réponse à la question d'un
 * lot le TRANCHE dès le clic, et sur une création de média elle LANCE aussitôt
 * ses générations — sans attendre que l'agent pense à « generer ». Rend la
 * consigne que l'agent lit avec la réponse, ou `null` hors d'un devis.
 */
export async function trancherLeLotDuClic(question: Pick<AgentQuestion, 'devis'>, reponse: string): Promise<string | null> {
  const lotId = question.devis?.lotId;
  if (!lotId) return null;
  const lot = lotParId(lotId);
  if (!lot || lot.etat !== 'propose') return null;
  const card = store.getCard(lot.cardId);
  if (!card || !carteDeMedia(card)) return null;
  const valide = lotValideParLaReponse(reponse);
  deciderDuLot(lot.id, valide, reponse);
  if (!valide) {
    return `L’UTILISATEUR N’A PAS CLIQUÉ « Générer » pour « ${lot.titre} » : rien n’est dépensé. Sa réponse dit ce qu’il veut changer — ajuste (consigne, modèle, nombre de variantes), puis propose un nouveau lot.`;
  }
  const lances: string[] = [];
  for (const op of lot.operations) {
    const m = mediaParId(op.mediaId);
    if (!m) continue;
    const r = await genererUnDevis(card, { agentId: m.agentId ?? card.agentId ?? '', projectId: card.projectId, cardId: card.id }, m, (ms) => new Promise((fin) => setTimeout(fin, ms)));
    lances.push(`« ${m.id} » (${r.ok ? 'lancé' : r.text})`);
  }
  noterUnEvenement(card.id, 'lot.clic', { lot: lot.id, total: totalDuLot(lot.operations).connu });
  return `L’UTILISATEUR A CLIQUÉ « Générer » : le lot « ${lot.titre} » est ACCEPTÉ ET DÉJÀ LANCÉ — ne rappelle pas « generer ». Suis chaque génération avec « suivre » : ${lances.join(', ')}. Les brouillons paraissent dans le fil ; l’utilisateur valide lui-même ceux qu’il garde.`;
}

/**
 * L'ÉTAT D'UNE PRODUCTION, tel que l'écran le lit (`production.lire`) : les
 * éléments, les lots, les médias et le budget. Le volet de suivi s'en calcule
 * (`etapesDuSuivi`), sans relire la conversation.
 */
export function etatDeProductionDeLaCarte(cardId: string): EtatDeProduction {
  const card = store.getCard(cardId);
  const medias: MediaDuSuivi[] = mediasDeLaCarte(cardId).map(versMediaDuSuivi);
  return {
    cardId,
    elements: elementsDeLaCarte(cardId),
    lots: lotsDeLaCarte(cardId),
    medias,
    budget: card ? budgetDeLaCarte(card).budget : null,
    depense: depenseDeLaCarte(cardId),
  };
}

/** Les réglages d'une retouche ou d'une animation, en clair, pour le panneau « Réglages » du média. */
function reglagesEnClair(m: MediaDeRealisation): { cle: string; valeur: string }[] {
  const d = m.demande;
  const lignes: { cle: string; valeur: string }[] = [];
  const source = m.sourceId ? mediaParId(m.sourceId) : null;
  if (source) lignes.push({ cle: m.capacite === 'animation' ? 'Image de départ' : 'Image d’origine', valeur: `${source.plan} v${source.version}` });
  if (d.angle) lignes.push({ cle: 'Angle', valeur: `${d.angle.nom ? `${PARAMETRES_DES_ANGLES[d.angle.nom as keyof typeof PARAMETRES_DES_ANGLES]?.libelle ?? d.angle.nom} — ` : ''}rotation ${d.angle.horizontal}°, hauteur ${d.angle.vertical}°, cadrage ${d.angle.zoom}/10` });
  if (d.lumiere) lignes.push({ cle: 'Lumière', valeur: `${libelleDeDirection(d.lumiere)}${d.lumiere.valeur ? ` (« ${d.lumiere.valeur} »)` : ''}` });
  if (d.typeDeLumiere) lignes.push({ cle: 'Type de lumière', valeur: d.typeDeLumiere });
  if (d.cible) lignes.push({ cle: 'Visage remplacé', valeur: d.cible });
  if (m.capacite === 'visage' && d.sources && d.sources.length > 1) lignes.push({ cle: 'Photos du visage', valeur: String(d.sources.length - 1) });
  if (d.fin) {
    const fin = mediaParId(d.fin);
    lignes.push({ cle: 'Image de fin', valeur: fin ? `${fin.plan} v${fin.version}` : store.getAttachment(d.fin)?.name ?? d.fin });
  }
  if (d.mouvement) {
    const video = mediaParId(d.mouvement);
    lignes.push({ cle: 'Vidéo de mouvement', valeur: video ? `${video.plan} v${video.version}` : store.getAttachment(d.mouvement)?.name ?? d.mouvement });
    lignes.push({ cle: 'Orientation', valeur: d.orientation === 'image' ? 'd’après l’image' : 'd’après la vidéo' });
  }
  if (d.voix) lignes.push({ cle: 'Voix', valeur: d.voix });
  if (d.langue) lignes.push({ cle: 'Langue', valeur: d.langue });
  if (d.entrees?.length) lignes.push({ cle: 'Modèle lu en direct', valeur: 'commandé d’après son schéma publié' });
  for (const [k, v] of Object.entries(d.parametres ?? {})) lignes.push({ cle: k, valeur: typeof v === 'string' ? v : JSON.stringify(v) });
  return lignes;
}

/**
 * AJOUTER UN MÉDIA AU SUIVI, OU L'EN RETIRER (menu « … » d'un média, 24/10/2026).
 * Seul un média FINI de la carte s'ajoute ; retirer ne touche jamais au
 * fichier, qui reste dans le fil. Idempotent : un double clic ne change rien.
 */
export function retenirUnMedia(cardId: string, mediaId: string, retenu: boolean): { ok: true; media: MediaDeRealisation; change: boolean } | { ok: false; raison: string } {
  const m = mediaParId(mediaId);
  if (!m || m.cardId !== cardId) return { ok: false, raison: 'média introuvable sur cette carte' };
  if (retenu && m.etat !== 'fini') return { ok: false, raison: 'seul un média fini s’ajoute au suivi' };
  if (!!m.retenuLe === retenu) return { ok: true, media: m, change: false };
  /* Retirer la validation vide aussi la case où il avait été placé. */
  const apres = maj(m, retenu ? { retenuLe: Date.now() } : { retenuLe: null, planPlace: null });
  noterUnEvenement(cardId, retenu ? 'media.retenu' : 'media.retire', { media: mediaId, plan: m.plan, version: m.version });
  return { ok: true, media: apres, change: true };
}

/**
 * PLACER UN MÉDIA DANS UN PLAN (28/10/2026) : « Valider » puis le choix du
 * plan, ou le glisser vers une case du suivi. La règle (`placementDansUnPlan`)
 * dit quoi écrire ; tout s'écrit d'un seul tenant. N'appelle AUCUN agent : un
 * placement ne coûte rien et ne réveille personne.
 */
export function placerUnMedia(cardId: string, mediaId: string, planCle: string): { ok: true; media: MediaDeRealisation; echange: string | null } | { ok: false; raison: string } {
  const medias = mediasDeLaCarte(cardId);
  const r = placementDansUnPlan(decoupageDuMedia(elementsDeLaCarte(cardId)), medias, { mediaId, planCle, maintenant: Date.now() });
  if (!r.ok) return r;
  const parId = new Map(medias.map((m) => [m.id, m]));
  let place: MediaDeRealisation | null = null;
  getDb().transaction(() => {
    for (const c of r.changements) {
      const m = parId.get(c.id);
      if (!m) continue;
      const apres = maj(m, { retenuLe: c.retenuLe, planPlace: c.planPlace });
      if (c.id === mediaId) place = apres;
    }
  })();
  noterUnEvenement(cardId, 'media.place', { media: mediaId, plan: planCle, ...(r.echange ? { echange: r.echange } : {}) });
  return { ok: true, media: place ?? parId.get(mediaId)!, echange: r.echange };
}

/**
 * UN MÉDIA DU FIL QUE LA PRODUCTION NE CONNAÎT PAS ENCORE (27/10/2026, capture
 * #ee9e : « les médias doivent être modifiables en tout temps »). Une image
 * rendue par un autre outil (générateur de Codex, pièce jointe de l'agent), une
 * pièce envoyée par l'utilisateur ou une capture regardée n'avaient aucune
 * ligne ici : leur menu « … » restait absent. Au PREMIER geste qui en a besoin
 * (valider, réglages, retouche), la pièce est inscrite comme un média FINI de
 * la carte, à prix nul, sans lot ni étape — la dépense n'en bouge pas.
 *
 * IDEMPOTENT par (carte, pièce) : un double clic, ou deux menus ouverts sur la
 * même pièce, rendent la MÊME ligne (la mesure du fichier est asynchrone : la
 * seconde demande attend la première au lieu d'en écrire une autre).
 */
const inscriptionsEnVol = new Map<string, Promise<{ ok: true; media: MediaDeRealisation; deja: boolean } | { ok: false; raison: string }>>();

function mediaDeLaPiece(cardId: string, attachmentId: string): MediaDeRealisation | null {
  const r = getDb().prepare(`SELECT * FROM medias_realisation WHERE card_id = ? AND attachment_id = ? ORDER BY cree_le LIMIT 1`).get(cardId, attachmentId);
  return r ? lireLigne(r) : null;
}

export function inscrireUnMediaDuFil(cardId: string, attachmentId: string): Promise<{ ok: true; media: MediaDeRealisation; deja: boolean } | { ok: false; raison: string }> {
  const deja = mediaDeLaPiece(cardId, attachmentId);
  if (deja) return Promise.resolve({ ok: true, media: deja, deja: true });
  const cle = `${cardId}:${attachmentId}`;
  const enVol = inscriptionsEnVol.get(cle);
  if (enVol) return enVol;
  const promesse = (async () => {
    const card = store.getCard(cardId);
    if (!card) return { ok: false as const, raison: 'carte introuvable' };
    const piece = store.getAttachment(attachmentId);
    if (!piece || piece.projectId !== card.projectId) return { ok: false as const, raison: 'pièce introuvable dans ce projet' };
    const genre = genreDePieceDuFil(piece.mime);
    if (!genre) return { ok: false as const, raison: 'seule une image, une vidéo ou un son se retravaille' };
    const fichier = cheminDePieceJointe(piece);
    const mesure = fs.existsSync(fichier) ? await mesurerLeFichier(fichier) : null;
    const encore = mediaDeLaPiece(cardId, attachmentId);
    if (encore) return { ok: true as const, media: encore, deja: true };
    const livre = getDb().prepare(`SELECT sujet, outil FROM medias_livres WHERE attachment_id = ?`).get(attachmentId) as { sujet: string; outil: string } | undefined;
    const plan = planDePieceDuFil(livre?.sujet || piece.name);
    const maintenant = Date.now();
    const m: MediaDeRealisation = {
      id: store.newId(),
      projectId: card.projectId,
      cardId,
      agentId: card.agentId ?? null,
      branche: null,
      plan,
      version: versionSuivante(cardId, plan),
      capacite: genre,
      genre,
      service: 'fil',
      modele: 'fil',
      modeleNom: livre?.outil || 'Pièce du fil',
      demande: { consigne: '', format: formatLePlusProche(mesure?.largeur, mesure?.hauteur, genre === 'video' ? '16:9' : '1:1') },
      raison: 'Inscrit depuis le menu « … » du fil',
      prix: 0,
      sourcePrix: 'aucun',
      coutReel: 0,
      etat: 'fini',
      questionId: null,
      echec: null,
      fichier,
      taille: piece.size ?? null,
      attachmentId,
      etape: null,
      lotId: null,
      retenuLe: null,
      sourceId: null,
      mesure,
      creeLe: piece.createdAt || maintenant,
      modifieLe: maintenant,
    };
    enregistrer(m);
    noterUnEvenement(cardId, 'media.inscrit', { media: m.id, piece: attachmentId, plan });
    return { ok: true as const, media: m, deja: false };
  })().finally(() => inscriptionsEnVol.delete(cle));
  inscriptionsEnVol.set(cle, promesse);
  return promesse;
}

/** Un média de la production, tel que l'écran le lit (volet de suivi, menu « … »). */
export function versMediaDuSuivi(m: MediaDeRealisation): MediaDuSuivi {
  return {
    id: m.id,
    plan: m.plan,
    version: m.version,
    capacite: m.capacite,
    genre: m.genre,
    service: m.service,
    etape: m.etape,
    etat: m.etat,
    attachmentId: m.attachmentId,
    prix: m.coutReel ?? m.prix,
    creeLe: m.creeLe,
    consigne: m.demande.consigne,
    consigneOriginale: m.demande.consigneOriginale ?? null,
    modeleNom: m.modeleNom,
    raison: m.raison,
    echec: m.echec,
    retenuLe: m.retenuLe ?? null,
    planPlace: m.planPlace ?? null,
    mesure: m.mesure ?? null,
    taille: m.taille,
    format: m.demande.format,
    ...(m.demande.duree ? { duree: m.demande.duree } : {}),
    modele: m.modele,
    sourceId: m.sourceId ?? null,
    reglages: reglagesEnClair(m),
    prixAnnonce: m.prix,
    coutReel: m.coutReel,
    agentId: m.agentId,
  };
}

function ligneDeMedia(m: MediaDeRealisation): string {
  const prix = m.coutReel ?? m.prix;
  return `- « ${m.id} » ${m.plan} v${m.version} [${m.genre}] — ${m.modeleNom} (${m.service}) — ${prix === null ? 'prix non publié' : `${arrondi(prix)} $`}${m.retenuLe ? ' — DANS LE SUIVI' : ''}${m.fichier ? ` — ${m.fichier}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* La fabrication sur le serveur (compositions écrites par l'agent)     */
/* ------------------------------------------------------------------ */

/** Le format d'une composition : celui demandé, sinon le premier du brief, sinon le vertical. */
function formatDeComposition(brut: unknown): FormatDeMedia {
  return FORMATS.find((f) => f === brut) ?? '9:16';
}

/** Un nom de fichier sûr pour les copies dans `medias/`. */
function nomDeCopie(nom: string): string {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').slice(0, 80) || 'media';
}

/**
 * LES MÉDIAS DE LA CARTE COPIÉS DANS LA COMPOSITION (`medias/`) : plans finis,
 * voix, musique, images jointes par l'utilisateur. Rend ce que la page doit
 * citer (chemin relatif), avec la durée mesurée d'un son ou d'une vidéo.
 */
async function copierLesMedias(card: Card, dossier: string, brut: unknown): Promise<{ lignes: string[]; refus: string[] }> {
  const ids = (Array.isArray(brut) ? brut : String(brut ?? '').split(',')).map((x) => idDeSource(card, x)).filter(Boolean);
  const lignes: string[] = [];
  const refus: string[] = [];
  for (const id of [...new Set(ids)].slice(0, 40)) {
    const source = fichierDUneSource(id);
    const media = mediaParId(id);
    const piece = media ? null : store.getAttachment(id);
    if (!source || (media && media.projectId !== card.projectId) || (piece && piece.projectId !== card.projectId)) {
      refus.push(`« ${id} » introuvable dans ce projet`);
      continue;
    }
    const ext = path.extname(source.fichier) || (source.type.includes('png') ? '.png' : source.type.includes('jpeg') ? '.jpg' : source.type.includes('mp4') ? '.mp4' : source.type.includes('wav') ? '.wav' : source.type.includes('mpeg') ? '.mp3' : '');
    const base = media ? `${media.plan}-v${media.version}` : path.basename(piece?.name ?? id, path.extname(piece?.name ?? ''));
    const nom = `${nomDeCopie(base)}${ext}`;
    fs.copyFileSync(source.fichier, path.join(dossier, 'medias', nom));
    const mesure = /^(video|audio)\//.test(source.type) || /\.(mp4|webm|mov|wav|mp3|m4a|ogg)$/i.test(ext) ? await mesurerLeFichier(path.join(dossier, 'medias', nom)) : null;
    lignes.push(`- medias/${nom} (« ${id} »${mesure?.duree ? `, ${mesure.duree.toFixed(2)} s` : ''}${mesure?.largeur ? `, ${mesure.largeur}×${mesure.hauteur}` : ''})`);
  }
  return { lignes, refus };
}

/** Le rendu d'une composition, suivi comme toute fabrication : bloc d'attente dans le fil, « suivre », rangement à 0 $. */
function lancerUneComposition(m: MediaDeRealisation, dossier: string, sortie: 'video' | 'image', instant: number | undefined, livrer: boolean): void {
  annoncerUnMedia({
    id: m.id,
    projectId: m.projectId,
    cardId: m.cardId,
    agentId: m.agentId,
    sujet: m.plan,
    outil: 'Fabrication sur le serveur',
    prix: 0,
    format: m.demande.format,
    genre: m.genre,
    suivi: 'service',
  });
  const travail = (async () => {
    try {
      const rendu = await rendreComposition(dossier, { genre: sortie, format: m.demande.format, ...(instant !== undefined ? { instant } : {}) });
      const fichier = livrer && sortie === 'video' ? await livrerLeFilm(rendu.fichier) : rendu.fichier;
      const fini = await ranger(m, fs.readFileSync(fichier), sortie === 'video' ? 'video/mp4' : 'image/png');
      terminerUnMedia(m.id, { attachmentId: fini.attachmentId, prix: 0 });
      log.info(`réalisation : composition « ${m.plan} » (${m.demande.format}) rendue en ${rendu.secondes} s`);
    } catch (err) {
      const raison = String((err as Error)?.message ?? err).slice(0, 400);
      terminerUnMedia(m.id, { echec: raison });
      maj(mediaParId(m.id) ?? m, { etat: 'echec', echec: raison });
      log.warn(`réalisation : composition « ${m.plan} » en échec : ${raison}`);
    } finally {
      enVol.delete(m.id);
    }
  })();
  enVol.set(m.id, travail);
}

const REGLES_DE_COMPOSITION = [
  'RÈGLES DU MOTEUR (HyperFrames) : la racine porte data-composition-id, data-start="0", data-duration (secondes), data-width, data-height ; chaque élément minuté a class="clip", data-start, data-duration (et data-track-index) ;',
  'UNE chronologie GSAP en pause, posée APRÈS ses tweens : window.__timelines["<id>"] = tl ; tweens à des secondes absolues (tl.to(el, {…}, 2.4)), états de départ dans le tween (fromTo) ;',
  'tout ce qui se voit est une fonction du temps : ni Date.now, ni Math.random sans graine (mulberry32), ni requestAnimationFrame, ni minuteur, ni repeat: -1, ni réseau ; un canevas (Three.js, p5, Pixi, OGL) se dessine dans l’onUpdate de la chronologie à partir de tl.time() ;',
  'jamais de tween sur display/visibility d’un .clip (animer un enfant) ; pas de transform CSS sur un élément que GSAP déplace ;',
  'une <video> se marque muted (ou data-has-audio="true") ; chaque <audio class="clip"> a un id ; les fichiers sont relatifs (medias/…, lib/…, polices/…) ;',
  'des tailles relatives à la racine (%, ou lues sur #root) pour qu’une même page serve plusieurs formats ; textes dans les 80 % du centre.',
].join(' ');

async function composerSurLeServeur(card: Card, ctx: ContexteRealisation, args: Record<string, unknown>): Promise<ResultatRealisation> {
  if (!compositionDisponible()) return { ok: false, text: 'Le moteur de fabrication sur le serveur (HyperFrames) n’est pas installé ici : dis-le à l’utilisateur, ou passe par un service de génération.' };
  const etape = String(args.geste ?? 'preparer');
  const plan = String(args.plan ?? '').trim().slice(0, 80);
  const dossierExplicite = dossierDeComposition(args.dossier);
  if (!plan && !dossierExplicite) return { ok: false, text: 'Il faut « plan » : le nom du plan ou du film (« plan-1 », « montage »…).' };
  const dossierDesMedias = dossierDesMediasDeLaCarte(card, ctx.agentId);
  const format = formatDeComposition(args.format);
  const dossier = dossierExplicite ?? path.join(dossierDesMedias, 'compositions', idDeComposition(plan));
  const nomDuPlan = plan || path.basename(dossier);
  const html = typeof args.html === 'string' ? args.html.trim() : '';

  if (etape === 'preparer') {
    const prep = preparerComposition({ dossierDesMedias, plan: nomDuPlan, format, duree: Number(args.duree) || 10, ...(typeof args.titre === 'string' ? { titre: args.titre } : {}), bibliotheques: args.bibliotheques });
    if (html) fs.writeFileSync(path.join(prep.dossier, 'index.html'), html);
    const copies = await copierLesMedias(card, prep.dossier, args.medias);
    const libs = BIBLIOTHEQUES_DE_COMPOSITION.filter((b) => prep.bibliotheques.includes(b.id));
    return {
      ok: true,
      text: [
        `Composition « ${nomDuPlan} » ${prep.neuf ? 'préparée' : 'complétée'} : ${prep.dossier}`,
        `- index.html : ${html ? 'ta page' : prep.neuf ? 'une page de départ qui se rend déjà (réécris-la entièrement)' : 'gardé tel quel'} ; data-composition-id = « ${prep.id} »`,
        '- polices/ : Inter, Montserrat, Space Grotesk, Playfair Display, Bebas Neue, Caveat, JetBrains Mono (feuille polices/polices.css)',
        ...libs.map((b) => `- bibliothèque ${b.nom} ${b.version} (${b.licence}) : ${b.balise} — ${b.usage}`),
        ...(copies.lignes.length ? ['Médias copiés :', ...copies.lignes] : ['Aucun média copié (« medias » = identifiants de médias de la carte ou de pièces jointes).']),
        ...(copies.refus.length ? [`Refusés : ${copies.refus.join(' ; ')}`] : []),
        REGLES_DE_COMPOSITION,
        'Ensuite : écris la page (fichier index.html, ou « html » de cette action), puis « controler », « apercu » (« instants ») — regarde les images —, puis « rendre ».',
      ].join('\n'),
    };
  }

  if (!fs.existsSync(path.join(dossier, 'index.html'))) return { ok: false, text: `Aucune composition « ${nomDuPlan} » : appelle d’abord « composer » avec « geste » = « preparer ».` };
  if (html) fs.writeFileSync(path.join(dossier, 'index.html'), html);

  if (etape === 'controler') {
    const c = await controlerComposition(dossier);
    return {
      ok: !c.erreurs.length,
      text: [
        c.erreurs.length ? `La composition « ${nomDuPlan} » ne se rend pas encore :` : `Composition « ${nomDuPlan} » contrôlée sans erreur${c.duree ? ` (${c.duree} s)` : ''}.`,
        ...c.erreurs.map((x) => `- ${x}`),
        ...(c.avertissements.length ? ['Avertissements :', ...c.avertissements.slice(0, 8).map((x) => `- ${x}`)] : []),
      ].join('\n'),
    };
  }

  if (etape === 'apercu') {
    const instants = (Array.isArray(args.instants) ? args.instants : String(args.instants ?? '').split(',')).map(Number).filter((t) => Number.isFinite(t));
    const a = await apercusDeLaComposition(dossier, instants, format);
    if (!a.ok) return { ok: false, text: `Aucune image tirée : ${a.raison}. Lance « controler » pour lire les erreurs.` };
    return { ok: true, text: `Aperçu de « ${nomDuPlan} » en ${format} — REGARDE ces images (lis les fichiers) avant d’aller plus loin :\n${a.images.map((x) => `- ${x}`).join('\n')}${a.planche ? `\nPlanche : ${a.planche}` : ''}` };
  }

  if (etape === 'rendre') {
    const sortie = args.sortie === 'image' ? 'image' : 'video';
    const formats = [...new Set((Array.isArray(args.formats) ? args.formats : args.formats ? String(args.formats).split(',') : [format]).map((f) => formatDeComposition(String(f).trim())))];
    const c = await controlerComposition(dossier);
    if (c.erreurs.length) return { ok: false, text: [`Rendu refusé : la composition « ${nomDuPlan} » a des erreurs.`, ...c.erreurs.map((x) => `- ${x}`)].join('\n') };
    const montage = /^montage/i.test(nomDuPlan) || args.montage === true;
    if (montage) poserLeMontage(card);
    const capacite: CapaciteDeGeneration = sortie === 'image' ? 'image' : 'video';
    const instant = Number.isFinite(Number(args.instant)) ? Number(args.instant) : undefined;
    const ids: string[] = [];
    for (const f of formats) {
      const maintenant = Date.now();
      const m: MediaDeRealisation = {
        id: store.newId(),
        projectId: card.projectId,
        cardId: card.id,
        agentId: ctx.agentId,
        branche: brancheDeLaCarte(card, ctx.agentId),
        plan: formats.length > 1 ? `${nomDuPlan}-${f.replace(':', 'x')}` : nomDuPlan,
        version: 0,
        capacite,
        genre: genreDuMedia(capacite),
        service: montage ? 'montage' : 'serveur',
        modele: 'composition',
        modeleNom: montage ? 'Montage par le directeur' : 'Fabrication sur le serveur',
        demande: { consigne: `composition ${dossier}`, format: f, ...(c.duree && sortie === 'video' ? { duree: c.duree } : {}) },
        raison: 'écrit par l’agent, rendu sur le serveur, sans service payant',
        prix: 0,
        sourcePrix: 'aucun',
        coutReel: 0,
        etat: 'en-cours',
        questionId: null,
        echec: null,
        fichier: null,
        taille: null,
        attachmentId: null,
        etape: montage ? 'montage' : (ETAPES_DU_SUIVI.find((e) => e === args.etape) ?? null),
        lotId: null,
        retenuLe: null,
        sourceId: null,
        mesure: null,
        creeLe: maintenant,
        modifieLe: maintenant,
      };
      enregistrer(m);
      lancerUneComposition(m, dossier, sortie, instant, montage);
      ids.push(m.id);
    }
    return {
      ok: true,
      text: `${ids.length} rendu(s) de « ${nomDuPlan} » lancé(s) sur le serveur, sans frais (${formats.join(', ')}) : ${ids.map((x) => `« ${x} »`).join(', ')}. Un seul travail lourd à la fois : compte ≈ 3,5 s de rendu par seconde de vidéo en vertical. Attends chacun avec « suivre », puis REGARDE le résultat.${montage ? ' Le film monté passe en livraison (niveau sonore, lecture immédiate sur le web) avant d’arriver dans le fil.' : ''}`,
    };
  }
  return { ok: false, text: '« geste » : preparer, controler, apercu ou rendre.' };
}

/** LES MOTS D'UNE VOIX, avec leurs temps (sous-titres au mot), écrits en JSON à côté de la composition voulue. */
async function motsDUneVoix(card: Card, ctx: ContexteRealisation, args: Record<string, unknown>): Promise<ResultatRealisation> {
  const id = idDeSource(card, args.media ?? args.voix ?? args.id);
  const chemin = String(args.chemin ?? '').trim();
  const source = id ? fichierDUneSource(id)?.fichier : chemin && path.isAbsolute(chemin) && fs.existsSync(chemin) ? chemin : null;
  if (!source) return { ok: false, text: 'Il faut « media » (l’identifiant de la voix : média de la carte ou pièce jointe) ou « chemin » (un fichier son absolu).' };
  const texte = typeof args.texte === 'string' ? args.texte : undefined;
  const r = await motsDeLaVoix(source, texte);
  const plan = String(args.plan ?? '').trim();
  const cible = plan ? path.join(dossierDesMediasDeLaCarte(card, ctx.agentId), 'compositions', idDeComposition(plan), 'medias') : path.join(dossierDesMediasDeLaCarte(card, ctx.agentId), 'mots');
  fs.mkdirSync(cible, { recursive: true });
  const fichier = path.join(cible, `mots-${nomDeCopie(path.basename(source, path.extname(source)))}.json`);
  fs.writeFileSync(fichier, JSON.stringify({ duree: r.duree, mots: r.mots }, null, 1));
  const apercu = r.mots.slice(0, 12).map((m) => `${m.texte} ${m.debut.toFixed(2)}–${m.fin.toFixed(2)}`).join(' · ');
  return {
    ok: true,
    text: `${r.mots.length} mot(s) horodaté(s) sur ${r.duree.toFixed(2)} s${r.reconnus ? '' : ' (reconnaissance impossible : temps RÉPARTIS au prorata — dis-le)'} : ${fichier}${plan ? ' (copié dans la composition : recopie ces temps dans ta page, data-start / data-duration de chaque mot)' : ''}.\nDébut : ${apercu}${r.mots.length > 12 ? ' …' : ''}`,
  };
}

/** BRUITAGES ET MUSIQUE SANS FRAIS : un script Tone.js joué hors temps réel dans un vrai Chrome, rendu en WAV. */
async function sonsSynthetises(card: Card, ctx: ContexteRealisation, args: Record<string, unknown>): Promise<ResultatRealisation> {
  const script = String(args.script ?? '').trim();
  const duree = Number(args.duree);
  if (!script || !Number.isFinite(duree) || duree <= 0 || duree > 180) return { ok: false, text: 'Il faut « script » (le corps d’une fonction qui reçoit « Tone » et programme les sons, ex. « const s = new Tone.MembraneSynth().toDestination(); s.triggerAttackRelease(\'C2\', \'8n\', 0.5); ») et « duree » (en secondes, 180 au plus).' };
  const nom = nomDeCopie(String(args.nom ?? 'sons'));
  const plan = String(args.plan ?? '').trim();
  const cible = plan ? path.join(dossierDesMediasDeLaCarte(card, ctx.agentId), 'compositions', idDeComposition(plan), 'medias') : path.join(dossierDesMediasDeLaCarte(card, ctx.agentId), 'sons');
  fs.mkdirSync(cible, { recursive: true });
  const fichier = path.join(cible, `${nom}.wav`);
  const r = await fabriquerDesSons(script, duree, fichier);
  if (!r.ok) return { ok: false, text: `Sons impossibles : ${r.raison}` };
  return { ok: true, text: `Sons fabriqués sans frais (${r.duree.toFixed(2)} s) : ${fichier}${plan ? ` — dans la composition : <audio id="${nom}" class="clip" data-start="0" data-duration="${r.duree.toFixed(2)}" data-track-index="9" src="medias/${nom}.wav"></audio>` : ''}. Écoute-le avant de l’intégrer.` };
}

/**
 * LE MONTAGE COMMENCE : `realisation.montageA` se pose une fois, sur la carte
 * relue (une écriture concurrente du tour n'est pas écrasée), et l'étape
 * « Montage » du chemin du tournage s'allume (`cheminDeLaRealisation`).
 * Rend la carte écrite, ou `null` quand le montage était déjà posé.
 */
function poserLeMontage(card: Card): Card | null {
  const fraiche = store.getCard(card.id) ?? card;
  const avant = realisationDeLaCarte(fraiche);
  if (avant.montageA) return null;
  const ecrite = store.saveCard({ ...fraiche, realisation: { ...avant, montageA: Date.now() } });
  bus.emit({ type: 'card.upsert', card: ecrite });
  return ecrite;
}

/**
 * L'IMAGE DE DÉPART ET LE RÉGLAGE D'UNE ANIMATION OU D'UNE RETOUCHE, lus et
 * vérifiés au devis — jamais à la fabrication, quand l'argent est déjà accordé :
 *  - « source » : une IMAGE finie de la carte ; pour une ANIMATION, elle doit
 *    être AJOUTÉE AU SUIVI (l'utilisateur l'a retenue pour ce plan) ;
 *  - « angle » : un angle de la liste, ou { horizontal, vertical, zoom } ;
 *  - « lumiere » : { azimut, elevation } — refusée hors des directions qu'un
 *    modèle à directions fixes autorise (la sphère est bloquée à l'écran, le
 *    démon le vérifie aussi) ;
 *  - « photos » : les photos du visage à poser (médias ou pièces jointes du
 *    projet), autant que le modèle en accepte, et « cible » : qui remplacer.
 * Un modèle qui ne prend que des mots reçoit l'angle, la lumière ou le
 * visage DÉCRITS en anglais (`phrase`).
 */
/** Une image du projet désignée par l'utilisateur : un média image fini, ou une pièce jointe image. */
/**
 * UNE SOURCE DÉSIGNÉE PAR L'AGENT : un média de la carte (son identifiant), ou
 * une pièce jointe par son identifiant OU son alias (« #8dba »), rendue en
 * identifiant complet — c'est lui que lit la fabrication (`fichierDUneSource`).
 */
function idDeSource(card: Card, brut: unknown): string {
  const ref = String(brut ?? '').trim().replace(/^#/, '');
  if (!ref || mediaParId(ref)) return ref;
  return store.pieceJointeDesignee(ref, card.projectId)?.id ?? ref;
}

function imageDuProjet(card: Card, id: string): { ok: true; nom: string } | { ok: false; raison: string } {
  const media = id ? mediaParId(id) : null;
  if (media) {
    if (media.projectId !== card.projectId || media.etat !== 'fini' || media.genre !== 'image') return { ok: false, raison: `« ${id} » n’est pas une image finie de ce projet.` };
    return { ok: true, nom: `${media.plan} v${media.version}` };
  }
  const piece = id ? store.getAttachment(id) : null;
  if (!piece || piece.projectId !== card.projectId || !piece.mime.startsWith('image/') || !fichierDUneSource(id)) {
    return { ok: false, raison: 'l’identifiant d’une IMAGE finie de la carte (« lister ») ou d’une image jointe par l’utilisateur.' };
  }
  return { ok: true, nom: piece.name };
}

/** Une vidéo du projet désignée par l'utilisateur : un média vidéo fini, ou une pièce jointe vidéo. */
function videoDuProjet(card: Card, id: string): { ok: true; nom: string } | { ok: false; raison: string } {
  const media = id ? mediaParId(id) : null;
  if (media) {
    if (media.projectId !== card.projectId || media.etat !== 'fini' || media.genre !== 'video') return { ok: false, raison: `« ${id} » n’est pas une vidéo finie de ce projet.` };
    return { ok: true, nom: `${media.plan} v${media.version}` };
  }
  const piece = id ? store.getAttachment(id) : null;
  if (!piece || piece.projectId !== card.projectId || !piece.mime.startsWith('video/') || !fichierDUneSource(id)) {
    return { ok: false, raison: 'l’identifiant de la VIDÉO DE RÉFÉRENCE (3 à 30 s) : une vidéo finie du projet (« lister ») ou une vidéo jointe par l’utilisateur, demandée avec « ask_user ».' };
  }
  return { ok: true, nom: piece.name };
}

export async function lireLaRetouche(
  card: Card,
  modele: ModeleDeGeneration,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; demande: Partial<MediaDeRealisation['demande']>; phrase: string; sourceId: string | null; etape: string | null; note: string }
  | { ok: false; raison: string }
> {
  const neutre = { ok: true as const, demande: {}, phrase: '', sourceId: null, etape: null, note: '' };
  if (modele.capacite !== 'animation' && modele.capacite !== 'mouvement' && !estUneRetoucheDImage(modele.capacite)) return neutre;
  const enDirect = 'entrees' in modele;
  const source = mediaParId(String(args.source ?? ''));
  if (!source || source.cardId !== card.id || source.etat !== 'fini' || source.genre !== 'image') {
    return { ok: false, raison: 'Il faut « source » : l’identifiant d’une IMAGE finie de cette carte (l’action « lister » les donne, l’utilisateur la désigne par le menu « … » du média).' };
  }
  const sources = [source.id];
  const etape = source.etape;
  if (modele.capacite === 'animation') {
    if (!source.retenuLe) {
      return { ok: false, raison: `Refusé : un plan s’anime à partir de son image AJOUTÉE AU SUIVI. « ${source.plan} » v${source.version} n’y est pas — demande à l’utilisateur de l’ajouter (menu « … » de l’image, « Ajouter au suivi ») ou d’en garder une autre.` };
    }
    /* L'IMAGE DE FIN (24/10/2026) : le plan va de l'image de départ à celle-ci, choisie par l'utilisateur. */
    const idFin = idDeSource(card, args.fin);
    if (!idFin) return { ok: true, demande: { sources }, phrase: '', sourceId: source.id, etape: etape ?? 'plans', note: `Animation de « ${source.plan} » v${source.version}, l’image retenue, sans image de fin.` };
    if (!enDirect && !modele.fin) return { ok: false, raison: `${modele.nom} ne reçoit pas d’image de fin : choisis un modèle marqué « IMAGE DE FIN possible » (« modeles » capacite « animation »), ou fais le plan sans image de fin.` };
    const fin = imageDuProjet(card, idFin);
    if (!fin.ok) return { ok: false, raison: `Il faut « fin » : ${fin.raison}` };
    return {
      ok: true,
      demande: { sources, fin: idFin },
      phrase: '',
      sourceId: source.id,
      etape: etape ?? 'plans',
      note: `Animation de « ${source.plan} » v${source.version} (image de départ) jusqu’à « ${fin.nom} » (image de fin).`,
    };
  }
  if (modele.capacite === 'mouvement') {
    /* LE CONTRÔLE DU MOUVEMENT : le personnage de l'image reprend les gestes de la vidéo de référence. */
    const idVideo = idDeSource(card, args.mouvement ?? args.video);
    const video = videoDuProjet(card, idVideo);
    if (!video.ok) return { ok: false, raison: `Il faut « mouvement » : ${video.raison}` };
    const orientation = args.orientation === 'image' ? 'image' : 'video';
    return {
      ok: true,
      demande: { sources, mouvement: idVideo, orientation },
      phrase: '',
      sourceId: source.id,
      etape: etape ?? 'plans',
      note: `Mouvement de « ${video.nom} » repris par le personnage de « ${source.plan} » v${source.version} (orientation d’après ${orientation === 'image' ? 'l’image' : 'la vidéo'}) ; la durée suit la vidéo de référence.`,
    };
  }
  if (modele.capacite === 'retouche') {
    /* REFAIRE UNE IMAGE D'APRÈS ELLE-MÊME : l'image jointe part avec la nouvelle consigne, plus d'éventuelles références. */
    const refs = (Array.isArray(args.photos) ? args.photos : String(args.photos ?? '').split(',')).map((x) => idDeSource(card, x)).filter(Boolean);
    const plafond = Math.max(0, (modele.retouche?.sources ?? 1) - 1);
    if (refs.length > plafond) return { ok: false, raison: `${modele.nom} accepte ${plafond} image(s) de référence en plus de l’image refaite, au plus.` };
    for (const id of refs) {
      const r = imageDuProjet(card, id);
      if (!r.ok) return { ok: false, raison: `Référence « ${id} » : ${r.raison}` };
    }
    return { ok: true, demande: { sources: [...sources, ...refs] }, phrase: '', sourceId: source.id, etape, note: `« ${source.plan} » v${source.version} refaite d’après la nouvelle consigne${refs.length ? `, avec ${refs.length} référence(s)` : ''}.` };
  }
  if (modele.capacite === 'angles') {
    const angle = angleDeVue(args.angle, { verticalMin: modele.retouche?.verticalMin ?? -30, verticalMax: modele.retouche?.verticalMax ?? 90 });
    if (!angle) return { ok: false, raison: `Il faut « angle » : ${ANGLES_DE_VUE.join(', ')}, ou { horizontal (0 à 360), vertical, zoom (0 à 10) }.` };
    const nom = typeof args.angle === 'string' ? args.angle : undefined;
    return {
      ok: true,
      demande: { sources, angle: { ...angle, ...(nom ? { nom } : {}) } },
      phrase: modele.retouche?.parMots ? phraseDAngle(angle) : '',
      sourceId: source.id,
      etape,
      note: `${nom ? PARAMETRES_DES_ANGLES[nom as keyof typeof PARAMETRES_DES_ANGLES]?.libelle ?? nom : 'Angle'} de « ${source.plan} » : rotation ${angle.horizontal}°, hauteur ${angle.vertical}°, cadrage ${angle.zoom}/10${modele.retouche?.parMots ? ' — décrit au modèle en mots, moins précis' : ''}.`,
    };
  }
  if (modele.capacite === 'lumiere') {
    /* La direction donnée en nombres, ou la réponse de la sphère recopiée telle quelle (« Lumière : azimut …°, élévation …° »). */
    const brut = (typeof args.lumiere === 'string' ? lireReponseDeLumiere(args.lumiere) ?? {} : args.lumiere ?? {}) as { azimut?: unknown; elevation?: unknown };
    const d = directionBornee({ azimut: brut.azimut, elevation: brut.elevation });
    if (!d) return { ok: false, raison: 'Il faut « lumiere » : { azimut, elevation }, la direction choisie par l’utilisateur sur la sphère (action « lumiere »).' };
    const permises = modele.retouche?.lumiere ?? 'libre';
    if (!directionPermise(d, permises)) {
      return { ok: false, raison: `Refusé : ${modele.nom} n’accepte que ces directions — ${(permises as readonly { libelle: string; azimut: number; elevation: number }[]).map((p) => `${p.libelle} (azimut ${p.azimut}°, élévation ${p.elevation}°)`).join(', ')}. Repose la sphère avec ce modèle.` };
    }
    const fixe = permises === 'libre' ? undefined : permises.find((p) => p.azimut === d.azimut && p.elevation === d.elevation)?.valeur;
    const type = String(args.type_de_lumiere ?? '').trim();
    return {
      ok: true,
      demande: { sources, lumiere: { ...d, ...(fixe ? { valeur: fixe } : {}) }, ...(type ? { typeDeLumiere: type } : {}) },
      phrase: permises === 'libre' || modele.id === 'fal-ai/iclight-v2' ? phraseDeLumiere(d) : '',
      sourceId: source.id,
      etape,
      note: `Lumière de « ${source.plan} » : ${libelleDeDirection(d)}${fixe ? ` (« ${fixe} » chez le service)` : ' — direction décrite au modèle en mots'}.`,
    };
  }
  /* visage */
  const photos = (Array.isArray(args.photos) ? args.photos : String(args.photos ?? '').split(',')).map((x) => String(x ?? '').trim().replace(/^#/, '')).filter(Boolean);
  const plafond = modele.retouche?.sources ?? 1;
  if (!photos.length) return { ok: false, raison: 'Il faut « photos » : les identifiants des photos du visage à poser (pièces jointes ou médias du projet), demandées à l’utilisateur.' };
  if (photos.length > plafond) return { ok: false, raison: `${modele.nom} accepte ${plafond} photo(s) du visage au plus : garde les meilleures, ou choisis un modèle qui en prend plus.` };
  for (const id of photos) {
    const media = mediaParId(id);
    const piece = media ? null : store.getAttachment(id);
    if ((media && media.projectId !== card.projectId) || (!media && (!piece || piece.projectId !== card.projectId)) || !fichierDUneSource(id)) {
      return { ok: false, raison: `La photo « ${id} » est introuvable dans ce projet.` };
    }
  }
  const cible = String(args.cible ?? '').trim().slice(0, 300);
  if (!cible) return { ok: false, raison: 'Il faut « cible » : qui remplacer dans l’image (« la personne n° 2, à gauche »), choisie par l’utilisateur.' };
  return {
    ok: true,
    demande: { sources: [...sources, ...photos], cible },
    phrase: `In the first image, replace the face of ${cible} with the face shown in the other reference image${photos.length > 1 ? 's' : ''} (same person). Keep the expression natural, and keep pose, hair, clothing, lighting and everything else identical.`,
    sourceId: source.id,
    etape,
    note: `Visage remplacé dans « ${source.plan} » (${cible}) d’après ${photos.length} photo(s).`,
  };
}

/** Ce que l'agent lit quand il veut fabriquer, ou choisir un modèle, pendant le brief. */
export const REFUS_AU_BRIEF =
  'Refusé : la carte est encore au BRIEF — tout y est écrit, rien ne s’y fabrique ni ne s’y chiffre. Ne pose AUCUNE question de modèle, de prix ou de nombre de variantes. Réponds à l’utilisateur en UNE phrase : on est au brief, et pour fabriquer il faut cliquer « Passer aux esquisses » sous le champ d’écriture (dis ce qui manque encore au brief s’il manque quelque chose).';

export async function realiser(ctx: ContexteRealisation, args: Record<string, unknown>, attente: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<ResultatRealisation> {
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  if (!card?.parcours?.realisationSouhaitee) return { ok: false, text: REFUS_MODE_ETEINT };
  const action = String(args.action ?? '');
  const budget = budgetDeLaCarte(card);
  const depense = depenseDeLaCarte(card.id);
  const media = carteDeMedia(card);
  const etatDuBudget = media
    ? `Accepté d’un clic : ${arrondi(budget.budget ?? 0)} $ · dépensé : ${arrondi(depense)} $.`
    : `Budget : ${budget.budget === null ? 'non fixé' : `${budget.budget} $`} · dépensé : ${arrondi(depense)} $ · seuil d’accord : ${budget.seuil === null ? 'non fixé' : `${budget.seuil} $`}.`;
  /* RIEN NE SE FABRIQUE AU BRIEF (26/10/2026) : l'utilisateur passe aux esquisses par le bouton du bas.
     Le choix d'un MODÈLE non plus (27/10/2026) : il menait à une question de modèle et de prix au brief,
     sans rien pouvoir fabriquer derrière. */
  if (media && !passagesDuMedia(card).esquisses && ['modeles', 'devis', 'lot', 'generer', 'lumiere'].includes(action)) {
    return { ok: false, text: REFUS_AU_BRIEF };
  }

  switch (action) {
    case 'modeles': {
      const capacite = CAPACITES_DE_GENERATION.find((c) => c === args.capacite);
      const branches = servicesDeGenerationBranches();
      /*
       * LE CATALOGUE EN DIRECT (« en_direct » ou « recherche ») : TOUS les
       * modèles que fal.ai et Higgsfield publient pour cette capacité, avec ce
       * qu'ils reçoivent — pour en commander un qui n'est pas dans la liste
       * choisie. Avec « modele », le détail de ses entrées (réglables par
       * « parametres » au devis).
       */
      if (args.en_direct === true || typeof args.recherche === 'string') {
        const services = SERVICES_EN_DIRECT.filter((x) => !estServiceCache(x) && (!args.service || args.service === x));
        if (typeof args.modele === 'string' && args.modele.trim()) {
          const service = services[0] ?? 'kie';
          const m = await modeleLuEnDirect(String(args.service ?? service), args.modele.trim(), capacite);
          if (!m) return { ok: false, text: `Modèle « ${args.modele} » introuvable dans le catalogue en direct de ${args.service ?? service} (ou son schéma est illisible). Cherche avec « recherche ».` };
          const recoit = ceQueRecoitLeModele(m.entrees);
          return {
            ok: true,
            text: [
              `${m.nom} — service « ${m.service} »${branches.includes(m.service) ? '' : ' (À BRANCHER)'}, modèle « ${m.id} », capacité « ${m.capacite} » : ${m.usage}`,
              `Reçoit : ${[recoit.imageDeDepart ? 'image de départ (« source »)' : '', recoit.imageDeFin ? 'image de fin (« fin »)' : '', recoit.video ? 'vidéo de référence (« mouvement »)' : '', recoit.images ? 'images de référence (« photos »)' : '', recoit.audio ? 'son' : ''].filter(Boolean).join(', ') || 'une consigne seulement'}.`,
              `Entrées (* obligatoire) : ${entreesEnClair(m.entrees, 40)}`,
              'Au devis : « service », « modele », « capacite », et les autres réglages dans « parametres » ({ nom: valeur }) — les adresses de fichiers sont posées par le serveur.',
              `Prix : ${m.service === 'kie' ? 'lu au devis dans la liste publique de kie.ai quand elle le donne ; les crédits réellement consommés sont relevés après' : m.service === 'fal' ? 'publié par fal.ai, lu au devis' : 'non publié par Higgsfield (accord demandé)'}.`,
            ].join('\n'),
          };
        }
        const recherche = String(args.recherche ?? '').trim();
        const lus = (await Promise.all(services.map((x) => catalogueEnDirect(x)))).flat().filter((m) => !capacite || m.capacite === capacite);
        const trouves = filtrerLesModelesLus(lus, recherche).slice(0, 40);
        if (!trouves.length) return { ok: true, text: `Aucun modèle lu en direct${capacite ? ` pour « ${capacite} »` : ''}${recherche ? ` avec « ${recherche} »` : ''}. ${lus.length ? 'Élargis la recherche.' : 'Les catalogues des services sont illisibles pour l’instant : sers-toi de la liste choisie (« modeles » sans « en_direct »).'}` };
        return {
          ok: true,
          text: [
            `Modèles lus en direct chez ${services.map((x) => serviceDeGeneration(x)?.nom ?? x).join(' et ')}${capacite ? ` (« ${capacite} »)` : ''}${recherche ? `, recherche « ${recherche} »` : ''} — ${trouves.length} sur ${lus.length}, sans note de qualité (la liste choisie, « modeles » sans « en_direct », reste la recommandation) :`,
            ...trouves.map((m) => `- service « ${m.service} »${branches.includes(m.service) ? '' : ' (À BRANCHER)'}, modèle « ${m.id} » — ${m.nom} [${m.capacite}] : ${m.usage}${m.entrees.length ? ` · entrées : ${entreesEnClair(m.entrees, 8)}` : ''}`),
            'Pour ses entrées exactes : « modeles » avec « en_direct », « service » et « modele ».',
            etatDuBudget,
          ].join('\n'),
        };
      }
      /*
       * LES MODÈLES D'UNE RETOUCHE OU D'UNE ANIMATION : TOUS ceux du catalogue
       * (services déjà en place, jamais Magnific), branchés ou à brancher, avec
       * leur prix unitaire quand le service le publie — l'utilisateur choisit le
       * modèle en voyant la différence de prix (décision du 24/10/2026).
       */
      if (capacite && (capacite === 'animation' || capacite === 'mouvement' || estUneRetoucheDImage(capacite))) {
        const tous = catalogueVisible()
          .filter((m) => m.capacite === capacite)
          .sort((a, b) => Number(branches.includes(b.service)) - Number(branches.includes(a.service)) || b.qualite - a.qualite);
        const lignes = await Promise.all(
          tous.map(async (m) => {
            const prix = branches.includes(m.service) ? await prixPublie(m, m.durees?.[0] ?? 5, { secondes: m.durees?.[0] ?? 5 }) : null;
            const libellePrix = prix !== null ? `${arrondi(prix)} $ par ${capacite === 'animation' ? `plan de ${m.durees?.[0] ?? 5} s` : capacite === 'mouvement' ? 'seconde de vidéo' : 'image'} (tarif publié)` : m.prix === 'cout-reel-openrouter' ? 'aux jetons, coût réel relevé après' : m.prix === 'credits-kie' ? 'lu au devis dans la liste de kie.ai, crédits réels relevés après' : m.prix === 'api-fal' ? 'publié, lu au devis une fois fal.ai branché' : 'non publié par le service (accord demandé)';
            const extra = m.retouche?.lumiere ? ` · lumière ${m.retouche.lumiere === 'libre' ? 'LIBRE (sphère sans contrainte)' : `${m.retouche.lumiere.length} directions fixes (sphère aimantée)`}` : '';
            const photos = m.retouche?.sources ? ` · ${m.retouche.sources} ${m.capacite === 'visage' ? 'photo(s) du visage' : 'image(s) de référence'} au plus` : '';
            const fin = m.fin ? ' · IMAGE DE FIN possible (« fin »)' : capacite === 'animation' ? ' · image de départ seulement' : '';
            return `- service « ${m.service} »${branches.includes(m.service) ? '' : ' (À BRANCHER)'}, modèle « ${m.id} » — ${m.nom}, qualité ${m.qualite}/5 : ${m.usage}${extra}${photos}${fin} · prix : ${libellePrix}`;
          }),
        );
        return {
          ok: true,
          text: [
            `Modèles « ${capacite} » du catalogue (notes du ${DATE_DES_NOTES}) — pose-les à l’utilisateur avec « ask_user », un choix par modèle, le prix et l’écart de prix dans la description, ta recommandation en tête :`,
            ...lignes,
            'Un modèle « À BRANCHER » passe d’abord par l’action « brancher ». D’autres modèles encore : « modeles » avec « en_direct » (catalogue lu chez kie.ai).',
            etatDuBudget,
          ].join('\n'),
        };
      }
      if (!branches.length) return { ok: true, text: 'Aucun service de génération n’est branché. Appelle « realiser » action « brancher » avec les capacités voulues : l’utilisateur colle sa clé dans la conversation (fal.ai d’abord), sans quitter la carte.' };
      const openrouter = branches.includes('openrouter') && (!capacite || capacite === 'image') ? await modelesOpenRouter() : [];
      /* LA VOIX FINALE PAR OPENROUTER se propose aussi par la clé du relais, sans branchement. */
      const branchesListees = capacite === 'voix' && !branches.includes('openrouter') && voixParOpenRouterPossible() ? [...branches, 'openrouter' as const] : branches;
      const liste = modelesProposes(branchesListees, capacite, openrouter)
        .filter((m) => m.service !== 'openrouter' || m.capacite !== 'voix' || voixParOpenRouterPossible())
        .slice(0, 40);
      if (!liste.length) return { ok: true, text: `Aucun modèle branché ne sait faire « ${capacite} ». Services branchés : ${branches.join(', ')}. Appelle « realiser » action « brancher » avec « capacites » : ["${capacite}"].` };
      return {
        ok: true,
        text: [
          `Modèles disponibles${capacite ? ` (${capacite})` : ''}, la meilleure qualité d’abord (notes du ${DATE_DES_NOTES}) :`,
          ...liste.map(
            (m) =>
              `- service « ${m.service} », modèle « ${m.id} » — ${m.nom} [${m.capacite}] qualité ${m.qualite}/5 : ${m.usage}${m.durees ? ` · durées ${m.durees[0]}–${m.durees[m.durees.length - 1]} s` : ''}${m.son ? ' · avec son' : ''} · prix : ${m.prix === 'api-fal' ? 'publié (donné au devis)' : m.prix === 'credits-kie' ? 'liste publique de kie.ai (donné au devis), crédits réels relevés après' : m.prix === 'cout-reel-openrouter' ? 'aux jetons, coût réel relevé après' : 'non publié (accord demandé)'}`,
          ),
          etatDuBudget,
        ].join('\n'),
      };
    }

    case 'voix': {
      const service = args.service === 'heygen' ? 'heygen' : 'elevenlabs';
      const cle = cleDuService(service);
      if (!cle) return { ok: false, text: `${service === 'heygen' ? 'HeyGen' : 'ElevenLabs'} n’est pas branché.` };
      try {
        if (service === 'elevenlabs') {
          const { statut, corps } = await appeler({ methode: 'GET', adresse: 'https://api.elevenlabs.io/v1/voices', entetes: { 'xi-api-key': cle } });
          if (statut !== 200) return { ok: false, text: `ElevenLabs refuse la liste des voix (${statut}).` };
          const voix = (corps?.voices ?? []).slice(0, 40).map((v: any) => `- « ${v.voice_id} » ${v.name}${v.labels ? ` (${Object.values(v.labels).join(', ')})` : ''}`);
          return { ok: true, text: ['Voix ElevenLabs (passe l’identifiant en « voix ») :', ...voix].join('\n') };
        }
        const [looks, voix] = await Promise.all([
          appeler({ methode: 'GET', adresse: 'https://api.heygen.com/v3/avatars/looks?limit=30', entetes: { 'x-api-key': cle } }),
          appeler({ methode: 'GET', adresse: 'https://api.heygen.com/v3/voices?limit=40', entetes: { 'x-api-key': cle } }),
        ]);
        const liste = (corps: any) => (Array.isArray(corps?.data) ? corps.data : Array.isArray(corps?.data?.items) ? corps.data.items : []);
        return {
          ok: true,
          text: [
            'Présentateurs HeyGen (passe l’identifiant en « avatar ») :',
            ...liste(looks.corps).slice(0, 30).map((a: any) => `- « ${a.id ?? a.avatar_id} » ${a.name ?? ''}`),
            'Voix HeyGen (passe l’identifiant en « voix ») :',
            ...liste(voix.corps).slice(0, 40).map((v: any) => `- « ${v.voice_id ?? v.id} » ${v.name ?? ''} ${v.language ?? ''}`),
          ].join('\n'),
        };
      } catch (err) {
        return { ok: false, text: `Le service ne répond pas : ${String((err as Error)?.message ?? err).slice(0, 160)}` };
      }
    }

    case 'devis': {
      const service = String(args.service ?? '') as IdServiceGeneration;
      const id = String(args.modele ?? '');
      const consigne = String(args.consigne ?? '').trim();
      const plan = String(args.plan ?? '').trim().slice(0, 80);
      const raison = String(args.raison ?? '').trim();
      if (!consigne || !plan || !raison) return { ok: false, text: 'Il faut « plan » (le nom du plan ou du média), « consigne » (la demande complète au modèle) et « raison » (pourquoi ce modèle).' };
      if (estServiceCache(service)) return { ok: false, text: `Refusé : ${serviceDeGeneration(service)?.nom ?? service} n’est plus proposé (remplacé par kie.ai, décision de l’utilisateur). Refais le devis avec un modèle de kie.ai (« modeles »).` };
      const voixOpenRouter = service === 'openrouter' && id === MODELE_VOIX_OPENROUTER && voixParOpenRouterPossible();
      if (!servicesDeGenerationBranches().includes(service) && !voixOpenRouter) return { ok: false, text: `Le service « ${service} » n’est pas branché. Consulte « modeles », ou appelle « brancher » pour que l’utilisateur le branche depuis la conversation.` };
      if (voixOpenRouter && !VOIX_FINALES.some((v) => v.id === String(args.voix ?? '').trim())) {
        return { ok: false, text: `Il faut « voix » : une des vingt voix Gemini — ${VOIX_FINALES.map((v) => `${v.id} (${v.genre}, ${v.timbre})`).join(', ')}. « consigne » = le texte EXACT validé à l’arrêt 2.` };
      }
      const openrouter = service === 'openrouter' ? await modelesOpenRouter() : [];
      const choisi = modeleDeGeneration(service, id, openrouter, args.capacite ?? args.operation);
      /* UN MODÈLE HORS DE LA LISTE CHOISIE se commande depuis le catalogue lu en direct, d'après son schéma. */
      const enDirect = choisi ? null : await modeleLuEnDirect(service, id, args.capacite ?? args.operation);
      const modele: ModeleDeGeneration | undefined = choisi ?? enDirect ?? undefined;
      if (!modele) return { ok: false, text: `Le modèle « ${id} » n’est ni au catalogue choisi ni dans le catalogue lu en direct de ${service}. Consulte « modeles » (avec « en_direct » pour tout le catalogue).` };
      const parametres = args.parametres && typeof args.parametres === 'object' && !Array.isArray(args.parametres) ? (args.parametres as Record<string, unknown>) : undefined;
      /* kie.ai : TOUT modèle suit un schéma (recopié ou lu), ses réglages propres passent donc par « parametres ». */
      const kieChoisi = !enDirect && service === 'kie' ? modeleKie(modele.id, modele.capacite) : undefined;
      if (parametres && !enDirect && !kieChoisi) return { ok: false, text: '« parametres » ne sert qu’aux modèles lus en direct (« modeles » avec « en_direct ») : ce modèle-ci se règle par les champs de l’outil.' };
      /* UNE VIDÉO S'ANIME À PARTIR DES IMAGES RETENUES (24/10/2026) : tant qu'un
         modèle « animation » est branché, le texte seul vers la vidéo est refusé
         dans une production vidéo — chaque plan part de son image ajoutée au suivi. */
      if (
        modele.capacite === 'video' &&
        typesDeMediaDeLaRealisation(card.realisation).includes('video') &&
        modelesProposes(servicesDeGenerationBranches(), 'animation').length &&
        args.sans_image !== true
      ) {
        return { ok: false, text: 'Refusé : dans cette production, un plan vidéo s’anime à partir de son image AJOUTÉE AU SUIVI — fais le devis avec un modèle « animation » (consulte « modeles » avec capacite « animation ») et « source » = l’identifiant de l’image retenue. Un plan sans image (texte vers vidéo) ne part qu’avec l’accord écrit de l’utilisateur, et « sans_image » = vrai.' };
      }
      /* TOUTES LES IMAGES D'ABORD, PUIS L'ANIMATION (26/10/2026) : aucune séquence avant « Passer aux séquences vidéo ». */
      if (media && (modele.capacite === 'animation' || modele.capacite === 'video' || modele.capacite === 'mouvement')) {
        const permise = animationPermise({ types: typesDeMediaDeLaRealisation(card.realisation), carte: card });
        if (!permise.ok) return { ok: false, text: `Refusé : ${permise.raison}` };
      }
      const retouche = await lireLaRetouche(card, modele, args);
      /* UNE ANIMATION OU UNE RETOUCHE D'UNE IMAGE PLACÉE À LA MAIN suit sa case (28/10/2026) : même plan nommé que la source, même plan placé. */
      const sourceDuDevis = retouche.ok && retouche.sourceId ? mediaParId(retouche.sourceId) : null;
      const planPlaceHerite = sourceDuDevis && sourceDuDevis.plan === plan ? (sourceDuDevis.planPlace ?? null) : null;
      if (!retouche.ok) return { ok: false, text: retouche.raison };
      const schema = enDirect?.entrees ?? kieChoisi?.entrees;
      if (schema) {
        /* LA COMMANDE EST VÉRIFIÉE DÈS LE DEVIS contre le schéma du modèle, avec des adresses factices : un refus ici n'a rien coûté. */
        const essai = corpsEnDirect(schema, {
          consigne: consigne,
          format: FORMATS.find((f) => f === args.format) ?? '16:9',
          ...(Number(args.duree) > 0 ? { duree: Number(args.duree) } : {}),
          ...(retouche.demande.sources?.length ? { imageUrls: retouche.demande.sources.map(() => 'https://exemple.invalid/image') } : {}),
          ...(retouche.demande.fin ? { imageDeFinUrl: 'https://exemple.invalid/fin' } : {}),
          ...(retouche.demande.mouvement ? { videoDeMouvementUrl: 'https://exemple.invalid/video' } : {}),
          ...(retouche.demande.orientation ? { orientation: retouche.demande.orientation } : {}),
          ...(parametres ? { parametres } : {}),
          ...(modele.capacite === 'synchro' ? { videoUrl: 'https://exemple.invalid/video', audioUrl: 'https://exemple.invalid/voix' } : {}),
          ...(typeof args.voix === 'string' && args.voix.trim() ? { voix: args.voix.trim() } : {}),
        }, kieChoisi?.defauts);
        if (!essai.ok) return { ok: false, text: `Devis refusé pour ${modele.nom} : ${essai.raison}.${enDirect ? ' Lis ses entrées : « modeles » avec « en_direct », « service » et « modele ».' : ''}` };
      }
      if ((modele.capacite === 'voix' || modele.capacite === 'avatar') && service !== 'fal' && service !== 'kie' && !String(args.voix ?? '').trim()) return { ok: false, text: 'Il faut une « voix » (identifiant lu avec l’action « voix »).' };
      if (modele.capacite === 'avatar' && !String(args.avatar ?? '').trim()) return { ok: false, text: 'Il faut un « avatar » (identifiant lu avec l’action « voix », service heygen).' };
      const langue = args.langue === undefined ? undefined : langueDeDeclinaison(args.langue);
      if (args.langue !== undefined && !langue) return { ok: false, text: `Langue inconnue : « ${String(args.langue)} ». Langues : fr, en, de, es, it, pt, nl.` };
      let sourceDeSynchro: { video: MediaDeRealisation; audio: MediaDeRealisation } | null = null;
      if (modele.capacite === 'synchro') {
        const video = mediaParId(String(args.video ?? ''));
        const audio = mediaParId(String(args.audio ?? ''));
        if (!video || video.projectId !== card.projectId || video.etat !== 'fini' || video.genre !== 'video') return { ok: false, text: 'Il faut « video » : l’identifiant d’un média VIDÉO fini du projet (le présentateur à resynchroniser).' };
        if (!audio || audio.projectId !== card.projectId || audio.etat !== 'fini' || audio.genre !== 'son') return { ok: false, text: 'Il faut « audio » : l’identifiant d’une VOIX finie du projet (la nouvelle langue).' };
        sourceDeSynchro = { video, audio };
      }
      const nomsDeMethodes = (Array.isArray(args.methodes) ? args.methodes.map(String) : String(args.methodes ?? '').split(',')).map((x) => x.trim()).filter(Boolean);
      const versionsSuivies = nomsDeMethodes.map((n) => {
        const methode = methodeParNom(n);
        return { nom: n, version: methode ? versionActive(methode.id) : null };
      });
      const inconnues = versionsSuivies.filter((v) => !v.version).map((v) => v.nom);
      if (inconnues.length) return { ok: false, text: `Méthode sans version active : ${inconnues.map((n) => `« ${n} »`).join(', ')}. Consulte « methodes ».` };
      const format = FORMATS.find((f) => f === args.format) ?? '16:9';
      const duree = Number(args.duree);
      /* LA CONSIGNE PART EN ANGLAIS (24/10/2026) : traduite ICI, avant toute
         dépense, pour que le lot à valider montre déjà ce qui sera envoyé. Un
         échec refuse le devis : jamais le français envoyé en silence. */
      const envoyee = await consigneAEnvoyer(estUneRetoucheDImage(modele.capacite) || modele.capacite === 'animation' ? 'image' : modele.capacite, consigne);
      if (!envoyee.ok) return { ok: false, text: `Devis refusé : la consigne n’a pas pu être traduite en anglais (${envoyee.raison}). Rien n’est enregistré ni dépensé ; réessaie dans un instant.` };
      const demande = {
        consigne: [retouche.phrase, envoyee.consigne].filter(Boolean).join(' '),
        ...retouche.demande,
        ...(envoyee.originale ? { consigneOriginale: envoyee.originale } : {}),
        format,
        ...(Number.isFinite(duree) && duree > 0 ? { duree } : {}),
        ...(typeof args.voix === 'string' && args.voix.trim() ? { voix: args.voix.trim() } : {}),
        ...(typeof args.avatar === 'string' && args.avatar.trim() ? { avatar: args.avatar.trim() } : {}),
        ...(typeof args.son === 'boolean' ? { son: args.son } : {}),
        ...(langue ? { langue } : {}),
        ...(sourceDeSynchro ? { video: sourceDeSynchro.video.id, audio: sourceDeSynchro.audio.id } : {}),
        ...(enDirect ? { entrees: enDirect.entrees } : {}),
        ...(parametres ? { parametres } : {}),
      };
      const secondes = Number.isFinite(duree) && duree > 0 ? duree : sourceDeSynchro?.audio.demande.duree;
      const prix = await prixPublie(modele, Number.isFinite(duree) && duree > 0 ? (modele.durees ? dureeAjustee({ durees: modele.durees } as any, duree) : duree) : (modele.durees?.[0] ?? 5), {
        ...(secondes ? { secondes } : {}),
        caracteres: envoyee.consigne.length,
        texte: envoyee.consigne,
      });
      /* PLUSIEURS PROPOSITIONS (1 à 4, choisies par l'utilisateur à chaque génération) : un devis par proposition. */
      const propositions = media
        ? nombreDePropositions(args.variantes ?? args.propositions ?? PROPOSITIONS_MIN_D_UN_MEDIA, PROPOSITIONS_MIN_D_UN_MEDIA)
        : nombreDePropositions(args.variantes ?? args.propositions ?? 1);
      if (Number(args.variantes ?? args.propositions ?? 1) > PROPOSITIONS_PAR_GENERATION) {
        return { ok: false, text: `Refusé : ${PROPOSITIONS_PAR_GENERATION} propositions au plus par génération (décision de l’utilisateur).` };
      }
      const ids: string[] = [];
      for (let i = 0; i < propositions; i++) {
        const maintenant = Date.now();
        const m: MediaDeRealisation = {
          id: store.newId(),
          projectId: card.projectId,
          cardId: card.id,
          agentId: ctx.agentId,
          branche: brancheDeLaCarte(card, ctx.agentId),
          plan,
          version: 0,
          capacite: modele.capacite,
          genre: genreDuMedia(modele.capacite),
          service,
          modele: modele.id,
          modeleNom: modele.nom,
          demande,
          raison,
          prix,
          sourcePrix: modele.prix,
          coutReel: null,
          etat: 'devis',
          questionId: null,
          echec: null,
          fichier: null,
          taille: null,
          attachmentId: null,
          etape: ETAPES_DU_SUIVI.find((e) => e === args.etape) ?? retouche.etape,
          lotId: null,
          retenuLe: null,
          planPlace: planPlaceHerite,
          sourceId: retouche.sourceId,
          mesure: null,
          creeLe: maintenant + i,
          modifieLe: maintenant + i,
        };
        enregistrer(m);
        if (versionsSuivies.length) enregistrerUsages(m.id, versionsSuivies.map((v) => v.version!.id));
        ids.push(m.id);
      }
      const decision = decisionDuLot({ total: (prix ?? 0) * propositions, budget: budget.budget, depense });
      /* LE SOLDE DE kie.ai, lu gratuitement : un devis qui le dépasse se dit avant tout lancement. */
      const cleKie = service === 'kie' ? cleDuService('kie') : undefined;
      const solde = cleKie ? await soldeKie(cleKie) : null;
      const insuffisant = solde !== null && (solde <= 0 || (prix !== null && prix * propositions > solde * DOLLARS_PAR_CREDIT));
      const noteDuSolde =
        solde === null
          ? ''
          : `Solde kie.ai : ${Math.round(solde)} crédits (≈ ${arrondi(solde * DOLLARS_PAR_CREDIT)} $)${insuffisant ? ' — INSUFFISANT pour ce devis : dis-le à l’utilisateur et ne propose aucun lot avant qu’il recharge son compte sur kie.ai.' : '.'}`;
      const suite = insuffisant
        ? 'Lancement impossible en l’état : le solde kie.ai ne couvre pas ce devis.'
        : media
          ? `Propose-les maintenant avec « lot » (« devis_du_lot » = ces ${ids.length} identifiants, rien d’autre) : le bouton « Valider · prix » part dans le fil, et le clic de l’utilisateur lance la génération. Puis passe au plan suivant : une validation par plan, toutes dans ce tour.`
          : decision.verdict === 'refus'
            ? `Lancement impossible en l’état : ${decision.raison}`
            : 'Regroupe ce devis avec les autres de la même étape (action « lot ») : rien ne part avant le clic de l’utilisateur sur le bloc « Devis ».';
      return {
        ok: true,
        text: [
          ids.length > 1 ? `${ids.length} devis — ${plan} (${ids.length} propositions) : ${ids.map((x) => `« ${x} »`).join(', ')}.` : `Devis « ${ids[0]} » — ${plan}.`,
          `Écris d’abord dans ta réponse : 🎬 ${plan}${ids.length > 1 ? ` ×${ids.length}` : ''} — ${modele.nom} (${serviceDeGeneration(service)?.nom ?? service}) — ${libelleDuPrix(prix, modele.prix)}${ids.length > 1 ? ' chacune' : ''} — ${raison}`,
          retouche.note,
          suite,
          noteDuSolde,
          etatDuBudget,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    case 'generer': {
      /* UN LOT ENTIER : chaque opération de sa liste fermée, l'une après l'autre. */
      if (args.lot !== undefined && args.lot !== null && String(args.lot).trim()) {
        const lot = lotParId(String(args.lot));
        if (!lot || lot.cardId !== card.id) return { ok: false, text: 'Lot introuvable sur cette carte : propose d’abord un lot (action « lot »).' };
        const textes: string[] = [];
        for (const op of lot.operations) {
          const m = mediaParId(op.mediaId);
          if (!m) continue;
          const r = await genererUnDevis(card, ctx, m, attente);
          if (r.question) return r;
          textes.push(`- ${m.plan} : ${r.text}`);
        }
        return { ok: true, text: [`Lot « ${lot.titre} » :`, ...textes, etatDuBudget].join('\n') };
      }
      const m = mediaParId(String(args.devis ?? ''));
      if (!m || m.cardId !== card.id) return { ok: false, text: 'Devis introuvable sur cette carte : fais d’abord un « devis ».' };
      return genererUnDevis(card, ctx, m, attente);
    }

    case 'lot': {
      const ids = (Array.isArray(args.devis_du_lot) ? args.devis_du_lot : String(args.devis_du_lot ?? args.devis ?? '').split(','))
        .map((x) => String(x ?? '').trim())
        .filter(Boolean);
      if (!ids.length) return { ok: false, text: 'Il faut « devis_du_lot » : les identifiants rendus par « devis », un par génération du lot.' };
      const medias: MediaDeRealisation[] = [];
      for (const id of [...new Set(ids)]) {
        const m = mediaParId(id);
        if (!m || m.cardId !== card.id) return { ok: false, text: `Devis « ${id} » introuvable sur cette carte.` };
        if (m.etat !== 'devis') return { ok: false, text: `Le devis « ${m.plan} » n’est plus à proposer (état : ${m.etat}) : fais-en un nouveau.` };
        const deja = m.lotId ? lotParId(m.lotId) : null;
        if (deja && deja.etat !== 'refuse') return { ok: false, text: `Le devis « ${m.plan} » est déjà dans le lot « ${deja.titre} » (${deja.etat === 'valide' ? 'validé : lance-le avec « generer »' : 'en attente de réponse'}).` };
        medias.push(m);
      }
      const titre = String(args.titre ?? '').trim().slice(0, 80) || medias.map((m) => m.plan).join(', ').slice(0, 80);
      const etape = ETAPES_DU_SUIVI.find((e) => e === args.etape) ?? null;
      if (media) {
        /* CHAQUE GÉNÉRATION SE VALIDE UNE À UNE (26/10/2026) : un lot = les variantes d'une même génération. */
        const plans = new Set(medias.map((m) => m.plan.trim().toLowerCase()));
        if (plans.size > 1) return { ok: false, text: 'Refusé : un lot porte UNE génération (ses 2 à 4 variantes), jamais plusieurs plans ou médias ensemble — propose un lot par génération.' };
        const reessai = String(args.reessai ?? '').trim();
        if (reessai) return reessayerDOffice(card, ctx, medias, reessai, titre, etape, attente);
      }
      return proposerUnLot(card, ctx.agentId, medias, { titre, etape });
    }

    case 'brancher': {
      const brut = Array.isArray(args.capacites) ? args.capacites : args.capacite !== undefined ? [args.capacite] : [];
      let voulues = brut.map((c) => String(c ?? '').trim()).filter((c): c is CapaciteDeGeneration => (CAPACITES as readonly string[]).includes(c));
      if (!voulues.length) voulues = capacitesDesTypes(typesDeMediaDeLaRealisation(card.realisation));
      if (!voulues.length) return { ok: false, text: `Il faut « capacites » : ce qu’il faut fabriquer (${CAPACITES.join(', ')}).` };
      const manquent = capacitesSansService(voulues, capacitesCouvertes());
      if (!manquent.length) return { ok: true, text: `Un service branché sait déjà fabriquer ${voulues.map(libelleDeCapacite).join(', ')} : consulte « modeles ».` };
      const conseilles = servicesPourLesCapacites(manquent, catalogueVisible());
      if (!conseilles.length) return { ok: false, text: `Aucun service du catalogue ne sait fabriquer ${manquent.map(libelleDeCapacite).join(', ')} pour l’instant.` };
      const nom = (id: string) => serviceDeGeneration(id)?.nom ?? id;
      const recommande = conseilles.find((c) => c.rang === 'recommande');
      const economique = conseilles.find((c) => c.rang === 'economique');
      const raison = String(args.raison ?? '').trim().slice(0, 300);
      const question = questionPosee(
        {
          question: `Brancher un service pour fabriquer ${manquent.map(libelleDeCapacite).join(', ')} ?`,
          description: [
            raison,
            `Aucun service branché ne sait encore le faire.`,
            recommande ? `${nom(recommande.id)} est recommandé : un seul compte, et ses prix sont publiés, donc chaque devis est exact.` : '',
            economique ? `${nom(economique.id)} fabrique les vidéos pour moins cher.` : '',
            'Collez la clé ci-dessous : elle est testée gratuitement, rangée dans le coffre, et la fabrication reprend aussitôt. Rien n’est dépensé sans devis validé.',
          ]
            .filter(Boolean)
            .join(' '),
          options: [{ label: REPONSE_SANS_BRANCHEMENT, description: 'Rien n’est branché ; l’agent continue sans fabriquer ces médias.' }],
        },
        { branchement: { capacites: manquent } },
      );
      noterUnEvenement(card.id, 'branchement.demande', { capacites: manquent });
      return { ok: true, text: texteSansAttente(), question };
    }

    case 'noter': {
      const genre = GENRES_D_ELEMENT.find((g) => g === args.genre) as GenreDElement | undefined;
      const titre = String(args.titre ?? '').trim();
      const contenu = String(args.contenu ?? '').trim();
      if (!genre || !titre || !contenu) return { ok: false, text: `Il faut « genre » (${GENRES_D_ELEMENT.join(', ')}), « titre » et « contenu ».` };
      const etat = args.etat === 'a-valider' ? 'a-valider' : 'propose';
      const element = noterUnElement({
        cardId: card.id,
        projectId: card.projectId,
        genre,
        cle: typeof args.cle === 'string' ? args.cle : undefined,
        titre,
        contenu,
        etat,
        parent: typeof args.parent === 'string' && args.parent.trim() ? args.parent.trim() : null,
      });
      return {
        ok: true,
        text: `« ${element.titre} » noté (${element.genre}, clé « ${element.cle} », v${element.version}) : il paraît dans le volet de suivi.${element.version > 1 ? ' La version précédente est gardée.' : ''}`,
      };
    }

    case 'suivre': {
      const id = String(args.id ?? args.devis ?? '');
      let m = mediaParId(id);
      if (!m || m.cardId !== card.id) return { ok: false, text: 'Génération introuvable sur cette carte.' };
      if (m.etat === 'en-cours') {
        const travail = enVol.get(m.id);
        if (!travail) {
          m = liberer(m, 'interrompue par un redémarrage du serveur : elle a peut-être été facturée — vérifie le compte chez le service avant de relancer');
        } else {
          await Promise.race([travail, attente(RYTHME_REALISATION.attenteSuiviMs)]);
          m = mediaParId(id)!;
        }
      }
      if (m.etat === 'en-cours') return { ok: true, text: `Toujours en cours (${m.modeleNom}) : rappelle « suivre » avec « ${m.id} ».` };
      if (m.etat === 'echec') return { ok: false, text: texteDePanne(card, m) };
      if (m.etat !== 'fini') return { ok: false, text: `Ce devis n’a pas été lancé (état : ${m.etat}).` };
      const attachment = m.attachmentId ? store.getAttachment(m.attachmentId) : null;
      return {
        ok: true,
        text: `« ${m.plan} » v${m.version} prêt : ${m.fichier}${m.coutReel !== null ? ` (coût réel ${arrondi(m.coutReel)} $)` : ''}. Il paraît dans le fil. Regarde-le (lis le fichier) avant de passer au plan suivant.\n${`Dépensé : ${arrondi(depenseDeLaCarte(card.id))} $${budget.budget !== null && !media ? ` sur ${budget.budget} $` : ''}.`}${media ? ' L’utilisateur valide lui-même, d’un clic sur le média, ce qu’il garde.' : ''}`,
        ...(attachment ? { attachment } : {}),
      };
    }

    case 'lister': {
      const medias = mediasDeLaCarte(card.id);
      const finis = medias.filter((m) => m.etat === 'fini');
      const enCours = medias.filter((m) => m.etat === 'en-cours');
      const echecs = medias.filter((m) => m.etat === 'echec');
      return {
        ok: true,
        text: [
          `${finis.length} média(s) produit(s) sur cette carte :`,
          ...(finis.length ? finis.map(ligneDeMedia) : ['- aucun pour l’instant']),
          ...(enCours.length ? [`En cours : ${enCours.map((m) => `${m.plan} (« ${m.id} »)`).join(', ')}`] : []),
          ...(echecs.length ? [`Échecs : ${echecs.map((m) => `${m.plan} — ${m.echec}`).join(' ; ')}`] : []),
          ...lotsDeLaCarte(card.id).map(
            (l) => `Lot « ${l.titre} » (« ${l.id} ») : ${l.etat === 'propose' ? 'en attente du clic' : l.etat === 'valide' ? 'validé' : 'refusé'} — ${l.operations.length} opération(s), ${arrondi(totalDuLot(l.operations).connu)} $${totalDuLot(l.operations).sansPrix ? ' + prix non publiés' : ''}`,
          ),
          media
            ? `Total dépensé : ${arrondi(depenseDeLaCarte(card.id))} $ (accepté d’un clic : ${arrondi(budget.budget ?? 0)} $).`
            : `Total dépensé : ${arrondi(depenseDeLaCarte(card.id))} $${budget.budget !== null ? ` sur un budget de ${budget.budget} $` : ''}.`,
          finis.length ? `Dossier : ${path.dirname(finis[0]!.fichier ?? '')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    case 'media': {
      /* LE DÉTAIL COMPLET D'UN MÉDIA : ce que l'utilisateur lit dans « Réglages », pour refaire ou relancer. */
      const m = mediaParId(String(args.id ?? args.media ?? ''));
      if (!m || m.cardId !== card.id) return { ok: false, text: 'Média introuvable sur cette carte : « lister » donne les identifiants.' };
      return {
        ok: true,
        text: [
          `« ${m.id} » — ${m.plan} v${m.version} [${m.genre}, ${m.capacite}] — état ${m.etat}${m.retenuLe ? ', DANS LE SUIVI' : ''}.`,
          `Service « ${m.service} », modèle « ${m.modele} » (${m.modeleNom}), format ${m.demande.format}${m.demande.duree ? `, ${m.demande.duree} s` : ''}.`,
          `Consigne envoyée : ${m.demande.consigne}`,
          ...(m.demande.consigneOriginale ? [`Consigne écrite (avant traduction) : ${m.demande.consigneOriginale}`] : []),
          ...reglagesEnClair(m).map((r) => `${r.cle} : ${r.valeur}`),
          ...(m.sourceId ? [`Source : « ${m.sourceId} »`] : []),
          `Prix : ${m.coutReel !== null ? `${arrondi(m.coutReel)} $ (réel)` : m.prix !== null ? `${arrondi(m.prix)} $ (annoncé)` : 'non publié'}.`,
          ...(m.fichier ? [`Fichier : ${m.fichier}`] : []),
        ].join('\n'),
      };
    }

    case 'lumiere': {
      /*
       * LA SPHÈRE DE LUMIÈRE, posée APRÈS le choix du modèle : libre avec un
       * modèle qui accepte une direction décrite, aimantée sur les directions
       * fixes d'un modèle qui n'en a que quelques-unes. Elle arrête le tour
       * jusqu'à la réponse « Lumière : azimut …°, élévation …° ».
       */
      const service = String(args.service ?? '') as IdServiceGeneration;
      const openrouter = service === 'openrouter' ? await modelesOpenRouter() : [];
      const modele = modeleDeGeneration(service, String(args.modele ?? ''), openrouter, 'lumiere');
      if (!modele || modele.capacite !== 'lumiere') {
        const possibles = modelesProposes(catalogueDeGeneration().map((x) => x.service), 'lumiere');
        return { ok: false, text: `Il faut le « service » et le « modele » de lumière choisis par l’utilisateur : ${possibles.map((x) => `${x.service} « ${x.id} »`).join(', ')}.` };
      }
      const source = mediaParId(String(args.source ?? ''));
      if (!source || source.cardId !== card.id || source.genre !== 'image' || source.etat !== 'fini') return { ok: false, text: 'Il faut « source » : l’image finie de cette carte à rééclairer.' };
      const permises = modele.retouche?.lumiere ?? 'libre';
      const question = questionPosee(
        {
          question: `D’où doit venir la lumière sur « ${source.plan} » ?`,
          description:
            permises === 'libre'
              ? `Tournez le point de lumière autour de la sphère, librement : ${modele.nom} reçoit la direction décrite en mots.`
              : `${modele.nom} n’accepte que ${permises.length} directions : le point se cale sur la plus proche.`,
          options: [],
        },
        {
          lumiere: {
            directions: permises === 'libre' ? 'libre' : permises.map((p) => ({ azimut: p.azimut, elevation: p.elevation, libelle: p.libelle })),
            ...(source.attachmentId ? { image: source.attachmentId } : {}),
            modele: modele.nom,
          },
        },
      );
      return { ok: true, text: texteSansAttente(), question: { ...question, kind: 'text' } };
    }

    case 'retenir': {
      /* SEUL L'UTILISATEUR VALIDE (26/10/2026) : le bouton « Valider » sur le média. */
      if (media) return { ok: false, text: 'Refusé : sur une création de média, seul l’utilisateur valide un média (le bouton « Valider » posé sur chaque média du fil). Dis-lui lequel tu recommandes, en une phrase.' };
      /* L'AGENT AJOUTE LUI-MÊME AU SUIVI une image qu'il juge réussie (fabrication sans arrêt, 25/10/2026). */
      const r = retenirUnMedia(card.id, String(args.id ?? args.media ?? ''), args.retenu !== false && args.retenu !== 'false');
      if (!r.ok) return { ok: false, text: `Impossible : ${r.raison}.` };
      return { ok: true, text: `« ${r.media.plan} » v${r.media.version} ${r.media.retenuLe ? 'est au suivi' : 'retiré du suivi'}${r.change ? '' : ' (déjà)'}.` };
    }

    case 'monter': {
      /* LE MONTAGE EST UNE ÉTAPE DE L'UTILISATEUR (26/10/2026) : il y passe par le bouton du bas ; l'agent n'y fait jamais sauter la carte. */
      if (media && !passagesDuMedia(card).montage) return { ok: false, text: 'Refusé : le montage s’ouvre quand l’utilisateur clique « Passer au montage ». Reste aux esquisses ; ne change jamais d’étape à sa place.' };
      const ecrite = media ? null : poserLeMontage(card);
      const finis = mediasDeLaCarte(card.id).filter((m) => m.etat === 'fini' && m.service !== 'montage');
      const verses = '';
      return {
        ok: true,
        text: [
          `Montage annoncé${ecrite ? '' : ' (déjà)'} : l’étape « Montage » est allumée sur le chemin du tournage. Tu montes toi-même, sur le serveur, sans frais :`,
          '1. « composer », « geste » = « preparer », avec « plan » = « montage », « format », « duree » et « medias » = les plans finis, la voix finale, la musique (identifiants ci-dessous) ;',
          '2. la page : les plans en <video class="clip" muted> à la suite, la voix et la musique en <audio class="clip" id=…>, les sous-titres au mot (« mots » sur la voix), les titres et l’appel à l’action ;',
          '3. « controler », « apercu », puis « rendre » avec « formats » = chaque format demandé : le film passe en livraison et arrive dans le fil ;',
          '4. « production » action « soumettre », « etape » = « rendu », « film » = sa pièce jointe.',
          finis.length ? `Médias finis de la carte : ${finis.map((m) => `« ${m.id} » ${m.plan} v${m.version} [${m.genre}]`).join(' ; ')}.` : 'Aucun média fini sur la carte pour l’instant.',
        ].join('\n'),
      };
    }

    case 'composer':
      return composerSurLeServeur(card, ctx, args);

    case 'mots':
      return motsDUneVoix(card, ctx, args);

    case 'sons':
      return sonsSynthetises(card, ctx, args);

    case 'ajouter': {
      const chemin = String(args.chemin ?? '').trim();
      const plan = String(args.plan ?? '').trim().slice(0, 80) || 'montage';
      if (!chemin || !path.isAbsolute(chemin) || !fs.existsSync(chemin) || !fs.statSync(chemin).isFile()) return { ok: false, text: 'Il faut le « chemin » ABSOLU d’un fichier qui existe (ton montage final, par exemple).' };
      const ext = path.extname(chemin).slice(1).toLowerCase();
      const capacite: CapaciteDeGeneration = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? 'image' : ['mp3', 'wav', 'm4a', 'ogg', 'aac'].includes(ext) ? 'son' : 'video';
      const maintenant = Date.now();
      const m: MediaDeRealisation = {
        id: store.newId(),
        projectId: card.projectId,
        cardId: card.id,
        agentId: ctx.agentId,
        branche: brancheDeLaCarte(card, ctx.agentId),
        plan,
        version: 0,
        capacite,
        genre: genreDuMedia(capacite),
        service: 'montage',
        modele: 'montage',
        modeleNom: 'Montage de l’agent',
        demande: { consigne: String(args.consigne ?? 'montage final').slice(0, 2000), format: '16:9' },
        raison: 'assemblé sur le serveur, sans service payant',
        prix: 0,
        sourcePrix: 'aucun',
        coutReel: null,
        etat: 'en-cours',
        questionId: null,
        echec: null,
        fichier: null,
        taille: null,
        attachmentId: null,
        etape: 'montage',
        lotId: null,
        creeLe: maintenant,
        modifieLe: maintenant,
      };
      enregistrer(m);
      /* Le repli : un agent qui range son montage sans l'avoir annoncé allume quand même l'étape — jamais sur une création de média, où l'utilisateur seul change d'étape. */
      if (!media) poserLeMontage(card);
      try {
        const fini = await ranger(m, fs.readFileSync(chemin), ext === 'mp4' ? 'video/mp4' : ext);
        const attachment = fini.attachmentId ? store.getAttachment(fini.attachmentId) : null;
        return { ok: true, text: `« ${plan} » v${fini.version} rangé : ${fini.fichier}. Il paraît dans le fil.`, ...(attachment ? { attachment } : {}) };
      } catch (err) {
        maj(m, { etat: 'echec', echec: String((err as Error)?.message ?? err).slice(0, 300) });
        return { ok: false, text: `Rangement impossible : ${String((err as Error)?.message ?? err).slice(0, 200)}` };
      }
    }

    case 'fixer_budget': {
      /* UNE CRÉATION DE MÉDIA N'A PLUS DE BUDGET (26/10/2026) : chaque génération se valide par son bouton à prix. */
      if (media) return { ok: false, text: 'Refusé : une création de média n’a plus de budget ni de plafond. Chaque génération se valide par son propre bouton « Générer · prix » (« devis » puis « lot »).' };
      const montant = Number(args.budget);
      const seuil = Number(args.seuil);
      const raison = String(args.raison ?? '').trim();
      if (!Number.isFinite(montant) || montant <= 0 || !Number.isFinite(seuil) || seuil < 0) return { ok: false, text: 'Il faut « budget » (total, en dollars, > 0) et « seuil » (par génération, en dollars).' };
      if (!raison) return { ok: false, text: 'Dis en une phrase pourquoi ce budget (ce qu’il permet de fabriquer).' };
      const demande = card.parcours?.realisationBudgetDemande;
      if (demande && demande.budget === montant && demande.seuil === seuil) {
        const reponse = reponseALaQuestion(ctx.agentId, demande.questionId);
        if (reponse !== undefined) {
          const parcours = { ...card.parcours!, realisationBudgetDemande: undefined };
          if (accordDeRealisationDonne(reponse)) {
            const ecrite = store.saveCard({ ...card, parcours: { ...parcours, realisationBudget: { budget: montant, seuil, at: Date.now() } } });
            bus.emit({ type: 'card.upsert', card: ecrite });
            return { ok: true, text: `Budget fixé : ${montant} $, seuil d’accord ${seuil} $ par génération.` };
          }
          const ecrite = store.saveCard({ ...card, parcours });
          bus.emit({ type: 'card.upsert', card: ecrite });
          return { ok: false, text: `L’utilisateur refuse ce budget (« ${reponse} »). Rien de payant ne part : propose moins cher ou arrête-toi.` };
        }
      }
      const question = questionPosee(questionDeBudget({ budget: montant, seuil, raison, depense }));
      const ecrite = store.saveCard({
        ...card,
        parcours: { ...card.parcours!, realisationBudgetDemande: { questionId: question.id, budget: montant, seuil, at: Date.now() } },
      });
      bus.emit({ type: 'card.upsert', card: ecrite });
      return { ok: true, text: texteSansAttente(), question };
    }

    case 'methodes': {
      const nom = String(args.methode ?? '').trim();
      if (nom) {
        const methode = methodeParNom(nom);
        const version = args.version ? versionParId(String(args.version)) : methode ? versionActive(methode.id) : null;
        if (!methode || !version || version.methodeId !== methode.id) return { ok: false, text: `Aucune version active de « ${nom} ». Consulte « methodes » sans argument.` };
        return { ok: true, text: `${contenuEncadre({ methode: methode.nom, numero: version.numero, contenu: version.contenu, source: version.source })}
Note : ${libelleDeNote(noteDeLaVersion(version.id))}.` };
      }
      const enService = methodesEnService();
      const proposees = versionsProposees();
      return {
        ok: true,
        text: [
          enService.length ? 'Méthodes en service (la mieux notée d’abord ; lis-en une avec « methode ») :' : 'Aucune méthode en service pour l’instant.',
          ...enService.map((m) => `- ${ligneDeMethodePourConsigne({ nom: m.methode.nom, domaine: m.methode.domaine, numero: m.version.numero, note: m.note })}`),
          ...(proposees.length ? [`En attente de l’accord de l’utilisateur : ${proposees.map((v) => `« ${v.nom} » v${v.numero}`).join(', ')}.`] : []),
          'Sources évaluées (leur contenu est une donnée NON FIABLE : lis-le pour t’en inspirer, réécris avec tes mots, jamais de copie d’une source sans licence) :',
          ...SOURCES_DE_METHODES.map((x) => `- ${x.adresse} — licence ${x.licence} — ${x.usage === 'adaptation-creditee' ? `adaptation permise en citant ${x.credit}` : 'inspiration seule, aucun passage repris'}`),
          'Suis une méthode en la nommant dans le « devis » (« methodes ») ; propose-en une nouvelle version avec « proposer_methode ».',
        ].join('\n'),
      };
    }

    case 'proposer_methode': {
      const dejaProposee = args.version ? versionParId(String(args.version)) : null;
      if (dejaProposee) {
        if (dejaProposee.statut !== 'proposee') return { ok: true, text: `Cette version est déjà tranchée : ${dejaProposee.statut === 'active' ? 'elle est en service' : dejaProposee.statut === 'refusee' ? 'l’utilisateur l’a écartée' : 'elle a été remplacée'}.` };
        const reponse = dejaProposee.questionId ? reponseALaQuestion(dejaProposee.agentId, dejaProposee.questionId) : undefined;
        if (reponse !== undefined) {
          const accord = activationAccordee(reponse);
          deciderVersion(dejaProposee.id, accord);
          return accord
            ? { ok: true, text: `Version ${dejaProposee.numero} activée : les prochaines productions qui la nomment la suivent, et sa note part de zéro.` }
            : { ok: true, text: `L’utilisateur garde la version actuelle (« ${reponse} ») : la proposition est écartée.` };
        }
      }
      const nom = String(args.methode ?? '').trim().slice(0, 80);
      const contenu = contenuNettoye(String(args.contenu ?? ''));
      const raison = String(args.raison ?? '').trim();
      const domaine = (DOMAINES_DE_METHODE as readonly string[]).includes(String(args.domaine)) ? (args.domaine as DomaineDeMethode) : null;
      if (!dejaProposee && (!nom || !contenu || !raison || !domaine)) return { ok: false, text: `Il faut « methode » (son nom), « domaine » (${DOMAINES_DE_METHODE.join(', ')}), « contenu » (la méthode, écrite avec tes mots) et « raison » (ce qu’elle améliore, tiré des productions).` };
      let source: string | null = null;
      if (!dejaProposee && args.source) {
        const s = sourceDeMethodes(args.source);
        if (!s) return { ok: false, text: `Source non évaluée : « ${String(args.source)} ». Seules les sources listées par « methodes » sont admises.` };
        source = s.usage === 'adaptation-creditee' ? s.credit ?? s.adresse : `${s.adresse} (inspiration seule)`;
      }
      const { methode, version } = dejaProposee
        ? { methode: { nom: versionsProposees().find((v) => v.id === dejaProposee.id)?.nom ?? '' }, version: dejaProposee }
        : proposerVersion({ nom, domaine: domaine!, contenu, raison, source, agentId: ctx.agentId, cardId: card.id });
      const active = methodeParNom(methode.nom);
      const enService = active ? versionActive(active.id) : null;
      const question = questionPosee(
        questionDActivationDeMethode({
          methode: methode.nom,
          numero: version.numero,
          raison: version.raison,
          ...(enService ? { noteActuelle: noteDeLaVersion(enService.id) } : {}),
          ...(version.source ? { source: version.source } : {}),
        }),
      );
      poserQuestionDeVersion(version.id, question.id);
      return { ok: true, text: `Version « ${version.id} » proposée. ${texteSansAttente()} Rappelle ensuite « proposer_methode » avec « version » = « ${version.id} ».`, question };
    }

    case 'avis': {
      const m = mediaParId(String(args.id ?? ''));
      if (!m || m.cardId !== card.id || m.etat !== 'fini') return { ok: false, text: 'Il faut « id » : un média FINI de cette carte.' };
      const avis = avisDuMedia(m.id);
      if (avis?.verdict) return { ok: true, text: `L’utilisateur a déjà tranché : ${avis.verdict === 'acceptee' ? 'gardé' : 'à refaire'}.` };
      if (avis) {
        const reponse = reponseALaQuestion(m.agentId, avis.questionId);
        const verdict = verdictDeProduction(reponse);
        if (reponse !== undefined && verdict) {
          enregistrerAvis(m.id, card.id, verdict);
          const notes = versionsDuMedia(m.id).map((v) => `« ${v.nom} » v${v.numero} : ${libelleDeNote(noteDeLaVersion(v.id))}`);
          return { ok: true, text: `« ${m.plan} » ${verdict === 'acceptee' ? 'gardé' : 'à refaire (nouveau devis)'}.${notes.length ? ` Notes : ${notes.join(' ; ')}.` : ''}` };
        }
        if (reponse !== undefined) return { ok: true, text: `L’utilisateur a répondu sans trancher : « ${reponse} ». Tiens-en compte ; l’avis ne note aucune méthode.` };
      }
      const question = questionPosee(questionDAvisDeProduction({ plan: m.plan, modele: m.modeleNom, methodes: versionsDuMedia(m.id).map((v) => v.nom) }));
      poserQuestionDAvis(m.id, question.id);
      return { ok: true, text: `${texteSansAttente()} Rappelle ensuite « avis » avec le même « id ».`, question };
    }

    case 'decliner': {
      const cible = langueDeDeclinaison(args.langue);
      const source: LangueDeDeclinaison = langueDeDeclinaison(args.langue_source) ?? 'fr';
      if (!cible || cible === source) return { ok: false, text: 'Il faut « langue » : la langue visée (fr, en, de, es, it, pt, nl), différente de « langue_source » (fr par défaut).' };
      const carteSource = args.carte ? store.getCard(String(args.carte)) : card;
      if (!carteSource || carteSource.projectId !== card.projectId) return { ok: false, text: 'La carte de la production d’origine est introuvable dans ce projet.' };
      const branches = servicesDeGenerationBranches();
      const plan = planDeDeclinaison({ medias: mediasDeLaCarte(carteSource.id), source, cible, synchroDisponible: modelesProposes(branches, 'synchro').length > 0 });
      return { ok: true, text: texteDuPlanDeDeclinaison(plan) };
    }

    default:
      return { ok: false, text: 'Action inconnue. Actions : modeles, voix, brancher, devis, lot, generer, suivre, lister, noter, retenir, monter, ajouter, fixer_budget, methodes, proposer_methode, avis, decliner.' };
  }
}

/* ------------------------------------------------------------------ */
/* Les aperçus du questionnaire — la porte de dépense DU CADRAGE         */
/* ------------------------------------------------------------------ */

/**
 * UN APERÇU POUR UN CHOIX EN IMAGES (décision de l'utilisateur du 22/10/2026).
 * Le cadrage n'a PAS l'outil « realiser » : cette porte-ci ne fabrique que des
 * IMAGES d'essai, à prix publié, prises sur l'enveloppe d'aperçus acceptée au
 * début du questionnaire (`decisionDApercu`) — jamais sur le budget principal.
 * La fabrication passe par le même chemin que la tâche (bloc d'attente du fil,
 * disque de stockage, pièce jointe), et l'appel attend l'image : le cadrage la
 * pose ensuite en option illustrée d'« ask_user ».
 */
export async function fabriquerUnApercu(
  ctx: ContexteRealisation,
  args: Record<string, unknown>,
  attente: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  options: { exemple?: boolean } = {},
): Promise<ResultatRealisation> {
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  /* UN EXEMPLE DE CHOIX (29/10/2026, `exemples-de-choix.ts`) passe par ici en
     dernier recours, HORS du mode caméra : il a sa propre enveloppe
     (`ENVELOPPE_DES_EXEMPLES`, 1 $ par carte) et son propre préfixe, sans
     toucher celle du questionnaire illustré. */
  if (options.exemple) {
    if (!card) return { ok: false, text: 'Un exemple payant se compte par carte : sans carte, seuls les moyens sans frais du serveur servent.' };
  } else if (!card?.parcours?.realisationSouhaitee) return { ok: false, text: REFUS_MODE_ETEINT };
  const realisation = realisationDeLaCarte(card!);
  const consigne = String(args.consigne ?? '').trim();
  if (!consigne) return { ok: false, text: 'Il faut « consigne » : la demande complète au modèle d’image, une seule proposition par aperçu (traduite en anglais avant l’envoi).' };
  const carte = card!;
  const phase = (PHASES_DE_REALISATION as readonly string[]).includes(String(args.phase)) ? (args.phase as PhaseDeRealisation) : realisation.phase;
  const prefixe = options.exemple ? PREFIXE_DES_EXEMPLES : `${PREFIXE_DES_APERCUS}${phase}-`;
  const enveloppe = options.exemple ? ENVELOPPE_DES_EXEMPLES : realisation.enveloppe;
  const legende = String(args.legende ?? '').trim().slice(0, 80);
  const service = MODELE_DES_APERCUS.service;
  if (!servicesDeGenerationBranches().includes(service)) {
    return { ok: false, text: 'kie.ai n’est pas branché : pas d’aperçu possible. Continue avec des choix décrits en mots (l’utilisateur branche kie.ai dans Réglages › Services de création).' };
  }
  const modele = modeleDeGeneration(service, String(args.modele ?? '') || MODELE_DES_APERCUS.id) ?? modeleDeGeneration(service, MODELE_DES_APERCUS.id);
  if (!modele || modele.capacite !== 'image') return { ok: false, text: 'Un aperçu est une IMAGE : choisis un modèle d’image de kie.ai (par défaut Z-Image, le moins cher).' };
  const prix = await prixPublie(modele, 0);
  const depense = options.exemple ? depenseDesExemples(carte.id) : depenseDesApercus(carte.id);
  const decision = decisionDApercu({ enveloppe, prix, depense });
  if (decision.verdict === 'refus') return { ok: false, text: `Aperçu refusé : ${decision.raison}` };
  if (!fs.existsSync(PATHS.medias)) {
    try {
      fs.mkdirSync(PATHS.medias, { recursive: true });
    } catch {
      return { ok: false, text: `Le dossier des médias (${PATHS.medias}) est inaccessible : le disque de stockage est peut-être démonté. Rien n’est lancé.` };
    }
  }
  const envoyee = await consigneAEnvoyer('image', consigne);
  if (!envoyee.ok) return { ok: false, text: `Aperçu refusé : la consigne n’a pas pu être traduite en anglais (${envoyee.raison}). Rien n’est dépensé ; réessaie dans un instant.` };
  const rang = mediasDeLaCarte(carte.id).filter((m) => estUnApercu(m.plan) && m.plan.startsWith(prefixe)).length + 1;
  const format = FORMATS.find((f) => f === args.format) ?? '1:1';
  const maintenant = Date.now();
  const m: MediaDeRealisation = {
    id: store.newId(),
    projectId: carte.projectId,
    cardId: carte.id,
    agentId: ctx.agentId,
    branche: null,
    plan: `${prefixe}${rang}`,
    version: 0,
    capacite: 'image',
    genre: genreDuMedia('image'),
    service,
    modele: modele.id,
    modeleNom: modele.nom,
    demande: { consigne: envoyee.consigne, ...(envoyee.originale ? { consigneOriginale: envoyee.originale } : {}), format },
    raison: legende || (options.exemple ? 'exemple d’un choix' : 'aperçu du questionnaire'),
    prix,
    sourcePrix: modele.prix,
    coutReel: null,
    etat: 'en-cours',
    questionId: null,
    echec: null,
    fichier: null,
    taille: null,
    attachmentId: null,
    etape: null,
    lotId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  };
  enregistrer(m);
  lancer(m, attente);
  await Promise.race([enVol.get(m.id), attente(RYTHME_REALISATION.attenteSuiviMs)]);
  const fini = mediaParId(m.id);
  const reste = arrondi(Math.max(0, (enveloppe ?? 0) - (options.exemple ? depenseDesExemples(carte.id) : depenseDesApercus(carte.id))));
  if (fini?.etat === 'fini' && fini.attachmentId) {
    return {
      ok: true,
      text: `Aperçu prêt (${arrondi(fini.coutReel ?? fini.prix ?? 0)} $, reste ${reste} $ dans l’enveloppe) : pièce « ${fini.attachmentId} »${legende ? ` — ${legende}` : ''}. Pour un choix en images, passe cet identifiant dans « image » d’une option d’« ask_user ». Le choix retenu rejoint seul le tableau d’ambiance.`,
    };
  }
  if (fini?.etat === 'en-cours') return { ok: false, text: 'L’aperçu tarde : il paraîtra dans le fil dès qu’il sera prêt. Pose ta question en mots en attendant.' };
  return { ok: false, text: `L’aperçu a échoué : ${fini?.echec ?? 'raison inconnue'}. Continue avec des choix décrits en mots.` };
}

/* ------------------------------------------------------------------ */
/* Les panneaux du menu « … » d'un média (26/10/2026)                  */
/* ------------------------------------------------------------------ */

/** Les options du menu « … » qui fabriquent, et la capacité de chacune. */
export const OPERATIONS_DU_PANNEAU = ['visage', 'lumiere', 'angles', 'animer', 'gestes', 'consigne'] as const;
export type OperationDuPanneau = (typeof OPERATIONS_DU_PANNEAU)[number];

function capaciteDuPanneau(operation: OperationDuPanneau, genre: string): CapaciteDeGeneration {
  if (operation === 'visage') return 'visage';
  if (operation === 'lumiere') return 'lumiere';
  if (operation === 'angles') return 'angles';
  if (operation === 'animer') return 'animation';
  if (operation === 'gestes') return 'mouvement';
  return genre === 'video' ? 'animation' : 'retouche';
}

export interface ModeleDuPanneau {
  service: string;
  modele: string;
  nom: string;
  qualite: number;
  usage: string;
  /** Prix publié d'UNE variante ; `null` : non publié. */
  prix: number | null;
  /** Le modèle accepte une image de fin (animation). */
  fin?: boolean;
  /** Le nombre de photos du visage ou d'images de référence qu'il accepte. */
  sources?: number;
  /** La lumière : libre, ou les directions fixes. */
  lumiere?: 'libre' | { azimut: number; elevation: number; libelle: string }[];
  verticalMin?: number;
  verticalMax?: number;
}

/**
 * LE MEILLEUR MODÈLE D'UNE OPTION, CHOISI D'OFFICE (26/10/2026) : le modèle
 * branché, non caché, de la meilleure qualité pour la capacité ; un second
 * n'est proposé que s'il se VAUT vraiment — même qualité, ou une qualité de
 * moins pour au plus la moitié du prix. Le prix est celui d'une variante, lu
 * dans la liste publique du service.
 */
export async function chiffrerUnPanneau(
  cardId: string,
  e: { mediaId: string; operation: OperationDuPanneau; duree?: number },
): Promise<{ capacite: CapaciteDeGeneration; modeles: ModeleDuPanneau[]; recommande: string | null; raison?: string }> {
  const card = store.getCard(cardId);
  const m = mediaParId(e.mediaId);
  if (!card || !m || m.cardId !== cardId) throw new Error('média introuvable sur cette carte');
  const capacite = capaciteDuPanneau(e.operation, m.genre);
  if (capacite === 'animation' || capacite === 'mouvement') {
    const permise = animationPermise({ types: typesDeMediaDeLaRealisation(card.realisation), carte: card });
    if (!permise.ok) return { capacite, modeles: [], recommande: null, raison: permise.raison };
  }
  const branches = servicesDeGenerationBranches();
  const candidats = catalogueVisible()
    .filter((x) => x.capacite === capacite && branches.includes(x.service) && !estServiceCache(x.service))
    .sort((a, b) => b.qualite - a.qualite);
  const duree = e.duree && e.duree > 0 ? e.duree : undefined;
  const chiffres: ModeleDuPanneau[] = await Promise.all(
    candidats.map(async (x) => {
      const secondes = capacite === 'animation' ? (x.durees ? dureeAjustee({ durees: x.durees } as never, duree ?? x.durees[0] ?? 5) : (duree ?? 5)) : undefined;
      const prix = await prixPublie(x, secondes ?? 5, secondes ? { secondes } : {}).catch(() => null);
      return {
        service: x.service,
        modele: x.id,
        nom: x.nom,
        qualite: x.qualite,
        usage: x.usage,
        prix,
        ...(x.fin ? { fin: true } : {}),
        ...(x.retouche?.sources ? { sources: x.retouche.sources } : {}),
        ...(x.retouche?.lumiere ? { lumiere: x.retouche.lumiere === 'libre' ? ('libre' as const) : x.retouche.lumiere.map((p) => ({ azimut: p.azimut, elevation: p.elevation, libelle: p.libelle })) } : {}),
        ...(x.retouche?.verticalMin !== undefined ? { verticalMin: x.retouche.verticalMin } : {}),
        ...(x.retouche?.verticalMax !== undefined ? { verticalMax: x.retouche.verticalMax } : {}),
      };
    }),
  );
  if (!chiffres.length) return { capacite, modeles: [], recommande: null, raison: 'aucun service branché ne sait faire cette opération : branchez kie.ai dans les réglages.' };
  /* UN VRAI CHOIX (décision du 26/10/2026) : tous les modèles qui savent faire
     l'opération, du meilleur au moins bon ; le meilleur est choisi d'office.
     À qualité égale, le moins cher passe devant. */
  const tries = [...chiffres].sort((a, b) => b.qualite - a.qualite || (a.prix ?? Infinity) - (b.prix ?? Infinity));
  const vus = new Set<string>();
  const modeles = tries.filter((x) => (vus.has(`${x.service}:${x.modele}`) ? false : (vus.add(`${x.service}:${x.modele}`), true)));
  return { capacite, modeles, recommande: modeles[0]!.modele };
}

/**
 * LE BOUTON « ENVOYER · PRIX » D'UN PANNEAU (26/10/2026) : le clic VAUT
 * ACCORD. Les devis se font par le même chemin que ceux de l'agent (`realiser`
 * action « devis »), le lot est accepté aussitôt et lancé — sans tour d'agent.
 * Une trace lisible s'écrit dans le fil (elle ne réveille pas le moteur), et les
 * brouillons arrivent au bas du fil comme toute génération.
 */
export async function lancerUnPanneau(
  cardId: string,
  e: {
    mediaId: string;
    operation: OperationDuPanneau;
    service: string;
    modele: string;
    variantes?: number;
    consigne?: string;
    photos?: string[];
    cible?: string;
    /** Le visage cliqué sur l'image et tous ceux repérés : traduits en mots pour le modèle (`phraseDeVisageCible`). */
    visageCible?: BoiteDeVisage;
    visages?: BoiteDeVisage[];
    lumiere?: { azimut: number; elevation: number };
    typeDeLumiere?: string;
    /** Un angle nommé, ou la caméra du cube réglée à la main. */
    angle?: string | { horizontal: number; vertical: number; zoom: number };
    fin?: string;
    duree?: number;
    son?: boolean;
    mouvement?: string;
    orientation?: 'image' | 'video';
    /** « Reprendre ses gestes » : l'image du personnage qui refait les gestes de la vidéo. */
    image?: string;
  },
): Promise<{ ok: true; lot: string; medias: string[]; total: number | null } | { ok: false; raison: string }> {
  const card = store.getCard(cardId);
  const source = mediaParId(e.mediaId);
  if (!card || !source || source.cardId !== cardId) return { ok: false, raison: 'média introuvable sur cette carte' };
  if (!carteDeMedia(card)) return { ok: false, raison: 'cette carte n’est pas une création de média' };
  if (!passagesDuMedia(card).esquisses) return { ok: false, raison: 'la carte est encore au brief : passez d’abord aux esquisses' };
  const { cadrageDeLaCarte } = await import('./cadrage.js');
  const agentId = cadrageDeLaCarte(cardId)?.id ?? card.agentId ?? source.agentId ?? '';
  const capacite = capaciteDuPanneau(e.operation, source.genre);
  /* L'image de départ : celle du personnage pour des gestes repris, sinon la source elle-même, ou l'image d'où vient une séquence. */
  const image =
    e.operation === 'gestes' ? (e.image ? mediaParId(e.image) : null) : source.genre === 'video' && source.sourceId ? mediaParId(source.sourceId) : source;
  if (!image || image.genre !== 'image' || image.cardId !== cardId) return { ok: false, raison: e.operation === 'gestes' ? 'choisissez l’image du personnage qui reprend les gestes' : 'il faut une image de départ finie' };
  const consignes: Record<OperationDuPanneau, string> = {
    visage: 'Replace the face as described, keep everything else identical.',
    lumiere: 'Relight the image from the chosen direction, keep everything else identical.',
    angles: 'Show the same scene from the chosen camera angle, keep subject, style and lighting identical.',
    animer: image.demande.consigneOriginale ?? image.demande.consigne,
    gestes: 'The character reproduces the movements of the reference video.',
    consigne: '',
  };
  const consigne = String(e.consigne ?? '').trim() || consignes[e.operation];
  if (!consigne) return { ok: false, raison: 'écrivez la consigne' };
  const args: Record<string, unknown> = {
    action: 'devis',
    service: e.service,
    modele: e.modele,
    capacite,
    plan: image.plan,
    consigne,
    raison: 'Demandé depuis le menu « … » du média',
    source: image.id,
    variantes: e.variantes ?? PROPOSITIONS_MIN_D_UN_MEDIA,
    format: source.demande.format,
    ...(e.photos?.length ? { photos: e.photos } : {}),
    ...(e.operation === 'visage' && e.visageCible
      ? { cible: phraseDeVisageCible(e.visageCible, e.visages?.length ? e.visages : [e.visageCible]) }
      : e.cible
        ? { cible: e.cible }
        : {}),
    ...(e.lumiere ? { lumiere: e.lumiere } : {}),
    ...(e.typeDeLumiere ? { type_de_lumiere: e.typeDeLumiere } : {}),
    ...(e.angle ? { angle: e.angle } : {}),
    ...(e.fin ? { fin: e.fin } : {}),
    ...(e.duree ? { duree: e.duree } : {}),
    ...(typeof e.son === 'boolean' ? { son: e.son } : {}),
    ...(e.operation === 'gestes' ? { mouvement: source.id } : e.mouvement ? { mouvement: e.mouvement } : {}),
    ...(e.orientation ? { orientation: e.orientation } : {}),
  };
  const debut = Date.now();
  const devis = await realiser({ agentId, projectId: card.projectId, cardId }, args);
  if (!devis.ok) return { ok: false, raison: devis.text.replace(/^Refusé : /, '') };
  const crees = mediasDeLaCarte(cardId).filter((m) => m.creeLe >= debut && m.etat === 'devis' && m.plan === image.plan && !m.lotId);
  if (!crees.length) return { ok: false, raison: 'aucun devis n’a pu être préparé' };
  const libelles: Record<OperationDuPanneau, string> = {
    visage: 'Remplacer le visage',
    lumiere: 'Changer la lumière',
    angles: 'Autre angle',
    animer: 'Animer ce plan',
    gestes: 'Reprendre ses gestes',
    consigne: 'Redemander avec une consigne',
  };
  const titre = `${libelles[e.operation]} — ${image.plan}`.slice(0, 80);
  const lignes = crees.map((m) => ({ mediaId: m.id, plan: m.plan, service: m.service, modeleNom: m.modeleNom, capacite: m.capacite, prix: m.prix }));
  const lot = creerUnLot({ cardId, projectId: card.projectId, titre, etape: crees[0]!.etape ?? null, lignes });
  deciderDuLot(lot.id, true, 'Envoyé depuis le panneau du média (le prix était sur le bouton)');
  noterUnEvenement(cardId, 'panneau.envoye', { lot: lot.id, operation: e.operation, total: totalDuLot(lignes).connu });
  /* LA TRACE DANS LE FIL : une bulle de l'utilisateur, qui ne réveille pas le moteur. */
  const total = totalDuLot(lignes);
  const trace = Message.parse({
    id: store.newId(),
    agentId,
    role: 'user',
    content: `${libelles[e.operation]} · ${crees[0]!.modeleNom} · ${crees.length} variante${crees.length > 1 ? 's' : ''}${total.sansPrix ? '' : ` · ${arrondi(total.connu)} $`}${e.consigne?.trim() ? `\n${e.consigne.trim()}` : ''}`,
    attachments: source.attachmentId ? [source.attachmentId] : [],
    createdAt: store.now(),
  });
  if (agentId) {
    const ecrit = store.saveMessage(trace);
    bus.emit({ type: 'message.upsert', message: ecrit });
  }
  for (const m of crees) {
    await genererUnDevis(card, { agentId, projectId: card.projectId, cardId }, mediaParId(m.id) ?? m, (ms) => new Promise((fin) => setTimeout(fin, ms)));
  }
  return { ok: true, lot: lot.id, medias: crees.map((m) => m.id), total: total.sansPrix ? null : total.connu };
}
