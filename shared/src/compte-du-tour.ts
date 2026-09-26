import { CompteAClasser, classerComptesPourLeTravail } from './choix-de-compte.js';

/**
 * LE COMPTE D'UN TOUR — LA RÈGLE, EN UN SEUL ENDROIT.
 *
 * Le compte d'un tour se choisissait en trois paliers écrits en dur dans le
 * démon : le compte IMPOSÉ (le seul tour de reprise), puis le compte RÉGLÉ à
 * la main sur l'agent, puis la répartition automatique — Pro d'abord, Max x20
 * en relève. Deux choses manquaient, et c'est exactement ce que le journal du
 * 06.09.2026 montre sur une carte : chaque tour ordinaire repartait sur Claude
 * Pro, dont le relevé disait encore « disponible » alors que le moteur
 * répondait « requires usage credits » ; le tour tombait, une relève partait
 * sur Max x20, la reprise réussissait… et le tour suivant recommençait sur Pro.
 *
 *  1. Le compte du DERNIER tour de l'agent (`Agent.account`) n'était consulté
 *     nulle part.
 *  2. La LIMITE déjà rencontrée sur un compte n'était mémorisée que sur le
 *     message du tour tombé, jamais dans le choix suivant.
 *
 * La règle d'ici tient les deux. Elle est PURE — ni base, ni relevé, ni
 * réseau — et rend une DÉCISION : le compte à prendre et pourquoi, ou bien
 * « répartition » quand aucun des trois premiers paliers ne tranche. La
 * répartition elle-même reste dans le démon (`pickAccount`) parce qu'elle a
 * besoin d'un relevé frais ; elle reçoit alors la liste des comptes à ÉCARTER.
 *
 * Les quatre paliers, dans l'ordre :
 *
 *  1. IMPOSÉ — un choix humain revérifié au clic, ou une relève automatique —
 *     s'il existe pour ce moteur et n'est pas à sa limite connue ;
 *  2. RÉGLÉ dans les réglages de l'agent (`run.account`), même condition ;
 *  3. LE DERNIER COMPTE DE L'AGENT, tant qu'un compte mieux classé est à sa
 *     limite connue : c'est ce qui fait tenir un compte d'un tour à l'autre —
 *     et garde, au passage, le fil du moteur ouvert sur ce compte-là ;
 *  4. LA RÉPARTITION, sur les seuls comptes sans limite connue en cours.
 *
 * Une limite connue S'EFFACE à son échéance (`echeanceDeLaLimite`), ou quand un
 * relevé frais montre la fenêtre du compte remise à zéro — cette seconde
 * moitié vit dans le démon, qui seul lit les relevés.
 */

/** Comment la limite a été reconnue : événement du moteur, ou texte de limite. */
export type MotifDeLimite = 'limite-structuree' | 'texte-de-limite';

/** Une limite rencontrée sur un compte, telle que le démon la mémorise. */
export interface LimiteConnue {
  /** Le compte tombé. */
  compte: string;
  motif: MotifDeLimite;
  /** La remise à zéro annoncée par le relevé, quand on la connaît. */
  resetsAt?: number;
  /** L'instant où la limite a été rencontrée. */
  noteeA: number;
}

/**
 * UNE LIMITE SANS ÉCHÉANCE CONNUE dure une fenêtre de cinq heures. C'est le
 * cas d'un manque de CRÉDITS (« requires usage credits ») : le relevé de quota
 * ne le voit pas et n'annonce aucune remise à zéro. On réessaie donc le compte
 * une fois par fenêtre — un tour tombé toutes les cinq heures au pire, jamais
 * un tour tombé à chaque départ.
 */
export const LIMITE_SANS_ECHEANCE_MS = 5 * 60 * 60 * 1000;

/**
 * UNE ÉCHÉANCE TROP LOINTAINE EST PLAFONNÉE à sept jours : une remise à zéro
 * mal lue (une date en secondes prise pour des millisecondes) ne doit pas
 * écarter un compte pour des années.
 */
export const LIMITE_ECHEANCE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** Jusqu'à quand cette limite écarte-t-elle son compte ? */
export function echeanceDeLaLimite(limite: LimiteConnue): number {
  const parDefaut = limite.noteeA + LIMITE_SANS_ECHEANCE_MS;
  if (typeof limite.resetsAt !== 'number' || limite.resetsAt <= limite.noteeA) return parDefaut;
  return Math.min(limite.resetsAt, limite.noteeA + LIMITE_ECHEANCE_MAX_MS);
}

/**
 * L'HEURE DE RETOUR ANNONCÉE PAR LE MOTEUR LUI-MÊME. Claude termine sa bannière
 * de limite par « resets 12:20pm (UTC) ». Sans cette lecture, l'échéance venait
 * du DERNIER RELEVÉ en cache — souvent la fenêtre d'avant, déjà passée — et
 * retombait sur `LIMITE_SANS_ECHEANCE_MS` : le premier compte restait écarté
 * jusqu'à cinq heures de trop, et le suivant continuait d'être consommé alors
 * que le premier était déjà revenu. L'heure lue est la PROCHAINE occurrence
 * après `now` (jamais dans le passé). Fuseaux lus : UTC, ou un nom IANA
 * (« Europe/Zurich ») ; sans fuseau lisible, on ne devine rien.
 */
