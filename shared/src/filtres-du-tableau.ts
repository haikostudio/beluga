/**
 * LES FILTRES DU TABLEAU COMMUN (décision de l'utilisateur du 03/11/2026 : « l'en-tête permet de trier et de
 * filtrer », sur TOUTES les listes de contenu de l'application).
 *
 * Deux genres de filtre par colonne :
 * - « texte » : une recherche sans accents ni majuscules (« ete » trouve « Été ») ;
 * - « choix » : des valeurs cochées parmi celles PRÉSENTES dans les lignes (genre, état, réseau…).
 * Plus une recherche d'ensemble, posée au-dessus du tableau, qui lit toutes les colonnes filtrables.
 *
 * Tout travaille sur les lignes déjà chargées : aucune requête par frappe. Règles pures, sans écran.
 */

export type FiltreDUneColonne = { genre: 'texte'; texte: string } | { genre: 'choix'; valeurs: readonly string[] };

export type FiltresDuTableau = Readonly<Record<string, FiltreDUneColonne>>;

/** Ce qu'une colonne donne à filtrer : un texte, plusieurs (un tableau d'étiquettes), ou rien. */
export type ValeurFiltrable = string | number | readonly string[] | null | undefined;

/** Sans accents, sans majuscules, espaces resserrés : la forme comparée des deux côtés. */
export function normaliserPourFiltre(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function enTextes(valeur: ValeurFiltrable): string[] {
  if (valeur === null || valeur === undefined) return [];
  if (typeof valeur === 'number') return [String(valeur)];
  if (typeof valeur === 'string') return valeur ? [valeur] : [];
  return valeur.filter((v) => !!v);
}

/** Un filtre qui ne retient rien (texte vide, aucune case cochée) ne filtre pas. */
export function filtreActif(filtre: FiltreDUneColonne | undefined): boolean {
  if (!filtre) return false;
  return filtre.genre === 'texte' ? normaliserPourFiltre(filtre.texte) !== '' : filtre.valeurs.length > 0;
}

export function nombreDeFiltresActifs(filtres: FiltresDuTableau): number {
  return Object.values(filtres).filter(filtreActif).length;
}

/** La ligne passe-t-elle CE filtre ? Une case vide ne passe ni une recherche ni un choix. */
export function ligneRetenueParLeFiltre(valeur: ValeurFiltrable, filtre: FiltreDUneColonne | undefined): boolean {
  if (!filtreActif(filtre)) return true;
  const textes = enTextes(valeur);
  if (filtre!.genre === 'texte') {
    /* Chaque mot cherché doit se trouver : « vidéo été » trouve « Vidéo de l'été ». */
    const mots = normaliserPourFiltre(filtre!.texte).split(' ');
    const lu = normaliserPourFiltre(textes.join(' '));
    return mots.every((m) => lu.includes(m));
  }
  const voulues = new Set(filtre!.valeurs);
  return textes.some((t) => voulues.has(t));
}

/**
 * LES LIGNES QUI PASSENT TOUS LES FILTRES (un « et » entre colonnes), et la recherche d'ensemble (chaque mot
 * présent dans au moins une colonne lue). L'ordre reçu est gardé.
 */
export function filtrerLesLignes<L>(
  lignes: readonly L[],
  filtres: FiltresDuTableau,
  lecteurs: Readonly<Record<string, (ligne: L) => ValeurFiltrable>>,
  recherche = '',
): L[] {
  const actifs = Object.entries(filtres).filter(([cle, f]) => filtreActif(f) && lecteurs[cle]);
  const mots = normaliserPourFiltre(recherche).split(' ').filter(Boolean);
  if (!actifs.length && !mots.length) return [...lignes];
  const tousLesLecteurs = Object.values(lecteurs);
  return lignes.filter((ligne) => {
    if (!actifs.every(([cle, f]) => ligneRetenueParLeFiltre(lecteurs[cle]!(ligne), f))) return false;
    if (!mots.length) return true;
    const lu = normaliserPourFiltre(tousLesLecteurs.flatMap((lire) => enTextes(lire(ligne))).join(' '));
    return mots.every((m) => lu.includes(m));
  });
}

/**
 * LES VALEURS QU'UN FILTRE « CHOIX » PROPOSE : celles des lignes, sans doublon, triées, avec leur nombre. Une
 * valeur cochée qui a disparu des lignes reste proposée (à zéro) : on peut toujours la décocher.
 */
export function valeursDuChoix<L>(lignes: readonly L[], lire: (ligne: L) => ValeurFiltrable, cochees: readonly string[] = [], langue?: string): { valeur: string; nombre: number }[] {
  const comptes = new Map<string, number>();
  for (const ligne of lignes) for (const v of new Set(enTextes(lire(ligne)))) comptes.set(v, (comptes.get(v) ?? 0) + 1);
  for (const v of cochees) if (!comptes.has(v)) comptes.set(v, 0);
  return [...comptes.entries()].map(([valeur, nombre]) => ({ valeur, nombre })).sort((a, b) => a.valeur.localeCompare(b.valeur, langue, { numeric: true, sensitivity: 'base' }));
}

/** Coche ou décoche une valeur d'un filtre « choix » ; le filtre vidé disparaît. */
export function basculerUnChoix(filtres: FiltresDuTableau, colonne: string, valeur: string): FiltresDuTableau {
  const avant = filtres[colonne];
  const valeurs = avant?.genre === 'choix' ? avant.valeurs : [];
  const suite = valeurs.includes(valeur) ? valeurs.filter((v) => v !== valeur) : [...valeurs, valeur];
  const { [colonne]: _retire, ...reste } = filtres;
  return suite.length ? { ...reste, [colonne]: { genre: 'choix', valeurs: suite } } : reste;
}

/** Écrit la recherche d'une colonne « texte » ; vide, le filtre disparaît. */
export function ecrireUnTexte(filtres: FiltresDuTableau, colonne: string, texte: string): FiltresDuTableau {
  const { [colonne]: _retire, ...reste } = filtres;
  return texte ? { ...reste, [colonne]: { genre: 'texte', texte } } : reste;
}

/** La signature des filtres : quand elle change, le tableau revient en première page. */
export function signatureDesFiltres(filtres: FiltresDuTableau, recherche = ''): string {
  return JSON.stringify([
    normaliserPourFiltre(recherche),
    Object.entries(filtres)
      .filter(([, f]) => filtreActif(f))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([cle, f]) => [cle, f.genre === 'texte' ? normaliserPourFiltre(f.texte) : [...f.valeurs].sort()]),
  ]);
}
