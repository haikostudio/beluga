/**
 * OUVRIR ET REFERMER LE DOSSIER DE TRAVAIL D'UNE CARTE.
 *
 * Les règles pures (où va le dossier, lequel est orphelin) vivent dans
 * `shared/src/dossier-de-carte.ts`. Ici, on parle à git :
 *
 *   - à l'ouverture, `git worktree add` donne à la carte une copie de travail à
 *     elle seule, posée sur SA branche « tache/… » ; plusieurs cartes du même
 *     projet peuvent donc démarrer en même temps ;
 *   - à la fermeture, la branche est fusionnée dans la principale et le dossier
 *     retiré : une branche poussée n'est PAS livrée, et un dossier laissé ouvert
 *     empêcherait la carte de repartir.
 *
 * Rien n'est poussé sur la branche principale, rien n'est mis en ligne : la
 * publication reste un geste de l'utilisateur.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { Card, cheminDossierDeCarte, dossiersOrphelins, nomDeBranche } from '@haikodev/shared';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], timeout = 180000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (err: any) {
    return { ok: false, out: `${err?.stdout ?? ''}${err?.stderr ?? ''}${err?.message ?? ''}`.trim().slice(-1500) };
  }
}

/**
 * La branche principale du projet : celle que suit le dépôt distant, sinon celle
 * qui existe réellement. Deviner « main » sur un dépôt en « master » ferait
 * partir la carte du mauvais endroit et fusionner au mauvais endroit.
 */
export async function branchePrincipale(racine: string): Promise<string> {
  const distant = await git(racine, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], 30000);
  const nom = distant.ok ? distant.out.trim().replace(/^origin\//, '') : '';
  if (nom) return nom;
  for (const candidat of ['main', 'master']) {
    const existe = await git(racine, ['rev-parse', '--verify', '--quiet', candidat], 20000);
    if (existe.ok && existe.out.trim()) return candidat;
  }
  const courante = await brancheCourante(racine);
  return courante || 'main';
}

export async function brancheCourante(cwd: string): Promise<string> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 20000);
  return r.ok ? r.out.trim() : '';
}

/** Les copies de travail ouvertes dans ce dépôt (le dossier principal compris). */
export async function dossiersOuverts(racine: string): Promise<string[]> {
  const liste = await git(racine, ['worktree', 'list', '--porcelain'], 30000);
  if (!liste.ok) return [];
  return liste.out
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim())
    .filter(Boolean);
}

/**
 * Le rangement des cartes vit dans le dépôt : il ne doit pas apparaître comme un
 * fichier oublié dans `git status`. On l'écarte SANS toucher au `.gitignore` du
 * projet — c'est le fichier d'exclusion local du dépôt qui porte la ligne.
 */
function ecarterLeRangement(racine: string): void {
  try {
    const dossierGit = path.join(racine, '.git');
    if (!fs.existsSync(dossierGit)) return;
    const info = path.join(dossierGit, 'info');
    const fichier = path.join(info, 'exclude');
    const ligne = '/.worktrees/';
    const actuel = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8') : '';
    if (actuel.split('\n').some((l) => l.trim() === ligne)) return;
    fs.mkdirSync(info, { recursive: true });
    fs.writeFileSync(fichier, `${actuel}${actuel.endsWith('\n') || !actuel ? '' : '\n'}${ligne}\n`);
  } catch (err) {
    log.warn("exclusion du rangement des cartes impossible", String(err).slice(0, 200));
  }
}

/**
 * Ce qui ne vit pas dans le dépôt mais sans quoi rien ne se construit ni ne se
 * teste : les paquets de l'atelier, et les gros dossiers de données du principal.
 *
 * Deux cas, et le premier est un piège connu : un paquet d'atelier
 * (`node_modules/@…/…` qui pointe DANS le dépôt) doit pointer dans la copie de la
 * CARTE, sinon l'agent construit ses fichiers d'un côté et les relit de l'autre.
 * Le reste des dépendances n'a pas besoin d'être recopié : la recherche remonte
 * toute seule au dossier principal, puisque la copie vit dedans.
 */
const LOURDS_RELIES = ['data/models'];

