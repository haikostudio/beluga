/**
 * « Le serveur ne répond pas » — une phrase à ne dire que quand c'est vrai.
 *
 * Une requête du navigateur attend au plus deux minutes (`call()`,
 * `web/src/lib/client.ts`). Passé ce délai, elle abandonne. Or un lancement de
 * carte ne répond QU'À LA FIN du tour : la requête peut donc expirer alors que
 * tout va bien — le serveur travaille, le canal temps réel est ouvert, les
 * événements continuent d'arriver. Afficher là une alerte rouge « le serveur ne
 * répond pas » est un mensonge, et il tombe précisément au pire moment : quand
 * l'agent vient de démarrer.
 *
 * L'alerte est donc réservée à une indisponibilité RÉELLE et DURABLE. Deux
 * signes, un seul suffit :
 *
 *  - le canal temps réel est COUPÉ depuis plus de quinze secondes (une
 *    reconnexion ordinaire prend moins que ça) ;
 *  - plusieurs requêtes d'affilée restent sans réponse, canal ouvert ou non.
 *
 * Une requête isolée qui expire ne dit rien : elle est RENDUE à l'appelant, qui
 * en fait ce qu'il veut (un lot la compte dans son bilan, une carte la montre
 * sur elle-même), mais elle n'allume plus d'alerte.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Au-delà, un canal coupé n'est plus une reconnexion : c'est une panne. */
export const DELAI_CANAL_COUPE = 15_000;

/** Deux requêtes de suite sans réponse : ce n'est plus un accident isolé. */
export const ECHECS_AVANT_ALERTE_SERVEUR = 2;

/** Ce que l'interface sait de l'état du lien avec le serveur. */
export interface EtatDuLien {
  /** Le canal temps réel est-il ouvert ? */
  connecte: boolean;
  /** Depuis quand il est coupé, si c'est le cas. */
  coupeDepuis?: number;
  /** Requêtes consécutives restées sans réponse, remise à zéro dès qu'une aboutit. */
  echecsConsecutifs: number;
}

/**
 * Faut-il afficher l'alerte « le serveur ne répond pas » ?
 *
 * Le premier échec, canal ouvert, ne l'affiche jamais : c'est une requête
 * lente, pas une panne.
 */
export function alerteServeurInjoignable(lien: EtatDuLien, maintenant: number): boolean {
  if (lien.echecsConsecutifs >= ECHECS_AVANT_ALERTE_SERVEUR) return true;
  if (lien.connecte) return false;
  if (lien.coupeDepuis == null) return false;
  return maintenant - lien.coupeDepuis >= DELAI_CANAL_COUPE;
}

/**
 * Le message rendu à l'appelant quand une requête expire. Il ne change PAS de
 * texte : le bilan d'un lot le traduit déjà en une phrase compréhensible
 * (`traduireRaison`, `lot-colonne.ts`), et deux formulations pour un même fait
 * se contrediraient.
 */
export const RAISON_SANS_REPONSE = 'le serveur ne répond pas';


/**
 * LE TEMPS QUE L'ÉCRAN LAISSE À UN LANCEMENT.
 *
 * Le navigateur abandonnait au bout de deux minutes, et se taisait : un
 * lancement dont l'ouverture de la copie de travail prend plus longtemps
 * (gros dépôt, disque distant) voyait donc son bouton revenir sans un mot,
 * alors que le serveur travaillait encore. L'attente suit désormais ce que le
 * serveur peut réellement mettre (`DELAI_OUVERTURE_DE_COPIE_MS`), avec deux
 * minutes de marge.
 */
export const DELAI_ATTENTE_LANCEMENT_MS = 47 * 60_000;

/**
 * Ce qu'on dit quand ce délai-là est dépassé. Ce n'est PAS l'alerte « le
 * serveur ne répond pas » : la demande est partie, et la carte dira elle-même
 * si elle a démarré.
 */
export function motDeLancementSansReponse(): string {
  return 'Le lancement n’a pas répondu à temps. La demande est partie : la carte dira elle-même si elle a démarré, ou pourquoi elle attend.';
}

/* ------------------------------------------------------------------ */
/* L'ÉTAT DU CANAL — un seul état, lu partout                          */
/* ------------------------------------------------------------------ */

