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
 * HaikoDev traduit ensuite ce niveau en moteur, modèle et réflexion RÉELS, pris
 * dans le catalogue du moteur au moment où la carte est proposée. La traduction
 * passe par l'APPÉTIT du modèle (léger / moyen / gourmand), déjà calculé par le
 * catalogue : c'est le seul repère qui survit à un renommage de modèle. À
 * défaut d'appétit annoncé, on retombe sur les familles connues, puis sur le
 * modèle par défaut du moteur — jamais sur rien.
 *
 * Aucune base, aucun disque, aucun moteur : les tests rejouent tout.
 */

import type { MoteurCatalogue, ModeleCatalogue } from './reglages-proposition.js';

/** Les trois paliers, du plus économe au plus ample. */
export type NiveauAgent = 'leger' | 'standard' | 'approfondi';

export const NIVEAUX_AGENT: NiveauAgent[] = ['leger', 'standard', 'approfondi'];

/** Le palier retenu quand le chef n'en dit rien. */
export const NIVEAU_PAR_DEFAUT: NiveauAgent = 'standard';

/**
 * Le palier affiché sur une carte de cadrage qui vient de naître, avant tout
 * échange : le plus économe, plutôt qu'un champ vide. Rien ne dit encore
 * l'ampleur du travail, mieux vaut suggérer un modèle bon marché que de ne
 * rien montrer dans le composant de saisie — l'agent de cadrage le relève dès
 * qu'il comprend qu'il faut davantage (`CONSIGNE_CADRAGE`).
 */
export const NIVEAU_PAR_DEFAUT_CADRAGE: NiveauAgent = 'leger';

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
    familles: ['opus', 'fable', 'max'],
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
  const modeles = moteur.models;
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
 * AUCUN modèle : le chef choisit une ambition, HaikoDev choisit le modèle.
 */
export const CONSIGNE_NIVEAU_AGENT =
  "LE NIVEAU DE L'AGENT QUI EXÉCUTERA LA CARTE — c'est ton second et dernier geste, tu le passes dans le champ « niveau » :\n" +
  NIVEAUX_AGENT.map((id) => `- « ${id} » (${DEFINITIONS_NIVEAU[id].label}) : ${DEFINITIONS_NIVEAU[id].quand}`).join('\n') +
  `\nDans le doute, « ${NIVEAU_PAR_DEFAUT} ». Tu ne nommes JAMAIS un modèle : HaikoDev traduit le niveau en moteur, ` +
  "modèle et réflexion réels, et l'utilisateur peut encore les changer avant de lancer la carte.";
