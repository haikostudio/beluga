/**
 * DEUX VISAGES, UN SEUL DÉMON : C'EST L'ADRESSE DEMANDÉE QUI DÉCIDE.
 *
 * L'espace client est servi sur `my.haikostudio.cloud`, l'application
 * d'administration sur son adresse habituelle. Les deux sortent du MÊME
 * serveur : rien n'est construit ni déployé deux fois, c'est l'entête `Host` de
 * la requête qui dit quelle porte afficher.
 *
 * Ce fichier ne fait que LIRE cette entête. Il ne touche ni au réseau, ni au
 * DNS, ni au reverse-proxy : la création du sous-domaine reste l'affaire de
 * `server/src/dns.ts`, dans l'ordre qu'il impose (nom, puis proxy, puis
 * certificat).
 */

/** L'adresse de l'espace client. */
export const HOTE_ESPACE_CLIENT = 'my.haikostudio.cloud';

/**
 * Le port sur lequel le démon écoute déjà : le sous-domaine vise le même.
 * Il suit la valeur par défaut de `BELUGA_PORT` (`server/src/config.ts`) — un
 * écart entre les deux ferait pointer un vhost neuf vers un port muet.
 */
export const PORTE_CLIENT_PORT_PAR_DEFAUT = 7070;

export type PorteServie = 'client' | 'admin';

/**
 * Retire le port et la casse d'un entête `Host`. Un `Host` peut arriver sous
 * la forme « my.haikostudio.cloud:443 », ou entre crochets en IPv6.
 */
export function hoteNormalise(host: string | undefined | null): string {
  const brut = (host ?? '').trim().toLowerCase();
  if (!brut) return '';
  if (brut.startsWith('[')) return brut.slice(0, brut.indexOf(']') + 1);
  return brut.split(':')[0] ?? '';
}

/**
 * QUELLE PORTE SERT-ON ? L'espace client dès que l'adresse demandée est la
 * sienne — ou l'une de ses variantes locales, pour qu'un contrôle en machine
 * puisse l'atteindre sans DNS. Tout le reste est l'application d'administration :
 * un doute se tranche du côté qui ne montre RIEN de plus.
 */
export function porteDeLHote(host: string | undefined | null, hoteClient = HOTE_ESPACE_CLIENT): PorteServie {
  const hote = hoteNormalise(host);
  if (!hote) return 'admin';
  if (hote === hoteClient) return 'client';
  // « my.localhost », « my.127.0.0.1.nip.io »… : le préfixe suffit en local.
  if (hote === 'my.localhost' || hote.startsWith('my.')) return 'client';
  return 'admin';
}

/**
 * UN COMPTE QUI FRAPPE À LA MAUVAISE PORTE EST RENVOYÉ CHEZ LUI, et l'inverse
 * aussi : un client qui tape l'adresse d'administration n'y voit pas même le
 * formulaire, et un administrateur qui ouvre l'espace client par erreur revient
 * à son tableau. Rend l'adresse où renvoyer, ou `null` quand tout est en place.
 */
export function redirectionDeLaPorte(
  porte: PorteServie,
  role: 'admin' | 'client' | null,
  hoteClient = HOTE_ESPACE_CLIENT,
): string | null {
  if (!role) return null;
  if (porte === 'admin' && role === 'client') return `https://${hoteClient}/`;
  // Un administrateur EST chez lui partout : il ouvre l'espace client depuis sa
  // colonne de gauche, et le voir sur l'adresse cliente ne gêne personne.
  return null;
}
