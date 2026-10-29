/**
 * UNE CRÉATION DE MÉDIA PARLE SON PROPRE LANGAGE (carte caméra) — règles
 * PURES, sans base ni disque.
 *
 * QUATRE ÉTAPES FIXES, LES MÊMES POUR TOUS LES MÉDIAS (décision de
 * l'utilisateur du 26/10/2026, elles remplacent « Type → Idée → Images clés et
 * prix → Fabrication → Film monté → Livré ») :
 *
 *  - BRIEF : une discussion avec le directeur artistique, dont les questions
 *    sont PROPRES au média choisi (photo, vidéo, musique, voix, son). Le brief
 *    d'une vidéo se termine par le découpage en plans (durée, capacité) et le
 *    texte de la voix off. Rien ne se dépense. Bouton « Passer aux esquisses ».
 *  - ESQUISSES : chaque génération propose 2 à 4 brouillons, chacune avec son
 *    PRIX SUR LE BOUTON (un clic vaut accord, jamais d'accord global) ; on
 *    VALIDE d'un clic, directement sur le média, autant d'éléments qu'on veut.
 *    Une vidéo y a DEUX TEMPS (`phaseDesEsquisses`) : l'image de chaque plan,
 *    puis « Passer aux séquences vidéo » — chaque plan s'anime par son propre
 *    bouton à prix, et la voix off et la musique prévues au brief s'y
 *    fabriquent. « Passer au montage » ne s'allume que quand tout ce qui est
 *    prévu est validé, et DIT ce qui manque sinon (`passageDuMedia`).
 *  - MONTAGE : chaque média a SON studio, gratuit — photo (cadrage, couleurs),
 *    vidéo (l'éditeur de montage de la carte, nourri des éléments validés),
 *    son (pistes, coupes, fondus). « Revenir aux esquisses » reste possible.
 *  - TÉLÉCHARGEMENT : les médias finaux, puis les validés, puis toutes les
 *    esquisses, et une archive à trois dossiers ; « Terminer » range la carte.
 *
 * La barre d'étapes et le volet « Suivi de la production » lisent TOUS DEUX
 * `etapesDuMedia` : ils allument la même étape au même moment. L'état vit
 * dans la base (MEM-0370) : les dates de passage sur la carte
 * (`realisation.esquissesA`, `sequencesA`, `montageA`, `telechargementA`) et
 * les médias validés (`retenuLe`). Une carte commencée sur l'ancien parcours se
 * relit par alias (`etapeDuMediaLue`) : l'accord de fabrication d'hier vaut
 * passage aux esquisses, le film soumis vaut montage, le film validé vaut
 * téléchargement — sans rien relancer ni dépenser.
 *
 * JAMAIS DE DÉPLOIEMENT : un média ne livre aucun code (`carteDeMedia` l'écarte
 * du lot, de l'en-tête et de « Déployer »).
 */

import type { EtatDuPoint, SegmentDeSuivi } from './parcours-en-points.js';
import { ETAPES_DE_SUIVI_DE_LA_REALISATION } from './frise-de-suivi.js';
import { COLONNES_AVANT_LE_TRAVAIL } from './columns.js';
import { typesDeMediaDeLaRealisation, type EtatDeRealisation, type TypeDeMediaDeRealisation } from './mode-realisation.js';
import { cleDElement, elementsCourants, estRetenu, type ElementDeProduction, type EtapeDuSuivi, type EtapeDuVoletDeSuivi, type EtatDEtapeDuSuivi, type LotDeDevis, type MediaDuSuivi } from './production.js';
import { CAPACITE_DU_MONTAGE, capaciteDuPlan, champsDuBrief, piecesAFournirManquantes } from './responsable-creatif.js';

export type EtapeDuMedia = (typeof ETAPES_DE_SUIVI_DE_LA_REALISATION)[number];

