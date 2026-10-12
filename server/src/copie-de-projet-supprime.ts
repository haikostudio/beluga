/**
 * LA COPIE DE SECOURS D'UN PROJET SUPPRIMÉ — LA SIENNE, ET RIEN D'AUTRE.
 *
 * Avant, la suppression définitive appelait la sauvegarde COMPLÈTE du démon
 * (`runBackup` : `VACUUM INTO` synchrone de toute la base, puis les pièces
 * jointes de TOUS les projets) : ~90 s sur 2 Go, boucle d'événements figée,
 * alerte « prend plus de temps que prévu », clic répété. Décision de
 * l'utilisateur (08/10/2026) : la copie ne porte que le projet supprimé, ses
 * données et ses fichiers ; elle vit 15 jours, puis s'efface d'elle-même si
 * personne n'a demandé de restauration.
 *
 * L'archive (`<nom>.tar`, sans compression : les médias ne se compressent pas)
 * contient un dossier du même nom avec :
 *   - `donnees.json.gz` : `{ projet, exporteLe, tables: { <table>: [lignes] } }` —
 *     toutes les lignes que `effacerLesLignesDuProjet` va effacer ou détacher ;
 *   - `pieces-jointes/<nom sur le disque>` : les fichiers des pièces jointes ;
 *   - `LISEZ-MOI.txt` : ce qu'elle contient et ce qui manquait.
 * Aucun bouton de restauration : on la rejoue à la main, sur demande.
 *
 * Tout est ASYNCHRONE (zlib, tar, liens) : le démon continue de répondre.
 * Rangée sous `PATHS.backups/projets-supprimes/`, un SOUS-DOSSIER : le
 * nettoyage du disque (`find -maxdepth 1 -type f` dans
 * `scripts/systeme/root-storage-cleanup.sh`) ne la déplace pas, et la
 * rotation des sauvegardes (`prune` de `backup.ts`) ne la voit pas.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copieDeProjetSupprimeAPurger, nomDeCopieDeProjetSupprime, nomSurDisque, type Attachment, type Project } from '@beluga/shared';
import { PATHS } from './config.js';
import { log } from './logger.js';
import { dossiersDeLecture } from './pieces-jointes.js';

const execFileAsync = promisify(execFile);
const gzip = promisify(zlib.gzip);

/** Le dossier des copies de secours des projets supprimés. */
export function dossierDesCopiesDeProjetsSupprimes(): string {
  return path.join(PATHS.backups, 'projets-supprimes');
}

/**
 * TOUS les fichiers d'une pièce jointe sur le disque : ses deux noms possibles
 * (alias, puis l'ancien `<id>-<nom>`) dans ses deux dossiers possibles. Jamais
 * une recherche par motif ou par empreinte : deux projets peuvent porter le
 * même contenu, chacun a SON fichier.
 */
export function fichiersDeLaPieceJointe(piece: Attachment): string[] {
  const noms = [...new Set([nomSurDisque(piece), `${piece.id}-${piece.name}`])];
  const trouves: string[] = [];
  for (const dossier of dossiersDeLecture()) {
    for (const nom of noms) {
      const chemin = path.join(dossier, nom);
      if (fs.existsSync(chemin) && !trouves.includes(chemin)) trouves.push(chemin);
    }
  }
  return trouves;
}

export interface ContenuDeLaCopie {
  projet: Project;
  /** Les lignes du projet, table par table. */
  tables: Record<string, unknown[]>;
  pieces: Attachment[];
}

/**
 * Écrit l'archive et la VÉRIFIE (lisible, données présentes, autant de fichiers
 * que prévu) avant de rendre son chemin. Lève au moindre écart : la suppression
 * s'arrête alors avant tout geste irréversible.
 */
