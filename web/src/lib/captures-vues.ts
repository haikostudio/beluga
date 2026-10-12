import { tranchesDeCles } from '@beluga/shared';

/**
 * LES IMAGES DÉJÀ OUVERTES EN GRAND PAR CE COMPTE, côté écran.
 *
 * La vérité vit au serveur (`capture_vues`, une ligne par compte et par
 * image) : l'œil suit donc du téléphone à l'ordinateur. Ici, on n'en garde que
 * ce que les bandes affichées ont demandé — jamais tout le compte, jamais dans
 * le premier envoi, jamais dans le magasin général.
 *
 * Ce module ne parle PAS au serveur : il tient l'ensemble, et `client`
 * (`demanderLesCapturesVues`, `marquerCapturesVues`) fait les allers-retours.
 * « Vue » ne se défait pas : l'ensemble ne fait que grandir.
 */

let vues: ReadonlySet<string> = new Set();
/** Les clés dont l'état a déjà été demandé au serveur sur ce canal. */
const demandees = new Set<string>();
/** Les clés marquées ici que le serveur n'a pas encore confirmées. */
const aEnvoyer = new Set<string>();
/** Monte à chaque reconnexion : les bandes affichées redemandent leur état. */
let generation = 0;
const ecouteurs = new Set<() => void>();

const prevenir = () => {
  for (const ecouteur of ecouteurs) ecouteur();
};

export function ecouterLesVues(ecouteur: () => void): () => void {
  ecouteurs.add(ecouteur);
  return () => {
    ecouteurs.delete(ecouteur);
  };
}

/** L'ensemble du moment — une NOUVELLE instance à chaque ajout, pour `useSyncExternalStore`. */
export function vuesConnues(): ReadonlySet<string> {
  return vues;
}

export function generationDesVues(): number {
  return generation;
}

/** Ajoute ces clés à l'ensemble, et rend celles qui n'y étaient pas. */
export function retenirLesVues(cles: readonly string[]): string[] {
  const nouvelles = [...new Set(cles)].filter((cle) => !vues.has(cle));
  if (!nouvelles.length) return [];
  vues = new Set([...vues, ...nouvelles]);
  prevenir();
  return nouvelles;
}

/** Les clés pas encore demandées, en tranches acceptées par le protocole ; elles sont notées demandées. */
export function clesADemander(cles: readonly string[]): string[][] {
  const tranches = tranchesDeCles(cles.filter((cle) => !demandees.has(cle)));
  for (const tranche of tranches) for (const cle of tranche) demandees.add(cle);
  return tranches;
}

/** Une demande restée sans réponse se refera. */
export function oublierLaDemande(cles: readonly string[]): void {
  for (const cle of cles) demandees.delete(cle);
}

/** Des clés marquées ici, à faire connaître au serveur. */
export function noterAEnvoyer(cles: readonly string[]): void {
  for (const cle of cles) aEnvoyer.add(cle);
}

export function tranchesAEnvoyer(): string[][] {
  return tranchesDeCles([...aEnvoyer]);
}

export function envoiConfirme(cles: readonly string[]): void {
  for (const cle of cles) aEnvoyer.delete(cle);
}

/**
 * LE CANAL EST REVENU : un autre appareil a pu ouvrir des images entre-temps.
 * Ce qu'on sait reste vrai ; on redemande seulement l'état des bandes à l'écran.
 */
export function redemanderLesVues(): void {
  demandees.clear();
  generation += 1;
  prevenir();
}