/** Ce que la règle lit d'une carte. */
export interface CarteDuMedia {
  column?: string;
  cahierDesCharges?: unknown;
  parcours?: { realisationSouhaitee?: boolean; fabricationAccordeeA?: number } | null;
  realisation?: Partial<
    Pick<EtatDeRealisation, 'medias' | 'genre' | 'montageA' | 'filmSoumisA' | 'filmValideA' | 'esquissesA' | 'sequencesA' | 'telechargementA' | 'finaux'>
  > | null;
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

/* ------------------------------------------------------------------ */
/* 1. Les dates de passage, ancien parcours compris                     */
/* ------------------------------------------------------------------ */

/**
 * UN NOM D'ÉTAPE LU AVEC TOLÉRANCE, anciens noms compris (cartes et questions
 * d'avant le 26/10/2026) : type et brief → brief ; idée, direction, images
 * clés, scénario, plans, fabrication, composition, inspiration → esquisses ;
 * film, rendu, finalisation → montage ; livré → téléchargement.
 */
export function etapeDuMediaLue(brut: unknown): EtapeDuMedia | null {
  const s = String(brut ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if ((ETAPES_DE_SUIVI_DE_LA_REALISATION as readonly string[]).includes(s)) return s as EtapeDuMedia;
  const alias: Record<string, EtapeDuMedia> = {
    type: 'brief',
    esquisse: 'esquisses',
    idee: 'esquisses',
    direction: 'esquisses',
    inspiration: 'esquisses',
    'images-cles': 'esquisses',
    scenario: 'esquisses',
    storyboard: 'esquisses',
    plans: 'esquisses',
    fabrication: 'esquisses',
    composition: 'esquisses',
    sequences: 'esquisses',
    film: 'montage',
    rendu: 'montage',
    finalisation: 'montage',
    livre: 'telechargement',
    livraison: 'telechargement',
    export: 'telechargement',
  };
  return alias[s] ?? null;
}

/** Les passages d'une carte, ancien parcours relu : l'accord de fabrication valait le départ des esquisses. */
export function passagesDuMedia(carte: CarteDuMedia): { esquisses: boolean; sequences: boolean; montage: boolean; telechargement: boolean; range: boolean } {
  const r = carte.realisation ?? {};
  const colonne = String(carte.column ?? '');
  const range = colonne === 'archived';
  /* Une carte d'avant, LANCÉE (tâche de fabrication), avait passé l'arrêt des images clés. */
  const lancee = !!colonne && !(COLONNES_AVANT_LE_TRAVAIL as readonly string[]).includes(colonne);
  const telechargement = !!r.telechargementA || !!r.filmValideA || range;
  const montage = !!r.montageA || !!r.filmSoumisA || telechargement;
  const esquisses = !!r.esquissesA || !!carte.parcours?.fabricationAccordeeA || lancee || montage;
  return { esquisses, sequences: !!r.sequencesA, montage, telechargement, range };
}

export interface ContexteDuMedia {
  carte: CarteDuMedia;
  /** Les pièces de la production (toutes versions). */
  elements?: readonly Pick<ElementDeProduction, 'cle' | 'version' | 'genre' | 'etat'>[];
  /** Les lots de fabrication : un lot proposé attend le clic de l'utilisateur. */
  lots?: readonly Pick<LotDeDevis, 'etat'>[];
}

/**
 * LES QUATRE ÉTAPES ET LEUR ÉTAT, lus dans la base :
 *  - BRIEF : en cours jusqu'au passage aux esquisses, fait ensuite ;
 *  - ESQUISSES : en cours une fois passée (« à voir » quand une génération
 *    attend son clic à prix), faite au passage au montage ;
 *  - MONTAGE : attend l'utilisateur dans son studio, faite au passage au
 *    téléchargement ;
 *  - TÉLÉCHARGEMENT : attend « Terminer », faite une fois la carte rangée.
 */
export function etapesDuMedia(ctx: ContexteDuMedia): (SegmentDeSuivi & { etape: EtapeDuMedia })[] {
  const p = passagesDuMedia(ctx.carte);
  const lotEnAttente = (ctx.lots ?? []).some((l) => l.etat === 'propose');
  const etats: Record<EtapeDuMedia, EtatDuPoint> = {
    brief: p.esquisses ? 'fait' : 'encours',
    esquisses: p.montage ? 'fait' : p.esquisses ? (lotEnAttente ? 'question' : 'encours') : 'avenir',
    montage: p.telechargement ? 'fait' : p.montage ? 'question' : 'avenir',
    telechargement: p.range ? 'fait' : p.telechargement ? 'question' : 'avenir',
  };
  return ETAPES_DE_SUIVI_DE_LA_REALISATION.map((etape) => ({ etape, etat: etats[etape] }));
}

/** L'étape où se trouve la création : la première qui n'est pas faite ; « Téléchargement » une fois tout fait. */
export function etapeCouranteDuMedia(segments: readonly { etape: EtapeDuMedia; etat: EtatDuPoint }[]): EtapeDuMedia {
  return segments.find((s) => s.etat !== 'fait')?.etape ?? 'telechargement';
}

/* ------------------------------------------------------------------ */
/* 2. Le découpage d'une vidéo et ce qui est validé pour chaque plan    */
/* ------------------------------------------------------------------ */

/** Un plan du découpage, tel que les esquisses le suivent. */
export interface PlanDuDecoupage {
  cle: string;
  titre: string;
  /** La durée écrite au plan (« Durée : 5 s »), en secondes. */
  duree: number | null;
  capacite: string | null;
  /** Un plan VISUEL attend une image puis une séquence ; un plan monté (titre, capture réelle) ou sonore, non. */
  visuel: boolean;
}

/** Les capacités qui ne demandent ni image ni séquence : faites au montage, ou purement sonores. */
const CAPACITES_SANS_IMAGE = new Set([CAPACITE_DU_MONTAGE, 'voix', 'musique', 'son', 'synchro']);

/** La durée écrite dans un plan : « Durée : 5 s », « durée : 4,5 secondes ». */
export function dureeDuPlan(contenu: string): number | null {
  const m = /dur[ée]e\s*:\s*(\d+(?:[.,]\d+)?)\s*(?:s\b|sec|seconde)/i.exec(contenu ?? '');
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Le rang d'un plan dans le découpage : son numéro (« plan-2 » avant « plan-10 »), sinon sa naissance. */
function rangDuPlan(cle: string): number {
  const m = /(\d+)(?!.*\d)/.exec(cle);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * LE DÉCOUPAGE D'UNE VIDÉO : les plans écrits (version courante, ni remplacés
 * ni écartés), dans l'ordre de leur numéro.
 */
export function decoupageDuMedia(elements: readonly ElementDeProduction[]): PlanDuDecoupage[] {
  return elementsCourants(elements)
    .filter((e) => e.genre === 'plan' && e.etat !== 'remplace' && e.etat !== 'refuse')
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rangDuPlan(a.e.cle) - rangDuPlan(b.e.cle) || a.i - b.i)
    .map(({ e }) => {
      const capacite = capaciteDuPlan(e.contenu);
      return { cle: e.cle, titre: e.titre, duree: dureeDuPlan(e.contenu), capacite, visuel: !capacite || !CAPACITES_SANS_IMAGE.has(capacite) };
    });
}

const normal = (t: string): string =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * LE PLAN D'UN MÉDIA : le champ « plan » de son devis nomme le plan par sa
 * clé (« plan-2 »), par son titre, ou par « Plan 2 » ; une suite après la clé
 * est tolérée (« plan-2 — variante »), jamais un autre numéro (« plan-20 »).
 */
export function planDuMedia(nom: string, plans: readonly Pick<PlanDuDecoupage, 'cle' | 'titre'>[]): string | null {
  const brut = normal(nom);
  if (!brut) return null;
  const commeCle = cleDElement(nom, 'plan');
  for (const p of plans) {
    if (commeCle === p.cle) return p.cle;
    if (commeCle.startsWith(`${p.cle}-`) && !/^\d/.test(commeCle.slice(p.cle.length + 1))) return p.cle;
  }
  for (const p of plans) {
    const titre = normal(p.titre);
    if (titre && (brut === titre || (brut.startsWith(titre) && /^[\s—–:,.(-]/.test(brut.slice(titre.length))))) return p.cle;
  }
  return null;
}

type MediaDuPassage = Pick<MediaDuSuivi, 'id' | 'plan' | 'genre' | 'capacite' | 'etat' | 'retenuLe' | 'creeLe' | 'sourceId' | 'planPlace'>;

/**
 * LE PLAN OÙ VIT UN MÉDIA VALIDÉ (28/10/2026) : celui où l'utilisateur l'a
 * PLACÉ (menu des plans de « Valider », ou glisser vers une case du suivi),
 * sinon celui que son devis nomme. Un plan placé qui a quitté le découpage
 * retombe sur le plan du devis.
 */
export function planEffectif(m: Pick<MediaDuSuivi, 'plan' | 'planPlace'>, plans: readonly Pick<PlanDuDecoupage, 'cle' | 'titre'>[]): string | null {
  if (m.planPlace && plans.some((p) => p.cle === m.planPlace)) return m.planPlace;
  return planDuMedia(m.plan, plans);
}

/** L'instant qui range les validés d'une case : la dernière validation (ou le dernier placement), puis la fabrication. */
const instantDeValidation = (m: Pick<MediaDuSuivi, 'retenuLe' | 'creeLe'>): number => m.retenuLe ?? m.creeLe;

/** Ce que chaque plan d'une vidéo a de validé : son image, sa séquence, et si la séquence est à refaire. */
export interface EtatDuPlan extends PlanDuDecoupage {
  /** Les images validées du plan, la plus récente d'abord. */
  images: MediaDuPassage[];
  /** La séquence validée du plan (la plus récente). */
  sequence: MediaDuPassage | null;
  /** La séquence a été animée d'une image qui n'est plus validée pour ce plan. */
  aRefaire: boolean;
}

export function etatDesPlans(plans: readonly PlanDuDecoupage[], medias: readonly MediaDuPassage[]): EtatDuPlan[] {
  /* LA PLUS RÉCEMMENT VALIDÉE D'ABORD (28/10/2026) : une image placée à la main
     dans une case y passe devant, même fabriquée avant celle qui l'occupait. */
  const valides = medias.filter((m) => estRetenu(m)).sort((a, b) => instantDeValidation(b) - instantDeValidation(a) || b.creeLe - a.creeLe);
  return plans.map((p) => {
    const duPlan = valides.filter((m) => planEffectif(m, plans) === p.cle);
    const images = duPlan.filter((m) => m.genre === 'image');
    const sequence = duPlan.find((m) => m.genre === 'video') ?? null;
    const aRefaire = !!sequence?.sourceId && !images.some((i) => i.id === sequence.sourceId);
    return { ...p, images, sequence, aRefaire };
  });
}

/**
 * CE QUI SE FABRIQUE POUR UN PLAN (27/10/2026) : les médias encore « en cours »
 * dont le devis vise ce plan, du genre attendu par sa case (l'image, ou la
 * séquence). La case du volet y pose le même balayage que le bloc du fil,
 * jusqu'à l'arrivée du média. `plans` est le découpage ENTIER : un nom de plan
 * ne se rattache qu'au plan qu'il désigne vraiment.
 */
export function enFabricationDuPlan(
  cle: string,
  plans: readonly Pick<PlanDuDecoupage, 'cle' | 'titre'>[],
  medias: readonly Pick<MediaDuSuivi, 'id' | 'plan' | 'genre' | 'etat'>[],
  genre: 'image' | 'video',
): number {
  return medias.filter((m) => m.etat === 'en-cours' && m.genre === genre && planDuMedia(m.plan, plans) === cle).length;
}

/**
 * PLACER UN MÉDIA DANS UN PLAN (28/10/2026) — « Valider » suivi du choix du
 * plan, ou le glisser d'une image vers une case du suivi. Règle pure : elle
 * rend les CHANGEMENTS à écrire, et le démon les écrit d'un seul tenant.
 *
 *  - Une IMAGE ne va que dans la case d'image d'un plan, une VIDÉO que dans
 *    sa case de séquence ; un son n'a pas de case.
 *  - Le média placé est validé dans ce plan (`planPlace`), à l'instant du geste.
 *  - LA CASE ÉTAIT PLEINE : si le média venait d'un AUTRE plan où il était
 *    validé, l'occupant affiché PREND SA PLACE (échange) ; sinon (média du fil,
 *    pas encore validé), l'occupant perd sa validation. Il reste dans le fil :
 *    rien n'est jamais effacé. Les autres validés de la case, cachés derrière
 *    l'occupant, perdent aussi la leur : la case ne garde que le média placé.
 */
export type PlacementDansUnPlan =
  | {
      ok: true;
      /** Les médias à écrire : leur validation (`null` : retirée) et leur plan placé. */
      changements: { id: string; retenuLe: number | null; planPlace: string | null }[];
      /** L'occupant qui a pris la place d'origine, quand il y a eu échange. */
      echange: string | null;
    }
  | { ok: false; raison: string };

export function placementDansUnPlan(
  plans: readonly PlanDuDecoupage[],
  medias: readonly MediaDuPassage[],
  e: { mediaId: string; planCle: string; maintenant: number },
): PlacementDansUnPlan {
  const m = medias.find((x) => x.id === e.mediaId);
  if (!m) return { ok: false, raison: 'média introuvable sur cette carte' };
  if (m.etat !== 'fini') return { ok: false, raison: 'seul un média fini se place dans un plan' };
  if (m.genre === 'son') return { ok: false, raison: 'un son n’a pas de case de plan' };
  const visuels = plans.filter((p) => p.visuel);
  const cible = visuels.find((p) => p.cle === e.planCle);
  if (!cible) return { ok: false, raison: 'ce plan n’existe pas dans le découpage' };
  /* Les validés du même genre déjà dans la case, dans l'ordre où le volet les montre (le premier est l'occupant affiché). */
  const occupants = medias
    .filter((x) => x.id !== m.id && x.genre === m.genre && estRetenu(x) && planEffectif(x, plans) === cible.cle)
    .sort((a, b) => instantDeValidation(b) - instantDeValidation(a) || b.creeLe - a.creeLe);
  const origine = estRetenu(m) ? planEffectif(m, plans) : null;
  const changements: { id: string; retenuLe: number | null; planPlace: string | null }[] = [
    { id: m.id, retenuLe: e.maintenant, planPlace: cible.cle },
  ];
  let echange: string | null = null;
  const [affiche, ...caches] = occupants;
  if (affiche && origine && origine !== cible.cle && visuels.some((p) => p.cle === origine)) {
    echange = affiche.id;
    changements.push({ id: affiche.id, retenuLe: e.maintenant, planPlace: origine });
  } else if (affiche) {
    changements.push({ id: affiche.id, retenuLe: null, planPlace: null });
  }
  for (const x of caches) changements.push({ id: x.id, retenuLe: null, planPlace: null });
  return { ok: true, changements, echange };
}

/* ------------------------------------------------------------------ */
/* 3. Les deux temps des esquisses d'une vidéo                         */
/* ------------------------------------------------------------------ */

export type PhaseDesEsquisses = 'images' | 'sequences' | 'medias';

/** Une vidéo : l'image de chaque plan, puis les séquences (passage par le bouton). Les autres médias : un seul temps. */
export function phaseDesEsquisses(types: readonly TypeDeMediaDeRealisation[], realisation: Pick<CarteDuMedia, 'realisation'>['realisation']): PhaseDesEsquisses {
  if (!types.includes('video')) return 'medias';
  return realisation?.sequencesA ? 'sequences' : 'images';
}

/**
 * UNE ANIMATION PEUT-ELLE PARTIR ? Jamais pendant le premier temps d'une vidéo
 * (toutes les images d'abord, décision du 26/10/2026) ; ni avant les
 * esquisses. Le serveur le juge pour l'agent comme pour les boutons.
 */
export function animationPermise(e: { types: readonly TypeDeMediaDeRealisation[]; carte: CarteDuMedia }): { ok: true } | { ok: false; raison: string } {
  const p = passagesDuMedia(e.carte);
  if (!p.esquisses) return { ok: false, raison: 'la carte est encore au brief : rien ne se fabrique avant « Passer aux esquisses ».' };
  if (e.types.includes('video') && !p.sequences) {
    return { ok: false, raison: 'les esquisses de cette vidéo en sont aux IMAGES des plans : aucune animation tant que l’utilisateur n’a pas cliqué « Passer aux séquences vidéo » (toutes les images d’abord).' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 4. Le brief : ce qu'une vidéo prévoit d'entendre                     */
/* ------------------------------------------------------------------ */

/** Une valeur de brief qui prévoit vraiment quelque chose (« non », « aucune », « sans » ne prévoient rien). */
export function prevuAuBrief(valeur: string | null | undefined): boolean {
  const v = String(valeur ?? '').trim();
  return !!v && !/^(non|aucune?s?|sans|pas de|pas d['’]|rien|néant|sans objet)\b/i.test(v);
}

/** La voix off et la musique d'une vidéo, lues au brief. */
export function sonDuBrief(brief: string | null | undefined): { voix: boolean; musique: boolean } {
  const champs = champsDuBrief(brief);
  const valeur = (c: string) => champs.find((x) => x.champ === c)?.valeur;
  return { voix: prevuAuBrief(valeur('voix')), musique: prevuAuBrief(valeur('musique')) };
}

/* ------------------------------------------------------------------ */
/* 5. Le bouton du bas : chaque passage, ou ce qui manque               */
/* ------------------------------------------------------------------ */

export type GesteDuMedia = 'passer-esquisses' | 'passer-sequences' | 'passer-montage' | 'passer-telechargement' | 'terminer' | 'revenir-esquisses';

export const LIBELLES_GESTES_DU_MEDIA: Record<GesteDuMedia, string> = {
  'passer-esquisses': 'Passer aux esquisses',
  'passer-sequences': 'Passer aux séquences vidéo',
  'passer-montage': 'Passer au montage',
  'passer-telechargement': 'Passer au téléchargement',
  terminer: 'Terminer',
  'revenir-esquisses': 'Revenir aux esquisses',
};

/** Une raison dite à l'écran : la phrase française, traduite là-bas, et ses trous. */
export interface RaisonDuMedia {
  texte: string;
  valeurs?: Record<string, string | number>;
}

export interface BoutonDuMedia {
  geste: GesteDuMedia;
  /** Le libellé, en français (traduit à l'écran). */
  libelle: string;
  possible: boolean;
  /** Pourquoi le bouton est éteint : ce qui manque, en mots courants. */
  raison?: RaisonDuMedia;
  /** Le geste d'à côté, toujours permis (« Revenir aux esquisses » depuis le montage). */
  secondaire?: { geste: GesteDuMedia; libelle: string };
}

export const RAISONS_DU_BOUTON_DU_MEDIA = {
  brief: 'Le brief n’est pas encore écrit : décrivez au directeur ce que vous voulez créer.',
  decoupage: 'Il manque le découpage en plans : le directeur l’écrit à la fin du brief.',
  pieces: 'Il manque encore : {pieces}.',
  imageDuPlan: 'Il manque l’image validée du plan « {titre} ».',
  imagesDesPlans: 'Il manque l’image validée de {n} plans : {titres}.',
  sequenceDuPlan: 'Il manque la séquence validée du plan « {titre} ».',
  sequencesDesPlans: 'Il manque la séquence validée de {n} plans : {titres}.',
  sequenceARefaire: 'La séquence du plan « {titre} » est à refaire : son image a changé.',
  voix: 'Il manque la voix off validée.',
  musique: 'Il manque la musique validée.',
  unElement: 'Validez au moins un élément pour passer au montage.',
  enFabrication: 'Une génération est encore en cours : attendez son résultat.',
  export: 'Exportez d’abord le film depuis le montage.',
  final: 'Gardez au moins un média final pour le téléchargement.',
} as const;

/** Ce qui se lit pour juger un passage. */
export interface EntreeDuPassage {
  carte: CarteDuMedia;
  /** Toutes les pièces écrites de la production (toutes versions). */
  elements?: readonly ElementDeProduction[];
  /** Tous les médias de la carte. */
  medias?: readonly MediaDuPassage[];
}

const GENRE_DU_TYPE: Record<TypeDeMediaDeRealisation, 'image' | 'video' | 'son'> = {
  image: 'image',
  video: 'video',
  musique: 'son',
  voix: 'son',
  bruitages: 'son',
  son: 'son',
};

function manqueDePlans(plans: readonly { titre: string }[], seul: string, plusieurs: string): RaisonDuMedia {
  if (plans.length === 1) return { texte: seul, valeurs: { titre: plans[0]!.titre } };
  const titres = plans
    .slice(0, 3)
    .map((p) => `« ${p.titre} »`)
    .join(', ');
  return { texte: plusieurs, valeurs: { n: plans.length, titres: plans.length > 3 ? `${titres}…` : titres } };
}

/**
 * LE PASSAGE À VENIR, PERMIS OU NON, ET CE QUI MANQUE (`boutonDuMedia`).
 *  - BRIEF → ESQUISSES : un brief écrit ; pour une vidéo, un découpage en
 *    plans ; et toutes les pièces à fournir reçues.
 *  - ESQUISSES d'une vidéo, temps 1 → SÉQUENCES : chaque plan visuel a son
 *    image validée.
 *  - ESQUISSES → MONTAGE : vidéo, chaque plan visuel a sa séquence validée (pas
 *    à refaire), et la voix off et la musique prévues au brief sont validées ;
 *    autre média, au moins un élément du bon genre validé. Jamais pendant une
 *    génération en cours.
 *  - MONTAGE → TÉLÉCHARGEMENT : une vidéo exportée ; une photo ou un son, au
 *    moins un validé (il devient final tel quel, retouché ou non).
 */
export function passageDuMedia(e: EntreeDuPassage): { geste: GesteDuMedia; possible: boolean; raison?: RaisonDuMedia } | null {
  const p = passagesDuMedia(e.carte);
  if (p.range) return null;
  const types = typesDeMediaDeLaRealisation(e.carte.realisation);
  const elements = e.elements ?? [];
  const medias = e.medias ?? [];
  const video = types.includes('video');
  const valides = medias.filter((m) => estRetenu(m));
  const enCours = medias.some((m) => m.etat === 'en-cours');

  if (!p.esquisses) {
    const brief = elementsCourants(elements).find((x) => x.genre === 'brief');
    if (!brief?.contenu.trim()) return { geste: 'passer-esquisses', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.brief } };
    if (video && !decoupageDuMedia(elements).length) return { geste: 'passer-esquisses', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.decoupage } };
    const manquantes = piecesAFournirManquantes(champsDuBrief(brief.contenu), elements);
    if (manquantes.length) return { geste: 'passer-esquisses', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.pieces, valeurs: { pieces: manquantes.join(', ') } } };
    return { geste: 'passer-esquisses', possible: true };
  }

  if (!p.montage) {
    if (video) {
      const plans = etatDesPlans(decoupageDuMedia(elements), medias).filter((x) => x.visuel);
      if (!p.sequences) {
        const sansImage = plans.filter((x) => !x.images.length);
        if (sansImage.length) return { geste: 'passer-sequences', possible: false, raison: manqueDePlans(sansImage, RAISONS_DU_BOUTON_DU_MEDIA.imageDuPlan, RAISONS_DU_BOUTON_DU_MEDIA.imagesDesPlans) };
        return { geste: 'passer-sequences', possible: true };
      }
      if (enCours) return { geste: 'passer-montage', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.enFabrication } };
      const aRefaire = plans.find((x) => x.sequence && x.aRefaire);
      if (aRefaire) return { geste: 'passer-montage', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.sequenceARefaire, valeurs: { titre: aRefaire.titre } } };
      const sansSequence = plans.filter((x) => !x.sequence);
      if (sansSequence.length) return { geste: 'passer-montage', possible: false, raison: manqueDePlans(sansSequence, RAISONS_DU_BOUTON_DU_MEDIA.sequenceDuPlan, RAISONS_DU_BOUTON_DU_MEDIA.sequencesDesPlans) };
      const son = sonDuBrief(elementsCourants(elements).find((x) => x.genre === 'brief')?.contenu);
      if (son.voix && !valides.some((m) => m.capacite === 'voix')) return { geste: 'passer-montage', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.voix } };
      if (son.musique && !valides.some((m) => m.capacite === 'musique')) return { geste: 'passer-montage', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.musique } };
      return { geste: 'passer-montage', possible: true };
    }
    if (enCours) return { geste: 'passer-montage', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.enFabrication } };
    const genres = new Set(types.map((t) => GENRE_DU_TYPE[t]));
    if (!valides.some((m) => !genres.size || genres.has(m.genre))) return { geste: 'passer-montage', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.unElement } };
    return { geste: 'passer-montage', possible: true };
  }

  if (!p.telechargement) {
    if (video) {
      if (!(e.carte.realisation?.finaux ?? []).some((f) => f.genre === 'video')) {
        return { geste: 'passer-telechargement', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.export } };
      }
      return { geste: 'passer-telechargement', possible: true };
    }
    if (!valides.length && !(e.carte.realisation?.finaux ?? []).length) return { geste: 'passer-telechargement', possible: false, raison: { texte: RAISONS_DU_BOUTON_DU_MEDIA.final } };
    return { geste: 'passer-telechargement', possible: true };
  }

  return { geste: 'terminer', possible: true };
}

