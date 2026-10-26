/**
 * Amorcer la fenêtre de cinq heures des comptes Claude.
 *
 * Chez Claude, la fenêtre de cinq heures ne part qu'au PREMIER appel. Tant
 * qu'on n'a rien envoyé, le compteur reste à zéro et la fenêtre commencera au
 * moment où on en aura besoin — c'est-à-dire au pire moment. On envoie donc
 * une requête minuscule dès qu'une fenêtre est retombée à zéro, pour que le
 * décompte tourne déjà quand le travail arrive.
 *
 * La décision vit ici, sans réseau ni base : elle se teste seule.
 *
 * CODEX N'EST PAS CONCERNÉ, et ce n'est pas un oubli : essai fait sur le vrai
 * compte le 03/08/2026, une requête minuscule envoyée puis les compteurs
 * relus. Codex n'annonce qu'une seule fenêtre, celle de la semaine ; aucune
 * fenêtre courte n'apparaît ni avant ni après l'appel. Il n'y a donc rien à
 * amorcer de ce côté, et amorcer une fenêtre hebdomadaire n'aurait aucun sens.
 */

/** Durée d'une fenêtre Claude, utilisée quand l'heure de remise à zéro manque. */
export const DUREE_FENETRE_MS = 5 * 60 * 60 * 1000;

/** Ce que l'amorçage a besoin de savoir sur un compte. */
export interface EtatCompteAmorce {
  id: string;
  engine: string;
  /** Consommation de la fenêtre de cinq heures, en pour cent. */
  sessionPct?: number;
  /** Heure annoncée de remise à zéro de cette fenêtre. */
  resetsAt?: number;
  /** La dernière lecture de quota a échoué : les chiffres affichés sont périmés. */
  lectureEnEchec?: boolean;
  /** Un agent travaille en ce moment sur ce compte : la fenêtre est déjà lancée. */
  agentEnCours?: boolean;
  /** La dernière amorce posée sur ce compte, telle qu'on l'a retenue. */
  derniereAmorce?: AmorcePosee;
}

/** Une amorce déjà envoyée : quand, et jusqu'à quand elle couvre la fenêtre. */
export interface AmorcePosee {
  at: number;
  /** Instant à partir duquel la fenêtre amorcée est considérée comme terminée. */
  jusqua: number;
  model?: string;
}

export type RaisonAmorce =
  | 'a-amorcer'
  | 'autre-moteur'
  | 'heures-de-silence'
  | 'lecture-en-echec'
  | 'fenetre-en-cours'
  | 'agent-en-cours'
  | 'fenetre-deja-amorcee'
  | 'avant-son-creneau';

/**
 * Faut-il amorcer ce compte maintenant ? Une seule réponse, et sa raison :
 * c'est elle qui part au journal quand rien n'est fait.
 */
export function decisionAmorce(
  etat: EtatCompteAmorce,
  maintenant: number,
  silence = false,
  creneau?: number,
): RaisonAmorce {
  // Seuls les comptes Claude ont une fenêtre de cinq heures qui s'amorce (voir
  // [[fenetre-codex]] : chez Codex, on n'a trouvé qu'une fenêtre hebdomadaire).
  if (etat.engine !== 'claude') return 'autre-moteur';
  // Pendant les heures de silence, on ne réveille personne : la nuit, la
  // dernière fenêtre amorcée a le temps de s'éteindre, et la reprise du matin
  // en rouvre une aussitôt.
  if (silence) return 'heures-de-silence';
  // Une lecture ratée rejoue les derniers chiffres connus : agir dessus
  // reviendrait à amorcer sur une preuve qu'on n'a plus.
  if (etat.lectureEnEchec) return 'lecture-en-echec';
  // Un agent en train de travailler a forcément lancé la fenêtre lui-même.
  if (etat.agentEnCours) return 'agent-en-cours';
  // La fenêtre tourne déjà : le compteur a bougé.
  if ((etat.sessionPct ?? 0) > 0) return 'fenetre-en-cours';
  // Une amorce minuscule ne fait pas toujours bouger un compteur affiché à un
  // dixième près : c'est NOTRE trace qui empêche de recommencer, pas le
  // compteur. Elle tient jusqu'à la fin de la fenêtre amorcée.
  if (etat.derniereAmorce && maintenant < etat.derniereAmorce.jusqua) return 'fenetre-deja-amorcee';
  // Un compte qui suit le repère n'est réveillé qu'à SON créneau (voir
  // `creneauxDesComptes`) : l'amorcer dès que sa fenêtre retombe ferait
  // dériver l'écart au hasard. Sans créneau connu, rien ne change.
  if (creneau !== undefined && creneau > maintenant + AVANCE_CRENEAU_MS) return 'avant-son-creneau';
  return 'a-amorcer';
}

