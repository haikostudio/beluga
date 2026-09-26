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
  "Le dossier de ce projet n'a pas d'historique des versions : l'agent ne pourrait rien y enregistrer. Indiquez dans les réglages du projet le dossier qui en a un.";

/**
 * LE DOSSIER D'UN PROJET PEUT ÊTRE INJOIGNABLE SANS ÊTRE « SANS DÉPÔT ».
 *
 * Constat qui a produit cette phrase : les dossiers des projets vivent sur un
 * stockage distant monté sur la machine. Quand ce montage tombe, chaque dossier
 * répond « Transport endpoint is not connected » — git échoue, et la porte du
 * dépôt annonçait alors « ce projet n'est pas déclaré sur un dépôt git ». La
 * phrase envoyait chercher un réglage qui n'avait jamais bougé, pendant que la
 * vraie panne — le stockage décroché — restait invisible sur DIX-NEUF projets à
 * la fois.
 */
export const RAISON_DOSSIER_INJOIGNABLE =
  "Le stockage où vit ce projet ne répond plus, et la reconnexion automatique n'a pas suffi. Aucun réglage n'est en cause et rien n'est perdu : réessayez dans une minute.";

/**
 * L'ÉTAT RÉEL DU DOSSIER D'UN PROJET, EN TROIS CAS QUI NE SE CONFONDENT PAS.
 *
 * `depot` : git répond, tout va bien. `sans-depot` : le dossier est là mais
 * n'est pas un dépôt — c'est un réglage à faire. `injoignable` : le dossier
 * lui-même ne répond pas — c'est une panne.
 */
export type EtatDuDossier = 'depot' | 'sans-depot' | 'injoignable';

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
 *
 * Le refus DIT lequel des trois cas s'est produit : un dossier injoignable
 * n'est pas un projet mal déclaré, et lui servir la phrase du réglage envoie
 * chercher au mauvais endroit.
 */
export function porteDuDepot(etat: boolean | EtatDuDossier): VerdictBranche {
  const reel: EtatDuDossier =
    typeof etat === 'boolean' ? (etat ? 'depot' : 'sans-depot') : etat;
  if (reel === 'depot') return { ok: true };
  if (reel === 'injoignable') return { ok: false, raison: RAISON_DOSSIER_INJOIGNABLE };
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

/**
 * CETTE BRANCHE PEUT-ELLE ÊTRE REFERMÉE À L'ARCHIVAGE ?
 *
 * L'archivage d'une carte renomme sa branche `tache/x` en `archive/tache/x`.
 * Mais toutes les cartes ne portent pas une branche à elles : celles du travail
 * hors tâche (rangement de nuit, travaux enregistrés hors carte, correctifs
 * posés directement) portent la branche PRINCIPALE du dépôt — `main`, `dev`.
 * Les archiver renommait donc `main` en `archive/main`, puis `archive/main` en
 * `archive/archive/main` à l'archivage suivant.
 *
 * Deux dégâts, tous deux constatés sur Beluga Build : la branche courante du dépôt
 * n'avait plus d'amont, donc plus RIEN ne partait chez GitHub (116 commits
 * restés au sol, invisibles sur le dépôt distant) ; et le dépôt se couvrait de
 * branches fantômes `archive/archive/…` sans contenu propre.
 *
 * On ne referme donc QUE ce qui est vraiment la branche d'une carte, et jamais
 * une branche déjà refermée.
 */
export function brancheRefermableALArchivage(branche: string | undefined | null): boolean {
  const nom = (branche ?? '').trim();
  if (!nom) return false;
  if (nom.startsWith('archive/')) return false;
  return nom.startsWith('tache/');
}
