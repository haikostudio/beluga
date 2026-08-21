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
import {
  Card,
  GesteDeReparation,
  PanneDeDossier,
  REPARATIONS_MAX,
  cheminDossierDeCarte,
  dossiersOrphelins,
  nomDeBranche,
  objetsCitesDansLErreur,
  raisonApresReparations,
  reconnaitrePanneDeDossier,
} from '@haikodev/shared';
import { log } from './logger.js';
import { fichiersEnConflitDuDossier, recollerLesDocumentsEnConflit } from './recollage-documentaire.js';

const execFileAsync = promisify(execFile);

/*
 * Git parle la langue de l'environnement. Or les pannes de dossier se
 * reconnaissent à leur MESSAGE (`shared/src/reparation-worktree.ts`) : sous un
 * serveur réglé en français, « une branche nommée … existe déjà » ne
 * ressemblerait à aucun de nos motifs et la réparation ne partirait jamais. On
 * force donc la langue neutre pour tout ce que le démon demande à git.
 */
const LANGUE_NEUTRE = { LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' };

async function git(cwd: string, args: string[], timeout = 180000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...LANGUE_NEUTRE },
    });
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

/**
 * CETTE CARTE A-T-ELLE DÉJÀ DU CODE SUR SA BRANCHE ?
 *
 * La question se pose au moment de REPRENDRE une carte : son tour précédent a
 * pu enregistrer du travail sans jamais pouvoir ranger la carte (coupure), donc
 * sans poser le drapeau `codeDejaEnregistre`. La reprise se serait alors
 * entendu dire « aucun fichier n'a changé » à la fin d'un tour qui n'avait plus
 * rien à changer.
 *
 * Deux constats, l'un ou l'autre suffisant : la branche porte des
 * enregistrements que la principale n'a pas, ou sa copie de travail contient
 * des fichiers modifiés. Un dépôt qui ne répond pas rend `false` : on ne
 * fabrique pas une trace qu'on n'a pas vue.
 */
export async function travailDejaSurLaBranche(
  racine: string,
  branche: string,
  dossier?: string,
): Promise<boolean> {
  const principale = await branchePrincipale(racine);
  const existe = await git(racine, ['rev-parse', '--verify', '--quiet', branche], 20000);
  if (existe.ok && existe.out.trim()) {
    const compte = await git(racine, ['rev-list', '--count', `${principale}..${branche}`], 60000);
    if (compte.ok && Number(compte.out.trim()) > 0) return true;
  }
  if (dossier && fs.existsSync(dossier)) {
    const sale = await git(dossier, ['status', '--porcelain'], 60000);
    if (sale.ok && sale.out.trim()) return true;
  }
  return false;
}

export type DossierOuvert =
  | {
      kind: 'pret';
      dossier: string;
      branche: string;
      /**
       * LE POINT DE DÉPART DE LA BRANCHE, quand ce tour vient de la CRÉER.
       * Retenu sur la carte (`github.baseSha`), il dit pour toujours ce qui
       * appartient à cette carte et ce qui appartient au dépôt — même après la
       * fusion, où l'ancêtre commun ne sait plus le dire. Absent sur une carte
       * relancée : sa base est déjà connue, on ne l'écrase pas.
       */
      base?: string;
    }
  | { kind: 'echec'; raison: string };

/**
 * Le dossier de travail d'une carte, prêt sur sa branche.
 *
 * Une carte relancée retrouve SON dossier et SA branche : on ne repart jamais de
 * la principale par-dessus un travail déjà enregistré.
 */
export async function ouvrirDossierDeCarte(racine: string, card: Card): Promise<DossierOuvert> {
  /*
   * OUVRIR PASSE PAR LA MÊME FILE QUE REFERMER. Sans cela, une carte pouvait
   * ouvrir son dossier pendant que le ménage du démarrage était en train de le
   * refermer : l'agent partait travailler dans une copie que
   * `refermerDossierDeCarte` retirait sous ses pieds quelques secondes plus
   * tard — et le travail déjà écrit disparaissait avec elle. Les deux gestes se
   * suivent donc, un par un, par projet.
   */
  return aLaQueue(racine, () => ouvrirVraiment(racine, card));
}