/**
 * UN SEUL ÉTAT DE CANAL, ET PERSONNE NE LE REDÉDUIT DE SON CÔTÉ.
 *
 * Le drapeau `connected` ne disait qu'une chose : le socket est-il ouvert. Il
 * ne disait rien de ce qu'on a le DROIT de faire entre-temps — d'où des écrans
 * qui décidaient sur un état vieux de plusieurs heures : un bouton « Générer le
 * plan » allumé pendant la compréhension, un plan « en cours » depuis sept
 * heures, deux flux affichés en parallèle après un rechargement. La cause n'est
 * jamais un mauvais calcul : c'est un calcul JUSTE sur un état PÉRIMÉ.
 *
 * Cinq états, dans l'ordre de gravité, et un seul à la fois :
 *
 *  | État               | Ce qui se passe                                    |
 *  | ------------------ | -------------------------------------------------- |
 *  | `en-ligne`         | le canal répond, l'état est frais : tout est permis |
 *  | `resynchronisation`| le canal vient de revenir, l'état est redemandé     |
 *  | `muet`             | canal ouvert, plus rien ne vient depuis longtemps   |
 *  | `reconnexion`      | canal coupé, la reconnexion est en route            |
 *  | `redemarrage`      | le démon redémarre — coupure ATTENDUE et courte     |
 *
 * Tout ce qui n'est pas `en-ligne` GÈLE les gestes : on montre tout, on ne
 * lance plus rien, et rien ne se perd. Règle pure, sans réseau ni base.
 */
export type EtatDuCanal = 'en-ligne' | 'resynchronisation' | 'muet' | 'reconnexion' | 'redemarrage';

/**
 * Le battement passe toutes les 20 s et abandonne à 8 s. Au-delà de cette
 * somme, un canal qui se dit ouvert sans avoir rien dit n'est plus crédible.
 */
export const DELAI_CANAL_MUET = 30_000;

/**
 * Le temps qu'on laisse à une coupure avant d'en parler à l'écran. En dessous,
 * c'est un rechargement ou un changement de réseau : le message clignoterait
 * pour rien. Les gestes, eux, sont gelés IMMÉDIATEMENT — un geste avalé dans le
 * vide coûte plus cher qu'un bouton éteint une seconde.
 */
export const DELAI_AVANT_MESSAGE_DU_CANAL = 1_500;

/**
 * LA CLÉ DU MESSAGE PERSISTANT QUI DIT L'ÉTAT DU LIEN. Une seule entrée dans
 * la pile de messages porte cette clé : l'état du canal ne s'empile pas, il se
 * remplace (`pileAvecMessagePersistant`, `pile-messages.ts`).
 */
export const CLE_MESSAGE_DU_CANAL = 'canal';

export interface LectureDuCanal {
  /** Le socket est-il ouvert ? */
  connecte: boolean;
  /** Depuis quand il est coupé, si c'est le cas. */
  coupeDepuis?: number;
  /** Le dernier événement REÇU du serveur, quel qu'il soit. */
  dernierEvenementA?: number;
  /** Le démon a annoncé son redémarrage : la coupure qui suit est attendue. */
  redemarrageEnCours?: boolean;
  /** L'état complet (`ready`) est-il revenu DEPUIS la dernière reconnexion ? */
  resynchronise: boolean;
}

export function etatDuCanal(lecture: LectureDuCanal, maintenant: number): EtatDuCanal {
  if (!lecture.connecte) return lecture.redemarrageEnCours ? 'redemarrage' : 'reconnexion';
  if (!lecture.resynchronise) return 'resynchronisation';
  if (lecture.dernierEvenementA != null && maintenant - lecture.dernierEvenementA >= DELAI_CANAL_MUET) return 'muet';
  return 'en-ligne';
}

/** Les gestes sont-ils gelés ? Tout ce qui n'est pas « en ligne » les gèle. */
export function gestesGeles(etat: EtatDuCanal): boolean {
  return etat !== 'en-ligne';
}

