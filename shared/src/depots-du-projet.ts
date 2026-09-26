import type { DepotAnnexe, Project } from './models.js';

/**
 * LES PROJETS À PLUSIEURS DÉPÔTS — règles pures, sans base ni disque.
 *
 * Un projet a TOUJOURS un dépôt principal : son dossier (`Project.path`) et
 * tous les réglages d'aujourd'hui (branches, procédures, adresse, port). Il peut
 * porter en plus des dépôts ANNEXES (`Project.depots`), chacun avec son nom
 * court, son dossier, ses branches et sa façon de se mettre en ligne. Un projet
 * sans annexe est un projet à dépôt simple, exactement comme avant.
 *
 * Tout ce qui parcourt « les dépôts du projet » passe par `depotsDuProjet` : le
 * principal d'abord, puis les annexes dans l'ordre où ils ont été ajoutés.
 */

/** Le nom réservé du dépôt principal : aucun annexe ne peut le porter. */
export const NOM_DU_DEPOT_PRINCIPAL = 'principal';

/** Un dépôt vu d'un bloc, principal ou annexe. */
export interface DepotDuProjet {
  nom: string;
  path: string;
  principal: boolean;
}

/** Le projet porte-t-il au moins un dépôt annexe ? */
export function aPlusieursDepots(project: Pick<Project, 'depots'>): boolean {
  return (project.depots ?? []).length > 0;
}

/** Tous les dépôts du projet : le principal, puis les annexes. */
export function depotsDuProjet(project: Pick<Project, 'path' | 'depots'>): DepotDuProjet[] {
  return [
    { nom: NOM_DU_DEPOT_PRINCIPAL, path: project.path, principal: true },
    ...(project.depots ?? []).map((depot) => ({ nom: depot.nom, path: depot.path, principal: false })),
  ];
}

/** L'annexe de ce nom, s'il existe. */
export function depotAnnexe(project: Pick<Project, 'depots'>, nom: string): DepotAnnexe | undefined {
  return (project.depots ?? []).find((depot) => depot.nom === nom);
}

/**
 * LE DÉPÔT ANNEXE VU COMME UN PROJET, pour réutiliser tel quel tout ce qui sait
 * travailler sur « un projet à un dossier » (branche de l'étape, procédure,
 * moyens constatés, cible de mise en production). Tout ce qui décrit le projet
 * lui-même (nom, moteur, facturation) est gardé ; tout ce qui décrit le DÉPÔT
 * vient de l'annexe. `isSelf` tombe : Beluga Build ne se publie jamais comme
 * annexe d'un autre projet.
 */
export function projetDuDepot(project: Project, depot: DepotAnnexe): Project {
  return {
    ...project,
    path: depot.path,
    gitRemote: depot.gitRemote,
    branchesDePublication: depot.branchesDePublication ?? {},
    deploiement: depot.deploiement ?? {},
    miseEnProduction: depot.miseEnProduction ?? {},
    devUrl: depot.devUrl,
    port: depot.port,
    isSelf: false,
    vitrineLiee: undefined,
    depots: [],
  };
}

/** Une copie de travail ouverte pour une carte, dépôt par dépôt. */
export interface CopieDeDepot {
  nom: string;
  dossier: string;
}

/**
 * LA CONSIGNE QUI DIT À L'AGENT OÙ VIT CHAQUE PARTIE. Vide pour un projet à
 * dépôt simple : sa consigne ne change pas d'un signe.
 */
export function consigneDesDepots(branche: string, principale: string, annexes: CopieDeDepot[]): string {
  if (!annexes.length) return '';
  const lignes = annexes.map((copie) => `- « ${copie.nom} » : ${copie.dossier}`);
  return (
    `CE PROJET A PLUSIEURS DÉPÔTS. Ton dossier de départ (${principale}) est la copie du dépôt principal. ` +
    `Les autres dépôts du projet ont chacun leur copie de travail, sur la MÊME branche « ${branche} », ouvertes en écriture pour toi :\n` +
    `${lignes.join('\n')}\n` +
    'Modifie chaque dépôt dans SA copie, jamais dans le dossier d’origine du dépôt ; enregistre (commit) et sauvegarde (push) dans chaque copie que tu as touchée. ' +
    'Beluga Build range chaque copie à la fin du tour, et la publication traite chaque dépôt.'
  );
}