async function ouvrirVraiment(racine: string, card: Card): Promise<DossierOuvert> {
  const branche = nomDeBranche(card.title, card.id);
  const dossier = cheminDossierDeCarte(racine, card.title, card.id);

  ecarterLeRangement(racine);
  await git(racine, ['worktree', 'prune'], 60000);

  /*
   * Le dossier est déjà là : on le garde s'il est bien sur la branche de la
   * carte (relance), on le retire sinon — un reste de tour précédent ne doit
   * pas faire échouer le départ.
   *
   * Un dossier qui ne dit plus SUR QUOI il est posé n'est pas forcément un
   * reste : ses fichiers de service ont pu être coupés du dépôt (rangement de
   * copies, dossier déplacé). On tente donc de le RECOLLER
   * (`git worktree repair`) avant d'envisager de le retirer, et ce qui traîne
   * dedans est enregistré d'office : on ne détruit jamais du travail pour
   * réparer.
   */
  if (fs.existsSync(dossier)) {
    let posee = await brancheCourante(dossier);
    if (posee !== branche) {
      await git(racine, ['worktree', 'repair', dossier], 60000);
      posee = await brancheCourante(dossier);
    }
    if (posee === branche) {
      relierLesLourds(racine, dossier);
      return { kind: 'pret', dossier, branche };
    }
    await enregistrerLeTravailEnCours(dossier);
    await retirerLeDossier(racine, dossier);
  }

  const existe = await git(racine, ['rev-parse', '--verify', '--quiet', branche], 20000);
  const principale = await branchePrincipale(racine);

  /*
   * L'ÉTAT DE L'OUVERTURE, qui traverse les réparations. `depuis` et `neuve`
   * bougent : une branche qu'on croyait à créer peut se révéler déjà là
   * (« attacher-la-branche »), et un point de départ abîmé se remplace par
   * celui du dépôt distant (« repartir-du-distant »).
   */
  const etat = { depuis: principale, neuve: !(existe.ok && existe.out.trim()) };
  const argsDuTour = () =>
    etat.neuve
      ? ['worktree', 'add', '-b', branche, dossier, etat.depuis]
      : ['worktree', 'add', dossier, branche];

  let ajout = await git(racine, argsDuTour());

  /*
   * L'OUVERTURE SE RÉPARE ELLE-MÊME AVANT D'ABANDONNER. La carte s'arrêtait
   * jusqu'ici sur le message brut de git, et il fallait qu'un humain le
   * repère à l'écran puis demande la réparation à la main (constaté sur le
   * projet Rezideo). Chaque panne connue porte ses gestes
   * (`reconnaitrePanneDeDossier`) : on les applique, on retente, et on
   * s'arrête dès que plus rien n'est reconnu ou que plus aucun geste ne prend.
   */
  const gestesTentes: string[] = [];
  let derniere: PanneDeDossier | null = null;
  for (let essai = 0; !ajout.ok && essai < REPARATIONS_MAX; essai++) {
    const panne = reconnaitrePanneDeDossier(ajout.out);
    if (!panne) break;
    derniere = panne;
    const faits: string[] = [];
    for (const geste of panne.gestes) {
      if (await appliquerLeGeste(geste, { racine, dossier, branche, erreur: ajout.out, etat })) {
        faits.push(geste);
      }
    }
    if (!faits.length) break;
    gestesTentes.push(...faits);
    log.warn(
      `dossier de carte (${dossier}) : panne « ${panne.panne} » reconnue, réparation tentée (${faits.join(', ')})`,
    );
    ajout = await git(racine, argsDuTour());
  }

  if (!ajout.ok) {
    return { kind: 'echec', raison: raisonApresReparations(ajout.out, derniere, gestesTentes) };
  }
  if (gestesTentes.length) {
    log.info(`dossier de carte ouvert après réparation (${dossier}) : ${gestesTentes.join(', ')}`);
  }

  // La base ne se note QUE pour une branche qu'on vient de créer : plus tard,
  // la principale aura avancé et ne dirait plus d'où la carte est partie.
  const base = etat.neuve ? (await git(racine, ['rev-parse', branche], 20000)).out.trim() || undefined : undefined;

  relierLesLourds(racine, dossier);
  return { kind: 'pret', dossier, branche, base };
}

