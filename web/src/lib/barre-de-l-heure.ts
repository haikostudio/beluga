/**
 * LA BARRE DE L'HEURE SUIT UN SEUL REPÈRE (carte « Barre d'état iPhone mal colorée », captures #47da, #84ec, #6f208).
 *
 * Sur iPhone, l'application installée ne teinte plus la barre depuis `theme-color` : WebKit (`fixedContainerEdges`)
 * lit le premier élément fixe qui couvre le point à 4 px du haut, au milieu de la largeur. Un voile plein écran y
 * passait pour un calque d'assombrissement : sa couleur mêlée à la page restait gelée après sa fermeture (page × 0,3 :
 * 76 sur blanc, 9 sur #212121) jusqu'à une rotation. L'ancienne relance, une bande de 6 px, n'était jamais lue : WebKit
 * ignore toute boîte de 10 px ou moins.
 *
 * On pose donc UN repère, toujours au sommet de la pile, à la géométrie qu'exige WebKit (voir le gabarit de
 * `web/index.html`, qui le pose avant le premier affichage) :
 *  - plus de 10 px de haut, mais presque tout au-dessus de la fenêtre : seuls 4,5 px restent à l'écran ;
 *  - opacité 0,12, au-dessus du seuil de 0,1 et invisible à l'œil ; WebKit lit le fond SANS l'opacité ;
 *  - petit et opaque par son fond, jamais lu comme un calque d'assombrissement, donc jamais gelé ;
 *  - enfant direct de `body`, sans transformation ni flou dans sa lignée, sans quoi il ne serait plus fixe.
 *
 * ÉCRIRE LE FOND NE SUFFIT PAS : WebKit ne relit qu'à l'ajout ou au retrait d'un élément fixe
 * (`didAddOrRemoveViewportConstrainedObjects`). D'où `display:none`, une lecture qui force le calcul, puis le retour :
 * son rendu est détruit et recréé dans la même image, rien ne clignote.
 *
 * LA BARRE SUIT LE FONDU, IMAGE PAR IMAGE (captures #5091, #2f38, #22e03 du 01/11/2026 : la barre restait claire sur
 * un tiroir ouvert et sombre pendant sa fermeture). La couleur n'était relue qu'au montage, au clic ou à la FIN du
 * fondu (`animationend`) : une ouverture ou une fermeture sans clic — Échap, réponse envoyée, question qui s'ouvre
 * seule — ne changeait la barre qu'après l'animation, et même au bon moment elle sautait d'un coup à la couleur
 * finale. Désormais tout fondu d'un calque plein écran (`animationstart`) et tout changement de `data-state` d'un
 * calque fixe lancent `suivreLeFondu` : à chaque image, la couche compte pour son fond MULTIPLIÉ par son opacité du
 * moment, et un calque refermé compte tant que son fondu de sortie joue. La barre s'assombrit et s'éclaircit EN MÊME
 * TEMPS que la page ; une relecture n'est forcée que si la couleur a changé (une dizaine par fondu).
 *
 * L'ÉMULATION NE REPRODUIT PAS CE DÉFAUT : seul un essai sur iPhone tranche. L'écran de mesures lit la couleur du repère.
 * Sur ordinateur (aucun pointeur grossier), le repère est retiré et plus rien ne tourne.
 */
import * as React from 'react';
import { composerLaCouleurDeLaBarre, lireRgba, type Rgba } from '@beluga/shared';

const ID_DU_REPERE = 'repere-de-l-heure';
/** Reprend le gabarit de `web/index.html`, au cas où une autre page servirait l'application. */
const STYLE_DU_REPERE =
  'position:fixed;top:-7.5px;left:0;right:0;height:12px;opacity:.12;pointer-events:none;z-index:2147483000';
/** Juste sous le bord : ce que l'œil voit là où commence l'application. */
const POINT_LU_Y = 1;
/** Un élément aussi mince ne compte pas plus pour nous que pour WebKit (le trait rouge de l'écran de mesures). */
const EPAISSEUR_IGNOREE_PX = 10;
/** Laisse la page se poser : menu refermé par une navigation, écran changé après un toucher. */
const DELAI_APRES_UN_CHANGEMENT_MS = 300;

let image = 0;
let relectureDemandee = false;
/** Faux sur ordinateur : un voile y reste un voile, et ne doit surtout pas recréer le repère. */
let actif = false;

function repere(): HTMLElement | null {
  let element = document.getElementById(ID_DU_REPERE);
  if (element) return element;
  if (!document.body) return null;
  element = document.createElement('div');
  element.id = ID_DU_REPERE;
  element.setAttribute('aria-hidden', 'true');
  element.style.cssText = STYLE_DU_REPERE;
  document.body.prepend(element);
  return element;
}

/**
 * Les fonds empilés au sommet, le plus haut d'abord. Seul ce qui couvre tout le bord compte : un bouton ou une carte
 * qui défile sous le haut ne doit pas teinter la barre. Un voile compte pour son fond multiplié par son opacité DU
 * MOMENT : pendant son fondu, la barre suit la page ; refermé et immobile, il ne compte plus.
 */
