/**
 * LES PUBLICATIONS EN ATTENTE, TOUS PROJETS (16/11/2026, « Tableaux de bord », maquette #d979) : en tête de la page,
 * deux tableaux l'un sous l'autre — d'abord les projets qui ont des tâches « À déployer », puis ceux dont la version
 * déployée attend la mise en production.
 *
 * LE NOMBRE « À DÉPLOYER » EST CELUI DU MENU « PUBLIER » (`menu-publier.tsx`) : une seule règle, `estADeployer`, pour
 * le bouton, sa liste et ce tableau — le compteur compte ce que la liste montre.
 *
 * Règles PURES : ni base, ni disque — rejouables seules (`server/src/test/publications-en-attente.test.ts`).
 */
import { carteMarketingCachee } from './marketing.js';
import { estEtapeDeSuite } from './suite-de-cartes.js';
import { horsDuLotDeDeploiement } from './etapes-du-media.js';
import type { Card } from './models.js';

/** Une tâche attend-elle d'être déployée ? La même règle que la colonne et le menu « Publier ». */
export function estADeployer(card: Card): boolean {
  return card.column === 'to_deploy' && !card.deployedAt && !carteMarketingCachee(card) && !estEtapeDeSuite(card) && !horsDuLotDeDeploiement(card);
}

/** Une ligne du tableau « À déployer ». */
export interface LigneADeployer {
  projectId: string;
  /** Le nombre de tâches qui attendent le déploiement (celui du bouton « Publier »). */
  taches: number;
  /** Depuis quand la plus ancienne attend : sa fin de travail, à défaut sa dernière modification. */
  depuis: number;
  /** Le dernier déploiement réussi, s'il y en a eu un. */
  dernierDeploiement: number | null;
}

/** Une ligne du tableau « Mise en production en attente ». */
export interface LigneAProduire {
  projectId: string;
  /** Le nombre de tâches déployées qui ne sont pas encore en production (celui de la seconde liste de « Publier »). */
  taches: number;
  dernierDeploiement: number | null;
  derniereProduction: number | null;
  /** La dernière tentative de mise en production a échoué ou a été arrêtée. */
  echec: boolean;
}

export interface PublicationsEnAttente {
  aDeployer: LigneADeployer[];
  aProduire: LigneAProduire[];
}

/** La ligne « À déployer » d'un projet, ou `null` s'il n'a rien à déployer. */
export function ligneADeployer(projectId: string, cartes: readonly Card[], dernierDeploiement: number | null): LigneADeployer | null {
  const enAttente = cartes.filter((c) => c.projectId === projectId && estADeployer(c));
  if (!enAttente.length) return null;
  const depuis = Math.min(...enAttente.map((c) => c.doneAt ?? c.updatedAt ?? c.createdAt));
  return { projectId, taches: enAttente.length, depuis, dernierDeploiement };
}

/** Les lignes dans l'ordre de lecture : celles qui attendent depuis le plus longtemps d'abord. */
export function trierLesPublicationsEnAttente(rendu: PublicationsEnAttente): PublicationsEnAttente {
  return {
    aDeployer: [...rendu.aDeployer].sort((a, b) => a.depuis - b.depuis),
    aProduire: [...rendu.aProduire].sort((a, b) => Number(b.echec) - Number(a.echec) || b.taches - a.taches),
  };
}
