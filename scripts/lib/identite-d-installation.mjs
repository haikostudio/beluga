/**
 * L'IDENTITÉ D'INSTALLATION, POUR LES CONTRÔLES.
 *
 * Les adresses d'une installation ne sont plus écrites dans le code : elles
 * vivent dans ses réglages (`shared/src/installation.ts`). Un contrôle qui juge
 * l'adresse de l'espace client ou un lien de courriel lit donc l'identité de
 * l'installation qu'il contrôle — celle du fichier de reprise du dépôt de
 * travail (`prive/identite-installation.json`), la même que prend un démon
 * d'essai levé d'ici — et la pose dans les règles partagées de SON processus.
 *
 *   const { hoteEspaceClient } = await identiteDuDepot();
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function identiteDuDepot(racine = RACINE) {
  const fichier = path.join(racine, 'prive', 'identite-installation.json');
  const valeurs = fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, 'utf8')) : {};
  const partage = await import(pathToFileURL(path.join(racine, 'shared/dist/index.js')).href);
  return partage.definirIdentiteDInstallation(valeurs);
}
