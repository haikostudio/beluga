import { PLAFOND_PASSAGES_JETONS, type PassageClasse, type PassageDoc } from './passages-doc.js';
import { rappelDeLAmont } from './memoire-en-arbre.js';

/**
 * LA RECHERCHE NE S'ARRÊTE PLUS AU PREMIER TOUR.
 *
 * Jusqu'ici, la mémoire du projet n'était fouillée qu'au LANCEMENT d'une session
 * — la demande de la carte servant de question. Tous les messages suivants d'une
 * même conversation ne cherchaient plus rien : l'agent était censé avoir déjà la
 * mémoire dans son contexte. La bulle « Mémoire du projet retrouvée » n'avait
 * donc, dès le deuxième message, plus rien à montrer qu'un rappel générique
 * (« reprise de session, la mémoire a déjà été transmise »), qui ne dit RIEN de
 * la question qu'on vient de poser.
 *
 * Or une conversation change de sujet. La deuxième question porte souvent sur
 * une règle que la première n'avait aucune raison de remonter. On cherche donc à
 * CHAQUE demande, sur le texte réellement tapé, et ce qu'on trouve part au
 * moteur comme au premier tour.
 *
 * Deux garde-fous, sans quoi ce serait un péage à chaque message :
 *
 *  1. UN PASSAGE DÉJÀ SERVI DANS CETTE SESSION NE REPART PAS. L'agent l'a sous
 *     les yeux — le renvoyer ne lui apprend rien et se paie à chaque tour.
 *  2. UN PLAFOND PLUS BAS QU'AU LANCEMENT. Le premier tour remplace l'index de
 *     toute la mémoire, il peut donc se permettre sa place ; un tour de suite
 *     n'a rien à remplacer, il AJOUTE — il reste léger.
 *
 * Ces règles sont pures : elles se testent sans base ni disque.
 */

/**
 * CE QU'UN TOUR DE SUITE A LE DROIT D'AJOUTER, en jetons.
 *
 * Plus bas que le plafond du lancement (`PLAFOND_PASSAGES_JETONS`) : au premier
 * tour, les passages PRENNENT LA PLACE de l'index de la mémoire, donc ils
 * économisent ; ici ils s'ajoutent à un contexte déjà rempli. Un tiers de la
 * place, c'est de quoi porter deux ou trois règles précises — ce qu'une question
 * de suite appelle réellement — sans grossir chaque message.
 */
export const PLAFOND_PASSAGES_SUITE_JETONS = Math.round(PLAFOND_PASSAGES_JETONS / 3);

/**
 * COMBIEN DE PASSAGES AU PLUS sur un tour de suite. Trois : au-delà, on ne
 * répond plus à une question, on recharge la documentation.
 */
export const PASSAGES_SUITE_MAX = 3;

/**
 * DE COMBIEN LE SEUIL DE PERTINENCE MONTE sur un tour de suite.
 *
 * Au lancement, un passage à peu près pertinent vaut mieux que rien : l'agent
 * ne connaît pas encore le projet. En cours de conversation, il le connaît — un
 * passage qui ne fait que croiser la question par hasard n'ajoute que du bruit,
 * et se paie à chaque message. On relève donc la barre.
 *
 * C'est un ÉCART, pas un nombre absolu : les deux modes de recherche (le sens
 * réel, les mots exacts) n'ont pas la même échelle de score, et fixer une valeur
 * unique reviendrait à être laxiste dans l'un et impitoyable dans l'autre.
 */
export const MARGE_SEUIL_SUITE = 0.06;

/** Le seuil réellement appliqué à un tour de suite, connaissant celui du lancement. */
export function seuilDeSuite(seuilDeLancement: number): number {
  return seuilDeLancement + MARGE_SEUIL_SUITE;
}

/** Le repère d'un passage : son fichier et son titre. Deux fois le même ne repart pas. */
export function clePassage(passage: Pick<PassageDoc, 'source' | 'titre'>): string {
  return `${passage.source}#${passage.titre}`;
}

/**
 * LES PASSAGES QUE CET AGENT N'A PAS ENCORE VUS DANS CETTE SESSION.
 *
 * La liste des clés déjà servies est tenue par le démon et REMISE À ZÉRO à
 * chaque session neuve (le contexte du moteur repart vide : ce qu'il avait sous
 * les yeux n'y est plus). Un passage retiré ici n'est pas perdu — il est déjà
 * dans le fil, plus haut.
 */
export function passagesInedits<T extends Pick<PassageDoc, 'source' | 'titre'>>(
  candidats: T[],
  dejaServies: Iterable<string>,
): T[] {
  const vues = new Set(dejaServies);
  return candidats.filter((passage) => !vues.has(clePassage(passage)));
}

/**
 * LE BLOC ENVOYÉ AU MOTEUR sur un tour de suite.
 *
 * Il DIT ce qu'il est — une recherche faite sur la demande qu'on vient de lire,
 * pas un rappel de la mémoire déjà transmise — et il DIT ce qu'il n'est pas :
 * un complément, jamais toute la mémoire. Sans cette phrase, un agent pourrait
 * lire trois passages comme la réponse entière du projet.
 */
export function texteDesPassagesDeSuite(passages: PassageClasse[]): string {
  if (!passages.length) return '';
  const corps = passages
    .map((passage) => `▸ ${passage.source}${passage.titre ? ` — ${passage.titre}` : ''}\n${passage.texte.trim()}`)
    .join('\n\n');
  const amont = rappelDeLAmont(passages);
  return (
    `MÉMOIRE DU PROJET — ${passages.length} passage${passages.length > 1 ? 's' : ''} retrouvé${
      passages.length > 1 ? 's' : ''
    } pour LA demande ci-dessus ` +
    `(recherche relancée sur ce message, en plus de ce qui t'a déjà été transmis) :\n\n` +
    `${corps}\n\n` +
    `C'est un complément, pas toute la mémoire : appelle « project_memory » dès que cela ne suffit pas.` +
    // Le rappel de la couche AMONT, ici aussi : un passage `@haikodev/…` remonté
    // au dixième message doit se lire comme au premier.
    `${amont ? `\n\n${amont}` : ''}`
  );
}

/**
 * LE NOM DU BLOC, tel qu'il s'affiche dans le prompt envoyé et dans le lecteur
 * de prompts. Il nomme la DEMANDE, pas la session : c'est exactement ce que la
 * bulle doit permettre de vérifier.
 */
export function libelleDesPassagesDeSuite(nombre: number): string {
  return `Mémoire retrouvée pour cette demande (${nombre})`;
}
