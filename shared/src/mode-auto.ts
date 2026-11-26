/*
 * LE MODE « AUTO » D'UNE CARTE (carte « Services homogènes et centrés », 14/11/2026). Un interrupteur dans les réglages
 * de la carte, éteint à la naissance, jamais retenu pour les cartes suivantes. Allumé :
 *  - chaque QUESTION de l'agent (cadrage ou tâche) reçoit AUSSITÔT la réponse conseillée — celle que l'agent marque
 *    « (recommandé) », sinon le premier choix ; une question ouverte reçoit une consigne qui laisse l'agent décider ;
 *  - la compréhension prête et la file vide, le travail SE LANCE (`lancement-automatique.ts`) ;
 *  - un message écrit pendant le travail repart au cadrage (DEC-245), qui répond seul et relance ;
 *  - un travail rendu INACHEVÉ (l'agent le déclare par `bilan_du_travail`) est relancé AU PLUS DEUX FOIS, puis la carte
 *    s'arrête et le dit.
 * Rien ne se publie, ne se paie ni ne part chez un client par Auto : ces gestes restent des clics.
 *
 * Ici, seulement les règles pures — sans base ni disque — testées dans `server/src/test/mode-auto.test.ts`.
 */

/** Le plafond des relances d'un travail rendu inachevé, par carte, avant l'arrêt. */
export const RELANCES_AUTO_MAX = 2;

/** La réponse d'Auto à une question ouverte (sans choix) : l'agent tranche lui-même et l'écrit comme décidé. */
export const REPONSE_AUTO_OUVERTE =
  "Mode Auto : personne ne répondra à cette question. Décide toi-même au mieux, d'après ce que tu sais du projet, écris ton choix comme décidé, et continue.";

/** Une option marquée « (recommandé) » (ou « recommandée », « conseillé ») par l'agent. */
export function optionRecommandee(libelle: string): boolean {
  return /\((?:recommand|conseill)[ée]e?s?\)/i.test(libelle) || /\b(?:recommand|conseill)[ée]e?s?\s*$/i.test(libelle.trim());
}

/** Ce qu'Auto lit d'une question : son genre et les libellés de ses choix. */
export interface QuestionPourAuto {
  kind?: 'single' | 'multiple' | 'text';
  options?: readonly { label: string }[];
}

/**
 * LA RÉPONSE CONSEILLÉE, dans la forme exacte d'un clic (le libellé du choix ; plusieurs libellés séparés par « , »
 * pour un choix multiple, comme `texteDeReponse`). Une question sans choix reçoit la consigne d'Auto.
 */
export function reponseConseillee(question: QuestionPourAuto): string {
  const options = question.options ?? [];
  if (!options.length || question.kind === 'text') return REPONSE_AUTO_OUVERTE;
  const recommandees = options.filter((o) => optionRecommandee(o.label));
  if (question.kind === 'multiple') return (recommandees.length ? recommandees : [options[0]!]).map((o) => o.label).join(', ');
  return (recommandees[0] ?? options[0]!).label;
}

/**
 * LES QUESTIONS QU'AUTO NE TRANCHE JAMAIS : celles qui engagent une dépense, un envoi ou un geste qu'un clic humain
 * doit valider (bouton à prix, publication, réponse à un client, branchement d'un service, choix d'une version…).
 * Elles portent un champ particulier ; une question ordinaire de `ask_user` n'en a aucun.
 */
export const CHAMPS_HORS_AUTO = [
  'gesteAValider',
  /* Un geste important que l'agent fera lui-même : seul le « Valider » de la personne le fait partir. */
  'validation',
  'devis',
  'depenseDuFil',
  'relaiDe',
  'accord',
  /* Une commande du terminal ou une suppression sur un ordinateur : seul le propriétaire tranche, jamais Auto. */
  'accordOrdinateur',
  'veille',
  'placeDuMedia',
  'choixDeVersion',
  'branchement',
  'formulaire',
  'lumiere',
  'etudeMarketing',
  'competence',
] as const;

export function questionPourAuto(question: Record<string, unknown> & { answer?: unknown; cancelled?: unknown }): boolean {
  if (question.answer || question.cancelled) return false;
  return CHAMPS_HORS_AUTO.every((champ) => question[champ] === undefined || question[champ] === null);
}

