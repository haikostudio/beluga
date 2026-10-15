import { brancheDeLaCarte, brancheRetrouvee, fusionsParBranche } from '@beluga/shared';
import type { Card } from '@beluga/shared';
import * as store from './store.js';
import { log } from './logger.js';
import { branchePrincipale, sortieGit } from './git.js';
import { brancheDeDeploiement } from './branche-de-deploiement.js';

/**
 * RATTRAPAGE DES CARTES QUI ONT PERDU LE NOM DE LEUR BRANCHE.
 *
 * Jusqu'au 14/10/2026, l'archivage effaçait `github.branch` quand il
 * supprimait une branche fusionnée : l'onglet « GitHub » disait alors d'une
 * carte qui avait travaillé qu'elle « n'avait jamais été lancée » (1 166 cartes
 * sur le dépôt de Beluga). Leur travail vit pourtant dans l'histoire, sous un
 * commit de fusion qui porte le nom de la branche.
 *
 * Une passe par projet : TOUTES les fusions lues d'un seul `git log`, puis
 * chaque carte touchée — lancée (`agentId`), une base connue, plus de nom —
 * reprend son nom, sa marque « supprimée » et son sommet. Les fichiers se
 * relisent à l'ouverture de l'onglet (`refreshCard`). Une carte dont aucune
 * fusion ne porte le nom reste telle quelle. Idempotent : une carte réparée ne
 * correspond plus.
 */
export function carteSansSaBranche(card: Card): boolean {
  return !!card.agentId && !!card.github?.baseSha && !card.github?.branch;
}

export async function rattraperLesBranchesPerdues(): Promise<number> {
  let reparees = 0;
  for (const project of store.listProjects(true)) {
    const touchees = store.listCards(project.id).filter(carteSansSaBranche);
    if (!touchees.length) continue;
    try {
      const deploiement = await brancheDeDeploiement(project.path, project.branchesDePublication);
      const principale = await branchePrincipale(project.path);
      const accueils = [...new Set([deploiement, principale].filter(Boolean))];
      const sortie = await sortieGit(project.path, ['log', '--merges', '--format=%H %P%x09%s', ...accueils], 120_000);
      if (sortie === null) continue;
      const fusions = fusionsParBranche(sortie);
      for (const card of touchees) {
        // Relue juste avant d'écrire : une carte relancée entre-temps a déjà sa branche.
        const fraiche = store.getCard(card.id);
        if (!fraiche || !carteSansSaBranche(fraiche)) continue;
        const trouvee = brancheRetrouvee(fusions, brancheDeLaCarte(fraiche), fraiche.id);
        if (!trouvee) continue;
        store.saveCard({
          ...fraiche,
          github: {
            ...fraiche.github!,
            branch: trouvee.branche,
            brancheSupprimee: true,
            sommetSha: fraiche.github?.sommetSha ?? trouvee.fusion.sommet,
            fusionnee: true,
          },
        });
        reparees += 1;
      }
    } catch (err) {
      log.warn(`rattrapage des branches perdues (${project.name})`, err);
    }
  }
  if (reparees) log.info(`${reparees} carte(s) ont retrouvé le nom de leur branche`);
  return reparees;
}
