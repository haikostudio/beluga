/**
 * LE RATTRAPAGE DES PORTS : chaque projet d'avant la règle reçoit le port
 * qu'il SERT RÉELLEMENT (`shared/src/port-projet.ts`, `portARattraper`).
 *
 * Appelé au démarrage du démon, APRÈS l'ouverture du service et sans être
 * attendu : il lit les sockets, les vhosts et les unités de chaque projet, ce
 * qui ne doit jamais retarder la première réponse.
 *
 * IDEMPOTENT, et prudent sur trois points :
 *  - un projet qui a DÉJÀ un port n'est jamais touché — relu juste avant
 *    l'écriture, pour qu'un réglage fait entre-temps à l'écran gagne ;
 *  - un port déjà attribué à un AUTRE projet n'est pas enregistré : le journal
 *    le dit, et le projet reste sans port plutôt que de créer un conflit ;
 *  - le projet Beluga Build lui-même est laissé de côté : son port est celui
 *    du démon, réglé ailleurs.
 */

import { portARattraper } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { portServi, serviceDuProjet } from './deploy.js';

export async function rattraperLesPortsDesProjets(): Promise<{ enregistres: number; laisses: number }> {
  let enregistres = 0;
  let laisses = 0;
  for (const projet of store.listProjects(true)) {
    if (projet.isSelf || projet.port !== undefined) continue;
    const service = serviceDuProjet(projet.path);
    if (!service) continue;
    try {
      const lu = await portServi(projet.path, service);
      const autres = store
        .listProjects(true)
        .filter((autre) => autre.id !== projet.id)
        .map((autre) => autre.port);
      const retenu = portARattraper({ constates: lu.constates, vhost: lu.vhost, declare: lu.declare, attribues: autres });
      if (!retenu) {
        laisses += 1;
        log.info(
          `port de « ${projet.name} » non rattrapé : rien de lisible dans la plage des projets, ou port déjà attribué à un autre projet (écoute ${lu.constates.join(', ') || '—'}, vhost ${lu.vhost.join(', ') || '—'}, unité ${lu.declare ?? '—'})`,
        );
        continue;
      }
      const frais = store.getProject(projet.id);
      if (!frais || frais.port !== undefined) continue;
      const enregistre = store.saveProject({ ...frais, port: retenu.port });
      bus.emit({ type: 'project.upsert', project: enregistre });
      enregistres += 1;
      log.info(`port de « ${projet.name} » enregistré : ${retenu.port} (${retenu.origine}, service ${service})`);
    } catch (err: any) {
      laisses += 1;
      log.warn(`port de « ${projet.name} » non rattrapé`, err?.message ?? err);
    }
  }
  return { enregistres, laisses };
}
