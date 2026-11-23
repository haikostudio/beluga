/*
 * L'EXTENSION BELUGA POUR SAFARI, CÔTÉ DÉMON (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026).
 *
 * Sur Mac, une extension Safari s'emballe dans une petite application. Elle est FABRIQUÉE sur les machines Mac de
 * GitHub (`.github/workflows/extension-safari.yml`, lancé à la main ou par une étiquette « safari-v* », jamais à
 * chaque enregistrement), signée « Developer ID » et notarisée par Apple, puis rangée en artefact. Le démon récupère
 * le dernier artefact réussi (`gh`, déjà identifié sur ce serveur) dans `data/extension-safari/`, et le sert par
 * `/api/extension-safari.zip` à côté du paquet Chrome. Rien n'est fabriqué ici : un serveur Linux ne signe pas une
 * application Mac.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * Le dépôt où tourne la fabrication (`BELUGA_DEPOT_DE_FABRICATION`). Le dépôt privé de l'auteur n'est écrit qu'au privé
 */
let depotParDefaut = '';
export const DEPOT_DE_FABRICATION = process.env.BELUGA_DEPOT_DE_FABRICATION || depotParDefaut;
/** Le nom de l'artefact rangé par la fabrication. */
export const ARTEFACT_SAFARI = 'beluga-safari';
/** Le nom du fichier servi. */
export const FICHIER_SAFARI = 'Beluga-Safari.zip';

const RELIRE_APRES_MS = 6 * 3600_000;

function dossier(): string {
  return path.join(CONFIG.dataDir, 'extension-safari');
}

/** Le paquet Safari déjà récupéré, avec sa version (lue dans `version.txt`), ou `null`. */
export function paquetSafari(): { chemin: string; version: string | null } | null {
  const chemin = path.join(dossier(), FICHIER_SAFARI);
  if (!fs.existsSync(chemin)) {
    void rafraichirLePaquetSafari();
    return null;
  }
  let version: string | null = null;
  try {
    version = fs.readFileSync(path.join(dossier(), 'version.txt'), 'utf8').trim() || null;
  } catch {
    /* pas de version écrite */
  }
  void rafraichirLePaquetSafari();
  return { chemin, version };
}

function gh(args: string[], cwd?: string): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    execFile('gh', args, { cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err, sortie, erreurs) => {
      if (err) rejeter(new Error(String(erreurs || err.message).trim()));
      else resoudre(String(sortie));
    });
  });
}

/** La même chose pour un contenu BINAIRE (le zip d'un artefact) : `gh api` n'a pas d'option de fichier de sortie. */
function ghBinaire(args: string[]): Promise<Buffer> {
  return new Promise((resoudre, rejeter) => {
    execFile('gh', args, { timeout: 180_000, maxBuffer: 200 * 1024 * 1024, encoding: 'buffer' }, (err, sortie, erreurs) => {
      if (err) rejeter(new Error(String(erreurs?.toString() || err.message).trim()));
      else resoudre(sortie);
    });
  });
}

let dernierEssai = 0;
let enCours: Promise<boolean> | null = null;

/**
 * RÉCUPÉRER LE DERNIER PAQUET SIGNÉ (au plus une fois toutes les six heures, sans bloquer personne) : le dernier
 * artefact `beluga-safari` non expiré du dépôt de fabrication, s'il est plus récent que celui déjà là.
 */
export function rafraichirLePaquetSafari(force = false): Promise<boolean> {
  /* Un démon d'essai ou un test ne va pas chercher chez GitHub, sauf demande expresse (`BELUGA_SAFARI_RELEVE=1`). */
  if ((process.env.BELUGA_ESSAI === '1' || process.env.BELUGA_DATA) && process.env.BELUGA_SAFARI_RELEVE !== '1') return Promise.resolve(false);
  if (!DEPOT_DE_FABRICATION) return Promise.resolve(false);
  if (enCours) return enCours;
  if (!force && Date.now() - dernierEssai < RELIRE_APRES_MS) return Promise.resolve(false);
  dernierEssai = Date.now();
  enCours = (async () => {
    try {
      const brut = await gh(['api', `repos/${DEPOT_DE_FABRICATION}/actions/artifacts?name=${ARTEFACT_SAFARI}&per_page=5`]);
      const liste = (JSON.parse(brut).artifacts ?? []) as { id: number; expired: boolean; created_at: string; workflow_run?: { head_branch?: string } }[];
      const dernier = liste.filter((a) => !a.expired).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (!dernier) return false;
      const marque = path.join(dossier(), 'artefact.txt');
      if (fs.existsSync(marque) && fs.readFileSync(marque, 'utf8').trim() === String(dernier.id)) return false;
      const temporaire = fs.mkdtempSync(path.join(CONFIG.dataDir, 'safari-'));
      try {
        /* `gh run download` refuse un artefact par son seul identifiant : l'API rend un zip qui contient le paquet. */
        const zip = path.join(temporaire, 'artefact.zip');
        fs.writeFileSync(zip, await ghBinaire(['api', `repos/${DEPOT_DE_FABRICATION}/actions/artifacts/${dernier.id}/zip`]));
        await new Promise<void>((ok, ko) => execFile('unzip', ['-o', '-q', zip, '-d', temporaire], (e) => (e ? ko(e) : ok())));
        const paquet = path.join(temporaire, FICHIER_SAFARI);
        if (!fs.existsSync(paquet)) throw new Error(`l'artefact ne contient pas ${FICHIER_SAFARI}`);
        fs.mkdirSync(dossier(), { recursive: true });
        fs.copyFileSync(paquet, path.join(dossier(), FICHIER_SAFARI));
        const version = path.join(temporaire, 'version.txt');
        if (fs.existsSync(version)) fs.copyFileSync(version, path.join(dossier(), 'version.txt'));
        fs.writeFileSync(marque, String(dernier.id));
        log.info(`extension Safari : paquet ${dernier.id} récupéré`);
        return true;
      } finally {
        fs.rmSync(temporaire, { recursive: true, force: true });
      }
    } catch (err) {
      log.warn('extension Safari : paquet non récupéré', String((err as Error)?.message ?? err).slice(0, 300));
      return false;
    } finally {
      enCours = null;
    }
  })();
  return enCours;
}
