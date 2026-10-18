/**
 * LE NOM D'UN APPAREIL ABONNÉ AUX NOTIFICATIONS, lu dans l'identité que son
 * navigateur annonce. Règle pure : la liste des appareils des réglages ne
 * montre jamais l'adresse d'abonnement (opaque, et propre au fournisseur de
 * notifications), seulement ce nom et la date d'ajout.
 *
 * Le nom vient du `User-Agent` reçu quand l'appareil s'abonne. Faute de mieux
 * il vaut « Appareil inconnu » (clé du dictionnaire, traduite à l'affichage).
 */
export const APPAREIL_INCONNU = 'Appareil inconnu';

/** Le système d'abord, puis le navigateur : l'ordre compte (Edge et Opera annoncent aussi « Chrome »). */
export function nomDAppareil(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return APPAREIL_INCONNU;

  const systeme = /iPad/i.test(ua)
    ? 'iPad'
    : /iPhone|iPod/i.test(ua)
      ? 'iPhone'
      : /Android/i.test(ua)
        ? 'Android'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(ua)
            ? 'Mac'
            : /CrOS/i.test(ua)
              ? 'Chromebook'
              : /Linux|X11/i.test(ua)
                ? 'Linux'
                : '';

  const navigateur = /Edg(e|A|iOS)?\//i.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/i.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//i.test(ua)
        ? 'Firefox'
        : /SamsungBrowser\//i.test(ua)
          ? 'Samsung Internet'
          : /Chrome\/|CriOS\//i.test(ua)
            ? 'Chrome'
            : /Safari\//i.test(ua)
              ? 'Safari'
              : '';

  if (!systeme && !navigateur) return APPAREIL_INCONNU;
  return [systeme, navigateur].filter(Boolean).join(' · ');
}

/** Un appareil de la liste des réglages, tel que le serveur le décrit. */
export interface AppareilNotifie {
  /** Empreinte de l'adresse d'abonnement : sert à retirer, ne se déchiffre pas. */
  id: string;
  nom: string;
  ajouteLe: number;
}
