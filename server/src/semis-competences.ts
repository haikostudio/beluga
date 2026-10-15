import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DOSSIER_DES_COMPETENCES_PUBLIEES } from '@beluga/shared';
import { dossierDesCompetences, enregistrerLePool, reecrireLesFichiersDEntree } from './competences.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * LE SEMIS DES COMPÉTENCES PUBLIÉES — une installation neuve ne part plus de rien.
 *
 * Le dépôt public porte, sous `competences/`, les fiches d'interface qui ont
 * passé le tri et le contrôle de la synchronisation
 * (`scripts/synchroniser-miroir-public.mjs`). À chaque démarrage, le démon les
 * sème dans le pool de l'installation :
 *
 *  - une fiche ABSENTE du pool y est copiée ;
 *  - une fiche déjà semée et RESTÉE telle quelle suit la version publiée ;
 *  - une fiche MODIFIÉE ici, ou retirée à la main après avoir été semée, n'est
 *    plus touchée : le pool reste à son propriétaire.
 *
 * Le registre `.semees.json` (dans le pool) garde l'empreinte de chaque fiche
 * semée : c'est lui qui distingue « jamais vue » de « retirée exprès ».
 *
 * Le dépôt PRIVÉ n'a pas de dossier `competences/` (le pool y vit dans `data/`) :
 * sur l'installation d'origine, ce semis ne fait rien.
 */

const REGISTRE = '.semees.json';

type Registre = Record<string, string>;

function empreinte(fichier: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(fichier)).digest('hex');
}

function lireRegistre(pool: string): Registre {
  try {
    const lu = JSON.parse(fs.readFileSync(path.join(pool, REGISTRE), 'utf8'));
    return lu && typeof lu === 'object' ? lu : {};
  } catch {
    return {};
  }
}

export interface BilanDuSemis {
  ajoutees: string[];
  misesAJour: string[];
  gardees: string[];
}

export function semerLesCompetencesPubliees(
  pool = dossierDesCompetences(),
  source = path.join(CONFIG.selfPath, DOSSIER_DES_COMPETENCES_PUBLIEES),
): BilanDuSemis {
  const bilan: BilanDuSemis = { ajoutees: [], misesAJour: [], gardees: [] };
  if (!fs.existsSync(source)) return bilan;
  const registre = lireRegistre(pool);
  fs.mkdirSync(pool, { recursive: true });

  for (const nom of fs.readdirSync(source).sort()) {
    const publie = path.join(source, nom);
    const tetePubliee = path.join(publie, 'SKILL.md');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(nom) || !fs.existsSync(tetePubliee)) continue;
    const ici = path.join(pool, nom);
    const teteIci = path.join(ici, 'SKILL.md');
    const versionPubliee = empreinte(tetePubliee);

    if (!fs.existsSync(ici)) {
      if (registre[nom]) continue; // semée puis retirée à la main : on ne la remet pas
      fs.cpSync(publie, ici, { recursive: true });
      registre[nom] = versionPubliee;
      bilan.ajoutees.push(nom);
      continue;
    }
    if (!registre[nom] || !fs.existsSync(teteIci)) continue; // une fiche d'ici, du même nom : jamais écrasée
    const versionIci = empreinte(teteIci);
    if (versionIci === versionPubliee) continue;
    if (versionIci !== registre[nom]) {
      bilan.gardees.push(nom); // modifiée ici depuis le semis
      continue;
    }
    fs.rmSync(ici, { recursive: true, force: true });
    fs.cpSync(publie, ici, { recursive: true });
    registre[nom] = versionPubliee;
    bilan.misesAJour.push(nom);
  }

  if (bilan.ajoutees.length || bilan.misesAJour.length) {
    fs.writeFileSync(path.join(pool, REGISTRE), `${JSON.stringify(registre, null, 2)}\n`);
    log.info(`compétences publiées semées : ${bilan.ajoutees.length} ajoutée(s), ${bilan.misesAJour.length} mise(s) à jour`);
  }
  return bilan;
}

/** Au démarrage : semer, puis réécrire les fichiers d'entrée et enregistrer le pool si quelque chose a bougé. */
export function semerAuDemarrage(): void {
  try {
    const bilan = semerLesCompetencesPubliees();
    if (!bilan.ajoutees.length && !bilan.misesAJour.length) return;
    reecrireLesFichiersDEntree();
    enregistrerLePool(dossierDesCompetences(), 'sème les compétences publiées avec Beluga Build');
  } catch (err: any) {
    log.warn('semis des compétences publiées impossible', err?.message ?? err);
  }
}

/** Les fiches arrivées par le semis : l'écran les dit « publiées avec Beluga Build ». */
export function nomsSemes(pool = dossierDesCompetences()): Set<string> {
  return new Set(Object.keys(lireRegistre(pool)));
}
