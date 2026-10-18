import type { RoleCompte } from './comptes-clients.js';
import { hoteEspaceClient } from './installation.js';

/**
 * DEUX VISAGES, UN SEUL DÉMON : C'EST L'ADRESSE DEMANDÉE QUI DÉCIDE.
 *
 * L'espace client est servi sur une adresse à lui (« my.<domaine> », réglée
 * dans l'identité de l'installation), l'application d'administration sur son
 * adresse habituelle. Les deux sortent du MÊME serveur : rien n'est construit
 * ni déployé deux fois, c'est l'entête `Host` de la requête qui dit quelle
 * porte afficher.
 *
 * UNE INSTALLATION SANS ADRESSE CLIENTE SERT SES CLIENTS SUR L'ADRESSE
 * COMMUNE : la porte suit alors le RÔLE du compte entré (`porteDuCompte`), et
 * personne n'est renvoyé vers une adresse qui n'existe pas.
 *
 * Ce fichier ne fait que LIRE cette entête. Il ne touche ni au réseau, ni au
 * DNS, ni au reverse-proxy.
 */

/**
 * Le port sur lequel le démon écoute déjà : le sous-domaine vise le même.
 * Il suit la valeur par défaut de `BELUGA_PORT` (`server/src/config.ts`) — un
 * écart entre les deux ferait pointer un vhost neuf vers un port muet.
 */
export const PORTE_CLIENT_PORT_PAR_DEFAUT = 7070;

export type PorteServie = 'client' | 'admin';

/**
 * Retire le port et la casse d'un entête `Host`. Un `Host` peut arriver sous
 * la forme « my.exemple.com:443 », ou entre crochets en IPv6.
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
export function porteDeLHote(host: string | undefined | null, hoteClient = hoteEspaceClient()): PorteServie {
  const hote = hoteNormalise(host);
  if (!hote) return 'admin';
  if (hoteClient && hote === hoteClient) return 'client';
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
  role: RoleCompte | null,
  hoteClient = hoteEspaceClient(),
): string | null {
  if (!role) return null;
  // Sans adresse cliente réglée, il n'y a nulle part où renvoyer : le client
  // est servi ici même, par la porte de son rôle (`porteDuCompte`).
  if (porte === 'admin' && role === 'client' && hoteClient) return `https://${hoteClient}/`;
  // Un administrateur EST chez lui partout : il ouvre l'espace client depuis sa
  // colonne de gauche, et le voir sur l'adresse cliente ne gêne personne.
  return null;
}

/**
 * LA PORTE RÉELLEMENT MONTÉE POUR CE COMPTE. L'adresse cliente sert toujours
 * l'espace client ; ailleurs, un compte CLIENT reçoit quand même son espace —
 * c'est ce qui fait marcher une installation qui n'a qu'une seule adresse.
 */
export function porteDuCompte(porte: PorteServie, role: RoleCompte | null): PorteServie {
  return porte === 'client' || role === 'client' ? 'client' : 'admin';
}

/** Le repère que le démon pose dans la page pour dire à l'interface quelle porte monter. */
export const REPERE_DE_PORTE = 'beluga-porte';
