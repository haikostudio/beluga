/*
 * LE MORPHING DU BOUTON DU BORD (décisions de l'utilisateur, 17/11/2026, illustration #0666). La règle des étapes et de
 * la boîte est pure (`shared/src/morphing-du-bord.ts`) ; ici, la boucle d'images et le dessin, posés à la main sur un
 * calque fixe (aucun re-rendu React pendant le mouvement).
 *
 * - Une SURFACE (la bulle vocale, le volet de l'assistant sur ordinateur) s'inscrit à son montage (`useSurfaceDeJarvis`)
 *   et se retire à son démontage. La première qui s'ouvre fait partir le morphing DU BOUTON vers elle ; la dernière qui
 *   se ferme le fait revenir AU BOUTON. Passer de l'une à l'autre (la bulle qui se déplie en volet) ne rejoue rien.
 * - Pendant tout ce temps, le bouton du bord reste MONTÉ (sa place et sa boîte se lisent) mais invisible
 *   (`useMorphingDuBord`, lu par `jarvis-natif.tsx`).
 * - Le dessin reprend celui du cercle de chargement (`arc`, `trait` de `ondes-de-voix.tsx`) : les trois traits rentrent
 *   en un seul, il se courbe en cercle, qui tourne au même angle que celui de la bulle (`cercleDeLaVoix`).
 * - Un changement de sens en plein vol repart de l'image courante : jamais d'état coincé, et le bouton revient toujours.
 * - Mouvement réduit demandé, ou bouton introuvable : bascule immédiate, sans calque.
 */
import * as React from 'react';
import {
  DUREE_DU_MORPHING_MS,
  ETAPES_DU_MORPHING,
  FIN_DE_L_OUVERTURE,
  imageDuMorphing,
  type BoiteALEcran,
  type BordDeLEcran,
  type GeometrieDuMorphing,
} from '@beluga/shared';
import {
  BARRES,
  HAUTEUR_CENTRALE,
  HAUTEUR_LATERALE,
  LARGEUR_D_UNE_BARRE,
  LONGUEUR_DE_L_ARC,
  RAYON_DU_CERCLE,
  VITESSE_DU_CERCLE,
  adoucir,
  arc,
  cercleDeLaVoix,
  mouvementReduit,
  trait,
} from '@/components/ondes-de-voix';

export type PhaseDuMorphing = 'repos' | 'ouverture' | 'ouvert' | 'fermeture';

/* ------------------------------------------------------------------ */
/* L'état, lu par le bouton et la bulle                                 */
/* ------------------------------------------------------------------ */

let phase: PhaseDuMorphing = 'repos';
const abonnes = new Set<() => void>();
function poserLaPhase(suite: PhaseDuMorphing): void {
  if (phase === suite) return;
  phase = suite;
  document.documentElement.dataset.morphingDuBord = suite;
  for (const f of abonnes) f();
}

/** La phase du morphing : le bouton est caché dès qu'elle n'est plus « repos ». */
export function useMorphingDuBord(): PhaseDuMorphing {
  return React.useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => phase,
    () => 'repos',
  );
}

/* ------------------------------------------------------------------ */
/* Les surfaces                                                         */
/* ------------------------------------------------------------------ */

interface Surface {
  el: HTMLElement;
  /** La dernière boîte lue : la seule qui reste quand l'élément est déjà retiré. */
  boite: BoiteALEcran;
  ondes: BoiteALEcran | null;
  rayon: number;
}
const surfaces = new Map<string, Surface>();
let fermeturePrevue = false;

