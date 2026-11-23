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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  blocCaddyGardeRobots,
  fichierTraefikGardeRobots,
  estAdresseDeTravail,
  memeReglageRobots,
  reglageRobotsLu,
  reglageRobotsParDefaut,
  reglageApplicable,
  type ApplicationDuReglage,
  type EtatDesRobots,
  type ReglageParticulier,
  type ReglageRobots,
} from '@beluga/shared';
/* La base et le magasin des projets se chargent À LA DEMANDE : ce fichier sert aussi au contrôle lancé hors du démon
   (scripts/controle-securite.mjs), qui n'ouvre aucune base. */
const db = () => import('./db.js');
const magasin = () => import('./store.js');
const journal = () => import('./logger.js');

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

/* ------------------------------------------------------------------------------------------------------------------
 * L'ACCÈS DES ROBOTS, RÉGLÉ SITE PAR SITE (carte « Sécurité, rapports et marketing restructurés », 22/11/2026).
 *
 * Le réglage vit en base (`meta`, clé `securite.robots.<projet>`), un par projet, pour l'hôte de son adresse (celle que
 * l'audit lit). L'appliquer, c'est RÉGÉNÉRER la garde commune avec les sites au réglage particulier :
 *   - serveur Beluga : `/etc/caddy/garde-robots.caddy` réécrit (copie `.precedent` gardée), `caddy validate`, puis
 *     `systemctl reload caddy` — JAMAIS restart ; un fichier refusé est remis tel qu'il était, sans recharger ;
 *   - serveur Clients : `/opt/traefik/dynamic/garde-robots.yml` par SSH, seulement si la garde y est installée
 *     (Traefik relit son dossier tout seul).
 * Un fichier identique n'est ni réécrit ni rechargé. `BELUGA_GARDE_ROBOTS_CADDY` (chemin) détourne l'écriture vers un
 * fichier d'essai validé par `caddy adapt`, sans rien recharger : les contrôles à démon jetable ne touchent jamais le
 * vrai serveur.
 * ---------------------------------------------------------------------------------------------------------------- */


const FICHIER_CADDY = '/etc/caddy/garde-robots.caddy';
const CADDYFILE = '/etc/caddy/Caddyfile';
const FICHIER_TRAEFIK = '/opt/traefik/dynamic/garde-robots.yml';
const cleDuReglage = (projectId: string) => `securite.robots.${projectId}`;

async function adresseDuProjet(projectId: string): Promise<string | null> {
  const projet = (await magasin()).getProject(projectId);
  return projet?.adresseProduction || projet?.devUrl || null;
}