/**
 * LE BOUTON PRINCIPAL D'UNE CRÉATION DE MÉDIA : le passage à venir, allumé
 * ou éteint avec ce qui manque, et « Revenir aux esquisses » à côté pendant le
 * montage. Une carte rangée n'en a plus (`null`). Aucun bouton ne dépense :
 * chaque génération garde son propre bouton à prix, dans le fil.
 */
export function boutonDuMedia(e: EntreeDuPassage): BoutonDuMedia | null {
  const passage = passageDuMedia(e);
  if (!passage) return null;
  const p = passagesDuMedia(e.carte);
  return {
    geste: passage.geste,
    libelle: LIBELLES_GESTES_DU_MEDIA[passage.geste],
    possible: passage.possible,
    ...(passage.raison ? { raison: passage.raison } : {}),
    ...(p.montage && !p.telechargement ? { secondaire: { geste: 'revenir-esquisses' as const, libelle: LIBELLES_GESTES_DU_MEDIA['revenir-esquisses'] } } : {}),
  };
}

/**
 * CE QU'UN PASSAGE ÉCRIT SUR LA CARTE (`realisation.passer`, côté démon).
 * Refusé quand il n'est pas permis, ou quand ce n'est pas le passage à venir
 * (deux clics, deux onglets) ; « Revenir aux esquisses » efface le montage et
 * le téléchargement sans toucher au travail fait dans le studio.
 */
