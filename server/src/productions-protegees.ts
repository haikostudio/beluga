import { phraseDeLaCopieDeTest, type ProductionProtegee } from '@beluga/shared';
import { listerAcces } from './coffre-fort.js';
import { listerSites } from './surveillance.js';
import * as store from './store.js';
import { log } from './logger.js';

/**
 * LES VRAIS SITES QU'AUCUN AGENT N'ÉCRIT (MEM-4501), tels que le garde des
 * commandes les reçoit (`shared/src/garde-production.ts`).
 *
 * Un site est protégé dès que sa surveillance a un contrôle WordPress : sa fiche
 * SSH du coffre donne l'hôte de la machine, son adresse donne le domaine, et les
 * fiches « base de données » distantes du projet relié donnent l'hôte de la
 * base. Rien n'est recopié : tout est relu au lancement de chaque tour, donc une
 * fiche corrigée au coffre suffit.
 */
export function productionsProtegees(): ProductionProtegee[] {
  try {
    const acces = listerAcces();
    const productions: ProductionProtegee[] = [];
    for (const site of listerSites()) {
      const wordpress = site.wordpress;
      if (!wordpress) continue;
      const hotes = new Set<string>();
      const fiche = acces.find((a) => a.id === wordpress.acces.id);
      const hote = String(fiche?.champs?.hote ?? '').trim();
      if (hote) hotes.add(hote.toLowerCase());
      if (site.projetRattache) {
        for (const base of acces) {
          if (base.type !== 'base-de-donnees' || base.projectId !== site.projetRattache) continue;
          const h = String(base.champs?.hote ?? '').trim().toLowerCase();
          if (h && !/^(localhost|127\.0\.0\.1|::1)$/.test(h)) hotes.add(h);
        }
      }
      let domaine = '';
      try {
        domaine = new URL(site.url).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        // Une adresse illisible ne protège que par ses hôtes.
      }
      const projet = site.projetRattache ? store.getProject(site.projetRattache) : null;
      productions.push({
        nom: domaine || site.nom,
        hotes: [...hotes],
        domaines: domaine ? [domaine] : [],
        projet: site.projetRattache,
        ailleurs: phraseDeLaCopieDeTest(wordpress.copieDeTest ?? (projet?.devUrl ? { url: projet.devUrl } : undefined), projet?.name),
      });
    }
    return productions.filter((p) => p.hotes.length || p.domaines.length);
  } catch (err) {
    // Une base illisible ne bloque aucun agent : le garde se tait.
    log.warn(`garde de production : liste des sites illisible (${String((err as Error)?.message ?? err)})`);
    return [];
  }
}

/**
 * LA LISTE, PRÊTE POUR L'ENVIRONNEMENT D'UN AGENT. Le rôle « deploy » — l'agent
 * qui configure ou répare la mise en production — n'en reçoit aucune : la mise
 * en production est justement le geste qui écrit en ligne.
 */
export function productionsPourLAgent(role: string | undefined): string | undefined {
  if (role === 'deploy') return undefined;
  const liste = productionsProtegees();
  return liste.length ? JSON.stringify(liste) : undefined;
}
