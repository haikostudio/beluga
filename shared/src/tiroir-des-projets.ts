/**
 * LES PROJETS DU TIROIR DE CHANGEMENT DE PROJET (clic sur le nom, en haut).
 *
 * Le tiroir montre les projets de la colonne de gauche, DANS SON ORDRE, mais à
 * plat : une seule liste, qu'on parcourt ou qu'on filtre. Les règles de la
 * colonne (`web/src/components/sidebar.tsx`) sont reprises telles quelles :
 *  - un projet mis de côté n'y est pas ;
 *  - les projets hors groupe et les groupes se rangent ENSEMBLE, par rang ;
 *    les membres d'un groupe suivent, par rang ;
 *  - l'espace de développement (`isSelf`) est fixé en tête de son groupe
 *    « Local » ; sans groupe, il ouvre la liste ;
 *  - les membres actifs d'un projet réuni le suivent immédiatement, au lieu de
 *    se ranger eux-mêmes.
 *
 * Règle PURE : ni base, ni disque.
 */
type ProjetDuTiroir = {
  id: string;
  archived?: boolean;
  isSelf?: boolean;
  rank?: number;
  groupId?: string;
  regroupement?: boolean;
  regroupementId?: string;
};

export function projetsDansLOrdreDeLaColonne<P extends ProjetDuTiroir>(
  projets: readonly P[],
  groupes: readonly { id: string; rank?: number }[],
): P[] {
  const rang = (x: { rank?: number }) => x.rank ?? 1000;
  const actifs = projets.filter((p) => !p.archived && !p.isSelf);
  const reunis = new Set(actifs.filter((p) => p.regroupement === true).map((p) => p.id));
  const rangeables = actifs.filter((p) => !(p.regroupementId && reunis.has(p.regroupementId)));
  const soi = projets.find((p) => p.isSelf && !p.archived);
  const aUnGroupe = (p: ProjetDuTiroir) => !!p.groupId && groupes.some((g) => g.id === p.groupId);

  /** Un projet, puis — s'il réunit d'autres projets — ses membres actifs. */
  const avecMembres = (p: P): P[] => [
    p,
    ...(reunis.has(p.id)
      ? actifs.filter((m) => m.regroupementId === p.id).sort((a, b) => rang(a) - rang(b))
      : []),
  ];

  const entrees: { rang: number; projets: P[] }[] = [];
  for (const p of rangeables) if (!aUnGroupe(p)) entrees.push({ rang: rang(p), projets: avecMembres(p) });
  for (const g of groupes) {
    const membres = rangeables
      .filter((p) => p.groupId === g.id)
      .sort((a, b) => rang(a) - rang(b))
      .flatMap(avecMembres);
    entrees.push({ rang: rang(g), projets: soi && soi.groupId === g.id ? [soi, ...membres] : membres });
  }
  entrees.sort((a, b) => a.rang - b.rang);
  const liste = entrees.flatMap((e) => e.projets);
  return soi && !aUnGroupe(soi) ? [soi, ...liste] : liste;
}

/* ------------------------------------------------------------------------- *
 * LE RANGEMENT PAR DERNIÈRE OUVERTURE (liste déroulante du fil d'Ariane,
 * colonne de gauche en bascule) ET LA SECTION « RÉCENTS ».
 *
 * `ouvertLe` est la préférence `projets.ouvertLe` : { identifiant : horodatage
 * en ms }. Rien n'y est écrit par ces règles, et le rang manuel
 * (`rank`) n'est jamais touché : il ne sert que de départage — aux égalités et
 * aux projets jamais ouverts, qui viennent après tous les autres.
 * ------------------------------------------------------------------------- */

/** Les préférences (en base, jamais dans le navigateur) que lisent ces règles. */
export const CLE_OUVERTURES_DE_PROJETS = 'projets.ouvertLe';
export const CLE_EPINGLES_DE_PROJETS = 'projets.epingles';
/** La colonne de gauche suit la dernière ouverture au lieu de l'ordre manuel (bascule, éteinte par défaut). */
export const CLE_TRI_PAR_OUVERTURE = 'sidebar.triParOuverture';