/** Ce dont un geste de réparation a besoin pour agir sur ce dépôt-là. */
interface ContexteDeReparation {
  racine: string;
  dossier: string;
  branche: string;
  /** Le message d'erreur de git : il NOMME souvent le fichier à réparer. */
  erreur: string;
  etat: { depuis: string; neuve: boolean };
}

/**
 * Un verrou (`index.lock`) laissé par un git tué net bloque tout le dépôt. Mais
 * un verrou FRAIS appartient peut-être à un git qui travaille en ce moment —
 * une publication, un autre agent : on ne retire que ce qui dort depuis une
 * minute.
 */
const VERROU_PERIME_MS = 60000;

async function appliquerLeGeste(geste: GesteDeReparation, ctx: ContexteDeReparation): Promise<boolean> {
  const { racine, dossier, branche, erreur, etat } = ctx;
  switch (geste) {
    case 'ranger-les-copies':
      return (await git(racine, ['worktree', 'prune'], 60000)).ok;

    case 'reparer-les-copies':
      return (await git(racine, ['worktree', 'repair'], 60000)).ok;

    case 'deverrouiller-la-copie': {
      const leve = await git(racine, ['worktree', 'unlock', dossier], 30000);
      await git(racine, ['worktree', 'prune'], 60000);
      return leve.ok;
    }

    case 'retirer-le-dossier': {
      if (!fs.existsSync(dossier)) return false;
      // Rien ne se perd : ce qui traîne part sur la branche avant le retrait.
      await enregistrerLeTravailEnCours(dossier);
      return retirerLeDossier(racine, dossier);
    }

    case 'liberer-la-branche':
      return libererLaBranche(racine, branche, etat.depuis);

    case 'retirer-le-verrou':
      return retirerLesVerrous(racine, erreur);

    case 'recuperer-les-objets':
      return recupererLesObjets(racine, erreur);

    case 'attacher-la-branche': {
      // La branche existe : on la REPREND. Jamais on ne l'efface — c'est
      // peut-être tout le travail d'un tour précédent de cette carte.
      if (!etat.neuve) return false;
      etat.neuve = false;
      return true;
    }

    case 'repartir-du-distant': {
      if (!etat.neuve) return false;
      const distant = `origin/${etat.depuis.replace(/^origin\//, '')}`;
      if (etat.depuis === distant) return false;
      const existe = await git(racine, ['rev-parse', '--verify', '--quiet', distant], 20000);
      if (!(existe.ok && existe.out.trim())) return false;
      etat.depuis = distant;
      return true;
    }

    default:
      return false;
  }
}

/**
 * Qui détient la branche de la carte ? `git worktree list` le dit. Deux cas :
 * une autre copie de carte la tient encore (on l'enregistre puis on la retire),
 * ou c'est le dossier PRINCIPAL — reste de l'ancien fonctionnement par
 * `git checkout -B` — qu'on rend à sa branche principale, à condition qu'il
 * soit propre : jamais au prix du travail de quelqu'un.
 */
async function libererLaBranche(racine: string, branche: string, principale: string): Promise<boolean> {
  const liste = await git(racine, ['worktree', 'list', '--porcelain'], 30000);
  if (!liste.ok) return false;

  let courant = '';
  let detenteur = '';
  for (const ligne of liste.out.split('\n')) {
    if (ligne.startsWith('worktree ')) courant = ligne.slice('worktree '.length).trim();
    if (ligne.trim() === `branch refs/heads/${branche}`) detenteur = courant;
  }
  if (!detenteur) return false;

  if (path.resolve(detenteur) === path.resolve(racine)) {
    const sale = await git(racine, ['status', '--porcelain'], 60000);
    if (sale.out.trim()) return false;
    return (await git(racine, ['checkout', principale], 60000)).ok;
  }

  await enregistrerLeTravailEnCours(detenteur);
  await git(racine, ['worktree', 'unlock', detenteur], 30000);
  return retirerLeDossier(racine, detenteur);
}

