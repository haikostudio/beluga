/**
 * CE QU'UN TOUR FINI ÉCRIT DANS LE JOURNAL DE SA CARTE.
 *
 * Constat qui a produit ce fichier, relevé sur la base réellement servie :
 * 61 jalons « Tour interrompu », dont 38 portent « Fable 5.1 requires usage
 * credits… » et 7 « Le moteur s'est arrêté (code null) ». Les 38 premiers ne
 * sont PAS des incidents : le démon les reconnaît déjà comme une limite de
 * compte (`reprise-compte.ts`), pose sa relève — souvent automatique — et le
 * tour repart tout seul. Mais la fin de tour n'écrivait le jalon que sur
 * `failed` : le journal gardait un incident, `derniereErreurDuJournal`
 * (`parcours-en-points.ts`) peignait l'étape « Rapport » en ROUGE avec « Le
 * tour s'est interrompu avant le compte rendu. » et son bouton « Reprendre ».
 * L'écran annonçait donc une panne là où le démon savait qu'il n'y en avait
 * pas — et l'utilisateur relançait à la main un travail qui repartait seul.
 *
 * Pire : `resultat` valait la CAUSE dès que le tour tombait. Un tour mort
 * APRÈS avoir écrit son compte rendu perdait ce compte rendu dans le journal,
 * alors que la bulle du fil, elle, le gardait.
 *
 * Cette règle tranche donc, sans base ni disque, ce que la fin de tour écrit :
 * le LIBELLÉ du jalon, s'il compte comme un INCIDENT, et le TEXTE à garder.
 * Elle se rejoue seule (`server/src/test/issue-de-tour.test.ts`).
 */

/** Ce qu'il faut savoir d'un tour fini pour dire ce qu'il laisse au journal. */
export interface TourFini {
  /** Le tour s'est-il terminé en échec (moteur tombé, ou erreur vue en route) ? */
  failed: boolean;
  /** Une relève de compte a-t-elle été posée ? Alors ce n'est pas un incident. */
  reprise?: boolean;
  /** Le moteur n'a jamais parlé : la carte repart d'elle-même en « Planifié ». */
  moteurMuet?: boolean;
  /** L'arrêt a-t-il été demandé à la main ? Le geste humain n'est pas une panne. */
  arretDemande?: boolean;
  /** Le texte rendu par le moteur, tel qu'il partira dans la bulle. */
  texte?: string;
  /** Le compte rendu est-il ENTIER selon le gabarit du rôle (`checkTemplate`) ? */
  rapportEntier?: boolean;
  /** La cause de l'arrêt, écrite en clair, quand il y en a une. */
  cause?: string;
}

/**
 * LE JALON « TOUR EN PAUSE », pour un arrêt de QUOTA déjà pris en charge. Il
 * dit ce qui s'est passé sans le compter comme une panne : la relève est
 * posée, elle repart souvent toute seule.
 */
export const JALON_TOUR_EN_PAUSE = 'Tour en pause';

/** LE JALON « TOUR NON PARTI » : le moteur n'a jamais répondu, la carte repart seule. */
export const JALON_TOUR_NON_PARTI = 'Tour non parti';

/** LE JALON D'UN TOUR COUPÉ À LA MAIN : un geste, pas une panne. */
export const JALON_TOUR_ARRETE = 'Tour arrêté';

/** Ce que la fin de tour écrit dans le journal de la carte. */
export interface IssueDeTour {
  /** Le libellé du jalon. */
  libelle: string;
  /** Le texte à garder : le compte rendu s'il existe, la cause sinon. */
  resultat: string;
  /** Le jalon compte-t-il comme une RÉUSSITE ? */
  reussie: boolean;
  /**
   * Ce jalon peint-il l'étape « Rapport » en rouge ? Seul un vrai incident le
   * fait : ni une pause de quota, ni un arrêt demandé, ni un moteur non parti.
   */
  incident: boolean;
  /**
   * La cause, quand elle mérite d'être dite EN PLUS du compte rendu — un tour
   * qui a rendu son rapport puis est tombé garde les deux.
   */
  cause?: string;
}

/** Au-delà de ce nombre de signes, un texte rendu n'est plus une bribe. */
export const RAPPORT_MINIMAL = 400;

/**
 * LE COMPTE RENDU EST-IL LÀ ? Deux preuves acceptées, dans cet ordre : le
 * gabarit du rôle est tenu (`rapportEntier`, jugé par le démon), ou le texte
 * rendu est assez long pour être autre chose qu'une bannière de moteur. Un
 * tour tombé sur trois mots n'a rien rendu du tout.
 */
export function rapportDejaEcrit(tour: TourFini): boolean {
  const texte = (tour.texte ?? '').trim();
  if (!texte) return false;
  if (tour.rapportEntier) return true;
  return texte.length >= RAPPORT_MINIMAL;
}

/**
 * CE QUE LE TOUR LAISSE AU JOURNAL.
 *
 * L'ordre des cas est la règle elle-même :
 *   1. un tour réussi rend sa réponse ;
 *   2. un tour tombé qui a DÉJÀ écrit son compte rendu rend ce compte rendu —
 *      la cause voyage à côté, elle ne le remplace plus ;
 *   3. un arrêt demandé à la main est un geste, pas une panne ;
 *   4. une limite de compte est une PAUSE : la relève a sa propre route ;
 *   5. un moteur jamais joint n'est pas parti : la carte repart seule ;
 *   6. le reste est un vrai incident, et lui seul rougit le « Rapport ».
 */
export function jalonDeFinDeTour(tour: TourFini): IssueDeTour {
  const texte = (tour.texte ?? '').trim();
  const cause = (tour.cause ?? '').trim() || "Le moteur s'est arrêté avant la fin.";
  if (!tour.failed) return { libelle: 'Réponse rendue', resultat: texte, reussie: true, incident: false };
  if (rapportDejaEcrit(tour)) {
    return { libelle: 'Réponse rendue', resultat: texte, reussie: true, incident: false, cause };
  }
  if (tour.arretDemande) {
    return { libelle: JALON_TOUR_ARRETE, resultat: texte || cause, reussie: false, incident: false, cause };
  }
  if (tour.reprise) {
    return { libelle: JALON_TOUR_EN_PAUSE, resultat: cause, reussie: false, incident: false, cause };
  }
  if (tour.moteurMuet) {
    return { libelle: JALON_TOUR_NON_PARTI, resultat: cause, reussie: false, incident: false, cause };
  }
  return { libelle: 'Tour interrompu', resultat: cause, reussie: false, incident: true, cause };
}
