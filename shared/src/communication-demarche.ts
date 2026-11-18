/**
 * LA DÉMARCHE D'UNE MARQUE — ce que l'accueil montre en premier, sous les chiffres (décision de
 * l'utilisateur du 03/11/2026 : plus de bandeau « niveau + quêtes », un fil vertical des étapes avec
 * leur niveau de complétion). Quatre étapes, dans l'ordre où le directeur marketing les mène :
 *
 *   1. relier un premier compte (sans lui, rien ne part et rien ne se mesure) ;
 *   2. l'analyse de la marque (le bilan, ou l'analyse approfondie de l'outil Marketing) ;
 *   3. les objectifs, chiffrés et datés ;
 *   4. les campagnes, une au moins par objectif.
 *
 * Tout se calcule sur ce qui est en base, rien sur une déclaration. La PREMIÈRE étape non faite est
 * « en cours » : c'est elle que l'écran met en avant et que la colonne des marques nomme.
 */

export const ETAPES_DE_DEMARCHE = ['compte', 'analyse', 'objectifs', 'campagnes'] as const;
export type EtapeDeDemarcheId = (typeof ETAPES_DE_DEMARCHE)[number];
export type EtatDEtape = 'fait' | 'en_cours' | 'a_faire';

export interface EntreeDeDemarche {
  comptesRelies: number;
  /** Les réseaux retenus pour la marque (configuration) : le compte attendu. */
  reseauxChoisis: number;
  /** Un bilan écrit par le directeur. */
  bilan: boolean;
  /** L'analyse approfondie : son avancement en pour cent quand elle tourne, 100 quand elle est close. */
  analyseApprofondie?: number | null;
  /** Les objectifs ACTIFS ou ATTEINTS (un objectif seulement proposé ne compte pas encore). */
  objectifs: number;
  objectifsProposes: number;
  objectifsAtteints: number;
  /** Les objectifs actifs qui ont au moins une campagne. */
  objectifsCouverts: number;
  campagnesEnCours: number;
  campagnesEnPreparation: number;
  campagnesTerminees: number;
}

export interface EtapeDeDemarche {
  id: EtapeDeDemarcheId;
  etat: EtatDEtape;
  /** De 0 à 100. */
  pourcent: number;
  /** Ce qui est fait sur ce qui est attendu (« 1 / 3 ») ; absent quand l'étape ne se compte pas. */
  fait?: number;
  total?: number;
}

export interface DemarcheDeMarque {
  etapes: EtapeDeDemarche[];
  /** La première étape non faite ; `null` quand tout est fait. */
  enCours: EtapeDeDemarcheId | null;
  /** L'avancement d'ensemble, de 0 à 100 (chaque étape pèse autant). */
  avancement: number;
}

const borne = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function demarcheDeLaMarque(e: EntreeDeDemarche): DemarcheDeMarque {
  const attendus = Math.max(1, e.reseauxChoisis);
  const compte = { id: 'compte' as const, pourcent: e.comptesRelies > 0 ? 100 : 0, fait: Math.min(e.comptesRelies, attendus), total: Math.max(attendus, e.comptesRelies) };
  const approfondie = typeof e.analyseApprofondie === 'number' && Number.isFinite(e.analyseApprofondie) ? borne(e.analyseApprofondie) : null;
  const analyse = { id: 'analyse' as const, pourcent: e.bilan || approfondie === 100 ? 100 : approfondie ?? 0 };
  const objectifs = {
    id: 'objectifs' as const,
    /* Des objectifs seulement PROPOSÉS par le directeur : l'étape est entamée, pas faite — la décision reste à l'utilisateur. */
    pourcent: e.objectifs > 0 ? 100 : e.objectifsProposes > 0 ? 50 : 0,
    fait: e.objectifsAtteints,
    total: e.objectifs,
  };
  const campagnesEnTout = e.campagnesEnCours + e.campagnesEnPreparation + e.campagnesTerminees;
  const campagnes = {
    id: 'campagnes' as const,
    pourcent: e.objectifs > 0 ? borne((Math.min(e.objectifsCouverts, e.objectifs) / e.objectifs) * 100) : campagnesEnTout > 0 ? 50 : 0,
    fait: e.objectifs > 0 ? Math.min(e.objectifsCouverts, e.objectifs) : undefined,
    total: e.objectifs > 0 ? e.objectifs : undefined,
  };
  const brutes = [compte, analyse, objectifs, campagnes];
  const premiere = brutes.find((b) => b.pourcent < 100)?.id ?? null;
  const etapes: EtapeDeDemarche[] = brutes.map((b) => {
    const { fait, total, ...reste } = b as typeof b & { fait?: number; total?: number };
    return {
      ...reste,
      etat: b.pourcent >= 100 ? 'fait' : b.id === premiere ? 'en_cours' : 'a_faire',
      ...(typeof fait === 'number' && typeof total === 'number' && total > 0 ? { fait, total } : {}),
    };
  });
  return { etapes, enCours: premiere, avancement: borne(brutes.reduce((t, b) => t + b.pourcent, 0) / brutes.length) };
}

/* ------------------------------------------------------------------ */
/* Les objectifs d'une marque                                           */
/* ------------------------------------------------------------------ */

/** Ce qu'un objectif mesure : ce que Beluga sait lire, rien qu'on doive déclarer. */
export const MESURES_D_OBJECTIF = ['visites', 'clics', 'vues', 'abonnes', 'publications'] as const;
export type MesureDObjectif = (typeof MESURES_D_OBJECTIF)[number];

/**
 * `propose` : écrit par le directeur, il attend l'accord de l'utilisateur (bouton « objectif.valider ») ;
 * `actif` : retenu, les campagnes s'y rattachent ; `atteint` / `abandonne` : clos.
 */
export const STATUTS_D_OBJECTIF = ['propose', 'actif', 'atteint', 'abandonne'] as const;
export type StatutDObjectif = (typeof STATUTS_D_OBJECTIF)[number];

export interface ObjectifDeMarque {
  id: string;
  marqueId: string;
  titre: string;
  mesure: MesureDObjectif;
  cible: number | null;
  /** AAAA-MM-JJ. */
  echeance: string | null;
  /** Pourquoi cet objectif sert la rentabilité de la marque, en une phrase. */
  pourquoi: string | null;
  statut: StatutDObjectif;
  creeLe: number;
}

/** L'avancement d'un objectif, de 0 à 100, ou `null` sans cible chiffrée. */
export function avancementDObjectif(objectif: Pick<ObjectifDeMarque, 'cible' | 'statut'>, atteint: number): number | null {
  if (objectif.statut === 'atteint') return 100;
  if (!objectif.cible || objectif.cible <= 0) return null;
  return borne((atteint / objectif.cible) * 100);
}
