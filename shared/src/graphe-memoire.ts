import {
  PORTEE_GLOBALE,
  estUniteDeCompetence,
  ficheDeLUnite,
  fichesDeLaPortee,
  sujetDeProjetDeCompetence,
  type Importance,
  type Unite,
} from './connaissances.js';
import { LIBELLE_THEME_AUTRES, MIN_UNITES_D_UN_THEME, THEME_AUTRES, libelleDuTheme, themeDeLUnite, uniteReprise } from './themes-de-memoire.js';
import { titreAffiche } from './titres-humains.js';

/**
 * LE GRAPHE DE LA MÉMOIRE — l'écran Mémoire s'ouvre sur toute la base de
 * connaissances dessinée en BRANCHES (décision de l'utilisateur, 2026-10-20) :
 *
 *   noyau (le Global) → projet → catégorie → thème → élément
 *
 * Les catégories du Global pendent directement au noyau. Aucune unité ne porte
 * de lien explicite (la colonne `liens` est vide partout) : les branches
 * viennent donc du RANGEMENT existant — la fiche numérotée de l'unité (sa
 * catégorie) et son thème (`themeDeLUnite`, même seuil que la liste). Les fils
 * de sens entre éléments se calculent à la sélection, côté démon.
 *
 * UNE COMPÉTENCE vit dans le Global, mais celle dont la fiche nomme un projet
 * (sujet `projet-<nom>`) pend à la catégorie « Compétences » de CE projet ; une
 * compétence commune pend à celle du noyau.
 *
 * LA MISE EN PLACE est un ARBRE EN BALLONS, calculé ici sans aucune
 * bibliothèque : chaque sous-branche occupe un disque, les disques frères se
 * rangent en éventail autour de leur parent sans jamais se chevaucher, les
 * éléments d'un thème se posent en tournesol autour de lui. Elle est
 * DÉTERMINISTE (mêmes données → mêmes positions, donc rien ne saute d'une
 * ouverture à l'autre) et linéaire : quelques millisecondes pour 6 000
 * éléments, sans fil de calcul à part ni cache.
 *
 * Rien ici ne touche à la base ni au disque.
 */

/* ------------------------------------------------------------------ */
/* Les familles de couleur                                            */
/* ------------------------------------------------------------------ */

/**
 * SIX FAMILLES DE CATÉGORIES, PLUS LES COMPÉTENCES. Exception VOULUE à la règle
 * « une seule couleur, le violet » (décision du 2026-10-20), limitée au graphe :
 * des teintes douces et désaturées, une par famille, et un violet doux pour les
 * compétences. Les jetons `--graphe-*` vivent dans les deux palettes de
 * `web/src/styles.css` (`--competence`, plus ancien, y est un gris remappé).
 */
export const FAMILLES_DU_GRAPHE = [
  { cle: 'fondations', jeton: '--graphe-1', libelle: 'Projet et besoins' },
  { cle: 'architecture', jeton: '--graphe-2', libelle: 'Architecture' },
  { cle: 'conventions', jeton: '--graphe-3', libelle: 'Conventions' },
  { cle: 'decisions', jeton: '--graphe-4', libelle: 'Décisions' },
  { cle: 'exploitation', jeton: '--graphe-5', libelle: 'Exploitation et sécurité' },
  { cle: 'lecons', jeton: '--graphe-6', libelle: 'Problèmes et leçons' },
  { cle: 'competences', jeton: '--graphe-competence', libelle: 'Compétences' },
] as const;

export type FamilleDuGraphe = (typeof FAMILLES_DU_GRAPHE)[number]['cle'];

const FAMILLE_DES_FICHES_DE_PROJET: Readonly<Record<string, FamilleDuGraphe>> = {
  '00_project': 'fondations',
  '01_requirements': 'fondations',
  '02_architecture': 'architecture',
  '03_domain': 'fondations',
  '04_conventions': 'conventions',
  '05_decisions': 'decisions',
  '06_components': 'architecture',
  '07_integrations': 'architecture',
  '08_constraints': 'exploitation',
  '09_environment': 'architecture',
  '10_operations': 'exploitation',
  '11_issues': 'lecons',
  '12_lessons': 'lecons',
  '13_skills': 'competences',
};

