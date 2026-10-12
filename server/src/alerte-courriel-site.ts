import {
  adresseDuRecapitulatif,
  courrielDePanneDuSite,
  courrielDeRetourDuSite,
  type GenreDeCourriel,
  type SiteSurveille,
} from '@beluga/shared';
import { envoiPossible, envoyerUnCourriel, raisonDeLExtinction } from './envoi-des-courriels.js';
import { log } from './logger.js';
import { listerControles, lireSurveillance, marquerAlerteCourrielDuSite } from './surveillance.js';

/**
 * LE COURRIEL D'UNE PANNE DE SITE — l'envoi.
 *
 * Les règles (le seuil de trois échecs, un seul courriel par panne, le rappel
 * de six heures, le mot de retour) sont PURES et vivent dans
 * `shared/src/alerte-courriel-site.ts` ; `server/src/surveillance.ts` les joue
 * et appelle ce module. Ici : le destinataire, l'envoi par la porte commune
 * (`envoi-des-courriels.ts`, qui retient la façon d'envoyer réglée dans
 * l'installation), et la trace d'un refus.
 *
 * TROIS PRINCIPES.
 *
 *  1. **AUCUN ENVOI NE PEUT FAIRE TOMBER UNE TOURNÉE.** Un refus du service
 *     d'envoi, un envoi éteint faute de réglage : c'est un avertissement dans
 *     le journal, jamais une exception qui remonte.
 *  2. **LA DATE EST POSÉE AVANT L'ENVOI**, comme `incident_lance_le` : un envoi
 *     refusé ne se rejoue pas au contrôle suivant, et le rappel ne boucle pas.
 *  3. **LE DESTINATAIRE EST CELUI DU POINT QUOTIDIEN** (`adresseDuRecapitulatif`) :
 *     pas d'adresse écrite en dur ici, pas un second réglage à tenir à jour.
 */

/** Ce que fait un envoi, pour le journal et les essais. */
export type EnvoiCourrielDeSite =
  | { envoye: true }
  | { envoye: false; raison: 'envoi-eteint' | 'site-introuvable' | 'refuse'; detail?: string };

/** L'envoi commun à tous les courriels de la surveillance, contrôle WordPress compris. */
export async function envoyer(sujet: string, texte: string, html: string): Promise<EnvoiCourrielDeSite> {
  const destinataire = adresseDuRecapitulatif();
  if (!destinataire || !envoiPossible()) {
    if (destinataire) log.warn(`surveillance : le courriel d’alerte ne part pas — ${raisonDeLExtinction()}`);
    return { envoye: false, raison: 'envoi-eteint' };
  }
  const echec = await envoyerUnCourriel(destinataire, sujet, texte, html);
  if (echec) {
    /*
     * UN REFUS SE VOIT, ET NE REMET RIEN À ZÉRO. La date d'envoi reste posée :
     * mieux vaut un courriel perdu qu'un rappel toutes les cinq minutes — et le
     * journal garde la raison.
     */
    log.warn(`surveillance : courriel d’alerte refusé — ${echec}`);
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
    log.info(`surveillance : ${entree.genre === 'rappel' ? 'rappel' : 'alerte'} par courriel — ${site.nom} → ${adresseDuRecapitulatif()}`);
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
