/**
 * QUEL COMPTE REÇOIT LE TRAVAIL — UN ORDRE FIXE ENTRE LES COMPTES.
 *
 * La règle a d'abord comparé les PLANS lus sur le coffre (Pro avant Max x20),
 * pour éviter qu'un petit abonnement, payé lui aussi, ne dorme pendant qu'un
 * gros absorbait tout. Mais deux comptes du MÊME plan (deux « Max x5», par
 * exemple) n'avaient plus aucun ordre entre eux : la priorité ne départageait
 * que les ex æquo, et comme les deux comptes Claude du serveur portent le même
 * plan et la même priorité par défaut, le départage se faisait sur la place
 * RESTANTE — donc le travail alternait sans cesse entre les deux comptes d'un
 * même utilisateur, ce qu'aucun des deux ne voulait.
 *
 * La règle compare maintenant d'abord la PRIORITÉ réglée à la main sur chaque
 * compte : le compte de plus petit rang (« 1er ») reçoit tout le travail tant
 * qu'il a de la place, et le suivant ne sert qu'une fois le premier à sa
 * limite. La place restante ne sert plus qu'à départager deux comptes du MÊME
 * rang — elle ne fait plus la loi entre deux comptes rangés différemment,
 * quelle que soit la taille de leur plan respectif.
 *
 * Règle PURE : ni disque, ni base, ni réseau. Elle décide d'un ORDRE, jamais
 * d'une dépense.
 */

/** Ce que la règle a besoin de savoir d'un compte. Rien de plus. */
export interface CompteAClasser {
  id: string;
  /** Le plan lu sur le coffre : « Pro », « Max », « Max x20 »… */
  plan?: string;
  /** Priorité réglée à la main. Elle ne départage plus que les ex æquo. */
  priority?: number;
  /** Part consommée de la fenêtre de cinq heures, en pour cent. */
  sessionPct?: number;
  /** Part consommée de la fenêtre de sept jours, en pour cent. */
  weeklyPct?: number;
  /** Compte coupé à la main : il ne reçoit plus rien. */
  disabled?: boolean;
  /**
   * LA SIGNATURE DU GROUPE DE COMPTES JUMEAUX, quand ce compte rend le même
   * relevé qu'un autre (`shared/src/comptes-jumeaux.ts`). Deux comptes qui la
   * partagent aboutissent au MÊME abonnement chez le fournisseur : leur place
   * restante est une seule et même réserve, et la compter deux fois ferait
   * croire à une capacité qui n'existe pas.
   */
  jumeauDe?: string;
}

/**
 * UN SEUL COMPTE PAR ABONNEMENT RÉEL.
 *
 * Deux comptes jumeaux ont, par construction, exactement la même place
 * restante : garder le mieux classé ne perd donc RIEN, et empêche la règle de
 * voir deux réserves là où il n'y en a qu'une. Un compte sans signature est
 * toujours gardé — c'est le cas normal.
 */
export function sansDoublonDAbonnement<T extends CompteAClasser>(comptes: readonly T[]): T[] {
  const vus = new Set<string>();
  const gardes: T[] = [];
  for (const compte of comptes) {
    if (compte.jumeauDe) {
      if (vus.has(compte.jumeauDe)) continue;
      vus.add(compte.jumeauDe);
    }
    gardes.push(compte);
  }
  return gardes;
}

/**
 * LA TAILLE D'UN PLAN, en nombre de fenêtres « Pro ».
 *
 * Les rapports viennent des paliers publiés par Anthropic : un Max x5 vaut cinq
 * fois un Pro, un Max x20 vingt fois. Un plan INCONNU vaut 1 : on ne suppose
 * jamais qu'un compte est grand, on attend de l'avoir lu.
 */
export function tailleDuPlan(plan?: string): number {
  if (!plan) return 1;
  const propre = plan.toLowerCase();
  if (/20/.test(propre)) return 20;
  if (/max/.test(propre)) return 5;
  return 1;
}

/**
 * LA PLACE RESTANTE, en fenêtres « Pro ». C'est la seule quantité comparable
 * d'un compte à l'autre. La fenêtre la PLUS pleine commande : un compte à 10 %
 * sur cinq heures mais à 98 % sur la semaine n'a presque plus de place.
 */
export function placeRestante(compte: CompteAClasser): number {
  const pire = Math.max(compte.sessionPct ?? 0, compte.weeklyPct ?? 0);
  const libre = Math.max(0, 100 - pire) / 100;
  return tailleDuPlan(compte.plan) * libre;
}

/**
 * L'ORDRE RÉELLEMENT SUIVI PAR LES DÉPARTS : la priorité réglée à la main
 * d'abord (le plus petit rang reçoit tout le travail tant qu'il a de la
 * place), la place restante ensuite — mais seulement pour départager deux
 * comptes du MÊME rang, jamais pour faire passer un compte moins prioritaire
 * devant. Le plan lu sur le coffre (Pro, Max x5, Max x20…) ne pèse plus dans
 * ce classement : seul `placeRestante` s'en sert encore, pour comparer deux
 * plans différents à taille réelle égale.
 */
export function classerComptesPourLeTravail<T extends CompteAClasser>(comptes: readonly T[]): T[] {
  return [...comptes].sort((a, b) => {
    const rang = (a.priority ?? 100) - (b.priority ?? 100);
    if (rang) return rang;
    const place = placeRestante(b) - placeRestante(a);
    if (Math.abs(place) > 0.0001) return place;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Le compte qui doit recevoir le prochain tour, ou rien du tout. Un compte
 * COUPÉ à la main ne reçoit jamais rien ; un compte sans place non plus.
 */
export function compteQuiRecoitLeTravail<T extends CompteAClasser>(comptes: readonly T[]): T | undefined {
  const ouverts = comptes.filter((compte) => !compte.disabled && placeRestante(compte) > 0);
  // Le classement passe D'ABORD : entre deux jumeaux, on garde celui que la
  // règle aurait retenu de toute façon, jamais le premier de la liste reçue.
  return sansDoublonDAbonnement(classerComptesPourLeTravail(ouverts))[0];
}

/**
 * Ce qui s'écrit au journal quand le travail change de compte : son rang dans
 * l'ordre réglé, et s'il s'agit du premier compte de cet ordre ou d'une
 * relève. `comptes` est le lot parmi lequel le choix a été fait — sans lui, on
 * suppose que `compte` était seul en lice.
 */
export function raisonDuChoix<T extends CompteAClasser>(compte: T, comptes: readonly T[] = [compte]): string {
  const reste = Math.round(placeRestante(compte) * 100) / 100;
  const rang = compte.priority ?? 100;
  const meilleurRang = Math.min(...comptes.map((c) => c.priority ?? 100));
  const role = rang <= meilleurRang ? 'premier compte' : 'relève';
  return `rang ${rang} — ${role} — ${reste} fenêtre(s) de place restante`;
}
