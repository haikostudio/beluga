/**
 * LES CHARTES D'INTERFACE : lues dans le dépôt du projet, servies d'office,
 * contrôlées à la fin du tour (règles pures : `shared/src/chartes.ts`).
 *
 * - Les FICHIERS (`docs/chartes/<nom>.md`) voyagent avec le dépôt : l'agent et
 *   l'humain les lisent, une branche les modifie comme du code.
 * - L'ÉTAT (proposée / validée) se garde AUSSI en base (`meta`,
 *   `charte.etat.<projet>.<nom>`) : valider d'un clic depuis l'écran ne touche
 *   pas au dépôt d'un autre projet. La base l'emporte sur l'entête du fichier.
 * - Le service note chaque charte servie dans `connaissance_lectures`
 *   (`charte:<nom>`) : c'est ce que mesure `scripts/mesure-usage-memoire.mjs`,
 *   et c'est ce qui évite de la resservir dans la même session.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DOSSIER_DES_CHARTES,
  chartesConcernees,
  cheminsCitesDans,
  controlerLesInterdits,
  lireCharte,
  texteDesChartes,
  verdictDeFinDeTour,
  type Card,
  type Charte,
  type EtatDeCharte,
  type EtapeDuParcours,
  type ManquementALaCharte,
  type Project,
  type VerdictDeFinDeTour,
} from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { brancheDeDeploiement } from './branche-de-deploiement.js';
import { git } from './git.js';
import { log } from './logger.js';
import { lusDansLaSession, noterUneLecture } from './connaissances.js';

const cleDEtat = (projectId: string, nom: string) => `charte.etat.${projectId}.${nom}`;

/** Les chartes d'un dépôt, état de la base appliqué. Un dépôt sans dossier n'en a aucune. */
export function chartesDuDepot(racine: string, projectId?: string): Charte[] {
  const dossier = path.join(racine, DOSSIER_DES_CHARTES);
  let noms: string[] = [];
  try {
    noms = fs.readdirSync(dossier).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
  } catch {
    return [];
  }
  const chartes: Charte[] = [];
  for (const fichier of noms.sort()) {
    try {
      const charte = lireCharte(fichier.slice(0, -3), fs.readFileSync(path.join(dossier, fichier), 'utf8'));
      if (!charte) continue;
      const etat = projectId ? getMeta(cleDEtat(projectId, charte.nom)) : null;
      chartes.push(etat === 'validee' || etat === 'proposee' ? { ...charte, etat } : charte);
    } catch (err) {
      log.warn(`charte illisible ${fichier} : ${(err as Error).message}`);
    }
  }
  return chartes;
}

/** Valide (ou repasse en proposée) une charte d'un projet. */
export function poserLEtatDeLaCharte(projectId: string, nom: string, etat: EtatDeCharte): void {
  setMeta(cleDEtat(projectId, nom), etat);
}

/**
 * LES FICHIERS QUE LA BRANCHE DE LA CARTE TOUCHE : enregistrés depuis son point
 * de départ, plus ce qui n'est pas encore enregistré. Vide hors d'un dépôt.
 */
export async function fichiersDeLaBranche(dossier: string, project: Pick<Project, 'path' | 'branchesDePublication'>): Promise<string[]> {
  const vus = new Set<string>();
  const ajouter = (sortie: { ok: boolean; out: string }) => {
    if (sortie.ok) for (const f of sortie.out.split('\n')) if (f.trim()) vus.add(f.trim());
  };
  try {
    const depart = await brancheDeDeploiement(project.path, project.branchesDePublication).catch(() => '');
    if (depart) {
      const base = await git(dossier, ['merge-base', 'HEAD', depart]);
      if (base.ok && base.out.trim()) ajouter(await git(dossier, ['diff', '--name-only', base.out.trim(), 'HEAD']));
    }
    ajouter(await git(dossier, ['diff', '--name-only', 'HEAD']));
    ajouter(await git(dossier, ['ls-files', '--others', '--exclude-standard']));
  } catch {
    /* pas un dépôt : aucun fichier */
  }
  return [...vus];
}

/** Ce que la compréhension validée prévoit de toucher : ses tâches, en texte. */
function travailPrevu(card: Card): string {
  const taches = card.parcours?.comprehension?.partieTechnique?.taches?.map((t) => `${t.titre} ${t.description}`).join('\n') ?? '';
  return `${card.title}\n${card.description ?? ''}\n${taches}`;
}

