/**
 * LE NIVEAU DE L'AGENT QUI EXÉCUTERA LA CARTE.
 *
 * Le chef d'orchestre ne fait plus que deux choses : rédiger une carte courte,
 * et dire à quel NIVEAU elle doit être exécutée. Il ne choisit donc plus un
 * identifiant de modèle — un modèle se renomme, disparaît, change de famille —
 * mais une ambition de travail :
 *
 *   - léger      : un geste simple, cerné, sans étude préalable ;
 *   - standard   : le travail ordinaire d'une carte ;
 *   - approfondi : un chantier qui demande de comprendre avant d'écrire.
 *
 * Beluga Build traduit ce niveau en moteur, modèle et réflexion RÉELS DANS UN
 * SEUL CAS : une carte qui n'a aucun modèle. Dès qu'une carte en porte un, il
 * est intangible — c'est celui que l'utilisateur voit en haut de la discussion,
 * et plus rien ne le réécrit (règle posée le 02/09/2026, après que des cartes
 * réglées sur Opus se soient relancées sur Haiku). La traduction passe par
 * l'APPÉTIT du modèle (léger / moyen / gourmand), déjà calculé par le
 * catalogue : c'est le seul repère qui survit à un renommage de modèle. À
 * défaut d'appétit annoncé, on retombe sur les familles connues, puis sur le
 * modèle par défaut du moteur — jamais sur rien.
 *
 * Aucune base, aucun disque, aucun moteur : les tests rejouent tout.
 */

import { modeleBanni, sansModelesBannis } from './modele-banni.js';
import type { MoteurCatalogue, ModeleCatalogue } from './reglages-proposition.js';

/** Les trois paliers, du plus économe au plus ample. */
export type NiveauAgent = 'leger' | 'standard' | 'approfondi';

export const NIVEAUX_AGENT: NiveauAgent[] = ['leger', 'standard', 'approfondi'];

/** Le palier retenu quand le chef n'en dit rien. */
export const NIVEAU_PAR_DEFAUT: NiveauAgent = 'standard';

/**
 * LE PALIER D'UNE CARTE LANCÉE DEPUIS SON PLAN : toujours « Approfondi ». Le
 * sélecteur de niveau sous le plan a été retiré — un plan validé a déjà été lu
 * et discuté, il part au palier le plus ample. N'affecte PAS
 * `NIVEAU_PAR_DEFAUT` (propositions, ordonnanceur, consigne des agents).
 */
export const NIVEAU_DU_PLAN: NiveauAgent = 'approfondi';

export interface DefinitionNiveau {
  id: NiveauAgent;
  /** Ce qui s'affiche à l'écran. */
  label: string;
  /** Quand le choisir — texte donné au chef, mot pour mot. */
  quand: string;
  /** L'appétit du modèle visé, tel que le catalogue le classe. */
  appetit: 'light' | 'medium' | 'heavy';
  /** Les familles de modèles visées, de la préférée à la dernière. */
  familles: string[];
  /** La réflexion visée, ramenée ensuite à ce que le modèle propose vraiment. */
  reflexion: string;
}

export const DEFINITIONS_NIVEAU: Record<NiveauAgent, DefinitionNiveau> = {
  leger: {
    id: 'leger',
    label: 'Léger',
    quand:
      "un geste simple et cerné : une faute, un libellé, une valeur, un réglage, une commande à lancer — rien à comprendre avant d'écrire.",
    appetit: 'light',
    familles: ['haiku', 'mini', 'flash'],
    reflexion: 'none',
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    quand:
      "le travail ordinaire d'une carte : une fonctionnalité, une correction, une retouche d'interface, quelques fichiers à lire puis à modifier.",
    appetit: 'medium',
    familles: ['sonnet', 'codex', 'gpt'],
    reflexion: 'medium',
  },
  approfondi: {
    id: 'approfondi',
    label: 'Approfondi',
    quand:
      'un chantier : une règle du moteur à déplacer, une architecture à revoir, un défaut que personne ne sait expliquer, plusieurs parties du projet à tenir ensemble.',
    appetit: 'heavy',
    familles: ['opus', 'max'],
    reflexion: 'high',
  },
};

/**
 * Le niveau demandé, quel que soit le mot employé. Un modèle écrit « léger »,
 * « leger », « light » ou « LEGER » : la carte ne doit pas repartir en standard
 * pour un accent. Rend `undefined` quand rien de reconnaissable n'est dit.
 */
