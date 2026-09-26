/**
 * LAYA — LE MODÈLE DE DÉCISION QUI TOURNE ICI, SANS RÉSEAU ET SANS FACTURE.
 *
 * Ce fichier ne contient que des RÈGLES PURES : où vit le modèle, combien de
 * temps on attend, à partir de quelle confiance on suit un verdict, et comment
 * se lit une réponse. Le processus, lui, vit dans `server/src/laya.ts`.
 *
 * CE QUE LAYA SAIT FAIRE : répondre à des questions TYPÉES sur un état — un
 * oui/non pondéré (`noul`), un choix dans une liste (`choice`), une note sur
 * une échelle (`score`) — en un seul passage, sans générer un mot. Ce sont
 * exactement les trois primitives du juge rapide (`jugement-rapide.ts`) :
 * aucune traduction, la question part telle quelle.
 *
 * Le modèle : laya-multilingual (Convai Innovations, Apache-2.0), 322 M de
 * paramètres, 100+ langues, 1 024 jetons de contexte. Mesuré le 25.09.2026 sur
 * ce serveur (4 cœurs, deux fils) : 10,7 s de chargement, 1,7 Go de mémoire
 * vive une fois chargé, 0,2–0,3 s pour un état court, 2,2 s pour un état de
 * 4 000 signes.
 *
 * TROIS RÈGLES QUI NE SE DISCUTENT PAS :
 *
 *  1. IL JUGE, IL N'ÉCRIT PAS. Aucune phrase ne sort de lui : les phrases
 *     affichées se composent à partir de ses choix, dans des listes fermées.
 *  2. SOUS LE SEUIL DE CONFIANCE, ON NE LE SUIT PAS. Le comportement d'avant
 *     reprend la main, exactement comme si Laya n'existait pas.
 *  3. TOUT ÉCHEC REND « RIEN ». Modèle absent, pas encore chargé, lent, mémoire
 *     trop juste : personne ne le voit, et aucun chemin n'en dépend.
 */

import type { QuestionDuJuge, ReponseDuJuge } from './jugement-rapide.js';

/** Le dossier où vivent l'environnement Python et les poids, sous la racine du dépôt. */
export const DOSSIER_LAYA = 'outils/laya';
/** Le nom du modèle, tel qu'il s'écrit dans une trace de jugement. */
export const MODELE_LAYA = 'laya-multilingual-local';

/** L'interpréteur de l'environnement, et le cache des poids, sous `DOSSIER_LAYA`. */
export const PYTHON_LAYA = 'venv/bin/python';
export const CACHE_LAYA = 'hf';

/**
 * LE DÉLAI D'UN VERDICT QUE PERSONNE N'ATTEND (jugement en fond). Il court à
 * partir du DÉPART de la question, jamais pendant l'attente dans la file, et
 * couvre un premier chargement (~11 s) quand le modèle dormait.
 */
export const DELAI_LAYA_MS = 30_000;

/**
 * LE DÉLAI D'UN VERDICT SUR LE CHEMIN D'UN TOUR (tri de la mémoire, des
 * compétences, question ou travail). Un tour ne se retarde pas pour un
 * conseil : si Laya n'est pas DÉJÀ chargé, l'appel rend « rien » tout de suite
 * et réveille le modèle pour la fois suivante.
 */
export const DELAI_LAYA_EXPRESS_MS = 2_500;

/** Le délai d'une explication d'erreur : la phrase simple ne retient rien, mais ne traîne pas. */
export const DELAI_LAYA_ERREUR_MS = 5_000;

/**
 * LE SEUIL DE CONFIANCE PAR DÉFAUT. La confiance lue est la PROBABILITÉ DE LA
 * RÉPONSE RETENUE (`answer_confidence`) : 0,5 est le hasard sur un oui/non ou
 * sur deux choix. Chaque usage peut porter le sien (`REGLAGES_DES_USAGES`).
 */
export const SEUIL_LAYA = 0.6;

