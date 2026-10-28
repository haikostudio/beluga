/**
 * LE JUGE RAPIDE — les règles pures, sans réseau ni base.
 *
 * Le juge rend des JUGEMENTS TYPÉS sur un état qu'on lui donne, en une
 * fraction de seconde. C'est Jev, le modèle de décision de TypeSafe, appelé
 * par une API distante : aucune mémoire prise sur cette machine, une clé rangée
 * au coffre-fort, quelques jetons facturés par jugement. Il ne tient pas de
 * conversation, n'écrit pas de code et ne peut exécuter aucune carte : ce n'est
 * donc PAS un quatrième moteur (`server/src/engines/`, contrat
 * `EngineAdapter`) — c'est un chemin SÉPARÉ, sans rapport avec le catalogue des
 * moteurs ni avec les quotas.
 *
 * Trois primitives, et trois seulement :
 *  - NOUL   : une question fermée, rendue comme une probabilité de « oui ».
 *  - CHOICE : un choix dans une liste, avec sa distribution et sa confiance.
 *  - SCORE  : une position sur une échelle décrite niveau par niveau.
 *
 * Ce fichier porte ce qui se décide sans réseau : la forme des questions et des
 * réponses, la lecture de ce que Jev rend, les seuils, la liste des usages et
 * leurs interrupteurs, et la NOTE PAR RÈGLES de la jauge quand Jev ne répond
 * pas. L'appel, ses garde-fous et la trace vivent dans
 * `server/src/jugement-rapide.ts`.
 *
 * Laya, le modèle local qui l'avait remplacé (1,8 Go de mémoire vive, jamais
 * endormi en journée, 693 échecs pour 317 réponses sur la jauge), a été retiré
 * le 28/10/2026 : Jev répondait 251 fois sur 251 en 0,8 s.
 *
 * INVARIANT : chaque jugement est CONSULTATIF. Il propose et signale ; il ne
 * supprime, ne refuse et ne lance jamais rien. Un service éteint, lent, en
 * panne, qui refuse la clé ou reste peu sûr de lui rend `undefined`, et
 * l'appelant retombe sur le comportement d'avant. UNE SEULE EXCEPTION, bornée :
 * une carte proposée par l'agent d'ANALYSE (personne n'a discuté avec lui) est
 * rendue à réécrire quand elle double une carte ouverte (`doublon-carte`). Un
 * geste humain — et la proposition d'une conversation — n'est jamais refusé.
 */

/** L'unique point d'entrée de l'API. */
export const ENDPOINT_JUGE = 'https://api.typesafe.ai/v1/systemone';

/** Le modèle appelé. `jev-latest` suit la dernière version publiée. */
export const MODELE_JUGE = 'jev-latest';

/**
 * LE DÉLAI D'ATTENTE PAR DÉFAUT. La latence mesurée tourne autour de 0,2 à
 * 0,8 s ; 4 s laissent une marge large sans qu'aucun chemin de l'application
 * n'attende visiblement ce service. Un usage sur le chemin d'un tour porte un
 * délai plus court (`REGLAGES_DES_USAGES`).
 */
export const DELAI_JUGE_MS = 4000;

/** Le délai d'un usage sur le chemin d'un tour : un conseil ne retarde pas un agent. */
export const DELAI_JUGE_EXPRESS_MS = 2500;

/** Une seule reprise, et seulement sur un à-coup (réseau, 429 ou 5xx). */
export const REPRISES_JUGE = 1;

/**
 * LE SEUIL DE CONFIANCE PAR DÉFAUT. La confiance lue est celle que Jev rend
 * pour un choix ou une note, et la probabilité de la réponse retenue pour un
 * oui/non : 0,5 est le hasard sur un oui/non ou sur deux choix. Chaque usage
 * peut porter le sien (`REGLAGES_DES_USAGES`).
 */
export const SEUIL_JUGE = 0.6;

/* ------------------------------------------------------------------ */
/* LES TROIS USAGES, ET LEUR INTERRUPTEUR                              */
/* ------------------------------------------------------------------ */

/*
 * LE JUGE N'ÉCRIT PLUS UNE SEULE PHRASE À L'ÉCRAN.
 *
 * Quatre usages écrivaient un message : « description trop mince » au-dessus du
 * lancement, l'effort proposé, « ce plan sonne creux », « compte rendu en
 * décalage ». Les 156 jugements réellement rendus les ont condamnés : 56 des 95
 * avertissements d'avant-lancement portaient sur une description VIDE (le champ,
 * pas la demande — la demande vivait dans le fil), 3 alertes seulement sur les
 * 39 cas où la description existait, et zéro alerte sur 20 plans comme sur 18
 * comptes rendus. L'effort proposé tombait sur « léger » 19 fois sur 23, avec
 * une confiance à peine au-dessus du hasard.
 *
 * Ce qui les remplace : UN SEUL SIGNAL, MUET, sur ce qui compte vraiment — la
 * COMPRÉHENSION rendue par l'agent de cadrage, c'est-à-dire le dossier réel que
 * recevra celui qui exécutera. Il se lit sur un indicateur en trois barres posé
 * dans la barre d'écriture, et il ne bloque jamais le lancement.
 *
 * Les deux usages restants n'écrivent rien à l'écran non plus : l'un ORDONNE
 * les propositions de la nuit, l'autre pose une étiquette d'urgence sur une
 * carte arrivée sans l'utilisateur.
 */
export const USAGES_JUGE = [
  'comprehension-carte',
  'tri-propositions',
  'urgence-demande',
  'evaluation-creation',
  'genre-carte-auto',
  'famille-erreur',
  'niveau-carte',
  'nature-demande',
  'doublon-carte',
  'pertinence-competences',
  'pertinence-memoire',
  'pertinence-analyses-marketing',
] as const;

export type UsageDuJuge = (typeof USAGES_JUGE)[number];

export interface FicheDUsage {
  cle: UsageDuJuge;
  titre: string;
  /** Ce que l'usage fait, en mots courants — c'est ce que l'écran affiche. */
  explication: string;
  /**
   * ALLUMÉ SANS QUE PERSONNE N'Y TOUCHE ? Un usage qui DÉCIDE ou qui ÉCRIT
   * quelque chose de visible ne l'est que si sa PREUVE CHIFFRÉE passe
   * (MEM-3232) : il répond sur au moins la moitié des cas, et il a raison neuf
   * fois sur dix. Aucune mesure ne l'a encore prouvé (la dernière, du
   * 25.09.2026, portait sur un modèle local depuis retiré) : ils naissent donc
   * éteints, et l'écran du juge les rallume.
   *
   * Trois usages restent allumés : ils ne décident de rien et n'écrivent aucun
   * mot. La note de compréhension nourrit une jauge qui doit être notée à
   * chaque échange (MEM-3393) — et qui l'est par des règles quand Jev ne
   * répond pas (`comprehensionParRegles`) ; le tri des idées de la nuit et le
   * départage du mode Création ne font qu'ordonner ou conseiller, et n'ont
   * aucune vérité en base contre laquelle se mesurer.
   *
   * Un quatrième l'est sur demande expresse de l'utilisateur (28/10/2026) : la
   * pertinence des analyses Marketing pose une mention « peu pertinent » sous
   * un curseur, sans rien retirer, réordonner ni chiffrer.
   */
  parDefaut: boolean;
}