/** Ce que l'agent déclare de son travail, en fin de tour, en mode Auto (`bilan_du_travail`). */
export interface BilanDuTravail {
  abouti: boolean;
  restes: readonly string[];
  /** L'instant du bilan : seul celui du tour qui vient de finir compte. */
  at: number;
}

export type SuiteDuBilan =
  | { geste: 'rien' }
  | { geste: 'relancer'; consigne: string; relance: number }
  | { geste: 'arreter'; raison: string };

/**
 * LA SUITE D'UN TOUR DE TRAVAIL EN MODE AUTO. Aucun bilan de ce tour, ou un bilan abouti sans reste : rien (la carte
 * suit son cours, « À déployer »). Inachevé : relancer sur ce qui reste, tant que les relances déjà faites restent sous
 * le plafond ; au-delà, s'arrêter en disant ce qui reste.
 */
export function suiteDuBilan(bilan: BilanDuTravail | null | undefined, debutDuTour: number, relancesFaites: number): SuiteDuBilan {
  if (!bilan || bilan.at < debutDuTour) return { geste: 'rien' };
  const restes = bilan.restes.map((r) => r.trim()).filter(Boolean);
  if (bilan.abouti && !restes.length) return { geste: 'rien' };
  const liste = restes.length ? restes : ['le travail n’est pas abouti'];
  if (relancesFaites >= RELANCES_AUTO_MAX) {
    return { geste: 'arreter', raison: `Auto arrêté après ${RELANCES_AUTO_MAX} relances. Il reste : ${liste.join(' ; ')}.` };
  }
  return {
    geste: 'relancer',
    relance: relancesFaites + 1,
    consigne:
      `MODE AUTO — RELANCE ${relancesFaites + 1} SUR ${RELANCES_AUTO_MAX}. Ton bilan dit que le travail n'est pas fini. ` +
      `Termine maintenant, dans la même copie et sur la même branche, ce qui reste :\n- ${liste.join('\n- ')}\n` +
      'Vérifie ce que tu changes, enregistre et sauvegarde, puis rappelle « bilan_du_travail » avant ta réponse finale.',
  };
}

/*
 * EN AUTO, TOUT SE FAIT DANS LA MÊME CARTE (carte « Icônes, contrastes et artefacts », 15/11/2026, décision de
 * l'utilisateur). Auto répondait aux questions mais pas aux propositions de carte : la « Remise à plat des services »
 * a gardé deux suites d'étapes en suspens — et le cadre orange — alors que son travail les couvrait. Désormais, pour
 * l'agent d'une carte en Auto (cadrage ou tâche) :
 *  - une carte (ou une suite) proposée POUR LE MÊME PROJET est refusée : le travail se fait dans la carte ;
 *  - une carte proposée pour UN AUTRE PROJET y naît d'office, sans clic, elle-même en Auto : elle se cadre et part
 *    seule (l'interrupteur Auto vaut consentement, exception nommée à MEM-0354) ;
 *  - une carte qui est ELLE-MÊME née ainsi n'en crée pas d'autre d'office (une seule génération : aucune boucle entre
 *    deux projets) — sa proposition attend un clic, comme d'ordinaire.
 * Rien ne se publie par Auto.
 */
export type IssueDePropositionEnAuto = 'ordinaire' | 'refus-meme-projet' | 'creation-d-office';

export function issueDePropositionEnAuto(contexte: {
  /** La carte de l'agent qui propose est en Auto. */
  carteEnAuto: boolean;
  projetDeLaCarte: string;
  projetDAccueil: string;
  /** La carte de l'agent est elle-même née d'une création d'office par Auto. */
  carteNeeDAuto: boolean;
}): IssueDePropositionEnAuto {
  if (!contexte.carteEnAuto) return 'ordinaire';
  if (contexte.projetDAccueil === contexte.projetDeLaCarte) return 'refus-meme-projet';
  if (contexte.carteNeeDAuto) return 'ordinaire';
  return 'creation-d-office';
}

/** Le refus rendu à l'agent : il doit CONTINUER le travail ici, pas s'arrêter. */
export const REFUS_AUTO_MEME_PROJET =
  'Mode Auto : tout se fait dans cette carte — ni carte à part ni suite d’étapes pour ce projet. Fais ce travail toi-même, ici, dans ce tour, puis continue.';