export function passageAEcrire(
  e: EntreeDuPassage & { geste: GesteDuMedia; maintenant: number },
): { ok: true; realisation: Partial<EtatDeRealisation>; deja?: boolean } | { ok: false; raison: string } {
  const r = e.carte.realisation ?? {};
  if (e.geste === 'revenir-esquisses') {
    const p = passagesDuMedia(e.carte);
    if (!p.montage || p.range) return { ok: false, raison: 'la carte n’est pas au montage' };
    return { ok: true, realisation: { montageA: undefined, telechargementA: undefined, filmSoumisA: undefined, filmValideA: undefined } };
  }
  const passage = passageDuMedia(e);
  if (!passage) return { ok: false, raison: 'la carte est rangée' };
  if (passage.geste !== e.geste) {
    const deja: Partial<Record<GesteDuMedia, boolean>> = {
      'passer-esquisses': !!r.esquissesA || passagesDuMedia(e.carte).esquisses,
      'passer-sequences': !!r.sequencesA,
      'passer-montage': passagesDuMedia(e.carte).montage,
      'passer-telechargement': passagesDuMedia(e.carte).telechargement,
    };
    if (deja[e.geste]) return { ok: true, realisation: {}, deja: true };
    return { ok: false, raison: `ce n’est pas l’étape suivante (attendu : ${LIBELLES_GESTES_DU_MEDIA[passage.geste]})` };
  }
  if (!passage.possible) {
    const raison = passage.raison ? remplir(passage.raison) : 'passage impossible';
    return { ok: false, raison };
  }
  const t = e.maintenant;
  switch (e.geste) {
    case 'passer-esquisses':
      return { ok: true, realisation: { esquissesA: t } };
    case 'passer-sequences':
      return { ok: true, realisation: { sequencesA: t } };
    case 'passer-montage':
      return { ok: true, realisation: { montageA: r.montageA ?? t } };
    case 'passer-telechargement':
      return { ok: true, realisation: { telechargementA: t } };
    default:
      return { ok: true, realisation: {} };
  }
}

