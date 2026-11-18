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
import { dateEtHeureDActivite } from './activite-recente.js';

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

/** Le titre de la section du résumé : la voix la garde dans son dossier par ce début (`activitePourLaVoix`). */
export const TITRE_DES_PUBLICATIONS_EN_ATTENTE = 'PUBLICATIONS EN ATTENTE';

/**
 * LA SECTION « PUBLICATIONS EN ATTENTE » DU RÉSUMÉ DE JARVIS (carte « Jarvis : déploiements vus et champ masqué »,
 * 18/11/2026) : Jarvis ne voyait que les publications qui TOURNENT et répondait « rien n'attend la production » quand
 * l'onglet « Production » des Tableaux de bord en comptait trois. Elle reprend les DEUX tableaux, avec leurs chiffres
 * (le compteur et la réponse disent la même chose) ; une liste vide se dit en toutes lettres.
 */
export function sectionDesPublicationsEnAttente(rendu: PublicationsEnAttente, nom: (projectId: string) => string): string {
  const date = (at: number | null) => (at ? dateEtHeureDActivite(at) : 'jamais');
  const taches = (n: number) => `${n} tâche${n > 1 ? 's' : ''}`;
  const projets = (n: number) => `${n} projet${n > 1 ? 's' : ''}`;
  const titre = `${TITRE_DES_PUBLICATIONS_EN_ATTENTE} (mêmes chiffres que les Tableaux de bord ; elles ne tournent PAS, elles attendent un geste)`;
  const deployer = rendu.aDeployer.length
    ? `À DÉPLOYER (${projets(rendu.aDeployer.length)}, ${taches(rendu.aDeployer.reduce((t, l) => t + l.taches, 0))}) :\n${rendu.aDeployer
        .map((l) => `- ${nom(l.projectId)} — ${taches(l.taches)}, en attente depuis ${date(l.depuis)}, dernier déploiement ${date(l.dernierDeploiement)}`)
        .join('\n')}`
    : "À DÉPLOYER — Rien n'attend le déploiement.";
  const produire = rendu.aProduire.length
    ? `EN ATTENTE DE MISE EN PRODUCTION (${projets(rendu.aProduire.length)}, ${taches(rendu.aProduire.reduce((t, l) => t + l.taches, 0))}) :\n${rendu.aProduire
        .map(
          (l) =>
            `- ${nom(l.projectId)} — ${taches(l.taches)}, dernier déploiement ${date(l.dernierDeploiement)}, dernière mise en production ${date(l.derniereProduction)}${l.echec ? ', DERNIÈRE TENTATIVE EN ÉCHEC' : ''}`,
        )
        .join('\n')}`
    : "EN ATTENTE DE MISE EN PRODUCTION — Rien n'attend la mise en production.";
  return `${titre} :\n${deployer}\n${produire}`;
}
