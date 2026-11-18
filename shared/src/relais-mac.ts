/*
 * LE RELAIS DU MAC : L'AGENT PILOTE LE VRAI IPHONE PAR SA RECOPIE À L'ÉCRAN (13/11/2026, décision de l'utilisateur).
 *
 * Un petit programme installé sur le Mac (`scripts/relais-mac/`) se relie au démon par un code à usage unique émis
 * dans Réglages → Extension, puis interroge le démon par une voie SIGNÉE (même modèle que l'extension Chrome :
 * clé d'appareil, signature HMAC, horodatage frais). Le démon lui confie des gestes ; le relais les joue
 * UNIQUEMENT dans la fenêtre de l'app « Recopie de l'iPhone » (iPhone Mirroring) — capture de cette fenêtre seule,
 * clics et frappe bornés à ses limites, recalculées à CHAQUE geste.
 *
 * Règles PURES : bornage des points, états de disponibilité, décision de repli.
 */


/** Combien de temps le démon tient une demande du relais ouverte, faute de geste à lui confier. */
export const ATTENTE_DU_RELAIS_MS = 25_000;
/** Sans nouvelle du relais depuis ce délai, il est dit déconnecté. */
export const RELAIS_HORS_LIGNE_APRES_MS = 70_000;
/** Délai d'un geste joué par le relais (une capture, un clic). */
export const DELAI_D_UN_GESTE_MS = 30_000;

export const GESTES_IPHONE = ['etat', 'ouvrir_recopie', 'capturer', 'toucher', 'glisser', 'taper', 'touche', 'accueil', 'ouvrir_appli', 'se_connecter'] as const;
export type GesteIphone = (typeof GESTES_IPHONE)[number];

export function gesteIphoneValide(brut: unknown): brut is GesteIphone {
  return typeof brut === 'string' && (GESTES_IPHONE as readonly string[]).includes(brut);
}

/** Les touches que le relais sait jouer dans la recopie. */
export const TOUCHES_IPHONE = ['entree', 'effacer', 'tab', 'echap', 'espace'] as const;

/* ------------------------------------------------------------------ */
/* LE BORNAGE : RIEN HORS DE LA FENÊTRE DE RECOPIE                      */
/* ------------------------------------------------------------------ */

export interface CadreDeFenetre {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/**
 * La marge intérieure refusée au bord de la fenêtre : la barre de titre de la recopie et ses bords ne sont pas
 * l'écran du téléphone. En points, en haut ; une marge plus fine sur les autres bords.
 */
export const MARGE_HAUTE = 28;
export const MARGE_BORD = 2;

/**
 * UN POINT DONNÉ EN FRACTIONS DE LA CAPTURE (0 à 1) DEVIENT UN POINT DE L'ÉCRAN DU MAC, DANS LA FENÊTRE — ou `null`
 * s'il en sortirait. L'agent ne parle jamais en coordonnées de l'écran du Mac : il ne peut pas viser autre chose.
 * La capture couvre la fenêtre entière (barre comprise) : la fraction se lit sur elle.
 */
export function pointDansLaFenetre(fraction: { x: number; y: number }, cadre: CadreDeFenetre): { x: number; y: number } | null {
  if (!Number.isFinite(fraction.x) || !Number.isFinite(fraction.y)) return null;
  if (fraction.x < 0 || fraction.x > 1 || fraction.y < 0 || fraction.y > 1) return null;
  if (!(cadre.largeur > 0) || !(cadre.hauteur > 0)) return null;
  const x = cadre.x + fraction.x * cadre.largeur;
  const y = cadre.y + fraction.y * cadre.hauteur;
  if (x < cadre.x + MARGE_BORD || x > cadre.x + cadre.largeur - MARGE_BORD) return null;
  if (y < cadre.y + MARGE_HAUTE || y > cadre.y + cadre.hauteur - MARGE_BORD) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Un texte tapé dans la recopie : borné en longueur, sans caractère de contrôle (hors retour à la ligne). */
export function texteATaper(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const propre = brut.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
  if (!propre || propre.length > 2000) return null;
  return propre;
}

/* ------------------------------------------------------------------ */
/* DISPONIBILITÉ ET REPLI                                               */
/* ------------------------------------------------------------------ */

export type EtatDuRelais =
  /** Aucun relais relié à ce compte. */
  | 'absent'
  /** Relié, mais pas de nouvelles depuis `RELAIS_HORS_LIGNE_APRES_MS` (Mac éteint, endormi). */
  | 'hors-ligne'
  /** Le relais répond, mais la recopie de l'iPhone n'est pas ouverte (ou l'iPhone est hors de portée). */
  | 'recopie-fermee'
  /** Le Mac est verrouillé : aucun geste possible. */
  | 'mac-verrouille'
  /** Tout est prêt. */
  | 'pret';

export function etatDuRelais(entree: { relie: boolean; vuLe?: number | null; maintenant: number; recopie?: boolean; verrouille?: boolean }): EtatDuRelais {
  if (!entree.relie) return 'absent';
  if (!entree.vuLe || entree.maintenant - entree.vuLe > RELAIS_HORS_LIGNE_APRES_MS) return 'hors-ligne';
  if (entree.verrouille) return 'mac-verrouille';
  if (entree.recopie === false) return 'recopie-fermee';
  return 'pret';
}

/**
 * QUE FAIRE QUAND LE RELAIS N'EST PAS PRÊT : la phrase dite à l'agent. Recopie fermée → l'ouvrir une fois ;
 * sinon → le REPLI : préparer tout, puis envoyer à la personne (ask_user) la liste numérotée des gestes à faire sur
 * son téléphone, avec « C'est fait » / « Plus tard ». Jamais de boucle.
 */
export function conduiteDuRelais(etat: EtatDuRelais): string {
  switch (etat) {
    case 'pret':
      return 'Le relais du Mac est prêt : « capturer » pour voir l’écran de l’iPhone, puis « toucher » (x, y en fractions de la capture), « taper », « ouvrir_appli ».';
    case 'recopie-fermee':
      return 'La recopie de l’iPhone n’est pas ouverte sur le Mac : « ouvrir_recopie » UNE fois, puis « etat ». Toujours fermée (iPhone loin du Mac, déverrouillé ou éteint) : passe au repli.';
    case 'mac-verrouille':
    case 'hors-ligne':
    case 'absent':
    default:
      return 'Le relais du Mac n’est pas disponible. REPLI : prépare tout (fiche du coffre, nom, photo, texte), puis envoie à la personne par ask_user la liste NUMÉROTÉE des gestes à faire sur son téléphone, avec les choix « C’est fait » et « Plus tard » ; sur « C’est fait », vérifie dans Chrome et continue.';
  }
}

export const LIBELLE_ETAT_DU_RELAIS: Record<EtatDuRelais, string> = {
  absent: 'Aucun Mac relié',
  'hors-ligne': 'Mac déconnecté',
  'recopie-fermee': 'Relié — la recopie de l’iPhone est fermée',
  'mac-verrouille': 'Relié — le Mac est verrouillé',
  pret: 'Relié et prêt',
};
