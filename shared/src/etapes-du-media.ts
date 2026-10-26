/**
 * UNE CRÉATION DE MÉDIA PARLE SON PROPRE LANGAGE (carte caméra, décisions de
 * l'utilisateur du 25/10/2026) — règles PURES, sans base ni disque.
 *
 *  - SIX ÉTAPES, LES MÊMES PARTOUT : Type → Idée → Images clés et prix →
 *    Fabrication → Film monté → Livré (`ETAPES_DE_SUIVI_DE_LA_REALISATION`).
 *    La barre d'étapes de la carte les montre du premier message à la fin —
 *    jamais « Demande, Compréhension, Travail, À déployer » —, et le volet
 *    « Suivi de la production » range ses pièces sous les MÊMES six étapes
 *    (`voletDuMedia`). Les deux lisent `etapesDuMedia` : ils allument la même
 *    étape au même moment.
 *  - L'ÉTAT VIT DANS LA BASE (MEM-0370) : la carte (types choisis, accord de
 *    fabrication, colonne, montage, film soumis puis validé) et les pièces de
 *    la production (une pièce « à valider » = un arrêt qui attend l'accord).
 *  - UN BOUTON QUI SUIT L'ÉTAPE (`boutonDuMedia`) : « Valider l'idée »,
 *    « Valider et lancer la fabrication · prix », « Suspendre », « Valider le
 *    film », puis « Terminer », qui range la carte dans « Archivé ». Un clic
 *    RÉPOND à la question d'accord du directeur — jamais un second chemin de
 *    lancement : c'est l'accord de l'arrêt 2 qui lance la fabrication.
 *  - JAMAIS DE DÉPLOIEMENT : un média ne livre aucun code (`carteDeMedia`
 *    l'écarte du lot, de l'en-tête et de « Déployer »).
 */

import type { EtatDuPoint, SegmentDeSuivi } from './parcours-en-points.js';
import { ETAPES_DE_SUIVI_DE_LA_REALISATION } from './frise-de-suivi.js';
import { typesDeMediaDeLaRealisation, type EtatDeRealisation } from './mode-realisation.js';
import type { ElementDeProduction, EtapeDuSuivi, EtapeDuVoletDeSuivi, EtatDEtapeDuSuivi, LotDeDevis } from './production.js';
import {
  REPONSE_AUTRES_DIRECTIONS,
  REPONSE_LANCER_LA_FABRICATION,
  REPONSE_VALIDER_LE_FILM,
  REPONSE_VALIDER_L_ETAPE,
  GENRE_DE_L_ETAPE_D_ECRITURE,
  arretAccorde,
  arretLu,
  etapesDeLArret,
} from './responsable-creatif.js';

export type EtapeDuMedia = (typeof ETAPES_DE_SUIVI_DE_LA_REALISATION)[number];

/** Ce que la règle lit d'une carte. */
export interface CarteDuMedia {
  column?: string;
  cahierDesCharges?: unknown;
  parcours?: { realisationSouhaitee?: boolean; fabricationAccordeeA?: number } | null;
  realisation?: Partial<Pick<EtatDeRealisation, 'medias' | 'genre' | 'montageA' | 'filmSoumisA' | 'filmValideA'>> | null;
}

/**
 * UNE CRÉATION DE MÉDIA : le mode caméra est allumé sur la carte (et ce n'est
 * pas un cahier des charges). Le type n'a pas besoin d'être choisi : dès
 * l'allumage, la carte n'a plus rien à déployer.
 */
export function carteDeMedia(carte: Pick<CarteDuMedia, 'parcours' | 'cahierDesCharges'> | null | undefined): boolean {
  return !!carte?.parcours?.realisationSouhaitee && !carte.cahierDesCharges;
}

/** HORS DU LOT DE DÉPLOIEMENT : écartée à la main, ou création de média. */
export function horsDuLotDeDeploiement(carte: Pick<CarteDuMedia, 'parcours' | 'cahierDesCharges'> & { excludedFromDeploy?: boolean }): boolean {
  return !!carte.excludedFromDeploy || carteDeMedia(carte);
}

export interface ContexteDuMedia {
  carte: CarteDuMedia;
  /** Les pièces de la production (toutes versions) : c'est là qu'un arrêt attend l'accord. */
  elements?: readonly Pick<ElementDeProduction, 'cle' | 'version' | 'genre' | 'etat'>[];
  /** Les lots de fabrication : un lot proposé attend la validation de l'utilisateur. */
  lots?: readonly Pick<LotDeDevis, 'etat'>[];
}

