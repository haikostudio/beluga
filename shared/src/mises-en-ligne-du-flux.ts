/**
 * CHAQUE DÉPLOIEMENT ET CHAQUE MISE EN PRODUCTION EST UNE LIGNE DU FLUX DE SON PROJET (décision du 31/10/2026).
 *
 * « Le processus doit activer une ligne comme si c'était un agent » : un lancement crée une NOUVELLE ligne, rangée à
 * sa date parmi les tâches du projet (colonne de gauche, page du projet, tableaux de bord). Pendant le travail, la
 * ligne est encadrée avec sa barre d'avancement ; finie, elle passe en archivée et défile dans le flux comme une
 * carte archivée. Aucun regroupement, aucune place à part en tête de colonne.
 *
 * Ce fichier ne porte que les règles pures : la date d'une ligne, sa fusion avec les cartes, le compte des paquets
 * et la mise à jour par événement. Il se teste seul.
 */
import type { PublicationSysteme } from './cartes-systeme.js';

/** Une mise en ligne par paquet de lecture : le même pas que les tâches de la colonne. */
export const MISES_EN_LIGNE_PAR_PAQUET = 5;

/** Le curseur de la lecture par date des mises en ligne : la date de la ligne, puis son identifiant. */
export interface CurseurDeMiseEnLigne {
  at: number;
  id: string;
}

/** LA DATE D'UNE LIGNE : sa fin quand elle est finie, son départ sinon — sa dernière modification. */
export function dateDeLaMiseEnLigne(run: Pick<PublicationSysteme, 'startedAt' | 'endedAt'>): number {
  return run.endedAt ?? run.startedAt;
}

