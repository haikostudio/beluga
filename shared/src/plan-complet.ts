/**
 * UN PLAN, C'EST QUATRE PARTIES — sinon ce n'est pas un plan.
 *
 * Le mode plan demandait déjà, en toutes lettres, que CHAQUE itération rende
 * les quatre parties en entier (§ `TRI_MODE_PLAN`, `server/src/runtime.ts`).
 * La consigne n'était pourtant qu'une consigne : rien ne regardait le texte
 * rendu. Une relance formulée en QUESTION (« quelle amélioration proposes-tu
 * pour ce mécanisme ? ») recevait donc une réponse ordinaire — trois pistes et
 * « dites-moi laquelle intégrer au plan » — que le démon habillait quand même
 * en « Plan proposé · version 3 », boutons « Valider » / « Refuser » compris.
 * L'utilisateur perdait le plan qu'il avait, et le bouton portait sur un
 * fragment.
 *
 * D'où cette règle, sans base ni disque, donc rejouable seule : un texte n'est
 * un plan que s'il ANNONCE ses quatre parties. On ne juge pas la qualité du
 * contenu — seulement la présence des quatre INTITULÉS, là où un plan les met :
 * en titre, en gras, ou en tête de ligne suivie de deux points.
 *
 * Le jugement sert deux fois côté démon :
 *   — un texte incomplet ne porte plus le drapeau `plan` (donc ni cadre, ni
 *     boutons de décision) ;
 *   — quand un plan attendait une décision, le chef est RELANCÉ une fois pour
 *     rendre la version suivante en entier.
 */

import { aplatiCompact as aplati } from './mots.js';

/** Les quatre parties, dans l'ordre où un plan les écrit. */
export interface PartieDePlan {
  /** Le nom affiché quand la partie manque. */
  nom: string;
  /**
   * Les intitulés acceptés, déjà sans accent ni majuscule. Le premier est le
   * nom canonique ; les autres sont les tournures qu'un moteur emploie
   * naturellement pour la même partie.
   */
  intitules: string[];
}

export const PARTIES_DU_PLAN: PartieDePlan[] = [
  { nom: 'Faisabilité', intitules: ['faisabilite', 'est-ce faisable', 'est-ce possible'] },
  {
    nom: 'Chemin à suivre',
    intitules: ['chemin a suivre', 'chemin propose', 'chemin', 'les etapes', 'etapes', 'demarche'],
  },
  { nom: 'Conséquences', intitules: ['consequences', 'ce que cela change', 'ce que ca change'] },
  {
    nom: 'Améliorations apportées',
    intitules: [
      'ameliorations apportees',
      'ameliorations',
      'ce que vous y gagnez',
      'ce que l utilisateur y gagne',
      'gains',
    ],
  },
];

/**
 * L'OUVERTURE « EN CLAIR » — posée AVANT la liste des tâches.
 *
 * Le plan disait ce qui serait mis en place, mais jamais d'emblée ce que ça
 * représenterait : l'utilisateur, qui ne programme pas, lisait une liste de
 * tâches sans savoir à quoi elle mènerait (demande du 26.09.2026). Chaque plan
 * s'ouvre donc sur quelques paragraphes illustratifs, adressés à lui : ce qui
 * sera fait, comment ça fonctionnera une fois en place, à quoi ça servira.
 * Comme les tâches et les décisions, c'est un bloc d'en-tête, pas l'une des
 * quatre parties : un plan d'avant ce bloc reste conforme.
 */
export const BLOC_EN_CLAIR: PartieDePlan = {
  nom: 'En clair',
  intitules: ['en clair', 'ce que ca va representer', 'ce que ce plan va faire'],
};

/** Le fond minimal de l'ouverture « En clair » : quelques phrases, pas une ligne. */
export const SIGNES_MINIMUM_EN_CLAIR = 200;