const FAMILLE_DES_FICHES_GLOBALES: Readonly<Record<string, FamilleDuGraphe>> = {
  '00_principles': 'fondations',
  '01_conventions': 'conventions',
  '02_architecture': 'architecture',
  '03_decisions': 'decisions',
  '04_integrations': 'architecture',
  '05_operations': 'exploitation',
  '06_lessons': 'lecons',
  '07_skills': 'competences',
};

/** La famille de couleur d'une catégorie (fiche numérotée) dans sa portée. */
export function familleDeLaFiche(portee: string, ficheId: string): FamilleDuGraphe {
  const table = portee === PORTEE_GLOBALE ? FAMILLE_DES_FICHES_GLOBALES : FAMILLE_DES_FICHES_DE_PROJET;
  return table[ficheId] ?? 'fondations';
}

/* ------------------------------------------------------------------ */
/* Les éléments, tels que le démon les envoie                         */
/* ------------------------------------------------------------------ */

/** Au-delà, le titre d'un élément est coupé : le détail se lit dans sa fiche. */
export const TITRE_DU_GRAPHE_MAX = 140;

/** Un élément du graphe : une unité active (ou retirée depuis), réduite à ce qu'il faut pour la placer, la colorer et la nommer. */
export interface ElementDuGraphe {
  id: string;
  /** La branche où il pend : « global » ou l'identifiant d'un projet. Une compétence propre à un projet pend à ce projet. */
  branche: string;
  /** Sa catégorie : la fiche numérotée de la branche. */
  fiche: string;
  /** Son thème canonique (avant le regroupement des thèmes maigres). */
  theme: string;
  /** Le titre clair d'abord, sinon le titre des agents. */
  titre: string;
  importance: Importance;
  creeLe: number;
  /** Reprise d'un ancien rangement : sa date est celle de la reprise. */
  reprise?: boolean;
  competence?: boolean;
  /** Retirée de la mémoire (dépréciée, fusionnée, remplacée) à cette date : elle ne se montre qu'aux dates d'avant. */
  retireLe?: number;
}

type UniteDuGraphe = Pick<Unite, 'id' | 'portee' | 'type' | 'source' | 'sujets' | 'titre' | 'titreHumain' | 'importance' | 'creeLe'> & { retireLe?: number };

/**
 * Les éléments du graphe : chaque unité ACTIVE — et chaque unité retirée
 * depuis, avec sa date de retrait —, rattachée à sa branche. Une
 * compétence dont la fiche nomme un projet connu pend à ce projet (le premier
 * nommé) ; nommant un projet archivé ou inconnu, elle reste au noyau.
 */
export function elementsDuGraphe(unites: readonly UniteDuGraphe[], projets: readonly { id: string; name: string }[]): ElementDuGraphe[] {
  const projetDuSujet = new Map(projets.map((p) => [sujetDeProjetDeCompetence(p.name), p.id]));
  return unites.map((u) => {
    const competence = estUniteDeCompetence(u);
    let branche = u.portee;
    let fiche = ficheDeLUnite(u).id;
    if (competence) {
      const projet = u.sujets.map((s) => projetDuSujet.get(s)).find(Boolean);
      if (projet) {
        branche = projet;
        fiche = fichesDeLaPortee(projet).find((f) => f.competences)!.id;
      }
    }
    const titre = titreAffiche(u);
    return {
      id: u.id,
      branche,
      fiche,
      theme: themeDeLUnite(u),
      titre: titre.length > TITRE_DU_GRAPHE_MAX ? `${titre.slice(0, TITRE_DU_GRAPHE_MAX - 1).trimEnd()}…` : titre,
      importance: u.importance,
      creeLe: u.creeLe,
      ...(uniteReprise(u) ? { reprise: true } : {}),
      ...(competence ? { competence: true } : {}),
      ...(u.retireLe != null ? { retireLe: u.retireLe } : {}),
    };
  });
}

/* ------------------------------------------------------------------ */
/* L'arbre                                                            */
/* ------------------------------------------------------------------ */

