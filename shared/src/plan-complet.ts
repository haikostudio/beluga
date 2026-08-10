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

/**
 * L'ÉTAPE VISIBLE dans la conversation quand le démon rattrape un plan
 * incomplet : l'utilisateur voit pourquoi sa réponse a été refaite.
 */
export const ETAPE_PLAN = 'Plan rendu en entier';
export const ETAPE_PLAN_ID = 'plan-entier';

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

/** Minuscules, sans accent, espaces normalisés : deux écritures d'un même mot se rejoignent. */
function aplati(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Les INTITULÉS d'un texte : ce qui, ligne par ligne, se présente comme le
 * titre d'une partie — un titre Markdown, une ligne toute en gras, ou un début
 * de ligne suivi de deux points. Une même notion citée en pleine phrase ne
 * compte pas : un plan qui dit « les conséquences seront faibles » au fil d'un
 * paragraphe n'a pas pour autant une partie « Conséquences ».
 */
export function intitulesDuTexte(texte: string): string[] {
  const intitules: string[] = [];
  for (const ligne of texte.split('\n')) {
    const nue = ligne.trim();
    if (!nue) continue;
    // « ## 2. Chemin à suivre », « **Chemin à suivre.** », « - CHEMIN À SUIVRE : … »
    const sansPuce = nue.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s*/, '');
    const gras = sansPuce.match(/^\*\*(.+?)\*\*/);
    const avantDeuxPoints = sansPuce.match(/^([^:]{1,60}):/);
    const candidats = [gras?.[1], avantDeuxPoints?.[1], /^#{1,6}\s/.test(nue) ? sansPuce : undefined];
    for (const candidat of candidats) {
      if (!candidat) continue;
      const plat = aplati(candidat.replace(/^\d+[.)]\s*/, ''));
      if (plat && plat.length <= 60) intitules.push(plat);
    }
  }
  return intitules;
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

/**
 * LA RELANCE, quand le chef a répondu à côté du plan.
 *
 * Elle est envoyée dans la MÊME session : le chef a donc encore sous les yeux
 * la demande et sa propre réponse. On lui redit le seul point qu'il a manqué —
 * ce qu'il vient d'écrire n'est pas une réponse à part, c'est la matière de la
 * version suivante — et on nomme les parties absentes pour qu'il n'ait rien à
 * deviner.
 */
export function consigneDePlanEntier(numeroAttendu: number, manquantes: string[]): string {
  return [
    `TA RÉPONSE N'EST PAS UN PLAN ENTIER : il y manque ${manquantes.join(', ')}.`,
    `En mode plan, une réponse ne remplace JAMAIS le plan — elle DEVIENT la version suivante.`,
    `Reprends donc la version précédente, intègre ce que tu viens d'écrire, et rends la VERSION ${numeroAttendu}`,
    `EN ENTIER : FAISABILITÉ, CHEMIN À SUIVRE, CONSÉQUENCES, AMÉLIORATIONS APPORTÉES, chacune sous son titre.`,
    `Si tu as un choix à soumettre, pose-le APRÈS les quatre parties, en une ligne — jamais à leur place.`,
    `Réponds uniquement par le plan, sans préambule et sans t'excuser.`,
  ].join('\n');
}
