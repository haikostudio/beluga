/**
 * LES COMMANDES « / » SONT RELEVÉES SUR LE DISQUE, JAMAIS ÉCRITES EN DUR.
 *
 * Même raison que pour le catalogue des modèles (`engines/catalog.ts`) : une
 * liste figée devient fausse à la première mise à jour du moteur, et propose
 * des commandes qui n'existent plus. Ici, on va lire les dossiers RÉELS où
 * chaque moteur range ses commandes et ses compétences — ceux du COMPTE (son
 * coffre de configuration) et ceux du PROJET. Ce qui n'est pas sur le disque
 * n'est pas proposé.
 *
 * Les règles pures — tri, filtre, insertion — vivent dans
 * `shared/src/commandes-slash.ts` ; ce fichier ne fait que lire des dossiers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CommandeSlash, EngineId, OrigineCommande, nomDeCommandeValable } from '@beluga/shared';
import { listAccountRecords } from './accounts.js';
import { log } from './logger.js';

/**
 * Où chaque moteur range ses commandes, sous un dossier de compte et sous un
 * dossier de projet. `commands` / `prompts` : un fichier `.md` = une commande.
 * `skills` : un dossier par compétence, avec son `SKILL.md`.
 */
const DOSSIERS: Record<EngineId, { compte: string[]; projet: string[] }> = {
  claude: { compte: ['commands', 'skills'], projet: ['.claude/commands', '.claude/skills'] },
  codex: { compte: ['prompts', 'skills'], projet: ['.codex/prompts', '.codex/skills'] },
  cursor: { compte: ['commands'], projet: ['.cursor/commands', '.cursor/rules'] },
};

/** La première ligne « description: » de l'entête, quand il y en a une. */
function descriptionDuFichier(chemin: string): string | undefined {
  try {
    // L'entête tient dans les premiers milliers de signes : inutile de charger
    // un mode d'emploi entier pour en lire une ligne.
    const debut = fs.readFileSync(chemin, 'utf8').slice(0, 4000);
    const trouve = /^description:\s*(.+)$/m.exec(debut);
    if (!trouve) return undefined;
    const texte = trouve[1]!.trim().replace(/^["']|["']$/g, '');
    // Une description de compétence peut faire dix lignes : le menu n'en montre
    // qu'un aperçu, on coupe donc à la première phrase utile.
    return texte.length > 160 ? `${texte.slice(0, 157)}…` : texte;
  } catch {
    return undefined;
  }
}

/** Les commandes d'UN dossier : ses fichiers `.md`, ou ses sous-dossiers. */
function lireUnDossier(dossier: string, origine: OrigineCommande): CommandeSlash[] {
  let entrees: fs.Dirent[];
  try {
    entrees = fs.readdirSync(dossier, { withFileTypes: true });
  } catch {
    /* dossier absent : ce moteur n'a rien rangé là, ce n'est pas une panne. */
    return [];
  }
  const commandes: CommandeSlash[] = [];
  for (const entree of entrees) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      // Une compétence : le nom du dossier, la description de son `SKILL.md`.
      const fiche = path.join(chemin, 'SKILL.md');
      if (!fs.existsSync(fiche)) continue;
      if (!nomDeCommandeValable(entree.name)) continue;
      commandes.push({ nom: entree.name, description: descriptionDuFichier(fiche), origine });
      continue;
    }
    if (!entree.name.endsWith('.md')) continue;
    const nom = entree.name.slice(0, -3);
    if (!nomDeCommandeValable(nom)) continue;
    commandes.push({ nom, description: descriptionDuFichier(chemin), origine });
  }
  return commandes;
}

/**
 * TOUTES LES COMMANDES D'UN MOTEUR, relevées sur le disque : celles des coffres
 * de compte fournis, puis celles du projet — qui l'emportent, c'est là qu'on
 * écrit ses propres commandes.
 */
export function commandesSurLeDisque(
  moteur: EngineId,
  racineDuProjet: string | undefined,
  coffresDeCompte: readonly string[],
): CommandeSlash[] {
  const dossiers = DOSSIERS[moteur];
  if (!dossiers) return [];
  const parNom = new Map<string, CommandeSlash>();
  for (const coffre of coffresDeCompte) {
    for (const sous of dossiers.compte) {
      for (const commande of lireUnDossier(path.join(coffre, sous), 'compte')) {
        parNom.set(commande.nom, commande);
      }
    }
  }
  if (racineDuProjet) {
    for (const sous of dossiers.projet) {
      for (const commande of lireUnDossier(path.join(racineDuProjet, sous), 'projet')) {
        parNom.set(commande.nom, commande);
      }
    }
  }
  return [...parNom.values()];
}

/** Les coffres de configuration connus pour un moteur, sans doublon. */
function coffresDuMoteur(moteur: EngineId): string[] {
  try {
    return [...new Set(listAccountRecords().filter((c) => c.engine === moteur).map((c) => c.configDir))];
  } catch (err) {
    log.warn('commandes « / » : comptes illisibles', err);
    return [];
  }
}

/**
 * CE QUI PART À L'INTERFACE : un relevé par moteur, pour UN projet. Le tri et
 * l'ajout des commandes du moteur lui-même se font côté écran
 * (`commandesDuMoteur`), pour que la même règle serve partout.
 */
export function relevesDesCommandes(racineDuProjet: string | undefined): Record<string, CommandeSlash[]> {
  const releve: Record<string, CommandeSlash[]> = {};
  for (const moteur of ['claude', 'codex', 'cursor'] as EngineId[]) {
    releve[moteur] = commandesSurLeDisque(moteur, racineDuProjet, coffresDuMoteur(moteur));
  }
  return releve;
}
