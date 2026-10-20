import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CalendarClock, ChevronDown, Crosshair, Layers, List, Loader2, Minus, Plus, Search, X } from 'lucide-react';
import {
  FAMILLES_DU_GRAPHE,
  PORTEE_GLOBALE,
  RAYON_DU_POINT,
  ancetresDuNoeud,
  cadreDesNoeuds,
  construireLArbre,
  dansLaBranche,
  disposerLArbre,
  idDeProjetDuGraphe,
  jourDuGraphe,
  joursDeLaMemoire,
  niveauxALaDate,
  NIVEAU_ESTOMPE,
  NIVEAU_PLEIN,
  periodeDuJour,
  titreAffiche,
  type JourDeLaMemoire,
  type PeriodeDuGraphe,
  type ArbreDuGraphe,
  type ElementDuGraphe,
  type FamilleDuGraphe,
  type GenreDeNoeud,
  type NoeudDuGraphe,
  type Unite,
} from '@beluga/shared';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ZoneDefilement } from '@/components/ui';
import { DeuxCalendriers, libelleDePlage } from '@/components/selecteur-periode';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE GRAPHE DE LA MÉMOIRE — ce que l'écran Mémoire montre à l'ouverture
 * (décision de l'utilisateur, 2026-10-20) : toute la base de connaissances en
 * BRANCHES, à plat, du noyau (le Global) vers chaque projet, ses catégories,
 * ses thèmes et ses éléments. L'arbre et sa mise en place sont des règles pures
 * (`shared/src/graphe-memoire.ts`) ; ce fichier les DESSINE.
 *
 * UN CANEVAS, PAS DES MILLIERS DE NŒUDS DU DOCUMENT : 6 000 points se dessinent
 * en quelques millisecondes, et seulement quand quelque chose change (aucune
 * boucle d'animation au repos). Le déplacement et le zoom sont écrits ici, par
 * les événements de pointeur : ce n'est PAS un glisser-déposer (`usePointerDrag`
 * reste le seul de l'application). Niveau de détail : les noms du noyau, des
 * projets et des catégories d'abord, ceux des thèmes en approchant, ceux des
 * éléments de près ou au survol ; deux noms ne se chevauchent jamais.
 * DÉFILER DÉPLACE (molette, deux doigts, Maj + molette à l'horizontale) ;
 * PINCER ou Ctrl + molette ZOOME (demande du 2026-10-20). Une MINI-CARTE, au
 * coin bas droit sur ordinateur, montre l'arbre entier et la part visible ; un
 * clic ou un glisser y amène la vue.
 *
 * LES COULEURS se lisent dans les jetons `--graphe-*` des deux palettes — des
 * teintes VIVES, bien distinctes (demande du 2026-10-20) —, et se relisent
 * quand le thème change. L'élément choisi se marque d'un HALO, jamais d'une
 * couleur : le violet y est celui des compétences.
 *
 * Un canevas est muet pour les contrôles et les lecteurs d'écran : son état se
 * lit sur son cadre (`data-graphe-*`), et les éléments trouvés par la recherche
 * existent aussi en vraie liste de boutons.
 */

/* ------------------------------------------------------------------ */
/* Les données : chargées une fois, gardées le temps de la session    */
/* ------------------------------------------------------------------ */

export interface PorteeDuGraphe {
  id: string;
  nom: string;
  unites: number;
}

interface DonneesDuGraphe {
  signature: string;
  portees: PorteeDuGraphe[];
  elements: ElementDuGraphe[];
}

/* LE GRAPHE SE GARDE D'UNE OUVERTURE À L'AUTRE : rouvrir l'écran le redessine
   aussitôt, et le démon ne renvoie rien tant que la base n'a pas bougé. */
let dernieresDonnees: DonneesDuGraphe | null = null;
let dernierArbre: { signature: string; arbre: ArbreDuGraphe } | null = null;

function arbreDe(donnees: DonneesDuGraphe): ArbreDuGraphe {
  if (dernierArbre?.signature === donnees.signature) return dernierArbre.arbre;
  const arbre = disposerLArbre(construireLArbre(donnees.elements, donnees.portees));
  dernierArbre = { signature: donnees.signature, arbre };
  return arbre;
}

export function useGrapheDeLaMemoire(actif: boolean): { donnees: DonneesDuGraphe | null; arbre: ArbreDuGraphe | null } {
  const [donnees, setDonnees] = React.useState<DonneesDuGraphe | null>(dernieresDonnees);
  React.useEffect(() => {
    if (!actif) return;
    let vivant = true;
    client
      .call<{ signature: string; inchange?: boolean; portees?: PorteeDuGraphe[]; elements?: ElementDuGraphe[] }>(
        { type: 'memoire.graphe', signature: dernieresDonnees?.signature },
        60_000,
      )
      .then((r) => {
        if (!vivant || (r.inchange && dernieresDonnees)) return;
        dernieresDonnees = { signature: r.signature, portees: r.portees ?? [], elements: r.elements ?? [] };
        setDonnees(dernieresDonnees);
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Mémoire illisible')));
    return () => {
      vivant = false;
    };
  }, [actif]);
  const arbre = React.useMemo(() => (donnees ? arbreDe(donnees) : null), [donnees]);
  return { donnees, arbre };
}

/* ------------------------------------------------------------------ */
/* Les couleurs, lues dans les jetons du thème                        */
/* ------------------------------------------------------------------ */

interface Couleurs {
  texte: string;
  doux: string;
  pale: string;
  fond: string;
  surface: string;
  familles: Record<FamilleDuGraphe, string>;
}

/** Un jeton `H S% L%` → `hsl(H, S%, L%)`, lisible par le canevas de tous les navigateurs. */
function lireJeton(style: CSSStyleDeclaration, nom: string, secours: string): string {
  const brut = style.getPropertyValue(nom).trim().split('/')[0]!.trim();
  const parts = brut.split(/\s+/);
  return parts.length >= 3 ? `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})` : secours;
}

function lireLesCouleurs(): Couleurs {
  const style = getComputedStyle(document.documentElement);
  const familles = {} as Record<FamilleDuGraphe, string>;
  for (const f of FAMILLES_DU_GRAPHE) familles[f.cle] = lireJeton(style, f.jeton, '#888');
  return {
    texte: lireJeton(style, '--text', '#eee'),
    doux: lireJeton(style, '--muted', '#aaa'),
    pale: lireJeton(style, '--faint', '#777'),
    fond: lireJeton(style, '--bg', '#222'),
    surface: lireJeton(style, '--surface', '#2a2a2a'),
    familles,
  };
}

/* ------------------------------------------------------------------ */
/* La toile : dessin, déplacement, zoom, atteinte                     */
/* ------------------------------------------------------------------ */

/** Ce qui change l'allure du graphe : le focus, la recherche, la sélection. */
export interface EtatDuGraphe {
  /** L'indice du nœud mis en avant (un projet, ou le noyau pour le Global) ; `null` : la vue d'ensemble. */
  focus: number | null;
  /** Les éléments allumés par la recherche ; `null` : pas de recherche. */
  allumes: ReadonlySet<number> | null;
  /** Les huit que l'agent recevrait : cerclés et nommés. */
  recus: ReadonlySet<number>;
  selection: number | null;
  /** Les voisins par le sens de la sélection (et le modèle d'une nuance) : les fils fins. */
  voisins: readonly number[];
}

export interface ToileDuGrapheRef {
  /** Cadrer la vue sur des nœuds (et leurs sous-branches si `branches`), en douceur. */
  cadrer: (indices: Iterable<number>, branches?: boolean) => void;
  zoomer: (facteur: number) => void;
}

interface Camera {
  x: number;
  y: number;
  k: number;
}

/** Les bornes du rayon d'un point À L'ÉCRAN, en pixels : un élément reste un point lisible de loin, sans grossir sans fin de près. */
const RAYON_ECRAN: Readonly<Record<GenreDeNoeud, [number, number]>> = {
  noyau: [6, 16],
  projet: [3.6, 11],
  categorie: [2.6, 8],
  theme: [1.8, 5.5],
  element: [0.9, 5],
};
/** L'épaisseur et l'opacité d'un trait, selon le genre de l'enfant qu'il rejoint. */
const TRAIT: Readonly<Record<GenreDeNoeud, { largeur: number; alpha: number }>> = {
  noyau: { largeur: 0, alpha: 0 },
  projet: { largeur: 1.4, alpha: 0.5 },
  categorie: { largeur: 1.2, alpha: 0.55 },
  theme: { largeur: 0.9, alpha: 0.45 },
  element: { largeur: 0.6, alpha: 0.28 },
};
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 14;
/** En deçà, les tiges des éléments ne se dessinent pas : le tournesol suffit à dire la grappe. */
const ZOOM_DES_TIGES = 0.9;
/** Au-delà, les éléments se nomment (s'il y a la place). */
const ZOOM_DES_ELEMENTS = 3.2;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
/** La mini-carte du coin bas droit, en pixels CSS, et la marge autour de l'arbre. */
const MINI_LARGEUR = 180;
const MINI_HAUTEUR = 130;
const MINI_MARGE = 8;

/** La présence d'un nœud ESTOMPÉ (né avant le début de la période) : là, mais en arrière-plan. */
const PRESENCE_ESTOMPEE = 0.22;
/** La durée d'un passage d'une date à l'autre, en millisecondes. */
const DUREE_DU_PASSAGE = 420;

/** La présence visée de chaque nœud : 0 caché, estompé, 1 plein. */
function presencesDe(niveaux: Uint8Array): Float32Array {
  const p = new Float32Array(niveaux.length);
  for (let i = 0; i < niveaux.length; i += 1) p[i] = niveaux[i] === NIVEAU_PLEIN ? 1 : niveaux[i] === NIVEAU_ESTOMPE ? PRESENCE_ESTOMPEE : 0;
  return p;
}

/** Les alphas de chaque nœud, selon le focus et la recherche. */
function alphasDe(arbre: ArbreDuGraphe, etat: EtatDuGraphe): Float32Array {
  const n = arbre.noeuds.length;
  const alpha = new Float32Array(n).fill(1);
  if (etat.allumes) {
    const chemin = new Set<number>();
    for (const i of etat.allumes) for (const a of ancetresDuNoeud(arbre, i)) chemin.add(a);
    for (let i = 0; i < n; i += 1) alpha[i] = etat.allumes.has(i) || chemin.has(i) ? 1 : 0.08;
    return alpha;
  }
  if (etat.focus != null) {
    for (let i = 0; i < n; i += 1) {
      const noeud = arbre.noeuds[i]!;
      // Le Global (focus sur le noyau) : ses propres catégories, pas les projets.
      const dedans = etat.focus === 0 ? noeud.branche === PORTEE_GLOBALE : dansLaBranche(arbre, i, etat.focus);
      alpha[i] = dedans ? 1 : i === 0 ? 0.5 : 0.15;
    }
  }
  return alpha;
}

/** Les points de contrôle des branches : chaque trait part dans la direction de son parent, en courbe douce. */
function controlesDe(arbre: ArbreDuGraphe): Float64Array {
  const c = new Float64Array(arbre.noeuds.length * 2);
  for (const [i, noeud] of arbre.noeuds.entries()) {
    if (noeud.parent < 0) continue;
    const p = arbre.noeuds[noeud.parent]!;
    const gp = p.parent >= 0 ? arbre.noeuds[p.parent]! : null;
    let dx = noeud.x - p.x;
    let dy = noeud.y - p.y;
    const longueur = Math.hypot(dx, dy) || 1;
    if (gp && noeud.genre !== 'element') {
      const ex = p.x - gp.x;
      const ey = p.y - gp.y;
      const el = Math.hypot(ex, ey) || 1;
      dx = (ex / el) * longueur;
      dy = (ey / el) * longueur;
    }
    c[i * 2] = p.x + dx * 0.45;
    c[i * 2 + 1] = p.y + dy * 0.45;
  }
  return c;
}

/** L'ordre dans lequel les noms se posent, par genre : les plus grosses branches d'abord. */
function ordresDesNoms(arbre: ArbreDuGraphe): Record<'projet' | 'categorie' | 'theme', number[]> {
  const ordres = { projet: [] as number[], categorie: [] as number[], theme: [] as number[] };
  arbre.noeuds.forEach((noeud, i) => {
    if (noeud.genre === 'projet' || noeud.genre === 'categorie' || noeud.genre === 'theme') ordres[noeud.genre].push(i);
  });
  for (const liste of Object.values(ordres)) liste.sort((a, b) => arbre.noeuds[b]!.poids - arbre.noeuds[a]!.poids);
  return ordres;
}

function couper(texte: string, max: number): string {
  return texte.length > max ? `${texte.slice(0, max - 1).trimEnd()}…` : texte;
}

/** Le nom qu'un nœud porte à l'écran, traduit pour ce qui vient de l'interface. */
export function nomDuNoeud(noeud: NoeudDuGraphe): string {
  if (noeud.genre === 'noyau') return t('Global');
  if (noeud.genre === 'categorie' || noeud.genre === 'theme') return t(noeud.libelle);
  return noeud.libelle;
}

export const ToileDuGraphe = React.forwardRef<
  ToileDuGrapheRef,
  {
    arbre: ArbreDuGraphe;
    etat: EtatDuGraphe;
    onChoisir: (indice: number | null) => void;
    /** Le contenu de la bulle de survol d'un nœud. */
    bulle: (noeud: NoeudDuGraphe) => React.ReactNode;
    /** Ce qui couvre la toile, en pixels — la recherche en haut, la fiche à droite (en bas sur téléphone) : le cadrage vise ce qui reste visible. */
    couvert?: () => { haut: number; droite: number; bas: number };
    /** La mini-carte du coin bas droit (ordinateur seulement), et son retrait depuis le bord droit en pixels. */
    minicarte?: { droite: number } | null;
    /** Le niveau de chaque nœud à la période regardée (`niveauxALaDate`) : 0 caché, 1 estompé, 2 plein. */
    niveaux: Uint8Array;
    /** Combien d'éléments se voient à cette période. */
    visibles: number;
  }
>(function ToileDuGraphe({ arbre, etat, onChoisir, bulle, couvert, minicarte, niveaux, visibles }, ref) {
  const cadre = React.useRef<HTMLDivElement>(null);
  const toile = React.useRef<HTMLCanvasElement>(null);
  const mini = React.useRef<HTMLCanvasElement>(null);
  const bulleRef = React.useRef<HTMLDivElement>(null);
  const [survole, setSurvole] = React.useState<number | null>(null);
  const [pret, setPret] = React.useState(false);
  const [anime, setAnime] = React.useState(false);
  /* Tout ce que le dessin lit vit dans une référence : un déplacement ne repasse jamais par React. */
  const m = React.useRef({
    camera: { x: 0, y: 0, k: 1 } as Camera,
    largeur: 0,
    hauteur: 0,
    dpr: 1,
    couleurs: null as Couleurs | null,
    alpha: alphasDe(arbre, etat),
    controles: controlesDe(arbre),
    etat,
    arbre,
    survole: null as number | null,
    ordres: ordresDesNoms(arbre),
    image: 0,
    animation: 0,
    pret: false,
    police: 'system-ui, sans-serif',
    /** Le fond de la mini-carte — l'arbre entier en points —, dessiné une fois par état, jamais à chaque image. */
    fondMini: null as { image: HTMLCanvasElement; k: number; ox: number; oy: number } | null,
    /** LA PRÉSENCE DE CHAQUE NŒUD À LA DATE, telle qu'on la dessine (0 caché → 1 plein), et celle visée. */
    presence: presencesDe(niveaux),
    cible: presencesDe(niveaux),
    passage: 0,
  });
  const choisir = React.useRef(onChoisir);
  choisir.current = onChoisir;
  const margeHaute = React.useRef(couvert);
  margeHaute.current = couvert;

  /**
   * LE FOND DE LA MINI-CARTE : l'arbre entier, réduit, en points de la couleur
   * de leur famille (estompés comme sur la toile). Préparé hors écran à chaque
   * nouvel arbre, nouvel état ou nouveau thème — seul le rectangle de la vue se
   * redessine ensuite, à chaque image.
   */
  const preparerLaMinicarte = React.useCallback(() => {
    const s = m.current;
    if (!s.couleurs) return;
    const c = s.couleurs;
    const { x0, y0, x1, y1 } = s.arbre.noeuds[0]!.cadre;
    const k = Math.min((MINI_LARGEUR - MINI_MARGE * 2) / Math.max(x1 - x0, 1), (MINI_HAUTEUR - MINI_MARGE * 2) / Math.max(y1 - y0, 1));
    const ox = MINI_LARGEUR / 2 - ((x0 + x1) / 2) * k;
    const oy = MINI_HAUTEUR / 2 - ((y0 + y1) / 2) * k;
    const image = s.fondMini?.image ?? document.createElement('canvas');
    image.width = Math.round(MINI_LARGEUR * s.dpr);
    image.height = Math.round(MINI_HAUTEUR * s.dpr);
    const ctx = image.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, MINI_LARGEUR, MINI_HAUTEUR);
    const noeuds = s.arbre.noeuds;
    for (let i = noeuds.length - 1; i >= 0; i -= 1) {
      const noeud = noeuds[i]!;
      // La mini-carte suit la période regardée : ce qui n'existait pas n'y paraît pas.
      const presence = s.cible[i]!;
      if (presence <= 0) continue;
      const r = noeud.genre === 'element' ? 0.6 : noeud.genre === 'theme' ? 1 : noeud.genre === 'noyau' ? 2.6 : 1.6;
      ctx.globalAlpha = Math.max(0.12, s.alpha[i]! * presence) * (noeud.genre === 'element' ? 0.85 : 1);
      ctx.fillStyle = noeud.famille ? c.familles[noeud.famille] : noeud.genre === 'noyau' ? c.texte : c.doux;
      ctx.fillRect(noeud.x * k + ox - r, noeud.y * k + oy - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    s.fondMini = { image, k, ox, oy };
  }, []);

  /** La mini-carte : son fond, puis la part de l'arbre que la toile montre, en rectangle. */
  const dessinerLaMinicarte = React.useCallback(() => {
    const s = m.current;
    const canvas = mini.current;
    const fond = s.fondMini;
    if (!canvas || !fond || !s.couleurs || !s.largeur) return;
    const largeurVoulue = Math.round(MINI_LARGEUR * s.dpr);
    if (canvas.width !== largeurVoulue) {
      canvas.width = largeurVoulue;
      canvas.height = Math.round(MINI_HAUTEUR * s.dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fond.image, 0, 0);
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    const { camera: cam } = s;
    const vx0 = (cam.x - s.largeur / 2 / cam.k) * fond.k + fond.ox;
    const vy0 = (cam.y - s.hauteur / 2 / cam.k) * fond.k + fond.oy;
    const vl = (s.largeur / cam.k) * fond.k;
    const vh = (s.hauteur / cam.k) * fond.k;
    // La vue montre déjà tout : pas de rectangle, il ne ferait qu'une bordure.
    if (vx0 <= 0 && vy0 <= 0 && vx0 + vl >= MINI_LARGEUR && vy0 + vh >= MINI_HAUTEUR) return;
    // Une vue qui déborde de la mini-carte reste un cadre lisible, collé aux bords.
    const rx0 = clamp(vx0, 1, MINI_LARGEUR - 3);
    const ry0 = clamp(vy0, 1, MINI_HAUTEUR - 3);
    const rx1 = clamp(vx0 + vl, rx0 + 2, MINI_LARGEUR - 1);
    const ry1 = clamp(vy0 + vh, ry0 + 2, MINI_HAUTEUR - 1);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = s.couleurs.texte;
    ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = s.couleurs.texte;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    ctx.globalAlpha = 1;
  }, []);

  const dessiner = React.useCallback(() => {
    const s = m.current;
    s.image = 0;
    const canvas = toile.current;
    if (!canvas || !s.couleurs || !s.largeur) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { camera: cam, largeur: w, hauteur: h, couleurs: c, alpha, controles, arbre: a, etat: e, presence } = s;
    const noeuds = a.noeuds;
    const k = cam.k;
    const ox = w / 2 - cam.x * k;
    const oy = h / 2 - cam.y * k;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    const couleurDe = (noeud: NoeudDuGraphe) => (noeud.famille ? c.familles[noeud.famille] : noeud.genre === 'noyau' ? c.texte : c.doux);
    const rayon = (noeud: NoeudDuGraphe, i?: number) => {
      const [min, max] = RAYON_ECRAN[noeud.genre];
      const base = noeud.genre === 'element' && noeud.element?.importance === 'P0' ? 1.35 : 1;
      const r = clamp(RAYON_DU_POINT[noeud.genre] * base * k, min * base, max * base);
      // Un point qui naît GROSSIT, un point qui s'en va RÉTRÉCIT ; estompé, il garde sa taille.
      return i == null ? r : r * (0.3 + 0.7 * Math.min(1, presence[i]! / PRESENCE_ESTOMPEE));
    };

    // 1. Les branches, par paquets de même style.
    let style = '';
    let largeurTrait = -1;
    let alphaTrait = -1;
    let ouvert = false;
    const fermer = () => {
      if (ouvert) ctx.stroke();
      ouvert = false;
    };
    const tiges = k >= ZOOM_DES_TIGES;
    for (let i = 1; i < noeuds.length; i += 1) {
      const noeud = noeuds[i]!;
      if (noeud.genre === 'element' && !tiges) continue;
      const p = noeuds[noeud.parent]!;
      const x1 = p.x * k + ox;
      const y1 = p.y * k + oy;
      const x2 = noeud.x * k + ox;
      const y2 = noeud.y * k + oy;
      if (Math.max(x1, x2) < -40 || Math.min(x1, x2) > w + 40 || Math.max(y1, y2) < -40 || Math.min(y1, y2) > h + 40) continue;
      const trait = TRAIT[noeud.genre];
      const a2 = Math.round(alpha[i]! * presence[i]! * trait.alpha * 100) / 100;
      if (a2 < 0.02) continue;
      const couleur = noeud.genre === 'projet' ? c.pale : couleurDe(noeud);
      if (couleur !== style || trait.largeur !== largeurTrait || a2 !== alphaTrait) {
        fermer();
        style = couleur;
        largeurTrait = trait.largeur;
        alphaTrait = a2;
        ctx.strokeStyle = couleur;
        ctx.lineWidth = trait.largeur;
        ctx.globalAlpha = a2;
        ctx.beginPath();
        ouvert = true;
      }
      ctx.moveTo(x1, y1);
      if (noeud.genre === 'element') ctx.lineTo(x2, y2);
      else ctx.quadraticCurveTo(controles[i * 2]! * k + ox, controles[i * 2 + 1]! * k + oy, x2, y2);
    }
    fermer();

    // 2. Les points : les feuilles d'abord, les parents par-dessus.
    let remplissage = '';
    let alphaPoint = -1;
    ouvert = false;
    const remplir = () => {
      if (ouvert) ctx.fill();
      ouvert = false;
    };
    for (let i = noeuds.length - 1; i >= 0; i -= 1) {
      const noeud = noeuds[i]!;
      if (presence[i]! < 0.01) continue;
      const sx = noeud.x * k + ox;
      const sy = noeud.y * k + oy;
      const r = rayon(noeud, i);
      if (sx < -r || sx > w + r || sy < -r || sy > h + r) continue;
      const a2 = Math.round(alpha[i]! * presence[i]! * (noeud.genre === 'element' ? 0.9 : 1) * 100) / 100;
      const couleur = couleurDe(noeud);
      if (couleur !== remplissage || a2 !== alphaPoint) {
        remplir();
        remplissage = couleur;
        alphaPoint = a2;
        ctx.fillStyle = couleur;
        ctx.globalAlpha = a2;
        ctx.beginPath();
        ouvert = true;
      }
      if (r < 1.3) ctx.rect(sx - r, sy - r, r * 2, r * 2);
      else {
        ctx.moveTo(sx + r, sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
      }
    }
    remplir();

    // 3. Ce que l'agent recevrait : un cercle autour du point.
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = c.texte;
    ctx.lineWidth = 1.4;
    for (const i of e.recus) {
      const noeud = noeuds[i];
      if (!noeud || presence[i]! < 0.01) continue;
      ctx.beginPath();
      ctx.arc(noeud.x * k + ox, noeud.y * k + oy, rayon(noeud) + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. La sélection : un halo, et des fils fins vers ses voisins par le sens.
    if (e.selection != null && noeuds[e.selection]) {
      const sel = noeuds[e.selection]!;
      const sx = sel.x * k + ox;
      const sy = sel.y * k + oy;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c.texte;
      ctx.globalAlpha = 0.55;
      for (const v of e.voisins) {
        const voisin = noeuds[v];
        if (!voisin || !presence[v]) continue;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(voisin.x * k + ox, voisin.y * k + oy);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const v of e.voisins) {
        const voisin = noeuds[v];
        if (!voisin || !presence[v]) continue;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(voisin.x * k + ox, voisin.y * k + oy, rayon(voisin) + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      const r = rayon(sel);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = c.texte;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 5. Les noms : les plus importants d'abord, jamais deux l'un sur l'autre.
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const poses: number[] = [];
    const libre = (x0: number, y0: number, x1: number, y1: number) => {
      for (let j = 0; j < poses.length; j += 4) {
        if (x0 < poses[j + 2]! && x1 > poses[j]! && y0 < poses[j + 3]! && y1 > poses[j + 1]!) return false;
      }
      return true;
    };
    const nommes = new Set<number>();
    const nommer = (i: number, taille: number, poids: number, couleur: string, force = false, max = 44) => {
      const noeud = noeuds[i];
      if (!noeud || nommes.has(i) || presence[i]! < 0.01) return;
      const a2 = force ? 1 : alpha[i]! * presence[i]!;
      if (a2 < 0.3) return;
      const sx = noeud.x * k + ox;
      const sy = noeud.y * k + oy;
      if (sx < -200 || sx > w + 50 || sy < -20 || sy > h + 20) return;
      const texte = couper(nomDuNoeud(noeud), max);
      ctx.font = `${poids} ${taille}px ${s.police}`;
      const largeurTexte = ctx.measureText(texte).width;
      // Un nom qui sortirait à droite se pose à gauche de son point.
      const aDroite = sx + rayon(noeud) + 5;
      const aGauche = sx - rayon(noeud) - 5 - largeurTexte;
      const x0 = aDroite + largeurTexte > w - 6 && aGauche >= 6 ? aGauche : aDroite;
      const marge = 3;
      const boite = [x0 - marge, sy - taille * 0.7, x0 + largeurTexte + marge, sy + taille * 0.7] as const;
      if (!force && !libre(...boite)) return;
      poses.push(...boite);
      nommes.add(i);
      ctx.globalAlpha = a2;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = c.fond;
      ctx.strokeText(texte, x0, sy);
      ctx.fillStyle = couleur;
      ctx.fillText(texte, x0, sy);
    };
    // D'abord ce qu'on désigne : la sélection, le survol, les reçus, les voisins.
    if (e.selection != null) nommer(e.selection, 13, 600, c.texte, true, 60);
    if (s.survole != null && s.survole !== e.selection) nommer(s.survole, 12.5, 500, c.texte, true, 60);
    for (const i of e.recus) nommer(i, 12, 500, c.texte);
    for (const v of e.voisins) nommer(v, 11.5, 400, c.doux);
    nommer(0, 14, 600, c.texte, true);
    for (const i of s.ordres.projet) nommer(i, 12.5, 600, c.texte);
    for (const i of s.ordres.categorie) if (noeuds[i]!.etendue * k >= 34) nommer(i, 11.5, 500, c.doux);
    for (const i of s.ordres.theme) if (noeuds[i]!.etendue * k >= 26) nommer(i, 11, 400, c.pale);
    if (k >= ZOOM_DES_ELEMENTS) {
      let combien = 0;
      for (let i = 0; i < noeuds.length && combien < 400; i += 1) {
        const noeud = noeuds[i]!;
        if (noeud.genre !== 'element') continue;
        const sx = noeud.x * k + ox;
        const sy = noeud.y * k + oy;
        if (sx < 0 || sx > w || sy < 0 || sy > h) continue;
        combien += 1;
        nommer(i, 11, 400, c.doux, false, 40);
      }
    }
    ctx.globalAlpha = 1;
    if (cadre.current) {
      cadre.current.dataset.grapheZoom = k.toFixed(3);
      cadre.current.dataset.grapheCentre = `${cam.x.toFixed(1)},${cam.y.toFixed(1)}`;
    }
    dessinerLaMinicarte();
  }, [dessinerLaMinicarte]);

  const redessiner = React.useCallback(() => {
    const s = m.current;
    if (!s.image) s.image = requestAnimationFrame(dessiner);
  }, [dessiner]);

  /**
   * La caméra qui cadre un rectangle du monde, avec une marge — et sous ce qui
   * couvre le haut de la toile (la recherche et ses résultats) : le cadre vise
   * la part VISIBLE.
   */
  const cameraPour = React.useCallback((c: { x0: number; y0: number; x1: number; y1: number }): Camera => {
    const s = m.current;
    const couvert = margeHaute.current?.() ?? { haut: 0, droite: 0, bas: 0 };
    const haut = Math.min(couvert.haut, s.hauteur * 0.6);
    const bas = Math.min(couvert.bas, Math.max(0, s.hauteur - haut - 80));
    const droite = Math.min(couvert.droite, s.largeur * 0.6);
    const largeur = Math.max(c.x1 - c.x0, 40);
    const hauteur = Math.max(c.y1 - c.y0, 40);
    const k = clamp(Math.min(((s.largeur - droite) * 0.9) / largeur, ((s.hauteur - haut - bas) * 0.88) / hauteur), ZOOM_MIN, 3);
    return { x: (c.x0 + c.x1) / 2 + droite / 2 / k, y: (c.y0 + c.y1) / 2 - (haut - bas) / 2 / k, k };
  }, []);

  const allerA = React.useCallback(
    (cible: Camera, duree = 520) => {
      const s = m.current;
      cancelAnimationFrame(s.animation);
      if (!s.pret) {
        s.camera = cible;
        redessiner();
        return;
      }
      const depart = { ...s.camera };
      const t0 = performance.now();
      const pas = (maintenant: number) => {
        const p = Math.min(1, (maintenant - t0) / duree);
        const u = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
        // Le zoom glisse en échelle logarithmique : un grand saut ne paraît pas brutal.
        const k = Math.exp(Math.log(depart.k) + (Math.log(cible.k) - Math.log(depart.k)) * u);
        s.camera = { x: depart.x + (cible.x - depart.x) * u, y: depart.y + (cible.y - depart.y) * u, k };
        dessiner();
        if (p < 1) s.animation = requestAnimationFrame(pas);
      };
      s.animation = requestAnimationFrame(pas);
    },
    [dessiner, redessiner],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      cadrer: (indices, branches = false) => {
        const c = cadreDesNoeuds(m.current.arbre, indices, branches);
        if (c) allerA(cameraPour(c));
      },
      zoomer: (facteur) => {
        const s = m.current;
        allerA({ ...s.camera, k: clamp(s.camera.k * facteur, ZOOM_MIN, ZOOM_MAX) }, 260);
      },
    }),
    [allerA, cameraPour],
  );

  // Un nouvel arbre ou un nouvel état : les alphas se recalculent, le dessin suit.
  React.useEffect(() => {
    const s = m.current;
    if (s.arbre !== arbre) {
      s.arbre = arbre;
      s.controles = controlesDe(arbre);
      s.ordres = ordresDesNoms(arbre);
    }
    s.etat = etat;
    s.alpha = alphasDe(arbre, etat);
    preparerLaMinicarte();
    redessiner();
  }, [arbre, etat, preparerLaMinicarte, redessiner]);

  /*
   * UNE AUTRE DATE : LES POINTS NAISSENT OU S'EN VONT EN FONDU, sans qu'aucun
   * ne bouge (places fixes, décision du 2026-10-20). Seuls les nœuds qui
   * changent s'animent, ~420 ms, puis la boucle s'arrête : aucune boucle au
   * repos. « Animations réduites » : le changement est immédiat. Un nouvel
   * arbre (la base a bougé) se pose d'un coup.
   */
  React.useEffect(() => {
    const s = m.current;
    cancelAnimationFrame(s.passage);
    const cible = presencesDe(niveaux);
    s.cible = cible;
    preparerLaMinicarte();
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (s.presence.length !== cible.length || !s.pret || reduit) {
      s.presence = cible.slice();
      setAnime(false);
      redessiner();
      return;
    }
    const depart = s.presence.slice();
    const changes: number[] = [];
    for (let i = 0; i < cible.length; i += 1) if (depart[i] !== cible[i]) changes.push(i);
    if (!changes.length) return;
    setAnime(true);
    const t0 = performance.now();
    const pas = (maintenant: number) => {
      const p = Math.min(1, (maintenant - t0) / DUREE_DU_PASSAGE);
      const u = 1 - (1 - p) ** 3;
      for (const i of changes) s.presence[i] = depart[i]! + (cible[i]! - depart[i]!) * u;
      dessiner();
      if (p < 1) s.passage = requestAnimationFrame(pas);
      else {
        s.passage = 0;
        setAnime(false);
      }
    };
    s.passage = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(s.passage);
  }, [niveaux, dessiner, preparerLaMinicarte, redessiner]);

  // La taille, les couleurs du thème, la police.
  React.useEffect(() => {
    const s = m.current;
    const conteneur = cadre.current;
    const canvas = toile.current;
    if (!conteneur || !canvas) return;
    s.couleurs = lireLesCouleurs();
    s.police = getComputedStyle(document.body).fontFamily || s.police;
    const mesurer = () => {
      const boite = conteneur.getBoundingClientRect();
      s.largeur = Math.max(1, Math.round(boite.width));
      s.hauteur = Math.max(1, Math.round(boite.height));
      s.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(s.largeur * s.dpr);
      canvas.height = Math.round(s.hauteur * s.dpr);
      canvas.style.width = `${s.largeur}px`;
      canvas.style.height = `${s.hauteur}px`;
      if (!s.pret && s.largeur > 10 && s.hauteur > 10) {
        s.camera = cameraPour(s.arbre.noeuds[0]!.cadre);
        s.pret = true;
        setPret(true);
      }
      preparerLaMinicarte();
      dessiner();
    };
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(conteneur);
    mesurer();
    // LE THÈME CHANGE : la classe ou l'attribut de la racine bougent, les jetons sont relus.
    const theme = new MutationObserver(() => {
      s.couleurs = lireLesCouleurs();
      preparerLaMinicarte();
      redessiner();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    return () => {
      observateur.disconnect();
      theme.disconnect();
      cancelAnimationFrame(s.image);
      cancelAnimationFrame(s.animation);
      s.image = 0;
    };
  }, [cameraPour, dessiner, preparerLaMinicarte, redessiner]);

  // La mini-carte apparaît (ou revient) : son canevas neuf se remplit tout de suite.
  const avecMinicarte = Boolean(minicarte);
  React.useEffect(() => {
    if (avecMinicarte) redessiner();
  }, [avecMinicarte, redessiner]);

  /** Le nœud sous un point de l'écran : le plus proche, dans un rayon d'atteinte confortable. */
  const atteindre = React.useCallback((sx: number, sy: number): number | null => {
    const s = m.current;
    const { k } = s.camera;
    const wx = (sx - s.largeur / 2) / k + s.camera.x;
    const wy = (sy - s.hauteur / 2) / k + s.camera.y;
    let meilleur: number | null = null;
    let distance = Infinity;
    const noeuds = s.arbre.noeuds;
    for (let i = 0; i < noeuds.length; i += 1) {
      const noeud = noeuds[i]!;
      // Ce qui n'existait pas à la date regardée ne se laisse pas atteindre.
      if (!s.cible[i]) continue;
      const [min, max] = RAYON_ECRAN[noeud.genre];
      const portee = Math.max(clamp(RAYON_DU_POINT[noeud.genre] * k, min, max) + 4, 8) / k;
      const d = Math.hypot(noeud.x - wx, noeud.y - wy);
      // Un point estompé se laisse atteindre, mais après un point allumé.
      const poids = d / (s.alpha[i]! * s.cible[i]! < 0.3 ? 0.6 : 1);
      if (d <= portee && poids < distance) {
        distance = poids;
        meilleur = i;
      }
    }
    return meilleur;
  }, []);

  /* Déplacer, pincer, survoler, choisir — par les événements de pointeur. */
  const pointeurs = React.useRef(new Map<number, { x: number; y: number }>());
  const geste = React.useRef<{ bouge: boolean; depart: { x: number; y: number }; camera: Camera; ecart?: number; milieu?: { x: number; y: number } } | null>(null);
  const position = (e: React.PointerEvent | PointerEvent | WheelEvent | React.MouseEvent) => {
    const boite = cadre.current!.getBoundingClientRect();
    return { x: e.clientX - boite.left, y: e.clientY - boite.top };
  };
  const montrerLaBulle = (i: number | null, p?: { x: number; y: number }) => {
    const s = m.current;
    if (s.survole !== i) {
      s.survole = i;
      setSurvole(i);
      redessiner();
    }
    const b = bulleRef.current;
    if (b && p) {
      b.style.transform = `translate(${Math.min(p.x + 14, s.largeur - 280)}px, ${p.y + 16}px)`;
    }
  };

  const surAppui = (e: React.PointerEvent) => {
    cancelAnimationFrame(m.current.animation);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = position(e);
    pointeurs.current.set(e.pointerId, p);
    if (pointeurs.current.size === 1) geste.current = { bouge: false, depart: p, camera: { ...m.current.camera } };
    else if (pointeurs.current.size === 2) {
      const [a, b] = [...pointeurs.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      geste.current = { bouge: true, depart: p, camera: { ...m.current.camera }, ecart: Math.hypot(a.x - b.x, a.y - b.y), milieu: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  };
  const surDeplacement = (e: React.PointerEvent) => {
    const p = position(e);
    const s = m.current;
    if (!pointeurs.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse') montrerLaBulle(atteindre(p.x, p.y), p);
      return;
    }
    pointeurs.current.set(e.pointerId, p);
    const g = geste.current;
    if (!g) return;
    if (pointeurs.current.size >= 2 && g.ecart && g.milieu) {
      const [a, b] = [...pointeurs.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const ecart = Math.hypot(a.x - b.x, a.y - b.y);
      const milieu = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clamp(g.camera.k * (ecart / g.ecart), ZOOM_MIN, ZOOM_MAX);
      // Le point du monde sous le milieu de départ suit le milieu des doigts.
      const wx = (g.milieu.x - s.largeur / 2) / g.camera.k + g.camera.x;
      const wy = (g.milieu.y - s.hauteur / 2) / g.camera.k + g.camera.y;
      s.camera = { k, x: wx - (milieu.x - s.largeur / 2) / k, y: wy - (milieu.y - s.hauteur / 2) / k };
      redessiner();
      return;
    }
    const dx = p.x - g.depart.x;
    const dy = p.y - g.depart.y;
    if (!g.bouge && Math.hypot(dx, dy) < 5) return;
    g.bouge = true;
    montrerLaBulle(null);
    s.camera = { ...g.camera, x: g.camera.x - dx / g.camera.k, y: g.camera.y - dy / g.camera.k };
    redessiner();
  };
  const surRelache = (e: React.PointerEvent) => {
    const g = geste.current;
    const p = position(e);
    pointeurs.current.delete(e.pointerId);
    if (pointeurs.current.size === 1 && g?.ecart) {
      // Un doigt se lève après un pincement : l'autre reprend le déplacement, sans saut.
      const reste = [...pointeurs.current.values()][0]!;
      geste.current = { bouge: true, depart: reste, camera: { ...m.current.camera } };
      return;
    }
    if (pointeurs.current.size) return;
    geste.current = null;
    if (g && !g.bouge) choisir.current(atteindre(p.x, p.y));
  };

  /* LA MOLETTE DÉPLACE, CTRL + MOLETTE ZOOME (demande du 2026-10-20) : défiler
     (molette, deux doigts sur le pavé tactile) promène la carte dans les quatre
     sens, Maj + molette à l'horizontale ; le pincement du pavé tactile arrive
     en molette AVEC ctrlKey (Chrome, Firefox, Safari) et zoome autour du
     pointeur, comme Ctrl (ou Cmd) + molette. Un écouteur NON passif, pour
     garder la page immobile. */
  React.useEffect(() => {
    const conteneur = cadre.current;
    if (!conteneur) return;
    const surMolette = (e: WheelEvent) => {
      e.preventDefault();
      const s = m.current;
      cancelAnimationFrame(s.animation);
      const echelle = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? s.hauteur : 1;
      if (e.ctrlKey || e.metaKey) {
        // Safari le dit déjà par ses gestes (plus bas) : ne pas zoomer deux fois.
        if (pince) return;
        const p = position(e);
        // Un cran de souris (±100) est borné : il zoome d'un tiers, pas de dix fois ; un pincement envoie de petits pas, intacts.
        const facteur = Math.exp(-clamp(e.deltaY * echelle, -25, 25) * 0.012);
        const k = clamp(s.camera.k * facteur, ZOOM_MIN, ZOOM_MAX);
        const wx = (p.x - s.largeur / 2) / s.camera.k + s.camera.x;
        const wy = (p.y - s.hauteur / 2) / s.camera.k + s.camera.y;
        s.camera = { k, x: wx - (p.x - s.largeur / 2) / k, y: wy - (p.y - s.hauteur / 2) / k };
      } else {
        // Maj + molette : la souris n'a qu'une roue, elle sert alors à l'horizontale.
        const horizontal = e.shiftKey && !e.deltaX;
        const dx = (horizontal ? e.deltaY : e.deltaX) * echelle;
        const dy = (horizontal ? 0 : e.deltaY) * echelle;
        s.camera = { ...s.camera, x: s.camera.x + dx / s.camera.k, y: s.camera.y + dy / s.camera.k };
      }
      redessiner();
    };
    // Safari (macOS) dit le pincement du pavé tactile par ses propres gestes, avec une échelle cumulée.
    let pince: { k: number; x: number; y: number; camera: Camera } | null = null;
    type Geste = Event & { scale: number; clientX: number; clientY: number };
    const surDebutDePince = (e: Event) => {
      e.preventDefault();
      // Sur iPhone et iPad, les doigts passent déjà par les pointeurs : le geste ne zoome pas une seconde fois.
      if (pointeurs.current.size) return;
      const g = e as Geste;
      const boite = conteneur.getBoundingClientRect();
      pince = { k: m.current.camera.k, x: g.clientX - boite.left, y: g.clientY - boite.top, camera: { ...m.current.camera } };
    };
    const surPince = (e: Event) => {
      e.preventDefault();
      if (!pince) return;
      const s = m.current;
      const { camera: c, x, y } = pince;
      const k = clamp(pince.k * (e as Geste).scale, ZOOM_MIN, ZOOM_MAX);
      const wx = (x - s.largeur / 2) / c.k + c.x;
      const wy = (y - s.hauteur / 2) / c.k + c.y;
      s.camera = { k, x: wx - (x - s.largeur / 2) / k, y: wy - (y - s.hauteur / 2) / k };
      redessiner();
    };
    const surFinDePince = (e: Event) => {
      e.preventDefault();
      pince = null;
    };
    conteneur.addEventListener('wheel', surMolette, { passive: false });
    conteneur.addEventListener('gesturestart', surDebutDePince, { passive: false });
    conteneur.addEventListener('gesturechange', surPince, { passive: false });
    conteneur.addEventListener('gestureend', surFinDePince, { passive: false });
    return () => {
      conteneur.removeEventListener('wheel', surMolette);
      conteneur.removeEventListener('gesturestart', surDebutDePince);
      conteneur.removeEventListener('gesturechange', surPince);
      conteneur.removeEventListener('gestureend', surFinDePince);
    };
  }, [redessiner]);

  /* LA MINI-CARTE SE TOUCHE : un clic, ou un glisser, y amène la vue — sans changer le zoom. */
  const allerSurLaMinicarte = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = m.current;
    const fond = s.fondMini;
    if (!fond) return;
    const boite = e.currentTarget.getBoundingClientRect();
    cancelAnimationFrame(s.animation);
    s.camera = {
      ...s.camera,
      x: (e.clientX - boite.left - fond.ox) / fond.k,
      y: (e.clientY - boite.top - fond.oy) / fond.k,
    };
    redessiner();
  };

  const noeudSurvole = survole != null ? arbre.noeuds[survole] : null;
  return (
    <div
      ref={cadre}
      className="relative h-full w-full touch-none select-none overflow-hidden"
      data-memoire-graphe={pret ? 'pret' : 'chargement'}
      data-graphe-noeuds={arbre.noeuds.length}
      data-graphe-elements={visibles}
      data-graphe-total={arbre.noeuds[0]?.poids ?? 0}
      data-graphe-passage={anime ? 'en-cours' : 'fini'}
      onDoubleClick={(e) => {
        const s = m.current;
        const p = position(e);
        const k = clamp(s.camera.k * 2, ZOOM_MIN, ZOOM_MAX);
        const wx = (p.x - s.largeur / 2) / s.camera.k + s.camera.x;
        const wy = (p.y - s.hauteur / 2) / s.camera.k + s.camera.y;
        allerA({ k, x: wx - (p.x - s.largeur / 2) / k, y: wy - (p.y - s.hauteur / 2) / k }, 280);
      }}
    >
      <canvas
        ref={toile}
        className={cn('block', survole != null ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing')}
        onPointerDown={surAppui}
        onPointerMove={surDeplacement}
        onPointerUp={surRelache}
        onPointerCancel={surRelache}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse' && !pointeurs.current.size) montrerLaBulle(null);
        }}
        aria-label="Graphe de la mémoire"
        role="img"
      />
      <div
        ref={bulleRef}
        className={cn(
          'pointer-events-none absolute left-0 top-0 z-10 max-w-[270px] rounded-lg bg-surface px-2.5 py-1.5 text-[12.5px] leading-snug text-text shadow-lg',
          noeudSurvole ? 'opacity-100' : 'opacity-0',
        )}
        data-graphe-bulle
      >
        {noeudSurvole ? bulle(noeudSurvole) : null}
      </div>
      {minicarte ? (
        <canvas
          ref={mini}
          className="absolute bottom-[84px] z-10 cursor-crosshair rounded-xl bg-surface shadow-sm"
          style={{ right: minicarte.droite, width: MINI_LARGEUR, height: MINI_HAUTEUR }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            allerSurLaMinicarte(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) allerSurLaMinicarte(e);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label="Mini-carte du graphe"
          role="img"
          data-graphe-minicarte
        />
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* La page du graphe : recherche, focus, fiche de l'élément choisi    */
/* ------------------------------------------------------------------ */

/** Où mène « Ouvrir dans la liste ». */
export interface CibleDeLaListe {
  porteeId: string;
  ficheId?: string;
  theme?: string;
  uniteId?: string;
}

interface Resultat {
  demande: string;
  trouvees: string[];
  recues: string[];
}

/** La date d'un élément, dite en mots : une unité reprise d'un ancien rangement le dit. */
export function dateDeLElement(creeLe: number, reprise?: boolean): string {
  const date = new Date(creeLe).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return reprise ? t('Reprise le {date}', { date }) : t('Ajoutée le {date}', { date });
}

/** Le libellé de la catégorie et du thème d'un nœud : « Décisions · Publication ». */
function cheminLisible(arbre: ArbreDuGraphe, noeud: NoeudDuGraphe): string {
  const morceaux: string[] = [];
  for (const i of ancetresDuNoeud(arbre, arbre.index.get(noeud.id)!).reverse()) {
    const a = arbre.noeuds[i]!;
    if (a.genre === 'noyau' && noeud.branche !== PORTEE_GLOBALE) continue;
    morceaux.push(nomDuNoeud(a));
  }
  return morceaux.join(' · ');
}

function Pastille({ famille }: { famille: FamilleDuGraphe | null }) {
  const jeton = FAMILLES_DU_GRAPHE.find((f) => f.cle === famille)?.jeton;
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: jeton ? `hsl(var(${jeton}))` : 'hsl(var(--muted))' }}
      data-couleur-du-graphe
    />
  );
}

export function PageDuGraphe({
  focus,
  onFocus,
  telephone,
  onOuvrirDansLaListe,
}: {
  /** La portée mise en avant : « global », un projet, ou `null` pour la vue d'ensemble. */
  focus: string | null;
  onFocus: (portee: string | null) => void;
  telephone: boolean;
  onOuvrirDansLaListe: (cible: CibleDeLaListe) => void;
}) {
  const { donnees, arbre } = useGrapheDeLaMemoire(true);
  const toile = React.useRef<ToileDuGrapheRef>(null);
  const enTete = React.useRef<HTMLDivElement>(null);
  const [recherche, setRecherche] = React.useState('');
  const [resultat, setResultat] = React.useState<Resultat | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const [listeOuverte, setListeOuverte] = React.useState(!telephone);
  const [selection, setSelection] = React.useState<string | null>(null);
  const selectionRef = React.useRef(selection);
  selectionRef.current = selection;
  const [voisins, setVoisins] = React.useState<string[]>([]);
  const [detail, setDetail] = React.useState<{ id: string; unite: Unite } | null>(null);
  const [legende, setLegende] = React.useState(!telephone);
  const numero = React.useRef(0);
  /* LA PÉRIODE REGARDÉE (demande du 2026-10-20) : `null`, aujourd'hui. */
  const [periode, setPeriode] = React.useState<PeriodeDuGraphe | null>(null);
  const date = React.useMemo(() => (arbre ? niveauxALaDate(arbre, periode) : null), [arbre, periode]);
  const jours = React.useMemo(() => (donnees ? joursDeLaMemoire(donnees.elements) : []), [donnees]);
  const premierJour = jours.at(-1)?.jour ?? null;
  const visible = React.useCallback((i: number | null | undefined) => i != null && Boolean(date?.niveaux[i]), [date]);

  const indice = React.useCallback((id: string | null | undefined) => (id && arbre ? arbre.index.get(id) ?? null : null), [arbre]);
  const focusIndice = focus == null || !arbre ? null : focus === PORTEE_GLOBALE ? 0 : indice(idDeProjetDuGraphe(focus));

  /* LA RECHERCHE COMME L'AGENT : une phrase entière, après 350 ms de pause ; une
     réponse d'une demande déjà dépassée ne s'affiche jamais. */
  React.useEffect(() => {
    const demande = recherche.trim();
    const n = ++numero.current;
    if (!demande) {
      setResultat(null);
      setEnCours(false);
      return;
    }
    setEnCours(true);
    const minuteur = window.setTimeout(() => {
      client
        .call<{ trouvees: { id: string }[]; recues: string[] }>(
          { type: 'memoire.chercherCommeLAgent', recherche: demande, projectId: focus && focus !== PORTEE_GLOBALE ? focus : null },
          60_000,
        )
        .then((r) => {
          if (n !== numero.current) return;
          setResultat({ demande, trouvees: r.trouvees.map((x) => x.id), recues: r.recues });
        })
        .catch((err: any) => {
          if (n === numero.current) client.pushToast('error', err?.message ?? t('Recherche impossible'));
        })
        .finally(() => {
          if (n === numero.current) setEnCours(false);
        });
    }, 350);
    return () => window.clearTimeout(minuteur);
  }, [recherche, focus]);

  // La recherche reste celle de l'agent, mais n'allume que ce qui existait à la date regardée.
  const allumes = React.useMemo(() => {
    if (!resultat || !arbre) return null;
    return new Set(resultat.trouvees.map((id) => arbre.index.get(id)).filter((i): i is number => visible(i)));
  }, [resultat, arbre, visible]);
  const recus = React.useMemo(
    () => new Set((resultat?.recues ?? []).map((id) => arbre?.index.get(id)).filter((i): i is number => visible(i))),
    [resultat, arbre, visible],
  );

  // Un élément choisi qui n'existait pas à la date regardée : sa fiche se referme.
  React.useEffect(() => {
    if (selection && arbre && !visible(arbre.index.get(selection))) setSelection(null);
  }, [selection, arbre, visible]);

  // La vue se cadre sur ce que la recherche allume, une fois le panneau des résultats posé (il couvre le haut).
  React.useEffect(() => {
    if (!allumes?.size) return;
    const image = requestAnimationFrame(() => toile.current?.cadrer(allumes));
    return () => cancelAnimationFrame(image);
  }, [allumes]);

  // Choisir une portée glisse jusqu'à sa branche ; la vue d'ensemble recadre tout.
  React.useEffect(() => {
    if (!arbre || resultat) return;
    if (focusIndice == null) toile.current?.cadrer([0], true);
    else if (focusIndice === 0) {
      const duNoyau = arbre.noeuds[0]!.enfants.filter((i) => arbre.noeuds[i]!.branche === PORTEE_GLOBALE);
      toile.current?.cadrer([0, ...duNoyau], true);
    } else toile.current?.cadrer([focusIndice], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndice, arbre]);

  // L'élément choisi : sa fiche (résumé) et ses voisins par le sens.
  React.useEffect(() => {
    setVoisins([]);
    setDetail(null);
    const noeud = selection && arbre ? arbre.noeuds[arbre.index.get(selection) ?? -1] : null;
    if (!noeud || noeud.genre !== 'element') return;
    let vivant = true;
    client
      .call<{ unite: Unite }>({ type: 'memoire.unite', id: noeud.id })
      .then((r) => vivant && setDetail({ id: noeud.id, unite: r.unite }))
      .catch(() => undefined);
    client
      .call<{ voisins: { id: string }[]; modele: string | null }>({ type: 'memoire.voisins', id: noeud.id })
      .then((r) => vivant && setVoisins([...(r.modele ? [r.modele] : []), ...r.voisins.map((v) => v.id)]))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [selection, arbre]);

  const etat = React.useMemo<EtatDuGraphe>(
    () => ({
      focus: focusIndice,
      allumes,
      recus,
      selection: indice(selection),
      voisins: voisins.map((id) => indice(id)).filter((i): i is number => visible(i)),
    }),
    [focusIndice, allumes, recus, selection, voisins, indice, visible],
  );

  const choisir = (i: number | null) => {
    if (!arbre) return;
    if (i == null) return setSelection(null);
    const noeud = arbre.noeuds[i]!;
    if (noeud.genre === 'noyau') {
      setSelection(null);
      return onFocus(null);
    }
    if (noeud.genre === 'projet') {
      setSelection(null);
      return onFocus(noeud.branche);
    }
    setSelection(noeud.id);
    if (telephone) setListeOuverte(false);
    if (noeud.genre !== 'element') requestAnimationFrame(() => toile.current?.cadrer([i], true));
    // Sur téléphone la fiche monte du bas : l'élément choisi remonte au-dessus d'elle, après que la fiche est posée.
    else if (telephone) window.setTimeout(() => toile.current?.cadrer([i]), 60);
  };

  React.useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (selection) setSelection(null);
      else if (recherche) setRecherche('');
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [selection, recherche]);

  if (!arbre || !donnees || !date) return <SilhouetteDuGraphe />;

  const noeudChoisi = selection ? arbre.noeuds[arbre.index.get(selection) ?? -1] ?? null : null;
  const focusNom =
    focus == null ? t('Vue d’ensemble') : focus === PORTEE_GLOBALE ? t('Global') : donnees.portees.find((p) => p.id === focus)?.nom ?? focus;
  const recuesListe = (resultat?.recues ?? []).filter((id) => visible(arbre.index.get(id))).map((id) => arbre.noeuds[arbre.index.get(id)!]!);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg"
      data-memoire-page="graphe"
      data-graphe-focus={focus ?? ''}
      data-graphe-allumes={allumes ? allumes.size : ''}
      data-graphe-recus={resultat?.recues.join(',') ?? ''}
      data-graphe-selection={selection ?? ''}
      data-graphe-etat-recherche={enCours ? 'en-cours' : resultat ? 'faite' : 'aucune'}
      data-graphe-periode={periode ? `${jourDuGraphe(periode.debut)},${jourDuGraphe(periode.fin)}` : ''}
    >
      <ToileDuGraphe
        ref={toile}
        arbre={arbre}
        etat={etat}
        niveaux={date.niveaux}
        visibles={date.visibles}
        onChoisir={choisir}
        couvert={() => ({
          haut: enTete.current ? enTete.current.getBoundingClientRect().height + 8 : 0,
          droite: !telephone && selectionRef.current ? 384 : 0,
          bas: telephone && selectionRef.current ? (document.querySelector('[data-graphe-fiche]')?.getBoundingClientRect().height ?? 0) + 16 : 0,
        })}
        minicarte={telephone ? null : { droite: noeudChoisi ? 384 : 12 }}
        bulle={(noeud) =>
          noeud.genre === 'element' ? (
            <>
              <span className="font-medium">{noeud.libelle}</span> <span className="whitespace-nowrap font-mono text-[11.5px] text-faint">({noeud.id})</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                <Pastille famille={noeud.famille} />
                {cheminLisible(arbre, noeud)}
              </span>
            </>
          ) : (
            <>
              <span className="font-medium">{nomDuNoeud(noeud)}</span>
              <span className="block text-[11.5px] text-muted">{t('{n} élément(s)', { n: date.comptes[arbre.index.get(noeud.id)!] ?? noeud.poids })}</span>
            </>
          )
        }
      />

      {/* LA RECHERCHE EN TÊTE : une phrase, comme l'agent la poserait. */}
      <div
        ref={enTete}
        className={cn('pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center gap-2 px-3 pt-3', !telephone && selection && 'pr-[384px]')}
      >
        <div className="pointer-events-auto flex w-full max-w-[600px] items-center gap-1.5">
          {telephone ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="subtle" size="sm" className="h-10 max-w-[38%] shrink-0 gap-1 rounded-xl px-2.5" data-graphe-choix-focus title={t('Choisir un projet')}>
                  <Layers className="h-4 w-4 shrink-0" />
                  <span className="truncate">{focusNom}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
                <DropdownMenuItem onSelect={() => onFocus(null)} data-graphe-focus-choix="" data-choisi={focus == null ? 'oui' : undefined}>
                  {t('Vue d’ensemble')}
                </DropdownMenuItem>
                {donnees.portees.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => onFocus(p.id)} data-graphe-focus-choix={p.id} data-choisi={focus === p.id ? 'oui' : undefined}>
                    {p.id === PORTEE_GLOBALE ? t('Global') : p.nom}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <div className="relative min-w-0 flex-1">
            {enCours ? (
              <Loader2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-faint" data-graphe-recherche-en-cours />
            ) : (
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            )}
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={telephone ? t('Chercher comme un agent…') : t('Chercher comme un agent : « déployer une application sur l’App Store »')}
              className="h-10 w-full rounded-xl bg-surface pl-10 pr-10 text-[14px] text-text shadow-sm outline-none placeholder:text-faint focus-visible:ring-1 focus-visible:ring-faint"
              autoComplete="off"
              spellCheck={false}
              data-graphe-recherche
            />
            {recherche ? (
              <button
                type="button"
                onClick={() => setRecherche('')}
                aria-label="Effacer la recherche"
                title={t('Effacer la recherche')}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-faint hover:bg-raised hover:text-muted"
                data-graphe-recherche-effacer
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {premierJour ? (
            <TempsDuGraphe
              periode={periode}
              jours={jours}
              premierJour={premierJour}
              telephone={telephone}
              onPeriode={setPeriode}
            />
          ) : null}
        </div>
        {resultat ? (
          <div className="pointer-events-auto w-full max-w-[600px] rounded-xl bg-surface px-1.5 py-1.5 shadow-sm" data-graphe-resultats>
            <button
              type="button"
              onClick={() => setListeOuverte((v) => !v)}
              aria-expanded={listeOuverte}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12.5px] text-muted hover:bg-raised"
              data-graphe-resultats-bascule
            >
              <span className="min-w-0 flex-1 truncate">
                {resultat.trouvees.length
                  ? t('{n} élément(s) allumé(s) · {r} que l’agent recevrait', { n: allumes?.size ?? 0, r: recuesListe.length })
                  : t('Rien de trouvé pour cette phrase.')}
              </span>
              {recuesListe.length ? <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', listeOuverte && 'rotate-180')} /> : null}
            </button>
            {listeOuverte && recuesListe.length ? (
              <div className="mt-0.5 flex flex-col" data-graphe-recues>
                {recuesListe.map((noeud) => (
                  <button
                    key={noeud.id}
                    type="button"
                    onClick={() => {
                      setSelection(noeud.id);
                      // Sur téléphone, la fiche prend le bas de l'écran : la liste se replie pour laisser voir le graphe.
                      if (telephone) setListeOuverte(false);
                      // Après le rendu : la fiche ouverte (à droite, en bas sur téléphone) compte dans le cadrage.
                      window.setTimeout(() => toile.current?.cadrer([arbre.index.get(noeud.id)!]), 60);
                    }}
                    className={cn('flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-raised', selection === noeud.id && 'bg-raised')}
                    data-graphe-recue={noeud.id}
                  >
                    <Pastille famille={noeud.famille} />
                    <span className="min-w-0 flex-1 truncate text-text">
                      {noeud.libelle} <span className="font-mono text-[11.5px] text-faint">({noeud.id})</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* LA FICHE DE L'ÉLÉMENT CHOISI, posée sur le graphe — jamais un tiroir. */}
      {noeudChoisi ? (
        <FicheFlottante
          arbre={arbre}
          noeud={noeudChoisi}
          unite={detail?.id === noeudChoisi.id ? detail.unite : null}
          voisins={voisins.filter((id) => visible(arbre.index.get(id)))}
          compte={date.comptes[arbre.index.get(noeudChoisi.id)!] ?? noeudChoisi.poids}
          telephone={telephone}
          onFermer={() => setSelection(null)}
          onChoisir={(id) => {
            setSelection(id);
            const i = arbre.index.get(id);
            if (i != null) requestAnimationFrame(() => toile.current?.cadrer([i, arbre.index.get(noeudChoisi.id)!]));
          }}
          onOuvrir={() =>
            onOuvrirDansLaListe({
              porteeId: noeudChoisi.branche,
              ficheId: noeudChoisi.fiche,
              theme: noeudChoisi.genre === 'element' || noeudChoisi.genre === 'theme' ? noeudChoisi.theme : undefined,
              uniteId: noeudChoisi.genre === 'element' ? noeudChoisi.id : undefined,
            })
          }
        />
      ) : null}

      {/* EN BAS À GAUCHE : la légende, discrète, puis les gestes de zoom — le coin droit
          appartient au bouton de l'assistant. */}
      <div className={cn('absolute bottom-3 left-3 z-10 flex flex-col items-start gap-1.5', telephone && noeudChoisi && 'hidden')} data-graphe-legende>
        {legende ? (
          <ul className="flex flex-col gap-1 rounded-xl bg-surface px-3 py-2 text-[11.5px] text-muted">
            {FAMILLES_DU_GRAPHE.map((f) => (
              <li key={f.cle} className="flex items-center gap-2">
                <Pastille famille={f.cle} />
                {t(f.libelle)}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-1">
          <Button variant="subtle" size="icon" className="h-8 w-8 rounded-lg" onClick={() => toile.current?.zoomer(1.6)} aria-label="Zoomer" title={t('Zoomer')} data-graphe-zoomer>
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="subtle" size="icon" className="h-8 w-8 rounded-lg" onClick={() => toile.current?.zoomer(1 / 1.6)} aria-label="Dézoomer" title={t('Dézoomer')}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="subtle"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => {
              if (allumes?.size) toile.current?.cadrer(allumes);
              else if (focusIndice != null && focusIndice > 0) toile.current?.cadrer([focusIndice], true);
              else toile.current?.cadrer([0], true);
            }}
            aria-label="Recentrer"
            title={t('Recentrer')}
            data-graphe-recentrer
          >
            <Crosshair className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={() => setLegende((v) => !v)}
            className="ml-1 rounded-lg px-2 py-1.5 text-[11.5px] text-faint hover:bg-raised hover:text-muted"
            aria-expanded={legende}
            data-graphe-legende-bascule
          >
            {legende ? t('Masquer les couleurs') : t('Couleurs')}
          </button>
        </div>
      </div>
      {/* Le nom du focus, pour qui lit l'écran sans voir le canevas. */}
      <p className="sr-only" aria-live="polite">
        {focusNom}
      </p>
    </div>
  );
}

function FicheFlottante({
  arbre,
  noeud,
  unite,
  voisins,
  compte,
  telephone,
  onFermer,
  onChoisir,
  onOuvrir,
}: {
  arbre: ArbreDuGraphe;
  noeud: NoeudDuGraphe;
  unite: Unite | null;
  voisins: string[];
  /** Combien d'éléments se voient sous ce nœud, à la date regardée. */
  compte: number;
  telephone: boolean;
  onFermer: () => void;
  onChoisir: (id: string) => void;
  onOuvrir: () => void;
}) {
  const element = noeud.element;
  const proches = voisins.map((id) => arbre.noeuds[arbre.index.get(id) ?? -1]).filter((n): n is NoeudDuGraphe => Boolean(n));
  return (
    <aside
      className={cn(
        'absolute z-30 flex max-h-[calc(100%-1.5rem)] flex-col gap-2.5 overflow-y-auto rounded-2xl bg-surface p-4 shadow-xl',
        telephone ? 'inset-x-3 bottom-3 max-h-[55%]' : 'right-3 top-3 w-[360px]',
      )}
      data-graphe-fiche={noeud.id}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-muted">
          <Pastille famille={noeud.famille} />
          <span className="truncate">{cheminLisible(arbre, noeud) || t('Global')}</span>
        </span>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer"
          title={t('Fermer')}
          className="-mr-1.5 -mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-raised hover:text-muted"
          data-graphe-fiche-fermer
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <h3 className="break-words text-[15.5px] font-semibold leading-snug text-text">
        {element ? (unite ? titreAffiche(unite) : noeud.libelle) : nomDuNoeud(noeud)}
        {element ? (
          <>
            {' '}
            <span className="whitespace-nowrap font-mono text-[12px] font-normal text-faint">({noeud.id})</span>
          </>
        ) : null}
      </h3>
      {element ? (
        <>
          <p className="text-[12px] text-faint" data-graphe-fiche-date>
            {dateDeLElement(element.creeLe, element.reprise)}
            {element.retireLe != null ? (
              <>
                {' · '}
                <span className="text-muted" data-graphe-fiche-retiree>
                  {t('Retirée le {date}', { date: new Date(element.retireLe).toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short', year: 'numeric' }) })}
                </span>
              </>
            ) : null}
          </p>
          {unite ? (
            <p className="line-clamp-6 text-[13.5px] leading-relaxed text-muted" data-graphe-fiche-resume>
              {unite.resume}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="h-3 w-full animate-silhouette rounded bg-raised" />
              <div className="h-3 w-4/5 animate-silhouette rounded bg-raised" />
            </div>
          )}
          {proches.length ? (
            <div className="flex flex-col gap-0.5" data-graphe-voisins>
              <span className="px-0.5 text-[11.5px] text-faint">{t('Proches par le sens')}</span>
              {proches.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onChoisir(v.id)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12.5px] hover:bg-raised"
                  data-graphe-voisin={v.id}
                >
                  <Pastille famille={v.famille} />
                  <span className="min-w-0 flex-1 truncate text-text">{v.libelle}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-[13px] text-muted">{t('{n} élément(s)', { n: compte })}</p>
      )}
      <Button variant="subtle" size="sm" className="self-start" onClick={onOuvrir} data-graphe-ouvrir-liste>
        <List className="h-3.5 w-3.5" />
        {t('Ouvrir dans la liste')}
      </Button>
    </aside>
  );
}

/**
 * REMONTER LE TEMPS (demande du 2026-10-20) : le bouton calendrier, à côté de
 * la recherche. Il ouvre deux façons de choisir — la liste de TOUS LES JOURS,
 * du plus récent au premier jour de la mémoire, chacun avec ses ajouts et ses
 * retraits (choisir un jour montre la mémoire à la fin de ce jour), ou une
 * PÉRIODE sur les deux calendriers communs (`DeuxCalendriers`). Sur téléphone
 * le menu se pose en tiroir au bas de l'écran, comme tous les menus. La période
 * retenue se lit sur le bouton, et la croix revient à aujourd'hui.
 *
 * Repères : `data-graphe-temps` (le bouton, « aujourdhui » | « passe »),
 * `data-graphe-temps-menu`, `data-graphe-temps-onglet="jours|periode"`,
 * `data-graphe-jour="AAAA-MM-JJ"`, `data-graphe-temps-aujourdhui`.
 */
function TempsDuGraphe({
  periode,
  jours,
  premierJour,
  telephone,
  onPeriode,
}: {
  periode: PeriodeDuGraphe | null;
  jours: readonly JourDeLaMemoire[];
  /** Le jour du plus ancien élément, « AAAA-MM-JJ ». */
  premierJour: string;
  telephone: boolean;
  onPeriode: (periode: PeriodeDuGraphe | null) => void;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const [onglet, setOnglet] = React.useState<'jours' | 'periode'>('jours');
  const [combien, setCombien] = React.useState(90);
  const liste = React.useRef<HTMLDivElement>(null);
  const debutDeLaMemoire = periodeDuJour(premierJour).debut;
  const aujourdhui = jours[0]?.jour ?? jourDuGraphe(Date.now());
  const depuisLeDebut = !periode || periode.debut <= debutDeLaMemoire;
  const jourChoisi = periode && depuisLeDebut ? jourDuGraphe(periode.fin) : null;
  const format = formatRegional();
  const court = (at: number) => new Date(at).toLocaleDateString(format, { day: 'numeric', month: 'short' });
  const libelle = !periode ? null : depuisLeDebut ? t('Au {date}', { date: court(periode.fin) }) : libelleDePlage(periode.debut, periode.fin);

  const choisirLeJour = (jour: string) => {
    onPeriode(jour >= aujourdhui ? null : { debut: debutDeLaMemoire, fin: periodeDuJour(jour).fin });
    setOuvert(false);
  };

  // À l'ouverture, le jour retenu (ou aujourd'hui) prend le focus : les flèches partent de lui.
  const focaliserLeJour = (e: Event) => {
    const zone = (e.currentTarget as HTMLElement | null) ?? liste.current;
    const cible = zone?.querySelector<HTMLElement>(`[data-graphe-jour="${jourChoisi ?? aujourdhui}"]`) ?? zone?.querySelector<HTMLElement>('[data-graphe-jour]');
    if (!cible) return;
    e.preventDefault();
    cible.focus({ preventScroll: true });
    cible.scrollIntoView({ block: 'nearest' });
  };

  const surTouche = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const boutons = [...(liste.current?.querySelectorAll<HTMLElement>('[data-graphe-jour]') ?? [])];
    const ici = boutons.indexOf(document.activeElement as HTMLElement);
    const suivant = boutons[clamp(ici + (e.key === 'ArrowDown' ? 1 : -1), 0, boutons.length - 1)];
    if (!suivant) return;
    e.preventDefault();
    suivant.focus();
    suivant.scrollIntoView({ block: 'nearest' });
    if (e.key === 'ArrowDown' && boutons.indexOf(suivant) > combien - 10) setCombien((n) => n + 90);
  };

  const ongletClasse = (actif: boolean) =>
    cn('h-7 flex-1 rounded-[6px] px-3 text-[12.5px] transition-colors', actif ? 'bg-raised text-teinte shadow-sm' : 'text-muted hover:text-text');

  return (
    <div className="flex shrink-0 items-center gap-1" data-graphe-temps={periode ? 'passe' : 'aujourdhui'}>
      <PopoverPrimitive.Root open={ouvert} onOpenChange={setOuvert}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-10 items-center gap-1.5 rounded-xl bg-surface px-3 text-[13px] shadow-sm transition-colors hover:bg-raised',
              periode ? 'text-teinte' : 'text-muted hover:text-text',
              telephone && !periode && 'w-10 justify-center px-0',
            )}
            aria-label="Remonter le temps"
            title={t('Remonter le temps')}
            data-graphe-temps-bouton
          >
            <CalendarClock className="h-4 w-4 shrink-0" />
            {libelle ? <span className={cn('truncate tabular-nums', telephone ? 'max-w-[5.5rem]' : 'max-w-[10rem]')}>{libelle}</span> : null}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 flex w-[420px] flex-col gap-2 rounded-lg bg-raised p-2.5 shadow-xl animate-fade-in max-sm:!w-full max-sm:!max-w-none max-sm:rounded-b-none max-sm:px-4 max-sm:pb-6 max-sm:pt-3"
            onOpenAutoFocus={focaliserLeJour}
            data-graphe-temps-menu
          >
            <div className="flex items-center gap-0.5 rounded-lg bg-bloc p-0.5" role="tablist">
              <button type="button" role="tab" aria-selected={onglet === 'jours'} className={ongletClasse(onglet === 'jours')} onClick={() => setOnglet('jours')} data-graphe-temps-onglet="jours">
                {t('Jours')}
              </button>
              <button type="button" role="tab" aria-selected={onglet === 'periode'} className={ongletClasse(onglet === 'periode')} onClick={() => setOnglet('periode')} data-graphe-temps-onglet="periode">
                {t('Période')}
              </button>
            </div>
            {onglet === 'jours' ? (
              <ZoneDefilement
                ref={liste}
                fond="hsl(var(--raised))"
                className="max-h-[min(360px,50vh)]"
                onKeyDown={surTouche}
                onScroll={(e) => {
                  const z = e.currentTarget;
                  if (z.scrollTop + z.clientHeight > z.scrollHeight - 200 && combien < jours.length) setCombien((n) => n + 90);
                }}
                data-graphe-jours={jours.length}
              >
                <div className="flex flex-col py-0.5">
                  {jours.slice(0, combien).map((j, rang) => {
                    const at = periodeDuJour(j.jour).debut;
                    const actif = jourChoisi ? j.jour === jourChoisi : rang === 0 && !periode;
                    return (
                      <button
                        key={j.jour}
                        type="button"
                        onClick={() => choisirLeJour(j.jour)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-bloc focus-visible:bg-bloc',
                          actif ? 'text-teinte' : 'text-text',
                        )}
                        aria-current={actif ? 'true' : undefined}
                        title={t('{a} ajout(s), {r} retrait(s)', { a: j.ajouts, r: j.retraits })}
                        data-graphe-jour={j.jour}
                      >
                        <span className="min-w-0 flex-1 truncate first-letter:uppercase">
                          {rang === 0 ? t('Aujourd’hui') : new Date(at).toLocaleDateString(format, { weekday: 'short', day: 'numeric', month: 'long' })}
                          {rang === jours.length - 1 ? <span className="ml-2 text-[11.5px] text-faint">{t('Premier jour de la mémoire')}</span> : null}
                        </span>
                        <span className={cn('w-12 text-right font-mono text-[11.5px] tabular-nums', j.ajouts ? 'text-muted' : 'text-faint/60')} data-graphe-jour-ajouts={j.ajouts}>
                          +{j.ajouts}
                        </span>
                        <span className={cn('w-10 text-right font-mono text-[11.5px] tabular-nums', j.retraits ? 'text-muted' : 'text-faint/60')} data-graphe-jour-retraits={j.retraits}>
                          −{j.retraits}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ZoneDefilement>
            ) : (
              <DeuxCalendriers
                debut={periode?.debut ?? debutDeLaMemoire}
                fin={periode?.fin ?? Date.now()}
                min={debutDeLaMemoire}
                onChoisi={(d, f) => {
                  const fin = periodeDuJour(jourDuGraphe(f)).fin;
                  onPeriode(d <= debutDeLaMemoire && jourDuGraphe(f) >= aujourdhui ? null : { debut: d, fin });
                  setOuvert(false);
                }}
              />
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {periode ? (
        <button
          type="button"
          onClick={() => onPeriode(null)}
          aria-label="Revenir à aujourd’hui"
          title={t('Revenir à aujourd’hui')}
          className="flex h-10 w-8 shrink-0 items-center justify-center rounded-xl text-faint hover:bg-raised hover:text-muted"
          data-graphe-temps-aujourdhui
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Pendant le chargement : quelques ronds pâles en étoile, la place exacte du graphe à venir. */
function SilhouetteDuGraphe() {
  const branches = Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2);
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-bg" data-memoire-page="graphe" data-memoire-graphe="chargement">
      <div className="absolute inset-x-0 top-3 flex justify-center px-3">
        <div className="h-10 w-full max-w-[600px] animate-silhouette rounded-xl bg-surface" />
      </div>
      <div className="relative h-[320px] w-[320px]">
        <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-silhouette rounded-full bg-raised" />
        {branches.map((angle, i) => (
          <div
            key={i}
            className="absolute h-10 w-10 animate-silhouette rounded-full bg-raised"
            style={{ left: `${50 + Math.cos(angle) * 38}%`, top: `${50 + Math.sin(angle) * 38}%`, transform: 'translate(-50%, -50%)', opacity: 0.4 + (i % 3) * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}