const COLONNES_APRES_LE_TRAVAIL = ['to_deploy', 'archived'];

/** Une étape d'un arrêt attend-elle l'accord ? Une de ses pièces courantes est « à valider ». */
function arretEnAttente(arret: 'idee' | 'images-cles', elements: ContexteDuMedia['elements'], types: ReturnType<typeof typesDeMediaDeLaRealisation>): boolean {
  const etapes = etapesDeLArret(arret, types);
  const voulus = new Set<string>(etapes.map((e) => GENRE_DE_L_ETAPE_D_ECRITURE[e]));
  const derniere = new Map<string, { version: number; etat: string; genre: string }>();
  for (const e of elements ?? []) {
    const avant = derniere.get(e.cle);
    if (!avant || e.version > avant.version) derniere.set(e.cle, e);
  }
  return [...derniere.values()].some((e) => voulus.has(e.genre) && e.etat === 'a-valider');
}

/**
 * LES SIX ÉTAPES ET LEUR ÉTAT, lus dans la base :
 *  - TYPE : fait dès qu'un type est choisi ;
 *  - IDÉE : faite quand brief et direction sont accordés (ou la fabrication
 *    accordée / lancée) ; « à voir » quand l'accord est demandé ; en cours sinon ;
 *  - IMAGES CLÉS ET PRIX : faite à l'accord de fabrication ; « à voir » quand le
 *    prix est soumis ; en cours dès que l'idée est accordée ;
 *  - FABRICATION : en cours une fois accordée (la tâche tourne) ; « à voir »
 *    quand un lot attend votre accord ; faite dès que le montage commence ;
 *  - FILM MONTÉ : en cours au montage ; « à voir » quand le film est soumis ;
 *    fait une fois validé (ou le travail rendu) ;
 *  - LIVRÉ : en cours pendant l'export qui suit l'accord ; « à voir » quand le
 *    travail est rendu et attend « Terminer » ; fait une fois la carte rangée.
 */
export function etapesDuMedia(ctx: ContexteDuMedia): (SegmentDeSuivi & { etape: EtapeDuMedia })[] {
  const { carte } = ctx;
  const r = carte.realisation ?? {};
  const types = typesDeMediaDeLaRealisation(r);
  const elements = (ctx.elements ?? []) as readonly ElementDeProduction[];
  const colonne = String(carte.column ?? '');
  const range = colonne === 'archived';
  const rendu = COLONNES_APRES_LE_TRAVAIL.includes(colonne);
  const lancee = colonne === 'running' || rendu;
  const accordee = !!carte.parcours?.fabricationAccordeeA || lancee;
  const filmValide = !!r.filmValideA || rendu;
  const filmSoumis = !!r.filmSoumisA;
  const montage = !!r.montageA || filmSoumis || filmValide;

  const ideeFaite = accordee || arretAccorde('idee', elements, types);
  const etats: Record<EtapeDuMedia, EtatDuPoint> = {
    type: types.length || lancee ? 'fait' : 'question',
    idee: ideeFaite ? 'fait' : !types.length ? 'avenir' : arretEnAttente('idee', ctx.elements, types) ? 'question' : 'encours',
    'images-cles': accordee ? 'fait' : !ideeFaite ? 'avenir' : arretEnAttente('images-cles', ctx.elements, types) ? 'question' : 'encours',
    fabrication: montage ? 'fait' : !accordee ? 'avenir' : (ctx.lots ?? []).some((l) => l.etat === 'propose') ? 'question' : 'encours',
    film: filmValide ? 'fait' : filmSoumis ? 'question' : montage ? 'encours' : 'avenir',
    livre: range ? 'fait' : rendu ? 'question' : filmValide ? 'encours' : 'avenir',
  };
  return ETAPES_DE_SUIVI_DE_LA_REALISATION.map((etape) => ({ etape, etat: etats[etape] }));
}

/** L'étape où se trouve la création : la première qui n'est pas faite ; « Livré » une fois tout fait. */
export function etapeCouranteDuMedia(segments: readonly { etape: EtapeDuMedia; etat: EtatDuPoint }[]): EtapeDuMedia {
  return segments.find((s) => s.etat !== 'fait')?.etape ?? 'livre';
}

/* ------------------------------------------------------------------ */
/* Le volet « Suivi de la production » sur les mêmes six étapes          */
/* ------------------------------------------------------------------ */

/**
 * LES PIÈCES DU SUIVI RANGÉES SOUS CHAQUE ÉTAPE. Les plans ÉCRITS restent sous
 * « Images clés et prix » ; les médias FABRIQUÉS à partir d'eux passent sous
 * « Fabrication » (`voletDuMedia`).
 */
