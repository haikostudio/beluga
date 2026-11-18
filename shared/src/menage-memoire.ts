/**
 * LE MÉNAGE AUTOMATIQUE DE LA MÉMOIRE — règles pures (indicateur de flou, plan,
 * essai de rappel), sans base ni disque.
 *
 * Constat du 05/11/2026 : 3 654 unités P1 actives sur 6 926 (P0 + P1 = 57 %).
 * « Vital » ne voulait plus rien dire : l'accueil plafonné n'en servait qu'une
 * poignée, et les règles qui comptaient (l'interface) n'y passaient jamais. La
 * mémoire était devenue FLOUE.
 *
 * DÉCISION DE L'UTILISATEUR : quand elle devient floue, le ménage s'applique
 * SEUL, la nuit, et se VÉRIFIE par un essai — un jeu de demandes types dont on
 * connaît la bonne réponse, passé à la recherche avant et après. Si le rappel
 * baisse, le lot entier est ANNULÉ. C'est la seule exception voulue à « la nuit
 * ne fait que proposer » ; elle ne s'étend à rien d'autre.
 *
 * Le ménage ne touche JAMAIS une unité P0, « à ne jamais supposer », ni une
 * décision, une contrainte, une exigence, une règle de sécurité ou la tête du
 * projet. Il fait deux gestes, tous deux réversibles (version gardée) :
 *  - RECLASSER en P2 une unité P1 ancienne que personne n'a lue depuis longtemps ;
 *  - DÉPRÉCIER au profit de l'autre un doublon exact (même titre, même type).
 */

export type ImportanceDuMenage = 'P0' | 'P1' | 'P2' | 'P3';

export interface UniteDuMenage {
  id: string;
  type: string;
  importance: ImportanceDuMenage;
  jamaisSupposer: boolean;
  titreNorme: string;
  creeLe: number;
  modifieLe: number;
  /** La dernière lecture par un agent (`connaissance_lectures`), s'il y en a eu. */
  derniereLecture?: number;
}

const JOUR = 24 * 3600 * 1000;

/** Au-delà de cette part de P0 + P1 parmi les actives, « vital » ne trie plus rien. */
export const SEUIL_PART_VITALE = 0.35;
/** Une unité plus jeune ou lue plus récemment que ceci n'est jamais reclassée. */
export const AGE_MIN_RECLASSEMENT_JOURS = 30;
export const SANS_LECTURE_JOURS = 60;
/** Un lot par nuit, borné : le ménage avance par étapes vérifiées, jamais d'un coup. */
export const LOT_MAX_PAR_NUIT = 300;

/** Les types qu'aucun ménage ne reclasse : ce sont des engagements, pas des constats. */
export const TYPES_INTOUCHABLES = new Set(['decision', 'constraint', 'requirement', 'security', 'project']);

export interface IndicateurDeFlou {
  actives: number;
  vitales: number;
  partVitale: number;
  /** P1 anciennes jamais lues depuis `SANS_LECTURE_JOURS`. */
  p1Dormantes: number;
  doublons: number;
  flou: boolean;
  raisons: string[];
}