function couchesDuSommet(marque: HTMLElement): Rgba[] {
  /* Une fenêtre Radix met tout `body` en `pointer-events:none` : sans ce rétablissement le temps de la lecture,
     la pile s'arrêterait au voile et le fond de la zone ne serait pas lu. Rien n'est peint entre-temps. */
  const corps = document.body;
  const avant = corps.style.pointerEvents;
  corps.style.pointerEvents = 'auto';
  const pile = document.elementsFromPoint(window.innerWidth / 2, POINT_LU_Y);
  corps.style.pointerEvents = avant;
  const couches: Rgba[] = [];
  for (const element of pile) {
    if (element === marque || element === corps || element === document.documentElement) continue;
    const enFondu = element.getAnimations().some((a) => a.playState === 'running');
    if (element.getAttribute('data-state') === 'closed' && !enFondu) continue;
    const boite = element.getBoundingClientRect();
    if (boite.height <= EPAISSEUR_IGNOREE_PX || boite.left > 1 || boite.right < window.innerWidth - 1) continue;
    const style = getComputedStyle(element);
    const opacite = Number(style.opacity);
    if (opacite < 0.01) continue;
    const fond = lireRgba(style.backgroundColor);
    if (fond) couches.push([fond[0], fond[1], fond[2], fond[3] * opacite]);
  }
  return couches;
}

function appliquer(relire: boolean): void {
  const marque = repere();
  if (!marque) return;
  const couleur = composerLaCouleurDeLaBarre(
    couchesDuSommet(marque),
    lireRgba(getComputedStyle(document.body).backgroundColor) ?? lireRgba(getComputedStyle(document.documentElement).backgroundColor),
  );
  const changee = marque.dataset.couleur !== couleur;
  if (!changee && !relire) return;
  marque.dataset.couleur = couleur;
  marque.style.backgroundColor = couleur;
  marque.style.display = 'none';
  void marque.offsetHeight;
  marque.style.display = '';
  marque.dataset.relectures = String(Number(marque.dataset.relectures ?? 0) + 1);
}

/** Au plus une lecture par image, si souvent qu'on la demande. `relire` : forcer la relecture, même sans changement. */
function planifier(relire = false): void {
  if (!actif) return;
  relectureDemandee ||= relire;
  if (image) return;
  image = window.requestAnimationFrame(() => {
    image = 0;
    const forcer = relectureDemandee;
    relectureDemandee = false;
    appliquer(forcer);
  });
}

function planifierEtRevoir(relire = false): void {
  planifier(relire);
  window.setTimeout(() => planifier(relire), DELAI_APRES_UN_CHANGEMENT_MS);
}

/** Le temps d'un fondu (140 ms à l'entrée, 200 ms à la sortie), plus une marge : la boucle ne tourne pas au-delà. */
const DUREE_DE_SUIVI_MS = 320;
let suiviJusqua = 0;
let boucle = 0;

/** Une lecture à CHAQUE IMAGE tant qu'un fondu joue, puis une dernière, posée. */
function suivreLeFondu(): void {
  if (!actif) return;
  suiviJusqua = performance.now() + DUREE_DE_SUIVI_MS;
  if (boucle) return;
  const tour = () => {
    appliquer(false);
    if (performance.now() < suiviJusqua) {
      boucle = window.requestAnimationFrame(tour);
      return;
    }
    boucle = 0;
    planifierEtRevoir();
  };
  boucle = window.requestAnimationFrame(tour);
}

/**
 * Un calque fixe, posé sur toute la largeur : un voile, une fenêtre. Repéré par sa classe `fixed` (tous les voiles de
 * l'application la portent) avant toute mesure : ce test court à chaque `data-state` et chaque début d'animation.
 */
function calquePleineLargeur(cible: EventTarget | Node | null): boolean {
  if (!(cible instanceof HTMLElement) || !cible.classList.contains('fixed')) return false;
  const boite = cible.getBoundingClientRect();
  return boite.left <= 1 && boite.right >= window.innerWidth - 1;
}

/** À poser dans tout voile : son montage et son démontage, après le fondu de sortie, changent la couleur. */
export function useVoileAffiche(): void {
  React.useLayoutEffect(() => {
    suivreLeFondu();
    return () => planifierEtRevoir();
  }, []);
}

function brancher(): void {
  if (!window.matchMedia('(pointer: coarse)').matches) {
    document.getElementById(ID_DU_REPERE)?.remove();
    return;
  }
  actif = true;
  /* Thème et apparence imposée par un projet : tout passe par ces attributs. */
  new MutationObserver(() => planifier()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-ambiance'],
  });
  /* Portails ajoutés à `body`, sans son sous-arbre : le fil en flux tendu paierait chaque ligne. */
  new MutationObserver(() => planifier()).observe(document.body, { childList: true });
  document.addEventListener('animationend', () => planifier(), true);
  /* LE FONDU D'UN VOILE COMMENCE : la barre le suit dès sa première image, quel que soit le geste qui l'a lancé. */
  document.addEventListener('animationstart', (e) => calquePleineLargeur(e.target) && suivreLeFondu(), true);
  /* Un voile qui passe « fermé » (Échap, réponse envoyée, fermeture par le programme) : sans attendre la fin du fondu.
     Seulement les attributs `data-state`, et seulement d'un calque fixe pleine largeur. */
  new MutationObserver((changements) => {
    if (changements.some((c) => calquePleineLargeur(c.target))) suivreLeFondu();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
  /* Un écran change sur un toucher, un retour ou un changement d'adresse. */
  document.addEventListener('click', () => planifierEtRevoir(), true);
  window.addEventListener('popstate', () => planifierEtRevoir());
  window.addEventListener('hashchange', () => planifierEtRevoir());
  /* La fenêtre a pu changer, ou iOS a pu relire sans nous : sans condition. */
  window.addEventListener('resize', () => planifier(true));
  window.addEventListener('orientationchange', () => planifierEtRevoir(true));
  window.addEventListener('pageshow', () => planifierEtRevoir(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') planifierEtRevoir(true);
  });
  planifierEtRevoir(true);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') brancher();