/**
 * Les fichiers de verrou oubliés : celui que git NOMME dans son erreur, et les
 * verrous connus du dépôt et de ses copies. Un verrou encore frais est laissé
 * en place — il appartient sans doute à un git qui travaille.
 */
async function retirerLesVerrous(racine: string, erreur: string): Promise<boolean> {
  const commun = await git(racine, ['rev-parse', '--git-common-dir'], 20000);
  const dossierGit = commun.ok && commun.out.trim() ? path.resolve(racine, commun.out.trim()) : path.join(racine, '.git');

  const candidats = new Set<string>();
  for (const m of (erreur ?? '').matchAll(/'([^']+\.lock)'/g)) candidats.add(path.resolve(racine, m[1]));
  for (const nom of ['index.lock', 'HEAD.lock', 'config.lock', 'packed-refs.lock']) {
    candidats.add(path.join(dossierGit, nom));
  }
  try {
    const copies = path.join(dossierGit, 'worktrees');
    if (fs.existsSync(copies)) {
      for (const entree of fs.readdirSync(copies)) candidats.add(path.join(copies, entree, 'index.lock'));
    }
  } catch {
    /* le dossier des copies n'est pas lisible : les verrous connus suffiront */
  }

  let retire = false;
  for (const chemin of candidats) {
    try {
      const etat = fs.statSync(chemin);
      if (Date.now() - etat.mtimeMs < VERROU_PERIME_MS) continue;
      fs.rmSync(chemin, { force: true });
      log.warn(`verrou git oublié retiré : ${chemin}`);
      retire = true;
    } catch {
      /* absent ou déjà retiré */
    }
  }
  return retire;
}

/**
 * Un objet VIDE (fichier de zéro octet dans `.git/objects`) fait tomber tout ce
 * qui lit le dépôt. Il se répare en l'effaçant puis en le redemandant au dépôt
 * distant : git le retéléchargera comme un objet manquant. On n'efface QUE des
 * fichiers vides, et QUE ceux que git a nommés dans son erreur — jamais un
 * objet qui porte quelque chose.
 */
async function recupererLesObjets(racine: string, erreur: string): Promise<boolean> {
  const commun = await git(racine, ['rev-parse', '--git-common-dir'], 20000);
  const dossierGit = commun.ok && commun.out.trim() ? path.resolve(racine, commun.out.trim()) : path.join(racine, '.git');

  let efface = false;
  for (const relatif of objetsCitesDansLErreur(erreur)) {
    const chemin = relatif.includes('.git/') ? path.resolve(racine, relatif) : path.join(dossierGit, relatif);
    try {
      if (fs.statSync(chemin).size !== 0) continue;
      fs.rmSync(chemin, { force: true });
      log.warn(`objet git vide retiré : ${chemin}`);
      efface = true;
    } catch {
      /* absent, ou pas lisible : le fetch tentera sa chance */
    }
  }

  const distants = await git(racine, ['remote'], 20000);
  if (distants.ok && distants.out.trim().split('\n').some((n) => n.trim() === 'origin')) {
    /*
     * `--refetch` redemande TOUT au lieu de négocier ce qui manque : c'est le
     * seul moyen de récupérer un objet que le dépôt croit déjà avoir, puisque
     * la négociation part des références et non du contenu des fichiers.
     * L'option date de git 2.41 ; sans elle, on retombe sur un fetch ordinaire.
     */
    const recup = await git(racine, ['fetch', '--refetch', '--prune', '--quiet', 'origin'], 300000);
    if (recup.ok) return true;
    const simple = await git(racine, ['fetch', '--prune', '--quiet', 'origin'], 300000);
    if (simple.ok) return true;
  }
  return efface;
}