export const SOUS_ETAPES_DU_MEDIA: Record<EtapeDuMedia, readonly EtapeDuSuivi[]> = {
  type: [],
  idee: ['brief', 'direction', 'style'],
  'images-cles': ['scenario', 'ecriture', 'storyboard', 'plans'],
  fabrication: ['plans', 'creation', 'son', 'creation-sonore'],
  film: ['montage', 'export'],
  livre: ['livraison'],
};

/** Un bloc d'une étape : les pièces d'une étape du suivi (brief, direction…), sous son nom. */
export type BlocDuMedia = Pick<EtapeDuVoletDeSuivi, 'etape' | 'elements' | 'medias' | 'ambiance'> & Partial<Pick<EtapeDuVoletDeSuivi, 'enConception'>>;

export interface EtapeDuVoletDuMedia {
  etape: EtapeDuMedia;
  etat: EtatDEtapeDuSuivi;
  blocs: BlocDuMedia[];
}

/** L'état d'un segment, dit dans la langue du volet. */
function etatDuVolet(etape: EtapeDuMedia, etat: EtatDuPoint): EtatDEtapeDuSuivi {
  if (etat === 'fait') return etape === 'type' || etape === 'idee' || etape === 'images-cles' ? 'validee' : 'terminee';
  if (etat === 'encours') return 'en-cours';
  if (etat === 'question') return 'a-valider';
  if (etat === 'erreur') return 'erreur';
  return 'a-definir';
}

/**
 * LE VOLET DU MÉDIA : les six étapes de la barre, dans le même état, chacune
 * avec les pièces des étapes du suivi qui lui reviennent. Les étapes du suivi
 * restent calculées par `etapesDuSuivi` ; rien ne se perd : une étape du suivi
 * absente de la table tombe sous « Fabrication ».
 */
export function voletDuMedia(volet: readonly EtapeDuVoletDeSuivi[], segments: readonly { etape: EtapeDuMedia; etat: EtatDuPoint }[]): EtapeDuVoletDuMedia[] {
  const rangees = new Set(Object.values(SOUS_ETAPES_DU_MEDIA).flat());
  return segments.map(({ etape, etat }) => {
    const blocs: BlocDuMedia[] = [];
    for (const x of volet) {
      const ici = SOUS_ETAPES_DU_MEDIA[etape].includes(x.etape) || (etape === 'fabrication' && !rangees.has(x.etape));
      if (!ici) continue;
      /* « Plans » : l'écrit sous les images clés, les médias fabriqués sous la fabrication. */
      const ecrit = x.etape !== 'plans' || etape === 'images-cles';
      const fabrique = x.etape !== 'plans' || etape === 'fabrication';
      blocs.push({
        etape: x.etape,
        elements: ecrit ? x.elements : [],
        medias: fabrique ? x.medias : [],
        enConception: fabrique ? x.enConception ?? [] : [],
        ambiance: ecrit ? x.ambiance : [],
      });
    }
    return { etape, etat: etatDuVolet(etape, etat), blocs };
  });
}

/* ------------------------------------------------------------------ */
/* Le bouton qui suit l'étape                                           */
/* ------------------------------------------------------------------ */

export type GesteDuMedia = 'valider-idee' | 'lancer-fabrication' | 'suspendre' | 'valider-film' | 'terminer';

export interface BoutonDuMedia {
  geste: GesteDuMedia;
  /** Le libellé, en français (traduit à l'écran). */
  libelle: string;
  /** Le prix annoncé, lu sur la question d'accord (« Valider et lancer la fabrication · 3,20 $ »). */
  prix?: number;
  possible: boolean;
  /** Pourquoi le bouton est éteint, en mots courants. */
  raison?: string;
  /** La réponse que le clic donne à la question d'accord. */
  reponse?: string;
}

/** Une question d'accord encore ouverte, telle que l'écran la lit dans le fil. */
export interface AccordOuvert {
  etape: string;
  prix?: number;
  options: readonly { id: string; label: string }[];
}

export const LIBELLES_GESTES_DU_MEDIA: Record<GesteDuMedia, string> = {
  'valider-idee': 'Valider l’idée',
  'lancer-fabrication': 'Valider et lancer la fabrication',
  suspendre: 'Suspendre',
  'valider-film': 'Valider le film',
  terminer: 'Terminer',
};

