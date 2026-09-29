/**
 * LE TABLEAU DES PROJETS DU TABLEAU DE BORD MARKETING : tri et filtres.
 *
 * Une ligne par projet, six colonnes (Projet, Avancement, Prochaine étape,
 * À valider, Type, Visites). Un clic sur l'entête trie, un second inverse, un
 * troisième rend l'ordre par défaut ; chaque colonne a son filtre. Le tri et
 * les filtres sont gardés d'une visite à l'autre par l'écran (stockage local),
 * et relus ici avec prudence : un réglage abîmé redonne le tableau entier.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

export const COLONNES_TABLEAU_MARKETING = ['projet', 'avancement', 'etape', 'aValider', 'type', 'visites'] as const;
export type ColonneTableauMarketing = (typeof COLONNES_TABLEAU_MARKETING)[number];

/** Où en est l'agent d'un projet, tel que la colonne « Prochaine étape » le dit. */
export type EtapeLigneMarketing = 'question' | 'travail' | 'action' | 'rien';

/** Les tranches d'avancement proposées par le filtre de la colonne. */
export const TRANCHES_AVANCEMENT = ['debut', 'milieu', 'fini'] as const;
export type TrancheAvancement = (typeof TRANCHES_AVANCEMENT)[number];

export interface LigneTableauMarketing {
  projectId: string;
  nom: string;
  avancement: number;
  etape: EtapeLigneMarketing;
  /** Le texte de la prochaine étape, tel qu'affiché (tri alphabétique). */
  texteEtape: string;
  aValider: number;
  /** La nature du produit, ou `null` quand l'agent ne la connaît pas encore. */
  nature: string | null;
  visites: number;
}

export interface TriTableauMarketing {
  colonne: ColonneTableauMarketing;
  sens: 'asc' | 'desc';
}

export interface FiltresTableauMarketing {
  /** Recherche dans le nom du projet. */
  nom?: string;
  avancement?: TrancheAvancement[];
  etape?: EtapeLigneMarketing[];
  /** Seulement les projets qui ont quelque chose à valider. */
  aValider?: boolean;
  /** Natures gardées ; « aucune » désigne un produit encore à découvrir. */
  types?: string[];
  /** Seulement les projets qui ont reçu des visites. */
  visites?: boolean;
}

export interface ReglageTableauMarketing {
  tri: TriTableauMarketing | null;
  filtres: FiltresTableauMarketing;
}

export const REGLAGE_TABLEAU_VIDE: ReglageTableauMarketing = { tri: null, filtres: {} };

/** La tranche d'un avancement : moins de la moitié, en route, terminé. */
export function trancheDAvancement(avancement: number): TrancheAvancement {
  if (avancement >= 100) return 'fini';
  return avancement >= 50 ? 'milieu' : 'debut';
}

/** Le filtre de cette colonne est-il actif ? L'entête le montre, et s'efface d'un clic. */
export function filtreActif(filtres: FiltresTableauMarketing, colonne: ColonneTableauMarketing): boolean {
  switch (colonne) {
    case 'projet':
      return !!filtres.nom?.trim();
    case 'avancement':
      return !!filtres.avancement?.length;
    case 'etape':
      return !!filtres.etape?.length;
    case 'aValider':
      return !!filtres.aValider;
    case 'type':
      return !!filtres.types?.length;
    case 'visites':
      return !!filtres.visites;
  }
}

/** Efface le filtre d'une seule colonne. */
export function sansFiltre(filtres: FiltresTableauMarketing, colonne: ColonneTableauMarketing): FiltresTableauMarketing {
  const cle: Record<ColonneTableauMarketing, keyof FiltresTableauMarketing> = {
    projet: 'nom',
    avancement: 'avancement',
    etape: 'etape',
    aValider: 'aValider',
    type: 'types',
    visites: 'visites',
  };
  const copie = { ...filtres };
  delete copie[cle[colonne]];
  return copie;
}

/**
 * LE CLIC SUR UN ENTÊTE : une autre colonne trie dans son sens naturel (les
 * textes de A à Z, les nombres du plus grand au plus petit) ; la même colonne
 * inverse ; un troisième clic rend l'ordre par défaut.
 */
export function triSuivant(actuel: TriTableauMarketing | null, colonne: ColonneTableauMarketing): TriTableauMarketing | null {
  const naturel: 'asc' | 'desc' = colonne === 'projet' || colonne === 'etape' || colonne === 'type' ? 'asc' : 'desc';
  if (!actuel || actuel.colonne !== colonne) return { colonne, sens: naturel };
  if (actuel.sens === naturel) return { colonne, sens: naturel === 'asc' ? 'desc' : 'asc' };
  return null;
}

/** Le poids d'une étape : ce qui vous attend passe devant ce qui travaille. */
const RANG_ETAPE: Record<EtapeLigneMarketing, number> = { question: 0, travail: 1, action: 2, rien: 3 };