function relierLesLourds(racine: string, dossier: string): void {
  try {
    const modules = path.join(racine, 'node_modules');
    if (fs.existsSync(modules)) {
      for (const entree of fs.readdirSync(modules)) {
        const chemin = path.join(modules, entree);
        const cibles = entree.startsWith('@')
          ? fs.readdirSync(chemin).map((sous) => path.join(entree, sous))
          : [entree];
        for (const relatif of cibles) {
          const lien = path.join(modules, relatif);
          let reel: string;
          try {
            if (!fs.lstatSync(lien).isSymbolicLink()) continue;
            reel = fs.realpathSync(lien);
          } catch {
            continue;
          }
          const dansLeDepot = path.relative(racine, reel);
          if (dansLeDepot.startsWith('..') || path.isAbsolute(dansLeDepot)) continue;
          const destination = path.join(dossier, 'node_modules', relatif);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.rmSync(destination, { recursive: true, force: true });
          fs.symlinkSync(path.join(dossier, dansLeDepot), destination);
        }
      }
    }
    for (const relatif of LOURDS_RELIES) {
      const source = path.join(racine, relatif);
      const destination = path.join(dossier, relatif);
      if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.symlinkSync(source, destination);
    }
  } catch (err) {
    log.warn('liaison des dossiers lourds impossible', String(err).slice(0, 200));
  }
}

export type DossierOuvert =
  | { kind: 'pret'; dossier: string; branche: string }
  | { kind: 'echec'; raison: string };

/**
 * Le dossier de travail d'une carte, prêt sur sa branche.
 *
 * Une carte relancée retrouve SON dossier et SA branche : on ne repart jamais de
 * la principale par-dessus un travail déjà enregistré.
 */
export async function ouvrirDossierDeCarte(racine: string, card: Card): Promise<DossierOuvert> {
  const branche = nomDeBranche(card.title, card.id);
  const dossier = cheminDossierDeCarte(racine, card.title, card.id);

  ecarterLeRangement(racine);
  await git(racine, ['worktree', 'prune'], 60000);

  // Le dossier est déjà là : on le garde s'il est bien sur la branche de la
  // carte (relance), on le retire sinon — un reste de tour précédent ne doit pas
  // faire échouer le départ.
  if (fs.existsSync(dossier)) {
    if ((await brancheCourante(dossier)) === branche) {
      relierLesLourds(racine, dossier);
      return { kind: 'pret', dossier, branche };
    }
    await retirerLeDossier(racine, dossier);
  }

  const existe = await git(racine, ['rev-parse', '--verify', '--quiet', branche], 20000);
  const depuis = await branchePrincipale(racine);
  const args = existe.ok && existe.out.trim()
    ? ['worktree', 'add', dossier, branche]
    : ['worktree', 'add', '-b', branche, dossier, depuis];

  let ajout = await git(racine, args);
  if (!ajout.ok && /already (checked out|used by worktree)/i.test(ajout.out)) {
    /*
     * Reste de l'ancien fonctionnement : la branche de la carte est encore
     * sortie dans le dossier PRINCIPAL (`git checkout -B` d'avant). On rend le
     * dossier principal à sa branche principale, à condition qu'il soit propre —
     * jamais au prix du travail de quelqu'un.
     */
    const sale = await git(racine, ['status', '--porcelain'], 60000);
    if (!sale.out.trim()) {
      await git(racine, ['checkout', depuis], 60000);
      ajout = await git(racine, args);
    }
  }
  if (!ajout.ok) {
    return {
      kind: 'echec',
      raison: `Dossier de travail impossible à ouvrir pour cette carte (git worktree) : ${ajout.out.slice(-300)}`,
    };
  }

  relierLesLourds(racine, dossier);
  return { kind: 'pret', dossier, branche };
}

async function retirerLeDossier(racine: string, dossier: string): Promise<boolean> {
  await git(racine, ['worktree', 'remove', dossier], 120000);
  if (fs.existsSync(dossier)) await git(racine, ['worktree', 'remove', '--force', dossier], 120000);
  if (fs.existsSync(dossier)) {
    try {
      fs.rmSync(dossier, { recursive: true, force: true });
    } catch (err) {
      log.warn('dossier de carte impossible à retirer', String(err).slice(0, 200));
    }
  }
  await git(racine, ['worktree', 'prune'], 60000);
  return !fs.existsSync(dossier);
}