/** La plus récente d'abord ; à date égale, le même ordre que le démon (`id DESC`). */
export function comparerMisesEnLigne(a: PublicationSysteme, b: PublicationSysteme): number {
  const da = dateDeLaMiseEnLigne(a);
  const db = dateDeLaMiseEnLigne(b);
  if (da !== db) return db - da;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Une mise en ligne qui tourne encore : elle ne quitte jamais la liste, comme un agent actif. */
export function miseEnLigneActive(run: Pick<PublicationSysteme, 'state'>): boolean {
  return run.state === 'running';
}

/**
 * UNE MISE EN LIGNE TOMBÉE RESTE AVEC LES TÂCHES EN COURS (décision de l'utilisateur, 17/11/2026 : « elle doit rester à
 * gauche, en cours, avec un point rouge ») : au-dessus du trait des rangées, dans « En cours », tant que son dépannage
 * n'a pas abouti. Une tombée dépassée par une plus récente de la même étape a déjà quitté le flux
 * (`sansEchecsRemplaces`) ; une publication ARRÊTÉE à la demande, ou rangée à la main, n'y reste pas. Ce rang ne relance
 * pas le filet de relecture des lignes qui tournent (`miseEnLigneActive`).
 */
export function miseEnLigneAfficheeActive(run: Pick<PublicationSysteme, 'state' | 'masquee'>): boolean {
  return run.state === 'running' || (run.state === 'failed' && !run.masquee);
}

/**
 * UN ÉVÉNEMENT MET À JOUR SA LIGNE, JAMAIS UNE AUTRE. La même mise en ligne (même identifiant) se remplace par sa
 * version la plus avancée : un événement en retard (encore « en cours ») ne rallume pas une ligne déjà finie.
 */
export function misesEnLigneApres<T extends PublicationSysteme>(liste: readonly T[], run: T): T[] {
  const connue = liste.find((r) => r.id === run.id);
  /* UNE REPRISE APRÈS DÉPANNAGE RALLUME LA MÊME LIGNE (17/11/2026) : seule une version « en cours » plus récente que la
     fin connue (`reprisA`) le peut ; un événement en retard, lui, reste ignoré. */
  const reprise = run.state === 'running' && !!run.reprisA && (connue?.endedAt === undefined || run.reprisA > connue.endedAt);
  if (connue && connue.state !== 'running' && run.state === 'running' && !reprise) return liste as T[];
  if (connue && connue.state === 'running' && run.state !== 'running' && connue.reprisA && run.endedAt !== undefined && run.endedAt < connue.reprisA) return liste as T[];
  if (connue && connue.endedAt !== undefined && run.endedAt !== undefined && run.endedAt < connue.endedAt) return liste as T[];
  const suite = liste.filter((r) => r.id !== run.id);
  suite.push(run);
  return suite.sort(comparerMisesEnLigne);
}

/** Une entrée du flux mêlé : une ligne de carte, ou une mise en ligne. */
export type EntreeDuFluxMele<L, R> = { genre: 'carte'; ligne: L; at: number; id: string } | { genre: 'mise-en-ligne'; run: R; at: number; id: string };

/**
 * LE FLUX MÊLÉ D'UN PROJET : les lignes de cartes et les mises en ligne, rangées ensemble par dernière modification.
 * `nombre` entrées comptées (cartes LUES et mises en ligne lues), plus celles qu'on ne perd jamais de vue (`gardee`
 * pour une carte, une mise en ligne qui tourne), chacune à son rang de date — exactement comme `fluxDeLaColonne`.
 *
 * Aucun trou : chaque source est lue par date jusqu'à au moins `nombre` entrées (ou jusqu'au bout) ; les `nombre`
 * premières de leur union sont donc les `nombre` premières de tout l'historique. Aucun doublon : une mise en ligne
 * ne figure qu'une fois par identifiant (`misesEnLigneApres`).
 */
export function fluxMele<L extends { carte: { id: string; updatedAt: number } }, R extends PublicationSysteme>(
  lignes: readonly L[],
  lues: ReadonlySet<string>,
  runs: readonly R[],
  nombre: number,
  gardee: (ligne: L) => boolean,
): EntreeDuFluxMele<L, R>[] {
  const entrees: EntreeDuFluxMele<L, R>[] = [
    ...lignes.map((ligne) => ({ genre: 'carte' as const, ligne, at: ligne.carte.updatedAt, id: ligne.carte.id })),
    ...sansEchecsRemplaces(dedoublonner(runs)).map((run) => ({ genre: 'mise-en-ligne' as const, run, at: dateDeLaMiseEnLigne(run), id: run.id })),
  ];
  entrees.sort((a, b) => (a.at !== b.at ? b.at - a.at : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  let restantes = nombre;
  return entrees.filter((entree) => {
    const lue = entree.genre === 'mise-en-ligne' || lues.has(entree.id);
    const dansLeCompte = restantes > 0 && lue;
    if (dansLeCompte) restantes -= 1;
    if (dansLeCompte) return true;
    return entree.genre === 'carte' ? gardee(entree.ligne) : miseEnLigneAfficheeActive(entree.run);
  });
}

/** Une ligne par identifiant : la plus avancée l'emporte. */
function dedoublonner<R extends PublicationSysteme>(runs: readonly R[]): R[] {
  let liste: R[] = [];
  for (const run of runs) liste = misesEnLigneApres(liste, run);
  return liste;
}

/**
 * UNE SEULE LIGNE D'ÉCHEC PAR PROJET ET PAR ÉTAPE (13/11/2026, quatre « Déploiement — échec » empilés pour le même
 * lot). Une mise en ligne tombée ou arrêtée ne reste au flux que si AUCUNE mise en ligne plus récente de la même
 * étape (déploiement ou mise en production) n'a été lancée sur le même projet : la suivante l'efface, qu'elle
 * réussisse, tourne encore ou retombe à son tour. Un échec qui n'a pas été suivi reste donc toujours visible.
 */
export function sansEchecsRemplaces<R extends PublicationSysteme>(runs: readonly R[]): R[] {
  const plusRecente = new Map<string, number>();
  for (const run of runs) {
    const cle = `${run.projectId}:${run.cible ?? 'dev'}`;
    plusRecente.set(cle, Math.max(plusRecente.get(cle) ?? 0, run.startedAt));
  }
  return runs.filter((run) => {
    if (run.masquee && run.state !== 'running') return false;
    if (run.state !== 'failed' && run.state !== 'stopped') return true;
    return run.startedAt >= (plusRecente.get(`${run.projectId}:${run.cible ?? 'dev'}`) ?? 0);
  });
}