/** Une raison remplie, en français (journal, réponse d'une commande). */
export function remplir(raison: RaisonDuMedia): string {
  return raison.texte.replace(/\{(\w+)\}/g, (_, k: string) => String(raison.valeurs?.[k] ?? ''));
}

/* ------------------------------------------------------------------ */
/* 6. Le volet « Suivi de la production » sur les mêmes quatre étapes   */
/* ------------------------------------------------------------------ */

/**
 * LES PIÈCES DU SUIVI RANGÉES SOUS CHAQUE ÉTAPE : l'écrit (brief, direction,
 * scénario, storyboard, plans) sous « Brief » ; les médias VALIDÉS sous
 * « Esquisses » ; le montage et l'export sous « Montage » ; la livraison sous
 * « Téléchargement ». Le volet ne garde que le validé (décision du
 * 26/10/2026) : tout le reste vit dans la conversation et la bande du bas.
 */
export const SOUS_ETAPES_DU_MEDIA: Record<EtapeDuMedia, readonly EtapeDuSuivi[]> = {
  brief: ['brief', 'direction', 'style', 'scenario', 'ecriture', 'storyboard'],
  esquisses: ['plans', 'creation', 'son', 'creation-sonore'],
  montage: ['montage', 'export'],
  telechargement: ['livraison'],
};