export function niveauDemande(valeur: unknown): NiveauAgent | undefined {
  if (typeof valeur !== 'string') return undefined;
  const mot = valeur
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!mot) return undefined;
  if (/^(leger|light|simple|rapide)$/.test(mot)) return 'leger';
  if (/^(standard|normal|moyen|medium)$/.test(mot)) return 'standard';
  if (/^(approfondi|profond|complexe|lourd|heavy|deep)$/.test(mot)) return 'approfondi';
  return undefined;
}

/** Le modèle le plus proche du palier, dans le catalogue RÉEL du moteur. */
function modeleDuNiveau(moteur: MoteurCatalogue, niveau: NiveauAgent): ModeleCatalogue | undefined {
  const def = DEFINITIONS_NIVEAU[niveau];
  // Un catalogue venu d'ailleurs (essai, cache) peut encore porter un banni.
  const modeles = sansModelesBannis(moteur.models);
  if (!modeles.length) return undefined;

  // 1. L'appétit annoncé par le catalogue : le seul repère qui survit à un
  //    modèle renommé. La liste arrive déjà du plus récent au plus ancien.
  const parAppetit = modeles.find((m) => m.appetite === def.appetit);
  if (parAppetit) return parAppetit;

  // 2. À défaut, une famille connue, dans l'ordre de préférence du palier.
  for (const famille of def.familles) {
    const trouve = modeles.find(
      (m) => m.id.toLowerCase().includes(famille) || (m.label ?? '').toLowerCase().includes(famille),
    );
    if (trouve) return trouve;
  }

  // 3. Sinon le modèle par défaut du moteur : un palier ne rend jamais rien.
  return modeles.find((m) => m.id === moteur.defaultModel) ?? modeles[0];
}

/** La réflexion retenue doit exister pour le modèle retenu. */
function reflexionDuModele(modele: ModeleCatalogue | undefined, voulue: string): string {
  const niveaux = modele?.thinking.map((t) => t.id) ?? [];
  if (!niveaux.length) return 'none';
  if (niveaux.includes(voulue)) return voulue;
  if (modele?.defaultThinking && niveaux.includes(modele.defaultThinking)) return modele.defaultThinking;
  return niveaux[0];
}

/**
 * La traduction d'un palier en réglages réels, pour UN moteur donné. Le moteur,
 * lui, ne vient jamais du palier : il reste celui de la conversation.
 */
export function reglagesDuNiveau(
  moteur: MoteurCatalogue,
  niveau: NiveauAgent,
): { model: string | undefined; thinking: string } {
  const modele = modeleDuNiveau(moteur, niveau);
  return {
    model: modele?.id,
    thinking: reflexionDuModele(modele, DEFINITIONS_NIVEAU[niveau].reflexion),
  };
}

/**
 * La consigne donnée au chef : les trois paliers et quand les choisir. Elle est
 * UNIQUE — les deux moteurs reçoivent mot pour mot le même texte — et ne nomme
 * AUCUN modèle : le chef choisit une ambition, Beluga Build choisit le modèle.
 */
export const CONSIGNE_NIVEAU_AGENT =
  "LE NIVEAU DE L'AGENT QUI EXÉCUTERA LA CARTE — c'est ton second et dernier geste, tu le passes dans le champ « niveau » :\n" +
  NIVEAUX_AGENT.map((id) => `- « ${id} » (${DEFINITIONS_NIVEAU[id].label}) : ${DEFINITIONS_NIVEAU[id].quand}`).join('\n') +
  `\nDans le doute, « ${NIVEAU_PAR_DEFAUT} ». Tu ne nommes JAMAIS un modèle. Le niveau est une AMBITION, notée sur la ` +
  "carte : il ne choisit le moteur et le modèle que d'une carte qui n'en a AUCUN. Une carte qui porte déjà un modèle " +
  "garde le sien — celui affiché en haut de la discussion — et l'utilisateur reste seul à en changer.";

/* ------------------------------------------------------------------ */
/* LE PLANCHER ET LE PLAFOND DES CARTES POSÉES SANS CLIC                */
/* ------------------------------------------------------------------ */

/**
 * UNE CARTE CRÉÉE PAR LE SYSTÈME NE PART JAMAIS AU PALIER LE PLUS FAIBLE.
 *
 * La carte de nuit fd54689b portait le palier « léger » choisi par l'agent
 * d'analyse : son cadrage a tourné sur Haiku et n'a jamais rendu sa
 * compréhension. Personne n'était là pour corriger le réglage : une carte posée
 * sans clic part donc au moins en « standard ». Un palier plus ample est gardé.
 */
export const NIVEAU_PLANCHER_AUTOMATIQUE: NiveauAgent = 'standard';