export const FICHES_DES_USAGES: readonly FicheDUsage[] = [
  {
    cle: 'comprehension-carte',
    titre: 'Compréhension suffisante',
    explication:
      'Note ce que l’agent a compris de votre demande — son texte, ses hypothèses et les détails techniques préparés. Se lit sur l’indicateur à trois barres de la barre d’écriture ; le lancement reste toujours possible.',
    parDefaut: true,
  },
  {
    cle: 'tri-propositions',
    titre: 'Tri des idées de la nuit',
    explication:
      'Note l’intérêt et l’ampleur de chaque proposition de l’analyse de nuit, et remonte les plus rentables. Rien n’est supprimé.',
    parDefaut: true,
  },
  {
    cle: 'urgence-demande',
    titre: 'Urgence d’une demande entrante',
    explication:
      'Note l’urgence d’une demande arrivée sans passer par vous (panne détectée, demande extérieure), pour ordonner ce qui est traité en premier.',
    parDefaut: false,
  },
  {
    cle: 'evaluation-creation',
    titre: 'Évaluation du mode Création',
    explication:
      'Départage les propositions rendues par les différents modèles quand le mode Création est allumé sur une carte. Son choix reste un conseil : l’agent garde le dernier mot.',
    parDefaut: true,
  },
  {
    cle: 'genre-carte-auto',
    titre: 'Moteur des cartes automatiques',
    explication:
      'Pour une carte proposée par l’analyse automatique, dit si c’est de la programmation ou de l’administratif, pour choisir le modèle qui l’exécutera. Un réglage posé à la main n’est jamais touché.',
    parDefaut: false,
  },
  {
    cle: 'famille-erreur',
    titre: 'Erreurs expliquées simplement',
    explication:
      'Quand une erreur technique inconnue arrive, dit si elle vient de l’extérieur (réseau, service distant) ou d’un défaut de l’application, pour afficher une phrase compréhensible.',
    parDefaut: false,
  },
  {
    cle: 'niveau-carte',
    titre: 'Niveau proposé d’une carte',
    explication:
      'Propose un niveau (léger, standard, approfondi) à l’agent qui prépare une carte. Ce n’est qu’une suggestion : un niveau déjà choisi n’est jamais changé.',
    parDefaut: false,
  },
  {
    cle: 'nature-demande',
    titre: 'Question ou travail',
    explication:
      'Au début d’une discussion, indique à l’agent si votre message ressemble à une simple question ou à un travail à préparer. L’agent garde la décision.',
    parDefaut: false,
  },
  {
    cle: 'doublon-carte',
    titre: 'Cartes en double',
    explication:
      'Avant qu’une analyse automatique propose une carte, vérifie qu’une carte ouverte ne fait pas déjà le même travail. Une carte que vous créez vous-même n’est jamais bloquée.',
    parDefaut: false,
  },
  {
    cle: 'pertinence-competences',
    titre: 'Modes d’emploi utiles',
    explication:
      'Ne montre à l’agent que les modes d’emploi qui concernent sa carte, au lieu de toute la liste : moins de lecture inutile, donc moins de quota consommé.',
    parDefaut: false,
  },
  {
    cle: 'pertinence-memoire',
    titre: 'Mémoire triée pour la demande',
    explication:
      'Écarte des recherches dans la mémoire du projet les fiches sans rapport avec la demande. Les règles vitales passent toujours.',
    parDefaut: false,
  },
  {
    /* Allumé d'office : il ne décide rien (rien n'est retiré, réordonné ni
       chiffré) et l'utilisateur l'a demandé le 28/10/2026. */
    cle: 'pertinence-analyses-marketing',
    titre: 'Analyses Marketing peu pertinentes',
    explication:
      'Après un pré-diagnostic Marketing, pose plusieurs questions précises sur chaque analyse possible et signale sous son curseur celles qui servent peu ce client. Rien n’est retiré : vous décidez.',
    parDefaut: true,
  },
];

/**
 * UN USAGE EST-IL ALLUMÉ ? Un geste explicite l'emporte : éteint à la main il
 * dort, allumé à la main il juge. Sans geste, c'est sa fiche qui décide
 * (`parDefaut`, posé d'après la preuve chiffrée).
 */
export function usageAllume(
  usage: UsageDuJuge,
  eteints: readonly string[] | undefined,
  allumes: readonly string[] = [],
): boolean {
  if ((eteints ?? []).includes(usage)) return false;
  if (allumes.includes(usage)) return true;
  return FICHES_DES_USAGES.find((fiche) => fiche.cle === usage)?.parDefaut ?? false;
}

/** Bascule un usage dans la liste des éteints, sans jamais en écrire deux fois. */
export function basculerUsage(
  usage: UsageDuJuge,
  allume: boolean,
  eteints: readonly string[] | undefined,
): string[] {
  const liste = new Set(eteints ?? []);
  if (allume) liste.delete(usage);
  else liste.add(usage);
  return [...liste].filter((cle) => (USAGES_JUGE as readonly string[]).includes(cle));
}

/** Le pendant pour les usages éteints par défaut : la liste de ceux allumés à la main. */
export function basculerUsageAllume(
  usage: UsageDuJuge,
  allume: boolean,
  allumes: readonly string[] | undefined,
): string[] {
  const liste = new Set(allumes ?? []);
  if (allume) liste.add(usage);
  else liste.delete(usage);
  return [...liste].filter((cle) => (USAGES_JUGE as readonly string[]).includes(cle));
}

/* ------------------------------------------------------------------ */
/* LA FORME DES QUESTIONS ET DES RÉPONSES                              */
/* ------------------------------------------------------------------ */

export type QuestionDuJuge =
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type ReponseDuJuge =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: 'score';
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

/* ------------------------------------------------------------------ */
/* LA CLÉ : elle vit au coffre-fort, jamais dans un fichier du dépôt   */
/* ------------------------------------------------------------------ */

/** Ce qu'une fiche du coffre montre d'elle-même, vu d'ici. */
export interface FicheDAcces {
  id: string;
  nom: string;
  type: string;
  champs: Record<string, string>;
}

/**
 * LA PRÉSENCE D'UNE FICHE AU COFFRE EST L'INTERRUPTEUR GÉNÉRAL. Pas de clé
 * rangée = le juge est éteint, et RIEN ne part vers le service.
 *
 * Une fiche compte si c'est une clé d'API dont le service — ou, à défaut, le
 * nom — nomme TypeSafe, et dont la valeur n'est pas vide.
 */
export function ficheDuJuge(acces: readonly FicheDAcces[] | undefined): FicheDAcces | undefined {
  const nomme = (texte: string | undefined) => (texte ?? '').toLowerCase().includes('typesafe');
  return (acces ?? []).find(
    (fiche) =>
      fiche.type === 'cle-api' &&
      (nomme(fiche.champs?.service) || nomme(fiche.nom)) &&
      Boolean((fiche.champs?.cle ?? '').trim()),
  );
}

/** La clé rangée, ou rien. */
export function cleDuJuge(acces: readonly FicheDAcces[] | undefined): string | undefined {
  return ficheDuJuge(acces)?.champs?.cle?.trim() || undefined;
}