/** Un bloc d'une étape : les pièces d'une étape du suivi (brief, direction…), sous son nom. */
export type BlocDuMedia = Pick<EtapeDuVoletDeSuivi, 'etape' | 'elements' | 'medias' | 'ambiance'>;

export interface EtapeDuVoletDuMedia {
  etape: EtapeDuMedia;
  etat: EtatDEtapeDuSuivi;
  blocs: BlocDuMedia[];
}

/** L'état d'un segment, dit dans la langue du volet. */
function etatDuVolet(etape: EtapeDuMedia, etat: EtatDuPoint): EtatDEtapeDuSuivi {
  if (etat === 'fait') return etape === 'brief' ? 'validee' : 'terminee';
  if (etat === 'encours') return 'en-cours';
  if (etat === 'question') return 'a-valider';
  if (etat === 'erreur') return 'erreur';
  return 'a-definir';
}

/**
 * LE VOLET DU MÉDIA : les quatre étapes de la barre, dans le même état,
 * chacune avec les pièces qui lui reviennent. Les écrits restent sous le brief
 * (les plans écrits compris), les médias validés sous les esquisses ; rien ne
 * se perd : une étape du suivi absente de la table tombe sous « Esquisses ».
 * Jamais de média « en conception » ni de pièce non validée.
 */
