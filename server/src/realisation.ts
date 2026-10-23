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
 * AUCUN APPEL PAYANT SANS DEVIS : « generer » ne part que depuis un devis de
 * la carte, après `decisionDeDepense` — refus sans budget ou au-delà du
 * budget, question d'accord BLOQUANTE (DEC-026) au-delà du seuil ou quand le
 * prix n'est pas publié. Un devis accepté une fois ne repose pas la question.
 *
 * LES FICHIERS vont sous `PATHS.medias/<projet>/<branche de la carte>/`
 * (disque de stockage), une version par essai d'un plan (`plan-v1`, `plan-v2`) ;
 * chacun est aussi joint au fil de la carte, où il se lit sur place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  AgentQuestion,
  IDS_SERVICES_CREATION,
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
  typesDeMediaDeLaRealisation,
  decisionDeDepense,
  decisionDApercu,
  estUnApercu,
  MODELE_DES_APERCUS,
  PHASES_DE_REALISATION,
  PREFIXE_DES_APERCUS,
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
  questionDAccordDeRealisation,
  questionDeBudget,
  ratioAjuste,
  requeteDeGeneration,
  serviceDeGeneration,
  texteSansAttente,
  type BudgetDeRealisation,
  type GenreDeMedia,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { getDb } from './db.js';