export const RAISONS_DU_BOUTON_DU_MEDIA = {
  idee: 'Le directeur prépare l’idée : rien à valider pour l’instant.',
  direction: 'Choisissez d’abord une direction dans la question.',
  imagesCles: 'Le directeur écrit le scénario et les plans : le prix viendra avec les images clés.',
  depart: 'La fabrication va démarrer d’elle-même.',
  film: 'Le film n’est pas encore prêt à valider.',
  export: 'L’export final se termine : « Terminer » viendra juste après.',
} as const;

/**
 * LE BOUTON PRINCIPAL D'UNE CRÉATION DE MÉDIA, selon l'étape et la question
 * d'accord ouverte. Une carte rangée n'en a plus (`null`).
 *  - une question d'accord ouverte décide du geste : idée, images clés, film ;
 *    pour une idée à plusieurs directions, la réponse est la direction cochée
 *    dans la question (`choisis`) — jamais une direction par défaut ;
 *  - sinon l'étape : « Suspendre » pendant que la tâche tourne, « Terminer »
 *    une fois le travail rendu, et le geste à venir, éteint, avant.
 */
export function boutonDuMedia(e: {
  carte: Pick<CarteDuMedia, 'column' | 'realisation'>;
  etape: EtapeDuMedia;
  accord?: AccordOuvert | null;
  /** Les options cochées dans la question d'accord (identifiants). */
  choisis?: readonly string[];
}): BoutonDuMedia | null {
  const colonne = String(e.carte.column ?? '');
  if (colonne === 'archived') return null;
  const accord = e.accord ?? null;
  const arret = accord ? arretLu(accord.etape) : null;
  if (accord && arret === 'idee') {
    const valider = accord.options.find((o) => o.label === REPONSE_VALIDER_L_ETAPE);
    if (valider) return { geste: 'valider-idee', libelle: LIBELLES_GESTES_DU_MEDIA['valider-idee'], possible: true, reponse: valider.label };
    const choisie = accord.options.find((o) => (e.choisis ?? []).includes(o.id) && o.label !== REPONSE_AUTRES_DIRECTIONS);
    return choisie
      ? { geste: 'valider-idee', libelle: LIBELLES_GESTES_DU_MEDIA['valider-idee'], possible: true, reponse: choisie.label }
      : { geste: 'valider-idee', libelle: LIBELLES_GESTES_DU_MEDIA['valider-idee'], possible: false, raison: RAISONS_DU_BOUTON_DU_MEDIA.direction };
  }
  if (accord && arret === 'images-cles') {
    return {
      geste: 'lancer-fabrication',
      libelle: LIBELLES_GESTES_DU_MEDIA['lancer-fabrication'],
      ...(typeof accord.prix === 'number' ? { prix: accord.prix } : {}),
      possible: true,
      reponse: REPONSE_LANCER_LA_FABRICATION,
    };
  }
  if (accord && arret === 'rendu') {
    return { geste: 'valider-film', libelle: LIBELLES_GESTES_DU_MEDIA['valider-film'], possible: true, reponse: REPONSE_VALIDER_LE_FILM };
  }
  if (COLONNES_APRES_LE_TRAVAIL.includes(colonne)) return { geste: 'terminer', libelle: LIBELLES_GESTES_DU_MEDIA.terminer, possible: true };
  if (colonne === 'running') {
    if (e.carte.realisation?.filmValideA) return { geste: 'terminer', libelle: LIBELLES_GESTES_DU_MEDIA.terminer, possible: false, raison: RAISONS_DU_BOUTON_DU_MEDIA.export };
    return { geste: 'suspendre', libelle: LIBELLES_GESTES_DU_MEDIA.suspendre, possible: true };
  }
  /* Avant la fabrication : le geste à venir, éteint, et pourquoi. */
  if (e.etape === 'type' || e.etape === 'idee') return { geste: 'valider-idee', libelle: LIBELLES_GESTES_DU_MEDIA['valider-idee'], possible: false, raison: RAISONS_DU_BOUTON_DU_MEDIA.idee };
  if (e.etape === 'images-cles') return { geste: 'lancer-fabrication', libelle: LIBELLES_GESTES_DU_MEDIA['lancer-fabrication'], possible: false, raison: RAISONS_DU_BOUTON_DU_MEDIA.imagesCles };
  if (e.etape === 'fabrication') return { geste: 'suspendre', libelle: LIBELLES_GESTES_DU_MEDIA.suspendre, possible: false, raison: RAISONS_DU_BOUTON_DU_MEDIA.depart };
  return { geste: 'valider-film', libelle: LIBELLES_GESTES_DU_MEDIA['valider-film'], possible: false, raison: RAISONS_DU_BOUTON_DU_MEDIA.film };
}
