import { PORTEE_GLOBALE, doitPasserLaNuit, sansRegroupements } from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { listProjects } from './store.js';
import { completerLesVecteurs, importerLesLots, rendreLesFichiers, unitesARelire } from './connaissances.js';

/**
 * LE PASSAGE DE NUIT DE LA BASE DE CONNAISSANCES, ET SA REPRISE AU DÉMARRAGE.
 *
 * Une unité écrite en journée entre TOUT DE SUITE en base, se trouve aussitôt
 * par le plein texte, et ses fichiers sont rendus dans la foulée. La nuit ne
 * sert qu'aux travaux LOURDS : recalculer les vecteurs manquants et relever les
 * unités écrites par les agents depuis la veille, que l'analyse de nuit relit.
 *
 * AU DÉMARRAGE, les lots de la génération (`scripts/generer-connaissances.mjs`)
 * pas encore importés passent par la porte d'écriture, et les fichiers
 * `data/MEMORY/` de chaque portée sont rendus.
 */

const CLE_DERNIER_PASSAGE = 'connaissances.nuit';
const CLE_A_RELIRE = 'connaissances.a-relire';
const VEILLE_MS = 10 * 60 * 1000;

function projetsActifs() {
  // Un projet réuni n'a pas de dépôt : ses membres passent la nuit chacun de leur côté.
  return sansRegroupements(listProjects()).filter((p) => !p.archived);
}

export async function passageDeNuit(maintenant = new Date()): Promise<boolean> {
  const dernier = Number(getMeta(CLE_DERNIER_PASSAGE) ?? 0) || undefined;
  if (!doitPasserLaNuit(maintenant, dernier)) return false;
  setMeta(CLE_DERNIER_PASSAGE, String(maintenant.getTime()));
  const vecteurs = await completerLesVecteurs();
  const aRelire = unitesARelire(maintenant.getTime()).map((u) => ({ id: u.id, portee: u.portee, titre: u.titre, auteur: u.auteur }));
  setMeta(CLE_A_RELIRE, JSON.stringify(aRelire));
  log.info(`base de connaissances, nuit : ${vecteurs} unité(s) vectorisée(s), ${aRelire.length} unité(s) à relire`);
  return true;
}

/** Les unités relevées au dernier passage de nuit, pour la consigne de l'agent d'analyse. */
export function unitesARelireCetteNuit(): { id: string; portee: string; titre: string; auteur: string }[] {
  try {
    return JSON.parse(getMeta(CLE_A_RELIRE) ?? '[]');
  } catch {
    return [];
  }
}

export async function repriseAuDemarrage(): Promise<void> {
  importerLesLots();
  for (const portee of [PORTEE_GLOBALE, ...projetsActifs().map((p) => p.id)]) {
    try {
      rendreLesFichiers(portee);
    } catch (err) {
      log.warn(`base de connaissances : fichiers de ${portee} non rendus (${(err as Error).message})`);
    }
  }
  await completerLesVecteurs();
}

export function planifierLaMemoireDeNuit(): NodeJS.Timeout[] {
  const reprise = setTimeout(() => {
    repriseAuDemarrage().catch((err) => log.warn(`base de connaissances : reprise sautée — ${(err as Error).message}`));
  }, 60_000);
  reprise.unref();
  const veille = setInterval(() => {
    passageDeNuit().catch((err) => log.warn(`base de connaissances, nuit : passage sauté — ${(err as Error).message}`));
  }, VEILLE_MS);
  return [reprise, veille];
}
