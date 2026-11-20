/**
 * L'ARCHIVAGE AUTOMATIQUE DES PROJETS (carte « Archivage des projets : page, historique, automatique »,
 * 20/11/2026).
 *
 * Chaque nuit (fenêtre de 2 h à 5 h, `doitPasserLaNuit`), un projet sans aucune activité de tâche depuis
 * `Settings.archivageAutoJours` jours (30 par défaut, 0 = jamais) part sur le disque de stockage. Le choix des
 * candidats est une règle pure (`projetsAArchiverSeuls`, `shared/src/archivage-projet.ts`) ; le travail passe
 * par EXACTEMENT la même fonction que le geste à la main (`archiver`, origine « auto ») — mêmes contrôles,
 * copie vérifiée avant tout effacement —, et UN projet à la fois : le suivant n'est lancé qu'une fois le
 * précédent fini. Un refus (site public servi depuis le dossier, agent au travail…) est noté dans
 * l'historique du projet, une seule fois par raison. Jamais l'espace de développement de Beluga, jamais un
 * projet dont l'interrupteur « Ne jamais archiver automatiquement » est allumé.
 */
import { ARCHIVAGE_AUTO_JOURS_PAR_DEFAUT, doitPasserLaNuit, projetsAArchiverSeuls, refusDejaNote } from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { archiver, attendreLaFinDuTransfert, derniersDesarchivages, mouvementsDuProjet, noterMouvement } from './archivage-projet.js';

const CLE_DERNIER_PASSAGE = 'archivage-auto.dernier-passage';
const VEILLE_MS = 10 * 60 * 1000;
/** Au-delà, on ne lance plus de nouveau projet cette nuit : la suite attend la nuit prochaine. */
const DUREE_MAX_D_UN_PASSAGE_MS = 4 * 60 * 60 * 1000;

let enCours = false;

export function joursDArchivageAuto(): number {
  const jours = store.getSettings().archivageAutoJours;
  return typeof jours === 'number' && jours >= 0 ? jours : ARCHIVAGE_AUTO_JOURS_PAR_DEFAUT;
}

/** Un passage : archive, un par un, les projets endormis. Rend le nombre de projets archivés. */
export async function passageDArchivageAuto(maintenant = Date.now()): Promise<number> {
  if (enCours) return 0;
  enCours = true;
  let archives = 0;
  try {
    const candidats = projetsAArchiverSeuls(store.listProjects(true), {
      maintenant,
      jours: joursDArchivageAuto(),
      derniersDesarchivages: derniersDesarchivages(),
    });
    for (const candidat of candidats) {
      if (Date.now() - maintenant > DUREE_MAX_D_UN_PASSAGE_MS) break;
      try {
        await archiver(candidat.id, 'auto');
      } catch (err: any) {
        const raison = err?.message ?? String(err);
        // Un refus se note une fois par raison ; un échec, `archiver` l'a déjà noté.
        if (err?.refus && !refusDejaNote(mouvementsDuProjet(candidat.id, 1)[0], raison)) {
          noterMouvement({ projectId: candidat.id, sens: 'archiver', origine: 'auto', issue: 'refus', detail: raison });
        }
        log.info(`archivage automatique de ${candidat.name ?? candidat.id} : ${raison}`);
        continue;
      }
      const fin = await attendreLaFinDuTransfert(candidat.id);
      if (fin && !fin.erreur) archives++;
    }
  } finally {
    enCours = false;
  }
  return archives;
}

export async function passageDeNuitDArchivageAuto(maintenant = new Date()): Promise<boolean> {
  const dernier = Number(getMeta(CLE_DERNIER_PASSAGE) ?? 0) || undefined;
  if (!doitPasserLaNuit(maintenant, dernier)) return false;
  setMeta(CLE_DERNIER_PASSAGE, String(maintenant.getTime()));
  const n = await passageDArchivageAuto(maintenant.getTime());
  if (n) log.info(`archivage automatique : ${n} projet(s) archivé(s) cette nuit`);
  return true;
}

export function planifierLArchivageAuto(): NodeJS.Timeout {
  return setInterval(() => {
    passageDeNuitDArchivageAuto().catch((err) => log.warn(`archivage automatique : passage sauté — ${(err as Error).message}`));
  }, VEILLE_MS);
}