/* ------------------------------------------------------------------ */
/* PUBLIER UN SEUL DÉPÔT                                               */
/* ------------------------------------------------------------------ */

/**
 * LES DÉPÔTS QU'UNE CARTE DU LOT A RÉELLEMENT MODIFIÉS. Relevé côté démon, sur
 * git (la branche de la carte existe dans le dépôt ET y apporte au moins un
 * enregistrement) ; ici, seulement ce qu'on en déduit.
 */
export interface DepotsDeCarte {
  cardId: string;
  depots: string[];
}

/**
 * LES CARTES QUI PARTENT AVEC LE BOUTON D'UN DÉPÔT : celles qui touchent ce
 * dépôt, plus celles qui ne touchent AUCUN dépôt (une carte sans code n'a rien
 * à fusionner, elle ne fait que se clore avec le lot). Une carte qui ne touche
 * que d'autres dépôts reste dans « À déployer ».
 */
export function cartesPourLeDepot(touches: DepotsDeCarte[], nom: string): string[] {
  return touches.filter((t) => !t.depots.length || t.depots.includes(nom)).map((t) => t.cardId);
}

/** Combien de cartes touchent RÉELLEMENT ce dépôt : c'est ce qui allume son bouton. */
export function nombreDeCartesDuDepot(touches: DepotsDeCarte[], nom: string): number {
  return touches.filter((t) => t.depots.includes(nom)).length;
}

/**
 * LES DÉPÔTS QU'EMPORTE UNE SÉLECTION DE CARTES : une carte part EN ENTIER,
 * jamais à moitié — une carte qui touche l'application ET l'administration
 * fait partir les deux. Rendus dans l'ordre du projet.
 */
export function depotsEmportes(
  project: Pick<Project, 'path' | 'depots'>,
  touches: DepotsDeCarte[],
  cardIds: string[],
): string[] {
  const retenues = new Set(cardIds);
  const noms = new Set(touches.filter((t) => retenues.has(t.cardId)).flatMap((t) => t.depots));
  return depotsDuProjet(project)
    .map((d) => d.nom)
    .filter((nom) => noms.has(nom));
}

/**
 * LES AUTRES DÉPÔTS QUI PARTIRONT AVEC LE BOUTON DE CE DÉPÔT, à cause des
 * cartes qui touchent plusieurs dépôts. Vide quand le dépôt part seul.
 */
export function depotsEntraines(
  project: Pick<Project, 'path' | 'depots'>,
  touches: DepotsDeCarte[],
  nom: string,
): string[] {
  return depotsEmportes(project, touches, cartesPourLeDepot(touches, nom)).filter((d) => d !== nom);
}

/**
 * Les dépôts d'un travail ENREGISTRÉ SANS CARTE puis fiché : ses titres
 * portent « [nom] » quand ils viennent d'un annexe, rien quand ils viennent du
 * principal.
 */
export function depotsDesTitres(titres: string[], noms: string[]): string[] {
  const vus = new Set<string>();
  for (const titre of titres) {
    const lu = /^\[([a-z0-9][a-z0-9-]{0,23})\] /.exec(titre ?? '');
    vus.add(lu && noms.includes(lu[1]!) ? lu[1]! : NOM_DU_DEPOT_PRINCIPAL);
  }
  return [...vus];
}

/**
 * LES DÉPÔTS QUI MÉRITENT LEUR BOUTON « Publier seulement … » : ceux qu'au moins
 * une carte du lot modifie. Un dépôt que rien ne touche n'a plus de bouton
 * éteint « (0) » — il n'y a rien à publier, donc rien à proposer (23/09/2026).
 */
export function depotsAPublierSeuls(
  project: Pick<Project, 'path' | 'depots'>,
  touches: DepotsDeCarte[],
): Array<DepotDuProjet & { nombre: number }> {
  return depotsDuProjet(project)
    .map((depot) => ({ ...depot, nombre: nombreDeCartesDuDepot(touches, depot.nom) }))
    .filter((depot) => depot.nombre > 0);
}