/**
 * LE REPOS. Laya pèse 1,7 Go chargé, sur une machine de 7,7 Go où tournent des
 * agents : après ce temps sans question, le processus s'arrête, et la question
 * suivante le rallume.
 */
export const REPOS_DE_LAYA_MS = 20 * 60_000;

/**
 * LA MÉMOIRE LIBRE EXIGÉE AVANT DE CHARGER LAYA. En dessous, on ne le lance
 * pas : un jugement de confort ne pousse jamais la machine dans l'échange sur
 * disque, ni ne fait tuer un agent.
 */
export const MEMOIRE_LIBRE_MIN_MO = 2_300;

/** Le plafond, en jetons, de ce qu'on laisse lire au modèle (sa fenêtre d'origine). */
export const LONGUEUR_LAYA = 1_024;

/* ------------------------------------------------------------------ */
/* Lire ce que Laya rend                                               */
/* ------------------------------------------------------------------ */

/** Une réponse brute de Laya, telle que le service la renvoie. */
export interface ReponseBruteDeLaya {
  type?: string;
  noul?: number;
  choice?: string;
  score?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence?: number;
  answer_confidence?: number;
}

/**
 * LA CONFIANCE D'UNE RÉPONSE : la probabilité de ce qui est retenu.
 *
 * Laya rend aussi une `confidence` NORMALISÉE (0 au hasard complet) : elle
 * change de sens d'un genre à l'autre et écrasait tous les seuils mesurés
 * jusqu'ici. On garde donc la probabilité brute de la réponse, lisible partout.
 */
export function confianceDeLaya(brut: ReponseBruteDeLaya | undefined): number {
  if (!brut) return 0;
  if (typeof brut.answer_confidence === 'number') return brut.answer_confidence;
  if (typeof brut.noul === 'number') return Math.max(brut.noul, 1 - brut.noul);
  return typeof brut.confidence === 'number' ? brut.confidence : 0;
}

/**
 * REMETTRE UNE RÉPONSE DANS LA FORME QUE L'APPLICATION CONSOMME.
 *
 * Rien n'est rendu quand Laya n'a pas répondu, quand il a répondu d'un autre
 * genre, choisi hors de la liste offerte, ou quand sa confiance reste sous le
 * seuil : l'appelant retombe sur son comportement d'avant.
 */
export function reponseDepuisLaya(
  question: QuestionDuJuge,
  brut: ReponseBruteDeLaya | undefined,
  seuil = SEUIL_LAYA,
): ReponseDuJuge | undefined {
  if (!brut || brut.type !== question.type) return undefined;
  const confiance = confianceDeLaya(brut);
  if (confiance < seuil) return undefined;
  if (question.type === 'noul') {
    if (typeof brut.noul !== 'number') return undefined;
    return { type: 'noul', noul: brut.noul };
  }
  if (question.type === 'choice') {
    if (typeof brut.choice !== 'string' || !(brut.choice in (question.criteria ?? {}))) return undefined;
    return { type: 'choice', choice: brut.choice, probabilities: brut.probabilities ?? {}, confidence: confiance };
  }
  if (typeof brut.score !== 'number' || !Number.isFinite(brut.score)) return undefined;
  const max = Math.max(0, (question.criteria?.length ?? 1) - 1);
  const legend: Record<string, string> = {};
  (question.criteria ?? []).forEach((texte, i) => {
    legend[String(i)] = texte;
  });
  return {
    type: 'score',
    /* Laya rend l'ESPÉRANCE de la note (0,52 entre « faible » et « moyenne ») :
       on la garde telle quelle, bornée à l'échelle — chaque lecteur arrondit. */
    score: Math.min(max, Math.max(0, brut.score)),
    legend,
    probabilities: brut.probabilities ?? {},
    confidence: confiance,
  };
}

/** L'état tel qu'il part au modèle : un texte, ou un JSON lisible. */
export function etatPourLaya(etat: unknown): string | Record<string, unknown> | unknown[] {
  if (typeof etat === 'string') return etat;
  if (etat && typeof etat === 'object') return etat as Record<string, unknown>;
  return String(etat ?? '');
}
