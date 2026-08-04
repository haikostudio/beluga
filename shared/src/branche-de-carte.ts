/**
 * UNE CARTE LANCÉE = UNE BRANCHE, DANS UN DOSSIER QU'ELLE NE PARTAGE PAS.
 *
 * Constat qui a produit cette règle : sur le projet Root, le journal des
 * déplacements du dépôt (`git reflog`) ne montrait AUCUN changement de branche,
 * et trois agents lancés à quinze secondes d'intervalle voyaient tous `main`.
 * Deux causes, aucune dite à l'utilisateur :
 *
 *  1. le projet était déclaré sur son dossier SERVI, qui n'est pas un dépôt git :
 *     la préparation de branche se taisait (« pas un dépôt, l'agent travaille sur
 *     place ») et l'agent partait sans branche, sans rien pouvoir prouver ;
 *  2. l'ordonnanceur démarre les cartes planifiées d'un projet à la suite, dans
 *     LE MÊME dossier de travail : la deuxième `git checkout -B` arrachait la
 *     copie de travail à la première, et les tours se mélangeaient.
 *
 * Les deux verdicts vivent ici, sans base ni disque : le démon les rejoue comme
 * portes DURES avant tout lancement, et la raison s'affiche sur la carte au lieu
 * de laisser partir un agent sur `main`.
 */

/** Un verdict de porte : passe, ou refuse en disant pourquoi. */
export interface VerdictBranche {
  ok: boolean;
  /** Ce qui s'écrit sur la carte quand ça ne passe pas. */
  raison?: string;
}

/** Un agent de tâche qui occupe déjà un dossier de travail. */
export interface OccupantDossier {
  /** La carte pour laquelle il travaille. */
  cardId: string;
  /** Son titre, pour nommer le voisin dans le refus. */
  titre?: string;
  /** Le dossier de travail du projet de cette carte. */
  dossier: string;
}

export const RAISON_SANS_DEPOT =
  "Ce projet n'est pas déclaré sur un dépôt git : aucune branche « tache/… » ne peut être créée, et rien de ce que l'agent écrirait ne serait enregistré ni vérifiable. Déclarer le projet sur son dépôt de travail.";

/**
 * Le nom de branche d'une carte : « tache/<titre> - <début du numéro> ». Sans
 * titre exploitable, on garde au moins le numéro — jamais de branche anonyme.
 */
export function nomDeBranche(titre: string, cardId: string): string {
  const slug = (titre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `tache/${slug || 'sans-titre'}-${cardId.slice(0, 6)}`;
}

/** Deux chemins qui désignent le même dossier (barre finale, espaces). */
export function memeDossier(a: string | undefined | null, b: string | undefined | null): boolean {
  const propre = (v: string | undefined | null) => (v ?? '').trim().replace(/\/+$/, '');
  const ga = propre(a);
  const gb = propre(b);
  return ga.length > 0 && ga === gb;
}

/**
 * Porte dure : un projet sans dépôt git ne lance pas de carte.
 *
 * Ce n'est pas une précaution de plus, c'est la condition de tout le reste : pas
 * de dépôt, pas de branche, donc pas de trace, pas de constat de modification,
 * pas de lot à publier. Mieux vaut un refus lisible qu'un agent qui écrit dans
 * le vide.
 */
export function porteDuDepot(estDepotGit: boolean): VerdictBranche {
  if (estDepotGit) return { ok: true };
  return { ok: false, raison: RAISON_SANS_DEPOT };
}

/**
 * Porte dure : une seule carte à la fois par dossier de travail.
 *
 * Le dossier d'un projet est partagé : deux agents qui y basculent chacun sur SA
 * branche se volent les fichiers l'un à l'autre. La carte qui arrive en second
 * n'échoue pas — elle attend son tour, en le disant.
 */
export function porteDuDossier(
  entree: { cardId: string; dossier: string },
  occupants: OccupantDossier[],
): VerdictBranche {
  const voisin = (occupants ?? []).find(
    (o) => o.cardId !== entree.cardId && memeDossier(o.dossier, entree.dossier),
  );
  if (!voisin) return { ok: true };
  return {
    ok: false,
    raison: `Un autre agent travaille déjà dans ce dossier${
      voisin.titre ? ` (carte « ${voisin.titre} »)` : ''
    } : deux cartes ne peuvent pas se partager la même copie de travail. Cette carte démarrera dès que l'autre aura rendu.`,
  };
}