/**
 * L'ADRESSE DU SERVICE, LUE SUR LA FICHE DU COFFRE. Le point d'entrée public
 * (`ENDPOINT_JUGE`) est le défaut ; une fiche qui porte une autre adresse la
 * fait gagner — c'est ainsi que les tests et `scripts/verif-jugement-rapide.mjs`
 * visent un faux serveur local, sans jamais appeler le service réel.
 */
export function adresseDuJuge(acces: readonly FicheDAcces[] | undefined): string {
  return ficheDuJuge(acces)?.champs?.adresse?.trim() || ENDPOINT_JUGE;
}

/* ------------------------------------------------------------------ */
/* CE QUI PART, ET CE QUI REVIENT                                      */
/* ------------------------------------------------------------------ */

export interface DemandeAuJuge {
  state: unknown;
  model: string;
  questions: Record<string, QuestionDuJuge>;
}

/** Le corps envoyé au service : toutes les questions d'un jugement, en un appel. */
export function construireLaDemande(etat: unknown, questions: Record<string, QuestionDuJuge>): DemandeAuJuge {
  return { state: etat, model: MODELE_JUGE, questions };
}

export interface LectureDuJuge {
  modele: string;
  reponses: Record<string, ReponseDuJuge>;
  jetonsEntree: number;
  jetonsSortie: number;
}

/**
 * LIT LA RÉPONSE DU SERVICE. Une réponse mal formée n'est pas une exception :
 * elle rend `undefined`, et l'appelant retombe sur son comportement d'avant.
 * Seule la FORME est lue ici ; le seuil et la liste offerte se jugent ensuite,
 * question par question (`reponseRetenue`).
 */
export function lireLaReponse(brut: unknown): LectureDuJuge | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const corps = brut as Record<string, unknown>;
  const reponses = corps.answers;
  if (!reponses || typeof reponses !== 'object') return undefined;
  const usage = (corps.usage ?? {}) as Record<string, unknown>;
  const propres: Record<string, ReponseDuJuge> = {};
  for (const [cle, valeur] of Object.entries(reponses as Record<string, unknown>)) {
    if (!valeur || typeof valeur !== 'object') continue;
    const reponse = valeur as Record<string, unknown>;
    const confiance = typeof reponse.confidence === 'number' ? reponse.confidence : 0;
    if (reponse.type === 'noul' && typeof reponse.noul === 'number') {
      propres[cle] = { type: 'noul', noul: reponse.noul };
    } else if (reponse.type === 'choice' && typeof reponse.choice === 'string') {
      propres[cle] = {
        type: 'choice',
        choice: reponse.choice,
        probabilities: (reponse.probabilities as Record<string, number>) ?? {},
        confidence: confiance,
      };
    } else if (reponse.type === 'score' && typeof reponse.score === 'number' && Number.isFinite(reponse.score)) {
      propres[cle] = {
        type: 'score',
        score: reponse.score,
        legend: (reponse.legend as Record<string, string>) ?? {},
        probabilities: (reponse.probabilities as Record<string, number>) ?? {},
        confidence: confiance,
      };
    }
  }
  if (!Object.keys(propres).length) return undefined;
  return {
    modele: typeof corps.model === 'string' ? corps.model : MODELE_JUGE,
    reponses: propres,
    jetonsEntree: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    jetonsSortie: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
  };
}

/** La confiance d'une réponse : celle que Jev rend, ou la probabilité du côté retenu d'un oui/non. */
export function confianceDeLaReponse(reponse: ReponseDuJuge | undefined): number {
  if (!reponse) return 0;
  if (reponse.type === 'noul') return Math.max(reponse.noul, 1 - reponse.noul);
  return reponse.confidence;
}

/**
 * UNE RÉPONSE QU'ON PEUT SUIVRE, OU RIEN.
 *
 * Rien n'est rendu quand Jev a répondu d'un autre genre que la question,
 * choisi hors de la liste offerte, ou reste sous le seuil : l'appelant retombe
 * sur son comportement d'avant. Une note est ramenée dans son échelle plutôt
 * que jetée (Jev rend une ESPÉRANCE, 1,62 entre deux niveaux : chaque lecteur
 * arrondit).
 */
export function reponseRetenue(
  question: QuestionDuJuge,
  reponse: ReponseDuJuge | undefined,
  seuil = SEUIL_JUGE,
): ReponseDuJuge | undefined {
  if (!reponse || reponse.type !== question.type) return undefined;
  if (confianceDeLaReponse(reponse) < seuil) return undefined;
  if (reponse.type === 'choice') {
    const criteres = (question as { criteria?: Record<string, string | null> }).criteria ?? {};
    return reponse.choice in criteres ? reponse : undefined;
  }
  if (reponse.type === 'score') {
    const max = Math.max(0, ((question as { criteria?: string[] }).criteria?.length ?? 1) - 1);
    return { ...reponse, score: Math.min(max, Math.max(0, reponse.score)) };
  }
  return reponse;
}

/* ------------------------------------------------------------------ */
/* LE TEST DE LA CLÉ                                                   */
/* ------------------------------------------------------------------ */

/** Les réponses possibles du bouton « tester », et rien d'autre. */
export type EtatDeLaCle = 'acceptee' | 'refusee' | 'injoignable' | 'absente';

/** Un code HTTP se lit en état de clé : 401/403 = refusée, 2xx = acceptée. */
export function etatDepuisLeCode(code: number): EtatDeLaCle {
  if (code === 401 || code === 403) return 'refusee';
  if (code >= 200 && code < 300) return 'acceptee';
  return 'injoignable';
}

/** Une panne passagère (réseau, 5xx, 429) mérite la seule reprise permise. */
export function meriteUneReprise(code: number | undefined): boolean {
  if (code === undefined) return true;
  return code === 429 || code >= 500;
}

/* ------------------------------------------------------------------ */
/* CE QU'ON ENVOIE : de quoi juger, jamais le projet entier            */
/* ------------------------------------------------------------------ */

/** Le plafond, en signes, de chaque morceau de contexte envoyé. */
export const PLAFOND_ETAT = 4000;

/** Coupe proprement un texte trop long, en le disant. */
export function tronquer(texte: string | undefined, plafond = PLAFOND_ETAT): string {
  const propre = (texte ?? '').trim();
  if (propre.length <= plafond) return propre;
  return `${propre.slice(0, plafond)}\n… (coupé : ${propre.length - plafond} signes de plus)`;
}

/* ------------------------------------------------------------------ */
/* LES TROIS QUESTIONS, ET LA LECTURE DE LEUR VERDICT                  */
/* ------------------------------------------------------------------ */

/**
 * LES SEUILS. Ils décident quand un signal s'ALLUME — jamais ce qui est permis.
 * Ils sont volontairement prudents : un signal qui s'allume souvent à tort finit
 * ignoré, et un signal ignoré est pire qu'aucun signal.
 */