import { PATHS } from './config.js';
import { log } from './logger.js';
import { cleDuService, fabriquerClipChezLeService, plafondDuClip, servicesDeGenerationBranches } from './studio-services.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { annoncerUnMedia, terminerUnMedia } from './medias-en-fabrication.js';
import { cheminAbsoluDuDocument, lireLeDocumentDeRealisation } from './realisation-questionnaire.js';

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
  const fixe = card.parcours?.realisationBudget;
  if (fixe) return { budget: fixe.budget, seuil: fixe.seuil };
  const duDocument = budgetDuCahier(rubriquesDuDocumentDeRealisation(lireLeDocumentDeRealisation(card)?.texte));
  const duCahier = budgetDuCahier(card.parcours?.comprehension?.cahierDesCharges);
  return { budget: duDocument.budget ?? duCahier.budget, seuil: duDocument.seuil ?? duCahier.seuil };
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
        WHERE card_id = ? AND etat IN ('en-cours', 'fini') AND plan LIKE '${PREFIXE_DES_APERCUS}%'`,
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
  if (role === 'cadrage') {
    return consigneDuQuestionnaire({ medias: typesDeMediaDeLaRealisation(card.realisation), document, enveloppe: card.realisation?.enveloppe });
  }
  return consigneDeFabrication({
    ...budgetDeLaCarte(card),
    depense: depenseDeLaCarte(card.id),
    services: resumeDesServices(),
    document: lireLeDocumentDeRealisation(card) ? document : undefined,
  });
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
  service: IdServiceGeneration | 'montage';
  modele: string;
  modeleNom: string;
  demande: { consigne: string; format: FormatDeMedia; duree?: number; voix?: string; avatar?: string; son?: boolean };
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
    creeLe: r.cree_le,
    modifieLe: r.modifie_le,
  };
}

function enregistrer(m: MediaDeRealisation): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO medias_realisation
        (id, project_id, card_id, agent_id, branche, plan, version, capacite, genre, service, modele, modele_nom, demande, raison,
         prix, source_prix, cout_reel, etat, question_id, echec, fichier, taille, attachment_id, cree_le, modifie_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.id, m.projectId, m.cardId, m.agentId, m.branche, m.plan, m.version, m.capacite, m.genre, m.service, m.modele, m.modeleNom,
      JSON.stringify(m.demande), m.raison, m.prix, m.sourcePrix, m.coutReel, m.etat, m.questionId, m.echec, m.fichier, m.taille,
      m.attachmentId, m.creeLe, m.modifieLe,
    );
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

/** Le prix PUBLIÉ d'une génération : fal.ai seulement (vidéo et image), jamais deviné ailleurs. */
async function prixPublie(modele: ModeleDeGeneration, duree: number): Promise<number | null> {
  if (modele.prix !== 'api-fal') return null;
  if (modele.capacite === 'video') return plafondDuClip('fal', modele.id, duree);
  const cle = cleDuService('fal');
  if (!cle) return null;
  try {
    const { statut, corps } = await appeler({ methode: 'GET', adresse: `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(modele.id)}`, entetes: { Authorization: `Key ${cle}` } }, 15_000);
    if (statut !== 200) return null;
    return prixImageFal(corps?.prices?.find((p: any) => p.endpoint_id === modele.id));
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
  const cle = cleDuService(service);
  if (!cle) throw new Error(`${serviceDeGeneration(service)?.nom ?? service} n’est plus branché : sa clé a été retirée`);

  // LA VIDÉO DES SERVICES DU STUDIO passe par leur chemin éprouvé, inchangé.
  if (m.capacite === 'video' && (IDS_SERVICES_CREATION as readonly string[]).includes(service)) {
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

  const forme = requeteDeGeneration({ service, id: m.modele, capacite: m.capacite }, cle, m.demande);
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
  const fini = maj(m, { etat: 'fini', version, fichier, taille: data.length, attachmentId, ...(coutReel !== undefined ? { coutReel } : {}) });
  return fini;
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
      terminerUnMedia(m.id, { attachmentId: fini.attachmentId, ...(coutReel !== undefined ? { prix: coutReel } : {}) });
      log.info(`réalisation : « ${m.plan} » fabriqué (${m.modeleNom})`);
    } catch (err) {
      const raison = String((err as Error)?.message ?? err).slice(0, 400);
      terminerUnMedia(m.id, { echec: raison });
      maj(m, { etat: 'echec', echec: raison });
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

function questionPosee(forme: { question: string; description: string; options: { label: string; description: string }[] }): AgentQuestion {
  return AgentQuestion.parse({
    id: store.newId(),
    question: forme.question,
    description: forme.description,
    kind: 'single',
    options: forme.options.map((o, i) => ({ id: `o${i}`, ...o })),
    allowFreeText: true,
  });
}

function ligneDeMedia(m: MediaDeRealisation): string {
  const prix = m.coutReel ?? m.prix;
  return `- ${m.plan} v${m.version} — ${m.modeleNom} (${m.service}) — ${prix === null ? 'prix non publié' : `${arrondi(prix)} $`}${m.fichier ? ` — ${m.fichier}` : ''}`;
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

export async function realiser(ctx: ContexteRealisation, args: Record<string, unknown>, attente: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<ResultatRealisation> {
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  if (!card?.parcours?.realisationSouhaitee) return { ok: false, text: REFUS_MODE_ETEINT };
  const action = String(args.action ?? '');
  const budget = budgetDeLaCarte(card);
  const depense = depenseDeLaCarte(card.id);
  const etatDuBudget = `Budget : ${budget.budget === null ? 'non fixé' : `${budget.budget} $`} · dépensé : ${arrondi(depense)} $ · seuil d’accord : ${budget.seuil === null ? 'non fixé' : `${budget.seuil} $`}.`;

  switch (action) {
    case 'modeles': {
      const capacite = CAPACITES_DE_GENERATION.find((c) => c === args.capacite);
      const branches = servicesDeGenerationBranches();
      if (!branches.length) return { ok: true, text: 'Aucun service de génération n’est branché. L’utilisateur les branche dans Réglages › Services de création (HeyGen, ElevenLabs, fal.ai, Runway, OpenRouter…).' };
      const openrouter = branches.includes('openrouter') && (!capacite || capacite === 'image') ? await modelesOpenRouter() : [];
      const liste = modelesProposes(branches, capacite, openrouter).slice(0, 40);
      if (!liste.length) return { ok: true, text: `Aucun modèle branché ne sait faire « ${capacite} ». Services branchés : ${branches.join(', ')}.` };
      return {
        ok: true,
        text: [
          `Modèles disponibles${capacite ? ` (${capacite})` : ''}, la meilleure qualité d’abord (notes du ${DATE_DES_NOTES}) :`,
          ...liste.map(
            (m) =>
              `- service « ${m.service} », modèle « ${m.id} » — ${m.nom} [${m.capacite}] qualité ${m.qualite}/5 : ${m.usage}${m.durees ? ` · durées ${m.durees[0]}–${m.durees[m.durees.length - 1]} s` : ''}${m.son ? ' · avec son' : ''} · prix : ${m.prix === 'api-fal' ? 'publié (donné au devis)' : m.prix === 'cout-reel-openrouter' ? 'aux jetons, coût réel relevé après' : 'non publié (accord demandé)'}`,
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
      if (!servicesDeGenerationBranches().includes(service)) return { ok: false, text: `Le service « ${service} » n’est pas branché. Consulte « modeles ».` };
      const openrouter = service === 'openrouter' ? await modelesOpenRouter() : [];
      const modele = modeleDeGeneration(service, id, openrouter);
      if (!modele) return { ok: false, text: `Le modèle « ${id} » n’est pas au catalogue de ${service}. Consulte « modeles ».` };
      if ((modele.capacite === 'voix' || modele.capacite === 'avatar') && !String(args.voix ?? '').trim()) return { ok: false, text: 'Il faut une « voix » (identifiant lu avec l’action « voix »).' };
      if (modele.capacite === 'avatar' && !String(args.avatar ?? '').trim()) return { ok: false, text: 'Il faut un « avatar » (identifiant lu avec l’action « voix », service heygen).' };
      const format = FORMATS.find((f) => f === args.format) ?? '16:9';
      const duree = Number(args.duree);
      const demande = {
        consigne,
        format,
        ...(Number.isFinite(duree) && duree > 0 ? { duree } : {}),
        ...(typeof args.voix === 'string' && args.voix.trim() ? { voix: args.voix.trim() } : {}),
        ...(typeof args.avatar === 'string' && args.avatar.trim() ? { avatar: args.avatar.trim() } : {}),
        ...(typeof args.son === 'boolean' ? { son: args.son } : {}),
      };
      const prix = await prixPublie(modele, Number.isFinite(duree) && duree > 0 ? (modele.durees ? dureeAjustee({ durees: modele.durees } as any, duree) : duree) : (modele.durees?.[0] ?? 5));
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
        creeLe: maintenant,
        modifieLe: maintenant,
      };
      enregistrer(m);
      const decision = decisionDeDepense({ prix, depense, ...budget });
      const suite =
        decision.verdict === 'refus'
          ? `Lancement impossible en l’état : ${decision.raison}`
          : decision.verdict === 'accord'
            ? `« generer » posera la question d’accord : ${decision.raison}`
            : '« generer » partira directement (sous le seuil).';
      return {
        ok: true,
        text: [
          `Devis « ${m.id} » — ${plan}.`,
          `Écris d’abord dans ta réponse : 🎬 ${plan} — ${modele.nom} (${serviceDeGeneration(service)?.nom ?? service}) — ${libelleDuPrix(prix, modele.prix)} — ${raison}`,
          suite,
          etatDuBudget,
        ].join('\n'),
      };
    }

    case 'generer': {
      const m = mediaParId(String(args.devis ?? ''));
      if (!m || m.cardId !== card.id) return { ok: false, text: 'Devis introuvable sur cette carte : fais d’abord un « devis ».' };
      if (m.etat === 'en-cours') return { ok: true, text: `Ce devis est déjà lancé : « suivre » avec l’identifiant « ${m.id} ».` };
      if (m.etat === 'fini') return { ok: false, text: 'Ce devis a déjà été fabriqué : pour refaire le plan, fais un nouveau devis (version suivante).' };
      if (m.etat === 'refuse') return { ok: false, text: 'L’utilisateur a refusé ce devis : propose autre chose (un autre modèle, moins cher).' };
      const decision = decisionDeDepense({ prix: m.prix, depense, ...budget });
      if (decision.verdict === 'refus') return { ok: false, text: `Refusé : ${decision.raison}` };
      if (decision.verdict === 'accord') {
        const reponse = m.questionId ? reponseALaQuestion(m.agentId, m.questionId) : undefined;
        if (m.questionId && reponse !== undefined) {
          if (!accordDeRealisationDonne(reponse)) {
            maj(m, { etat: 'refuse' });
            return { ok: false, text: `L’utilisateur n’a pas donné son accord (« ${reponse} ») : rien n’est lancé. Propose autre chose.` };
          }
        } else {
          const service = serviceDeGeneration(m.service)?.nom ?? m.service;
          const question = questionPosee(
            questionDAccordDeRealisation({
              modele: m.modeleNom,
              service,
              prixLibelle: libelleDuPrix(m.prix, m.sourcePrix as SourceDuPrix),
              raison: m.raison,
              motif: decision.raison.replace(/^le /, 'le '),
              depense,
              budget: budget.budget,
              plan: m.plan,
            }),
          );
          maj(m, { questionId: question.id });
          return { ok: true, text: texteSansAttente(), question };
        }
      }
      if (!fs.existsSync(PATHS.medias) && !(() => {
        try {
          fs.mkdirSync(PATHS.medias, { recursive: true });
          return true;
        } catch {
          return false;
        }
      })()) {
        return { ok: false, text: `Le dossier des médias (${PATHS.medias}) est inaccessible : le disque de stockage est peut-être démonté. Rien n’est lancé.` };
      }
      const lance = maj(m, { etat: 'en-cours' });
      lancer(lance, attente);
      return { ok: true, text: `Génération « ${m.id} » lancée (${m.modeleNom}). Attends le résultat avec « suivre » (une vidéo prend plusieurs minutes).` };
    }

    case 'suivre': {
      const id = String(args.id ?? args.devis ?? '');
      let m = mediaParId(id);
      if (!m || m.cardId !== card.id) return { ok: false, text: 'Génération introuvable sur cette carte.' };
      if (m.etat === 'en-cours') {
        const travail = enVol.get(m.id);
        if (!travail) {
          m = maj(m, { etat: 'echec', echec: 'interrompue par un redémarrage du serveur : elle a peut-être été facturée — vérifie le compte chez le service avant de relancer' });
        } else {
          await Promise.race([travail, attente(RYTHME_REALISATION.attenteSuiviMs)]);
          m = mediaParId(id)!;
        }
      }
      if (m.etat === 'en-cours') return { ok: true, text: `Toujours en cours (${m.modeleNom}) : rappelle « suivre » avec « ${m.id} ».` };
      if (m.etat === 'echec') return { ok: false, text: `Échec de « ${m.plan} » : ${m.echec ?? 'sans raison'}. Tu peux refaire un devis (autre modèle ou consigne revue).` };
      if (m.etat !== 'fini') return { ok: false, text: `Ce devis n’a pas été lancé (état : ${m.etat}).` };
      const attachment = m.attachmentId ? store.getAttachment(m.attachmentId) : null;
      return {
        ok: true,
        text: `« ${m.plan} » v${m.version} prêt : ${m.fichier}${m.coutReel !== null ? ` (coût réel ${arrondi(m.coutReel)} $)` : ''}. Il paraît dans le fil. Regarde-le (lis le fichier) avant de passer au plan suivant.\n${`Dépensé : ${arrondi(depenseDeLaCarte(card.id))} $${budget.budget !== null ? ` sur ${budget.budget} $` : ''}.`}`,
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
          `Total dépensé : ${arrondi(depenseDeLaCarte(card.id))} $${budget.budget !== null ? ` sur un budget de ${budget.budget} $` : ''}.`,
          finis.length ? `Dossier : ${path.dirname(finis[0]!.fichier ?? '')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    case 'monter': {
      const ecrite = poserLeMontage(card);
      return {
        ok: true,
        text: `Montage annoncé${ecrite ? '' : ' (déjà)'} : l’étape « Montage » est allumée sur le chemin du tournage. Assemble, puis range le fichier monté avec l’action « ajouter ».`,
      };
    }

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
        creeLe: maintenant,
        modifieLe: maintenant,
      };
      enregistrer(m);
      /* Le repli : un agent qui range son montage sans l'avoir annoncé allume quand même l'étape. */
      poserLeMontage(card);
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

    default:
      return { ok: false, text: 'Action inconnue. Actions : modeles, voix, devis, generer, suivre, lister, monter, ajouter, fixer_budget.' };
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
): Promise<ResultatRealisation> {
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  if (!card?.parcours?.realisationSouhaitee) return { ok: false, text: REFUS_MODE_ETEINT };
  const realisation = realisationDeLaCarte(card);
  const consigne = String(args.consigne ?? '').trim();
  if (!consigne) return { ok: false, text: 'Il faut « consigne » : la demande complète au modèle d’image (en anglais), une seule proposition par aperçu.' };
  const phase = (PHASES_DE_REALISATION as readonly string[]).includes(String(args.phase)) ? (args.phase as PhaseDeRealisation) : realisation.phase;
  const legende = String(args.legende ?? '').trim().slice(0, 80);
  const service = MODELE_DES_APERCUS.service;
  if (!servicesDeGenerationBranches().includes(service)) {
    return { ok: false, text: 'fal.ai n’est pas branché : pas d’aperçu possible. Continue avec des choix décrits en mots (l’utilisateur branche fal.ai dans Réglages › Services de création).' };
  }
  const modele = modeleDeGeneration(service, String(args.modele ?? '') || MODELE_DES_APERCUS.id) ?? modeleDeGeneration(service, MODELE_DES_APERCUS.id);
  if (!modele || modele.capacite !== 'image') return { ok: false, text: 'Un aperçu est une IMAGE : choisis un modèle d’image de fal.ai (par défaut FLUX Schnell).' };
  const prix = await prixPublie(modele, 0);
  const depense = depenseDesApercus(card.id);
  const decision = decisionDApercu({ enveloppe: realisation.enveloppe, prix, depense });
  if (decision.verdict === 'refus') return { ok: false, text: `Aperçu refusé : ${decision.raison}` };
  if (!fs.existsSync(PATHS.medias)) {
    try {
      fs.mkdirSync(PATHS.medias, { recursive: true });
    } catch {
      return { ok: false, text: `Le dossier des médias (${PATHS.medias}) est inaccessible : le disque de stockage est peut-être démonté. Rien n’est lancé.` };
    }
  }
  const rang = mediasDeLaCarte(card.id).filter((m) => estUnApercu(m.plan) && m.plan.startsWith(`${PREFIXE_DES_APERCUS}${phase}-`)).length + 1;
  const format = FORMATS.find((f) => f === args.format) ?? '1:1';
  const maintenant = Date.now();
  const m: MediaDeRealisation = {
    id: store.newId(),
    projectId: card.projectId,
    cardId: card.id,
    agentId: ctx.agentId,
    branche: null,
    plan: `${PREFIXE_DES_APERCUS}${phase}-${rang}`,
    version: 0,
    capacite: 'image',
    genre: genreDuMedia('image'),
    service,
    modele: modele.id,
    modeleNom: modele.nom,
    demande: { consigne, format },
    raison: legende || 'aperçu du questionnaire',
    prix,
    sourcePrix: modele.prix,
    coutReel: null,
    etat: 'en-cours',
    questionId: null,
    echec: null,
    fichier: null,
    taille: null,
    attachmentId: null,
    creeLe: maintenant,
    modifieLe: maintenant,
  };
  enregistrer(m);
  lancer(m, attente);
  await Promise.race([enVol.get(m.id), attente(RYTHME_REALISATION.attenteSuiviMs)]);
  const fini = mediaParId(m.id);
  const reste = arrondi(Math.max(0, (realisation.enveloppe ?? 0) - depenseDesApercus(card.id)));
  if (fini?.etat === 'fini' && fini.attachmentId) {
    return {
      ok: true,
      text: `Aperçu prêt (${arrondi(fini.coutReel ?? fini.prix ?? 0)} $, reste ${reste} $ dans l’enveloppe) : pièce « ${fini.attachmentId} »${legende ? ` — ${legende}` : ''}. Pour un choix en images, passe cet identifiant dans « image » d’une option d’« ask_user ». Le choix retenu rejoint seul le tableau d’ambiance.`,
    };
  }
  if (fini?.etat === 'en-cours') return { ok: false, text: 'L’aperçu tarde : il paraîtra dans le fil dès qu’il sera prêt. Pose ta question en mots en attendant.' };
  return { ok: false, text: `L’aperçu a échoué : ${fini?.echec ?? 'raison inconnue'}. Continue avec des choix décrits en mots.` };
}
