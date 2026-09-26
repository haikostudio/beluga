/**
 * LA PORTE D'ENTRÉE D'UN PROJET EST UN NUMÉRO FIXE, ENREGISTRÉ AVEC LUI.
 *
 * Jusqu'ici, le port d'un projet ne vivait nulle part : la publication le
 * DEVINAIT à chaque mise en ligne (socket constatée, puis vhost Caddy, puis
 * unité systemd), et le lanceur (`ensure-port.sh`) le faisait dériver dès que
 * le port préféré était pris. Deux projets pouvaient ainsi se retrouver sur le
 * même numéro sans que rien ne le dise — incident projetc / projetd-dev du
 * 6 septembre 2026, trois heures et demie de 502.
 *
 * Désormais le projet PORTE son port (`Project.port`, vraie colonne en base).
 * Ce fichier tient les règles pures qui l'entourent, sans base ni disque :
 *
 *  1. CHOISIR un port libre et unique dans la plage des projets, en évitant
 *     ceux déjà attribués aux autres projets ET ceux constatés en écoute ;
 *  2. REFUSER à la création un port déjà attribué à un autre projet ;
 *  3. DÉTECTER les conflits (deux projets, un même port) pour les dire à
 *     l'écran — un conflit se signale, il ne s'efface pas en silence ;
 *  4. RETENIR, pour un projet d'avant cette règle, le port RÉELLEMENT servi.
 */

/**
 * La plage des projets : celle que le lanceur (`ensure-port.sh`, base 15000)
 * et la lecture des vhosts (`portsDansVhost`) connaissent déjà. Les services
 * voisins (Centrifugo 8002, serveur vidéo 8888) vivent en dessous et ne sont
 * jamais pris pour le port d'un projet.
 */
export const PLAGE_PORTS_PROJETS = { min: 15000, max: 19999 } as const;

/** Un port est-il dans la plage des projets ? */
export function portDansLaPlage(port: number | null | undefined): port is number {
  return (
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= PLAGE_PORTS_PROJETS.min &&
    port <= PLAGE_PORTS_PROJETS.max
  );
}

/** Ce qu'on lit d'un projet pour raisonner sur son port : rien d'autre. */
export interface ProjetPorteur {
  id: string;
  name: string;
  port?: number | null;
}

/**
 * CHOISIR UN PORT LIBRE ET UNIQUE.
 *
 * Le port PRÉFÉRÉ passe d'abord s'il est libre (dans la plage, attribué à
 * personne, écouté par personne) ; sinon le premier numéro libre depuis le bas
 * de la plage — la même habitude que le lanceur, pour que les deux bouts de la
 * chaîne tombent sur les mêmes numéros. `null` si la plage entière est prise :
 * on ne sort JAMAIS de la plage pour « trouver quand même ».
 */
export function choisirPortLibre(entree: {
  /** Les ports déjà attribués aux AUTRES projets. */
  attribues: readonly (number | null | undefined)[];
  /** Les ports constatés en écoute sur la machine, quel que soit leur porteur. */
  enEcoute: readonly number[];
  prefere?: number | null;
}): number | null {
  const pris = new Set<number>();
  for (const port of [...entree.attribues, ...entree.enEcoute]) {
    if (typeof port === 'number') pris.add(port);
  }
  if (portDansLaPlage(entree.prefere) && !pris.has(entree.prefere)) return entree.prefere;
  for (let port = PLAGE_PORTS_PROJETS.min; port <= PLAGE_PORTS_PROJETS.max; port += 1) {
    if (!pris.has(port)) return port;
  }
  return null;
}

/**
 * LE PROJET QUI PORTE DÉJÀ CE PORT, s'il y en a un autre que `sauf`.
 *
 * Sert au refus de la création comme à l'avertissement des réglages : la même
 * lecture, pour que l'écran et le serveur ne se contredisent jamais.
 */
export function projetQuiPorteLePort<P extends ProjetPorteur>(
  port: number | null | undefined,
  projets: readonly P[],
  sauf?: string,
): P | null {
  if (typeof port !== 'number') return null;
  return projets.find((projet) => projet.id !== sauf && projet.port === port) ?? null;
}

/** Le refus d'un port déjà attribué, en français simple — ou `null` s'il est libre. */
export function refusPortDejaAttribue(
  port: number | null | undefined,
  projets: readonly ProjetPorteur[],
  sauf?: string,
): string | null {
  const porteur = projetQuiPorteLePort(port, projets, sauf);
  return porteur ? `le port ${port} est déjà attribué au projet « ${porteur.name} »` : null;
}

/** Le port retenu pour un projet d'avant la règle, et d'où vient ce numéro. */
export interface PortRattrape {
  port: number;
  origine: 'constaté en écoute' | 'lu sur le vhost Caddy du projet' | 'déclaré par l’unité systemd';
}

/**
 * LE RATTRAPAGE D'UN PROJET SANS PORT : on enregistre ce qui est RÉELLEMENT
 * servi, jamais un numéro inventé.
 *
 * Les mêmes paliers que la publication, dans le même ordre : la socket
 * constatée, puis le vhost, puis l'unité. Dans chaque palier, le numéro que
 * les autres revendiquent aussi passe devant (le vhost et l'unité qui
 * désignent la même socket). Un port déjà attribué à un AUTRE projet n'est
 * jamais retenu : l'enregistrer créerait le conflit qu'on cherche à éviter —
 * l'appelant le dit dans le journal et laisse le projet sans port.
 */
export function portARattraper(lu: {
  constates: readonly number[];
  vhost: readonly number[];
  declare: number | null;
  /** Les ports déjà attribués aux autres projets. */
  attribues: readonly (number | null | undefined)[];
}): PortRattrape | null {
  const pris = new Set(lu.attribues.filter((p): p is number => typeof p === 'number'));
  const poids = (port: number) => (port === lu.declare ? 0 : lu.vhost.includes(port) ? 1 : 2);
  const premier = (ports: readonly number[]) =>
    [...ports].filter((port) => portDansLaPlage(port) && !pris.has(port)).sort((a, b) => poids(a) - poids(b) || a - b)[0];
  const constate = premier(lu.constates);
  if (constate !== undefined) return { port: constate, origine: 'constaté en écoute' };
  const vhost = premier(lu.vhost);
  if (vhost !== undefined) return { port: vhost, origine: 'lu sur le vhost Caddy du projet' };
  const declare = lu.declare !== null ? premier([lu.declare]) : undefined;
  return declare !== undefined ? { port: declare, origine: 'déclaré par l’unité systemd' } : null;
}

/**
 * TOUS les ports locaux visés par un fichier Caddy, sans filtre de plage : pour
 * CHOISIR un port neuf, un numéro promis à n'importe quel service est à éviter.
 */
export function portsDansVhostCaddy(texte: string): number[] {
  const ports = new Set<number>();
  for (const m of texte.matchAll(/reverse_proxy\s+(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/g)) {
    ports.add(Number(m[1]));
  }
  return [...ports].sort((a, b) => a - b);
}

/** Les ports TCP en écoute lus dans la sortie de `ss -ltnH` (colonne locale). */
export function portsEnEcouteDansSs(sortieSs: string): number[] {
  const ports = new Set<number>();
  for (const ligne of sortieSs.split('\n')) {
    const locale = ligne.trim().split(/\s+/)[3] ?? '';
    const port = Number(locale.slice(locale.lastIndexOf(':') + 1));
    if (Number.isInteger(port) && port > 0) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}