export function echeanceAnnonceeParLeMoteur(texte: string | undefined, now: number): number | undefined {
  if (!texte) return undefined;
  const trouve = /resets\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(([^)]+)\)/i.exec(texte);
  if (!trouve) return undefined;
  let heure = Number(trouve[1]);
  const minute = Number(trouve[2] ?? 0);
  const meridien = trouve[3]?.toLowerCase();
  if (meridien) {
    if (heure < 1 || heure > 12) return undefined;
    heure = (heure % 12) + (meridien === 'pm' ? 12 : 0);
  }
  if (heure > 23 || minute > 59) return undefined;
  const fuseau = trouve[4].trim();
  const decalage = decalageDuFuseau(fuseau, now);
  if (decalage === undefined) return undefined;
  const jour = new Date(now + decalage);
  let echeance =
    Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate(), heure, minute) - decalage;
  while (echeance <= now) echeance += 24 * 60 * 60 * 1000;
  return echeance;
}

/** Le décalage d'un fuseau par rapport à UTC, en millisecondes, à cet instant. */
function decalageDuFuseau(fuseau: string, now: number): number | undefined {
  if (/^(utc|gmt|z)$/i.test(fuseau)) return 0;
  try {
    const parties = new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(now));
    const v = (type: string) => Number(parties.find((p) => p.type === type)?.value);
    const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
    return local - Math.floor(now / 60000) * 60000;
  } catch {
    return undefined;
  }
}

/** Cette limite écarte-t-elle encore son compte à cet instant ? */
export function limiteEnCours(limite: LimiteConnue, now: number): boolean {
  return now < echeanceDeLaLimite(limite);
}

/** Les comptes qu'une limite connue écarte encore à cet instant. */
export function comptesALimiteConnue(limites: readonly LimiteConnue[], now: number): Set<string> {
  return new Set(limites.filter((limite) => limiteEnCours(limite, now)).map((limite) => limite.compte));
}

/** Ce que la règle a besoin de savoir d'un compte candidat. */
export interface CompteCandidat extends CompteAClasser {
  id: string;
  engine: string;
}

export interface EntreeDuCompteDuTour {
  /** Le moteur du tour : on ne prend jamais le compte d'un autre. */
  engine: string;
  /** Le compte imposé à ce tour (reprise après limite), s'il y en a un. */
  impose?: string;
  /** Le compte réglé à la main sur l'agent (`run.account`). */
  regle?: string;
  /** Le compte du dernier tour de l'agent (`Agent.account`). */
  dernier?: string;
  /** Les comptes existants, tous moteurs confondus ou non. */
  comptes: readonly CompteCandidat[];
  /** Les limites rencontrées, en cours ou non : la règle trie elle-même. */
  limites: readonly LimiteConnue[];
  now: number;
}

/** Pourquoi ce compte a été retenu — ou pourquoi la répartition doit trancher. */
export type RaisonDuCompte = 'impose' | 'regle' | 'dernier' | 'repartition';

export interface DecisionDeCompte {
  /** Le compte retenu, ou rien : la répartition tranche alors, hors des écartés. */
  compte?: string;
  raison: RaisonDuCompte;
  /** Les comptes de ce moteur qu'une limite connue écarte encore. */
  ecartes: string[];
  /**
   * Un compte demandé (imposé ou réglé) qu'on n'a PAS pu tenir, et pourquoi :
   * le démon le dit dans son journal au lieu de le laisser deviner.
   */
  refuse?: { compte: string; raison: 'introuvable' | 'coupe' | 'limite-connue' };
}

/** Un compte est-il utilisable, hors limite ? */
function utilisable(compte: CompteCandidat | undefined, engine: string): boolean {
  return !!compte && compte.engine === engine && !compte.disabled;
}

/**
 * LE COMPTE DE CE TOUR. Voir l'en-tête du fichier pour les quatre paliers.
 */
export function compteDuTour(entree: EntreeDuCompteDuTour): DecisionDeCompte {
  const duMoteur = entree.comptes.filter((compte) => compte.engine === entree.engine);
  const parId = new Map(duMoteur.map((compte) => [compte.id, compte]));
  const limites = comptesALimiteConnue(entree.limites, entree.now);
  const ecartes = duMoteur.filter((compte) => limites.has(compte.id)).map((compte) => compte.id);

  /* Les deux paliers HUMAINS : un compte demandé qu'on ne peut pas tenir est
     DIT, et l'on passe au palier suivant au lieu de bloquer le tour. */
  let refuse: DecisionDeCompte['refuse'];
  const demande = (id: string | undefined, raison: 'impose' | 'regle'): DecisionDeCompte | null => {
    if (!id) return null;
    const compte = parId.get(id);
    if (!utilisable(compte, entree.engine)) {
      refuse = refuse ?? { compte: id, raison: compte ? 'coupe' : 'introuvable' };
      return null;
    }
    if (limites.has(id)) {
      refuse = refuse ?? { compte: id, raison: 'limite-connue' };
      return null;
    }
    return { compte: id, raison, ecartes };
  };
  const impose = demande(entree.impose, 'impose');
  if (impose) return impose;
  const regle = demande(entree.regle, 'regle');
  if (regle) return regle;

  /*
   * LE DERNIER COMPTE DE L'AGENT TIENT tant qu'un compte MIEUX CLASSÉ est à sa
   * limite connue. Le classement est celui de la répartition (le rang réglé
   * sur chaque compte, la place restante en départage) : ici on ne mesure pas
   * la place, on regarde seulement qui passerait devant.
   */
  const dernier = entree.dernier ? parId.get(entree.dernier) : undefined;
  if (utilisable(dernier, entree.engine) && !limites.has(dernier!.id)) {
    const ordre = classerComptesPourLeTravail(duMoteur.filter((compte) => !compte.disabled));
    const rang = ordre.findIndex((compte) => compte.id === dernier!.id);
    const mieuxClasseEcarte = ordre.slice(0, Math.max(rang, 0)).some((compte) => limites.has(compte.id));
    if (mieuxClasseEcarte) return { compte: dernier!.id, raison: 'dernier', ecartes, refuse };
  }

  return { compte: undefined, raison: 'repartition', ecartes, refuse };
}