/** Quand chaque projet a été ouvert pour la dernière fois (ms). */
export type OuverturesDeProjets = Readonly<Record<string, number | undefined>>;

/** Combien d'ouvertures la préférence garde : les plus récentes. */
export const OUVERTURES_RETENUES = 60;

/** Combien de projets ouverts la section « Récents » montre, épinglés non compris. */
export const RECENTS_MONTRES = 5;

/** L'ouverture la plus récente d'un lot d'identifiants (0 : jamais ouvert). */
function ouvertureLaPlusRecente(ids: readonly string[], ouvertLe: OuverturesDeProjets): number {
  let plus = 0;
  for (const id of ids) {
    const quand = ouvertLe[id];
    if (typeof quand === 'number' && quand > plus) plus = quand;
  }
  return plus;
}

/**
 * Range des ÉLÉMENTS (projets, groupes, blocs) du plus récemment ouvert au plus
 * ancien. `lire` donne les identifiants que l'élément porte (ses membres, pour
 * un groupe) et son rang manuel, qui départage. L'ordre reçu fait foi à rang
 * égal : le tri est stable.
 */
export function ordonnerParDerniereOuverture<T>(
  elements: readonly T[],
  ouvertLe: OuverturesDeProjets,
  lire: (element: T) => { ids: readonly string[]; rang?: number },
): T[] {
  return elements
    .map((element, index) => {
      const { ids, rang } = lire(element);
      return { element, index, ouverture: ouvertureLaPlusRecente(ids, ouvertLe), rang: rang ?? 1000 };
    })
    .sort((a, b) => b.ouverture - a.ouverture || a.rang - b.rang || a.index - b.index)
    .map((ligne) => ligne.element);
}

/**
 * Les projets de la liste déroulante, à plat, du plus récemment ouvert au plus
 * ancien. Même structure que `projetsDansLOrdreDeLaColonne` — projets hors
 * groupe et groupes rangés ENSEMBLE, membres d'un groupe à la suite, membres
 * d'un projet réuni derrière leur parent — mais chaque niveau suit la
 * dernière ouverture : un groupe vaut l'ouverture la plus récente de ses
 * projets. L'espace de développement (`isSelf`) se range comme les autres.
 */
export function projetsParDerniereOuverture<P extends ProjetDuTiroir>(
  projets: readonly P[],
  groupes: readonly { id: string; rank?: number }[],
  ouvertLe: OuverturesDeProjets,
): P[] {
  const rang = (x: { rank?: number }) => x.rank ?? 1000;
  const actifs = projets.filter((p) => !p.archived);
  const reunis = new Set(actifs.filter((p) => p.regroupement === true).map((p) => p.id));
  const rangeables = actifs.filter((p) => !(p.regroupementId && reunis.has(p.regroupementId)));
  const aUnGroupe = (p: ProjetDuTiroir) => !!p.groupId && groupes.some((g) => g.id === p.groupId);

  const membresDe = (parent: P): P[] =>
    reunis.has(parent.id) ? actifs.filter((m) => m.regroupementId === parent.id) : [];
  const idsDe = (p: P) => [p.id, ...membresDe(p).map((m) => m.id)];
  const parOuverture = (liste: readonly P[]) =>
    ordonnerParDerniereOuverture(liste, ouvertLe, (p) => ({ ids: idsDe(p), rang: rang(p) }));
  const avecMembres = (p: P): P[] => [p, ...parOuverture(membresDe(p))];

  const entrees: { ids: string[]; rang: number; projets: P[] }[] = [];
  for (const p of rangeables) {
    if (!aUnGroupe(p)) entrees.push({ ids: idsDe(p), rang: rang(p), projets: avecMembres(p) });
  }
  for (const g of groupes) {
    const membres = rangeables.filter((p) => p.groupId === g.id);
    if (!membres.length) continue;
    entrees.push({
      ids: membres.flatMap(idsDe),
      rang: rang(g),
      projets: parOuverture(membres).flatMap(avecMembres),
    });
  }
  return ordonnerParDerniereOuverture(entrees, ouvertLe, (e) => ({ ids: e.ids, rang: e.rang })).flatMap(
    (e) => e.projets,
  );
}