/** Ce que le message dit, par état. Une phrase, jamais un code. */
export const PHRASES_DU_CANAL: Record<Exclude<EtatDuCanal, 'en-ligne'>, string> = {
  redemarrage: 'Le démon redémarre — les commandes reprennent dès qu’il répond.',
  reconnexion: 'Le serveur ne répond pas — reconnexion en cours.',
  muet: 'Le serveur ne dit plus rien — vérification du lien en cours.',
  resynchronisation: 'Lien retrouvé — état en cours de récupération.',
};

/**
 * LA RAISON DITE PAR UN BOUTON ÉTEINT. Une seule phrase, la même partout :
 * infobulle du geste du parcours, création de carte, geste de lot d’une rangée.
 */
export const RAISON_CANAL_COUPE = 'Le serveur ne répond pas : rien ne peut partir tant que le lien n’est pas rétabli.';

/**
 * CE QUE L'ÉCRAN DOIT DIRE DU LIEN, ou rien.
 *
 * C'ÉTAIT UN BANDEAU EN TRAVERS DE L'ÉCRAN, C'EST MAINTENANT UN MESSAGE
 * PERSISTANT posé en haut au centre, dans la pile des messages
 * (`CLE_MESSAGE_DU_CANAL`). Le bandeau prenait toute la largeur EN FLUX, sous
 * la barre du haut : son apparition poussait le tableau, la conversation et
 * tout le reste d'une trentaine de pixels vers le bas, puis les remontait au
 * retour du lien. Un message posé au-dessus de la page dit la même chose sans
 * jamais déplacer ce qu'on est en train de lire.
 *
 * Il ne paraît qu'une fois la coupure installée
 * (`DELAI_AVANT_MESSAGE_DU_CANAL`) : la reconnexion d'un téléphone qui sort de
 * veille ne doit pas faire clignoter une phrase d'alerte.
 *
 * Il prend l'état DÉJÀ calculé, jamais la lecture brute : il n'y a qu'un seul
 * calcul d'état dans toute l'application, et c'est `etatDuCanal`.
 */
export function messageDuCanal(
  etat: EtatDuCanal,
  coupeDepuis: number | undefined,
  maintenant: number,
  gesteRefuse = false,
): { etat: Exclude<EtatDuCanal, 'en-ligne'>; texte: string; depuis?: number } | null {
  if (etat === 'en-ligne') return null;
  /* UN GESTE REFUSÉ FAIT TOMBER LE DÉLAI D'ATTENTE. Le silence de 1,5 s existe
     pour ne pas faire clignoter une phrase d'alerte sur une reconnexion
     invisible — mais si un clic vient d'être REFUSÉ pendant ce silence,
     l'utilisateur n'a AUCUN signe que son geste n'est pas parti. Dès qu'un
     geste engageant a été refusé, le message paraît tout de suite. */
  if (gesteRefuse) return { etat, texte: PHRASES_DU_CANAL[etat], depuis: coupeDepuis };
  if (coupeDepuis != null && maintenant - coupeDepuis < DELAI_AVANT_MESSAGE_DU_CANAL) return null;
  return { etat, texte: PHRASES_DU_CANAL[etat], depuis: coupeDepuis };
}

/**
 * CE QU'ON DIT D'UN GESTE QUI N'A PAS PU PARTIR.
 *
 * Jusqu'ici, l'envoi sans retour (`send`) jetait en silence tout ce qu'il ne
 * pouvait pas transmettre : l'écran refermait son encart, le serveur ne
 * recevait rien, et personne ne pouvait le savoir. Un geste qui ENGAGE quelque
 * chose (reconnecter un compte, annuler, relancer, changer un réglage) doit
 * donc réussir ou se PLAINDRE — et la plainte nomme le geste, sinon elle
 * n'apprend rien.
 *
 * Les gestes purement décoratifs (dire quel écran on regarde, demander une
 * liste que l'écran redemandera de lui-même à la reconnexion) continuent de se
 * perdre sans bruit : les signaler rendrait l'application bavarde pour rien.
 */
export const MOT_GESTE_NON_PARTI =
  'La demande n’a pas pu partir : le serveur ne répondait pas. Le lien est relancé — réessayez dans un instant.';

/** La même chose, quand l'écran sait NOMMER le geste perdu. */
export const MOT_GESTE_NOMME_NON_PARTI =
  '{geste} : la demande n’a pas pu partir, le serveur ne répondait pas. Le lien est relancé — réessayez dans un instant.';
