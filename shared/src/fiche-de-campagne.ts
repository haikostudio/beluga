/**
 * LA FICHE D'UNE CAMPAGNE : HUIT POINTS À TRANCHER AVEC LA PERSONNE AVANT DE PRODUIRE (décision du 04/11/2026,
 * captures #d4b1 et #6bcc : « quand je demande une campagne, il faut qu'on suive un process avec des
 * questions-réponses, pas qu'il parte directement sur ce qu'il a décidé »).
 *
 * Le chef de marque pose une question à la fois, dans l'ordre de `POINTS_DE_CAMPAGNE`, et enregistre chaque réponse
 * aussitôt (outil `communication`, action `campagne`). Tant qu'un point manque, l'outil refuse de préparer des
 * contenus, de lier un média ou de confier la campagne (`pointsManquantsDeCampagne`).
 *
 * La personne modifie la fiche sur la page de la campagne, case par case, jusqu'à ce que la fabrication d'un premier
 * média soit lancée (`baseDeCampagneVerrouillee`) — le démon refuse ensuite toute modification, pas seulement l'écran.
 */

/** Les huit points, dans l'ordre des questions du chef. */
export const POINTS_DE_CAMPAGNE = ['medias', 'quantite', 'cible', 'reseaux', 'dates', 'objectif', 'message', 'appel'] as const;
export type PointDeCampagne = (typeof POINTS_DE_CAMPAGNE)[number];

/** Le libellé de chaque point, tel que la page et le chef le disent. */
export const LIBELLES_DES_POINTS: Record<PointDeCampagne, string> = {
  medias: 'Type de médias',
  quantite: 'Quantité et rythme',
  cible: 'Cible',
  reseaux: 'Réseaux',
  dates: 'Durée et dates',
  objectif: 'Objectif chiffré',
  message: 'Message clé et ton',
  appel: 'Appel à l’action',
};

/** Ce que la fiche porte : les colonnes de `communication_campagnes`, lues. */
export interface FicheDeCampagne {
  typesMedias: readonly string[];
  quantiteMedias: number | null;
  rythme: string | null;
  cible: string | null;
  reseaux: readonly string[];
  debut: string | null;
  fin: string | null;
  objectifChiffre: number | null;
  message: string | null;
  ton: string | null;
  appelAction: string | null;
}

const rempli = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim().length > 0;

/** Un point est-il tranché ? Un point double (quantité ET rythme, début ET fin, message ET ton) veut ses deux moitiés. */
export function pointTranche(f: FicheDeCampagne, point: PointDeCampagne): boolean {
  switch (point) {
    case 'medias':
      return f.typesMedias.length > 0;
    case 'quantite':
      return (f.quantiteMedias ?? 0) > 0 && rempli(f.rythme);
    case 'cible':
      return rempli(f.cible);
    case 'reseaux':
      return f.reseaux.length > 0;
    case 'dates':
      return rempli(f.debut) && rempli(f.fin);
    case 'objectif':
      return (f.objectifChiffre ?? 0) > 0;
    case 'message':
      return rempli(f.message) && rempli(f.ton);
    case 'appel':
      return rempli(f.appelAction);
  }
}

/** LES POINTS ENCORE À TRANCHER, dans l'ordre des questions : vide, la campagne peut préparer ses contenus. */
export function pointsManquantsDeCampagne(f: FicheDeCampagne): PointDeCampagne[] {
  return POINTS_DE_CAMPAGNE.filter((p) => !pointTranche(f, p));
}

/** Ce qui dit que la fabrication a commencé pour cette campagne. */
export interface FabricationDeCampagne {
  /** Les médias rattachés à la campagne (Studio compris : une création lancée pour elle se rattache au lancement). */
  mediasRattaches: number;
  /** Les publications de la campagne qui ont déjà un média (aperçu lié). */
  publicationsAvecMedia: number;
}

/** LA BASE SE FIGE dès qu'un premier média est en fabrication : la modifier ensuite défairait un travail payé. */
export function baseDeCampagneVerrouillee(f: FabricationDeCampagne): boolean {
  return f.mediasRattaches > 0 || f.publicationsAvecMedia > 0;
}

/** Les champs de la base (côté démon) que le verrou laisse passer : ceux des dates et de l'objectif chiffré. */
export const CHAMPS_LIBRES_SOUS_VERROU = ['debut', 'fin', 'chiffre', 'mesure'] as const;

/** Des dates de campagne cohérentes : la fin ne précède jamais le début. */
export function datesDeCampagneValides(debut: string | null | undefined, fin: string | null | undefined): boolean {
  return !debut || !fin || fin >= debut;
}

/** La phrase de refus de l'outil tant qu'il manque des points : elle les nomme, dans l'ordre des questions. */
export function refusFicheIncomplete(titre: string, manquants: readonly PointDeCampagne[]): string {
  return `La fiche de la campagne « ${titre} » n'est pas complète : il manque ${manquants.map((p) => LIBELLES_DES_POINTS[p].toLowerCase()).join(', ')}. Pose ces questions à la personne avec ask_user, une à la fois, ton conseil en premier « (recommandé) », et enregistre chaque réponse avec l'action « campagne » avant de préparer quoi que ce soit.`;
}