export const SEUILS = {
  /**
   * LA CONFIANCE MINIMALE POUR MONTRER UNE NOTE DE COMPRÉHENSION. Sur trois
   * niveaux, le hasard pur donne 0,33 : en dessous de ce palier, le juge ne
   * sait pas, et un indicateur tiré au sort vaut moins que pas d'indicateur du
   * tout. C'est la leçon de l'effort proposé, qui affichait « léger » 19 fois
   * sur 23 avec une confiance à peine au-dessus du hasard.
   */
  confianceDeLaComprehension: 0.4,
  /** Au-dessus, une demande entrante est jugée pressante. */
  demandeUrgente: 0.6,
} as const;

/* ------------------------------------------------------------------ */
/* LA COMPRÉHENSION : LA SEULE CHOSE QUE LE JUGE NOTE ENCORE           */
/* ------------------------------------------------------------------ */

/**
 * LES TROIS NIVEAUX DE L'INDICATEUR, dans l'ordre du score rendu (0, 1, 2).
 * Ils deviennent 1, 2 ou 3 barres à l'écran — une barre rouge, deux jaune,
 * trois vert.
 */
export const NIVEAUX_DE_COMPREHENSION = [
  'Un agent partirait dans le vide : ce qui est compris ne dit ni ce qu’il faut obtenir, ni où, ni à quoi le reconnaître.',
  'Exploitable, mais des zones floues demeurent : l’agent devra deviner une partie du travail ou de ses limites.',
  'Le dossier suffit à lancer le travail : l’objectif, le résultat attendu et les contraintes y sont.',
] as const;

/**
 * LES MOTIFS DU MANQUE — UNE LISTE FERMÉE, JAMAIS DU TEXTE LIBRE.
 *
 * Le juge ne rend que trois primitives (`noul`, `choice`, `score`) : aucune
 * phrase. La phrase affichée au survol de l'indicateur se compose donc ICI, à
 * partir du motif choisi, ce qui la rend aussi traduisible dans les cinq
 * langues — une phrase inventée par le modèle ne le serait pas.
 */
export const MOTIFS_DE_COMPREHENSION = {
  'objectif-flou': 'L’objectif n’est pas délimité : on ne sait pas jusqu’où va le travail.',
  'resultat-non-dit': 'Le résultat attendu n’est pas dit : rien ne permettra de reconnaître que c’est fait.',
  'contraintes-absentes': 'Les contraintes techniques manquent : l’agent devra les deviner en chemin.',
  'hypotheses-trop-nombreuses': 'Trop de points sont assumés sans réponse : une bonne part du travail repose sur des suppositions.',
  'discussion-naissante': 'La discussion commence : l’agent n’a pas encore rendu ce qu’il a compris.',
  'rien-ne-manque': 'Rien ne manque : le dossier suffit à lancer le travail.',
} as const;

export type MotifDeComprehension = keyof typeof MOTIFS_DE_COMPREHENSION;

/** La phrase du survol, composée localement — le juge n'en écrit aucune. */
export function phraseDuMotif(motif: string | undefined): string {
  return (
    MOTIFS_DE_COMPREHENSION[motif as MotifDeComprehension] ??
    'Le dossier transmis a été relu automatiquement ; rien de précis n’est ressorti.'
  );
}

/**
 * « OÙ EN EST CETTE DISCUSSION, POUR UN TRAVAIL ABOUTI ? »
 *
 * Deux questions d'un seul appel : une NOTE sur trois niveaux décrits un par
 * un, et le MOTIF du manque dans une liste fermée. Le jugement porte sur la
 * DISCUSSION ENTIÈRE — la demande, les questions tranchées, puis le dossier
 * réel transmis à celui qui exécutera — et plus seulement sur une compréhension
 * déjà rendue : la jauge se remplit à mesure que l'échange avance.
 *
 * DES REPÈRES ÉCRITS, PAS À DEVINER. L'ancien juge (Needle 3) routait sans
 * inférer (MEM-3232) ; Jev infère, mais un repère écrit reste plus sûr qu'une
 * déduction. Chaque niveau et chaque motif est
 * donc décrit par des REPÈRES qu'il trouve ÉCRITS en tête du dossier
 * (`reperesDuDossier`) : « Compréhension rendue : non », « Risques identifiés :
 * oui »… Il n'a plus qu'à rapprocher deux textes, ce qu'il sait faire.
 */
export function questionComprehension(): Record<string, QuestionDuJuge> {
  return {
    score: {
      type: 'score',
      instructions:
        'D’après les repères écrits en tête du dossier, où en est cette discussion pour lancer un travail abouti ?',
      criteria: [
        `Compréhension rendue : non. ${NIVEAUX_DE_COMPREHENSION[0]}`,
        `Compréhension rendue : oui, mais étapes découpées : 0 ou risques identifiés : non. ${NIVEAUX_DE_COMPREHENSION[1]}`,
        `Compréhension rendue : oui, étapes découpées et risques identifiés : oui. ${NIVEAUX_DE_COMPREHENSION[2]}`,
      ],
    },
    motif: {
      type: 'choice',
      instructions: 'D’après les repères écrits en tête du dossier, qu’est-ce qui manque le plus pour lancer le travail ?',
      criteria: {
        'objectif-flou': MOTIFS_DE_COMPREHENSION['objectif-flou'],
        'resultat-non-dit': MOTIFS_DE_COMPREHENSION['resultat-non-dit'],
        'contraintes-absentes': `Étapes découpées : 0 ou risques identifiés : non. ${MOTIFS_DE_COMPREHENSION['contraintes-absentes']}`,
        'hypotheses-trop-nombreuses': `Hypothèses assumées nombreuses, questions tranchées : 0. ${MOTIFS_DE_COMPREHENSION['hypotheses-trop-nombreuses']}`,
        'discussion-naissante': `Compréhension rendue : non. ${MOTIFS_DE_COMPREHENSION['discussion-naissante']}`,
        'rien-ne-manque': `Compréhension rendue : oui, étapes découpées, risques identifiés : oui. ${MOTIFS_DE_COMPREHENSION['rien-ne-manque']}`,
      },
    },
  };
}

/** Deux notes sur une proposition de la nuit : le gain, puis l'ampleur. */
export function questionsProposition(): Record<string, QuestionDuJuge> {
  return {
    gain: {
      type: 'score',
      instructions: 'Quel bénéfice réel cette amélioration apporterait-elle à qui se sert du produit ?',
      criteria: [
        'Aucun bénéfice perceptible : cosmétique ou interne.',
        'Bénéfice léger : un confort, remarqué de loin en loin.',
        'Bénéfice net : un agacement quotidien qui disparaît.',
        'Bénéfice majeur : une perte de temps ou un risque important supprimé.',
      ],
    },
    ampleur: {
      type: 'score',
      instructions: 'Quelle quantité de travail cette amélioration demanderait-elle ?',
      criteria: [
        'Un geste : quelques minutes.',
        'Court : une poignée de fichiers.',
        'Conséquent : plusieurs parties de l’application.',
        'Chantier : une refonte, des décisions à prendre.',
      ],
    },
  };
}