export type GenreDeNoeud = 'noyau' | 'projet' | 'categorie' | 'theme' | 'element';

export interface NoeudDuGraphe {
  /** « noyau », « p:<projet> », « c:<branche>:<fiche> », « t:<branche>:<fiche>:<thème> », ou l'identifiant de l'unité. */
  id: string;
  genre: GenreDeNoeud;
  /** L'indice du parent dans `noeuds`, -1 pour le noyau. Un parent précède toujours ses enfants. */
  parent: number;
  enfants: number[];
  libelle: string;
  /** La famille de couleur ; aucune pour le noyau et les projets, qui restent neutres. */
  famille: FamilleDuGraphe | null;
  /** La portée de la branche : « global » pour le noyau et ses catégories, sinon le projet. */
  branche: string;
  fiche?: string;
  theme?: string;
  element?: ElementDuGraphe;
  /** Combien d'éléments pendent sous ce nœud (1 pour un élément). */
  poids: number;
  /* La mise en place, posée par `disposerLArbre`. */
  x: number;
  y: number;
  /** Le rayon du point lui-même. */
  r: number;
  /** Le rayon du disque qu'occupe toute la sous-branche, autour du point. */
  etendue: number;
  /** Le cadre de toute la sous-branche : de quoi y cadrer la vue. */
  cadre: { x0: number; y0: number; x1: number; y1: number };
}

export interface ArbreDuGraphe {
  noeuds: NoeudDuGraphe[];
  /** L'indice d'un nœud par son identifiant. */
  index: Map<string, number>;
}

export const ID_DU_NOYAU = 'noyau';
export const idDeProjetDuGraphe = (projet: string) => `p:${projet}`;
export const idDeCategorieDuGraphe = (branche: string, fiche: string) => `c:${branche}:${fiche}`;
export const idDeThemeDuGraphe = (branche: string, fiche: string, theme: string) => `t:${branche}:${fiche}:${theme}`;

const ORDRE_IMPORTANCE: Record<Importance, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * L'ARBRE DE LA MÉMOIRE. `portees` : le Global en tête puis les projets non
 * archivés (`listerLesPortees`), dans l'ordre de la colonne. Un élément dont la
 * branche n'est pas une portée connue (projet archivé) n'est pas dessiné. Les
 * thèmes trop maigres d'une catégorie se réunissent dans « Autres sujets »,
 * comme dans la liste.
 */