/**
 * LA SECTION « RÉCENTS » : d'abord les projets ÉPINGLÉS, dans l'ordre où on les
 * a épinglés ; puis les `n` derniers projets ouverts qui ne le sont pas — les
 * épinglés s'ajoutent aux `n`, ils n'y comptent pas. Un projet n'y figure
 * qu'une fois. Mis de côté ou inconnu, un projet épinglé disparaît sans
 * laisser de ligne. Vide (section masquée) tant qu'aucun projet n'est épinglé
 * et que moins de deux projets ont été ouverts.
 */
export function projetsRecents<P extends { id: string; archived?: boolean }>(
  projets: readonly P[],
  ouvertLe: OuverturesDeProjets,
  epingles: readonly string[],
  n: number = RECENTS_MONTRES,
): P[] {
  const vivants = new Map(projets.filter((p) => !p.archived).map((p) => [p.id, p]));
  const epingles_ = [...new Set(epingles)].map((id) => vivants.get(id)).filter((p): p is P => !!p);
  const dejaPris = new Set(epingles_.map((p) => p.id));
  const ouverts = projets
    .map((p, index) => ({ p, index, quand: ouvertLe[p.id] ?? 0 }))
    .filter((x) => !x.p.archived && x.quand > 0 && !dejaPris.has(x.p.id))
    .sort((a, b) => b.quand - a.quand || a.index - b.index)
    .map((x) => x.p);
  if (!epingles_.length && ouverts.length < 2) return [];
  return [...epingles_, ...ouverts.slice(0, Math.max(0, n))];
}

/** Épingle ou désépingle : l'identifiant s'ajoute à la fin, ou se retire. */
export function basculerEpingle(epingles: readonly string[], id: string): string[] {
  return epingles.includes(id) ? epingles.filter((e) => e !== id) : [...epingles, id];
}

/**
 * Note qu'un projet vient d'être ouvert. Rend LA MÊME référence quand rien ne
 * change (le projet est déjà le plus récent) : l'appelant n'écrit alors rien.
 * Au-delà de `OUVERTURES_RETENUES`, les plus anciennes sortent.
 */
export function noterOuverture(
  ouvertLe: OuverturesDeProjets,
  id: string,
  maintenant: number,
): OuverturesDeProjets {
  const dernier = Math.max(0, ...Object.values(ouvertLe).map((q) => (typeof q === 'number' ? q : 0)));
  if (ouvertLe[id] !== undefined && ouvertLe[id] === dernier) return ouvertLe;
  const suivant: Record<string, number> = {};
  for (const [cle, quand] of Object.entries(ouvertLe)) if (typeof quand === 'number') suivant[cle] = quand;
  suivant[id] = Math.max(maintenant, dernier + 1);
  const gardes = Object.entries(suivant)
    .sort((a, b) => b[1] - a[1])
    .slice(0, OUVERTURES_RETENUES);
  return Object.fromEntries(gardes);
}

/** Lit la préférence `projets.ouvertLe` telle qu'elle est en base, sans jamais jeter. */
export function ouverturesValides(valeur: unknown): Record<string, number> {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return {};
  const sortie: Record<string, number> = {};
  for (const [cle, quand] of Object.entries(valeur as Record<string, unknown>)) {
    if (typeof quand === 'number' && Number.isFinite(quand) && quand > 0) sortie[cle] = quand;
  }
  return sortie;
}

/** Lit la préférence `projets.epingles` : une liste d'identifiants, sans doublon. */
export function epinglesValides(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return [];
  return [...new Set(valeur.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}