/**
 * LE PREMIER BLOC DU PLAN — la LISTE DES TÂCHES.
 *
 * Un plan s'ouvrait sur une phrase de résumé en italique : jolie, mais sans
 * matière. Il s'ouvre désormais sur l'énumération de ce qu'il y a à réaliser,
 * chaque point avec sa description détaillée. Ce bloc n'est PAS une cinquième
 * partie du gabarit — les quatre parties restent les quatre parties : c'est un
 * en-tête, rangé avant elles (`rangerLePlan`, `plan-gabarit.ts`).
 */
export const BLOC_DES_TACHES: PartieDePlan = {
  nom: 'Liste des tâches',
  intitules: ['liste des taches', 'liste de taches', 'taches a realiser', 'ce qu il y a a faire'],
};

/**
 * LE DEUXIÈME BLOC — les DÉCISIONS DES ITÉRATIONS.
 *
 * Chaque version du plan est GLOBALE : elle reprend la précédente et tous les
 * échanges de la carte. Ce bloc dit, ligne par ligne, ce qui a été décidé,
 * changé ou abandonné, et quand — c'est lui qui garde la trace d'un point
 * retiré. Comme la liste des tâches, il n'est PAS une partie du gabarit : un
 * plan enregistré avant lui reste conforme. Ses intitulés sont précis exprès :
 * une tâche en gras nommée « Décisions de design » ne doit pas l'ouvrir.
 */
export const BLOC_DES_DECISIONS: PartieDePlan = {
  nom: 'Décisions des itérations',
  intitules: ['decisions des iterations', 'decisions des versions', 'decisions prises au fil des iterations'],
};

/**
 * Les INTITULÉS d'un texte : ce qui, ligne par ligne, se présente comme le
 * titre d'une partie — un titre Markdown, une ligne toute en gras, ou un début
 * de ligne suivi de deux points. Une même notion citée en pleine phrase ne
 * compte pas : un plan qui dit « les conséquences seront faibles » au fil d'un
 * paragraphe n'a pas pour autant une partie « Conséquences ».
 */
export function intitulesDuTexte(texte: string): string[] {
  const intitules: string[] = [];
  for (const ligne of texte.split('\n')) intitules.push(...intitulesDeLaLigne(ligne));
  return intitules;
}

/** Les intitulés portés par UNE ligne — la brique de `intitulesDuTexte`. */
function intitulesDeLaLigne(ligne: string): string[] {
  const nue = ligne.trim();
  if (!nue) return [];
  // « ## 2. Chemin à suivre », « **Chemin à suivre.** », « - CHEMIN À SUIVRE : … »
  const sansPuce = nue.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s*/, '');
  const gras = sansPuce.match(/^\*\*(.+?)\*\*/);
  const avantDeuxPoints = sansPuce.match(/^([^:]{1,60}):/);
  const candidats = [gras?.[1], avantDeuxPoints?.[1], /^#{1,6}\s/.test(nue) ? sansPuce : undefined];
  const trouves: string[] = [];
  for (const candidat of candidats) {
    if (!candidat) continue;
    const plat = aplati(candidat.replace(/^\d+[.)]\s*/, ''));
    if (plat && plat.length <= 60) trouves.push(plat);
  }
  return trouves;
}

/** Ce que vaut un texte rendu en mode plan. */
export interface JugementDePlan {
  /** Les quatre parties sont-elles annoncées ? */
  complet: boolean;
  /** Les noms des parties absentes, dans l'ordre du plan. */
  manquantes: string[];
}

/**
 * CE TEXTE EST-IL UN PLAN ENTIER ? On cherche les quatre intitulés parmi les
 * titres du texte, jamais dans sa prose.
 */
export function jugerLePlan(texte: string): JugementDePlan {
  const intitules = intitulesDuTexte(texte ?? '');
  const manquantes = PARTIES_DU_PLAN.filter(
    (partie) => !partie.intitules.some((attendu) => intitules.some((vu) => vu.includes(attendu))),
  ).map((partie) => partie.nom);
  return { complet: manquantes.length === 0, manquantes };
}
