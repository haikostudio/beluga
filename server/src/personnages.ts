import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  COLUMN_KEYS,
  DOSSIER_DES_PERSONNAGES,
  fichierDuPersonnage,
  jugerImageDePersonnage,
  type ColumnKey,
  type DecoupeDePersonnage,
} from '@haikodev/shared';
import { CONFIG, PATHS } from './config.js';
import { bus } from './bus.js';
import { log } from './logger.js';

/**
 * REMPLACER UN PERSONNAGE DE COLONNE, sans passer par une carte.
 *
 * Les sept personnages d'origine sont versionnés dans `web/public/personnages/`
 * et servis comme n'importe quel fichier de l'interface. Celui qu'on dépose
 * depuis les réglages vit AILLEURS — dans les données (`data/personnages/`) —
 * mais porte le MÊME NOM et se sert à la MÊME ADRESSE : c'est le démon qui
 * décide, à cette adresse, lequel des deux il rend. Trois raisons à ce choix :
 *
 *  - rien à changer dans l'interface, le service worker ni les notifications :
 *    tous continuent de demander `/personnages/<colonne>.png` ;
 *  - une image déposée par l'utilisateur n'est pas du code : elle ne doit ni
 *    entrer dans le dépôt, ni disparaître au prochain changement de branche ;
 *  - revenir au personnage d'origine se fait alors en EFFAÇANT deux fichiers,
 *    sans jamais toucher aux images livrées.
 *
 * La fabrique, elle, n'est pas refaite ici : c'est le MÊME script Python que
 * pour les sept d'origine (`scripts/personnages-colonnes.py --une`), donc le
 * même détourage, le même cadrage et les mêmes tailles. Sans lui — Python
 * absent, bibliothèques absentes —, le remplacement est REFUSÉ avec sa raison,
 * jamais bricolé autrement.
 */

/** Le détourage n'est pas instantané : on lui laisse le temps, sans l'attendre indéfiniment. */
const PLAFOND_DETOURAGE_MS = 60_000;

const SCRIPT = path.join(CONFIG.selfPath, 'scripts', 'personnages-colonnes.py');

/** Le fichier d'une découpe REMPLACÉE, existant ou non. */
function fichierRemplace(colonne: ColumnKey, decoupe: DecoupeDePersonnage): string {
  return path.join(PATHS.personnages, fichierDuPersonnage(colonne, decoupe));
}

/**
 * Un personnage n'est remplacé que si ses DEUX découpes sont là : une
 * silhouette sans son portrait donnerait un tableau à la nouvelle image et des
 * notifications à l'ancienne.
 */
function remplacementComplet(colonne: ColumnKey): boolean {
  return (['silhouette', 'portrait'] as const).every((decoupe) => fs.existsSync(fichierRemplace(colonne, decoupe)));
}

/**
 * Les colonnes dont le personnage a été remplacé, et QUAND. L'instant sert au
 * navigateur à redemander l'image au lieu de ressortir celle de son cache.
 */
export function personnagesRemplaces(): Record<string, number> {
  const etat: Record<string, number> = {};
  for (const colonne of COLUMN_KEYS) {
    if (!remplacementComplet(colonne)) continue;
    try {
      etat[colonne] = Math.round(fs.statSync(fichierRemplace(colonne, 'silhouette')).mtimeMs);
    } catch {
      // Le fichier vient de disparaître entre les deux lectures : il n'y a
      // simplement plus de remplacement pour cette colonne.
    }
  }
  return etat;
}

/** Le fichier à SERVIR pour une découpe : le remplaçant s'il existe, sinon rien. */
export function fichierDuPersonnageRemplace(nomDeFichier: string): string | null {
  const propre = path.basename(nomDeFichier);
  for (const colonne of COLUMN_KEYS) {
    for (const decoupe of ['silhouette', 'portrait'] as const) {
      if (fichierDuPersonnage(colonne, decoupe) !== propre) continue;
      if (!remplacementComplet(colonne)) return null;
      return fichierRemplace(colonne, decoupe);
    }
  }
  return null;
}

/** Une adresse qui vise un personnage, quelle que soit la colonne. */
export function routeDUnPersonnage(route: string): string | null {
  const prefixe = `/${DOSSIER_DES_PERSONNAGES}/`;
  return route.startsWith(prefixe) ? route.slice(prefixe.length) : null;
}

