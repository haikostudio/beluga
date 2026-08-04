import fs from 'node:fs';
import path from 'node:path';
import {
  Competence,
  FICHIER_COMPETENCE,
  NOM_DOSSIER_COMPETENCES,
  enTeteDeCompetence,
  gesteDeLiaison,
} from '@haikodev/shared';
import { PATHS } from './config.js';
import { listAccountRecords } from './accounts.js';
import { log } from './logger.js';

/**
 * LES COMPÉTENCES PARTAGÉES, CÔTÉ DISQUE (règles dans
 * `shared/src/competences.ts`).
 *
 * Un seul dossier fait foi : `data/competences/`. Chaque compétence y est un
 * dossier portant un `SKILL.md` — écrit là, ou simplement lié depuis l'endroit
 * où l'utilisateur le tient à jour. Le démon le recopie dans le coffre de
 * chaque compte Claude (`<coffre>/skills/<nom>`), qui est le seul endroit où ce
 * moteur va chercher ses compétences ; Codex, lui, n'en a aucun — c'est le
 * briefing qui les lui annonce, comme au chef d'orchestre bridé.
 */

/** Le dossier des compétences partagées. */
export function dossierDesCompetences(): string {
  return PATHS.competences;
}

/** Les compétences partagées, triées par nom. Jamais d'exception : au pire, rien. */
export function listerCompetences(dossier = dossierDesCompetences()): Competence[] {
  const liste: Competence[] = [];
  let entrees: string[] = [];
  try {
    entrees = fs.readdirSync(dossier);
  } catch {
    return liste;
  }
  for (const nom of entrees) {
    if (nom.startsWith('.')) continue;
    // Un lien vers le dossier tenu par l'utilisateur compte autant qu'un vrai
    // dossier : on interroge la CIBLE, pas le lien.
    const chemin = path.join(dossier, nom);
    const fichier = path.join(chemin, FICHIER_COMPETENCE);
    let texte: string;
    try {
      if (!fs.statSync(chemin).isDirectory()) continue;
      texte = fs.readFileSync(fichier, 'utf8');
    } catch {
      continue;
    }
    const entete = enTeteDeCompetence(texte);
    liste.push({
      nom: entete.nom?.trim() || nom,
      description: entete.description?.trim() || 'compétence sans description',
      dossier: chemin,
      fichier,
    });
  }
  return liste.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function cheminReel(chemin: string): string | undefined {
  try {
    return fs.realpathSync(chemin);
  } catch {
    return undefined;
  }
}

export interface BilanDeLiaison {
  /** Liens posés à l'instant. */
  posees: string[];
  /** Compétences déjà en place, rien à faire. */
  dejaLa: string[];
  /** La place était prise par autre chose : on n'y touche pas, on le dit. */
  occupees: string[];
}

/**
 * Pose chaque compétence partagée dans le coffre des comptes Claude. Rien n'est
 * écrasé : une place déjà occupée par autre chose est LAISSÉE et signalée —
 * c'est souvent la compétence d'origine, tenue à jour par l'utilisateur.
 */
export function relierCompetencesAuxCoffres(): BilanDeLiaison {
  const bilan: BilanDeLiaison = { posees: [], dejaLa: [], occupees: [] };
  const competences = listerCompetences();
  if (!competences.length) return bilan;

  for (const compte of listAccountRecords()) {
    // Seul Claude Code lit un dossier de compétences ; Codex ne connaît pas la
    // notion, et le briefing s'en charge pour lui.
    if (compte.engine !== 'claude') continue;
    const dossierSkills = path.join(compte.configDir, NOM_DOSSIER_COMPETENCES);
    try {
      fs.mkdirSync(dossierSkills, { recursive: true });
    } catch (err) {
      log.warn(`compétences : coffre ${compte.id} inaccessible (${(err as Error).message})`);
      continue;
    }
    for (const competence of competences) {
      const source = cheminReel(competence.dossier);
      if (!source) continue;
      const cible = path.join(dossierSkills, competence.nom);
      const geste = gesteDeLiaison(source, cheminReel(cible));
      if (geste === 'deja-liee') {
        bilan.dejaLa.push(`${compte.id}/${competence.nom}`);
        continue;
      }
      if (geste === 'occupe') {
        bilan.occupees.push(`${compte.id}/${competence.nom}`);
        continue;
      }
      try {
        // Un lien mort occupe la place sans avoir de chemin réel : on le retire
        // avant de reposer le bon, sinon le lien échoue à chaque démarrage.
        if (fs.lstatSync(cible, { throwIfNoEntry: false })) fs.unlinkSync(cible);
        fs.symlinkSync(source, cible, 'dir');
        bilan.posees.push(`${compte.id}/${competence.nom}`);
      } catch (err) {
        log.warn(`compétence « ${competence.nom} » non posée dans ${compte.id} : ${(err as Error).message}`);
      }
    }
  }

  if (bilan.posees.length) log.info(`compétences partagées posées : ${bilan.posees.join(', ')}`);
  if (bilan.occupees.length) {
    log.info(`compétences déjà présentes autrement (laissées telles quelles) : ${bilan.occupees.join(', ')}`);
  }
  return bilan;
}