/**
 * LE BLOC DES CHARTES DU TOUR, ou rien. Servi à tout tour d'une carte (cadrage,
 * exécution, reprise après panne) dont le travail touche le domaine d'une
 * charte, une fois par session : une session neuve le reçoit de nouveau.
 */
export async function blocDesChartesDuTour(options: {
  project: Project;
  card: Card;
  agentId: string;
  dossier: string;
  nouvelleSession: boolean;
  cadrage: boolean;
  etape?: EtapeDuParcours;
}): Promise<string> {
  const { project, card, agentId, dossier } = options;
  // Le dépôt de la carte d'abord (une charte modifiée sur la branche fait foi), le projet sinon.
  const chartes = chartesDuDepot(fs.existsSync(path.join(dossier, DOSSIER_DES_CHARTES)) ? dossier : project.path, project.id);
  if (!chartes.length) return '';
  const prevu = travailPrevu(card);
  const fichiers = [...cheminsCitesDans(prevu), ...(dossier !== project.path ? await fichiersDeLaBranche(dossier, project) : [])];
  const concernees = chartesConcernees(chartes, { fichiers, demande: prevu });
  if (!concernees.length) return '';
  const dejaServies = options.nouvelleSession ? new Set<string>() : lusDansLaSession(agentId);
  const aServir = concernees.filter((c) => !dejaServies.has(`charte:${c.nom}`));
  if (!aServir.length) return '';
  for (const c of aServir) {
    try {
      noterUneLecture(`charte:${c.nom}`, agentId, card.id, options.etape);
    } catch {
      /* base partielle : la charte part quand même */
    }
  }
  return texteDesChartes(aServir, { cadrage: options.cadrage });
}

/** Les manquements aux interdits dans les fichiers modifiés d'une branche. */
export function manquementsDesFichiers(dossier: string, chartes: readonly Charte[], fichiers: readonly string[]): ManquementALaCharte[] {
  const lus = fichiers
    .map((chemin) => {
      try {
        return { chemin, contenu: fs.readFileSync(path.join(dossier, chemin), 'utf8') };
      } catch {
        return null; // supprimé sur la branche
      }
    })
    .filter((f): f is { chemin: string; contenu: string } => !!f);
  return controlerLesInterdits(chartes, lus);
}

/* ------------------------------------------------------------------ */
/* La porte de fin de tour                                              */
/* ------------------------------------------------------------------ */

const cleDesRenvois = (cardId: string) => `charte.renvois.${cardId}`;

/** Les images écrites ou jointes pendant le travail d'un agent : la preuve d'une relecture en images. */
export function capturesDuTravail(
  messages: readonly { attachments?: readonly string[] }[],
  lirePiece: (id: string) => { mime: string } | null,
): number {
  return messages.reduce((n, m) => n + (m.attachments ?? []).filter((id) => lirePiece(id)?.mime.startsWith('image/')).length, 0);
}

/**
 * LA PORTE DE FIN DE TOUR D'UNE CARTE (`verdictDeFinDeTour`, règle pure). Lit
 * les fichiers de la branche, les chartes du dépôt de la carte, les captures du
 * travail ; compte les renvois en base pour que la troisième fin de tour rende
 * toujours. Une panne ici laisse RENDRE : la porte ne retient jamais une carte.
 */
export async function porteDeFinDeTour(options: {
  project: Project;
  cardId: string;
  dossier: string;
  captures: number;
}): Promise<VerdictDeFinDeTour> {
  try {
    const { project, cardId, dossier } = options;
    const chartes = chartesDuDepot(fs.existsSync(path.join(dossier, DOSSIER_DES_CHARTES)) ? dossier : project.path, project.id);
    if (!chartes.length) return { issue: 'rendre', raison: 'hors-interface' };
    const fichiers = await fichiersDeLaBranche(dossier, project);
    const renvois = Number(getMeta(cleDesRenvois(cardId)) ?? 0) || 0;
    const verdict = verdictDeFinDeTour({
      fichiersModifies: fichiers,
      chartes,
      manquements: manquementsDesFichiers(dossier, chartes, fichiers),
      captures: options.captures,
      renvois,
    });
    if (verdict.issue === 'renvoyer') setMeta(cleDesRenvois(cardId), String(renvois + 1));
    return verdict;
  } catch (err) {
    log.warn(`porte de fin de tour sautée : ${(err as Error).message}`);
    return { issue: 'rendre', raison: 'hors-interface' };
  }
}
