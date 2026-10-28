/**
 * QUEL COMPTE REÇOIT LE TRAVAIL — FINIR LA FENÊTRE ENTAMÉE, PUIS L'ORDRE RÉGLÉ.
 *
 * La règle a d'abord comparé les PLANS lus sur le coffre (Pro avant Max x20),
 * puis, pour que deux comptes du même plan cessent d'alterner, la PRIORITÉ
 * réglée par l'utilisateur avec les flèches de « Comptes et quotas »
 * (`ordonnerComptes`) : le compte de plus petit rang recevait tout.
 *
 * Mais entre deux comptes SEMBLABLES (même moteur, même taille de forfait),
 * suivre le rang gâchait du quota : le compte n° 1 revenu à zéro reprenait la
 * main alors que le n° 2 avait une fenêtre de cinq heures entamée (80 %, par
 * exemple) qui allait se perdre à sa remise à zéro (demande du 27/10/2026).
 * D'où l'ordre actuel :
 *
 *  1. Les comptes de MÊME TAILLE forment un lot, qui prend la place de son
 *     mieux rangé dans l'ordre réglé. Entre deux lots de tailles différentes,
 *     l'ORDRE RÉGLÉ décide ; à rang égal seulement, le PLUS GROS passe devant
 *     (décision de l'utilisateur, 27/10/2026).
 *  2. DANS un lot, on FINIT LA FENÊTRE ENTAMÉE : celle qui se remet à zéro
 *     le plus tôt d'abord (son reste serait perdu), puis la plus consommée,
 *     et le rang ne départage qu'ensuite. Le travail colle donc au même
 *     compte jusqu'à sa limite : pas d'alternance.
 *  3. Un compte au repos (fenêtre pas encore ouverte) ne sert qu'en dernier
 *     recours (`compteQuiRecoitLeTravail`).
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
  /**
   * L'INSTANT (ms) OÙ LA FENÊTRE DE CINQ HEURES SE REMET À ZÉRO, quand elle
   * tourne. Absent ou déjà passé : aucune fenêtre entamée connue.
   */
  sessionFinit?: number;
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
  /**
   * LA FENÊTRE DE CINQ HEURES TOURNE DÉJÀ (moteurs à fenêtre courte : Claude).
   * `false` : le compte est au repos, et le réveiller hors de son créneau
   * casserait l'écart entre les comptes. Absent : inconnu, sans effet.
   */
  fenetreOuverte?: boolean;
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

/** Une fin de fenêtre exploitable : connue et pas encore passée. */
function finDeFenetre(compte: CompteAClasser, maintenant: number): number {
  const fin = compte.sessionFinit;
  return typeof fin === 'number' && Number.isFinite(fin) && fin > maintenant ? fin : Number.POSITIVE_INFINITY;
}

/**
 * L'ORDRE RÉELLEMENT SUIVI PAR LES DÉPARTS (voir l'en-tête) : les lots de
 * comptes de même taille dans l'ordre réglé (le plus gros à rang égal), puis,
 * dans un lot, la fenêtre de cinq heures qui finit le plus tôt, la plus
 * consommée, le rang, l'identifiant. `maintenant` écarte une fin de fenêtre
 * déjà passée (relevé périmé).
 */
export function classerComptesPourLeTravail<T extends CompteAClasser>(comptes: readonly T[], maintenant = Date.now()): T[] {
  const rangDuLot = new Map<number, number>();
  for (const compte of comptes) {
    const taille = tailleDuPlan(compte.plan);
    rangDuLot.set(taille, Math.min(rangDuLot.get(taille) ?? Number.POSITIVE_INFINITY, compte.priority ?? 100));
  }
  return [...comptes].sort((a, b) => {
    const tailleA = tailleDuPlan(a.plan);
    const tailleB = tailleDuPlan(b.plan);
    if (tailleA !== tailleB) {
      const lot = rangDuLot.get(tailleA)! - rangDuLot.get(tailleB)!;
      return lot || tailleB - tailleA;
    }
    const finA = finDeFenetre(a, maintenant);
    const finB = finDeFenetre(b, maintenant);
    if (finA !== finB) return finA < finB ? -1 : 1;
    const consomme = (b.sessionPct ?? 0) - (a.sessionPct ?? 0);
    if (Math.abs(consomme) > 0.0001) return consomme;
    const rang = (a.priority ?? 100) - (b.priority ?? 100);
    if (rang) return rang;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Le compte qui doit recevoir le prochain tour, ou rien du tout. Un compte
 * COUPÉ à la main ne reçoit jamais rien ; un compte sans place non plus.
 */
export function compteQuiRecoitLeTravail<T extends CompteAClasser>(comptes: readonly T[], maintenant = Date.now()): T | undefined {
  const ouverts = comptes.filter((compte) => !compte.disabled && placeRestante(compte) > 0);
  // Le classement passe D'ABORD : entre deux jumeaux, on garde celui que la
  // règle aurait retenu de toute façon, jamais le premier de la liste reçue.
  const classes = sansDoublonDAbonnement(classerComptesPourLeTravail(ouverts, maintenant));
  // UN COMPTE AU REPOS EN DERNIER RECOURS : tant qu'un compte dont la fenêtre
  // tourne a de la place, il passe devant, quel que soit son rang. Le travail
  // n'attend jamais : sans lui, le compte au repos sert quand même.
  return classes.find((compte) => compte.fenetreOuverte !== false) ?? classes[0];
}

/**
 * Ce qui s'écrit au journal quand le travail change de compte : sa place dans
 * l'ORDRE RÉGLÉ PAR L'UTILISATEUR (« n° 1 de votre liste »), puis la place qui
 * lui reste. `comptes` est le lot parmi lequel le choix a été fait — sans lui,
 * on suppose que `compte` était seul en lice.
 */
export function raisonDuChoix<T extends CompteAClasser>(compte: T, comptes: readonly T[] = [compte]): string {
  const reste = Math.round(placeRestante(compte) * 100) / 100;
  const place = classerComptesPourLeTravail(comptes).findIndex((c) => c.id === compte.id) + 1;
  return `n° ${place || 1} de votre liste — ${reste} fenêtre(s) de place restante`;
}
