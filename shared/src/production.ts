/**
 * LE SOCLE D'UNE PRODUCTION DU STUDIO CRÉATIF (chantier « Beluga Creative
 * Studio », carte 1 sur 5, 24/10/2026) — règles PURES, sans base ni disque.
 *
 * Trois sujets, tous lus par `server/src/production.ts` et par l'écran :
 *
 *  1. LA MÉMOIRE D'UNE PRODUCTION : chaque pièce écrite (brief, concept,
 *     scénario, scène, plan, personnage, référence de style) est un ÉLÉMENT
 *     VERSIONNÉ, repéré par une clé stable (« plan-2 ») ; une retouche écrit la
 *     version suivante et garde l'ancienne (`remplace`). L'état d'une production
 *     se reconstruit depuis la base, jamais en relisant la conversation.
 *
 *  2. LE DEVIS PAR LOT (décision de l'utilisateur du 24/10/2026) : toute
 *     génération payante appartient à un LOT validé d'un clic dans la
 *     conversation. Le lot est une LISTE FERMÉE d'opérations : une opération
 *     hors liste redemande un lot. Chaque opération passe par
 *     prévue → réservée → débitée, ou → libérée en cas d'échec ; sa clé
 *     d'idempotence empêche qu'une reprise lance deux fois le même appel.
 *     Montants en DOLLARS seulement, jamais convertis ; un prix non publié se dit.
 *
 *  3. LE VOLET DE SUIVI (`etapesDuSuivi`) et LE BRANCHEMENT DES SERVICES
 *     depuis la conversation (`servicesPourLesCapacites`).
 *
 * Les cartes suivantes du chantier s'y branchent : la carte 2 (responsable
 * créatif) écrit les éléments et leurs validations ; la carte 3 (montage) pose
 * les étapes Montage et Export ; la carte 4 remplit les méthodes créatives.
 * Architecture : `docs/mecaniques/creative-studio.md`.
 */

import { z } from 'zod';
import { COLONNES_AVANT_LE_TRAVAIL } from './columns.js';
import {
  PHASES_DE_REALISATION,
  PREFIXE_DES_APERCUS,
  arrondi,
  typesDeMediaDeLaRealisation,
  type EtatDeRealisation,
  type PhaseDeRealisation,
  type TypeDeMediaDeRealisation,
} from './mode-realisation.js';
import type { CapaciteDeGeneration, IdServiceGeneration } from './services-de-generation.js';
import type { MesureDeMedia } from './retouches-de-media.js';

/* ------------------------------------------------------------------ */
/* 1. Les éléments versionnés                                           */
/* ------------------------------------------------------------------ */

export const GENRES_D_ELEMENT = ['brief', 'concept', 'script', 'scene', 'plan', 'personnage', 'reference'] as const;
export type GenreDElement = (typeof GENRES_D_ELEMENT)[number];

/**
 * `propose` : écrit par l'agent, pas encore soumis ; `a-valider` : soumis à
 * l'utilisateur ; `valide` / `refuse` : sa réponse ; `remplace` : une version
 * plus récente existe (l'ancienne reste lisible).
 */
export const ETATS_D_ELEMENT = ['propose', 'a-valider', 'valide', 'refuse', 'remplace'] as const;
export type EtatDElement = (typeof ETATS_D_ELEMENT)[number];

export const ElementDeProduction = z.object({
  id: z.string(),
  cardId: z.string(),
  projectId: z.string(),
  genre: z.enum(GENRES_D_ELEMENT),
  /** La clé STABLE d'un élément, commune à toutes ses versions (« plan-2 », « brief »). */
  cle: z.string(),
  version: z.number().int().positive(),
  titre: z.string(),
  /** Le texte de l'élément (Markdown court). */
  contenu: z.string(),
  etat: z.enum(ETATS_D_ELEMENT),
  /** L'élément dont celui-ci dépend (le plan d'une scène, la scène d'un plan). */
  parent: z.string().nullable().default(null),
  creeLe: z.number(),
  /**
   * QUI A ÉCRIT CETTE VERSION (« agent », « utilisateur » pour un retour à une
   * version depuis le suivi). Lu dans le journal (`production_evenements`) :
   * la table des éléments n'a pas de colonne pour lui.
   */
  auteur: z.string().nullable().optional(),
});
export type ElementDeProduction = z.infer<typeof ElementDeProduction>;

