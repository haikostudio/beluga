import * as React from 'react';
import { doitVeiller, prochaineRevisionDeVeille } from '@beluga/shared';

/**
 * LA VEILLE DE L'ÉCRAN, BRANCHÉE SUR LE NAVIGATEUR (`shared/src/veille-ecran.ts`).
 *
 * Deux signaux, à ne pas confondre :
 *
 *   - LA PAGE EST CACHÉE (`pageCachee`, `usePageCachee`) — dès l'instant où
 *     elle quitte l'écran. Les horloges et les relevés s'arrêtent tout de
 *     suite : ils ne servent qu'à ce qu'on voit ;
 *   - LA PAGE DORT (`estEnVeille`, `surLaVeille`) — cachée depuis quelques
 *     secondes ET rien ne la retient. Le canal se ferme alors
 *     (`lib/client.ts`), et le retour à l'écran le rouvre.
 *
 * Ce qui doit continuer SANS écran — conversation vocale, écoute, micro
 * ouvert, réponse lue à voix haute — se déclare par `garderEveilleTantQue`.
 * Tant qu'un garde dit oui, la page ne dort pas.
 *
 * Un téléphone peut GELER la page sans prévenir par `visibilitychange` : on
 * écoute aussi `pagehide` / `pageshow`, `freeze` / `resume` et `focus`.
 */

type Garde = () => boolean;

const gardes = new Set<Garde>();
const ecouteursDeVeille = new Set<(enVeille: boolean) => void>();
const ecouteursDeVisibilite = new Set<() => void>();

let cacheDepuis: number | null = null;
let enVeille = false;
let minuteur: number | null = null;

/** Ce qui doit continuer sans écran le dit ici. Rend de quoi retirer le garde. */
export function garderEveilleTantQue(garde: Garde): () => void {
  gardes.add(garde);
  return () => gardes.delete(garde);
}

function gardesActifs(): number {
  let actifs = 0;
  for (const garde of gardes) {
    try {
      if (garde()) actifs += 1;
    } catch {
      /* un garde qui tombe ne retient rien */
    }
  }
  return actifs;
}

/** La page est-elle hors de l'écran, à cet instant ? */
export function pageCachee(): boolean {
  return cacheDepuis != null;
}

/** La page dort-elle (canal fermé, rien ne tourne) ? */
export function estEnVeille(): boolean {
  return enVeille;
}

/** Prévenu à chaque entrée en veille (`true`) et à chaque réveil (`false`). */
export function surLaVeille(ecouteur: (enVeille: boolean) => void): () => void {
  ecouteursDeVeille.add(ecouteur);
  return () => ecouteursDeVeille.delete(ecouteur);
}

/** Prévenu chaque fois que la page quitte l'écran ou y revient. */
export function surLaVisibilite(ecouteur: () => void): () => void {
  ecouteursDeVisibilite.add(ecouteur);
  return () => ecouteursDeVisibilite.delete(ecouteur);
}

function basculer(veille: boolean): void {
  if (enVeille === veille) return;
  enVeille = veille;
  // Les animations sans fin se figent avec le reste (`index.css`).
  document.documentElement.classList.toggle('en-veille', veille);
  for (const ecouteur of [...ecouteursDeVeille]) {
    try {
      ecouteur(veille);
    } catch {
      /* un écouteur qui tombe n'empêche pas les autres de dormir */
    }
  }
}

function arreterLeMinuteur(): void {
  if (minuteur != null) window.clearTimeout(minuteur);
  minuteur = null;
}

/** Repose la question « faut-il dormir ? », et se reprogramme tant qu'elle reste ouverte. */
function reviser(gelee = false): void {
  arreterLeMinuteur();
  if (enVeille) return;
  const lecture = { cacheDepuis, gardes: gardesActifs(), gelee };
  const maintenant = Date.now();
  if (doitVeiller(lecture, maintenant)) {
    basculer(true);
    return;
  }
  const attente = prochaineRevisionDeVeille(lecture, maintenant);
  if (attente != null) minuteur = window.setTimeout(() => reviser(), Math.max(attente, 250));
}

