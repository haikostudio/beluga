/**
 * LA PROTECTION CONTRE LES ROBOTS — LES RELEVÉS (carte « Anti-robots et référencement des projets », 18/11/2026).
 *
 * Ce fichier ne juge rien (les règles vivent dans shared/src/garde-des-robots.ts) : il relève ce qu'un faux robot
 * d'entraînement d'IA, un faux robot de recherche d'IA et un faux Googlebot reçoivent, quel serveur sert l'adresse, si le garde des visiteurs insistants (fail2ban)
 * y tourne, la liste des adresses bloquées, et il LÈVE un bannissement (« Libérer »).
 *
 * Serveur Beluga : fail2ban en local (sudo sans mot de passe du compte du démon). Serveur Clients : par SSH,
 * deploy@46.224.231.253 avec la clé de l'administrateur (MEM-1180). Rien ici n'envoie une salve de requêtes : le
 * serveur Beluga est sur liste blanche, une salve d'ici ne prouverait rien.
 */

import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import {
  bannisDeFail2ban,
  ipValide,
  prisonsDuGarde,
  regrouperLesBannis,
  serveurDeLIp,
  UA_ESSAI_GOOGLEBOT,
  UA_ESSAI_ROBOT_IA,
  UA_ESSAI_ROBOT_RECHERCHE_IA,
  IP_DES_SERVEURS,
  type ReleveDesRobots,
  type ReponseDeRobot,
  type ServeurDesSites,
  type VisiteurBloque,
} from '@beluga/shared';

const CLE_SSH = process.env.BELUGA_CLE_SSH_CLIENTS || '/home/utilisateur/.ssh/id_ed25519_haiko';
const COMPTE_SSH = process.env.BELUGA_COMPTE_SSH_CLIENTS || 'deploy';

interface Sortie {
  code: number;
  stdout: string;
  stderr: string;
}

function lancer(cmd: string, args: string[], delai = 20_000): Promise<Sortie> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: delai, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** fail2ban-client, sur le serveur visé. Les arguments sont fixes ou une IP déjà validée : rien d'autre ne passe. */
function fail2ban(serveur: ServeurDesSites, args: string[], delai = 20_000): Promise<Sortie> {
  if (serveur === 'beluga') return lancer('sudo', ['-n', 'fail2ban-client', ...args], delai);
  return lancer(
    'ssh',
    ['-i', CLE_SSH, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${COMPTE_SSH}@${IP_DES_SERVEURS.clients}`, 'sudo', '-n', 'fail2ban-client', ...args],
    delai,
  );
}

/** Ce qu'un User-Agent donné reçoit, sans suivre les renvois. */
async function demander(adresse: string, userAgent: string): Promise<ReponseDeRobot | null> {
  try {
    const r = await fetch(adresse, { redirect: 'manual', headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(15_000) });
    await r.body?.cancel().catch(() => {});
    return { statut: r.status, vers: r.headers.get('location'), xRobotsTag: r.headers.get('x-robots-tag') };
  } catch {
    return null;
  }
}

/** Le serveur qui sert l'adresse, d'après son adresse IP. null : ailleurs (relais, autre hébergeur) ou introuvable. */
export async function serveurDeLAdresse(adresse: string): Promise<ServeurDesSites | null> {
  try {
    const { address } = await lookup(new URL(adresse).hostname, { family: 4 });
    return serveurDeLIp(address);
  } catch {
    return null;
  }
}

/** Les prisons du garde web qui tournent sur ce serveur ; null si le serveur ne répond pas. */
export async function prisonsActives(serveur: ServeurDesSites): Promise<string[] | null> {
  const r = await fail2ban(serveur, ['status']);
  if (r.code !== 0) return null;
  return prisonsDuGarde(r.stdout);
}

export async function releverLesRobots(adresse: string): Promise<ReleveDesRobots> {
  const [ia, recherche, google, serveur] = await Promise.all([
    demander(adresse, UA_ESSAI_ROBOT_IA),
    demander(adresse, UA_ESSAI_ROBOT_RECHERCHE_IA),
    demander(adresse, UA_ESSAI_GOOGLEBOT),
    serveurDeLAdresse(adresse),
  ]);
  let gardeActif: boolean | null = null;
  if (serveur) {
    const prisons = await prisonsActives(serveur);
    gardeActif = prisons === null ? null : prisons.length > 0;
  }
  return { adresse, ia, recherche, google, serveur, gardeActif };
}

export interface VisiteursBloques {
  serveur: ServeurDesSites | null;
  /** Le garde tourne-t-il ? null = serveur inconnu ou injoignable. */
  gardeActif: boolean | null;
  visiteurs: VisiteurBloque[];
  /** Pourquoi la liste est vide sans être « rien à signaler ». */
  note?: string;
}

/** Les adresses bloquées sur le serveur qui sert l'adresse du projet (un bannissement vaut pour tout le serveur). */
export async function visiteursBloques(adresse: string | null | undefined): Promise<VisiteursBloques> {
  if (!adresse) return { serveur: null, gardeActif: null, visiteurs: [], note: "le projet n'a pas d'adresse" };
  const serveur = await serveurDeLAdresse(adresse);
  if (!serveur) return { serveur: null, gardeActif: null, visiteurs: [], note: "l'adresse n'est servie par aucun des deux serveurs" };
  const prisons = await prisonsActives(serveur);
  if (prisons === null) return { serveur, gardeActif: null, visiteurs: [], note: 'le serveur ne répond pas' };
  if (!prisons.length) return { serveur, gardeActif: false, visiteurs: [] };
  const sorties = await Promise.all(prisons.map(async (p) => ({ p, r: await fail2ban(serveur, ['get', p, 'banip', '--with-time']) })));
  const tous = sorties.flatMap(({ p, r }) => (r.code === 0 ? bannisDeFail2ban(p, r.stdout, serveur) : []));
  return { serveur, gardeActif: true, visiteurs: regrouperLesBannis(tous) };
}

/** Lève le bannissement d'une adresse sur le serveur du projet, dans TOUTES les prisons. */
export async function libererUnVisiteur(adresse: string | null | undefined, ip: string): Promise<VisiteursBloques> {
  if (!ipValide(ip)) throw new Error('adresse IP invalide');
  if (!adresse) throw new Error("le projet n'a pas d'adresse");
  const serveur = await serveurDeLAdresse(adresse);
  if (!serveur) throw new Error("l'adresse n'est servie par aucun des deux serveurs");
  const r = await fail2ban(serveur, ['unban', ip]);
  if (r.code !== 0) throw new Error(`le serveur a refusé : ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  return visiteursBloques(adresse);
}
