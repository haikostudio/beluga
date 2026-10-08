import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FICHIER_DES_APPLIQUEES,
  REGISTRE_DE_PRODUCTION,
  SCRIPT_DE_RAFRAICHISSEMENT,
  entreesEnAttente,
  raisonCopieBloquee,
  type EtatDeLaCopieDeTest,
} from '@beluga/shared';
import * as store from './store.js';
import { sortieGit } from './git.js';
import { brancheDeLEtape } from './deploy.js';
import { lancerCommandeBornee } from './commande-bornee.js';
import { log } from './logger.js';

/**
 * LE BOUTON « RAFRAÎCHIR LA COPIE DE TEST » du tiroir de mise en production —
 * la convention est dite dans `shared/src/copie-de-test.ts`.
 *
 * Tout se LIT dans le dépôt du projet, par git, sans toucher au dossier de
 * travail (souvent partagé, parfois sur une autre branche) : le script et le
 * registre viennent de la branche de travail, les entrées en attente aussi des
 * branches de cartes pas encore versées, et le reflet des entrées en ligne du
 * dossier git commun.
 */

/** Un rafraîchissement dure : copie des fichiers et de la base du vrai site. */
const DELAI_RAFRAICHISSEMENT_MS = 45 * 60 * 1000;

const enCours = new Set<string>();
const dernieres = new Map<string, NonNullable<EtatDeLaCopieDeTest['derniere']>>();

async function lignes(cwd: string, args: string[]): Promise<string[]> {
  return ((await sortieGit(cwd, args)) ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

export async function etatDeLaCopieDeTest(projectId: string): Promise<EtatDeLaCopieDeTest> {
  const projet = store.getProject(projectId);
  const base: EtatDeLaCopieDeTest = { disponible: false, enAttente: [], enCours: enCours.has(projectId), derniere: dernieres.get(projectId) };
  if (!projet?.path || !fs.existsSync(projet.path)) return base;
  const dev = (await brancheDeLEtape(projet, 'dev')).branche;
  const script = await sortieGit(projet.path, ['cat-file', '-t', `${dev}:${SCRIPT_DE_RAFRAICHISSEMENT}`]);
  if (script?.trim() !== 'blob') return base;
  const refs = await lignes(projet.path, [
    'for-each-ref',
    '--format=%(refname)',
    `refs/heads/${dev}`,
    `refs/remotes/origin/${dev}`,
    'refs/heads/tache',
    'refs/remotes/origin/tache',
  ]);
  const chemins = await Promise.all(refs.map((ref) => lignes(projet.path, ['ls-tree', '--name-only', ref, `${REGISTRE_DE_PRODUCTION}/`])));
  const commun = (await sortieGit(projet.path, ['rev-parse', '--git-common-dir']))?.trim() ?? '.git';
  const reflet = path.resolve(projet.path, commun, FICHIER_DES_APPLIQUEES);
  const appliquees = fs.existsSync(reflet) ? fs.readFileSync(reflet, 'utf8').split('\n') : [];
  return { ...base, disponible: true, enAttente: entreesEnAttente(chemins, appliquees) };
}

/**
 * LANCE LE RAFRAÎCHISSEMENT, en fond : la commande rend la main tout de suite,
 * l'écran suit par `etatDeLaCopieDeTest`. Le script est pris sur la branche de
 * travail et joué hors du dossier du projet ; il refuse lui-même encore une
 * fois s'il trouve une entrée en attente.
 */
export async function rafraichirLaCopieDeTest(projectId: string): Promise<EtatDeLaCopieDeTest> {
  const etat = await etatDeLaCopieDeTest(projectId);
  const raison = raisonCopieBloquee(etat);
  if (raison === 'indisponible') throw new Error('Ce projet n’a pas de copie de test à rafraîchir.');
  if (raison === 'en-cours') throw new Error('Un rafraîchissement est déjà en cours.');
  if (raison === 'en-attente') {
    throw new Error(`Des changements attendent leur mise en production (${etat.enAttente.join(', ')}) : la copie de test les perdrait.`);
  }
  const projet = store.getProject(projectId)!;
  const dev = (await brancheDeLEtape(projet, 'dev')).branche;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-copie-de-test-'));
  enCours.add(projectId);
  void (async () => {
    try {
      const issue = await lancerCommandeBornee(
        projet.path,
        `git archive ${JSON.stringify(dev)} production | tar -x -C ${JSON.stringify(dossier)} && bash ${JSON.stringify(path.join(dossier, SCRIPT_DE_RAFRAICHISSEMENT))}`,
        { timeout: DELAI_RAFRAICHISSEMENT_MS, signesGardes: 2500 },
      );
      dernieres.set(projectId, { ok: issue.ok, texte: issue.out.trim(), finiLe: Date.now() });
      log.info(`copie de test de « ${projet.name} » : rafraîchissement ${issue.ok ? 'réussi' : 'en échec'}`);
    } catch (err) {
      dernieres.set(projectId, { ok: false, texte: String((err as Error)?.message ?? err), finiLe: Date.now() });
    } finally {
      enCours.delete(projectId);
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  })();
  return { ...etat, enCours: true };
}