function boiteDe(el: Element | null | undefined): BoiteALEcran | null {
  if (!el || !(el as HTMLElement).isConnected) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

function relire(s: Surface): void {
  const b = boiteDe(s.el);
  if (!b) return;
  s.boite = b;
  s.ondes = boiteDe(s.el.querySelector('[data-ondes-du-volet]'));
  s.rayon = parseFloat(getComputedStyle(s.el).borderTopLeftRadius) || 22;
}

function lireLeBouton(): { boite: BoiteALEcran; bord: BordDeLEcran } | null {
  const bouton = document.querySelector('[data-bouton-du-bord]');
  const boite = boiteDe(bouton);
  if (!boite) return null;
  const bord = (bouton!.closest('[data-jarvis-natif]') as HTMLElement | null)?.dataset.bord as BordDeLEcran | undefined;
  return { boite, bord: bord ?? 'droite' };
}

function cacher(el: HTMLElement, oui: boolean): void {
  el.style.opacity = oui ? '0' : '';
  el.style.pointerEvents = oui ? 'none' : '';
}

/* ------------------------------------------------------------------ */
/* Le calque et la boucle                                               */
/* ------------------------------------------------------------------ */

interface Calque {
  racine: HTMLDivElement;
  voile: HTMLDivElement;
  svg: SVGSVGElement;
  traitDuBouton: SVGPathElement;
  traitDeLaBulle: SVGPathElement;
}

let calque: Calque | null = null;
let u = 0;
let sens: 1 | -1 = 1;
let butee = FIN_DE_L_OUVERTURE;
let image = 0;
let avant = 0;
let cible: Surface | null = null;
/** Le cercle a-t-il à paraître dans la surface (bulle vocale) ? Sans ondes (volet, synthèse), il s'efface en s'étirant. */
let avecCercle = true;

function creerLeCalque(): Calque {
  const racine = document.createElement('div');
  racine.dataset.calqueDuMorphing = '';
  racine.setAttribute('aria-hidden', 'true');
  racine.style.cssText =
    'position:fixed;left:0;top:0;z-index:57;pointer-events:none;overflow:hidden;background:hsl(var(--encre));box-shadow:0 12px 32px rgb(0 0 0 / 0.28);will-change:left,top,width,height';
  const voile = document.createElement('div');
  voile.style.cssText = 'position:absolute;inset:0;background:hsl(var(--surface));opacity:0';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible';
  const chemin = (couleur: string) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', couleur);
    p.setAttribute('stroke-width', String(LARGEUR_D_UNE_BARRE));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return p;
  };
  const traitDuBouton = chemin('hsl(var(--encre-fg))');
  const traitDeLaBulle = chemin('hsl(var(--text))');
  racine.append(voile, svg);
  document.body.appendChild(racine);
  return { racine, voile, svg, traitDuBouton, traitDeLaBulle };
}

function retirerLeCalque(): void {
  calque?.racine.remove();
  calque = null;
  cancelAnimationFrame(image);
  image = 0;
}

const ramene = (x: number) => Math.min(1, Math.max(0, x));
const tourComplet = (phi: number) => Math.round(phi / (2 * Math.PI)) * 2 * Math.PI;

/** Le dessin du trait à l'image `u`, centré en (cx, cy) dans le calque. */
function dessin(cx: number, cy: number, ondes: BoiteALEcran | null, boite: BoiteALEcran): string {
  const { etape, avancee } = etapeDe(u);
  const phi = cercleDeLaVoix.phi;
  if (etape === 'traits') {
    // Les deux traits du bord rentrent dans celui du milieu, comme le bouton voix du champ d'écriture.
    const e = 7 * (1 - adoucir(avancee));
    const hBord = 7 - 3 * avancee;
    return trait(cx - e, cy, hBord) + trait(cx + e, cy, hBord) + trait(cx, cy, 13);
  }
  if (etape === 'cercle') {
    // Le trait se courbe en cercle, et se met à tourner.
    const t = adoucir(avancee);
    const angle = tourComplet(phi) + (phi - tourComplet(phi)) * t;
    return arc(cx, cy, t / RAYON_DU_CERCLE, 9 + (LONGUEUR_DE_L_ARC - 9) * t, angle);
  }
  if (etape === 'ondes' && ondes) {
    // Le cercle se déplie en trait, deux barres en sortent, puis les points s'étalent jusqu'aux places de l'onde.
    const tDeplier = ramene(avancee / 0.35);
    const tSortir = ramene((avancee - 0.35) / 0.3);
    const tPoints = ramene((avancee - 0.55) / 0.45);
    const d = adoucir(tDeplier);
    const angle = phi + (tourComplet(phi) - phi) * d;
    let chemin = arc(cx, cy, (1 - d) / RAYON_DU_CERCLE, LONGUEUR_DE_L_ARC + (HAUTEUR_CENTRALE - LARGEUR_D_UNE_BARRE - LONGUEUR_DE_L_ARC) * d, angle);
    const gauche = ondes.x - boite.x + LARGEUR_D_UNE_BARRE / 2 + 4;
    const pas = (ondes.w - 8 - LARGEUR_D_UNE_BARRE) / (BARRES - 1);
    const milieu = (BARRES - 1) / 2;
    const s = adoucir(tSortir);
    if (s > 0) {
      const h = LARGEUR_D_UNE_BARRE + (HAUTEUR_LATERALE - LARGEUR_D_UNE_BARRE) * s;
      chemin += trait(cx - pas * s, cy, h) + trait(cx + pas * s, cy, h);
    }
    if (tPoints > 0) {
      for (let i = 0; i < BARRES; i += 1) {
        const rang = Math.abs(i - milieu);
        if (rang <= 1) continue;
        const p = adoucir(ramene((tPoints - ((rang - 2) / (milieu - 2)) * 0.55) / 0.45));
        if (p <= 0) continue;
        const depart = cx + Math.sign(i - milieu) * pas;
        chemin += trait(depart + (gauche + i * pas - depart) * p, cy, LARGEUR_D_UNE_BARRE);
      }
    }
    return chemin;
  }
  return arc(cx, cy, 1 / RAYON_DU_CERCLE, LONGUEUR_DE_L_ARC, phi);
}