export function construireLArbre(
  elements: readonly ElementDuGraphe[],
  portees: readonly { id: string; nom: string }[],
  minimum = MIN_UNITES_D_UN_THEME,
): ArbreDuGraphe {
  const noeuds: NoeudDuGraphe[] = [];
  const index = new Map<string, number>();
  const poser = (n: Omit<NoeudDuGraphe, 'enfants' | 'poids' | 'x' | 'y' | 'r' | 'etendue' | 'cadre'>): number => {
    const i = noeuds.length;
    noeuds.push({ ...n, enfants: [], poids: 0, x: 0, y: 0, r: 0, etendue: 0, cadre: { x0: 0, y0: 0, x1: 0, y1: 0 } });
    index.set(n.id, i);
    if (n.parent >= 0) noeuds[n.parent]!.enfants.push(i);
    return i;
  };

  const parBranche = new Map<string, Map<string, ElementDuGraphe[]>>();
  for (const e of elements) {
    const fiches = parBranche.get(e.branche) ?? new Map<string, ElementDuGraphe[]>();
    fiches.set(e.fiche, [...(fiches.get(e.fiche) ?? []), e]);
    parBranche.set(e.branche, fiches);
  }

  const global = portees.find((p) => p.id === PORTEE_GLOBALE);
  const noyau = poser({ id: ID_DU_NOYAU, genre: 'noyau', parent: -1, libelle: global?.nom ?? 'Global', famille: null, branche: PORTEE_GLOBALE });

  const poserLesCategories = (branche: string, parent: number) => {
    const fiches = parBranche.get(branche);
    if (!fiches) return;
    for (const fiche of fichesDeLaPortee(branche)) {
      const deLaFiche = fiches.get(fiche.id);
      if (!deLaFiche?.length) continue;
      const famille = familleDeLaFiche(branche, fiche.id);
      const categorie = poser({ id: idDeCategorieDuGraphe(branche, fiche.id), genre: 'categorie', parent, libelle: fiche.titre, famille, branche, fiche: fiche.id });
      const parTheme = new Map<string, ElementDuGraphe[]>();
      for (const e of deLaFiche) parTheme.set(e.theme, [...(parTheme.get(e.theme) ?? []), e]);
      const autres: ElementDuGraphe[] = [];
      const themes: [string, string, ElementDuGraphe[]][] = [];
      for (const [theme, liste] of parTheme) {
        if (liste.length < minimum && parTheme.size > 1) autres.push(...liste);
        else themes.push([theme, libelleDuTheme(theme), liste]);
      }
      themes.sort((a, b) => b[2].length - a[2].length || a[1].localeCompare(b[1]));
      if (autres.length) themes.push([THEME_AUTRES, LIBELLE_THEME_AUTRES, autres]);
      for (const [theme, libelle, liste] of themes) {
        const t = poser({ id: idDeThemeDuGraphe(branche, fiche.id, theme), genre: 'theme', parent: categorie, libelle, famille, branche, fiche: fiche.id, theme });
        // Au cœur du tournesol, les vitales, puis les plus récentes.
        const rangees = [...liste].sort((a, b) => ORDRE_IMPORTANCE[a.importance] - ORDRE_IMPORTANCE[b.importance] || b.creeLe - a.creeLe || a.id.localeCompare(b.id));
        for (const e of rangees) {
          poser({ id: e.id, genre: 'element', parent: t, libelle: e.titre, famille: e.competence ? 'competences' : famille, branche, fiche: fiche.id, theme, element: e });
        }
      }
    }
  };

  poserLesCategories(PORTEE_GLOBALE, noyau);
  for (const p of portees) {
    if (p.id === PORTEE_GLOBALE) continue;
    const projet = poser({ id: idDeProjetDuGraphe(p.id), genre: 'projet', parent: noyau, libelle: p.nom, famille: null, branche: p.id });
    poserLesCategories(p.id, projet);
  }

  // Les poids remontent : un parent précède toujours ses enfants, on remonte donc à rebours.
  for (let i = noeuds.length - 1; i >= 0; i -= 1) {
    const n = noeuds[i]!;
    if (n.genre === 'element') n.poids = 1;
    if (n.parent >= 0) noeuds[n.parent]!.poids += n.poids;
  }
  return { noeuds, index };
}

/** Les ancêtres d'un nœud, du parent au noyau. */
export function ancetresDuNoeud(arbre: ArbreDuGraphe, i: number): number[] {
  const chemin: number[] = [];
  for (let p = arbre.noeuds[i]?.parent ?? -1; p >= 0; p = arbre.noeuds[p]!.parent) chemin.push(p);
  return chemin;
}

