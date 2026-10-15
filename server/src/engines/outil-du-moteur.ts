import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { candidatsDeLOutil, type LieuxDeRecherche } from '@beluga/shared';

/**
 * LE CHEMIN RÉEL DE L'OUTIL D'UN MOTEUR, cherché à chaque usage.
 *
 * L'ordre des emplacements est une règle pure (`candidatsDeLOutil`) ; ce module
 * n'ajoute que le disque. La recherche est refaite à CHAQUE appel : un outil
 * posé par le bouton « Installer » après le démarrage du démon doit être vu tout
 * de suite, sans redémarrage. Elle ne coûte que quelques `access` : rien à
 * garder en mémoire.
 */
export function cheminDeLOutil(
  lieux: Pick<LieuxDeRecherche, 'nom' | 'impose' | 'enPlus' | 'historique'>,
  executable: (chemin: string) => boolean = estExecutable,
): string {
  const candidats = candidatsDeLOutil({
    ...lieux,
    path: process.env.PATH,
    maison: os.homedir(),
    dossierDeNode: path.dirname(process.execPath),
  });
  return candidats.find(executable) ?? candidats[candidats.length - 1];
}

function estExecutable(chemin: string): boolean {
  try {
    fs.accessSync(chemin, fs.constants.X_OK);
    return fs.statSync(chemin).isFile();
  } catch {
    return false;
  }
}