/** Les groupes de doublons exacts : même titre normalisé ET même type. */
export function doublonsExacts(unites: readonly UniteDuMenage[]): UniteDuMenage[][] {
  const groupes = new Map<string, UniteDuMenage[]>();
  for (const u of unites) {
    if (!u.titreNorme) continue;
    const cle = `${u.type}\u0000${u.titreNorme}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), u]);
  }
  return [...groupes.values()].filter((g) => g.length > 1);
}

function dormante(u: UniteDuMenage, maintenant: number): boolean {
  return (
    u.importance === 'P1' &&
    !u.jamaisSupposer &&
    !TYPES_INTOUCHABLES.has(u.type) &&
    maintenant - u.creeLe > AGE_MIN_RECLASSEMENT_JOURS * JOUR &&
    maintenant - u.modifieLe > AGE_MIN_RECLASSEMENT_JOURS * JOUR &&
    (u.derniereLecture === undefined || maintenant - u.derniereLecture > SANS_LECTURE_JOURS * JOUR)
  );
}

/** LA MÉMOIRE EST-ELLE FLOUE ? Trop de « vital », ou des doublons exacts. */
export function indicateurDeFlou(unites: readonly UniteDuMenage[], maintenant = Date.now()): IndicateurDeFlou {
  const actives = unites.length;
  const vitales = unites.filter((u) => u.importance === 'P0' || u.importance === 'P1').length;
  const partVitale = actives ? vitales / actives : 0;
  const p1Dormantes = unites.filter((u) => dormante(u, maintenant)).length;
  const doublons = doublonsExacts(unites).reduce((n, g) => n + g.length - 1, 0);
  const raisons: string[] = [];
  if (partVitale > SEUIL_PART_VITALE && p1Dormantes > 0) {
    raisons.push(`${Math.round(partVitale * 100)} % des unités se disent vitales (P0 + P1), dont ${p1Dormantes} P1 que personne n’a lues depuis ${SANS_LECTURE_JOURS} jours`);
  }
  if (doublons > 0) raisons.push(`${doublons} doublon(s) exact(s)`);
  return { actives, vitales, partVitale, p1Dormantes, doublons, flou: raisons.length > 0, raisons };
}

export type ActionDeMenage =
  | { geste: 'reclasser'; id: string; de: ImportanceDuMenage; vers: ImportanceDuMenage }
  | { geste: 'deprecier'; id: string; auProfitDe: string };

const RANG: Record<ImportanceDuMenage, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * LE PLAN D'UNE NUIT. Les doublons d'abord (on garde la plus importante, puis
 * la plus récemment modifiée), puis les P1 dormantes les plus anciennes, tant
 * que la part vitale dépasse le seuil — jamais plus de `max` gestes.
 */
export function planDeMenage(unites: readonly UniteDuMenage[], options: { maintenant?: number; max?: number } = {}): ActionDeMenage[] {
  const maintenant = options.maintenant ?? Date.now();
  const max = options.max ?? LOT_MAX_PAR_NUIT;
  const actions: ActionDeMenage[] = [];
  const retirees = new Set<string>();
  for (const groupe of doublonsExacts(unites)) {
    const tries = [...groupe].sort((a, b) => RANG[a.importance] - RANG[b.importance] || Number(b.jamaisSupposer) - Number(a.jamaisSupposer) || b.modifieLe - a.modifieLe);
    const garde = tries[0];
    for (const autre of tries.slice(1)) {
      if (autre.importance === 'P0' || autre.jamaisSupposer) continue;
      if (actions.length >= max) return actions;
      actions.push({ geste: 'deprecier', id: autre.id, auProfitDe: garde.id });
      retirees.add(autre.id);
    }
  }
  const restantes = unites.filter((u) => !retirees.has(u.id));
  let vitales = restantes.filter((u) => u.importance === 'P0' || u.importance === 'P1').length;
  const cible = Math.floor(SEUIL_PART_VITALE * restantes.length);
  const dormantes = restantes.filter((u) => dormante(u, maintenant)).sort((a, b) => (a.derniereLecture ?? 0) - (b.derniereLecture ?? 0) || a.creeLe - b.creeLe);
  for (const u of dormantes) {
    if (vitales <= cible || actions.length >= max) break;
    actions.push({ geste: 'reclasser', id: u.id, de: 'P1', vers: 'P2' });
    vitales -= 1;
  }
  return actions;
}

/* ------------------------------------------------------------------ */
/* L'essai                                                              */
/* ------------------------------------------------------------------ */

export interface CasDEssai {
  demande: string;
  /** Les identifiants qu'une bonne recherche doit faire remonter. */
  attendu: string[];
}

/** Le rang au-delà duquel une unité attendue compte comme perdue. */
export const RANG_DE_L_ESSAI = 10;

/** La part des unités attendues retrouvées dans les `k` premiers résultats. */
export function scoreDeRappel(resultats: readonly { attendu: readonly string[]; trouves: readonly string[] }[], k = RANG_DE_L_ESSAI): number {
  let attendus = 0;
  let retrouves = 0;
  for (const r of resultats) {
    const tete = new Set(r.trouves.slice(0, k).map((id) => id.toUpperCase()));
    for (const id of r.attendu) {
      attendus += 1;
      if (tete.has(id.toUpperCase())) retrouves += 1;
    }
  }
  return attendus ? retrouves / attendus : 1;
}

/** Le rang moyen des attendues (pénalité `k + 1` quand absente) : départage deux rappels égaux. */
export function rangMoyen(resultats: readonly { attendu: readonly string[]; trouves: readonly string[] }[], k = RANG_DE_L_ESSAI): number {
  const rangs: number[] = [];
  for (const r of resultats) {
    const ids = r.trouves.slice(0, k).map((id) => id.toUpperCase());
    for (const id of r.attendu) {
      const i = ids.indexOf(id.toUpperCase());
      rangs.push(i < 0 ? k + 1 : i + 1);
    }
  }
  return rangs.length ? rangs.reduce((a, b) => a + b, 0) / rangs.length : 0;
}

/**
 * LE VERDICT DE L'ESSAI : le ménage est gardé si le rappel ne BAISSE PAS et si
 * le rang moyen des réponses attendues ne recule pas de plus d'une demi-place.
 * Sinon il est annulé, en entier.
 */
export function verdictDeLEssai(avant: { rappel: number; rang: number }, apres: { rappel: number; rang: number }): 'garder' | 'annuler' {
  if (apres.rappel + 1e-9 < avant.rappel) return 'annuler';
  if (apres.rang > avant.rang + 0.5) return 'annuler';
  return 'garder';
}

/**
 * LES CAS D'ESSAI TIRÉS DE LA MÉMOIRE ELLE-MÊME : chaque unité que le ménage
 * ne doit jamais faire disparaître (P0, « à ne jamais supposer », décisions)
 * est cherchée par son titre clair — elle doit rester trouvable. Tirage stable
 * (par identifiant), borné.
 */
export function casDEssaiDeLaMemoire(
  unites: readonly { id: string; type: string; importance: string; jamaisSupposer: boolean; titre: string; titreHumain?: string }[],
  max = 40,
): CasDEssai[] {
  return unites
    .filter((u) => u.importance === 'P0' || u.jamaisSupposer || u.type === 'decision')
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, max)
    .map((u) => ({ demande: u.titreHumain || u.titre, attendu: [u.id] }));
}