function etapeDe(v: number): { etape: keyof typeof ETAPES_DU_MORPHING; avancee: number } {
  for (const etape of ['traits', 'cercle', 'glisse', 'bulle', 'ondes'] as const) {
    const [a, b] = ETAPES_DU_MORPHING[etape];
    if (v <= b || etape === 'ondes') return { etape, avancee: ramene((v - a) / (b - a)) };
  }
  return { etape: 'ondes', avancee: 1 };
}

function geometrie(): GeometrieDuMorphing | null {
  const bouton = lireLeBouton();
  if (!bouton || !cible) return null;
  if (cible.el.isConnected) relire(cible);
  const centre = cible.ondes
    ? { x: cible.ondes.x + cible.ondes.w / 2, y: cible.ondes.y + cible.ondes.h / 2 }
    : { x: cible.boite.x + cible.boite.w / 2, y: cible.boite.y + cible.boite.h / 2 };
  return { bouton: bouton.boite, bord: bouton.bord, cible: cible.boite, centreCible: centre, rayonCible: cible.rayon };
}

function peindre(g: GeometrieDuMorphing): void {
  if (!calque) calque = creerLeCalque();
  const img = imageDuMorphing(u, g, window.innerWidth, window.innerHeight);
  const { racine, voile, traitDuBouton, traitDeLaBulle } = calque;
  racine.style.left = `${img.boite.x}px`;
  racine.style.top = `${img.boite.y}px`;
  racine.style.width = `${img.boite.w}px`;
  racine.style.height = `${img.boite.h}px`;
  racine.style.borderRadius = img.coins.map((c) => `${c.toFixed(1)}px`).join(' ');
  racine.dataset.morphingDuBord = sens > 0 ? 'ouverture' : 'fermeture';
  racine.dataset.morphingEtape = img.etape === 'bulle' && img.avancee >= 1 ? 'bulle' : img.etape;
  voile.style.opacity = img.fond.toFixed(3);
  const d = dessin(img.centre.x - img.boite.x, img.centre.y - img.boite.y, cible?.ondes ?? null, img.boite);
  // Sans cercle à l'arrivée (volet), le trait s'efface pendant que la boîte s'étire.
  const presence = avecCercle ? 1 : img.etape === 'bulle' ? 1 - img.fond : img.etape === 'ondes' ? 0 : 1;
  traitDuBouton.setAttribute('d', d);
  traitDeLaBulle.setAttribute('d', d);
  traitDuBouton.style.opacity = ((1 - img.fond) * presence).toFixed(3);
  traitDeLaBulle.style.opacity = (img.fond * presence).toFixed(3);
}

function boucle(maintenant: number): void {
  const dt = Math.min(50, maintenant - avant);
  avant = maintenant;
  u = sens > 0 ? Math.min(butee, u + dt / DUREE_DU_MORPHING_MS) : Math.max(butee, u - dt / DUREE_DU_MORPHING_MS);
  // Le cercle tourne dès que le trait se courbe, au même rythme que celui de la bulle.
  const { etape, avancee } = etapeDe(u);
  const elan = etape === 'traits' ? 0 : etape === 'cercle' ? avancee : etape === 'ondes' ? 1 - avancee : 1;
  cercleDeLaVoix.phi = (cercleDeLaVoix.phi + VITESSE_DU_CERCLE * dt * elan) % (2 * Math.PI);
  const g = geometrie();
  if (!g) {
    finir();
    return;
  }
  peindre(g);
  if (u === butee) {
    finir();
    return;
  }
  image = requestAnimationFrame(boucle);
}

