import fs from 'node:fs';
import { getDb } from './db.js';
import { PATHS } from './config.js';
import { publicationsEnCours } from './demon.js';
import { agentsActifs } from './runtime.js';
import { log } from './logger.js';
import { octetsVidesEnAttente, remettreLaPlaceVideeAZero } from './journal-carte.js';

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
  /** Un agent ou une publication bloque : à retenter plus tard dans la nuit. */
  reporte?: boolean;
  /** Rien à faire : sous le seuil, le jour est consommé. */
  sousLeSeuil?: boolean;
}

/**
 * Saute silencieusement (mais en le journalisant) tant qu'une publication ou
 * un agent travaille : même principe que le refus de redémarrage du démon
 * (`decisionDeRedemarrage`), transposé au verrou exclusif d'un VACUUM.
 */
export function compacterLaBase(options: { force?: boolean; silencieux?: boolean } = {}): ResultatCompactage {
  const publications = publicationsEnCours();
  if (publications.length > 0) {
    const raison = `publication en cours (${publications.join(', ')})`;
    if (!options.silencieux) log.info(`compactage de la base reporté : ${raison}`);
    return { fait: false, raison, reporte: true };
  }
  const agents = agentsActifs();
  if (agents.length > 0) {
    const raison = `${agents.length} agent(s) au travail`;
    if (!options.silencieux) log.info(`compactage de la base reporté : ${raison}`);
    return { fait: false, raison, reporte: true };
  }

  const db = getDb();
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  const freelistCount = db.pragma('freelist_count', { simple: true }) as number;
  const freeOctets = pageSize * freelistCount;
  // L'allègement des journaux vide des lignes sans rien rendre à la liste des
  // pages libres : on ajoute la place qu'il a comptée (cumul dans `meta`).
  const videsOctets = octetsVidesEnAttente();
  if (!options.force && freeOctets + videsOctets < SEUIL_PAGES_LIBRES_OCTETS) {
    return {
      fait: false,
      sousLeSeuil: true,
      raison: `${Math.round(freeOctets / 1024 / 1024)} Mo de pages libres + ${Math.round(videsOctets / 1024 / 1024)} Mo vidés par l'allègement, sous le seuil de 100 Mo`,
    };
  }

  const avantOctets = fs.statSync(PATHS.db).size;
  const t0 = Date.now();
  db.exec('VACUUM');
  // En mode WAL (activé par `openDb`), un VACUUM seul rend le fichier
  // logiquement compact mais laisse le résultat dans le journal WAL : le
  // fichier principal ne rétrécit pas tant qu'un checkpoint ne l'a pas
  // reversé. TRUNCATE force ce reversement ET tronque le fichier -wal.
  db.pragma('wal_checkpoint(TRUNCATE)');
  remettreLaPlaceVideeAZero();
  const dureeMs = Date.now() - t0;
  const apresOctets = fs.statSync(PATHS.db).size;
  log.info(
    `base compactée : ${Math.round(avantOctets / 1024 / 1024)} Mo → ${Math.round(apresOctets / 1024 / 1024)} Mo en ${dureeMs} ms`,
  );
  return { fait: true, avantOctets, apresOctets, dureeMs };
}

export const HEURE_DEBUT_COMPACTAGE = 4;
export const HEURE_FIN_COMPACTAGE = 8; // exclue : le ménage des compétences démarre à 5 h et peut occuper un agent

/** Clé du jour AAAA-MM-JJ (un jour du mois seul reviendrait chaque mois). */
export function cleDuJour(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export interface EtatDeNuit {
  /** Dernier jour réglé : compacté, ou jugé inutile. */
  dernierJour: string | null;
  /** Dernier jour où un report ou un passage sous le seuil a été journalisé. */
  dernierJourJournalise: string | null;
}

/** Faut-il tenter un passage maintenant ? Fonction pure. */
export function ilFautEssayer(now: Date, dernierJour: string | null): boolean {
  const h = now.getHours();
  return h >= HEURE_DEBUT_COMPACTAGE && h < HEURE_FIN_COMPACTAGE && cleDuJour(now) !== dernierJour;
}

/**
 * Un passage de nuit. Le jour n'est consommé que si le compactage est fait ou
 * jugé inutile ; un report (agent, publication) se retente au passage suivant.
 * Une trace par nuit au plus pour un report ou un essai sous le seuil.
 */
export function passerLaNuit(
  now: Date,
  etat: EtatDeNuit,
  compacter: (o: { silencieux: boolean }) => ResultatCompactage = compacterLaBase,
): void {
  if (!ilFautEssayer(now, etat.dernierJour)) return;
  const jour = cleDuJour(now);
  const premiereTrace = etat.dernierJourJournalise !== jour;
  const res = compacter({ silencieux: true });
  if (res.fait) {
    etat.dernierJour = jour;
    return;
  }
  if (premiereTrace) {
    etat.dernierJourJournalise = jour;
    log.info(
      res.sousLeSeuil
        ? `compactage de la base inutile cette nuit : ${res.raison}`
        : `compactage de la base reporté, nouvel essai dans 5 min : ${res.raison}`,
    );
  }
  if (res.sousLeSeuil) etat.dernierJour = jour;
}

/**
 * Entre 4 h et 8 h, un contrôle toutes les cinq minutes (comme la sauvegarde
 * nocturne) : l'agent d'auto-amélioration (3 h) tourne souvent encore à 4 h et
 * le ménage des compétences prend des places dès 5 h, donc un report se
 * retente jusqu'à ce que la base soit compactée ou jugée sous le seuil.
 */
export function planifierCompactage(): NodeJS.Timeout {
  const etat: EtatDeNuit = { dernierJour: null, dernierJourJournalise: null };
  return setInterval(
    () => {
      try {
        passerLaNuit(new Date(), etat);
      } catch (err: any) {
        log.warn('compactage nocturne impossible', err?.message ?? err);
      }
    },
    5 * 60 * 1000,
  );
}