/** « Cette demande presse-t-elle vraiment ? » */
export function questionUrgence(): Record<string, QuestionDuJuge> {
  return {
    /* Formulation mesurée le 25.09.2026 : des MOTS de panne dans les
       critères, plutôt qu'une description abstraite — un juge rapide
       rapproche le vocabulaire bien mieux qu'il ne déduit. */
    urgente: {
      type: 'noul',
      instructions: 'Quelque chose est-il cassé ou bloqué en ce moment ?',
      criteria: {
        true: 'Panne, blocage, erreur, inaccessible, impossible, plante : quelque chose ne marche plus maintenant.',
        false: 'Amélioration, nouvelle fonction, texte, coût, facture : rien n’est cassé.',
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* LES VERDICTS, TELS QUE L'APPLICATION LES CONSOMME                   */
/* ------------------------------------------------------------------ */

/*
 * LA FORME RANGÉE d'un verdict vit dans `models.ts`, avec le reste de la carte
 * (`JugementPose`, `JugementsDeCarte`) : une seule définition, celle que la
 * base valide. Ici, seule la LECTURE des réponses du juge.
 */
import type { JugementDeComprehension, JugementPose } from './models.js';

/**
 * LE VERDICT SUR LA COMPRÉHENSION, PRÊT À RANGER.
 *
 * Rien n'est rendu quand le juge n'a pas répondu, quand il a répondu d'un
 * autre genre, ou quand sa CONFIANCE reste sous le palier : un indicateur tiré
 * au sort est pire que pas d'indicateur. Le motif, lui, est facultatif — une
 * note sans motif s'affiche quand même, sa phrase de survol se contente d'être
 * générale.
 */
export function verdictComprehension(
  score: ReponseDuJuge | undefined,
  motif: ReponseDuJuge | undefined,
  at: number,
): JugementDeComprehension | undefined {
  if (score?.type !== 'score') return undefined;
  if (score.confidence < SEUILS.confianceDeLaComprehension) return undefined;
  /* Le score est un INDICE dans la liste des niveaux (0, 1, 2) : les barres
     valent un de plus, et un juge qui déborde est ramené dans la fourchette
     plutôt que d'être jeté. */
  const barres = Math.min(3, Math.max(1, Math.round(score.score) + 1)) as 1 | 2 | 3;
  const nomme =
    motif?.type === 'choice' && motif.choice in MOTIFS_DE_COMPREHENSION ? motif.choice : undefined;
  return { barres, confiance: score.confidence, motif: nomme, source: 'jev', at };
}

/** Le verdict « demande pressante », prêt à ranger. */
export function verdictUrgence(reponse: ReponseDuJuge | undefined, at: number): JugementPose | undefined {
  if (reponse?.type !== 'noul') return undefined;
  return { valeur: reponse.noul, signal: reponse.noul >= SEUILS.demandeUrgente, at };
}

/**
 * LE RANG D'UNE PROPOSITION DE LA NUIT : ce qui rapporte le plus pour le moins
 * d'effort remonte. Le gain pèse double — une grosse amélioration reste devant
 * une bricole, même si elle coûte plus cher.
 *
 * Rendu sur la même échelle que les notes (0 à 3), plus haut = plus rentable.
 */
export function rangDUneProposition(gain: number, ampleur: number): number {
  return Math.round((gain * 2 - ampleur) * 1000) / 1000;
}

/** Les notes de tri, prêtes à ranger. */
export function verdictInteret(
  gain: ReponseDuJuge | undefined,
  ampleur: ReponseDuJuge | undefined,
  at: number,
): { gain: number; ampleur: number; rang: number; at: number } | undefined {
  if (gain?.type !== 'score' || ampleur?.type !== 'score') return undefined;
  return { gain: gain.score, ampleur: ampleur.score, rang: rangDUneProposition(gain.score, ampleur.score), at };
}

/**
 * TRIER DES PROPOSITIONS SANS JAMAIS EN PERDRE UNE. Celles qui portent un rang
 * passent devant, les plus rentables d'abord ; celles que le juge n'a pas vues
 * gardent leur ordre d'écriture, à la suite. Rien n'est supprimé.
 */
export function trierParInteret<T>(
  elements: readonly T[],
  rangDe: (element: T) => number | undefined,
): T[] {
  return elements
    .map((element, index) => ({ element, index, rang: rangDe(element) }))
    .sort((a, b) => {
      if (a.rang === undefined && b.rang === undefined) return a.index - b.index;
      if (a.rang === undefined) return 1;
      if (b.rang === undefined) return -1;
      if (b.rang !== a.rang) return b.rang - a.rang;
      return a.index - b.index;
    })
    .map(({ element }) => element);
}

/* ------------------------------------------------------------------ */
/* LA TRACE : de quoi juger le juge                                    */
/* ------------------------------------------------------------------ */

/** Ce qu'une ligne de trace retient d'un jugement rendu. */
export interface TraceDeJugement {
  id: number;
  usage: string;
  /** L'état et les questions envoyés, en clair. */
  question: string;
  /** La réponse brute du juge, ou le motif de l'échec. */
  reponse: string;
  /** La force du verdict (probabilité, confiance ou note), quand il y en a une. */
  confiance?: number | null;
  /** Le temps mis, en millisecondes. */
  latenceMs: number;
  /** Ce que l'application a décidé ensuite, en une phrase. */
  suite: string;
  issue: 'repondu' | 'echec';
  jetonsEntree: number;
  jetonsSortie: number;
  cardId?: string | null;
  projectId?: string | null;
  at: number;
}

/** Le bilan d'une série de traces : combien, combien de ratés, en combien de temps. */
export function bilanDesTraces(traces: readonly TraceDeJugement[]): {
  rendus: number;
  echecs: number;
  latenceMedianeMs: number;
} {
  const rendus = traces.filter((trace) => trace.issue === 'repondu');
  const latences = rendus.map((trace) => trace.latenceMs).sort((a, b) => a - b);
  const mediane = latences.length ? latences[Math.floor(latences.length / 2)] : 0;
  return {
    rendus: rendus.length,
    echecs: traces.length - rendus.length,
    latenceMedianeMs: mediane,
  };
}

/* ------------------------------------------------------------------ */
/* CE QUI S'AFFICHE, ET OÙ — les règles pures de l'écran               */
/* ------------------------------------------------------------------ */

/*
 * DEUX PLACES, ET PAS UNE DE PLUS — ET AUCUNE PHRASE ÉCRITE D'OFFICE.
 *
 *  - la COMPRÉHENSION se lit sur l'indicateur à trois barres de la barre
 *    d'écriture, à gauche du micro : une barre rouge, deux jaune, trois vert,
 *    et une phrase courte AU SURVOL seulement ;
 *  - l'URGENCE se lit en étiquette sur la carte arrivée sans l'utilisateur.
 *
 * Aucun des deux n'éteint un bouton, n'efface un texte ni ne rouvre une carte :
 * ils ne font QUE se lire. C'est la contrepartie de leur présence — un signal
 * qui bloque devient un verrou, et un verrou posé par un juge
 * optionnel n'a rien à faire sur ce chemin.
 */

/** Un avis prêt à dessiner : son ton, son titre, sa phrase. */
export interface AvisAffiche {
  cle: 'urgence';
  ton: 'attention' | 'information';
  titre: string;
  phrase: string;
  /** La force du verdict, de 0 à 1 — affichée en pourcentage au survol. */
  valeur: number;
}


/** L'avis « demande pressante », pose sur une carte arrivee du dehors. */
export function avisSurLUrgence(carte: { jugements?: { urgence?: JugementPose } }): AvisAffiche | undefined {
  const juge = carte.jugements?.urgence;
  if (!juge?.signal) return undefined;
  return {
    cle: 'urgence',
    ton: 'information',
    titre: 'Demande pressante',
    phrase: 'Quelque chose semble cassé ou bloqué en ce moment : cette demande passe devant les autres.',
    valeur: juge.valeur,
  };
}

/* ------------------------------------------------------------------ */
/* L'INDICATEUR À TROIS BARRES                                         */
/* ------------------------------------------------------------------ */

/** Les colonnes où une note de compréhension sert encore à quelque chose. */
export const COLONNES_INDICATEUR: readonly string[] = ['planned'];

/** Ce que l'indicateur affiche : un nombre de barres et sa phrase de survol. */
export interface IndicateurDeComprehension {
  /** 0 = pas encore évaluée : la jauge est là, ses trois barres éteintes. */
  barres: 0 | 1 | 2 | 3;
  /** La phrase du survol, composée depuis le motif — jamais écrite par le juge. */
  phrase: string;
  /** La confiance du juge, de 0 à 1 — dite au survol, pas affichée en gros. Absente sans note. */
  confiance?: number;
}

/** La phrase du survol d'une jauge encore vide. */
export const PHRASE_JAUGE_VIDE =
  'Pas encore évaluée : la jauge se remplit à mesure que la discussion avance.';

/**
 * L'INDICATEUR, TOUJOURS LÀ TANT QU'IL SERT.
 *
 * Il ne disparaît plus faute de note : une carte encore en cadrage montre sa
 * jauge dès l'ouverture, trois barres éteintes (`barres: 0`), puis la note de
 * Jev — ou des règles, s'il se tait — à chaque échange. Il ne s'efface qu'une fois le travail parti — une
 * note sur un dossier qu'on ne peut plus corriger n'éclaire aucune décision.
 */
export function indicateurDeComprehension(carte: {
  column: string;
  parcours?: { comprehension?: { texte: string } };
  jugements?: { comprehension?: JugementDeComprehension };
}): IndicateurDeComprehension | undefined {
  if (!COLONNES_INDICATEUR.includes(carte.column)) return undefined;
  const note = carte.jugements?.comprehension;
  if (!note) return { barres: 0, phrase: PHRASE_JAUGE_VIDE };
  return { barres: note.barres, phrase: phraseDuMotif(note.motif), confiance: note.confiance };
}

/* ------------------------------------------------------------------ */
/* CE QU'ON MONTRE AU JUGE : le dossier réel, jamais le projet entier  */
/* ------------------------------------------------------------------ */

/**
 * LE DOSSIER TRANSMIS À CELUI QUI EXÉCUTERA, mis à plat pour le juge.
 *
 * C'est le point de la correction : l'ancien avis jugeait le CHAMP
 * « description » de la carte — vide 56 fois sur 95 — alors que la demande
 * vivait dans le fil et que le vrai dossier est la COMPRÉHENSION rendue. On
 * envoie donc ce que l'agent d'exécution recevra, et rien d'autre : le texte
 * compris, les hypothèses assumées, la découpe du travail, les faits du projet
 * à respecter et ce qui risque de casser.
 */
export interface DossierAJuger {
  /** Les repères CHIFFRÉS, écrits en tête : c'est sur eux que le juge s'appuie. */
  reperes: string[];
  titre: string;
  /** Ce que l'utilisateur a écrit, du plus ancien au plus récent (les derniers seulement). */
  demandes: string[];
  /** Les questions posées par l'agent ET tranchées, « question → réponse ». */
  questions: string[];
  comprehension: string;
  hypotheses: string[];
  taches: string[];
  faits: string[];
  risques: string;
  /**
   * Hors signature et hors repères : ce que seules les RÈGLES lisent
   * (`comprehensionParRegles`). Le cahier dit-il à quoi reconnaître la
   * réussite ? Combien de questions posées attendent encore leur réponse ?
   */
  criteresDeReussite?: boolean;
  questionsOuvertes?: number;
}

/** Le nombre de lignes retenues par rubrique : de quoi juger, pas un journal. */
export const DOSSIER_MAX = { hypotheses: 20, taches: 30, faits: 30, demandes: 6, questions: 10 } as const;

/** Ce que la discussion a produit hors de la carte : les messages et les questions tranchées. */
export interface EchangesDeLaCarte {
  demandes?: readonly string[];
  questions?: readonly { question: string; reponse: string }[];
}

/**
 * LES REPÈRES DU DOSSIER, ÉCRITS EN TOUTES LETTRES.
 *
 * Ce sont les mots mêmes que portent les niveaux et les motifs de
 * `questionComprehension` : le juge les retrouve des deux côtés et n'a rien à
 * deviner. Placés EN TÊTE, ils ne sont jamais coupés par le plafond.
 */
export function reperesDuDossier(dossier: Omit<DossierAJuger, 'reperes'>): string[] {
  const rendue = !!dossier.comprehension.trim();
  return [
    `Messages de l’utilisateur : ${dossier.demandes.length}`,
    `Questions tranchées : ${dossier.questions.length}`,
    `Compréhension rendue : ${rendue ? 'oui' : 'non'}`,
    `Hypothèses assumées : ${dossier.hypotheses.length}`,
    `Étapes découpées : ${dossier.taches.length}`,
    `Faits du projet recopiés : ${dossier.faits.length}`,
    `Risques identifiés : ${dossier.risques.trim() ? 'oui' : 'non'}`,
  ];
}

export function dossierAJuger(
  carte: {
    title: string;
    parcours?: {
      comprehension?: {
        texte: string;
        hypotheses?: string[];
        partieTechnique?: {
          taches?: { titre: string; description?: string }[];
          faits?: string[];
          risques?: string;
        };
        cahierDesCharges?: { titre: string; contenu: string }[];
        questionsEnAttente?: { reponse?: string }[];
      };
    };
  },
  echanges: EchangesDeLaCarte = {},
): DossierAJuger | undefined {
  const comprise = carte.parcours?.comprehension;
  const demandes = (echanges.demandes ?? [])
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(-DOSSIER_MAX.demandes)
    .map((d) => tronquer(d, 1500));
  /* RIEN À JUGER tant que personne n'a rien dit ni rien compris. */
  if (!comprise?.texte?.trim() && !demandes.length) return undefined;
  const technique = comprise?.partieTechnique;
  const sansReperes = {
    titre: tronquer(carte.title, 300),
    demandes,
    questions: (echanges.questions ?? [])
      .filter((q) => q.reponse.trim())
      .slice(-DOSSIER_MAX.questions)
      .map((q) => tronquer(`${q.question} → ${q.reponse}`, 500)),
    comprehension: tronquer(comprise?.texte ?? ''),
    hypotheses: (comprise?.hypotheses ?? []).slice(0, DOSSIER_MAX.hypotheses).map((h) => tronquer(h, 400)),
    taches: (technique?.taches ?? [])
      .slice(0, DOSSIER_MAX.taches)
      .map((tache) => tronquer(`${tache.titre} — ${tache.description ?? ''}`.trim(), 600)),
    faits: (technique?.faits ?? []).slice(0, DOSSIER_MAX.faits).map((fait) => tronquer(fait, 400)),
    risques: tronquer(technique?.risques ?? '', 2000),
  };
  return {
    reperes: reperesDuDossier(sansReperes),
    ...sansReperes,
    criteresDeReussite: (comprise?.cahierDesCharges ?? []).some(
      (rubrique) => /r[ée]ussite|crit[èe]re|termin[ée]/i.test(rubrique.titre) && rubrique.contenu.trim().length > 0,
    ),
    questionsOuvertes: (comprise?.questionsEnAttente ?? []).filter((q) => !q.reponse?.trim()).length,
  };
}

/** Au-delà, les hypothèses assumées pèsent plus que ce qui a été tranché. */
export const HYPOTHESES_EN_TROP = 6;
/** En deçà, un texte compris sans découpe ne délimite rien. */
export const COMPREHENSION_TROP_COURTE = 160;

/**
 * LA NOTE PAR RÈGLES, QUAND JEV SE TAIT.
 *
 * La jauge ne reste jamais sans barres après une compréhension rendue : clé
 * absente, panne, délai ou confiance sous le palier, ces règles notent à la
 * place, à partir de ce que le dossier PORTE vraiment — et dans la même liste
 * fermée de motifs, pour que la phrase du survol reste traduisible. Une règle
 * se lit en entier ; la première qui s'applique décide.
 */
export function comprehensionParRegles(dossier: DossierAJuger, at: number): JugementDeComprehension {
  const note = (barres: 1 | 2 | 3, motif: MotifDeComprehension): JugementDeComprehension => ({
    barres,
    confiance: 1,
    motif,
    source: 'regles',
    at,
  });
  const texte = dossier.comprehension.trim();
  if (!texte) return note(1, 'discussion-naissante');
  if (texte.length < COMPREHENSION_TROP_COURTE && !dossier.taches.length) return note(1, 'objectif-flou');
  if ((dossier.questionsOuvertes ?? 0) > 0) return note(2, 'objectif-flou');
  if (!dossier.taches.length || !dossier.risques.trim()) return note(2, 'contraintes-absentes');
  if (dossier.hypotheses.length >= HYPOTHESES_EN_TROP && !dossier.questions.length) {
    return note(2, 'hypotheses-trop-nombreuses');
  }
  if (!dossier.criteresDeReussite) return note(2, 'resultat-non-dit');
  return note(3, 'rien-ne-manque');
}

/**
 * LA SIGNATURE D'UN DOSSIER : ce qui décide qu'on rejuge, ou non.
 *
 * Elle couvre TOUT ce qui est envoyé — demandes, questions tranchées, texte
 * compris, hypothèses, tâches, faits, risques — et RIEN de volatil : aucun
 * horodatage, aucun identifiant de tour. Un nouveau message, une réponse ou une
 * nouvelle version de la compréhension changent donc la signature et redonnent
 * une note ; un déplacement de carte, un changement d'étiquette ou l'écriture
 * du verdict lui-même n'en redemandent aucune.
 */
export function signatureDuDossier(dossier: DossierAJuger): string {
  return JSON.stringify([
    dossier.titre,
    dossier.demandes,
    dossier.questions,
    dossier.comprehension,
    dossier.hypotheses,
    dossier.taches,
    dossier.faits,
    dossier.risques,
  ]);
}

/* ------------------------------------------------------------------ */
/* LES USAGES DE PERTINENCE ET DE TRI                                  */
/* ------------------------------------------------------------------ */

/**
 * LE GENRE D'UNE CARTE AUTOMATIQUE, pour choisir son moteur (DEC-248). Les
 * clés sont celles de `GenreCarte` (`tri-automatique-moteur.ts`) : la réponse
 * se lit sans traduction.
 */
export function questionGenreDeCarte(): Record<string, QuestionDuJuge> {
  return {
    genre: {
      type: 'choice',
      instructions: 'Is this task software development or office administration?',
      criteria: {
        programmation_avancee:
          'Software development: user interface, screen, button, menu, cache, API, server, database, app, bug.',
        administratif: 'Office administration: invoice, quote, payment, client, email, meeting, contract, accountant, expenses.',
      },
    },
  };
}

/** Les trois niveaux d'une carte, décrits comme les voit un développeur qui connaît le projet. */
export const NIVEAUX_PROPOSABLES = ['leger', 'standard', 'approfondi'] as const;
export type NiveauProposable = (typeof NIVEAUX_PROPOSABLES)[number];

/** « Quel effort ? » — la même question que celle tracée par l'ancien juge payant, rejouable telle quelle. */
export function questionNiveauDeCarte(): Record<string, QuestionDuJuge> {
  return {
    niveau: {
      type: 'choice',
      instructions: 'Quel effort ce travail demande-t-il à un développeur qui connaît déjà le projet ?',
      criteria: {
        leger: 'Un geste simple : un texte, une couleur, un réglage, une correction d’une ligne.',
        standard: 'Un travail ordinaire : quelques fichiers, une règle à changer, des contrôles à rejouer.',
        approfondi: 'Un chantier : une fonctionnalité entière, plusieurs parties de l’application, des décisions à prendre.',
      },
    },
  };
}

/** Le niveau proposé, lu d'une réponse — ou rien. */
export function niveauPropose(reponse: ReponseDuJuge | undefined): NiveauProposable | undefined {
  if (reponse?.type !== 'choice') return undefined;
  return (NIVEAUX_PROPOSABLES as readonly string[]).includes(reponse.choice)
    ? (reponse.choice as NiveauProposable)
    : undefined;
}

/** « Simple question, ou travail à préparer ? » — une INDICATION pour le cadrage, jamais une décision. */
export function questionNatureDeLaDemande(): Record<string, QuestionDuJuge> {
  return {
    nature: {
      type: 'choice',
      instructions: 'Ce message demande-t-il une simple réponse, ou un travail à préparer puis exécuter ?',
      criteria: {
        question:
          'Une question : l’utilisateur veut savoir, comprendre ou avoir un avis. Rien n’est à modifier, construire ni lancer.',
        travail:
          'Un travail : l’utilisateur veut qu’on change, corrige, ajoute, construise, installe ou lance quelque chose.',
      },
    },
  };
}

/** La phrase glissée dans la demande du cadrage : une indication, dite comme telle. */
export function indicationDeNature(reponse: ReponseDuJuge | undefined): string {
  if (reponse?.type !== 'choice') return '';
  const pourcent = Math.round(reponse.confidence * 100);
  if (reponse.choice === 'question') {
    return `INDICATION DU JUGE LOCAL (${pourcent} %) : ce message ressemble à une simple QUESTION. Si c'est bien le cas, réponds-y dans le fil, sans compréhension ni carte. La décision reste la tienne.`;
  }
  if (reponse.choice === 'travail') {
    return `INDICATION DU JUGE LOCAL (${pourcent} %) : ce message ressemble à un TRAVAIL à cadrer. La décision reste la tienne.`;
  }
  return '';
}

/** « Ces deux cartes font-elles le même travail ? » */
export function questionDoublon(): Record<string, QuestionDuJuge> {
  return {
    doublon: {
      type: 'noul',
      instructions:
        'La carte PROPOSÉE demande-t-elle le même travail que la carte EXISTANTE, au point que la faire en plus serait un doublon ?',
      criteria: {
        true: 'Même travail : le même problème ou la même fonctionnalité, sur la même partie du produit.',
        false: 'Travail différent : un autre problème, une autre partie, ou une suite distincte.',
      },
    },
  };
}

/** Au-dessus, deux cartes sont jugées faire le même travail. Prudent : refuser à tort coûte une idée. */
export const SEUIL_DOUBLON = 0.85;

/** Un document candidat à la pertinence : sa clé, et ce qu'on en montre au juge. */
export interface DocumentAJuger {
  cle: string;
  texte: string;
}

/** Au plus autant de documents jugés d'un coup : chaque question prend sa place dans la fenêtre du modèle. */
export const PERTINENCE_MAX = 12;

/**
 * « CE DOCUMENT AIDE-T-IL À TRAITER CETTE DEMANDE ? » — une question oui/non
 * par document, toutes posées en UN passage sur l'état « demande ».
 */
export function questionsDePertinence(documents: readonly DocumentAJuger[]): Record<string, QuestionDuJuge> {
  const questions: Record<string, QuestionDuJuge> = {};
  documents.slice(0, PERTINENCE_MAX).forEach((doc, i) => {
    questions[`d${i}`] = {
      type: 'noul',
      instructions: `Ce document aide-t-il à traiter la demande ? Document : ${tronquer(doc.texte, 300)}`,
      criteria: {
        true: 'Oui : il parle du sujet, des fichiers ou du geste que la demande concerne.',
        false: 'Non : il parle d’autre chose.',
      },
    };
  });
  return questions;
}

/** Sous ce seuil, un document est jugé hors sujet. Bas : écarter une règle utile coûte plus qu'en lire une de trop. */
export const SEUIL_PERTINENCE = 0.3;

/**
 * LES CLÉS À GARDER. Sans réponse du juge, TOUT est gardé : le filtre ne fait
 * que retirer, jamais cacher faute d'avis. Les documents au-delà de
 * `PERTINENCE_MAX` (non jugés) sont gardés aussi.
 */
export function clesPertinentes(
  documents: readonly DocumentAJuger[],
  reponses: Record<string, ReponseDuJuge> | undefined,
  seuil = SEUIL_PERTINENCE,
): Set<string> {
  const gardees = new Set<string>();
  documents.forEach((doc, i) => {
    const reponse = reponses?.[`d${i}`];
    if (!reponses || i >= PERTINENCE_MAX || reponse?.type !== 'noul' || reponse.noul >= seuil) gardees.add(doc.cle);
  });
  return gardees;
}

/* ------------------------------------------------------------------ */
/* LA PRÉSÉLECTION DES DOUBLONS : sans modèle                          */
/* ------------------------------------------------------------------ */

/** Les mots qui portent un sens : quatre lettres et plus, sans accents ni casse. */
function motsPleins(texte: string): Set<string> {
  return new Set(
    texte
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((mot) => mot.length >= 4),
  );
}

/** Au-dessous de cette part de mots communs, deux cartes ne sont même pas comparées. */
export const RECOUVREMENT_MIN_DOUBLON = 0.2;

/**
 * LES CARTES À COMPARER, AVANT LE JUGE. Le juge compare des PAIRES : on ne lui
 * montre que les cartes ouvertes (hors « Archivé ») qui partagent assez de
 * mots avec la proposée, les plus proches d'abord, au plus `max`.
 */
export function candidatsDeDoublon<T extends { title: string; description: string; column: string }>(
  proposee: { titre: string; description: string },
  cartes: readonly T[],
  max = 3,
): T[] {
  const mots = motsPleins(`${proposee.titre} ${proposee.description}`);
  if (!mots.size) return [];
  return cartes
    .filter((carte) => carte.column !== 'archived')
    .map((carte) => {
      const autres = motsPleins(`${carte.title} ${carte.description}`);
      let communs = 0;
      for (const mot of mots) if (autres.has(mot)) communs += 1;
      const union = mots.size + autres.size - communs;
      return { carte, recouvrement: union ? communs / union : 0 };
    })
    .filter((c) => c.recouvrement >= RECOUVREMENT_MIN_DOUBLON)
    .sort((a, b) => b.recouvrement - a.recouvrement)
    .slice(0, max)
    .map((c) => c.carte);
}

/* ------------------------------------------------------------------ */
/* LE RÉGLAGE DE CHAQUE USAGE                                          */
/* ------------------------------------------------------------------ */

import { SEUIL_CONFIANCE_TRI } from './tri-automatique-moteur.js';

/**
 * LE SEUIL ET LE DÉLAI PROPRES À UN USAGE (MEM-3380).
 *
 * Le seuil commun (`SEUIL_JUGE`, 0,6) vaut pour ce qui DÉCIDE (un moteur, une
 * famille d'erreur). La note de compréhension et le départage du mode Création
 * ne décident de rien — ils allument des barres ou conseillent — et portent le
 * palier de la compréhension (0,4, au-dessus du hasard sur trois niveaux).
 *
 * Le délai court (`DELAI_JUGE_EXPRESS_MS`) tient les usages posés sur le
 * chemin d'un tour : un conseil ne retarde jamais un agent.
 */
export interface ReglageDUsage {
  seuil?: number;
  delaiMs?: number;
  partiel?: boolean;
}

export const REGLAGES_DES_USAGES: Partial<Record<UsageDuJuge, ReglageDUsage>> = {
  'comprehension-carte': { seuil: SEUILS.confianceDeLaComprehension },
  'evaluation-creation': { seuil: SEUILS.confianceDeLaComprehension },
  'tri-propositions': { seuil: SEUILS.confianceDeLaComprehension },
  'urgence-demande': { seuil: 0.5 },
  'genre-carte-auto': { seuil: SEUIL_CONFIANCE_TRI },
  /* Une explication d'erreur ne retient pas une réponse : la phrase honnête
     « erreur inattendue » part si Jev traîne. */
  'famille-erreur': { seuil: SEUIL_CONFIANCE_TRI, delaiMs: DELAI_JUGE_EXPRESS_MS },
  /* Suggéré pendant un appel d'outil du cadrage. */
  'niveau-carte': { seuil: 0.5, delaiMs: DELAI_JUGE_EXPRESS_MS },
  'nature-demande': { seuil: 0.6, delaiMs: DELAI_JUGE_EXPRESS_MS },
  'doublon-carte': { seuil: 0.5, partiel: true },
  /* Un oui/non incertain (probabilité entre 0,4 et 0,6) reste sans réponse,
     donc GARDÉ : seul un « non » franc écarte un document. */
  'pertinence-competences': { seuil: 0.6, delaiMs: DELAI_JUGE_EXPRESS_MS, partiel: true },
  'pertinence-memoire': { seuil: 0.6, delaiMs: DELAI_JUGE_EXPRESS_MS, partiel: true },
  /* Hors du chemin d'un tour (après un pré-diagnostic) : le délai normal. Seul
     un « oui » ou un « non » franc compte ; les incertains restent muets. */
  'pertinence-analyses-marketing': { seuil: 0.7, partiel: true },
};
