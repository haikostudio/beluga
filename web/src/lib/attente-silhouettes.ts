import * as React from 'react';
import { SEUIL_CONNEXION_LENTE_MS, connexionEstLente, delaiAvantConnexionLente } from '@beluga/shared';

/**
 * LES SILHOUETTES EN ATTENTE, ET LA CONNEXION LENTE QUI EN DÉCOULE.
 *
 * Toute zone sans données montre une silhouette, bâtie sur la brique
 * `Silhouette` (classe `animate-silhouette`, `silhouettes.tsx`). Ce magasin
 * regarde donc le DOCUMENT plutôt que chaque silhouette : un seul endroit, et
 * une silhouette ajoutée demain — dans n'importe quel écran — est comptée sans
 * rien brancher.
 *
 * Trois règles :
 *  — une silhouette ne compte que si elle est AFFICHÉE : un écran monté mais
 *    caché (chargé en différé, replié) n'attend personne ;
 *  — l'image d'une pastille de fichier (`data-silhouette-image`) est une image
 *    qui charge, pas une zone sans données : elle ne compte pas ;
 *  — l'attente se mesure d'UNE seule horloge : de la première silhouette
 *    visible jusqu'à ce qu'il n'y en ait plus. Plusieurs zones qui attendent ne
 *    donnent qu'un seul état « lent ».
 *
 * Ni sondage régulier ni écoute des attributs : seuls les ajouts et retraits
 * d'éléments sont observés (débouncés), plus UN minuteur armé pour l'instant où
 * le seuil sera franchi — rien ne tourne quand rien n'attend.
 */

/** Les briques de silhouette qui attendent des DONNÉES (pas une image). */
const SELECTEUR = '.animate-silhouette:not([data-silhouette-image])';

/** Le délai qui regroupe une rafale de mutations en une seule vérification. */
const DEBOUNCE_MS = 150;

export type EtatConnexion = {
  /** Une zone attend ses données depuis plus que le seuil. */
  lente: boolean;
  /** Le bandeau de mise à jour occupe déjà le haut de l'écran. */
  sousUnBandeau: boolean;
};

const ETAT_INITIAL: EtatConnexion = { lente: false, sousUnBandeau: false };
let etat: EtatConnexion = ETAT_INITIAL;
const abonnes = new Set<() => void>();

function poser(suivant: EtatConnexion): void {
  if (suivant.lente === etat.lente && suivant.sousUnBandeau === etat.sousUnBandeau) return;
  etat = suivant;
  for (const abonne of abonnes) abonne();
}

/** Une brique de silhouette est-elle réellement affichée ? */
function estAffichee(element: Element): boolean {
  const verifiable = element as Element & { checkVisibility?: (options?: object) => boolean };
  if (typeof verifiable.checkVisibility === 'function') {
    return verifiable.checkVisibility({ checkVisibilityCSS: true });
  }
  return element.getClientRects().length > 0;
}

/** Y a-t-il, MAINTENANT, une silhouette affichée qui attend des données ? */
export function uneSilhouetteAttend(racine: ParentNode = document): boolean {
  for (const element of racine.querySelectorAll(SELECTEUR)) {
    if (estAffichee(element)) return true;
  }
  return false;
}

let observateur: MutationObserver | null = null;
let attenteDepuis: number | null = null;
let minuteur: number | null = null;
let rafale: number | null = null;

function armerLeMinuteur(): void {
  if (minuteur !== null) window.clearTimeout(minuteur);
  minuteur = null;
  const reste = delaiAvantConnexionLente(attenteDepuis, Date.now());
  if (reste === null || reste === 0) return;
  minuteur = window.setTimeout(evaluer, reste + 20);
}

function evaluer(): void {
  rafale = null;
  /* Un onglet en arrière-plan n'attend personne : au retour, l'attente repart
     de zéro plutôt que d'annoncer une lenteur que personne n'a vue. */
  const attend = !document.hidden && uneSilhouetteAttend();
  if (!attend) {
    attenteDepuis = null;
    if (minuteur !== null) window.clearTimeout(minuteur);
    minuteur = null;
  } else if (attenteDepuis === null) {
    attenteDepuis = Date.now();
    armerLeMinuteur();
  }
  poser({
    lente: connexionEstLente(attenteDepuis, Date.now()),
    sousUnBandeau: !!document.querySelector('[data-bandeau-mise-a-jour]'),
  });
}

function planifier(): void {
  if (rafale !== null) return;
  rafale = window.setTimeout(evaluer, DEBOUNCE_MS);
}

function demarrer(): void {
  if (observateur || typeof document === 'undefined') return;
  observateur = new MutationObserver(planifier);
  observateur.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', evaluer);
  evaluer();
}

function arreter(): void {
  observateur?.disconnect();
  observateur = null;
  document.removeEventListener('visibilitychange', evaluer);
  if (minuteur !== null) window.clearTimeout(minuteur);
  if (rafale !== null) window.clearTimeout(rafale);
  minuteur = null;
  rafale = null;
  attenteDepuis = null;
  etat = ETAT_INITIAL;
}

function abonner(rappel: () => void): () => void {
  abonnes.add(rappel);
  if (abonnes.size === 1) demarrer();
  return () => {
    abonnes.delete(rappel);
    if (abonnes.size === 0) arreter();
  };
}

/**
 * L'état de la connexion pour l'écran : « lente » quand une silhouette attend
 * depuis plus de `SEUIL_CONNEXION_LENTE_MS`, `false` dès qu'il n'y en a plus.
 */
export function useConnexionLente(): EtatConnexion {
  return React.useSyncExternalStore(
    abonner,
    () => etat,
    () => ETAT_INITIAL,
  );
}

export { SEUIL_CONNEXION_LENTE_MS };
