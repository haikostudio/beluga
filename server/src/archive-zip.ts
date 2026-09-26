import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { EntreeDArchive, NOM_MANIFESTE, entreeSure } from '@beluga/shared';

/**
 * L'ARCHIVE ZIP D'UN BACKUP — l'écrire, la relire, l'extraire.
 *
 * Tout passe en FLUX : un site de plusieurs gigaoctets ne tient jamais en
 * mémoire, et le démon rend la main entre deux fichiers (une copie synchrone
 * l'avait déjà gelé jusqu'à se faire relancer par son surveillant).
 *
 * L'archive garde ce qu'une restauration doit retrouver à l'identique : les
 * DROITS de chaque fichier, les DOSSIERS VIDES et les LIENS SYMBOLIQUES (rangés
 * comme un fichier qui porte leur cible, avec le type « lien » dans ses
 * attributs — la convention des outils zip d'Unix).
 *
 * L'archive s'écrit sous un nom « .partiel » puis se RENOMME : un zip coupé en
 * plein vol (démon arrêté, disque plein) ne passe jamais pour un backup.
 */

const TYPE = 0o170000;
const LIEN = 0o120000;

/** Parcourt un dossier sans bloquer : chaque entrée, avec son chemin relatif « / ». */
async function parcourir(
  racine: string,
  visiter: (relatif: string, chemin: string, etat: fs.Stats) => Promise<void> | void,
  relatif = '',
): Promise<void> {
  const dossier = path.join(racine, relatif);
  const entrees = await fs.promises.readdir(dossier, { withFileTypes: true });
  entrees.sort((a, b) => a.name.localeCompare(b.name));
  for (const entree of entrees) {
    const rel = relatif ? `${relatif}/${entree.name}` : entree.name;
    const chemin = path.join(racine, rel);
    const etat = await fs.promises.lstat(chemin);
    await visiter(rel, chemin, etat);
    if (etat.isDirectory()) await parcourir(racine, visiter, rel);
  }
}

/**
 * ÉCRIT L'ARCHIVE d'un dossier de travail, avec le manifeste à sa racine.
 * Rend son poids sur le disque.
 */
export async function ecrireArchive(dossier: string, destination: string, manifeste: unknown): Promise<number> {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const partiel = `${destination}.partiel`;
  const zip = new yazl.ZipFile();
  const ecriture = pipeline(zip.outputStream as unknown as Readable, fs.createWriteStream(partiel));

  try {
    zip.addBuffer(Buffer.from(JSON.stringify(manifeste, null, 2)), NOM_MANIFESTE, { mode: 0o100644 });
    await parcourir(dossier, async (relatif, chemin, etat) => {
      if (etat.isSymbolicLink()) {
        const cible = await fs.promises.readlink(chemin);
        zip.addBuffer(Buffer.from(cible), relatif, { mode: LIEN | 0o777, mtime: etat.mtime, compress: false });
      } else if (etat.isDirectory()) {
        zip.addEmptyDirectory(relatif, { mode: etat.mode, mtime: etat.mtime });
      } else if (etat.isFile()) {
        zip.addFile(chemin, relatif, { mode: etat.mode, mtime: etat.mtime });
      }
      // Tube, prise ou périphérique : rien qu'une archive puisse porter.
    });
    zip.end();
    await ecriture;
    await fs.promises.rename(partiel, destination);
  } catch (err) {
    zip.end();
    await ecriture.catch(() => undefined);
    await fs.promises.rm(partiel, { force: true });
    throw err;
  }
  return (await fs.promises.stat(destination)).size;
}

function ouvrir(chemin: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(chemin, { lazyEntries: true, autoClose: false }, (err, zip) =>
      err || !zip ? reject(err ?? new Error('archive illisible')) : resolve(zip),
    ),
  );
}

function flux(zip: yauzl.ZipFile, entree: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entree, (err, lu) => (err || !lu ? reject(err ?? new Error('entrée illisible')) : resolve(lu))),
  );
}

async function contenu(zip: yauzl.ZipFile, entree: yauzl.Entry, max: number): Promise<Buffer> {
  if (entree.uncompressedSize > max) throw new Error(`« ${entree.fileName} » dépasse ${max} octets`);
  const morceaux: Buffer[] = [];
  for await (const morceau of await flux(zip, entree)) morceaux.push(morceau as Buffer);
  return Buffer.concat(morceaux);
}

/** Visite chaque entrée d'une archive, une à la fois, puis la referme. */
async function visiterArchive(
  chemin: string,
  visiter: (zip: yauzl.ZipFile, entree: yauzl.Entry) => Promise<void>,
): Promise<void> {
  const zip = await ouvrir(chemin);
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', (entree: yauzl.Entry) => {
        visiter(zip, entree).then(() => zip.readEntry(), reject);
      });
      zip.on('end', () => resolve());
      zip.on('error', reject);
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

/**
 * RELIT UNE ARCHIVE : la liste de ses entrées (nom, poids décompressé) et son
 * manifeste. `null` quand elle ne s'ouvre pas — c'est un échec, pas un backup.
 */
export async function lireArchive(
  chemin: string,
): Promise<{ entrees: EntreeDArchive[]; manifeste: unknown | null } | null> {
  const entrees: EntreeDArchive[] = [];
  let manifeste: unknown | null = null;
  try {
    await visiterArchive(chemin, async (zip, entree) => {
      entrees.push({ nom: entree.fileName, octets: entree.uncompressedSize });
      if (entree.fileName === NOM_MANIFESTE) {
        try {
          manifeste = JSON.parse((await contenu(zip, entree, 1024 * 1024)).toString('utf8'));
        } catch {
          manifeste = null;
        }
      }
    });
  } catch {
    return null;
  }
  return { entrees, manifeste };
}

/**
 * EXTRAIT UNE ARCHIVE dans un dossier, sans jamais écrire hors de lui : une
 * entrée « ../ » ou absolue fait tomber l'extraction entière (la bibliothèque
 * la refuse déjà ; `entreeSure` et le contrôle du chemin résolu le refusent une
 * seconde fois, au cas où). Droits, dossiers vides et liens sont reposés.
 */
export async function extraireArchive(chemin: string, cible: string): Promise<void> {
  const racine = path.resolve(cible);
  await fs.promises.mkdir(racine, { recursive: true });
  await visiterArchive(chemin, async (zip, entree) => {
    const nom = entreeSure(entree.fileName);
    const destination = nom ? path.resolve(racine, nom) : '';
    if (!nom || !destination.startsWith(racine + path.sep)) {
      throw new Error(`entrée refusée, elle sortirait du dossier : ${entree.fileName}`);
    }
    const mode = (entree.externalFileAttributes >>> 16) & 0xffff;
    if (nom.endsWith('/')) {
      await fs.promises.mkdir(destination, { recursive: true });
      return;
    }
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    if ((mode & TYPE) === LIEN) {
      const lien = (await contenu(zip, entree, 64 * 1024)).toString('utf8');
      await fs.promises.rm(destination, { force: true });
      await fs.promises.symlink(lien, destination);
      return;
    }
    await pipeline(await flux(zip, entree), fs.createWriteStream(destination, { mode: mode & 0o7777 || 0o644 }));
    if (mode & 0o7777) await fs.promises.chmod(destination, mode & 0o7777);
  });
}