/** Le nœud est-il dans la sous-branche de `racine` (lui compris) ? */
export function dansLaBranche(arbre: ArbreDuGraphe, i: number, racine: number): boolean {
  for (let p = i; p >= 0; p = arbre.noeuds[p]!.parent) if (p === racine) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* La mise en place : un arbre en ballons                             */
/* ------------------------------------------------------------------ */

/** Le rayon propre de chaque genre de point, en unités du monde. */
export const RAYON_DU_POINT: Readonly<Record<GenreDeNoeud, number>> = { noyau: 13, projet: 8, categorie: 5, theme: 3, element: 1.4 };
/** L'écart entre deux disques frères, selon le genre des frères. */
const ECART_ENTRE_FRERES: Readonly<Record<GenreDeNoeud, number>> = { noyau: 0, projet: 40, categorie: 16, theme: 6, element: 0 };
/** La distance minimale d'un enfant à son parent, selon le genre de l'enfant. */
const DISTANCE_MIN: Readonly<Record<GenreDeNoeud, number>> = { noyau: 0, projet: 140, categorie: 46, theme: 22, element: 0 };
/** Le pas du tournesol : la distance entre deux éléments d'un même thème. */
const PAS_DU_TOURNESOL = 3.4;
/** L'angle d'or : le tournesol ne fait jamais de rayons. */
const ANGLE_D_OR = Math.PI * (3 - Math.sqrt(5));
/** L'ouverture qu'une sous-branche garde vers son parent, pour que le trait qui y mène passe au large. */
const OUVERTURE_VERS_LE_PARENT = 0.9;

/**
 * EMPILER DES DISQUES AUTOUR D'UN POINT, EN SPIRALE. Les plus gros d'abord, au
 * plus près ; chacun prend la première place libre en s'éloignant peu à peu.
 * Sert au noyau et aux projets, dont les sous-branches ont des tailles très
 * inégales (Beluga porte 2 000 éléments, certains projets aucun) : un simple
 * anneau laisserait un grand vide au centre. `plusPres` : la distance minimale
 * d'un centre au point ; `etaler` : autour du noyau, chaque disque part d'un
 * angle différent (l'angle d'or), sinon tous préfèrent l'extérieur (angle 0) ;
 * `interdit` : le demi-angle gardé libre vers l'arrière, pour le trait qui vient
 * du parent (0 = aucun). Positions rendues dans le repère du point.
 */
function empilerEnSpirale(
  depart: number,
  tailles: readonly number[],
  ecart: number,
  o: { plusPres: number; etaler: boolean; interdit: number },
): { dx: number; dy: number }[] {
  const ordre = tailles.map((_, k) => k).sort((a, b) => tailles[b]! - tailles[a]! || a - b);
  const poses: { x: number; y: number; e: number }[] = [];
  const sortie: { dx: number; dy: number }[] = new Array(tailles.length);
  ordre.forEach((k, rang) => {
    const e = tailles[k]!;
    const prefere = o.etaler ? rang * ANGLE_D_OR : 0;
    for (let rho = Math.max(depart + e, o.plusPres); ; rho += Math.max(3, e * 0.25)) {
      const pas = Math.max(4, e * 0.4) / rho;
      let trouve: { x: number; y: number } | null = null;
      for (let a = 0; a * pas <= Math.PI && !trouve; a += 1) {
        for (const signe of a ? [1, -1] : [1]) {
          const theta = prefere + signe * a * pas;
          if (o.interdit && Math.abs(Math.atan2(Math.sin(theta - Math.PI), Math.cos(theta - Math.PI))) < o.interdit) continue;
          const x = rho * Math.cos(theta);
          const y = rho * Math.sin(theta);
          if (poses.every((p) => Math.hypot(p.x - x, p.y - y) >= p.e + e + ecart)) {
            trouve = { x, y };
            break;
          }
        }
      }
      if (trouve) {
        poses.push({ ...trouve, e });
        sortie[k] = { dx: trouve.x, dy: trouve.y };
        break;
      }
    }
  });
  return sortie;
}

/**
 * POSER L'ARBRE. Deux passes : les tailles d'abord, des feuilles vers le noyau
 * (le disque de chaque sous-branche), puis les positions, du noyau vers les
 * feuilles. Autour du noyau et d'un projet, les sous-branches s'empilent en
 * spirale (`empilerEnSpirale`) ; autour d'une catégorie, ses thèmes se rangent
 * en éventail, chacun à la distance `d0 + son rayon`, `d0` étant la plus petite
 * distance qui les laisse côte à côte dans l'ouverture disponible. Rien ne se
 * chevauche.
 */
export function disposerLArbre(arbre: ArbreDuGraphe): ArbreDuGraphe {
  const { noeuds } = arbre;
  const d0 = new Float64Array(noeuds.length);
  const empiles = new Map<number, { dx: number; dy: number }[]>();
  // Autour du noyau se mêlent catégories du Global et projets : le plus large écart l'emporte.
  const ecartDesEnfants = (n: NoeudDuGraphe) => Math.max(...n.enfants.map((j) => ECART_ENTRE_FRERES[noeuds[j]!.genre]));

  // Passe 1 : les tailles, à rebours (un enfant vient toujours après son parent).
  for (let i = noeuds.length - 1; i >= 0; i -= 1) {
    const n = noeuds[i]!;
    n.r = RAYON_DU_POINT[n.genre];
    if (n.genre === 'element') {
      n.etendue = n.r;
      continue;
    }
    if (n.genre === 'theme') {
      n.etendue = n.r + 2 + PAS_DU_TOURNESOL * Math.sqrt(n.enfants.length) + RAYON_DU_POINT.element;
      continue;
    }
    if (!n.enfants.length) {
      n.etendue = n.r;
      continue;
    }
    const tailles = n.enfants.map((j) => noeuds[j]!.etendue);
    if (n.genre === 'noyau' || n.genre === 'projet') {
      const ecart = ecartDesEnfants(n);
      const plusPres = Math.max(...n.enfants.map((j) => DISTANCE_MIN[noeuds[j]!.genre]));
      const poses = empilerEnSpirale(n.r + ecart, tailles, ecart, { plusPres, etaler: n.genre === 'noyau', interdit: n.parent < 0 ? 0 : OUVERTURE_VERS_LE_PARENT });
      empiles.set(i, poses);
      n.etendue = Math.max(n.r, ...poses.map((p, k) => Math.hypot(p.dx, p.dy) + tailles[k]!));
      continue;
    }
    const ouverture = n.parent < 0 ? Math.PI * 2 : Math.PI * 2 - OUVERTURE_VERS_LE_PARENT;
    const demi = ecartDesEnfants(n) / 2;
    const largeur = (d: number) => tailles.reduce((s, e) => s + 2 * Math.asin(Math.min(1, (e + demi) / (d + e))), 0);
    let bas = Math.max(...n.enfants.map((j) => DISTANCE_MIN[noeuds[j]!.genre]), n.r + demi + 2);
    if (largeur(bas) > ouverture) {
      let haut = bas + tailles.reduce((s, e) => s + 2 * e + 2 * demi, 0) * 2;
      for (let k = 0; k < 48; k += 1) {
        const milieu = (bas + haut) / 2;
        if (largeur(milieu) > ouverture) bas = milieu;
        else haut = milieu;
      }
      bas = haut;
    }
    d0[i] = bas;
    n.etendue = Math.max(n.r, ...tailles.map((e) => bas + 2 * e));
  }

  // Passe 2 : les positions, du noyau vers les feuilles.
  const placer = (i: number, x: number, y: number, direction: number) => {
    const n = noeuds[i]!;
    n.x = x;
    n.y = y;
    if (!n.enfants.length) return;
    if (n.genre === 'theme') {
      // Le tournesol : le premier élément (le plus important) au plus près du thème.
      n.enfants.forEach((j, k) => {
        const rayon = n.r + 2 + PAS_DU_TOURNESOL * Math.sqrt(k + 0.5);
        const angle = direction + k * ANGLE_D_OR;
        placer(j, x + rayon * Math.cos(angle), y + rayon * Math.sin(angle), angle);
      });
      return;
    }
    const poses = empiles.get(i);
    if (poses) {
      const cos = Math.cos(direction);
      const sin = Math.sin(direction);
      n.enfants.forEach((j, k) => {
        const { dx, dy } = poses[k]!;
        const px = dx * cos - dy * sin;
        const py = dx * sin + dy * cos;
        placer(j, x + px, y + py, Math.atan2(py, px));
      });
      return;
    }
    const racine = n.parent < 0;
    const ouverture = racine ? Math.PI * 2 : Math.PI * 2 - OUVERTURE_VERS_LE_PARENT;
    const demi = ecartDesEnfants(n) / 2;
    const largeurs = n.enfants.map((j) => {
      const e = noeuds[j]!.etendue;
      return 2 * Math.asin(Math.min(1, (e + demi) / (d0[i]! + e)));
    });
    const libre = Math.max(0, ouverture - largeurs.reduce((s, w) => s + w, 0));
    // Le jeu se partage entre les enfants (et, autour du noyau, se referme sur le premier).
    const jeu = libre / (racine ? n.enfants.length : n.enfants.length + 1);
    let angle = direction - ouverture / 2 + (racine ? 0 : jeu);
    n.enfants.forEach((j, k) => {
      const e = noeuds[j]!.etendue;
      const centre = angle + largeurs[k]! / 2;
      const distance = d0[i]! + e;
      placer(j, x + distance * Math.cos(centre), y + distance * Math.sin(centre), centre);
      angle += largeurs[k]! + jeu;
    });
  };
  if (noeuds.length) placer(0, 0, 0, -Math.PI / 2);

  // Les cadres remontent, à rebours.
  for (const n of noeuds) n.cadre = { x0: n.x - n.r, y0: n.y - n.r, x1: n.x + n.r, y1: n.y + n.r };
  for (let i = noeuds.length - 1; i > 0; i -= 1) {
    const n = noeuds[i]!;
    const p = noeuds[n.parent]!.cadre;
    p.x0 = Math.min(p.x0, n.cadre.x0);
    p.y0 = Math.min(p.y0, n.cadre.y0);
    p.x1 = Math.max(p.x1, n.cadre.x1);
    p.y1 = Math.max(p.y1, n.cadre.y1);
  }
  return arbre;
}

/** Le cadre qui réunit plusieurs nœuds (et leurs sous-branches si `branches`). */
export function cadreDesNoeuds(arbre: ArbreDuGraphe, indices: Iterable<number>, branches = false): { x0: number; y0: number; x1: number; y1: number } | null {
  let cadre: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const i of indices) {
    const n = arbre.noeuds[i];
    if (!n) continue;
    const c = branches ? n.cadre : { x0: n.x - n.r, y0: n.y - n.r, x1: n.x + n.r, y1: n.y + n.r };
    cadre = cadre
      ? { x0: Math.min(cadre.x0, c.x0), y0: Math.min(cadre.y0, c.y0), x1: Math.max(cadre.x1, c.x1), y1: Math.max(cadre.y1, c.y1) }
      : { ...c };
  }
  return cadre;
}

