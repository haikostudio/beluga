/**
 * LES FORMATS DU VOLET D'APERÇU — téléphone, tablette, ordinateur.
 *
 * Le site de développement s'affiche dans un cadre de la LARGEUR NOMINALE du
 * format choisi (`LARGEUR_DU_FORMAT`). Quand la zone disponible est plus
 * étroite — un format ordinateur vu sur un téléphone, une tablette dans le
 * volet réduit —, le cadre garde sa largeur et se réduit en entier
 * (`echelleDuFormat`) : on voit la vraie mise en page du format, pas une page
 * recomposée à la largeur de l'écran.
 *
 * LES APPAREILS D'ESSAI. Chaque format se précise par un APPAREIL réel — un
 * iPhone SE, un Pixel, un iPad Pro, un écran 1920 — avec sa largeur ET sa
 * hauteur : le cadre garde exactement ce rapport (`echelleDeLAppareil` réduit
 * l'ensemble, jamais l'un des deux côtés seul). Un téléphone ou une tablette se
 * tient en portrait ou en paysage ; un ordinateur reste en paysage. L'entrée
 * « Adapté à la place » de chaque format garde le comportement d'avant : la
 * largeur nominale, et toute la hauteur disponible.
 */

export type FormatDApercu = 'telephone' | 'tablette' | 'ordinateur';

/** L'ordre des trois icônes, et des trois formats du menu du bouton unique du téléphone. */
export const FORMATS_D_APERCU: readonly FormatDApercu[] = ['telephone', 'tablette', 'ordinateur'];

/** La largeur nominale de chaque format, en pixels CSS. */
export const LARGEUR_DU_FORMAT: Record<FormatDApercu, number> = {
  telephone: 390,
  tablette: 820,
  ordinateur: 1280,
};

/** La préférence de compte qui retient le dernier format choisi. */
export const CLE_FORMAT_D_APERCU = 'apercu.format';

export function estFormatDApercu(valeur: unknown): valeur is FormatDApercu {
  return typeof valeur === 'string' && (FORMATS_D_APERCU as readonly string[]).includes(valeur);
}

/**
 * Le facteur de réduction du cadre : 1 s'il tient, sinon la part de sa largeur
 * qui tient. Une zone pas encore mesurée (0 ou moins) ne réduit rien.
 */
export function echelleDuFormat(largeurDisponible: number, largeurDuFormat: number): number {
  if (!(largeurDisponible > 0) || !(largeurDuFormat > 0)) return 1;
  return Math.min(1, largeurDisponible / largeurDuFormat);
}

/* ------------------------- Les appareils d'essai ------------------------- */

export type OrientationDApercu = 'portrait' | 'paysage';

/** Les familles d'un format, dans l'ordre du menu. « adapte » n'est pas une famille : c'est l'entrée de fin. */
export type FamilleDAppareil =
  | 'iphone'
  | 'android'
  | 'ipad'
  | 'android-tablette'
  | 'portable'
  | 'ecran'
  | 'adapte';

export interface AppareilDApercu {
  id: string;
  format: FormatDApercu;
  famille: FamilleDAppareil;
  /** Le nom de l'appareil, le même dans toutes les langues. */
  nom: string;
  /** En portrait pour un téléphone ou une tablette, en paysage pour un ordinateur. */
  largeur: number;
  /** Absente pour « Adapté à la place » : le cadre prend alors toute la hauteur disponible. */
  hauteur: number | null;
}

const appareil = (
  id: string,
  format: FormatDApercu,
  famille: FamilleDAppareil,
  nom: string,
  largeur: number,
  hauteur: number | null,
): AppareilDApercu => ({ id, format, famille, nom, largeur, hauteur });

