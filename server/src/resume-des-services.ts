/*
 * LES CHIFFRES DE LA FENÊTRE DES SERVICES (décision de l'utilisateur du 14/11/2026, carte « Onglets, services et listes
 * repensés ») : chaque carte de la fenêtre « Services » porte une ligne d'état chiffrée, toujours présente. Ce que
 * l'écran ne tient pas déjà (Messagerie, Surveillance et Tâches récurrentes sont dans son état) se lit ici, en UN seul
 * message (`services.resume`), par des comptes légers. Un compte qui échoue (table absente, base neuve) vaut `null` :
 * la carte dit alors son état sans chiffre, jamais une erreur.
 */
import { getDb } from './db.js';

export interface ResumeDesServices {
  chartes: number | null;
  campagnes: number | null;
  publicationsDuMois: number | null;
  creations: number | null;
  plans: number | null;
  visites7j: number | null;
  derniereSauvegarde: number | null;
  sitesSauvegardes: number | null;
  /** Le service Sécurité : les projets suivis, et leurs points critiques ou élevés encore à traiter. */
  projetsSecurite: number | null;
  pointsGravesSecurite: number | null;
}

function compter(sql: string, ...params: unknown[]): number | null {
  try {
    const ligne = getDb().prepare(sql).get(...params) as { n?: number } | undefined;
    return typeof ligne?.n === 'number' ? ligne.n : null;
  } catch {
    return null;
  }
}

/** Le mois en cours, « AAAA-MM », pour les dates prévues écrites « AAAA-MM-JJ ». */
export function moisEnCours(maintenant = Date.now()): string {
  const d = new Date(maintenant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function resumeDesServices(maintenant = Date.now()): Promise<ResumeDesServices> {
  let chartes: number | null = null;
  try {
    const { listerToutesLesPlaquettes } = await import('./plaquettes.js');
    chartes = listerToutesLesPlaquettes().length;
  } catch {
    chartes = null;
  }
  let visites7j: number | null = null;
  try {
    const { listerLesSites } = await import('./statistiques.js');
    visites7j = listerLesSites(maintenant).sites.reduce((somme, site) => somme + site.visites.slice(-7).reduce((a, b) => a + b, 0), 0);
  } catch {
    visites7j = null;
  }
  let derniereSauvegarde: number | null = null;
  let sitesSauvegardes: number | null = null;
  try {
    const { derniersPoints, listerSites } = await import('./backups.js');
    sitesSauvegardes = listerSites().length;
    for (const point of derniersPoints().values()) {
      if (point.statut === 'reussi' || (point.statut as string) === 'ok') {
        if (derniereSauvegarde === null || point.fin > derniereSauvegarde) derniereSauvegarde = point.fin;
      }
    }
  } catch {
    derniereSauvegarde = null;
  }
  let projetsSecurite: number | null = null;
  let pointsGravesSecurite: number | null = null;
  try {
    const { listerProjetsSuivis } = await import('./service-securite.js');
    const suivis = listerProjetsSuivis();
    projetsSecurite = suivis.length;
    pointsGravesSecurite = suivis.reduce((somme, p) => somme + p.aTraiter.critique + p.aTraiter.elevee, 0);
  } catch {
    projetsSecurite = null;
  }
  return {
    chartes,
    campagnes: compter(`SELECT COUNT(*) AS n FROM communication_campagnes WHERE statut NOT IN ('archivee', 'archive', 'terminee')`),
    publicationsDuMois: compter(
      `SELECT COUNT(*) AS n FROM marketing_contenus WHERE campagne_id IS NOT NULL AND substr(date_prevue, 1, 7) = ?`,
      moisEnCours(maintenant),
    ),
    creations: compter(`SELECT COUNT(*) AS n FROM studio_creations`),
    plans: compter(`SELECT COUNT(*) AS n FROM strategie_missions`),
    visites7j,
    derniereSauvegarde,
    sitesSauvegardes,
    projetsSecurite,
    pointsGravesSecurite,
  };
}