/* ------------------------------------------------------------------ */
/* Remonter le temps : la mémoire à une date                          */
/* ------------------------------------------------------------------ */

/**
 * LA PÉRIODE REGARDÉE (demande du 2026-10-20) : on voit la mémoire telle
 * qu'elle était à la FIN de la période — « la vraie photo du moment » : tout ce
 * qui était né et pas encore retiré, unités retirées depuis comprises. Ce qui
 * est né AVANT le début reste visible, mais ESTOMPÉ ; ce qui est né pendant la
 * période ressort en couleur. `null` : aujourd'hui, toute la mémoire active.
 * Les PLACES NE BOUGENT PAS d'une date à l'autre : l'arbre se pose une fois sur
 * toutes les dates, seule la visibilité change.
 */
export interface PeriodeDuGraphe {
  /** Le premier instant de la période (le début du jour, en heure locale). */
  debut: number;
  /** Le dernier instant de la période (la fin du jour, 23:59:59.999 en heure locale). */
  fin: number;
}

export type VisibiliteALaDate = 'masque' | 'estompe' | 'plein';

/** Ce que devient un élément à une période : caché (pas encore né, ou déjà retiré), estompé (né avant le début), ou plein. */
export function visibiliteALaDate(element: Pick<ElementDuGraphe, 'creeLe' | 'retireLe'>, periode: PeriodeDuGraphe | null): VisibiliteALaDate {
  if (!periode) return element.retireLe != null ? 'masque' : 'plein';
  if (element.creeLe > periode.fin) return 'masque';
  if (element.retireLe != null && element.retireLe <= periode.fin) return 'masque';
  return element.creeLe < periode.debut ? 'estompe' : 'plein';
}