/** Les dimensions sont celles de la zone d'affichage en pixels CSS (la « viewport » de l'appareil). */
export const APPAREILS_D_APERCU: readonly AppareilDApercu[] = [
  appareil('iphone-se', 'telephone', 'iphone', 'iPhone SE', 375, 667),
  appareil('iphone-mini', 'telephone', 'iphone', 'iPhone 13 mini', 375, 812),
  appareil('iphone-15', 'telephone', 'iphone', 'iPhone 15 / 16', 393, 852),
  appareil('iphone-16-pro', 'telephone', 'iphone', 'iPhone 16 Pro', 402, 874),
  appareil('iphone-16-pro-max', 'telephone', 'iphone', 'iPhone 16 Pro Max', 430, 932),
  appareil('android-360', 'telephone', 'android', 'Android 360', 360, 640),
  appareil('pixel', 'telephone', 'android', 'Pixel 8 / 9', 412, 915),
  appareil('galaxy-s', 'telephone', 'android', 'Galaxy S', 360, 780),
  appareil('galaxy-ultra', 'telephone', 'android', 'Galaxy S Ultra', 384, 824),
  appareil('galaxy-fold', 'telephone', 'android', 'Galaxy Z Fold', 344, 882),
  appareil('telephone-adapte', 'telephone', 'adapte', '', LARGEUR_DU_FORMAT.telephone, null),
  appareil('ipad-mini', 'tablette', 'ipad', 'iPad mini', 744, 1133),
  appareil('ipad-10', 'tablette', 'ipad', 'iPad 10,9″', 820, 1180),
  appareil('ipad-pro-11', 'tablette', 'ipad', 'iPad Pro 11″', 834, 1194),
  appareil('ipad-pro-13', 'tablette', 'ipad', 'iPad Pro 12,9″', 1024, 1366),
  appareil('tablette-android-8', 'tablette', 'android-tablette', 'Android 8″', 600, 960),
  appareil('tablette-android-10', 'tablette', 'android-tablette', 'Android 10″', 800, 1280),
  appareil('tablette-adapte', 'tablette', 'adapte', '', LARGEUR_DU_FORMAT.tablette, null),
  appareil('portable-1280', 'ordinateur', 'portable', '1280 × 800', 1280, 800),
  appareil('portable-1440', 'ordinateur', 'portable', '1440 × 900', 1440, 900),
  appareil('portable-1512', 'ordinateur', 'portable', '1512 × 982', 1512, 982),
  appareil('ecran-1366', 'ordinateur', 'ecran', '1366 × 768', 1366, 768),
  appareil('ecran-1920', 'ordinateur', 'ecran', '1920 × 1080', 1920, 1080),
  appareil('ecran-2560', 'ordinateur', 'ecran', '2560 × 1440', 2560, 1440),
  appareil('ordinateur-adapte', 'ordinateur', 'adapte', '', LARGEUR_DU_FORMAT.ordinateur, null),
];

/** La préférence de compte qui retient le dernier appareil choisi. */
export const CLE_APPAREIL_D_APERCU = 'apercu.appareil';
/** La préférence de compte qui retient la dernière orientation. */
export const CLE_ORIENTATION_D_APERCU = 'apercu.orientation';

/**
 * L'APPAREIL ET L'ORIENTATION SE RETIENNENT PAR PROJET : un site de téléphone et
 * un tableau de bord ne s'essaient pas sur le même appareil. Sans choix pour le
 * projet, on retombe sur la préférence de compte (`CLE_APPAREIL_D_APERCU`), qui
 * garde les choix faits avant cette règle ; l'écriture va toujours à la clé du
 * projet.
 */
export function cleAppareilDApercu(projectId: string): string {
  return `${CLE_APPAREIL_D_APERCU}.${projectId}`;
}

export function cleOrientationDApercu(projectId: string): string {
  return `${CLE_ORIENTATION_D_APERCU}.${projectId}`;
}

/** La préférence de compte qui retient si le volet d'aperçu est ouvert. */
export const CLE_APERCU_OUVERT = 'apercu.ouvert';

/**
 * L'ÉTAT OUVERT / FERMÉ SE RETIENT PAR PROJET ET PAR TYPE D'ÉCRAN : sur téléphone
 * l'aperçu prend tout l'écran et masque la conversation, un choix partagé avec
 * l'ordinateur l'ouvrirait en plein écran à chaque carte.
 */
export function cleApercuOuvert(projectId: string, telephone: boolean): string {
  return `${CLE_APERCU_OUVERT}.${projectId}.${telephone ? 'telephone' : 'ordinateur'}`;
}

/**
 * LA DERNIÈRE ADRESSE SAISIE DANS LA BARRE DE L'APERÇU SE RETIENT PAR PROJET.
 * Le site est dans un cadre d'une autre origine : on ne lit ni son historique
 * ni son adresse courante, donc seul le chemin SAISI est connu. Un chemin à
 * l'accueil (« / ») ne se stocke pas.
 */
export const CLE_CHEMIN_D_APERCU = 'apercu.chemin';

export function cleCheminDApercu(projectId: string): string {
  return `${CLE_CHEMIN_D_APERCU}.${projectId}`;
}

/** La longueur au-delà de laquelle un chemin retenu est ignoré. */
export const LONGUEUR_MAX_DU_CHEMIN = 500;

/**
 * Ce qu'on accepte de reprendre comme chemin : une chaîne qui commence par UN
 * SEUL « / ». `adresseDeLApercu` fait `new URL(chemin, base)` : « //hôte » ou
 * « https://… » changeraient d'hôte — le cadre sortirait du site de
 * développement. Tout le reste retombe sur l'accueil.
 */
export function cheminRetenu(valeur: unknown): string {
  if (typeof valeur !== 'string') return '/';
  const chemin = valeur.trim();
  if (!chemin.startsWith('/') || chemin.startsWith('//') || chemin.startsWith('/\\')) return '/';
  if (chemin.length > LONGUEUR_MAX_DU_CHEMIN || /[\u0000-\u001f\u007f]/.test(chemin) || chemin.includes('\\')) return '/';
  return chemin;
}

