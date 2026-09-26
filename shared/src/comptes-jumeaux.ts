/**
 * DEUX COMPTES, UN SEUL ABONNEMENT — LE CAS QUI FAIT MENTIR LES JAUGES.
 *
 * Chaque compte moteur est relevé avec le jeton de SON coffre : deux comptes
 * réellement distincts ne peuvent donc pas rendre le même pourcentage sur les
 * deux fenêtres ET la même échéance à la minute près. Quand cela arrive, les
 * deux coffres aboutissent au même abonnement chez le fournisseur — c'est ce
 * qui s'est produit le 02/09/2026 sur les deux comptes Claude du serveur, dont
 * les jetons portaient le même compte Anthropic (même identifiant de compte,
 * même adresse) après une reconnexion.
 *
 * L'INTERFACE MONTRAIT ALORS DEUX JAUGES IDENTIQUES SANS RIEN DIRE, et le
 * choix du compte (`choix-de-compte.ts`) croyait avoir deux réserves là où il
 * n'y en avait qu'une : la place restante était comptée deux fois.
 *
 * Règle PURE : ni disque, ni base, ni réseau. Elle ne fait que RAPPROCHER des
 * relevés déjà lus, et ne décide d'aucune dépense.
 */

/** Ce qu'il faut savoir d'un relevé pour le rapprocher d'un autre. */
export interface ReleveComparable {
  id: string;
  /** Le moteur : on ne rapproche jamais deux comptes de moteurs différents. */
  engine: string;
  /**
   * L'IDENTIFIANT DU COMPTE CHEZ LE FOURNISSEUR, lu sur son profil avec le
   * jeton de CE coffre. C'est la seule preuve directe : deux coffres qui
   * portent le même identifiant sont branchés sur le même abonnement, et deux
   * identifiants différents disent le contraire, quels que soient les chiffres.
   * Absent quand le profil n'a pas pu être lu — on retombe alors sur les
   * relevés, et le jumelage n'est plus qu'une PRÉSOMPTION.
   */
  compteFournisseur?: string;
  /** Part consommée de la fenêtre courte, en pour cent. */
  sessionPct?: number;
  /** Échéance de la fenêtre courte, en millisecondes. */
  sessionResetsAt?: number;
  /** Part consommée de la fenêtre longue, en pour cent. */
  weeklyPct?: number;
  /** Échéance de la fenêtre longue, en millisecondes. */
  weeklyResetsAt?: number;
}

/**
 * LA TOLÉRANCE SUR L'ÉCHÉANCE : une minute.
 *
 * Deux lectures du même abonnement sont faites à quelques centaines de
 * millisecondes d'intervalle et le fournisseur recalcule l'échéance à chaque
 * appel : les horodatages diffèrent au millième, jamais à la minute. Comparer
 * au millième ne rapprocherait donc JAMAIS deux comptes pourtant identiques.
 */
const TOLERANCE_ECHEANCE_MS = 60_000;

function memeEcheance(a?: number, b?: number): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) < TOLERANCE_ECHEANCE_MS;
}

function memePourcentage(a?: number, b?: number): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return Math.round(a) === Math.round(b);
}

/**
 * COMMENT ON SAIT QUE DEUX COFFRES DISENT LE MÊME ABONNEMENT.
 *
 * - « certain » : les deux profils rendent le MÊME identifiant de compte chez
 *   le fournisseur. Il n'y a plus rien à déduire, c'est lu.
 * - « presume » : aucune identité des deux côtés, mais les deux relevés
 *   coïncident au pourcentage et à la minute près. C'est l'ancienne règle,
 *   gardée en repli pour qu'une panne du profil ne fasse pas disparaître toute
 *   détection.
 * - `null` : ce ne sont pas les mêmes.
 */
export type NatureDuJumelage = 'certain' | 'presume';

/**
 * DEUX RELEVÉS DISENT-ILS LE MÊME ABONNEMENT, ET SUR QUELLE PREUVE ?
 *
 * L'IDENTITÉ PRIME SUR LES CHIFFRES. Deux identités connues des deux côtés
 * tranchent seules : identiques, les coffres sont jumeaux CERTAINS ;
 * différentes, ils ne le sont PAS, même si leurs jauges coïncident au
 * pourcentage près — deux comptes du même palier peu utilisés affichent
 * volontiers 0 % et la même échéance.
 *
 * Le repli par les chiffres ne sert que lorsque l'identité manque : il faut que
 * TOUT coïncide (le moteur, les deux pourcentages, les deux échéances) et
 * qu'AU MOINS UNE ÉCHÉANCE soit connue — sans cela, deux comptes neufs sans
 * fenêtre ouverte seraient déclarés jumeaux alors qu'ils n'ont rien à montrer.
 */
