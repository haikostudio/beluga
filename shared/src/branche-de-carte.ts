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

/**
 * CETTE BRANCHE EST-ELLE CELLE DE CETTE CARTE ?
 *
 * Le nom entier ne suffit pas : il porte le TITRE, et un titre peut changer
 * entre le moment où la branche est créée et celui où on la retrouve — après un
 * redémarrage, par exemple. La comparaison de nom entier échouait alors, et le
 * travail retrouvé sur la branche n'était rattaché à aucune carte : celle-ci
 * repartait sans son drapeau « code déjà enregistré », pour s'entendre dire
 * ensuite qu'aucun fichier n'avait changé.
 *
 * Seul le NUMÉRO ne bouge jamais. Il est posé en fin de branche par
 * `nomDeBranche` (les six premiers signes de l'identifiant) : c'est lui qu'on
 * reconnaît, quel que soit le titre du jour.
 */
export function estLaBrancheDeLaCarte(branche: string, cardId: string): boolean {
  const nom = (branche ?? '').trim();
  const signature = (cardId ?? '').slice(0, 6);
  if (!nom.startsWith('tache/') || !signature) return false;
  return nom.endsWith(`-${signature}`);
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
 * Deux agents qui basculent chacun sur SA branche dans la même copie de travail
 * se volent les fichiers l'un à l'autre. La carte qui arrive en second n'échoue
 * pas — elle attend son tour, en le disant.
 *
 * Depuis que chaque carte lancée reçoit SA copie de travail
 * (`cheminDossierDeCarte`, `git worktree`), la porte ne retient plus que le cas
 * RÉEL : deux cartes qui visent le même dossier — une carte relancée pendant que
 * son propre agent tourne encore, ou un agent d'avant ce changement, resté dans
 * le dossier du projet. Le verdict lui-même n'a pas bougé : ce sont les dossiers
 * comparés qui sont devenus ceux des cartes.
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