export async function ecrireCopieDuProjet(contenu: ContenuDeLaCopie, maintenant = new Date()): Promise<string> {
  const dossier = dossierDesCopiesDeProjetsSupprimes();
  await fs.promises.mkdir(dossier, { recursive: true });
  const archive = path.join(dossier, nomDeCopieDeProjetSupprime(contenu.projet.name, contenu.projet.id, maintenant));
  const base = path.basename(archive, '.tar');
  const atelier = await fs.promises.mkdtemp(path.join(dossier, '.en-cours-'));
  try {
    const racine = path.join(atelier, base);
    await fs.promises.mkdir(path.join(racine, 'pieces-jointes'), { recursive: true });
    const donnees = { projet: contenu.projet, exporteLe: maintenant.toISOString(), tables: contenu.tables };
    await fs.promises.writeFile(path.join(racine, 'donnees.json.gz'), await gzip(Buffer.from(JSON.stringify(donnees))));

    // Des liens, pas des copies : `tar -h` lit le fichier au bout, sans doubler les gigaoctets.
    let fichiers = 0;
    const manquantes: string[] = [];
    for (const piece of contenu.pieces) {
      const chemins = fichiersDeLaPieceJointe(piece);
      if (!chemins.length) {
        manquantes.push(`${piece.id} (${piece.name})`);
        continue;
      }
      for (const chemin of chemins) {
        const lien = path.join(racine, 'pieces-jointes', path.basename(chemin));
        if (fs.existsSync(lien)) continue; // même nom dans les deux dossiers : un seul suffit
        await fs.promises.symlink(chemin, lien);
        fichiers += 1;
      }
    }
    await fs.promises.writeFile(
      path.join(racine, 'LISEZ-MOI.txt'),
      [
        `Copie de secours du projet « ${contenu.projet.name} » (${contenu.projet.id}), prise le ${maintenant.toISOString()} avant sa suppression définitive.`,
        `Effacée d'elle-même 15 jours après, si personne ne l'a restaurée.`,
        '',
        `donnees.json.gz : les lignes de la base, table par table (${Object.keys(contenu.tables).length} tables).`,
        `pieces-jointes/ : ${fichiers} fichier(s) de ${contenu.pieces.length} pièce(s) jointe(s), sous leur nom sur le disque.`,
        manquantes.length ? `Déjà absentes du disque avant la copie : ${manquantes.join(', ')}` : 'Aucune pièce jointe ne manquait.',
        '',
      ].join('\n'),
    );

    await execFileAsync('tar', ['-chf', archive, '-C', atelier, base], { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });

    // La relecture : une copie qu'on ne sait pas relire ne protège rien.
    const { stdout } = await execFileAsync('tar', ['-tf', archive], { timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    const entrees = stdout.split('\n').filter(Boolean);
    const lus = entrees.filter((e) => e.startsWith(`${base}/pieces-jointes/`) && !e.endsWith('/')).length;
    if (!entrees.includes(`${base}/donnees.json.gz`)) throw new Error('la copie de secours ne contient pas les données');
    if (lus !== fichiers) throw new Error(`la copie de secours contient ${lus} fichier(s) au lieu de ${fichiers}`);
    log.info(`copie de secours du projet « ${contenu.projet.name} » : ${path.basename(archive)} (${fichiers} fichier(s))`);
    return archive;
  } catch (err) {
    await fs.promises.rm(archive, { force: true }).catch(() => undefined);
    throw err;
  } finally {
    await fs.promises.rm(atelier, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Efface les copies de plus de 15 jours. Ne regarde QUE les fichiers nommés
 * `projet-supprime-*.tar` : aucune autre sauvegarde n'est jamais touchée.
 * Rend les noms effacés.
 */
export async function purgerCopiesDeProjetsSupprimes(
  maintenant = Date.now(),
  dossier = dossierDesCopiesDeProjetsSupprimes(),
): Promise<string[]> {
  let noms: string[];
  try {
    noms = await fs.promises.readdir(dossier);
  } catch {
    return [];
  }
  const effaces: string[] = [];
  for (const nom of noms) {
    try {
      const chemin = path.join(dossier, nom);
      const stat = await fs.promises.stat(chemin);
      if (!stat.isFile() || !copieDeProjetSupprimeAPurger(nom, stat.mtimeMs, maintenant)) continue;
      await fs.promises.rm(chemin, { force: true });
      effaces.push(nom);
    } catch (err: any) {
      log.warn(`copie de secours ${nom} : effacement impossible`, err?.message ?? err);
    }
  }
  if (effaces.length) log.info(`copies de secours de projets supprimés effacées après 15 jours : ${effaces.join(', ')}`);
  return effaces;
}
