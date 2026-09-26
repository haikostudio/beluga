import fs from 'node:fs';
import { getDb } from './db.js';
import { PATHS } from './config.js';
import { publicationsEnCours } from './demon.js';
import { agentsActifs } from './runtime.js';
import { log } from './logger.js';

/**
 * Compactage de la base vive (PLAN — carte « Compacter la base »). Les quatre
 * `VACUUM INTO` du projet (sauvegarde, export, audit, effacement) écrivent
 * tous une COPIE compactée sans jamais toucher au fichier ouvert par
 * `getDb()` : les pages libérées par les purges s'y accumulent donc sans
 * fin. Un `VACUUM` classique, mesuré à 1,4 s pour rendre 344 Mo sur une copie
 * de la base réelle (582 Mo), est assez court pour tourner directement sur
 * la connexion ouverte, même en mode WAL — pas besoin d'un `auto_vacuum`
 * incrémental, plus complexe et plus lent au quotidien.
 */

const SEUIL_PAGES_LIBRES_OCTETS = 100 * 1024 * 1024; // 100 Mo

export interface ResultatCompactage {
  fait: boolean;
  raison?: string;
  avantOctets?: number;
  apresOctets?: number;
  dureeMs?: number;
}

/**
 * Saute silencieusement (mais en le journalisant) tant qu'une publication ou
 * un agent travaille : même principe que le refus de redémarrage du démon
 * (`decisionDeRedemarrage`), transposé au verrou exclusif d'un VACUUM.
 */
export function compacterLaBase(options: { force?: boolean } = {}): ResultatCompactage {
  const publications = publicationsEnCours();
  if (publications.length > 0) {
    const raison = `publication en cours (${publications.join(', ')})`;
    log.info(`compactage de la base reporté : ${raison}`);
    return { fait: false, raison };
  }
  const agents = agentsActifs();
  if (agents.length > 0) {
    const raison = `${agents.length} agent(s) au travail`;
    log.info(`compactage de la base reporté : ${raison}`);
    return { fait: false, raison };
  }

  const db = getDb();
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  const freelistCount = db.pragma('freelist_count', { simple: true }) as number;
  const freeOctets = pageSize * freelistCount;
  if (!options.force && freeOctets < SEUIL_PAGES_LIBRES_OCTETS) {
    return { fait: false, raison: `${Math.round(freeOctets / 1024 / 1024)} Mo de pages libres, sous le seuil de 100 Mo` };
  }

  const avantOctets = fs.statSync(PATHS.db).size;
  const t0 = Date.now();
  db.exec('VACUUM');
  // En mode WAL (activé par `openDb`), un VACUUM seul rend le fichier
  // logiquement compact mais laisse le résultat dans le journal WAL : le
  // fichier principal ne rétrécit pas tant qu'un checkpoint ne l'a pas
  // reversé. TRUNCATE force ce reversement ET tronque le fichier -wal.
  db.pragma('wal_checkpoint(TRUNCATE)');
  const dureeMs = Date.now() - t0;
  const apresOctets = fs.statSync(PATHS.db).size;
  log.info(
    `base compactée : ${Math.round(avantOctets / 1024 / 1024)} Mo → ${Math.round(apresOctets / 1024 / 1024)} Mo en ${dureeMs} ms`,
  );
  return { fait: true, avantOctets, apresOctets, dureeMs };
}

/**
 * Vers 4 h, entre l'auto-amélioration (3 h) et la capitalisation (5 h) : un
 * contrôle toutes les cinq minutes, comme la sauvegarde nocturne, une seule
 * tentative par jour.
 */
export function planifierCompactage(): NodeJS.Timeout {
  let lastDay = -1;
  return setInterval(
    () => {
      const now = new Date();
      if (now.getHours() === 4 && now.getDate() !== lastDay) {
        lastDay = now.getDate();
        try {
          compacterLaBase();
        } catch (err: any) {
          log.warn('compactage nocturne impossible', err?.message ?? err);
        }
      }
    },
    5 * 60 * 1000,
  );
}
