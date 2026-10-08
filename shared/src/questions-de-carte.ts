/**
 * LES QUESTIONS GARDÉES SUR LA CARTE — CE QUI REMPLACE LES SUPPOSITIONS.
 *
 * Décision de l'utilisateur du 06/10/2026 : « je dois plus voir de suppositions
 * du tout, je dois avoir les questions qui sont posées ». Le dernier trou était
 * le cadrage SANS TÉMOIN (la nuit, la carte posée par un agent, le site tombé) :
 * on lui interdit `ask_user` — il attendrait dans un registre en mémoire,
 * plafonné, qui ne survit ni à une nuit ni à un redémarrage —, donc il écrivait
 * « Je suppose que… ».
 *
 * Il PRÉPARE désormais ses questions (champ `questions` de
 * `rendre_comprehension`), avec leurs choix et la réponse qu'il conseille.
 * Elles attendent SUR LA CARTE (`ComprehensionDeCarte.questionsEnAttente`) ;
 * l'écran les pose une par une ; la carte ne se lance pas tant qu'une reste
 * sans réponse ; la dernière réponse relance le cadrage, qui réécrit la
 * compréhension avec ces décisions.
 *
 * Règles pures : aucune base, aucun moteur.
 */
import type { QuestionEnAttenteDeCarte } from './models.js';

/** Ce qu'une compréhension doit porter pour qu'on lise ses questions. */
type PorteDesQuestions = { questionsEnAttente?: readonly QuestionEnAttenteDeCarte[] } | null | undefined;

/** Au plus autant de questions préparées par un seul cadrage. */
export const QUESTIONS_DE_CARTE_MAX = 8;

/** Les questions encore sans réponse, dans leur ordre. */
export function questionsSansReponse(comprise: PorteDesQuestions): QuestionEnAttenteDeCarte[] {
  return (comprise?.questionsEnAttente ?? []).filter((question) => !question.reponse?.trim());
}

/**
 * LA QUESTION À AFFICHER MAINTENANT : la première sans réponse. Une seule à la
 * fois (DEC-286) — la suivante paraît dès que celle-ci est tranchée.
 */
export function prochaineQuestionDeCarte(comprise: PorteDesQuestions): QuestionEnAttenteDeCarte | undefined {
  return questionsSansReponse(comprise)[0];
}

/** La raison qui éteint le lancement tant qu'une question attend : DITE sous le bouton. */
export const RAISON_QUESTIONS_DE_CARTE = 'Répondez d’abord aux questions que l’agent a laissées sur la carte.';

/**
 * ÉCRIRE UNE RÉPONSE. Rend la nouvelle liste, ou `undefined` quand la question
 * n'existe pas (écran en retard sur une compréhension réécrite) ou qu'elle a
 * déjà sa réponse (double clic, deux appareils).
 */
export function repondreALaQuestionDeCarte(
  comprise: PorteDesQuestions,
  questionId: string,
  reponse: string,
  at: number = Date.now(),
): QuestionEnAttenteDeCarte[] | undefined {
  const liste = comprise?.questionsEnAttente ?? [];
  const visee = liste.find((question) => question.id === questionId);
  const texte = reponse.trim();
  if (!visee || visee.reponse?.trim() || !texte) return undefined;
  return liste.map((question) => (question.id === questionId ? { ...question, reponse: texte, reponduA: at } : question));
}

/** Les libellés des deux choix d'une supposition convertie. */
export const OUI_SUPPOSITION = 'Oui, c’est bien ça';
export const NON_SUPPOSITION = 'Non, je précise';

/**
 * UNE SUPPOSITION D'AVANT DEVIENT UNE QUESTION, SANS AGENT. « Je suppose que
 * la liste se trie par date » devient « La liste se trie par date ? », avec
 * « Oui, c'est bien ça » conseillé et « Non, je précise » (le texte libre reste
 * ouvert à côté). Sert à la conversion des cartes déjà cadrées et au filet d'un
 * appel hors tour vivant : aucune supposition ne s'enregistre plus.
 */