export function natureDuJumelage(a: ReleveComparable, b: ReleveComparable): NatureDuJumelage | null {
  if (a.id === b.id) return null;
  if (a.engine !== b.engine) return null;
  if (a.compteFournisseur && b.compteFournisseur) {
    return a.compteFournisseur === b.compteFournisseur ? 'certain' : null;
  }
  const echeanceConnue = a.sessionResetsAt !== undefined || a.weeklyResetsAt !== undefined;
  if (!echeanceConnue) return null;
  const memesChiffres =
    memePourcentage(a.sessionPct, b.sessionPct) &&
    memePourcentage(a.weeklyPct, b.weeklyPct) &&
    memeEcheance(a.sessionResetsAt, b.sessionResetsAt) &&
    memeEcheance(a.weeklyResetsAt, b.weeklyResetsAt);
  return memesChiffres ? 'presume' : null;
}

/**
 * LES GROUPES DE COMPTES QUI RENDENT LE MÊME RELEVÉ, chacun trié par
 * identifiant pour que l'ordre d'arrivée ne change rien. Un compte seul
 * n'apparaît dans aucun groupe : il n'y a rien à signaler.
 */
export function groupesDeComptesJumeaux(releves: readonly ReleveComparable[]): string[][] {
  return groupesDeJumeaux(releves).map((groupe) => groupe.ids);
}

/** Un groupe de coffres branchés au même abonnement, avec la preuve qui le dit. */
export interface GroupeDeJumeaux {
  ids: string[];
  nature: NatureDuJumelage;
}

/**
 * LES GROUPES, AVEC LEUR PREUVE. Un groupe formé sur les identités est
 * « certain » ; un groupe formé sur les seuls chiffres reste « presume ». Un
 * groupe mixte prend le plus faible des deux : on n'affirme jamais plus que ce
 * qu'on a lu.
 */
export function groupesDeJumeaux(releves: readonly ReleveComparable[]): GroupeDeJumeaux[] {
  const groupes: { membres: ReleveComparable[]; nature: NatureDuJumelage }[] = [];
  for (const releve of releves) {
    let place = false;
    for (const groupe of groupes) {
      const nature = natureDuJumelage(groupe.membres[0], releve);
      if (!nature) continue;
      groupe.membres.push(releve);
      if (nature === 'presume') groupe.nature = 'presume';
      place = true;
      break;
    }
    if (!place) groupes.push({ membres: [releve], nature: 'certain' });
  }
  return groupes
    .filter((groupe) => groupe.membres.length > 1)
    .map((groupe) => ({ ids: groupe.membres.map((r) => r.id).sort(), nature: groupe.nature }));
}

/**
 * POUR CHAQUE COMPTE JUMEAU, LA PREUVE DE SON JUMELAGE. L'écran s'en sert pour
 * dire un FAIT (« même compte ») ou une PRÉSOMPTION (« même relevé »).
 */
export function natureParCompte(releves: readonly ReleveComparable[]): Map<string, NatureDuJumelage> {
  const table = new Map<string, NatureDuJumelage>();
  for (const groupe of groupesDeJumeaux(releves)) {
    for (const id of groupe.ids) table.set(id, groupe.nature);
  }
  return table;
}

/**
 * POUR CHAQUE COMPTE, LES AUTRES COMPTES QUI DISENT LA MÊME CHOSE.
 *
 * C'est ce que l'écran affiche : sur la carte du compte Pro, « même relevé que
 * Claude Max x20 ». Un compte sans jumeau n'est pas dans la table.
 */
export function jumeauxParCompte(releves: readonly ReleveComparable[]): Map<string, string[]> {
  const table = new Map<string, string[]>();
  for (const groupe of groupesDeComptesJumeaux(releves)) {
    for (const id of groupe) table.set(id, groupe.filter((autre) => autre !== id));
  }
  return table;
}

/**
 * LA SIGNATURE DU GROUPE d'un compte, ou `undefined` s'il est seul de son
 * espèce. C'est ce que le choix de compte reçoit : deux comptes qui portent la
 * même signature ne comptent que pour UNE réserve.
 */
export function signaturesDeGroupe(releves: readonly ReleveComparable[]): Map<string, string> {
  const table = new Map<string, string>();
  for (const groupe of groupesDeComptesJumeaux(releves)) {
    const signature = groupe.join('+');
    for (const id of groupe) table.set(id, signature);
  }
  return table;
}
