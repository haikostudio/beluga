/**
 * QUEL COMPTE REÇOIT LE TRAVAIL — LA PLACE RESTANTE, PAS « PAS ENCORE À 100 % ».
 *
 * Le choix se faisait par PRIORITÉ, et le premier compte « disponible » était
 * retenu. Or « disponible » ne voulait dire qu'une chose : pas encore à 100 %.
 * Les deux comptes Claude du serveur portant la même priorité, le premier de la
 * liste recevait donc TOUT le travail jusqu'à saturation complète, pendant
 * qu'une fenêtre vingt fois plus grande dormait à côté.
 *
 * Mesuré le 17/08/2026 (`docs/audit-quota-claude.md`) : le compte Pro portait
 * 15 % des tours mais 68,6 % de la pression sur les fenêtres de cinq heures, et
 * c'est le SEUL qui atteignait 100 %. Le même tour y coûte 12,4 fois plus cher
 * que sur le Max x20, parce que sa fenêtre est bien plus petite.
 *
 * D'où la règle : on compare la place RÉELLEMENT restante — la taille du plan
 * multipliée par ce qu'il reste de sa fenêtre —, et le travail part là où il y
 * a le plus de place. Un pourcentage ne se compare pas d'un plan à l'autre :
 * 50 % d'un Pro et 50 % d'un Max x20 ne sont pas la même quantité de travail.
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
 * Les comptes du plus dégagé au plus chargé. La priorité réglée à la main ne
 * départage plus que les ÉGALITÉS : c'est elle qui laissait saturer le petit
 * compte quand les deux portaient le même chiffre.
 */
export function classerComptesParPlace<T extends CompteAClasser>(comptes: readonly T[]): T[] {
  return [...comptes].sort((a, b) => {
    const place = placeRestante(b) - placeRestante(a);
    if (Math.abs(place) > 0.0001) return place;
    return (a.priority ?? 100) - (b.priority ?? 100);
  });
}

/**
 * Le compte qui doit recevoir le prochain tour, ou rien du tout. Un compte
 * COUPÉ à la main ne reçoit jamais rien ; un compte sans place non plus.
 */
export function compteQuiRecoitLeTravail<T extends CompteAClasser>(comptes: readonly T[]): T | undefined {
  const ouverts = comptes.filter((compte) => !compte.disabled && placeRestante(compte) > 0);
  return classerComptesParPlace(ouverts)[0];
}

/** Ce qui s'écrit au journal quand le travail change de compte. */
export function raisonDuChoix(compte: CompteAClasser): string {
  const reste = Math.round(placeRestante(compte) * 100) / 100;
  return `${compte.plan ?? 'plan inconnu'} — ${reste} fenêtre(s) de place restante`;
}