function finir(): void {
  retirerLeCalque();
  if (sens > 0) {
    if (cible) cacher(cible.el, false);
    poserLaPhase(surfaces.size ? 'ouvert' : 'repos');
  } else {
    cible = null;
    poserLaPhase(surfaces.size ? 'ouvert' : 'repos');
  }
}

function partir(vers: 1 | -1, depart: number): void {
  sens = vers;
  butee = vers > 0 ? FIN_DE_L_OUVERTURE : 0;
  if (!image) {
    u = depart;
    avant = performance.now();
    image = requestAnimationFrame(boucle);
  }
  poserLaPhase(vers > 0 ? 'ouverture' : 'fermeture');
}

/* ------------------------------------------------------------------ */
/* L'entrée                                                             */
/* ------------------------------------------------------------------ */

function ouvrirSurface(nom: string, el: HTMLElement): void {
  const surface: Surface = { el, boite: { x: 0, y: 0, w: 0, h: 0 }, ondes: null, rayon: 22 };
  relire(surface);
  const dejaOuverte = surfaces.size > 0 || fermeturePrevue;
  surfaces.set(nom, surface);
  fermeturePrevue = false;
  // De la bulle au volet (ou l'inverse) : le bouton reste caché, rien ne se rejoue.
  if (dejaOuverte && !(image && sens < 0)) {
    if (phase === 'repos') poserLaPhase('ouvert');
    return;
  }
  cible = surface;
  avecCercle = !!surface.ondes;
  // Au chargement de la page (un volet resté ouvert), rien ne se joue : on arrive sur l'écran tel qu'on l'a laissé.
  if (mouvementReduit() || !lireLeBouton() || performance.now() < 3000) {
    retirerLeCalque();
    poserLaPhase('ouvert');
    return;
  }
  cacher(el, true);
  partir(1, 0);
}

function fermerSurface(nom: string, el: HTMLElement): void {
  const surface = surfaces.get(nom);
  if (!surface || surface.el !== el) return;
  relire(surface);
  surfaces.delete(nom);
  if (surfaces.size) return;
  // Laisse la surface suivante s'inscrire dans le même rendu (la bulle qui se déplie en volet) avant de conclure.
  fermeturePrevue = true;
  void Promise.resolve().then(() => {
    if (!fermeturePrevue) return;
    fermeturePrevue = false;
    if (surfaces.size) return;
    cible = surface;
    avecCercle = !!surface.ondes;
    if (mouvementReduit() || !lireLeBouton()) {
      retirerLeCalque();
      cible = null;
      poserLaPhase('repos');
      return;
    }
    // Une onde vivante se resserre d'abord ; un cercle encore en chargement repart de lui.
    const ecoute = surface.el.querySelector('[data-ondes-du-volet]')?.getAttribute('data-voix-etat') === 'ecoute' || !!surface.ondes;
    partir(-1, image ? u : ecoute && surface.ondes ? 1 : FIN_DE_L_OUVERTURE);
  });
}

/**
 * UNE SURFACE DE JARVIS (bulle vocale, volet de l'assistant) : son montage fait partir le morphing depuis le bouton,
 * son démontage le fait revenir. `actif` faux : elle ne compte pas (le volet sur téléphone est une feuille du bas).
 */
export function useSurfaceDeJarvis(nom: string, ref: React.RefObject<HTMLElement | null>, actif = true): void {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!actif || !el) return;
    ouvrirSurface(nom, el);
    // Sa boîte se relit tant qu'elle vit : au démontage, l'élément n'est peut-être déjà plus mesurable.
    const observateur = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      const s = surfaces.get(nom);
      if (s && s.el === el && !(image && cible === s)) relire(s);
    }) : null;
    observateur?.observe(el);
    return () => {
      observateur?.disconnect();
      fermerSurface(nom, el);
    };
  }, [nom, ref, actif]);
}
