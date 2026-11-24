/**
 * Le mur d'accès limite les essais ratés d'une même adresse.
 *
 * LA CONNEXION (`decisionDeConnexion`) laisse MUR_ESSAIS_LIBRES essais ratés
 * sans aucune attente — une faute de frappe ne coûte pas cinq minutes — puis
 * impose MUR_DELAI_MS après le dernier raté. Décision de l'utilisateur du
 * 24/11/2026 : le mur bloquait dès le premier raté, un client qui se trompait
 * une fois se croyait refusé.
 *
 * LE CODE D'INSTALLATION (`decisionDuMur`) reste plus strict, deux règles s'y
 * cumulent :
 *  - au bout de MUR_ESSAIS_MAX essais ratés (dans la fenêtre de comptage),
 *    l'adresse est bloquée ;
 *  - entre deux essais ratés, il faut attendre MUR_DELAI_MS ; un essai relancé
 *    plus tôt est refusé sans même regarder le mot de passe, et on dit combien
 *    de temps il reste.
 *
 * Une connexion RÉUSSIE n'est ni ralentie ni comptée : la décision se prend sur
 * les seuls essais RATÉS, avant de vérifier le mot de passe.
 */

/** Nombre d'essais ratés autorisés avant blocage de l'adresse. */
export const MUR_ESSAIS_MAX = 3;

/** Essais de CONNEXION ratés laissés sans attente, dans la fenêtre de comptage. */
export const MUR_ESSAIS_LIBRES = 3;

/** Délai imposé entre deux essais ratés d'une même adresse. */
export const MUR_DELAI_MS = 5 * 60 * 1000;

/**
 * Fenêtre de comptage des essais ratés. Assez large pour contenir
 * MUR_ESSAIS_MAX essais espacés du délai minimal, sinon le blocage à trois
 * serait hors d'atteinte ; passé ce temps, un blocage se lève de lui-même.
 */
export const MUR_FENETRE_MS = 20 * 60 * 1000;

export type RaisonRefus = 'trop-d-essais' | 'attente';

export interface DecisionMur {
  /** Vrai quand on peut vérifier le mot de passe. */
  autorise: boolean;
  raison?: RaisonRefus;
  /** Message en français simple, présent dès que l'accès est refusé. */
  message?: string;
  /** Temps restant à attendre, en millisecondes (cas « attente »). */
  attenteMs?: number;
}

/** Met un temps restant en français simple : « 4 min 30 s », « 2 minutes »… */
export function tempsRestantEnClair(ms: number): string {
  const totalSec = Math.max(1, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec} seconde${sec > 1 ? 's' : ''}`;
  if (sec === 0) return `${min} minute${min > 1 ? 's' : ''}`;
  return `${min} min ${sec} s`;
}

/**
 * Décide si une adresse peut tenter sa chance, à partir des horodatages de ses
 * essais RATÉS et de l'heure courante. La liste peut contenir des essais plus
 * vieux que la fenêtre : ils sont écartés ici.
 */
export function decisionDuMur(essaisRatesMs: number[], maintenant: number): DecisionMur {
  const recents = essaisRatesMs.filter((t) => t > maintenant - MUR_FENETRE_MS);

  if (recents.length >= MUR_ESSAIS_MAX) {
    return {
      autorise: false,
      raison: 'trop-d-essais',
      message: 'Trop de tentatives. Réessayez dans quelques minutes.',
    };
  }

  const dernier = recents.length ? Math.max(...recents) : null;
  if (dernier !== null) {
    const ecoule = maintenant - dernier;
    if (ecoule < MUR_DELAI_MS) {
      const attenteMs = MUR_DELAI_MS - ecoule;
      return {
        autorise: false,
        raison: 'attente',
        message: `Trop d'essais rapprochés. Attendez encore ${tempsRestantEnClair(attenteMs)} avant de réessayer.`,
        attenteMs,
      };
    }
  }

  return { autorise: true };
}

/**
 * LE MUR DE LA CONNEXION : les MUR_ESSAIS_LIBRES premiers ratés de la fenêtre
 * passent sans attendre ; dès qu'ils sont atteints, il faut laisser passer
 * MUR_DELAI_MS depuis le DERNIER raté. Un nouveau raté après l'attente en
 * relance une autre : la cadence reste bornée sans fermer la porte pour de bon.
 */
export function decisionDeConnexion(essaisRatesMs: number[], maintenant: number): DecisionMur {
  const recents = essaisRatesMs.filter((t) => t > maintenant - MUR_FENETRE_MS && t <= maintenant);
  if (recents.length < MUR_ESSAIS_LIBRES) return { autorise: true };
  const ecoule = maintenant - Math.max(...recents);
  if (ecoule >= MUR_DELAI_MS) return { autorise: true };
  const attenteMs = MUR_DELAI_MS - ecoule;
  return {
    autorise: false,
    raison: 'attente',
    message: `Trop d'essais rapprochés. Attendez encore ${tempsRestantEnClair(attenteMs)} avant de réessayer.`,
    attenteMs,
  };
}