function comparer(a: LigneTableauMarketing, b: LigneTableauMarketing, colonne: ColonneTableauMarketing): number {
  switch (colonne) {
    case 'projet':
      return a.nom.localeCompare(b.nom);
    case 'avancement':
      return a.avancement - b.avancement;
    case 'etape':
      return RANG_ETAPE[a.etape] - RANG_ETAPE[b.etape] || a.texteEtape.localeCompare(b.texteEtape);
    case 'aValider':
      return a.aValider - b.aValider;
    case 'type':
      // Un produit encore à découvrir se range après ceux qu'on connaît.
      if (!a.nature !== !b.nature) return a.nature ? -1 : 1;
      return (a.nature ?? '').localeCompare(b.nature ?? '');
    case 'visites':
      return a.visites - b.visites;
  }
}

/** L'ordre par défaut, celui d'avant le tableau : ce qui attend d'abord, puis les plus avancés. */
function ordreParDefaut(a: LigneTableauMarketing, b: LigneTableauMarketing): number {
  return b.aValider - a.aValider || b.avancement - a.avancement || a.nom.localeCompare(b.nom);
}

function garde(ligne: LigneTableauMarketing, f: FiltresTableauMarketing): boolean {
  const nom = f.nom?.trim().toLocaleLowerCase();
  if (nom && !ligne.nom.toLocaleLowerCase().includes(nom)) return false;
  if (f.avancement?.length && !f.avancement.includes(trancheDAvancement(ligne.avancement))) return false;
  if (f.etape?.length && !f.etape.includes(ligne.etape)) return false;
  if (f.aValider && ligne.aValider <= 0) return false;
  if (f.types?.length && !f.types.includes(ligne.nature ?? 'aucune')) return false;
  if (f.visites && ligne.visites <= 0) return false;
  return true;
}

/** Les lignes à afficher, filtrées puis triées. À égalité, l'ordre par défaut départage. */
export function lignesDuTableauMarketing<L extends LigneTableauMarketing>(lignes: L[], reglage: ReglageTableauMarketing): L[] {
  const gardees = lignes.filter((l) => garde(l, reglage.filtres));
  const tri = reglage.tri;
  return gardees.sort((a, b) => {
    if (!tri) return ordreParDefaut(a, b);
    const c = comparer(a, b, tri.colonne);
    return (tri.sens === 'asc' ? c : -c) || ordreParDefaut(a, b);
  });
}

function listeDe<T extends string>(brut: unknown, permis: readonly T[] | null): T[] | undefined {
  if (!Array.isArray(brut)) return undefined;
  const l = brut.filter((x): x is T => typeof x === 'string' && (!permis || permis.includes(x as T)));
  return l.length ? [...new Set(l)] : undefined;
}

/** Relit un réglage gardé : tout ce qui n'est pas reconnu est oublié, jamais une panne. */
export function reglageTableauValide(brut: unknown): ReglageTableauMarketing {
  if (!brut || typeof brut !== 'object') return REGLAGE_TABLEAU_VIDE;
  const r = brut as { tri?: unknown; filtres?: unknown };
  const t = r.tri as Partial<TriTableauMarketing> | null | undefined;
  const tri =
    t && COLONNES_TABLEAU_MARKETING.includes(t.colonne as ColonneTableauMarketing) && (t.sens === 'asc' || t.sens === 'desc')
      ? { colonne: t.colonne as ColonneTableauMarketing, sens: t.sens }
      : null;
  const f = (r.filtres && typeof r.filtres === 'object' ? r.filtres : {}) as Record<string, unknown>;
  const filtres: FiltresTableauMarketing = {};
  if (typeof f.nom === 'string' && f.nom.trim()) filtres.nom = f.nom.slice(0, 100);
  const avancement = listeDe(f.avancement, TRANCHES_AVANCEMENT);
  if (avancement) filtres.avancement = avancement;
  const etape = listeDe(f.etape, ['question', 'travail', 'action', 'rien'] as const);
  if (etape) filtres.etape = etape;
  if (f.aValider === true) filtres.aValider = true;
  const types = listeDe<string>(f.types, null);
  if (types) filtres.types = types;
  if (f.visites === true) filtres.visites = true;
  return { tri, filtres };
}

/**
 * PROJETS ACTIFS, PUIS INACTIFS : un projet dont le suivi marketing est coupé
 * (`actif === false`) passe dans le second tableau, en bas. Sans drapeau, un
 * projet est actif — jamais l'inverse, pour qu'une donnée incomplète ne vide
 * pas le tableau principal. L'ordre de chaque groupe est gardé.
 */
export function separerProjetsActifs<T extends { actif?: boolean }>(projets: readonly T[]): { actifs: T[]; inactifs: T[] } {
  const actifs: T[] = [];
  const inactifs: T[] = [];
  for (const p of projets) (p.actif === false ? inactifs : actifs).push(p);
  return { actifs, inactifs };
}
