import path from 'node:path';

/**
 * LA BASE RÉELLEMENT SERVIE, POUR LES SCRIPTS — la MÊME règle que le démon.
 *
 * Le fichier de base s'appelle `beluga.db` (`cheminDeLaBase`,
 * `server/src/config.ts`). Un script de vérification lit la base par ICI,
 * jamais par un chemin écrit à la main : `BELUGA_DATA` l'emporte, sinon le
 * dossier de données du serveur.
 */
export function dossierDesDonnees() {
  return process.env.BELUGA_DATA || '/root/beluga/data';
}

export function cheminDeLaBaseServie(dossierDonnees = dossierDesDonnees()) {
  return path.join(dossierDonnees, 'beluga.db');
}