/** Le niveau de chaque nœud à une période. */
export const NIVEAU_MASQUE = 0;
export const NIVEAU_ESTOMPE = 1;
export const NIVEAU_PLEIN = 2;

/**
 * LE NIVEAU DE CHAQUE NŒUD DE L'ARBRE à une période (0 masqué, 1 estompé,
 * 2 plein) : un élément selon sa date, un thème ou une catégorie selon le plus
 * vivant de ses éléments (une branche vide à la date s'efface avec eux) ; le
 * noyau et les projets restent toujours. `visibles` : combien d'éléments se
 * voient (estompés compris) ; `comptes` : combien sous chaque nœud.
 */
export function niveauxALaDate(arbre: ArbreDuGraphe, periode: PeriodeDuGraphe | null): { niveaux: Uint8Array; comptes: Uint32Array; visibles: number } {
  const { noeuds } = arbre;
  const niveaux = new Uint8Array(noeuds.length);
  const comptes = new Uint32Array(noeuds.length);
  let visibles = 0;
  // À rebours : un enfant vient toujours après son parent.
  for (let i = noeuds.length - 1; i >= 0; i -= 1) {
    const n = noeuds[i]!;
    if (n.genre === 'element') {
      const v = visibiliteALaDate(n.element!, periode);
      niveaux[i] = v === 'plein' ? NIVEAU_PLEIN : v === 'estompe' ? NIVEAU_ESTOMPE : NIVEAU_MASQUE;
      if (niveaux[i]) {
        visibles += 1;
        comptes[i] = 1;
      }
    }
    if (n.parent >= 0) {
      if (niveaux[i]! > niveaux[n.parent]!) niveaux[n.parent] = niveaux[i]!;
      comptes[n.parent] += comptes[i]!;
    }
  }
  // Le noyau et les projets restent, même sans rien sous eux.
  for (const [i, n] of noeuds.entries()) if (n.genre === 'noyau' || n.genre === 'projet') niveaux[i] = NIVEAU_PLEIN;
  return { niveaux, comptes, visibles };
}