export function questionDepuisSupposition(texte: string, index: number): QuestionEnAttenteDeCarte {
  const sansPrefixe = texte
    .trim()
    .replace(/^(je suppose|on suppose|hypoth[èe]se)\s*(qu['’]|que\s+|:)?\s*/i, '')
    .replace(/[.\s]+$/, '');
  const phrase = sansPrefixe ? sansPrefixe[0].toUpperCase() + sansPrefixe.slice(1) : texte.trim();
  return {
    id: `s${index + 1}`,
    question: `${phrase} ?`,
    description: 'L’agent l’avait supposé sans pouvoir vous le demander. Confirmez, ou précisez ce que vous voulez.',
    kind: 'single',
    options: [
      { id: 'o0', label: OUI_SUPPOSITION },
      { id: 'o1', label: NON_SUPPOSITION },
    ],
    recommandee: OUI_SUPPOSITION,
  };
}

/**
 * CONVERTIR LES SUPPOSITIONS D'UNE COMPRÉHENSION. Celles que l'utilisateur
 * avait déjà VALIDÉES d'un clic arrivent répondues (« Oui, c'est bien ça ») :
 * elles comptent comme ses décisions. Rend la compréhension convertie, ou
 * `null` quand il n'y avait rien à convertir.
 */
export function convertirLesSuppositions<
  T extends {
    hypotheses?: readonly string[];
    questionsOuvertes?: readonly string[];
    hypothesesValidees?: readonly string[];
    questionsEnAttente?: readonly QuestionEnAttenteDeCarte[];
  },
>(comprise: T, at: number = Date.now()): T | null {
  const lignes = comprise.hypotheses?.length ? comprise.hypotheses : (comprise.questionsOuvertes ?? []);
  if (!lignes.length) return null;
  const validees = new Set(comprise.hypothesesValidees ?? []);
  const deja = comprise.questionsEnAttente ?? [];
  const converties = lignes.map((ligne, index) => {
    const question = questionDepuisSupposition(ligne, deja.length + index);
    return validees.has(ligne) ? { ...question, reponse: OUI_SUPPOSITION, reponduA: at } : question;
  });
  return {
    ...comprise,
    hypotheses: [],
    questionsOuvertes: undefined,
    hypothesesValidees: undefined,
    questionsEnAttente: [...deja, ...converties],
  };
}

/** Les questions tranchées, en « question → réponse », une par ligne. */
export function lignesDesReponses(comprise: PorteDesQuestions): string[] {
  return (comprise?.questionsEnAttente ?? [])
    .filter((question) => question.reponse?.trim())
    .map((question) => `- ${question.question} → ${question.reponse!.trim()}`);
}

/**
 * LA DEMANDE DU TOUR DE REPRISE, envoyée au cadrage quand la DERNIÈRE question
 * a sa réponse. L'utilisateur vient d'être devant l'écran : ce tour a le droit
 * de questionner (`ask_user`) — la demande ne porte donc AUCUN des marqueurs du
 * cadrage sans témoin, et ne doit jamais les citer.
 */
export function demandeDeRepriseApresLesReponses(comprise: PorteDesQuestions): string {
  return [
    'L’UTILISATEUR A RÉPONDU AUX QUESTIONS QUE TU AVAIS LAISSÉES SUR CETTE CARTE. Chaque réponse est SA DÉCISION :',
    ...lignesDesReponses(comprise),
    '',
    'Reprends ta dernière compréhension EN ENTIER et réécris-la avec ces décisions, écrites comme DÉCIDÉES — plus comme des questions ni comme des suppositions. ' +
      'Si une réponse ouvre un point nouveau que tu ne peux ni vérifier ni trancher, pose-le avec « ask_user » : l’utilisateur est là. ' +
      'Puis rends la compréhension avec « rendre_comprehension », « hypotheses » et « questions » vides. N’appelle pas « rendre_plan ». ' +
      'Ta réponse en texte tient en une phrase.',
  ].join('\n');
}
