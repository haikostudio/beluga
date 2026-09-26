import fs from 'node:fs';
import { Card, CopieDeDepot, DepotAnnexe, Project, aPlusieursDepots, nomDeBranche } from '@beluga/shared';
import * as store from './store.js';
import { log } from './logger.js';
import { dossierDeCarte } from './copies-de-cartes.js';
import {
  archiverLaBrancheDeCarte,
  enregistrerLeTravailEnCours,
  fichiersNonEnregistres,
  ouvrirDossierDeCarte,
  refermerDossierDeCarte,
  travailDejaSurLaBranche,
  type BilanDArchivage,
  type BilanFermeture,
} from './dossier-de-carte.js';

/**
 * LES COPIES DE TRAVAIL D'UNE CARTE DANS LES DÉPÔTS ANNEXES
 * (`shared/src/depots-du-projet.ts`).
 *
 * Le dépôt principal garde son chemin d'aujourd'hui, intact : sa copie est
 * l'`agent.workdir`, ouverte par `prepareBranch`. Chaque annexe reçoit, À CÔTÉ,
 * une copie sur la MÊME branche « tache/… », par les mêmes gestes
 * (`ouvrirDossierDeCarte`, file d'attente par dépôt, réparation, enregistrement
 * d'office, fermeture). Un projet à dépôt simple ne passe jamais par ici : toutes
 * ces fonctions rendent tout de suite un résultat vide.
 */

export interface CopieAnnexe extends CopieDeDepot {
  depot: DepotAnnexe;
  /** Le point de départ de la branche dans ce dépôt, quand ce tour vient de la créer. */
  base?: string;
}

/** Où vit (ou vivra) la copie de cette carte dans chaque annexe — sans rien toucher. */
export function copiesAnnexesPrevues(project: Project, card: Pick<Card, 'title' | 'id'>): CopieAnnexe[] {
  if (!aPlusieursDepots(project)) return [];
  return project.depots.map((depot) => ({
    nom: depot.nom,
    dossier: dossierDeCarte(depot.path, card.title, card.id),
    depot,
  }));
}

/**
 * OUVRE (ou retrouve) la copie de la carte dans chaque annexe. Une copie déjà là
 * sur la bonne branche est gardée ; une copie abîmée se répare, dépôt par dépôt.
 * UN ÉCHEC SE DIT en nommant le dépôt : on ne laisse jamais partir un agent à
 * qui il manquerait une partie du projet sans le savoir.
 */
export async function ouvrirLesCopiesAnnexes(
  project: Project,
  card: Card,
): Promise<{ kind: 'pretes'; copies: CopieAnnexe[] } | { kind: 'echec'; raison: string }> {
  const copies: CopieAnnexe[] = [];
  for (const depot of project.depots ?? []) {
    const ouvert = await ouvrirDossierDeCarte(depot.path, card, depot.branchesDePublication).catch(
      (err): { kind: 'echec'; raison: string } => ({ kind: 'echec', raison: String(err?.message ?? err) }),
    );
    if (ouvert.kind === 'echec') {
      return { kind: 'echec', raison: `Dépôt « ${depot.nom} » (${depot.path}) : ${ouvert.raison}` };
    }
    copies.push({ nom: depot.nom, dossier: ouvert.dossier, depot, base: ouvert.base });
  }
  return { kind: 'pretes', copies };
}

/**
 * Les bases des annexes, écrites sur la carte à côté de `github.baseSha` : une
 * base déjà connue n'est JAMAIS réécrite, comme pour le principal.
 */
export function avecLesBasesAnnexes(github: Card['github'], copies: CopieAnnexe[]): Card['github'] {
  if (!copies.length || !github) return github;
  const connus = new Map((github.depots ?? []).map((d) => [d.nom, d]));
  for (const copie of copies) {
    const deja = connus.get(copie.nom);
    if (deja?.baseSha || !copie.base) continue;
    connus.set(copie.nom, { ...(deja ?? { nom: copie.nom, commits: [], fichiers: [] }), baseSha: copie.base });
  }
  return { ...github, depots: [...connus.values()] };
}

/** Referme chaque copie annexe de la carte en fin de tour : travail enregistré d'office, branche gardée. */
export async function refermerLesCopiesAnnexes(project: Project, card: Card): Promise<BilanFermeture[]> {
  const bilans: BilanFermeture[] = [];
  const branche = nomDeBranche(card.title, card.id);
  for (const copie of copiesAnnexesPrevues(project, card)) {
    if (!fs.existsSync(copie.dossier)) continue;
    try {
      const bilan = await refermerDossierDeCarte(copie.depot.path, copie.dossier, branche);
      bilans.push(bilan);
      if (!bilan.retire) log.warn(`copie annexe « ${copie.nom} » de « ${card.title} » gardée : ${bilan.raison}`);
    } catch (err) {
      log.error(`fermeture de la copie annexe « ${copie.nom} » de « ${card.title} » impossible`, err);
    }
  }
  return bilans;
}

/** La branche de la carte porte-t-elle du travail dans au moins un annexe ? */
export async function travailDansLesAnnexes(project: Project, card: Card): Promise<boolean> {
  const branche = nomDeBranche(card.title, card.id);
  for (const copie of copiesAnnexesPrevues(project, card)) {
    const porte = await travailDejaSurLaBranche(
      copie.depot.path,
      branche,
      copie.dossier,
      copie.depot.branchesDePublication,
    ).catch(() => false);
    if (porte) return true;
  }
  return false;
}

/** Enregistre d'office ce qui traîne dans les copies annexes (redémarrage forcé). Rend les fichiers sauvés. */
export async function enregistrerLesCopiesAnnexes(project: Project, card: Card): Promise<string[]> {
  const sauves: string[] = [];
  for (const copie of copiesAnnexesPrevues(project, card)) {
    const fichiers = await fichiersNonEnregistres(copie.dossier);
    if (await enregistrerLeTravailEnCours(copie.dossier)) sauves.push(...fichiers.map((f) => `${copie.nom}/${f}`));
  }
  return sauves;
}

/** Archive la branche de la carte dans chaque annexe, par la même règle que le principal. */
export async function archiverLesBranchesAnnexes(
  project: Project,
  branche: string | undefined,
): Promise<{ nom: string; bilan: BilanDArchivage }[]> {
  const bilans: { nom: string; bilan: BilanDArchivage }[] = [];
  if (!branche) return bilans;
  for (const depot of project.depots ?? []) {
    try {
      bilans.push({ nom: depot.nom, bilan: await archiverLaBrancheDeCarte(depot.path, branche, depot.branchesDePublication) });
    } catch (err) {
      log.warn(`archivage de la branche ${branche} dans le dépôt « ${depot.nom} » impossible`, err);
    }
  }
  return bilans;
}

/** Les copies annexes des cartes dont un agent travaille en ce moment : le ménage n'y touche pas. */
export function copiesAnnexesOccupees(cardIds: string[]): string[] {
  const dossiers: string[] = [];
  for (const cardId of cardIds) {
    const card = store.getCard(cardId);
    const project = card ? store.getProject(card.projectId) : null;
    if (!card || !project) continue;
    dossiers.push(...copiesAnnexesPrevues(project, card).map((c) => c.dossier));
  }
  return dossiers;
}