/** Les comptes à amorcer, dans l'ordre reçu : ils seront traités un par un. */
export function comptesAAmorcer(
  etats: EtatCompteAmorce[],
  maintenant: number,
  silence = false,
  creneaux?: Map<string, CreneauDuCompte>,
): EtatCompteAmorce[] {
  return etats.filter(
    (etat) => decisionAmorce(etat, maintenant, silence, creneaux?.get(etat.id)?.prochainCreneau) === 'a-amorcer',
  );
}

/* ------------------------------------------------------------------ */
/* Les créneaux : des fenêtres décalées à parts égales                 */
/* ------------------------------------------------------------------ */

/**
 * DES FENÊTRES DÉCALÉES À PARTS ÉGALES ENTRE LES COMPTES CLAUDE.
 *
 * Réveiller chaque compte dès que sa fenêtre retombe ne tient AUCUN écart : le
 * travail ouvre lui aussi des fenêtres, et l'écart entre deux comptes dérivait
 * au hasard (deux heures, puis dix minutes, puis 4 h 40 — constaté le
 * 24/10/2026). Le compte PRIORITAIRE (plus petite priorité) sert de repère et
 * garde son rythme ; le k-ième compte suivant n'est réveillé qu'aux instants
 * début-de-fenêtre-du-repère + k × 5 h / N (+ un multiple de 5 h) : 2 h 30
 * pour deux comptes, 1 h 40 pour trois. Ainsi un compte repart toujours peu
 * après qu'un autre s'épuise.
 *
 * Un compte coupé ou jumeau d'un autre (même abonnement) ne compte pas dans
 * le partage. Une fenêtre ouverte hors créneau par le travail finit hors
 * créneau : le compte attend alors son créneau suivant, et l'écart se recale.
 */

/** Retard admis sur un créneau : au-delà, on attend le suivant. Couvre le relevé des dix minutes. */
export const TOLERANCE_CRENEAU_MS = 10 * 60 * 1000;
/** Avance admise : un minuteur qui sonne quelques secondes tôt ne rate pas son créneau. */
export const AVANCE_CRENEAU_MS = 60 * 1000;
/**
 * Écart au-delà duquel une fenêtre en cours a PERDU son créneau. Une amorce
 * part au plus dix minutes après le sien (`TOLERANCE_CRENEAU_MS`) : trente
 * minutes ne se voient donc jamais sans que le travail ait rouvert la fenêtre
 * ailleurs (cas du 25/10/2026 à 9 h 20 : un tour parti à 9 h 14 a passé la fin
 * de fenêtre et l'a rouverte, alignée sur le repère).
 */
export const TOLERANCE_ALIGNEMENT_MS = 30 * 60 * 1000;

/** Ce que le partage a besoin de savoir d'un compte. */
export interface CompteACaler {
  id: string;
  engine: string;
  priority?: number;
  disabled?: boolean;
  /** Signature de groupe des comptes jumeaux (`comptes-jumeaux.ts`). */
  jumeauDe?: string;
  sessionPct?: number;
  resetsAt?: number;
  /** Fin de la fenêtre lancée par notre dernière amorce, si elle court encore. */
  finAmorce?: number;
  /** Rien de sûr sur ce compte (relevé en échec, amorce en panne) : il ne peut pas servir de repère. */
  incertain?: boolean;
}

