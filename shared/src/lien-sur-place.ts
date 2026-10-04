/**
 * UN LIEN OUVERT DANS L'APPLICATION INSTALLÉE NE DOIT JAMAIS LA REMPLACER.
 *
 * Installée sur l'écran d'accueil d'un téléphone, l'application n'a ni barre
 * d'adresse ni bouton « retour ». Un lien vers l'un de ses propres fichiers —
 * une pièce jointe, un téléchargement, un fichier du projet — y NAVIGUE : tout
 * l'écran devient la page de téléchargement du système (« planche.png — Ouvrir
 * dans Aperçu »), sans rien pour revenir. Il fallait tuer l'application.
 *
 * Ces liens s'ouvrent donc SUR PLACE, dans une fenêtre de l'application qu'on
 * referme comme les autres. Un lien vers un AUTRE site, lui, garde son
 * comportement : le système l'ouvre dans sa propre fenêtre, qui a son bouton de
 * fermeture.
 *
 * Règles pures : ni fenêtre, ni réseau. Elles se testent seules.
 */

/** Ce qu'on sait d'un lien au moment du clic. */
export interface LienClique {
  /** L'adresse écrite sur le lien, relative ou entière. */
  href: string;
  /** L'origine de la page qui le porte (`https://exemple.ch`). */
  origine: string;
  /** La valeur de l'attribut de téléchargement ; `null` quand il est absent. */
  telechargement: string | null;
  /** Le lien demande-t-il une nouvelle fenêtre (`target="_blank"`) ? */
  nouvelleFenetre: boolean;
}

/** Ce que la fenêtre de l'application doit ouvrir. */
export interface LienSurPlace {
  /** L'adresse entière du fichier. */
  adresse: string;
  /** Le nom du fichier, quand le lien le dit déjà. */
  nom?: string;
}

/**
 * Ce lien doit-il s'ouvrir sur place ? Oui s'il vise la MÊME origine ET qu'il
 * sortirait de l'écran : un téléchargement, une route de fichier (`/api/…`), ou
 * une nouvelle fenêtre. Un simple changement d'écran de l'application (même
 * page, autre fragment) reste une navigation ordinaire.
 */
export function lienAOuvrirSurPlace(lien: LienClique): LienSurPlace | null {
  let adresse: URL;
  let origine: URL;
  try {
    origine = new URL(lien.origine);
    adresse = new URL(lien.href, origine);
  } catch {
    return null;
  }
  if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') return null;
  if (adresse.origin !== origine.origin) return null;
  const fichier = adresse.pathname.startsWith('/api/');
  if (!fichier && adresse.pathname === '/') return null;
  if (!fichier && lien.telechargement === null && !lien.nouvelleFenetre) return null;
  const nom = lien.telechargement?.trim() || nomDuChemin(adresse.searchParams.get('path'));
  return nom ? { adresse: adresse.href, nom } : { adresse: adresse.href };
}

/** Le dernier morceau d'un chemin de fichier, s'il y en a un. */
function nomDuChemin(chemin: string | null): string | undefined {
  const dernier = (chemin ?? '').split('/').filter(Boolean).pop();
  return dernier || undefined;
}

/**
 * LE NOM DU FICHIER, LU DANS L'ENTÊTE DE LA RÉPONSE (`content-disposition`).
 * Le serveur l'écrit encodé, sous `filename*=UTF-8''…` ou `filename="…"`.
 */
export function nomDepuisDisposition(entete: string | null | undefined): string | undefined {
  if (!entete) return undefined;
  const brut =
    /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(entete)?.[1] ?? /filename\s*=\s*"?([^";]+)"?/i.exec(entete)?.[1];
  if (!brut) return undefined;
  const net = brut.trim().replace(/^"|"$/g, '');
  try {
    return decodeURIComponent(net) || undefined;
  } catch {
    return net || undefined;
  }
}

/** Comment un fichier se montre dans la fenêtre, d'après son type. */
export type AffichageSurPlace = 'image' | 'video' | 'cadre' | 'aucun';

export function affichageSurPlace(mime: string | null | undefined): AffichageSurPlace {
  const type = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type === 'application/pdf' || type.startsWith('text/') || type === 'application/json') return 'cadre';
  return 'aucun';
}