/** Le script de fabrique, lancé sur UNE image. Rend la raison d'un refus, ou rien. */
function detourer(colonne: ColumnKey, source: string, sortie: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'python3',
      [SCRIPT, '--une', colonne, source, sortie],
      { timeout: PLAFOND_DETOURAGE_MS },
      (err, _sortieStd, erreurStd) => {
        if (!err) return resolve(null);
        const dit = String(erreurStd ?? '').trim();
        const derniereLigne = dit.split('\n').filter(Boolean).pop() ?? '';
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return resolve("Le détourage des images n'est pas disponible sur ce serveur : Python 3 est introuvable.");
        }
        if (/ModuleNotFoundError|No module named/.test(dit)) {
          return resolve(
            `Le détourage des images n'est pas disponible sur ce serveur : ${derniereLigne || 'une bibliothèque Python manque (numpy, Pillow)'}.`,
          );
        }
        if ((err as any).killed) {
          return resolve("Le détourage a été trop long et a été arrêté : essayez avec une image plus petite.");
        }
        // Le script dit lui-même, en clair, ce qui l'a arrêté : on le répète
        // tel quel plutôt que d'inventer une cause.
        return resolve(derniereLigne || "Le détourage de l'image a échoué.");
      },
    );
  });
}

/**
 * Le personnage d'une colonne, remplacé par l'image reçue. Rien n'est écrit
 * tant que les DEUX découpes ne sont pas fabriquées : un détourage qui échoue à
 * mi-chemin laisse le personnage précédent intact.
 */
export async function remplacerLePersonnage(depot: {
  colonne: string;
  mime?: string;
  nom?: string;
  image: Buffer;
}): Promise<{ ok: true; remplaces: Record<string, number> } | { ok: false; error: string }> {
  const juge = jugerImageDePersonnage({
    colonne: depot.colonne,
    mime: depot.mime,
    nom: depot.nom,
    taille: depot.image.length,
  });
  if (!juge.ok) return { ok: false, error: juge.raison };
  const colonne = depot.colonne as ColumnKey;

  const chantier = fs.mkdtempSync(path.join(os.tmpdir(), 'personnage-'));
  try {
    const source = path.join(chantier, `source${path.extname(depot.nom ?? '') || '.png'}`);
    fs.writeFileSync(source, depot.image);
    const refus = await detourer(colonne, source, chantier);
    if (refus) return { ok: false, error: refus };

    const faits = (['silhouette', 'portrait'] as const).map((decoupe) => ({
      decoupe,
      chemin: path.join(chantier, fichierDuPersonnage(colonne, decoupe)),
    }));
    for (const fait of faits) {
      if (!fs.existsSync(fait.chemin)) {
        return { ok: false, error: "Le détourage n'a pas produit les deux découpes attendues." };
      }
    }
    fs.mkdirSync(PATHS.personnages, { recursive: true });
    for (const fait of faits) fs.copyFileSync(fait.chemin, fichierRemplace(colonne, fait.decoupe));
    log.info('personnages', `personnage de « ${colonne} » remplacé`);
    const remplaces = personnagesRemplaces();
    bus.emit({ type: 'personnages', remplaces });
    return { ok: true, remplaces };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Le remplacement du personnage a échoué." };
  } finally {
    fs.rmSync(chantier, { recursive: true, force: true });
  }
}

/**
 * Retour au personnage d'origine : on efface les deux découpes déposées, et
 * l'image livrée avec l'application reprend sa place d'elle-même. Rien n'est
 * jamais supprimé du dépôt.
 */
export function retablirLePersonnage(colonne: string): { ok: true; remplaces: Record<string, number> } | { ok: false; error: string } {
  if (!(COLUMN_KEYS as readonly string[]).includes(colonne)) {
    return { ok: false, error: `« ${colonne} » n'est pas une colonne du tableau.` };
  }
  const cle = colonne as ColumnKey;
  if (!remplacementComplet(cle)) {
    return { ok: false, error: 'Cette colonne a déjà son personnage d’origine.' };
  }
  for (const decoupe of ['silhouette', 'portrait'] as const) {
    fs.rmSync(fichierRemplace(cle, decoupe), { force: true });
  }
  log.info('personnages', `personnage de « ${cle} » rendu à son image d'origine`);
  const remplaces = personnagesRemplaces();
  bus.emit({ type: 'personnages', remplaces });
  return { ok: true, remplaces };
}