export interface CreneauDuCompte {
  id: string;
  /** Le compte prioritaire, sur lequel les autres se calent. */
  repereId: string;
  /** 0 pour le repère, puis 1, 2… */
  rang: number;
  /** Nombre de comptes qui se partagent la fenêtre. */
  parts: number;
  /** Écart voulu avec le repère. */
  decalageMs: number;
  /** Le prochain créneau d'amorce (non défini pour le repère, ou sans repère sûr). */
  prochainCreneau?: number;
  /** L'heure à laquelle ce compte sera réellement réveillé ensuite, fenêtre en cours comprise. */
  prochainReveil?: number;
  /**
   * LA FENÊTRE EN COURS A PERDU SON CRÉNEAU : le travail l'a ouverte ailleurs
   * (souvent alignée sur le repère). Rien n'est coupé — le travail n'attend
   * jamais —, mais à sa fin le compte reste au repos jusqu'à `prochainReveil`.
   */
  horsCreneau?: HorsCreneau;
}

export interface HorsCreneau {
  /** Fin de la fenêtre en cours, celle qui a perdu le créneau. */
  finFenetre: number;
  /** Distance de cette fin au créneau le plus proche. */
  ecartMs: number;
  /** La fenêtre finit en même temps que celle du repère (à la tolérance près) : les deux sont alignées. */
  alignee: boolean;
}

/**
 * CETTE FENÊTRE A-T-ELLE PERDU SON CRÉNEAU ? Une fenêtre lancée au créneau
 * finit sur la suite `base + m × 5 h` ; on mesure la distance de sa fin à
 * cette suite. Le repère garde toujours son rythme : c'est l'autre qui se
 * recale, même quand c'est le repère qui l'a rattrapé.
 */
export function fenetreHorsCreneau(
  base: number,
  finFenetre: number,
  finRepere?: number,
): HorsCreneau | undefined {
  const reste = (((finFenetre - base) % DUREE_FENETRE_MS) + DUREE_FENETRE_MS) % DUREE_FENETRE_MS;
  const ecartMs = Math.min(reste, DUREE_FENETRE_MS - reste);
  if (ecartMs <= TOLERANCE_ALIGNEMENT_MS) return undefined;
  const alignee = finRepere !== undefined && Math.abs(finFenetre - finRepere) <= TOLERANCE_ALIGNEMENT_MS;
  return { finFenetre, ecartMs, alignee };
}

/** La fenêtre de ce compte court-elle, et jusqu'à quand ? */
function finDeFenetreEnCours(compte: CompteACaler, maintenant: number): number | undefined {
  if ((compte.sessionPct ?? 0) > 0 && compte.resetsAt && compte.resetsAt > maintenant) return compte.resetsAt;
  if (compte.finAmorce && compte.finAmorce > maintenant) return compte.finAmorce;
  return undefined;
}

/** Le premier instant de la suite `base + m × DUREE` qui ne précède pas `apres`. */
export function premierCreneauApres(base: number, apres: number): number {
  return base + Math.ceil((apres - base) / DUREE_FENETRE_MS) * DUREE_FENETRE_MS;
}

/**
 * Les créneaux de chaque compte Claude. Le repère au repos va être amorcé tout
 * de suite : sa fenêtre est censée partir maintenant. Un repère INCERTAIN ne
 * cale personne — les autres gardent alors l'ancien comportement.
 */
export function creneauxDesComptes(
  comptes: readonly CompteACaler[],
  maintenant: number,
): Map<string, CreneauDuCompte> {
  const vus = new Set<string>();
  const partage = comptes
    .filter((c) => c.engine === 'claude' && !c.disabled)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id))
    .filter((c) => {
      if (!c.jumeauDe) return true;
      if (vus.has(c.jumeauDe)) return false;
      vus.add(c.jumeauDe);
      return true;
    });
  const resultat = new Map<string, CreneauDuCompte>();
  if (!partage.length) return resultat;
  const repere = partage[0];
  const parts = partage.length;
  const finRepere = finDeFenetreEnCours(repere, maintenant);
  const debutRepere = finRepere !== undefined ? finRepere - DUREE_FENETRE_MS : repere.incertain ? undefined : maintenant;

  partage.forEach((compte, rang) => {
    const decalageMs = Math.round((rang * DUREE_FENETRE_MS) / parts);
    const creneau: CreneauDuCompte = { id: compte.id, repereId: repere.id, rang, parts, decalageMs };
    if (rang === 0) {
      creneau.prochainReveil = finRepere ?? maintenant;
    } else if (debutRepere !== undefined) {
      const base = debutRepere + decalageMs;
      creneau.prochainCreneau = premierCreneauApres(base, maintenant - TOLERANCE_CRENEAU_MS);
      const fin = finDeFenetreEnCours(compte, maintenant);
      creneau.prochainReveil = fin !== undefined ? premierCreneauApres(base, fin) : creneau.prochainCreneau;
      // Seul un repère dont la fenêtre court donne une suite fixe : au repos,
      // son début glisse avec l'horloge et l'écart ne voudrait rien dire.
      if (fin !== undefined && finRepere !== undefined) {
        const hors = fenetreHorsCreneau(base, fin, finRepere);
        if (hors) creneau.horsCreneau = hors;
      }
    }
    resultat.set(compte.id, creneau);
  });
  return resultat;
}