export function voletDuMedia(volet: readonly EtapeDuVoletDeSuivi[], segments: readonly { etape: EtapeDuMedia; etat: EtatDuPoint }[]): EtapeDuVoletDuMedia[] {
  const rangees = new Set(Object.values(SOUS_ETAPES_DU_MEDIA).flat());
  return segments.map(({ etape, etat }) => {
    const blocs: BlocDuMedia[] = [];
    for (const x of volet) {
      /* Les plans ÉCRITS vont au brief ; leurs médias validés aux esquisses. */
      const ecritDesPlans = x.etape === 'plans' && etape === 'brief';
      const ici = ecritDesPlans || SOUS_ETAPES_DU_MEDIA[etape].includes(x.etape) || (etape === 'esquisses' && !rangees.has(x.etape));
      if (!ici) continue;
      const ecrit = x.etape !== 'plans' || etape === 'brief';
      const fabrique = x.etape !== 'plans' || etape === 'esquisses';
      const bloc: BlocDuMedia = {
        etape: x.etape,
        elements: ecrit ? x.elements : [],
        medias: fabrique ? x.medias.filter((m) => estRetenu(m)) : [],
        ambiance: ecrit ? x.ambiance : [],
      };
      if (!bloc.elements.length && !bloc.medias.length && !bloc.ambiance.length && etape !== 'brief') continue;
      blocs.push(bloc);
    }
    return { etape, etat: etatDuVolet(etape, etat), blocs };
  });
}