async function retirerLeDossier(racine: string, dossier: string): Promise<boolean> {
  await git(racine, ['worktree', 'remove', dossier], 120000);
  if (fs.existsSync(dossier)) await git(racine, ['worktree', 'remove', '--force', dossier], 120000);
  /*
   * Une copie VERROUILLÉE — ou dont le dossier a disparu sans que git l'oublie —
   * ne cède qu'au double `--force`. Sans cette troisième tentative, elle gardait
   * la branche de la carte pour toujours et le lancement suivant échouait à
   * nouveau, réparation comprise.
   */
  await git(racine, ['worktree', 'remove', '--force', '--force', dossier], 120000);
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

/** Le préfixe que porte la branche d'une carte ARCHIVÉE (`server/src/archive.ts`). */
const PREFIXE_BRANCHE_ARCHIVEE = 'archive/tache/';

export interface BilanFermeture {
  fusionnee: boolean;
  retire: boolean;
  raison: string;
  /** Du travail non enregistré a été enregistré d'office avant de refermer. */
  enregistre?: boolean;
}

/**
 * Le message de l'enregistrement d'office. Il dit ce qu'il est — un filet, pas
 * un travail rendu — pour qui relira l'histoire de la branche.
 */
export const MESSAGE_TRAVAIL_SAUVE = 'Travaux en cours enregistrés (tâche interrompue)';

/**
 * ENREGISTRER D'OFFICE CE QUI TRAÎNE DANS LA COPIE DE TRAVAIL.
 *
 * Un tour coupé — serveur arrêté, moteur tombé, quota — laisse souvent des
 * fichiers modifiés que l'agent n'a pas eu le temps d'enregistrer. Ils restaient
 * là : la copie « sale » n'était ni fusionnée ni refermée, donc ce travail
 * n'entrait dans AUCUN déploiement et l'utilisateur s'entendait dire qu'aucun
 * fichier n'avait changé. On l'enregistre donc sur la branche DE LA CARTE, en un
 * seul enregistrement nommé : rien n'est perdu, rien n'est publié, et la reprise
 * repart d'un dossier propre.
 *
 * `git add -A` est ici légitime — et seulement ici : la copie appartient à cette
 * carte et à personne d'autre. Dans un dossier PARTAGÉ (chef, publication), la
 * règle du projet reste d'ajouter les fichiers un par un.
 *
 * Rend `true` s'il y avait quelque chose à sauver et que c'est fait.
 */
/**
 * CE QUI TRAÎNE ENCORE DANS LA COPIE, avant de l'enregistrer.
 *
 * `enregistrerLeTravailEnCours` ne rend qu'un oui/non : suffisant pour le
 * journal, muet pour l'utilisateur, à qui l'on veut dire CE QUI a été sauvé. On
 * relève donc la liste avant le geste — après, le dossier est propre et ne dit
 * plus rien. Rend une liste vide quand il n'y a rien, ou qu'on n'a pas pu lire.
 */
export async function fichiersNonEnregistres(dossier: string): Promise<string[]> {
  if (!fs.existsSync(dossier)) return [];
  const sale = await git(dossier, ['status', '--porcelain'], 60000);
  if (!sale.ok) return [];
  return sale.out
    .split('\n')
    .map((ligne) => ligne.slice(3).trim())
    // Un renommage s'écrit « ancien -> nouveau » : on garde le nom d'arrivée.
    .map((chemin) => chemin.split(' -> ').pop()?.trim() ?? '')
    .filter(Boolean);
}

export async function enregistrerLeTravailEnCours(dossier: string): Promise<boolean> {
  if (!fs.existsSync(dossier)) return false;
  const sale = await git(dossier, ['status', '--porcelain'], 60000);
  if (!sale.ok || !sale.out.trim()) return false;

  const ajout = await git(dossier, ['add', '-A'], 120000);
  if (!ajout.ok) {
    log.warn(`travail en cours impossible à préparer (${dossier}) : ${ajout.out.slice(-200)}`);
    return false;
  }
  const commit = await git(dossier, ['commit', '--no-verify', '-m', MESSAGE_TRAVAIL_SAUVE], 120000);
  if (!commit.ok) {
    log.warn(`travail en cours impossible à enregistrer (${dossier}) : ${commit.out.slice(-200)}`);
    return false;
  }
  log.info(`travail en cours enregistré d'office dans ${dossier}`);
  return true;
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
 * Du travail non enregistré traînait-il dans la copie ? On l'ENREGISTRE d'office
 * sur la branche de la carte au lieu de laisser le dossier ouvert pour toujours
 * (`enregistrerLeTravailEnCours`) : c'est du travail réel, il doit pouvoir être
 * déployé comme le reste. Restent deux refus, tous DITS : le dossier principal
 * n'est pas sur sa branche principale, la fusion entre en conflit — et ce
 * dernier cas ne revient à la publication QUE s'il porte sur autre chose que de
 * la documentation. Un heurt de pure documentation est recollé ICI, sans moteur
 * ni agent (`server/src/recollage-documentaire.ts`) : il n'atteint jamais la
 * fusion du lot, où il coûtait un agent et trois minutes.
 */
export async function refermerDossierDeCarte(
  racine: string,
  dossier: string,
  branche: string,
): Promise<BilanFermeture> {
  return aLaQueue(racine, async () => {
    if (!fs.existsSync(dossier)) return { fusionnee: false, retire: true, raison: 'dossier déjà refermé' };

    const enregistre = await enregistrerLeTravailEnCours(dossier);
    const sale = await git(dossier, ['status', '--porcelain'], 60000);
    if (sale.out.trim()) {
      // L'enregistrement d'office a échoué (dépôt en plein conflit, droits) :
      // on garde le dossier plutôt que de perdre le travail.
      const raison = "du travail non enregistré reste dans le dossier de la carte : il n'est ni fusionné ni refermé";
      log.warn(`fermeture du dossier ${dossier} : ${raison}`);
      return { fusionnee: false, retire: false, raison, enregistre };
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
        /*
         * UN HEURT DE DOCUMENTATION MEURT ICI, PAS À LA PUBLICATION.
         *
         * La fusion est laissée EN COURS le temps de l'essai : les fichiers
         * portent leurs marqueurs, on recolle ceux qui sont de la documentation
         * en liste et on referme. Réussi, la branche entre dans la principale à
         * la seconde où son tour se termine — la fusion du lot ne la verra même
         * pas. Refusé, on annule et tout se passe comme avant : c'est la
         * publication, avec son agent, qui tranchera.
         */
        const enConflit = await fichiersEnConflitDuDossier(racine);
        const recollage = await recollerLesDocumentsEnConflit(racine, enConflit);
        if (recollage.fusionnee) {
          fusionnee = true;
          raison = `branche « ${branche} » fusionnée dans « ${principale} » — ${recollage.recit}`;
        } else {
          await git(racine, ['merge', '--abort'], 60000);
          const reste = recollage.restants.length ? ` (${recollage.restants.join(', ')})` : '';
          raison = `la branche « ${branche} » entre en conflit avec « ${principale} »${reste} : la fusion revient à la publication`;
        }
      }
    }

    const retire = await retirerLeDossier(racine, dossier);
    if (!retire) raison = `${raison} — dossier resté ouvert`;
    log.info(`dossier de carte refermé (${dossier}) : ${raison}`);
    return { fusionnee, retire, raison, enregistre };
  });
}

/**
 * Fermeture d'une copie posée sur une branche « archive/tache/… ».
 *
 * `archiveCard` (`server/src/archive.ts`) renomme la branche de la carte au
 * moment de l'archivage — mais si une copie de travail était encore ouverte à
 * cet instant, elle continue de pointer sur cette nouvelle branche et
 * `menageDesDossiers` ne la reconnaissait plus : ni « tache/… », ni personne
 * dedans, elle restait ouverte pour toujours.
 *
 * Ici on ne fusionne JAMAIS : la carte est archivée, sa branche existe déjà
 * (fusionnée ou volontairement écartée), refusionner referait un travail qui
 * n'a plus de sens. On se contente de RETIRER la copie — et seulement si elle
 * ne porte plus de travail non enregistré, exactement comme pour une carte
 * vivante.
 */
export async function retirerDossierDeCarteArchivee(
  racine: string,
  dossier: string,
  branche: string,
): Promise<BilanFermeture> {
  return aLaQueue(racine, async () => {
    if (!fs.existsSync(dossier)) return { fusionnee: false, retire: true, raison: 'dossier déjà refermé' };

    const enregistre = await enregistrerLeTravailEnCours(dossier);
    const sale = await git(dossier, ['status', '--porcelain'], 60000);
    if (sale.out.trim()) {
      const raison =
        "du travail non enregistré reste dans le dossier d'une carte archivée : il n'est ni retiré ni perdu";
      log.warn(`fermeture du dossier ${dossier} : ${raison}`);
      return { fusionnee: false, retire: false, raison, enregistre };
    }

    const retire = await retirerLeDossier(racine, dossier);
    const raison = retire
      ? `carte archivée (branche « ${branche} ») : copie de travail retirée sans fusion`
      : `carte archivée (branche « ${branche} ») : copie de travail restée ouverte`;
    log.info(`dossier de carte refermé (${dossier}) : ${raison}`);
    return { fusionnee: false, retire, raison, enregistre };
  });
}

/** Ce qu'un dossier de carte refermé au démarrage a laissé derrière lui. */
export interface DossierRattrape {
  dossier: string;
  branche: string;
  /** Du travail non enregistré a été sauvé sur la branche de la carte. */
  enregistre: boolean;
  /** La branche a rejoint la principale. */
  fusionnee: boolean;
}

/**
 * Ménage au démarrage : un démon redémarré en plein travail laisse des copies
 * sans personne dedans. On ne touche qu'au rangement des cartes, et seulement aux
 * dossiers qu'aucun agent n'occupe.
 *
 * Rend le DÉTAIL de ce qui a été rattrapé, et pas seulement un compte :
 * l'appelant (`server/src/scheduler.ts`) retrouve la carte derrière chaque
 * branche et lui pose le drapeau du code déjà enregistré — sans quoi une carte
 * reprise s'entendrait dire « aucun fichier n'a changé » alors que son travail
 * est là.
 */
export async function menageDesDossiers(racine: string, occupes: string[]): Promise<DossierRattrape[]> {
  const ouverts = await dossiersOuverts(racine);
  const orphelins = dossiersOrphelins(racine, ouverts, occupes);
  const rattrapes: DossierRattrape[] = [];
  for (const dossier of orphelins) {
    // Seule une copie posée sur une branche de CARTE — vivante ou archivée — se
    // referme toute seule : un dossier ouvert à la main sur une autre branche ne
    // se fait pas fusionner dans la principale à la faveur d'un redémarrage.
    const branche = await brancheCourante(dossier);
    const estVivante = branche.startsWith('tache/');
    const estArchivee = branche.startsWith(PREFIXE_BRANCHE_ARCHIVEE);
    if (!estVivante && !estArchivee) continue;
    // Une carte vivante referme comme en fin de tour (travail en cours enregistré
    // d'office, puis fusion). Une carte ARCHIVÉE ne fusionne plus jamais : sa
    // branche a déjà rejoint la principale — ou volontairement pas — au moment de
    // l'archivage ; on se contente de retirer la copie.
    const bilan = estArchivee
      ? await retirerDossierDeCarteArchivee(racine, dossier, branche)
      : await refermerDossierDeCarte(racine, dossier, branche);
    rattrapes.push({
      dossier,
      branche,
      enregistre: !!bilan.enregistre,
      fusionnee: bilan.fusionnee,
    });
  }
  const fermes = rattrapes.length;
  if (fermes) log.info(`${fermes} dossier(s) de carte laissés ouverts ont été refermés (${racine})`);
  return rattrapes;
}
