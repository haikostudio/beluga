/*
 * LE MODULE BELUGA POUR FIREFOX, CÔTÉ DÉMON (carte « Navigateurs facultatifs à la liaison », 22/11/2026).
 *
 * Firefox n'installe qu'un module SIGNÉ par Mozilla. Le module est fabriqué depuis la source de Chrome
 * (`extension-firefox/fabriquer.sh` : manifeste Firefox, adresse de Beluga), signé « non listé » par le service de
 * Mozilla avec le compte du coffre-fort (`web-ext sign`), et rangé dans `data/extension-firefox/` avec sa version. Le
 * démon ne fabrique rien : il SERT le dernier fichier signé à Beluga Connect, par la voie signée du relais
 * (`/api/relais-mac/extension-firefox.xpi`), avec son empreinte, que Beluga Connect vérifie avant de l'ouvrir.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

export const FICHIER_FIREFOX = 'Beluga-Firefox.xpi';

function dossier(): string {
  return path.join(CONFIG.dataDir, 'extension-firefox');
}

let memoire: { mtime: number; empreinte: string } | null = null;

/** Le module Firefox signé, son empreinte et sa version (`version.txt`), ou `null` s'il n'est pas encore signé ici. */
export function paquetFirefox(): { chemin: string; empreinte: string; version: string | null } | null {
  const chemin = path.join(dossier(), FICHIER_FIREFOX);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(chemin);
  } catch {
    return null;
  }
  if (!memoire || memoire.mtime !== stat.mtimeMs) {
    memoire = { mtime: stat.mtimeMs, empreinte: crypto.createHash('sha256').update(fs.readFileSync(chemin)).digest('hex') };
  }
  let version: string | null = null;
  try {
    version = fs.readFileSync(path.join(dossier(), 'version.txt'), 'utf8').trim() || null;
  } catch {
    /* pas de version écrite */
  }
  return { chemin, empreinte: memoire.empreinte, version };
}