function hoteDeLAdresse(adresse: string | null): string | null {
  if (!adresse) return null;
  try {
    return new URL(adresse).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Le réglage ENREGISTRÉ d'un projet (null : aucun, le site garde sa protection d'avant). */
async function reglageEnregistre(projectId: string, hote: string): Promise<ReglageRobots | null> {
  const brut = (await db()).getMeta(cleDuReglage(projectId));
  if (!brut) return null;
  try {
    return reglageRobotsLu(JSON.parse(brut), hote);
  } catch {
    return null;
  }
}

/** Le réglage d'un projet À APPLIQUER par l'audit : seulement s'il en a un à lui, différent de la valeur par défaut. */
export async function reglageParticulierDuProjet(projectId: string): Promise<ReglageRobots | null> {
  const hote = hoteDeLAdresse(await adresseDuProjet(projectId));
  if (!hote) return null;
  const r = await reglageEnregistre(projectId, hote);
  return r && !memeReglageRobots(r, reglageRobotsParDefaut(hote)) ? r : null;
}

/** La garde Traefik est-elle installée sur le serveur Clients ? Relu au plus toutes les 10 minutes. */
let gardeClients: { vu: number; installee: boolean | null } | null = null;
async function gardeClientsInstallee(): Promise<boolean | null> {
  if (gardeClients && Date.now() - gardeClients.vu < 10 * 60_000) return gardeClients.installee;
  const r = await lancer(
    'ssh',
    ['-i', CLE_SSH, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', `${COMPTE_SSH}@${IP_DES_SERVEURS.clients}`, 'test', '-d', path.dirname(FICHIER_TRAEFIK)],
    15_000,
  );
  const installee = r.code === 0 ? true : r.code === 1 ? false : null;
  gardeClients = { vu: Date.now(), installee };
  return installee;
}

async function applicationPour(adresse: string | null, hote: string | null): Promise<ApplicationDuReglage> {
  if (!adresse || !hote) return 'sans-adresse';
  if (estAdresseDeTravail(hote)) return 'serveur-beluga';
  const serveur = await serveurDeLAdresse(adresse);
  if (serveur === 'beluga') return 'serveur-beluga';
  if (serveur === 'clients') return (await gardeClientsInstallee()) ? 'serveur-clients' : 'garde-absente';
  return 'hors-serveurs';
}

export async function etatDesRobots(projectId: string): Promise<EtatDesRobots> {
  const adresse = await adresseDuProjet(projectId);
  const hote = hoteDeLAdresse(adresse);
  const application = await applicationPour(adresse, hote);
  const enregistre = hote ? await reglageEnregistre(projectId, hote) : null;
  const reglage = enregistre ?? (hote ? reglageRobotsParDefaut(hote) : reglageRobotsParDefaut('site.invalid'));
  return {
    adresse,
    hote,
    reglage,
    parDefaut: !enregistre || (!!hote && memeReglageRobots(enregistre, reglageRobotsParDefaut(hote))),
    application,
    reglable: reglageApplicable(application),
    moteursReglables: application === 'serveur-beluga',
  };
}

/** Les sites au réglage particulier, rangés par serveur. */
async function sitesParticuliers(): Promise<{ beluga: ReglageParticulier[]; clients: ReglageParticulier[] }> {
  const beluga: ReglageParticulier[] = [];
  const clients: ReglageParticulier[] = [];
  for (const projet of (await magasin()).listProjects()) {
    const particulier = await reglageParticulierDuProjet(projet.id);
    if (!particulier) continue;
    const adresse = await adresseDuProjet(projet.id);
    const hote = hoteDeLAdresse(adresse);
    if (!hote) continue;
    const application = await applicationPour(adresse, hote);
    if (application === 'serveur-beluga') beluga.push({ hotes: [hote], reglage: particulier });
    else if (application === 'serveur-clients' || application === 'garde-absente') clients.push({ hotes: [hote], reglage: particulier });
  }
  return { beluga, clients };
}

/** Écrit et recharge la garde Caddy si elle change. */
async function appliquerSurCaddy(texte: string): Promise<'inchange' | 'applique'> {
  const essai = process.env.BELUGA_GARDE_ROBOTS_CADDY;
  const cible = essai || FICHIER_CADDY;
  let actuel = '';
  try {
    actuel = fs.readFileSync(cible, 'utf8');
  } catch {
    /* absent : on l'écrit */
  }
  if (actuel === texte) return 'inchange';
  const tmp = path.join(os.tmpdir(), `garde-robots-${process.pid}-${Date.now()}.caddy`);
  fs.writeFileSync(tmp, texte);
  try {
    if (essai) {
      /* FICHIER D'ESSAI : validé seul, par un Caddyfile minimal qui l'importe ; aucun serveur rechargé. */
      const conf = path.join(os.tmpdir(), `Caddyfile-essai-${process.pid}-${Date.now()}`);
      fs.writeFileSync(conf, `{\n\tadmin off\n}\nimport ${tmp}\nhttp://essai.invalid {\n\timport garde-robots\n\trespond "ok"\n}\n`);
      const v = await lancer('caddy', ['adapt', '--config', conf], 30_000);
      fs.rmSync(conf, { force: true });
      if (v.code !== 0) throw new Error(`configuration refusée : ${(v.stderr || v.stdout).trim().slice(-300)}`);
      fs.writeFileSync(cible, texte);
      return 'applique';
    }
    const precedent = `${FICHIER_CADDY}.precedent`;
    const copie = await lancer('sudo', ['-n', 'cp', '-a', FICHIER_CADDY, precedent]);
    if (copie.code !== 0) throw new Error(`copie de sauvegarde impossible : ${copie.stderr.trim()}`);
    const pose = await lancer('sudo', ['-n', 'install', '-m', '644', tmp, FICHIER_CADDY]);
    if (pose.code !== 0) throw new Error(`écriture impossible : ${pose.stderr.trim()}`);
    const v = await lancer('sudo', ['-n', 'caddy', 'validate', '--config', CADDYFILE], 60_000);
    if (v.code !== 0) {
      await lancer('sudo', ['-n', 'cp', '-a', precedent, FICHIER_CADDY]);
      throw new Error(`configuration refusée par Caddy, rien n'a changé : ${(v.stderr || v.stdout).trim().slice(-300)}`);
    }
    const r = await lancer('sudo', ['-n', 'systemctl', 'reload', 'caddy'], 60_000);
    if (r.code !== 0) throw new Error(`rechargement refusé : ${(r.stderr || r.stdout).trim().slice(-300)}`);
    return 'applique';
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Pose la garde Traefik sur le serveur Clients, si elle y est installée et qu'elle change. */
async function appliquerSurTraefik(texte: string): Promise<'inchange' | 'applique' | 'absente'> {
  if (process.env.BELUGA_GARDE_ROBOTS_CADDY) return 'absente';
  if (!(await gardeClientsInstallee())) return 'absente';
  const hote = `${COMPTE_SSH}@${IP_DES_SERVEURS.clients}`;
  const ssh = ['-i', CLE_SSH, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', hote];
  const lu = await lancer('ssh', [...ssh, 'cat', FICHIER_TRAEFIK]);
  if (lu.code === 0 && lu.stdout === texte) return 'inchange';
  const tmp = path.join(os.tmpdir(), `garde-robots-${process.pid}-${Date.now()}.yml`);
  fs.writeFileSync(tmp, texte);
  try {
    const envoi = await lancer('scp', ['-q', '-i', CLE_SSH, '-o', 'BatchMode=yes', tmp, `${hote}:/tmp/garde-robots.yml`], 30_000);
    if (envoi.code !== 0) throw new Error(`envoi impossible : ${envoi.stderr.trim()}`);
    const pose = await lancer('ssh', [...ssh, 'sudo', '-n', 'install', '-m', '644', '/tmp/garde-robots.yml', FICHIER_TRAEFIK]);
    if (pose.code !== 0) throw new Error(`écriture impossible : ${pose.stderr.trim()}`);
    return 'applique';
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Régénère la garde des deux serveurs depuis tous les réglages enregistrés. */
export async function appliquerLesReglagesDeRobots(): Promise<{ caddy: string; traefik: string }> {
  const { beluga, clients } = await sitesParticuliers();
  const caddy = await appliquerSurCaddy(blocCaddyGardeRobots(undefined, beluga));
  const traefik = await appliquerSurTraefik(fichierTraefikGardeRobots('websecure', undefined, clients));
  (await journal()).log.info(`garde des robots : Caddy ${caddy} (${beluga.length} site(s) réglé(s)), Traefik ${traefik} (${clients.length})`);
  return { caddy, traefik };
}

/** Enregistre le réglage d'un projet et l'applique sur son serveur. Un échec remet l'ancien réglage. */
export async function reglerLesRobots(projectId: string, brut: unknown): Promise<EtatDesRobots> {
  const avant = await etatDesRobots(projectId);
  if (!avant.hote) throw new Error("le projet n'a pas d'adresse");
  if (!avant.reglable) throw new Error('ce site est servi ailleurs : il gère ses robots lui-même');
  const reglage = reglageRobotsLu(brut, avant.hote);
  /* Sur le serveur des sites publics, les moteurs se règlent dans le site : la case garde sa valeur. */
  if (!avant.moteursReglables) reglage.moteurs = avant.reglage.moteurs;
  const { getMeta, setMeta } = await db();
  const ancien = getMeta(cleDuReglage(projectId));
  setMeta(cleDuReglage(projectId), JSON.stringify(reglage));
  try {
    await appliquerLesReglagesDeRobots();
  } catch (e) {
    setMeta(cleDuReglage(projectId), ancien ?? '');
    throw e;
  }
  return etatDesRobots(projectId);
}