/**
 * LA FENÊTRE DE CE COMPTE TOURNE-T-ELLE DÉJÀ ? Le choix du compte s'en sert
 * pour envoyer le travail d'abord là où le décompte est lancé, et ne réveiller
 * un compte au repos — donc hors de son créneau — qu'en dernier recours.
 */
export function fenetreOuverte(
  compte: { sessionPct?: number; derniereAmorce?: { at: number; ok: boolean }; agentEnCours?: boolean },
  maintenant: number,
): boolean {
  if (compte.agentEnCours) return true;
  if ((compte.sessionPct ?? 0) > 0) return true;
  // Une amorce minuscule ne fait pas toujours bouger le compteur affiché.
  return !!compte.derniereAmorce?.ok && maintenant - compte.derniereAmorce.at < DUREE_FENETRE_MS;
}

/**
 * Les heures de silence, telles qu'elles sont réglées pour les notifications :
 * une plage peut passer minuit (22 h → 7 h). Sans réglage, il n'y a pas de
 * silence du tout.
 */
export function dansLesHeuresDeSilence(heure: number, debut?: number, fin?: number): boolean {
  if (debut === undefined || fin === undefined) return false;
  return debut <= fin ? heure >= debut && heure < fin : heure >= debut || heure < fin;
}

/**
 * Combien d'échecs d'affilée sur le même compte avant de prévenir. Un refus
 * isolé arrive (jeton en cours de renouvellement) ; trois de suite veulent
 * dire que le compte ne répond plus.
 */
export const ECHECS_AVANT_ALERTE = 3;

/**
 * Faut-il prévenir maintenant ? Uniquement au franchissement du seuil : sans
 * cela, chaque passage enverrait une notification de plus.
 */
export function alerterApresEchec(echecsDAffilee: number): boolean {
  return echecsDAffilee === ECHECS_AVANT_ALERTE;
}

/**
 * Un refus 429 dit que le compte a atteint sa limite : une situation normale
 * et attendue, pas une panne. On le reconnaît sur le code que le fournisseur
 * renvoie, jamais sur un mot du message — c'est la seule marque fiable.
 */
export function estRefusDeSaturation(raison?: string): boolean {
  return !!raison && raison.includes('429');
}

/**
 * Le texte à montrer pour un échec d'amorce : le code technique du refus ne
 * parle à personne, « limite atteinte » si. Une vraie panne, elle, garde sa
 * raison telle quelle — c'est elle qu'on doit pouvoir diagnostiquer.
 */
export function texteEchecAmorce(raison: string): string {
  return estRefusDeSaturation(raison) ? 'limite atteinte' : raison;
}

/**
 * Jusqu'à quand une amorce posée maintenant couvre la fenêtre. L'heure de
 * remise à zéro annoncée fait foi ; sans elle, on compte cinq heures.
 */
export function finDeFenetre(maintenant: number, resetsAt?: number): number {
  return resetsAt && resetsAt > maintenant ? resetsAt : maintenant + DUREE_FENETRE_MS;
}

/**
 * Le modèle le moins gourmand du catalogue : une amorce ne doit coûter que
 * quelques jetons. À défaut de catalogue, on ne devine pas — l'appelant garde
 * son repli.
 */
export function modeleLePlusLeger<T extends { id: string; appetite?: string }>(models: T[]): T | undefined {
  const rang = (m: T) => (m.appetite === 'light' ? 0 : m.appetite === 'medium' ? 1 : 2);
  // Le catalogue arrive déjà classé du plus récent au plus ancien : à appétit
  // égal, le premier trouvé est donc le plus récent.
  return [...models].sort((a, b) => rang(a) - rang(b))[0];
}