/* ------------------------------------------------------------------ */
/* 7. La page Téléchargement : finaux, validés, esquisses               */
/* ------------------------------------------------------------------ */

export const SECTIONS_DU_TELECHARGEMENT = ['finaux', 'valides', 'esquisses'] as const;
export type SectionDuTelechargement = (typeof SECTIONS_DU_TELECHARGEMENT)[number];

/** Le nom de chaque section, et du dossier de l'archive (traduit à l'écran et dans l'archive). */
export const LIBELLES_SECTIONS_DU_TELECHARGEMENT: Record<SectionDuTelechargement, string> = {
  finaux: 'Médias finaux',
  valides: 'Validés',
  esquisses: 'Esquisses',
};

/** Un fichier de la page : sa pièce jointe, son genre, son nom lisible. */
export interface FichierDuTelechargement {
  piece: string;
  genre: 'image' | 'video' | 'son';
  nom: string;
  /** Le média de production d'où il vient (rien pour un final rendu par un studio). */
  mediaId?: string;
}

/** Un nom de fichier sûr et lisible : « titre-plan-v2 ». */
export function nomDeFichierLisible(morceaux: readonly (string | number | null | undefined)[]): string {
  return (
    morceaux
      .filter((m) => m !== null && m !== undefined && String(m).trim())
      .map((m) =>
        String(m)
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      )
      .filter(Boolean)
      .join('-')
      .slice(0, 90) || 'media'
  );
}

/**
 * LES TROIS SECTIONS DU TÉLÉCHARGEMENT, de haut en bas (décision du
 * 26/10/2026) : les MÉDIAS FINAUX (rendus des studios, exports du montage ; à
 * défaut, pour une photo ou un son, chaque validé tel quel), les VALIDÉS, puis
 * TOUTES LES ESQUISSES de la carte, validées ou non. Un média à la fois validé
 * et final paraît dans les deux sections. Rien d'en cours ni de raté.
 */
export function sectionsDuTelechargement(e: {
  titre: string;
  types: readonly TypeDeMediaDeRealisation[];
  medias: readonly (MediaDuPassage & { attachmentId: string | null; version: number })[];
  /** Les finaux rendus par les studios et les exports prêts du montage. */
  finaux: readonly { piece: string; genre: 'image' | 'video' | 'son'; nom?: string; source?: string | null }[];
}): Record<SectionDuTelechargement, FichierDuTelechargement[]> {
  const finis = e.medias.filter((m) => m.etat === 'fini' && m.attachmentId).sort((a, b) => a.creeLe - b.creeLe);
  const fichier = (m: (typeof finis)[number]): FichierDuTelechargement => ({ piece: m.attachmentId!, genre: m.genre, nom: nomDeFichierLisible([e.titre, m.plan, `v${m.version}`]), mediaId: m.id });
  const valides = finis.filter((m) => estRetenu(m));
  const finaux: FichierDuTelechargement[] = e.finaux.map((f, i) => ({ piece: f.piece, genre: f.genre, nom: f.nom ? nomDeFichierLisible([e.titre, f.nom]) : nomDeFichierLisible([e.titre, 'final', i + 1]) }));
  /* UNE PHOTO OU UN SON VALIDÉ DEVIENT FINAL TEL QUEL quand le studio ne l'a pas retouché. */
  if (!e.types.includes('video')) {
    const retouches = new Set(e.finaux.map((f) => f.source).filter(Boolean));
    for (const m of valides) {
      if (retouches.has(m.id) || retouches.has(m.attachmentId)) continue;
      if (!finaux.some((f) => f.piece === m.attachmentId)) finaux.push({ ...fichier(m), nom: nomDeFichierLisible([e.titre, 'final', m.plan, `v${m.version}`]) });
    }
  }
  return { finaux, valides: valides.map(fichier), esquisses: finis.map(fichier) };
}