/**
 * ...NI AU PALIER LE PLUS CHER. Symétrique du plancher : une carte posée sans
 * clic n'a personne pour remarquer qu'elle vient de partir sur le modèle le
 * plus coûteux du moteur (appétit « heavy » — opus, max…). Avec trois
 * paliers seulement, planchonner ET plafonner sur « standard » revient à fixer
 * les cartes automatiques sur l'appétit moyen, quel que soit le palier annoncé
 * par l'agent qui les a proposées.
 */
export const NIVEAU_PLAFOND_AUTOMATIQUE: NiveauAgent = 'standard';

export function niveauPlancherAutomatique(niveau: NiveauAgent | undefined): NiveauAgent {
  if (!niveau) return NIVEAU_PLANCHER_AUTOMATIQUE;
  const indice = Math.min(
    Math.max(NIVEAUX_AGENT.indexOf(niveau), NIVEAUX_AGENT.indexOf(NIVEAU_PLANCHER_AUTOMATIQUE)),
    NIVEAUX_AGENT.indexOf(NIVEAU_PLAFOND_AUTOMATIQUE),
  );
  return NIVEAUX_AGENT[indice];
}

/** Ramène un niveau sous un plafond : jamais plus ample que lui. */
export function plafonnerLeNiveau(niveau: NiveauAgent, plafond: NiveauAgent): NiveauAgent {
  return NIVEAUX_AGENT[Math.min(NIVEAUX_AGENT.indexOf(niveau), NIVEAUX_AGENT.indexOf(plafond))];
}

/** Le modèle est-il du palier le plus faible ? Appétit d'abord, familles à défaut. */
export function modeleDuPalierLeger(moteur: MoteurCatalogue | undefined, modele: string | undefined): boolean {
  if (!modele) return false;
  const connu = moteur?.models.find((m) => m.id === modele);
  if (connu?.appetite) return connu.appetite === DEFINITIONS_NIVEAU.leger.appetit;
  const nom = `${modele} ${connu?.label ?? ''}`.toLowerCase();
  return DEFINITIONS_NIVEAU.leger.familles.some((famille) => nom.includes(famille));
}

/**
 * Le modèle est-il du palier le plus cher (appétit « heavy » : opus, max…) ?
 * Même lecture que `modeleDuPalierLeger`, à l'autre bout de l'échelle — c'est
 * elle qui interdit au plafond automatique de laisser passer le modèle le plus
 * coûteux du moteur. Un modèle BANNI (Fable, hors catalogue) reste reconnu
 * comme lourd : il n'est plus une famille du palier, mais il coûte toujours.
 */
export function modeleDuPalierLourd(moteur: MoteurCatalogue | undefined, modele: string | undefined): boolean {
  if (!modele) return false;
  const connu = moteur?.models.find((m) => m.id === modele);
  if (connu?.appetite) return connu.appetite === DEFINITIONS_NIVEAU.approfondi.appetit;
  if (modeleBanni(modele)) return true;
  const nom = `${modele} ${connu?.label ?? ''}`.toLowerCase();
  return DEFINITIONS_NIVEAU.approfondi.familles.some((famille) => nom.includes(famille));
}

/**
 * Le réglage d'une carte posée sans clic, ramené entre le plancher et le
 * plafond. S'applique AVANT la création : une fois posé sur la carte, un
 * modèle n'est plus réécrit (DEC-048). Un modèle du palier léger — ou AUCUN
 * modèle, qui laisserait le cadrage reprendre le dernier choisi à l'écran,
 * peut-être léger — est relevé au plancher ; un modèle du palier le plus cher
 * (jamais choisi pour une carte que personne n'a validée) est ramené au
 * plafond ; un modèle intermédiaire est gardé tel quel.
 */
export function runPlancherAutomatique<
  R extends { engine?: string; model?: string; thinking?: string; niveau?: NiveauAgent },
>(run: R | undefined, catalogue: MoteurCatalogue[]): R | undefined {
  if (!run) return run;
  const niveau = niveauPlancherAutomatique(run.niveau);
  const moteur = catalogue.find((m) => m.id === run.engine);
  const trop =
    run.niveau === 'leger' ||
    run.niveau === 'approfondi' ||
    !run.model ||
    modeleDuPalierLeger(moteur, run.model) ||
    modeleDuPalierLourd(moteur, run.model);
  if (!trop) return run.niveau ? run : { ...run, niveau };
  if (!moteur) return { ...run, model: undefined, niveau };
  const reglages = reglagesDuNiveau(moteur, niveau);
  return { ...run, model: reglages.model, thinking: reglages.thinking, niveau } as R;
}
