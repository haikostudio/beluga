/**
 * LE MIROIR DE NUIT DES DOSSIERS DE PROJETS.
 *
 * Les dix-neuf dossiers de projets ont quitté la Storage Box pour le disque du
 * serveur : lire l'état d'un projet est passé de près de trois minutes à une
 * fraction de seconde. Mais ils étaient, par ce seul fait d'être ailleurs,
 * sauvegardés hors machine. Ce filet-là ne doit pas tomber avec le
 * déménagement : chaque nuit, chaque dossier local est recopié à sa place
 * d'origine sur le stockage distant.
 *
 * La copie passe par le PROTOCOLE RSYNC du stockage, jamais par son montage :
 * mesuré le 21.09.2026, 159 Mo en 6 s par le protocole, contre une vingtaine
 * de minutes par le montage. Et elle laisse de côté tout ce qui se réinstalle
 * (`EXCLUS_DU_MIROIR`) — 95 % des fichiers, zéro information.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ANCIENNE_RACINE_DU_MIROIR,
  RACINE_DU_MIROIR,
  argumentsDuMiroir,
  doitPasserLaNuit,
  estSystemeDeFichiersDistant,
  lireLesMontages,
  projetsAMirrorer,
  typeDuSystemeDeFichiers,
  sansRegroupements,
} from '@beluga/shared';
import { ROOT } from './config.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { listProjects } from './store.js';

const execFileAsync = promisify(execFile);

const CLE_DERNIER_PASSAGE = 'miroir-projets.nuit';
const VEILLE_MS = 10 * 60 * 1000;
/** Une copie de projet ne doit pas retenir la nuit entière. */
const DELAI_MAX_PAR_PROJET_MS = 20 * 60 * 1000;

/** Le stockage où les projets sont recopiés, et la clé qui l'ouvre. */
function destination(): { hote: string; port: string; cle: string; racine: string } {
  return {
    hote: process.env.BELUGA_MIROIR_HOTE?.trim() || 'u000000@u000000.your-storagebox.de',
    port: process.env.BELUGA_MIROIR_PORT?.trim() || '23',
    cle: process.env.BELUGA_MIROIR_CLE?.trim() || '/home/utilisateur/.ssh/id_ed25519_sauvegarde',
    racine: process.env.BELUGA_MIROIR_RACINE?.trim() || RACINE_DU_MIROIR,
  };
}

/** Le stockage distant, vu par son montage local (le même espace que l'hôte rsync). */
const MONTAGE_DU_STOCKAGE = '/mnt/sauvegardes';

/**
 * L'ANCIEN NOM PASSE AU NOUVEAU, UNE SEULE FOIS : « Beluga » devient
 * « miroir-des-projets » par un simple renommage sur le stockage (instantané).
 * Sans lui, le premier passage sous le nouveau nom recopierait tout de zéro
 * (17 Go) et laisserait l'ancien à côté. Rien n'est tenté si le nouveau nom est
 * déjà pris, si le stockage n'est pas monté, ou si une racine est imposée.
 */
export function passerLeMiroirAuNouveauNom(montage = MONTAGE_DU_STOCKAGE, racine = destination().racine): string | null {
  if (racine !== RACINE_DU_MIROIR) return null;
  try {
    if (montage === MONTAGE_DU_STOCKAGE) {
      const montages = fs.readFileSync('/proc/mounts', 'utf8');
      if (!montages.split('\n').some((l) => l.split(' ')[1] === montage)) return null;
    }
    const ancien = path.join(montage, ANCIENNE_RACINE_DU_MIROIR);
    const neuf = path.join(montage, RACINE_DU_MIROIR);
    if (!fs.existsSync(ancien) || fs.existsSync(neuf)) return null;
    fs.renameSync(ancien, neuf);
    log.info(`miroir des projets : « ${ancien} » renommé « ${neuf} »`);
    return neuf;
  } catch (err) {
    log.warn(`miroir des projets : renommage de l'ancien dossier impossible — ${(err as Error).message}`);
    return null;
  }
}

/** Ce dossier est-il posé sur le disque de la machine (et non sur un montage réseau) ? */
function estLocal(chemin: string): boolean {
  let montages: ReturnType<typeof lireLesMontages> = [];
  try {
    montages = lireLesMontages(fs.readFileSync('/proc/mounts', 'utf8'));
  } catch {
    return false;
  }
  let reel = chemin;
  try {
    reel = fs.realpathSync(chemin);
  } catch {
    reel = path.resolve(chemin);
  }
  return !estSystemeDeFichiersDistant(typeDuSystemeDeFichiers(reel, montages));
}

/** Recopie tous les dossiers de projets locaux vers le stockage distant. */
export async function passageDuMiroir(): Promise<{ copies: number; echecs: string[] }> {
  const cible = destination();
  if (!fs.existsSync(cible.cle)) {
    log.warn(`miroir des projets : la clé « ${cible.cle} » est introuvable — aucune copie ce soir`);
    return { copies: 0, echecs: ['clé introuvable'] };
  }
  passerLeMiroirAuNouveauNom();
  const projets = projetsAMirrorer(sansRegroupements(listProjects()), estLocal, cible.racine, ROOT);
  const echecs: string[] = [];
  let copies = 0;
  for (const projet of projets) {
    const args = argumentsDuMiroir(projet, `${cible.hote}:`);
    try {
      await execFileAsync(
        'rsync',
        ['-e', `ssh -p ${cible.port} -i ${cible.cle} -o StrictHostKeyChecking=accept-new`, ...args],
        { timeout: DELAI_MAX_PAR_PROJET_MS, maxBuffer: 8 * 1024 * 1024 },
      );
      copies += 1;
    } catch (err) {
      const message = (err as Error).message.split('\n')[0];
      log.warn(`miroir des projets : « ${projet.nom} » non copié — ${message}`);
      echecs.push(projet.nom);
    }
  }
  log.info(`miroir des projets : ${copies} dossier(s) recopié(s)${echecs.length ? `, ${echecs.length} en échec` : ''}`);
  return { copies, echecs };
}

/** Une fois par nuit, dans la même fenêtre que les autres travaux lourds. */
export async function passageDeNuitDuMiroir(maintenant = new Date()): Promise<boolean> {
  const dernier = Number(getMeta(CLE_DERNIER_PASSAGE) ?? 0) || undefined;
  if (!doitPasserLaNuit(maintenant, dernier)) return false;
  setMeta(CLE_DERNIER_PASSAGE, String(maintenant.getTime()));
  await passageDuMiroir();
  return true;
}

export function planifierLeMiroirDesProjets(): NodeJS.Timeout {
  // Au démarrage, aucune copie ne tourne encore : le nouveau nom se pose tout de suite.
  passerLeMiroirAuNouveauNom();
  return setInterval(() => {
    passageDeNuitDuMiroir().catch((err) => log.warn(`miroir des projets : passage sauté — ${(err as Error).message}`));
  }, VEILLE_MS);
}