function quitterLEcran(gelee = false): void {
  const dejaCachee = cacheDepuis != null;
  if (!dejaCachee) cacheDepuis = Date.now();
  if (!dejaCachee) for (const ecouteur of [...ecouteursDeVisibilite]) ecouteur();
  reviser(gelee);
}

function revenirALEcran(): void {
  if (cacheDepuis == null && !enVeille) return;
  arreterLeMinuteur();
  /*
   * UNE PAGE GELÉE N'A PAS PU S'ENDORMIR ELLE-MÊME : ses minuteries ne
   * tournaient plus. Si elle AURAIT dû dormir, son canal est resté ouvert sur
   * un lien probablement mort — on passe par la veille pour le rouvrir tout de
   * suite, au lieu d'attendre que le battement le déclare muet.
   */
  if (!enVeille && doitVeiller({ cacheDepuis, gardes: gardesActifs() }, Date.now())) basculer(true);
  cacheDepuis = null;
  basculer(false);
  for (const ecouteur of [...ecouteursDeVisibilite]) ecouteur();
}

function jugerLaVisibilite(): void {
  if (document.visibilityState === 'hidden') quitterLEcran();
  else revenirALEcran();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', jugerLaVisibilite);
  window.addEventListener('pagehide', () => quitterLEcran());
  window.addEventListener('pageshow', jugerLaVisibilite);
  document.addEventListener('freeze', () => quitterLEcran(true));
  document.addEventListener('resume', jugerLaVisibilite);
  window.addEventListener('focus', jugerLaVisibilite);
  if (document.visibilityState === 'hidden') quitterLEcran();
}

function abonnerALaVisibilite(prevenir: () => void): () => void {
  return surLaVisibilite(prevenir);
}

/** Vrai tant que la page est hors de l'écran. */
export function usePageCachee(): boolean {
  return React.useSyncExternalStore(abonnerALaVisibilite, pageCachee, () => false);
}

/**
 * UN RELEVÉ RÉGULIER QUI NE TOURNE QUE SOUS LES YEUX. Remplace `setInterval`
 * partout où un composant interroge le serveur ou se redessine à intervalle
 * fixe : page cachée, l'intervalle est retiré ; au retour, `geste` est joué
 * une fois tout de suite (ce qu'on a manqué), puis le rythme reprend.
 *
 * `actif` à faux coupe l'intervalle sans démonter le composant.
 */
export function useIntervalleVisible(geste: () => void, periodeMs: number, actif = true): void {
  const dernierGeste = React.useRef(geste);
  dernierGeste.current = geste;
  React.useEffect(() => {
    if (!actif) return;
    return lancerIntervalleVisible(() => dernierGeste.current(), periodeMs);
  }, [periodeMs, actif]);
}

/**
 * La même chose hors d'un composant, ou au milieu d'un effet qui a déjà son
 * propre ménage : rend de quoi tout arrêter, à la place de `clearInterval`.
 */
export function lancerIntervalleVisible(geste: () => void, periodeMs: number): () => void {
  let minuterie: number | null = null;
  const lancer = () => {
    if (minuterie == null && !pageCachee()) minuterie = window.setInterval(geste, periodeMs);
  };
  const arreter = () => {
    if (minuterie != null) window.clearInterval(minuterie);
    minuterie = null;
  };
  const suivre = () => {
    if (pageCachee()) {
      arreter();
      return;
    }
    if (minuterie == null) geste();
    lancer();
  };
  lancer();
  const retirer = surLaVisibilite(suivre);
  return () => {
    retirer();
    arreter();
  };
}

/*
 * LE POINT D'ESSAI. Un contrôle en vrai navigateur doit pouvoir demander si la
 * page dort. Gardé par le MODE, comme les autres points d'essai.
 */
if (typeof window !== 'undefined' && import.meta.env.MODE !== 'production') {
  (window as unknown as { belugaVeille?: unknown }).belugaVeille = {
    enVeille: estEnVeille,
    cachee: pageCachee,
    gardes: gardesActifs,
  };
}
