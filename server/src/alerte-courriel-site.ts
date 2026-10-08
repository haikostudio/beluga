import {
  ADRESSE_DE_HAIKO,
  courrielDePanneDuSite,
  courrielDeRetourDuSite,
  type GenreDeCourriel,
  type SiteSurveille,
} from '@beluga/shared';
import { cleResend, envoyerParResend } from './courriels-clients.js';
import { log } from './logger.js';
import { listerControles, lireSurveillance, marquerAlerteCourrielDuSite } from './surveillance.js';

/**
 * LE COURRIEL D'UNE PANNE DE SITE — l'envoi.
 *
 * Les règles (le seuil de trois échecs, un seul courriel par panne, le rappel
 * de six heures, le mot de retour) sont PURES et vivent dans
 * `shared/src/alerte-courriel-site.ts` ; `server/src/surveillance.ts` les joue
 * et appelle ce module. Ici : la clé Resend lue au coffre-fort, le destinataire,
 * et la trace d'un refus.
 *
 * TROIS PRINCIPES.
 *
 *  1. **AUCUN ENVOI NE PEUT FAIRE TOMBER UNE TOURNÉE.** Un refus de Resend, une
 *     clé absente : c'est un avertissement dans le journal, jamais une
 *     exception qui remonte.
 *  2. **LA DATE EST POSÉE AVANT L'ENVOI**, comme `incident_lance_le` : un envoi
 *     refusé ne se rejoue pas au contrôle suivant, et le rappel ne boucle pas.
 *  3. **LE DESTINATAIRE EST CELUI DU POINT QUOTIDIEN** (`ADRESSE_DE_HAIKO`) :
 *     pas d'adresse écrite en dur ici, pas un second réglage à tenir à jour.
 */

/** Ce que fait un envoi, pour le journal et les essais. */
export type EnvoiCourrielDeSite =
  | { envoye: true }
  | { envoye: false; raison: 'pas-de-cle' | 'site-introuvable' | 'refuse'; detail?: string };

/** L'envoi commun à tous les courriels de la surveillance, contrôle WordPress compris. */
export async function envoyer(sujet: string, texte: string, html: string): Promise<EnvoiCourrielDeSite> {
  const cle = cleResend();
  if (!cle) {
    log.warn('surveillance : aucune clé Resend au coffre-fort, le courriel d’alerte ne part pas');
    return { envoye: false, raison: 'pas-de-cle' };
  }
  const echec = await envoyerParResend(cle, ADRESSE_DE_HAIKO, sujet, texte, html);
  if (echec) {
    /*
     * UN REFUS SE VOIT, ET NE REMET RIEN À ZÉRO. La date d'envoi reste posée :
     * mieux vaut un courriel perdu qu'un rappel toutes les cinq minutes — et le
     * journal garde la raison.
     */
    log.warn(`surveillance : courriel d’alerte refusé par Resend — ${echec}`);
    return { envoye: false, raison: 'refuse', detail: echec };
  }
  return { envoye: true };
}

/**
 * LE COURRIEL DE PANNE, OU SON RAPPEL. La fiche est RELUE : un long parcours a
 * pu se terminer après la suppression de la surveillance.
 */
export async function envoyerCourrielDePanneDuSite(entree: {
  siteId: string;
  echecs: number;
  genre: GenreDeCourriel;
  maintenant?: number;
}): Promise<EnvoiCourrielDeSite> {
  const maintenant = entree.maintenant ?? Date.now();
  const site = lireSurveillance(entree.siteId);
  if (!site) return { envoye: false, raison: 'site-introuvable' };
  const controles = listerControles(site.id, maintenant);
  const { sujet, texte, html } = courrielDePanneDuSite({
    site,
    controles,
    echecsDeSuite: entree.echecs,
    genre: entree.genre,
    maintenant,
  });
  // AVANT l'envoi, jamais après.
  marquerAlerteCourrielDuSite(site.id, site.depuis || site.dernierePanne || maintenant, maintenant);
  const resultat = await envoyer(sujet, texte, html);
  if (resultat.envoye)
    log.info(`surveillance : ${entree.genre === 'rappel' ? 'rappel' : 'alerte'} par courriel — ${site.nom} → ${ADRESSE_DE_HAIKO}`);
  return resultat;
}

/** LE MOT DE FIN, à qui a reçu la mauvaise nouvelle. */
export async function envoyerCourrielDeRetourDuSite(entree: {
  site: Pick<SiteSurveille, 'id' | 'nom' | 'url'>;
  panneDepuis?: number;
  maintenant?: number;
}): Promise<EnvoiCourrielDeSite> {
  const maintenant = entree.maintenant ?? Date.now();
  const { sujet, texte, html } = courrielDeRetourDuSite({
    site: entree.site,
    panneDepuis: entree.panneDepuis,
    maintenant,
  });
  const resultat = await envoyer(sujet, texte, html);
  if (resultat.envoye) log.info(`surveillance : retour à la normale annoncé par courriel — ${entree.site.nom}`);
  return resultat;
}
