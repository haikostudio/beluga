import type { ColumnKey } from './columns.js';
import type { SuiviDUneFille } from './models.js';

/**
 * LES SUITES D'ÉTAPES — un travail découpé en cartes ORDONNÉES (24/10/2026).
 *
 * Quand un agent découpait un travail en plusieurs cartes, elles arrivaient sur
 * le tableau sans lien ni ordre, et partaient « n'importe comment ». Une suite
 * reprend la mécanique des projets réunis (`shared/src/regroupements.ts`) — une
 * carte MÈRE qui ne travaille pas et suit ses FILLES —, avec trois différences :
 *
 *  - les filles vivent dans le projet de la mère, une par ÉTAPE, numérotées ;
 *  - elles partent UNE À UNE : l'étape N+1 démarre quand l'étape N a rendu son
 *    travail, en partant de sa branche ;
 *  - une étape finie RESTE dans le groupe, en « En cours » ; toute la suite
 *    passe ensemble en « À déployer » quand la dernière a fini.
 *
 * Une étape bloquée (question, panne, travail impossible) arrête la suite : la
 * suivante ne part pas, et la carte globale dit laquelle bloque. Dès qu'elle
 * repart et finit, l'enchaînement reprend seul.
 *
 * Règles pures : ni base, ni disque. Éprouvées dans
 * `server/src/test/suite-de-cartes.test.ts`.
 */

/** Le nombre d'étapes d'une suite : en dessous, ce n'est pas une suite ; au-dessus, un chantier à recadrer. */
export const ETAPES_DE_SUITE_MIN = 2;
export const ETAPES_DE_SUITE_MAX = 8;

/** Une carte est-elle une étape de suite ? (une fille de projet réuni n'a pas de rang) */
export function estEtapeDeSuite(card: { rangDansLaSuite?: number | null }): boolean {
  return typeof card.rangDansLaSuite === 'number' && card.rangDansLaSuite > 0;
}

/**
 * L'ÉTAPE A FINI ET ATTEND SES SŒURS : elle a rendu son travail, mais la fin de
 * tour l'a gardée en « En cours » (`etapeRetenueEnFinDeTour`). Le balayage des
 * cartes oubliées ne la range pas : c'est la suite qui la rangera.
 */
export function etapeRetenue(card: {
  column: string;
  rangDansLaSuite?: number | null;
  etapeFinieAt?: number | null;
}): boolean {
  return card.column === 'running' && estEtapeDeSuite(card) && !!card.etapeFinieAt;
}

/**
 * LA FIN DE TOUR D'UNE ÉTAPE NE LA SORT PAS DU GROUPE : là où une carte
 * ordinaire passerait en « À déployer », l'étape d'une suite reste en « En
 * cours », marquée finie. Toute autre issue (retour en file, carte retenue sur
 * sa question) suit son chemin ordinaire.
 */
export function etapeRetenueEnFinDeTour(
  card: { rangDansLaSuite?: number | null },
  cible: ColumnKey | null | undefined,
): boolean {
  return estEtapeDeSuite(card) && cible === 'to_deploy';
}

/** Ce que l'enchaînement lit de chaque étape, dans l'ordre de la suite. */
export interface EtapeDeSuiteLue {
  cardId: string;
  rang: number;
  column: string;
  etat: SuiviDUneFille['etat'];
  /** La suite l'a déjà lancée une fois : on ne la relance plus, l'ordonnanceur rejoue ses refus. */
  departDeLaSuiteAt?: number | null;
}

/**
 * L'ÉTAPE À LANCER MAINTENANT, ou `null`.
 *
 * On parcourt les étapes dans l'ordre : les étapes finies sont sautées ; la
 * PREMIÈRE qui ne l'est pas décide de tout. Encore en « Planifié » et jamais
 * lancée par la suite, c'est elle qu'on lance. Sinon — au travail, arrêtée sur
 * une question ou une panne, ou déjà lancée et retenue par une porte (quota,
 * place) que l'ordonnanceur rejouera —, on ne lance RIEN : jamais deux étapes
 * d'une même suite en même temps, jamais une étape après une étape bloquée.
 *
 * Idempotente : appelée à chaque mouvement d'une fille, elle ne rend la même
 * étape qu'une fois, puisque son lancement pose `departDeLaSuiteAt`.
 */
export function etapeAEnchainer(etapes: readonly EtapeDeSuiteLue[]): string | null {
  const ordre = [...etapes].sort((a, b) => a.rang - b.rang);
  for (const etape of ordre) {
    if (etape.etat === 'fait') continue;
    if (etape.column === 'planned' && !etape.departDeLaSuiteAt) return etape.cardId;
    return null;
  }
  return null;
}

/** La suite est-elle finie ? Toutes ses étapes ont rendu leur travail. */
export function suiteFinie(suivi: readonly Pick<SuiviDUneFille, 'etat'>[]): boolean {
  return suivi.length > 0 && suivi.every((f) => f.etat === 'fait');
}