/** Une clé d'élément sûre : minuscules, chiffres et tirets, 60 signes au plus. */
export function cleDElement(brut: unknown, genre: GenreDElement): string {
  const s = String(brut ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || genre;
}

/** Les versions COURANTES : la plus récente de chaque clé, dans l'ordre de naissance de la clé. */
export function elementsCourants(elements: readonly ElementDeProduction[]): ElementDeProduction[] {
  const parCle = new Map<string, ElementDeProduction>();
  const ordre: string[] = [];
  for (const e of [...elements].sort((a, b) => a.creeLe - b.creeLe || a.version - b.version)) {
    if (!parCle.has(e.cle)) ordre.push(e.cle);
    const avant = parCle.get(e.cle);
    if (!avant || e.version > avant.version) parCle.set(e.cle, e);
  }
  return ordre.map((c) => parCle.get(c)!);
}

/* ------------------------------------------------------------------ */
/* 2. Le devis par lot et le budget                                    */
/* ------------------------------------------------------------------ */

export const ETATS_DE_LOT = ['propose', 'valide', 'refuse'] as const;
export type EtatDeLot = (typeof ETATS_DE_LOT)[number];

export const ETATS_D_OPERATION = ['prevue', 'reservee', 'debitee', 'liberee'] as const;
export type EtatDOperation = (typeof ETATS_D_OPERATION)[number];

export const OperationDeLot = z.object({
  id: z.string(),
  lotId: z.string(),
  /** Le devis (ligne de `medias_realisation`) que l'opération autorise. */
  mediaId: z.string(),
  plan: z.string(),
  service: z.string(),
  modeleNom: z.string(),
  capacite: z.string(),
  /** Le prix annoncé ; `null` = prix non publié par le service. */
  prix: z.number().nullable(),
  etat: z.enum(ETATS_D_OPERATION),
  montantReserve: z.number().default(0),
  montantDebite: z.number().nullable().default(null),
  /** La clé d'idempotence : un même lot et un même devis ne partent qu'une fois. */
  cle: z.string(),
  majLe: z.number(),
});
export type OperationDeLot = z.infer<typeof OperationDeLot>;

export const LotDeDevis = z.object({
  id: z.string(),
  cardId: z.string(),
  projectId: z.string(),
  titre: z.string(),
  /** L'étape du suivi que le lot sert (« plans », « son »…), pour le volet. */
  etape: z.string().nullable().default(null),
  etat: z.enum(ETATS_DE_LOT),
  questionId: z.string().nullable().default(null),
  creeLe: z.number(),
  decideLe: z.number().nullable().default(null),
  operations: z.array(OperationDeLot).default([]),
});
export type LotDeDevis = z.infer<typeof LotDeDevis>;

/** La clé d'idempotence d'une opération : le lot et le devis, rien d'autre. */
export function cleDIdempotence(lotId: string, mediaId: string): string {
  return `lot:${lotId}:devis:${mediaId}`;
}

/** Le total d'un lot : ce qui est chiffré, et combien de lignes n'ont pas de prix publié. */
export function totalDuLot(operations: readonly Pick<OperationDeLot, 'prix'>[]): { connu: number; sansPrix: number } {
  let connu = 0;
  let sansPrix = 0;
  for (const o of operations) {
    if (o.prix === null) sansPrix += 1;
    else connu += o.prix;
  }
  return { connu: Math.round(connu * 1e4) / 1e4, sansPrix };
}

export type DecisionDuLot = { verdict: 'refus'; raison: string } | { verdict: 'a-valider' } | { verdict: 'auto' };

/**
 * LA MARGE DE RÉPARATION (décision de l'utilisateur du 25/10/2026) : le prix
 * accordé à l'arrêt 2 du directeur artistique, plus 30 %. Dans cette marge, un
 * réessai ou un changement de modèle après une panne part SANS nouvelle
 * question ; au-delà, l'accord est redemandé.
 */
export const MARGE_DE_REPARATION = 0.3;

/** Le plafond de dépense d'une fabrication accordée : le prix annoncé, marge comprise, au centime. */
export function plafondDeFabrication(prixAccorde: number): number {
  return Math.round(Math.max(0, prixAccorde) * (1 + MARGE_DE_REPARATION) * 100) / 100;
}

/**
 * UN LOT PEUT-IL ÊTRE PROPOSÉ ? Il faut un budget, et que ce qui est chiffré
 * tienne dans ce qui reste. Une ligne sans prix publié n'empêche pas de
 * proposer : la validation de l'utilisateur vaut alors accord, en connaissance
 * de cause.
 *
 * `auto` (25/10/2026) : la fabrication a reçu l'accord de l'arrêt 2
 * (`accordDeFabrication`), toutes les lignes ont un prix publié et le lot tient
 * dans ce qui reste du plafond (prix accordé + marge) — il part d'office, tracé
 * au journal de production. Un prix non publié repose toujours la question
 * (DEC-385) : on ne sait pas s'il tient dans la marge.
 */
export function decisionDuLot(e: { total: number; budget: number | null; depense: number; sansPrix?: number; accordDeFabrication?: boolean }): DecisionDuLot {
  if (e.budget === null) return { verdict: 'refus', raison: 'aucun budget n’est fixé : fixe-le d’abord (action « fixer_budget »).' };
  const reste = e.budget - e.depense;
  if (e.total > reste + 1e-9) {
    if (e.accordDeFabrication) return { verdict: 'a-valider' };
    return { verdict: 'refus', raison: `le lot coûte ${arrondi(e.total)} $ et il ne reste que ${arrondi(Math.max(0, reste))} $ sur le budget de ${e.budget} $.` };
  }
  if (e.accordDeFabrication && !(e.sansPrix ?? 0)) return { verdict: 'auto' };
  return { verdict: 'a-valider' };
}

/**
 * QUE FAIRE APRÈS UNE PANNE DE FABRICATION (25/10/2026) ? Réessayer le même
 * modèle une fois, puis passer à un modèle équivalent de même capacité — tant
 * que le nouvel essai tient dans ce qui reste du plafond. Sinon, ou après trois
 * essais ratés pour ce plan, demander à l'utilisateur.
 */
export const ESSAIS_DE_REPARATION_MAX = 3;

export function issueDePanne(e: { echecsDuPlan: number; prix: number | null; reste: number | null }): 'reessayer' | 'autre-modele' | 'demander' {
  if (e.echecsDuPlan >= ESSAIS_DE_REPARATION_MAX) return 'demander';
  if (e.reste === null || e.prix === null || e.prix > e.reste + 1e-9) return 'demander';
  return e.echecsDuPlan <= 1 ? 'reessayer' : 'autre-modele';
}

/**
 * UNE GÉNÉRATION PEUT-ELLE PARTIR ? La porte de `generer`, appliquée à un devis :
 *  - `hors-lot` : le devis n'appartient à aucun lot validé (il faut en proposer un) ;
 *  - `attente` : son lot attend la réponse de l'utilisateur ;
 *  - `refuse` : son lot a été refusé ;
 *  - `deja` : l'opération est déjà réservée ou débitée (reprise : on ne relance pas) ;
 *  - `liberee` : elle a échoué, il faut un nouveau devis ;
 *  - `partir` : l'opération est prévue dans un lot validé.
 */
export type PorteDeGeneration = 'hors-lot' | 'attente' | 'refuse' | 'deja' | 'liberee' | 'partir';

export function porteDeGeneration(lot: Pick<LotDeDevis, 'etat' | 'operations'> | null, mediaId: string): PorteDeGeneration {
  if (!lot) return 'hors-lot';
  const op = lot.operations.find((o) => o.mediaId === mediaId);
  if (!op) return 'hors-lot';
  if (lot.etat === 'propose') return 'attente';
  if (lot.etat === 'refuse') return 'refuse';
  if (op.etat === 'reservee' || op.etat === 'debitee') return 'deja';
  if (op.etat === 'liberee') return 'liberee';
  return 'partir';
}

/** Une réservation tient-elle dans le budget ? Le serveur la juge, jamais l'agent. */
export function reservationPossible(e: { montant: number; budget: number | null; depense: number }): { ok: true } | { ok: false; raison: string } {
  if (e.budget === null) return { ok: false, raison: 'aucun budget n’est fixé' };
  if (e.depense + e.montant > e.budget + 1e-9) {
    return { ok: false, raison: `le budget de ${e.budget} $ serait dépassé (${arrondi(e.depense)} $ déjà engagés, ${arrondi(e.montant)} $ demandés)` };
  }
  return { ok: true };
}

/** Les deux réponses de la question d'un lot. */
export const REPONSE_VALIDER_LE_LOT = 'Valider le devis';
export const REPONSE_REFUSER_LE_LOT = 'Refuser';

/** La réponse donnée vaut-elle validation ? « Valider » (ou « Lancer », « Accepter », « Oui »), complément libre toléré. */
export function lotValideParLaReponse(reponse: string | undefined): boolean {
  return /^\s*(valider|lancer|accepter|oui|g[ée]n[ée]rer)(?![a-zà-ÿ])/i.test(reponse ?? '');
}

/** Le bouton d'une génération d'une création de média : son prix dessus, un clic vaut accord (26/10/2026). */
export const REPONSE_GENERER_LE_LOT = 'Générer';

/**
 * LE RÉESSAI D'OFFICE D'UNE CRÉATION DE MÉDIA (décision de l'utilisateur du
 * 26/10/2026) : une génération tombée en panne SANS être facturée se retente
 * UNE fois, au même modèle et au même prix, sans nouveau clic ; tout autre
 * modèle, tout autre prix, ou un second réessai repasse par le bouton à prix.
 */
export function reessaiDOfficePermis(e: {
  rate: { etat: string; coutReel: number | null; modele: string; prix: number | null; plan: string };
  devis: readonly { modele: string; prix: number | null; plan: string }[];
  dejaReessaye: boolean;
}): { ok: true } | { ok: false; raison: string } {
  if (e.rate.etat !== 'echec') return { ok: false, raison: 'le média désigné n’est pas en panne' };
  if (e.rate.coutReel !== null && e.rate.coutReel > 0) return { ok: false, raison: 'la génération ratée a été facturée : le réessai repasse par le bouton à prix' };
  if (e.dejaReessaye) return { ok: false, raison: 'cette génération a déjà été retentée une fois : la suite repasse par le bouton à prix' };
  if (!e.devis.length) return { ok: false, raison: 'aucun devis à retenter' };
  for (const d of e.devis) {
    if (d.modele !== e.rate.modele) return { ok: false, raison: 'un autre modèle repasse par le bouton à prix' };
    if ((d.prix ?? null) !== (e.rate.prix ?? null)) return { ok: false, raison: 'un autre prix repasse par le bouton à prix' };
    if (d.plan !== e.rate.plan) return { ok: false, raison: 'le réessai porte sur le même média, rien d’autre' };
  }
  return { ok: true };
}

/** Ce que le bloc « Devis » montre dans la conversation : une ligne par opération, le total et le budget. */
export const DevisDeLaQuestion = z.object({
  lotId: z.string(),
  titre: z.string(),
  lignes: z.array(z.object({ plan: z.string(), modele: z.string(), service: z.string(), prix: z.number().nullable() })),
  total: z.number(),
  sansPrix: z.number().int().nonnegative(),
  budget: z.number().nullable(),
  depense: z.number(),
  /**
   * UNE GÉNÉRATION D'UNE CRÉATION DE MÉDIA (26/10/2026) : le devis porte son
   * propre bouton « Générer · prix » — un clic vaut accord et lance le lot.
   */
  bouton: z.boolean().optional(),
});
export type DevisDeLaQuestion = z.infer<typeof DevisDeLaQuestion>;

/** La question d'un lot : son intitulé, sa description, ses deux choix et le bloc « Devis ». */
export function questionDuLotDeDevis(e: {
  lotId: string;
  titre: string;
  lignes: DevisDeLaQuestion['lignes'];
  budget: number | null;
  depense: number;
}): { question: string; description: string; options: { label: string; description: string }[]; devis: DevisDeLaQuestion } {
  const { connu, sansPrix } = totalDuLot(e.lignes);
  const montant = `${arrondi(connu)} $${sansPrix ? ` + ${sansPrix} ligne${sansPrix > 1 ? 's' : ''} au prix non publié` : ''}`;
  const reste = e.budget === null ? '' : ` Budget : ${arrondi(e.depense)} $ engagés sur ${e.budget} $.`;
  return {
    question: `Valider le devis « ${e.titre} » (${montant}) ?`,
    description: `${e.lignes.length} génération${e.lignes.length > 1 ? 's' : ''} payante${e.lignes.length > 1 ? 's' : ''}, détaillée${e.lignes.length > 1 ? 's' : ''} ci-dessous. Seules ces opérations partiront ; toute autre redemandera votre accord.${sansPrix ? ' Une ligne au prix non publié sera facturée par le service au tarif de votre compte.' : ''}${reste}`,
    options: [
      { label: REPONSE_VALIDER_LE_LOT, description: 'Ces générations partent ; le montant est réservé sur le budget.' },
      { label: REPONSE_REFUSER_LE_LOT, description: 'Rien n’est dépensé ; l’agent propose autre chose.' },
    ],
    devis: { lotId: e.lotId, titre: e.titre, lignes: e.lignes, total: connu, sansPrix, budget: e.budget, depense: e.depense },
  };
}

/** La ligne d'une validation de génération : « Nano Banana Pro · 2 brouillons » (plus le prix non publié s'il y en a). */
export function descriptionDUneGeneration(lignes: DevisDeLaQuestion['lignes']): string {
  const n = lignes.length;
  const modeles = [...new Set(lignes.map((l) => l.modele).filter(Boolean))].join(' + ');
  const sansPrix = lignes.filter((l) => l.prix === null).length;
  return [modeles, `${n} brouillon${n > 1 ? 's' : ''}`, sansPrix ? `${sansPrix} au prix non publié` : ''].filter(Boolean).join(' · ');
}

/**
 * UNE VALIDATION DE GÉNÉRATION N'ARRÊTE PAS L'AGENT (27/10/2026). Le bouton
 * « Valider · prix » d'une création de média se tranche côté démon, au clic
 * (`trancherLeLotDuClic`), sans réponse à rendre à un tour : plusieurs
 * peuvent donc rester ouvertes à la fois — une par plan, posées d'un coup — et
 * aucune ne ferme la barre d'écriture. Toute autre question bloque (DEC-026).
 */
export function validationNonBloquante(question: { devis?: { bouton?: boolean } | null } | null | undefined): boolean {
  return !!question?.devis?.bouton;
}

/**
 * LA QUESTION D'UNE GÉNÉRATION D'UNE CRÉATION DE MÉDIA (26/10/2026) : pas de
 * choix à cocher, le devis porte son bouton « Valider · prix » — un clic vaut
 * accord et lance la génération ; « Refuser » ne dépense rien.
 *
 * ALLÉGÉE (27/10/2026) : un titre, UNE ligne de description (le modèle et le
 * nombre de brouillons), le prix dans le bouton. Plus de tableau de devis ni
 * de mode d'emploi : pour changer quelque chose, on l'écrit dans le champ
 * principal de la conversation.
 */
export function questionDUneGeneration(e: {
  lotId: string;
  titre: string;
  lignes: DevisDeLaQuestion['lignes'];
  depense: number;
}): { question: string; description: string; options: { label: string; description: string }[]; devis: DevisDeLaQuestion } {
  const { connu, sansPrix } = totalDuLot(e.lignes);
  const n = e.lignes.length;
  return {
    question: `Générer « ${e.titre} » ?`,
    description: descriptionDUneGeneration(e.lignes),
    options: [],
    devis: { lotId: e.lotId, titre: e.titre, lignes: e.lignes, total: connu, sansPrix, budget: null, depense: e.depense, bouton: true },
  };
}

/* ------------------------------------------------------------------ */
/* 3. Le branchement des services depuis la conversation                */
/* ------------------------------------------------------------------ */

/**
 * Ce que chaque type de média demande comme capacité de génération. UNE VIDÉO
 * COMPREND TOUT (24/10/2026) : les images de ses plans, leur animation, la
 * voix, la musique et les bruitages — le branchement et les devis le savent
 * sans que l'utilisateur ait coché quoi que ce soit d'autre.
 */
const CAPACITES_DU_TYPE: Record<TypeDeMediaDeRealisation, CapaciteDeGeneration[]> = {
  image: ['image'],
  video: ['image', 'video', 'voix', 'musique', 'son'],
  musique: ['musique'],
  voix: ['voix'],
  bruitages: ['son'],
  son: ['voix', 'musique', 'son'],
};

export function capacitesDesTypes(types: readonly TypeDeMediaDeRealisation[]): CapaciteDeGeneration[] {
  return [...new Set(types.flatMap((t) => CAPACITES_DU_TYPE[t] ?? []))];
}

/** Les capacités qu'aucun service branché ne couvre. `couvertes` : les capacités des modèles branchés. */
export function capacitesSansService(voulues: readonly CapaciteDeGeneration[], couvertes: readonly CapaciteDeGeneration[]): CapaciteDeGeneration[] {
  return voulues.filter((c) => !couvertes.includes(c));
}

export interface ServiceConseille {
  id: IdServiceGeneration;
  /** `recommande` : kie.ai, un seul compte aux prix publiés ; `economique` : Higgsfield pour la vidéo (caché depuis le 25/10/2026). */
  rang: 'recommande' | 'economique' | 'autre';
  capacites: CapaciteDeGeneration[];
}

/**
 * LES SERVICES À PROPOSER POUR DES CAPACITÉS (décision de l'utilisateur du
 * 24/10/2026) : fal.ai en tête (un seul compte, prix publiés, devis exacts),
 * Higgsfield ensuite quand il faut de la vidéo (moins cher), puis les autres
 * services du catalogue qui savent faire, repliés à l'écran. `catalogue` : les
 * capacités de chaque service, lues dans le catalogue de génération.
 */
export function servicesPourLesCapacites(
  voulues: readonly CapaciteDeGeneration[],
  catalogue: readonly { service: IdServiceGeneration; capacite: CapaciteDeGeneration }[],
): ServiceConseille[] {
  const parService = new Map<IdServiceGeneration, Set<CapaciteDeGeneration>>();
  for (const m of catalogue) {
    if (!voulues.includes(m.capacite)) continue;
    const s = parService.get(m.service) ?? new Set<CapaciteDeGeneration>();
    s.add(m.capacite);
    parService.set(m.service, s);
  }
  const liste: ServiceConseille[] = [];
  const poser = (id: IdServiceGeneration, rang: ServiceConseille['rang']) => {
    const capacites = parService.get(id);
    if (!capacites || liste.some((s) => s.id === id)) return;
    liste.push({ id, rang, capacites: voulues.filter((c) => capacites.has(c)) });
  };
  /* kie.ai en tête depuis le 25/10/2026 (fal.ai et Higgsfield cachés : le catalogue passé ne les porte plus). */
  poser('kie', 'recommande');
  poser('fal', 'recommande');
  if (voulues.includes('video')) poser('higgsfield', 'economique');
  /* Les autres : celui qui couvre le plus de capacités d'abord, l'ordre du catalogue sinon. */
  const autres = [...parService.keys()].filter((id) => !liste.some((s) => s.id === id));
  autres.sort((a, b) => parService.get(b)!.size - parService.get(a)!.size);
  for (const id of autres) poser(id, 'autre');
  return liste;
}

/** La réponse que l'encadré envoie seul quand un service vient d'être branché. */
export function reponseDeBranchement(nom: string): string {
  return `Service branché : ${nom}`;
}

/** Repère de la réponse « je continue sans brancher ». */
export const REPONSE_SANS_BRANCHEMENT = 'Continuer sans brancher';

export const BranchementDeLaQuestion = z.object({
  capacites: z.array(z.string()),
});
export type BranchementDeLaQuestion = z.infer<typeof BranchementDeLaQuestion>;

/* ------------------------------------------------------------------ */
/* 4. Le volet de suivi                                                 */
/* ------------------------------------------------------------------ */

export const ETAPES_DU_SUIVI = [
  'brief',
  'direction',
  'style',
  'scenario',
  'ecriture',
  'storyboard',
  'plans',
  'creation',
  'son',
  'creation-sonore',
  'montage',
  'export',
  'livraison',
] as const;
export type EtapeDuSuivi = (typeof ETAPES_DU_SUIVI)[number];

export const LIBELLES_ETAPES_DU_SUIVI: Record<EtapeDuSuivi, string> = {
  brief: 'Brief',
  direction: 'Direction artistique',
  style: 'Style',
  scenario: 'Scénario',
  ecriture: 'Écriture',
  storyboard: 'Storyboard',
  plans: 'Plans',
  creation: 'Création',
  son: 'Son',
  'creation-sonore': 'Création sonore',
  montage: 'Montage',
  export: 'Export',
  livraison: 'Livraison',
};

export const ETATS_D_ETAPE_DU_SUIVI = ['a-definir', 'en-cours', 'a-valider', 'validee', 'terminee', 'erreur'] as const;
export type EtatDEtapeDuSuivi = (typeof ETATS_D_ETAPE_DU_SUIVI)[number];

export const LIBELLES_ETATS_D_ETAPE: Record<EtatDEtapeDuSuivi, string> = {
  'a-definir': 'À définir',
  'en-cours': 'En cours',
  'a-valider': 'À valider',
  validee: 'Validée',
  terminee: 'Terminée',
  erreur: 'En erreur',
};

/** Les étapes d'une production, selon ce qu'on produit (décision de l'utilisateur du 24/10/2026). */
export function etapesDeLaProduction(types: readonly TypeDeMediaDeRealisation[]): EtapeDuSuivi[] {
  if (!types.length) return ['brief'];
  if (types.includes('video')) return ['brief', 'direction', 'scenario', 'storyboard', 'plans', 'son', 'montage', 'export'];
  const sonore = types.some((t) => t === 'musique' || t === 'voix' || t === 'bruitages' || t === 'son');
  if (types.includes('image')) return sonore ? ['brief', 'style', 'creation', 'son', 'livraison'] : ['brief', 'style', 'creation', 'livraison'];
  return ['brief', 'ecriture', 'creation-sonore', 'livraison'];
}

/** Les rubriques du questionnaire qui nourrissent chaque étape d'écriture. */
const PHASES_DE_L_ETAPE: Partial<Record<EtapeDuSuivi, PhaseDeRealisation[]>> = {
  direction: ['direction', 'personnages'],
  style: ['direction', 'personnages'],
  scenario: ['scenario'],
  ecriture: ['scenario'],
  storyboard: ['plans'],
};

/** Les genres d'élément rangés sous chaque étape. */
const ELEMENTS_DE_L_ETAPE: Partial<Record<EtapeDuSuivi, GenreDElement[]>> = {
  brief: ['brief'],
  direction: ['concept', 'personnage', 'reference'],
  style: ['concept', 'personnage', 'reference'],
  scenario: ['script'],
  ecriture: ['script'],
  /* Carte 2 du studio : le storyboard porte les scènes, la LISTE DES PLANS vit sous son étape. */
  storyboard: ['scene'],
  plans: ['plan'],
  creation: ['plan'],
  'creation-sonore': ['plan'],
};

/** Un média tel que le volet le lit (une ligne de `medias_realisation`). */
export interface MediaDuSuivi {
  id: string;
  plan: string;
  version: number;
  capacite: string;
  genre: 'image' | 'video' | 'son';
  service: string;
  etape: string | null;
  etat: 'devis' | 'en-cours' | 'fini' | 'echec' | 'refuse';
  attachmentId: string | null;
  prix: number | null;
  creeLe: number;
  /*
   * LE DÉTAIL D'UNE FABRICATION (24/10/2026) : ce que l'étape dépliée montre
   * sous la vignette. Facultatif — un écran plus ancien ou un test qui ne les
   * pose pas garde un média valide.
   */
  /** La consigne ENVOYÉE au service (l'anglais, quand elle a été traduite). */
  consigne?: string;
  /** La consigne telle que l'agent l'a écrite, quand elle a été traduite avant l'envoi. */
  consigneOriginale?: string | null;
  /** Le nom lisible du modèle employé. */
  modeleNom?: string;
  /** Pourquoi ce modèle (écrit par l'agent au devis). */
  raison?: string;
  /** La raison d'un échec, quand la fabrication a raté. */
  echec?: string | null;
  /*
   * LE MENU « … » ET LES INFORMATIONS D'UN MÉDIA (24/10/2026), facultatifs eux aussi.
   */
  /** Ajouté au suivi par l'utilisateur ; nul ou absent : il n'est que dans le fil. */
  retenuLe?: number | null;
  /**
   * LE PLAN OÙ L'UTILISATEUR L'A PLACÉ (28/10/2026) : choisi au menu des plans
   * de « Valider », ou en le glissant dans une case du suivi. Il l'emporte sur
   * le plan nommé au devis (`plan`) ; nul ou absent : le plan du devis.
   */
  planPlace?: string | null;
  /** Ce qu'on sait du fichier rangé (dimensions, durée, débit…). */
  mesure?: MesureDeMedia | null;
  /** Le poids du fichier, en octets. */
  taille?: number | null;
  /** Le cadrage demandé (« 16:9 ») et la durée demandée, en secondes. */
  format?: string;
  duree?: number;
  /** L'identifiant du modèle chez le service. */
  modele?: string;
  /** Le média d'origine d'une retouche ou d'une animation. */
  sourceId?: string | null;
  /** Les réglages d'une retouche ou d'une animation, en clair (angle, lumière, visage, photos). */
  reglages?: { cle: string; valeur: string }[];
  /** Le prix annoncé au devis, et le coût réel quand le service l'a rendu. */
  prixAnnonce?: number | null;
  coutReel?: number | null;
  /** L'agent qui a fait le devis. */
  agentId?: string | null;
}

/**
 * L'ÉTAPE D'UN MÉDIA : celle que l'agent a nommée au devis si elle existe dans
 * cette production, sinon déduite — un aperçu va au style, un son à l'étape du
 * son, un montage au montage, le reste aux plans (ou à la création).
 */
export function etapeDuMedia(m: Pick<MediaDuSuivi, 'plan' | 'capacite' | 'service' | 'etape'>, etapes: readonly EtapeDuSuivi[]): EtapeDuSuivi {
  const premiere = (...choix: EtapeDuSuivi[]) => choix.find((e) => etapes.includes(e)) ?? etapes[etapes.length - 1]!;
  if (m.etape && (etapes as readonly string[]).includes(m.etape)) return m.etape as EtapeDuSuivi;
  /* L'aperçu d'un PLAN (« apercu-plans-1 ») est une image clé : il va avec le
     storyboard, sous « Images clés et prix » ; celui d'une direction reste à l'idée. */
  if (m.plan.startsWith(`${PREFIXE_DES_APERCUS}plan`)) return premiere('storyboard', 'scenario', 'style', 'ecriture');
  if (m.plan.startsWith(PREFIXE_DES_APERCUS)) return premiere('direction', 'style', 'ecriture');
  if (m.service === 'montage') return premiere('montage', 'livraison');
  if (m.capacite === 'voix' || m.capacite === 'son' || m.capacite === 'musique') return premiere('son', 'creation-sonore');
  return premiere('plans', 'creation');
}

/** Une version d'un élément, telle que le suivi la liste. */
export type VersionDuSuivi = Pick<ElementDeProduction, 'id' | 'version' | 'titre' | 'contenu' | 'etat' | 'creeLe' | 'auteur'>;

export interface EtapeDuVoletDeSuivi {
  etape: EtapeDuSuivi;
  etat: EtatDEtapeDuSuivi;
  /**
   * Les éléments écrits (version courante), affichés en texte sous l'étape,
   * chacun avec TOUTES ses versions, la plus récente d'abord (carte 2 : un plan
   * retouché garde ses versions, et l'on peut revenir à l'une d'elles).
   */
  elements: (Pick<ElementDeProduction, 'id' | 'cle' | 'genre' | 'titre' | 'contenu' | 'version' | 'etat'> & { versions: VersionDuSuivi[] })[];
  /**
   * Les médias de l'étape AJOUTÉS AU SUIVI par l'utilisateur, dans l'ordre de
   * leur devis (24/10/2026 : le suivi est le cahier de la production, il ne
   * montre que ce qui a été retenu ; tout le reste vit dans le fil).
   */
  medias: MediaDuSuivi[];
  /**
   * LES IMAGES ET VIDÉOS EN CONCEPTION (demande du 25/10/2026, capture #d283 :
   * « on conçoit des images et je vois rien à droite ») : ce que l'étape a
   * déjà fabriqué — aperçus d'une direction, images clés — sans être encore
   * ajouté au suivi. L'onglet « Production » du volet les montre en grand ;
   * le retenu reste dans `medias`.
   */
  enConception: MediaDuSuivi[];
  /** Les pièces du tableau d'ambiance (style, direction). */
  ambiance: string[];
  /** Un lot de cette étape attend la validation de l'utilisateur. */
  lotEnAttente: boolean;
}

export interface EntreeDuSuivi {
  column?: string;
  realisation?: Partial<Pick<EtatDeRealisation, 'medias' | 'genre' | 'phase' | 'termineA' | 'demandeA' | 'montageA' | 'ambiance'>> | null;
  elements?: readonly ElementDeProduction[];
  medias?: readonly MediaDuSuivi[];
  lots?: readonly Pick<LotDeDevis, 'etape' | 'etat' | 'operations'>[];
}

/** L'état que portent des éléments écrits : une validation demandée l'emporte, puis la plus avancée. */
function etatDesElements(tous: readonly Pick<ElementDeProduction, 'etat'>[]): EtatDEtapeDuSuivi | null {
  /* Des pistes écartées (directions non retenues) ne retiennent pas l'étape quand une autre est validée. */
  const elements = tous.some((e) => e.etat === 'valide') ? tous.filter((e) => e.etat !== 'refuse') : tous;
  if (!elements.length) return null;
  if (elements.some((e) => e.etat === 'a-valider')) return 'a-valider';
  if (elements.every((e) => e.etat === 'valide')) return 'validee';
  return 'en-cours';
}

/** L'état que portent des médias : un en cours, un raté sans réussite, tous finis. */
function etatDesMedias(medias: readonly MediaDuSuivi[]): EtatDEtapeDuSuivi | null {
  const vivants = medias.filter((m) => m.etat !== 'devis' && m.etat !== 'refuse');
  if (!vivants.length) return null;
  if (vivants.some((m) => m.etat === 'en-cours')) return 'en-cours';
  /* Un plan raté puis refait ne compte plus : seul le DERNIER essai de chaque plan juge l'étape. */
  const derniers = new Map<string, MediaDuSuivi>();
  for (const m of [...vivants].sort((a, b) => a.creeLe - b.creeLe)) derniers.set(m.plan, m);
  if ([...derniers.values()].some((m) => m.etat === 'echec')) return 'erreur';
  return 'terminee';
}

/** Un média ajouté au suivi. */
export function estRetenu(m: Pick<MediaDuSuivi, 'retenuLe' | 'etat'>): boolean {
  return m.etat === 'fini' && !!m.retenuLe;
}

/**
 * L'ÉTAT D'UNE ÉTAPE DE FABRICATION quand le suivi ne garde que le retenu :
 * une fabrication en cours ou un échec du dernier essai se disent toujours ;
 * des médias finis dont AUCUN n'est encore ajouté laissent l'étape « à valider »
 * (l'utilisateur doit choisir) ; un retenu au moins, et elle est faite.
 */
function etatDesMediasRetenus(medias: readonly MediaDuSuivi[]): EtatDEtapeDuSuivi | null {
  const brut = etatDesMedias(medias);
  if (brut !== 'terminee') return brut;
  return medias.some(estRetenu) ? 'terminee' : 'a-valider';
}

/**
 * LE FIL DU VOLET DE SUIVI, calculé depuis la carte et la base, jamais depuis
 * les messages. Une étape d'écriture suit le questionnaire (rubrique en cours,
 * cahier terminé) tant qu'aucun élément ne l'a remplacé ; une étape de
 * fabrication suit ses médias et ses lots ; le montage suit l'annonce de
 * l'agent ; l'export et la livraison suivent la colonne.
 */
export function etapesDuSuivi(e: EntreeDuSuivi): EtapeDuVoletDeSuivi[] {
  const r = e.realisation ?? {};
  const types = typesDeMediaDeLaRealisation(r);
  const etapes = etapesDeLaProduction(types);
  const colonne = String(e.column ?? '');
  const avantLeTravail = !colonne || (COLONNES_AVANT_LE_TRAVAIL as readonly string[]).includes(colonne);
  const livre = !avantLeTravail && colonne !== 'running';
  const cahierFini = !!r.termineA || !avantLeTravail;
  const rangDeLaPhase = PHASES_DE_REALISATION.indexOf((r.phase ?? 'intention') as PhaseDeRealisation);
  const tous = e.elements ?? [];
  const elements = elementsCourants(tous);
  const versionsDe = (cle: string): VersionDuSuivi[] =>
    tous
      .filter((x) => x.cle === cle)
      .sort((a, b) => b.version - a.version)
      .map(({ id, version, titre, contenu, etat, creeLe, auteur }) => ({ id, version, titre, contenu, etat, creeLe, auteur: auteur ?? null }));
  const medias = [...(e.medias ?? [])].sort((a, b) => a.creeLe - b.creeLe);
  const lots = e.lots ?? [];

  return etapes.map((etape): EtapeDuVoletDeSuivi => {
    const genres = ELEMENTS_DE_L_ETAPE[etape] ?? [];
    const sesElements = elements.filter((x) => genres.includes(x.genre) && x.etat !== 'remplace');
    const fabriques = medias.filter((m) => m.etat !== 'refuse' && m.etat !== 'devis' && etapeDuMedia(m, etapes) === etape);
    /* LE SUIVI NE MONTRE QUE LE RETENU ; l'avancement, lui, suit toute la fabrication de l'étape. */
    const sesMedias = fabriques.filter(estRetenu);
    const lotEnAttente = lots.some(
      (l) => l.etat === 'propose' && (l.etape === etape || (!l.etape && l.operations.some((o) => etapeDuMedia({ plan: o.plan, capacite: o.capacite, service: o.service, etape: null }, etapes) === etape))),
    );
    const ambiance = etape === 'direction' || etape === 'style' ? (r.ambiance ?? []).map((p) => p.piece) : [];

    let etat: EtatDEtapeDuSuivi = 'a-definir';
    if (etape === 'brief') {
      etat = cahierFini ? 'validee' : types.length || r.demandeA ? 'en-cours' : 'a-definir';
      etat = etatDesElements(sesElements) ?? etat;
    } else if (PHASES_DE_L_ETAPE[etape]) {
      const phases = PHASES_DE_L_ETAPE[etape]!.map((p) => PHASES_DE_REALISATION.indexOf(p));
      const questionnaire: EtatDEtapeDuSuivi = cahierFini
        ? 'validee'
        : phases.includes(rangDeLaPhase)
          ? 'en-cours'
          : Math.max(...phases) < rangDeLaPhase
            ? 'validee'
            : 'a-definir';
      etat = etatDesElements(sesElements) ?? questionnaire;
      if (ambiance.length && etat === 'a-definir') etat = 'en-cours';
    } else if (etape === 'montage') {
      etat = livre ? 'terminee' : etatDesMedias(fabriques) === 'terminee' ? 'terminee' : r.montageA ? 'en-cours' : 'a-definir';
    } else if (etape === 'export' || etape === 'livraison') {
      etat = livre ? 'terminee' : 'a-definir';
    } else {
      /* plans, création, son, création sonore : la fabrication, et avant elle la liste écrite des plans. */
      etat = etatDesMediasRetenus(fabriques) ?? (livre ? 'terminee' : etatDesElements(sesElements) ?? 'a-definir');
    }
    if (lotEnAttente && etat !== 'erreur') etat = 'a-valider';

    return {
      etape,
      etat,
      elements: sesElements.map(({ id, cle, genre, titre, contenu, version, etat: et }) => ({ id, cle, genre, titre, contenu, version, etat: et, versions: versionsDe(cle) })),
      medias: sesMedias,
      enConception: fabriques.filter((m) => m.etat === 'fini' && !!m.attachmentId && m.genre !== 'son' && !estRetenu(m)),
      ambiance,
      lotEnAttente,
    };
  });
}

/* L'ÉTAPE À METTRE EN AVANT n'est plus lue ici : le volet suit les six étapes
   du média, comme la barre (`etapesDuMedia`, `etapes-du-media.ts`). */

/** Ce que l'écran reçoit pour une carte : de quoi recalculer le volet sans relire la conversation. */
export interface EtatDeProduction {
  cardId: string;
  elements: ElementDeProduction[];
  lots: LotDeDevis[];
  medias: MediaDuSuivi[];
  budget: number | null;
  depense: number;
  /** Les exports PRÊTS du montage de la carte (vidéo) : le passage au téléchargement les attend. */
  exportsPrets?: number;
}