export function appareilParId(id: unknown): AppareilDApercu | undefined {
  return typeof id === 'string' ? APPAREILS_D_APERCU.find((a) => a.id === id) : undefined;
}

export function estOrientationDApercu(valeur: unknown): valeur is OrientationDApercu {
  return valeur === 'portrait' || valeur === 'paysage';
}

/** Les appareils d'un format, dans l'ordre du menu. */
export function appareilsDuFormat(format: FormatDApercu): AppareilDApercu[] {
  return APPAREILS_D_APERCU.filter((a) => a.format === format);
}

/** Les familles d'un format, sans « Adapté à la place », dans l'ordre du menu. */
export function famillesDuFormat(format: FormatDApercu): FamilleDAppareil[] {
  const familles: FamilleDAppareil[] = [];
  for (const a of appareilsDuFormat(format)) {
    if (a.famille !== 'adapte' && !familles.includes(a.famille)) familles.push(a.famille);
  }
  return familles;
}

/** L'entrée « Adapté à la place » d'un format : la largeur nominale, toute la hauteur. */
export function appareilAdapte(format: FormatDApercu): AppareilDApercu {
  return APPAREILS_D_APERCU.find((a) => a.format === format && a.famille === 'adapte') as AppareilDApercu;
}

/**
 * L'APPAREIL QU'UN ANCIEN CHOIX « TÉLÉPHONE / TABLETTE / ORDINATEUR » REPREND :
 * un appareil réaliste de sa famille, pas la largeur nue d'avant.
 */
const APPAREIL_DE_L_ANCIEN_FORMAT: Record<FormatDApercu, string> = {
  telephone: 'iphone-15',
  tablette: 'ipad-10',
  ordinateur: 'ordinateur-adapte',
};

/**
 * L'appareil de départ : le dernier choisi ; à défaut, celui que reprend
 * l'ancien format retenu ; à défaut, l'appareil lui-même — le téléphone s'adapte
 * à sa propre place, l'ordinateur aussi. Un appareil retiré du catalogue est
 * inconnu : on retombe alors sur l'ancien format, puis sur le défaut.
 */
export function appareilDeDepart(appareilPrefere: unknown, formatPrefere: unknown, telephone: boolean): AppareilDApercu {
  const choisi = appareilParId(appareilPrefere);
  if (choisi) return choisi;
  if (estFormatDApercu(formatPrefere)) return appareilParId(APPAREIL_DE_L_ANCIEN_FORMAT[formatPrefere]) as AppareilDApercu;
  return appareilAdapte(telephone ? 'telephone' : 'ordinateur');
}

/** Un téléphone ou une tablette se tient dans les deux sens ; un ordinateur, ou « Adapté à la place », non. */
export function estOrientable(a: AppareilDApercu): boolean {
  return a.format !== 'ordinateur' && a.hauteur !== null;
}

/** L'orientation réellement appliquée : celle retenue, sinon le portrait ; jamais le paysage d'un appareil qui ne pivote pas. */
export function orientationDeLAppareil(a: AppareilDApercu, prefere: unknown): OrientationDApercu {
  if (a.format === 'ordinateur') return 'paysage';
  if (!estOrientable(a)) return 'portrait';
  return estOrientationDApercu(prefere) ? prefere : 'portrait';
}

/** Largeur et hauteur du cadre, côtés échangés en paysage. La hauteur est absente pour « Adapté à la place ». */
export function dimensionsDeLAppareil(
  a: AppareilDApercu,
  orientation: OrientationDApercu,
): { largeur: number; hauteur: number | null } {
  if (a.hauteur === null) return { largeur: a.largeur, hauteur: null };
  const pivote = estOrientable(a) && orientation === 'paysage';
  return pivote ? { largeur: a.hauteur, hauteur: a.largeur } : { largeur: a.largeur, hauteur: a.hauteur };
}

/**
 * Le facteur de réduction d'un appareil : le cadre garde son RAPPORT, donc la
 * largeur ET la hauteur se règlent ensemble, sur le côté le plus contraint. Il
 * ne s'agrandit jamais. Une zone pas encore mesurée ne réduit rien ; sans
 * hauteur (« Adapté à la place »), seule la largeur compte.
 */
export function echelleDeLAppareil(
  placeLargeur: number,
  placeHauteur: number,
  largeur: number,
  hauteur: number | null,
): number {
  let echelle = echelleDuFormat(placeLargeur, largeur);
  if (hauteur && hauteur > 0 && placeHauteur > 0) echelle = Math.min(echelle, placeHauteur / hauteur);
  return Math.min(1, echelle);
}