/** Le jour « AAAA-MM-JJ » d'un instant, dans l'heure LOCALE de l'appareil (pas le fuseau de référence de `fuseau.ts`). */
export function jourDuGraphe(at: number): string {
  const d = new Date(at);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** La période d'un jour « AAAA-MM-JJ » : de 00:00 à 23:59:59.999, en heure locale. */
export function periodeDuJour(jour: string): PeriodeDuGraphe {
  const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
  return { debut: new Date(a, m - 1, j).getTime(), fin: new Date(a, m - 1, j + 1).getTime() - 1 };
}

export interface JourDeLaMemoire {
  /** « AAAA-MM-JJ », en heure locale. */
  jour: string;
  /** Les éléments nés ce jour-là. */
  ajouts: number;
  /** Les éléments retirés ce jour-là. */
  retraits: number;
}

/**
 * TOUS LES JOURS DE LA MÉMOIRE, du plus récent (aujourd'hui) au PREMIER — le
 * jour du plus ancien élément, calculé, jamais écrit en dur (décision du
 * 2026-10-20 : pas de jours vides avant). Chaque jour dit ses ajouts et ses
 * retraits. Les jours sans mouvement entre les deux restent dans la liste : on
 * remonte le temps jour par jour.
 */
export function joursDeLaMemoire(elements: readonly Pick<ElementDuGraphe, 'creeLe' | 'retireLe'>[], maintenant = Date.now()): JourDeLaMemoire[] {
  if (!elements.length) return [];
  const ajouts = new Map<string, number>();
  const retraits = new Map<string, number>();
  let premier = Infinity;
  for (const e of elements) {
    premier = Math.min(premier, e.creeLe);
    const j = jourDuGraphe(e.creeLe);
    ajouts.set(j, (ajouts.get(j) ?? 0) + 1);
    if (e.retireLe != null) {
      const r = jourDuGraphe(e.retireLe);
      retraits.set(r, (retraits.get(r) ?? 0) + 1);
    }
  }
  const dernier = jourDuGraphe(Math.max(maintenant, premier));
  const jours: JourDeLaMemoire[] = [];
  const d = new Date(premier);
  for (let curseur = new Date(d.getFullYear(), d.getMonth(), d.getDate()); ; curseur.setDate(curseur.getDate() + 1)) {
    const jour = jourDuGraphe(curseur.getTime());
    jours.push({ jour, ajouts: ajouts.get(jour) ?? 0, retraits: retraits.get(jour) ?? 0 });
    if (jour >= dernier || jours.length > 20_000) break;
  }
  return jours.reverse();
}