export interface BilanFermeture {
  fusionnee: boolean;
  retire: boolean;
  raison: string;
}

/*
 * Deux cartes qui rendent en même temps fusionneraient dans le même dossier
 * principal : les fermetures d'un projet se suivent, une par une.
 */
const files = new Map<string, Promise<unknown>>();
function aLaQueue<T>(racine: string, travail: () => Promise<T>): Promise<T> {
  const precedent = files.get(racine) ?? Promise.resolve();
  const suivant = precedent.catch(() => undefined).then(travail);
  files.set(racine, suivant.catch(() => undefined));
  return suivant;
}

/**
 * Fin de tour : la branche rejoint la principale et le dossier se referme.
 *
 * Trois refus possibles, tous DITS : du travail non enregistré traîne dans la
 * copie (on garde le dossier plutôt que de perdre le travail), le dossier
 * principal n'est pas sur sa branche principale, la fusion entre en conflit — ce
 * dernier cas revient à la publication, qui sait le faire régler par un agent.
 */
export async function refermerDossierDeCarte(
  racine: string,
  dossier: string,
  branche: string,
): Promise<BilanFermeture> {
  return aLaQueue(racine, async () => {
    if (!fs.existsSync(dossier)) return { fusionnee: false, retire: true, raison: 'dossier déjà refermé' };

    const sale = await git(dossier, ['status', '--porcelain'], 60000);
    if (sale.out.trim()) {
      const raison = "du travail non enregistré reste dans le dossier de la carte : il n'est ni fusionné ni refermé";
      log.warn(`fermeture du dossier ${dossier} : ${raison}`);
      return { fusionnee: false, retire: false, raison };
    }

    const principale = await branchePrincipale(racine);
    const courante = await brancheCourante(racine);
    let fusionnee = false;
    let raison = '';
    if (courante !== principale) {
      raison = `le dossier principal est sur « ${courante || 'inconnue'} » et non sur « ${principale} » : la fusion attend la publication`;
    } else {
      const fusion = await git(racine, ['merge', '--no-ff', '--no-edit', branche], 180000);
      if (fusion.ok) {
        fusionnee = true;
        raison = `branche « ${branche} » fusionnée dans « ${principale} »`;
      } else {
        await git(racine, ['merge', '--abort'], 60000);
        raison = `la branche « ${branche} » entre en conflit avec « ${principale} » : la fusion revient à la publication`;
      }
    }

    const retire = await retirerLeDossier(racine, dossier);
    if (!retire) raison = `${raison} — dossier resté ouvert`;
    log.info(`dossier de carte refermé (${dossier}) : ${raison}`);
    return { fusionnee, retire, raison };
  });
}

/**
 * Ménage au démarrage : un démon redémarré en plein travail laisse des copies
 * sans personne dedans. On ne touche qu'au rangement des cartes, et seulement aux
 * dossiers qu'aucun agent n'occupe.
 */
export async function menageDesDossiers(racine: string, occupes: string[]): Promise<number> {
  const ouverts = await dossiersOuverts(racine);
  const orphelins = dossiersOrphelins(racine, ouverts, occupes);
  let fermes = 0;
  for (const dossier of orphelins) {
    // Seule une copie posée sur une branche de CARTE se referme toute seule :
    // un dossier ouvert à la main sur une autre branche ne se fait pas fusionner
    // dans la principale à la faveur d'un redémarrage.
    const branche = await brancheCourante(dossier);
    if (!branche.startsWith('tache/')) continue;
    // On referme comme en fin de tour : le travail enregistré par l'agent tué
    // rejoint la principale, et une copie sale est laissée telle quelle.
    const bilan = await refermerDossierDeCarte(racine, dossier, branche);
    if (bilan.retire) fermes += 1;
  }
  if (fermes) log.info(`${fermes} dossier(s) de carte laissés ouverts ont été refermés (${racine})`);
  return fermes;
}
