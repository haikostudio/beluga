/*
 * LES NOUVELLES DE JARVIS PENDANT UN LONG SILENCE (carte « Mémoire, bulles, publication et marketing », 19/11/2026).
 *
 * Décision de l'utilisateur : quand le cerveau travaille longtemps sans que la voix ne dise rien, Jarvis donne UNE
 * phrase utile au bout de 15 s — ce qu'il fait précisément et ce qu'il a trouvé d'utile —, puis au plus une phrase
 * toutes les 30 s, et SEULEMENT s'il y a du nouveau. Rien si la réponse arrive avant 15 s. « Les choses utiles,
 * pas tout raconter » : jamais la liste des sources consultées, jamais une avancée inventée — le point se compose
 * des étapes RÉELLES du cerveau (ses appels d'outils), rien d'autre.
 *
 * Règle pure : le démon (`server/src/voix-directe.ts`) tient les étapes et l'horloge, et injecte le texte rendu ici
 * à la voix (`thread/realtime/appendText`, rôle developer), qui le dit en une phrase.
 */

/** Le premier point, après ce silence de la voix pendant un travail du cerveau. */
export const PREMIERE_NOUVELLE_MS = 15_000;
/** L'écart minimal entre deux points, et seulement s'il y a du nouveau. */
export const NOUVELLE_SUIVANTE_MS = 30_000;

/** Une étape réelle du cerveau (un appel d'outil), telle que l'écran la coche. */
export interface EtapeDuCerveau {
  libelle: string;
  etat: 'en-cours' | 'finie' | 'echec';
  /** Le court résultat d'une étape finie (« 3 éléments trouvés »), s'il se résume. */
  resultat?: string | null;
  /** Quand l'étape s'est finie (ms). */
  finieLe?: number;
}

/** Ce qui a déjà été dit pendant ce travail. */
export interface NouvellesDites {
  /** Quand la voix a parlé pour la dernière fois (ou quand le travail a commencé). */
  derniereParoleLe: number;
  /** Quand le dernier point a été passé à la voix ; null tant qu'aucun. */
  dernierPointLe: number | null;
}

const MAX_TROUVAILLES = 3;

/**
 * LE POINT D'AVANCEMENT À PASSER À LA VOIX MAINTENANT, ou null s'il faut se taire.
 * - Avant 15 s de silence de la voix : rien.
 * - Premier point : ce qu'il fait (l'étape en cours) et ce qu'il a trouvé d'utile (les résultats finis) ; sans aucune
 *   étape, une seule phrase dit qu'il travaille encore.
 * - Ensuite : au plus toutes les 30 s, et seulement si une étape s'est finie AVEC un résultat depuis le dernier point.
 */
export function pointDAvancement(etapes: readonly EtapeDuCerveau[], dites: NouvellesDites, maintenant: number): string | null {
  const silence = maintenant - Math.max(dites.derniereParoleLe, dites.dernierPointLe ?? 0);
  const enCours = [...etapes].reverse().find((e) => e.etat === 'en-cours');
  const depuis = dites.dernierPointLe ?? 0;
  const trouvailles = etapes
    .filter((e) => e.etat === 'finie' && e.resultat && (e.finieLe ?? 0) > depuis)
    .slice(-MAX_TROUVAILLES)
    .map((e) => `${e.libelle} → ${e.resultat}`);
  if (dites.dernierPointLe === null) {
    if (silence < PREMIERE_NOUVELLE_MS) return null;
  } else {
    if (silence < NOUVELLE_SUIVANTE_MS || !trouvailles.length) return null;
  }
  const morceaux = [
    enCours ? `en ce moment : ${enCours.libelle}` : trouvailles.length ? '' : 'le travail continue, sans résultat à signaler encore',
    trouvailles.length ? `déjà trouvé : ${trouvailles.join(' ; ')}` : '',
  ].filter(Boolean);
  return (
    `POINT D’AVANCEMENT de Codex, qui travaille encore (${morceaux.join(' — ')}). ` +
    'Dis-le à l’utilisateur en UNE phrase courte et naturelle : ce que tu fais et ce que tu as trouvé d’utile, sans énumérer ni nommer les endroits consultés, sans conclure. Puis tais-toi et attends la réponse de Codex.'
  );
}