/**
 * LA COLONNE DE LA CARTE GLOBALE, lue sur ses étapes — `null` : elle ne bouge
 * pas (une suite pas encore lancée reste où elle est, en « Planifié »).
 *
 *  - une étape n'a pas fini : « En cours » ;
 *  - toutes ont fini : « À déployer », jusqu'à ce que toutes soient en ligne ;
 *  - toutes sont archivées : « Archivé ».
 *
 * La carte globale ne publie rien (`excludedFromDeploy`) : elle suit ses étapes
 * dans « À déployer » pour que le groupe reste entier jusqu'à la mise en ligne.
 */
export function colonneDeLaTeteDeSuite(
  colonneActuelle: string,
  etapes: readonly { column: string; etat: SuiviDUneFille['etat'] }[],
): ColumnKey | null {
  if (!etapes.length || colonneActuelle === 'planned') return null;
  if (!suiteFinie(etapes)) return 'running';
  if (etapes.every((e) => e.column === 'archived')) return 'archived';
  return 'to_deploy';
}

/** Les étapes finies encore retenues dans le groupe, à passer ensemble en « À déployer ». */
export function etapesALiberer<T extends { column: string; rangDansLaSuite?: number | null; etapeFinieAt?: number | null }>(
  etapes: readonly T[],
  suivi: readonly Pick<SuiviDUneFille, 'etat'>[],
): T[] {
  if (!suiteFinie(suivi)) return [];
  return etapes.filter(etapeRetenue);
}

/**
 * LA CONSIGNE POSÉE EN TÊTE DE CHAQUE ÉTAPE. L'agent d'une étape ne voit que
 * son étape : il doit savoir qu'il y en a d'autres, ce qui a été fait avant
 * (et se trouve déjà sur sa branche), et ce qui viendra après — pour ne pas
 * le faire à la place de l'étape suivante.
 */
export function consigneDeLEtape(rang: number, titres: readonly string[], titreDeLaSuite: string): string {
  const total = titres.length;
  const avant = titres.slice(0, rang - 1);
  const apres = titres.slice(rang);
  return [
    `CETTE CARTE EST L’ÉTAPE ${rang} SUR ${total} de la suite « ${titreDeLaSuite} ».`,
    avant.length
      ? `Les étapes précédentes (${avant.map((t, i) => `${i + 1}. ${t}`).join(' ; ')}) sont terminées : leur travail est déjà sur ta branche, pars de là.`
      : 'C’est la première étape : rien n’a encore été fait.',
    apres.length
      ? `Les étapes suivantes (${apres.map((t, i) => `${rang + i + 1}. ${t}`).join(' ; ')}) partiront après toi, chacune sur sa propre carte : ne les fais pas.`
      : 'C’est la dernière étape : après elle, toute la suite passera en « À déployer ».',
    'Ne fais que cette étape, entièrement.',
  ].join(' ');
}

/**
 * LES PHRASES DES POINTS D'UNE CARTE GLOBALE — traduites comme les autres
 * (`shared/src/traductions.ts`). Celles des projets réunis parlent de
 * « projets touchés » : une suite parle d'étapes.
 */
export const PHRASES_DE_LA_SUITE = {
  travail: {
    encours: 'Les étapes partent une à une, chacune après la précédente.',
    fait: 'Toutes les étapes ont fini leur travail.',
    question: 'Une étape attend votre réponse : la suite reprendra après.',
    erreur: 'Une étape s’est arrêtée : la suite attend qu’elle reparte. Ouvrez-la pour la reprendre.',
  },
  rapport: {
    avenir: 'Chaque étape rendra son compte rendu en finissant.',
    fait: 'Le compte rendu de chaque étape.',
  },
} as const;

/** Le relevé d'une carte globale parle-t-il d'étapes ? (sinon, de projets touchés) */
export function suiviDUneSuite(suivi: readonly Pick<SuiviDUneFille, 'rang'>[] | null | undefined): boolean {
  return !!suivi?.length && suivi.some((f) => typeof f.rang === 'number');
}

/**
 * L'ÉTAPE OÙ EN EST LA SUITE, pour la barre du bas de sa carte globale
 * (« Étape 2/3 au travail ») : la première qui n'a pas fini, et le total.
 * `null` quand tout est fini.
 */
export function etapeCouranteDeLaSuite(
  suivi: readonly Pick<SuiviDUneFille, 'etat' | 'rang'>[],
): { rang: number; total: number } | null {
  const ordre = [...suivi].sort((a, b) => (a.rang ?? 0) - (b.rang ?? 0));
  const index = ordre.findIndex((f) => f.etat !== 'fait');
  if (index < 0) return null;
  return { rang: ordre[index].rang ?? index + 1, total: ordre.length };
}
