/**
 * OUVRIR ET REFERMER LE DOSSIER DE TRAVAIL D'UNE CARTE.
 *
 * Les règles pures (où va le dossier, lequel est orphelin) vivent dans
 * `shared/src/dossier-de-carte.ts`. Ici, on parle à git :
 *
 *   - à l'ouverture, `git worktree add` donne à la carte une copie de travail à
 *     elle seule, posée sur SA branche « tache/… », partie de la branche de
 *     DÉPLOIEMENT du projet (`server/src/branche-de-deploiement.ts`) — c'est-à-
 *     dire de ce qui tourne réellement sur le serveur ; plusieurs cartes du même
 *     projet peuvent donc démarrer en même temps ;
 *   - à la fermeture, le travail qui traînait est enregistré SUR LA BRANCHE DE
 *     LA CARTE et la copie de travail est retirée. **Plus aucune fusion ici** :
 *     un dossier laissé ouvert empêcherait la carte de repartir, mais la branche,
 *     elle, garde son travail jusqu'au clic « Tout déployer ».
 *
 * POURQUOI LA FUSION A QUITTÉ LA FIN DE TOUR. La branche rejoignait la branche
 * principale à la seconde où l'agent rendait sa réponse. Sur un projet servi
 * depuis son dossier — tous ceux que Beluga Build monte sur le serveur —, cela
 * revenait à mettre en ligne sans que personne n'ait cliqué. Désormais la
 * fusion appartient à la publication, et à elle seule (`server/src/deploy.ts`,
 * étape « merge ») : chaque tâche modifie sa propre branche, le clic « Tout
 * déployer » les fusionne toutes sur la branche de déploiement.
 *
 * Rien n'est poussé sur la branche principale, rien n'est mis en ligne : la
 * publication reste un geste de l'utilisateur.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BranchesDePublication,
  Card,
  CopieMorte,
  GesteDeReparation,
  PanneDeDossier,
  PREFIXE_BRANCHE_ARCHIVEE,
  REPARATIONS_MAX,
  brancheReglee,
  cheminNettoyable,
  copiesMortes,
  decisionDArchivage,
  dossiersOrphelins,
  estDossierDeCarte,
  nomDeBranche,
  objetsCitesDansLErreur,
  trierLeNettoyage,
  DELAI_OUVERTURE_DE_COPIE_MS,
  raisonApresReparations,
  reconnaitrePanneDeDossier,
  type DecisionDArchivage,
} from '@beluga/shared';
import { log } from './logger.js';
import { bus } from './bus.js';
import { ajouterAuJournal, phaseDeLaCarte } from './journal-carte.js';
import { deposerLesFichiersIgnores, recollerLesDepotsIgnores } from './memoire-hors-depot.js';
import { CONFIG, ROOT } from './config.js';
import { brancheDeDeploiement } from './branche-de-deploiement.js';
import { dossierDeCarte, racinesDesCopiesDuProjet } from './copies-de-cartes.js';
import {
  brancheContenueDans,
  brancheCourante,
  branchePrincipale,
  copieQuiTientLaBranche,
  dossiersOuverts,
  existeLaBranche,
  git,
  type SortieGit,
} from './git.js';

/*
 * Le dialogue avec git — l'enveloppe `git()`, la branche principale, la
 * branche courante, la liste des copies — vit dans `server/src/git.ts`. Ce
 * module en avait sa propre copie, comme quatre autres : les noms qu'on
 * importait d'ici restent servis, mais il n'y a plus qu'une réponse.
 */
export { branchePrincipale, brancheCourante, dossiersOuverts } from './git.js';

const execFileAsync = promisify(execFile);

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

/**
 * UNE COPIE POSÉE HORS DU DÉPÔT NE REMONTE PLUS À SES DÉPENDANCES. Sur le
 * disque local (projet servi par le réseau, `server/src/copies-de-cartes.ts`),
 * la recherche des paquets ne trouve plus le `node_modules` du dossier
 * principal en remontant. On le recrée dans la copie — à la racine et dans
 * chaque sous-dossier de premier niveau qui en a un — en VRAI dossier dont
 * chaque entrée est un lien vers celle du principal : un lien sur le dossier
 * entier ferait écrire la liaison des paquets d'atelier (plus bas) DANS le
 * dépôt principal. Un `node_modules` déjà présent dans la copie (suivi par git)
 * ne se touche pas.
 */
function relierLesDependancesHorsDuDepot(racine: string, dossier: string): void {
  const relatif = path.relative(racine, dossier);
  if (!relatif.startsWith('..') && !path.isAbsolute(relatif)) return;
  const niveaux = [''];
  try {
    for (const entree of fs.readdirSync(racine, { withFileTypes: true })) {
      if (entree.isDirectory() && !entree.name.startsWith('.') && entree.name !== 'node_modules') niveaux.push(entree.name);
    }
  } catch {
    return;
  }
  for (const niveau of niveaux) {
    const source = path.join(racine, niveau, 'node_modules');
    const destination = path.join(dossier, niveau, 'node_modules');
    try {
      if (niveau && !fs.existsSync(path.join(dossier, niveau))) continue;
      if (!fs.statSync(source).isDirectory()) continue;
      try {
        fs.lstatSync(destination);
        continue;
      } catch {
        /* absent de la copie : on le relie */
      }
      fs.mkdirSync(destination, { recursive: true });
      for (const entree of fs.readdirSync(source)) {
        const cible = path.join(source, entree);
        if (entree.startsWith('@') && fs.statSync(cible).isDirectory()) {
          fs.mkdirSync(path.join(destination, entree), { recursive: true });
          for (const sous of fs.readdirSync(cible)) fs.symlinkSync(path.join(cible, sous), path.join(destination, entree, sous));
        } else {
          fs.symlinkSync(cible, path.join(destination, entree));
        }
      }
    } catch (err) {
      log.warn(`liaison des dépendances de ${source} impossible`, String(err).slice(0, 200));
    }
  }
}

function relierLesLourds(racine: string, dossier: string): void {
  relierLesDependancesHorsDuDepot(racine, dossier);
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
 * enregistrements que la branche de DÉPLOIEMENT n'a pas, ou sa copie de travail
 * contient des fichiers modifiés. Un dépôt qui ne répond pas rend `false` : on
 * ne fabrique pas une trace qu'on n'a pas vue.
 *
 * La comparaison se fait contre la branche de déploiement — celle d'où la carte
 * est PARTIE — et non contre la principale : depuis que la fusion attend le
 * clic, ces deux branches ne portent plus la même chose, et compter contre la
 * principale aurait pris le travail des cartes déjà déployées pour celui de la
 * carte qu'on reprend.
 */
export async function travailDejaSurLaBranche(
  racine: string,
  branche: string,
  dossier?: string,
  reglees?: BranchesDePublication,
): Promise<boolean> {
  const depart = await brancheDeDeploiement(racine, reglees);
  const existe = await git(racine, ['rev-parse', '--verify', '--quiet', branche], 20000);
  if (existe.ok && existe.out.trim()) {
    const compte = await git(racine, ['rev-list', '--count', `${depart}..${branche}`], 60000);
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
 * Une carte relancée retrouve SON dossier et SA branche : on ne repart jamais du
 * point de départ par-dessus un travail déjà enregistré.
 *
 * `reglees` porte les branches de publication du projet : c'est ce qui permet de
 * partir de la branche de DÉPLOIEMENT — l'image de ce qui tourne sur le serveur
 * — plutôt que de la principale. Absent, on retombe sur la règle par défaut
 * (« dev » si le dépôt en a une, sinon la principale).
 */
export async function ouvrirDossierDeCarte(
  racine: string,
  card: Card,
  reglees?: BranchesDePublication,
): Promise<DossierOuvert> {
  /*
   * OUVRIR PASSE PAR LA MÊME FILE QUE REFERMER. Sans cela, une carte pouvait
   * ouvrir son dossier pendant que le ménage du démarrage était en train de le
   * refermer : l'agent partait travailler dans une copie que
   * `refermerDossierDeCarte` retirait sous ses pieds quelques secondes plus
   * tard — et le travail déjà écrit disparaissait avec elle. Les deux gestes se
   * suivent donc, un par un, par projet.
   */
  return aLaQueue(racine, () => ouvrirVraiment(racine, card, reglees));
}

async function ouvrirVraiment(
  racine: string,
  card: Card,
  reglees?: BranchesDePublication,
): Promise<DossierOuvert> {
  const branche = nomDeBranche(card.title, card.id);
  /* Sur le disque local quand le projet est servi par le réseau
     (`server/src/copies-de-cartes.ts`) ; une copie déjà ouverte à l'ancien
     endroit reste la sienne. */
  const dossier = dossierDeCarte(racine, card.title, card.id);
  try {
    fs.mkdirSync(path.dirname(dossier), { recursive: true });
  } catch {
    /* git dira lui-même pourquoi il ne peut pas créer la copie */
  }

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
      deposerLesFichiersIgnores(racine, dossier);
      return { kind: 'pret', dossier, branche };
    }
    await enregistrerLeTravailEnCours(dossier);
    await retirerLeDossier(racine, dossier);
  }

  const existe = await git(racine, ['rev-parse', '--verify', '--quiet', branche], 20000);
  /*
   * LE POINT DE DÉPART EST LA BRANCHE DE DÉPLOIEMENT, pas la principale.
   * Depuis que la fusion attend le clic « Tout déployer », c'est la branche de
   * déploiement qui porte tout ce qui a réellement été mis en ligne : une carte
   * qui partirait de la principale repartirait d'un état plus ancien que
   * l'instance servie, et referait le travail des cartes déjà déployées.
   * Sans réglage ni branche « dev », c'est la principale — comme avant.
   */
  const depart = await brancheDeDeploiement(racine, reglees);

  /*
   * L'ÉTAT DE L'OUVERTURE, qui traverse les réparations. `depuis` et `neuve`
   * bougent : une branche qu'on croyait à créer peut se révéler déjà là
   * (« attacher-la-branche »), et un point de départ abîmé se remplace par
   * celui du dépôt distant (« repartir-du-distant »).
   */
  const etat = { depuis: depart, neuve: !(existe.ok && existe.out.trim()) };
  /* `--quiet` coupe le ruban « Updating files:  27% » à la source : il n'apporte
     rien dans un journal et il noyait la vraie phrase de git quand ça tombait.
     Les erreurs, elles, restent écrites. */
  const argsDuTour = () =>
    etat.neuve
      ? ['worktree', 'add', '--quiet', '-b', branche, dossier, etat.depuis]
      : ['worktree', 'add', '--quiet', dossier, branche];

  let ajout = await git(racine, argsDuTour(), DELAI_OUVERTURE_DE_COPIE_MS);

  /*
   * L'OUVERTURE SE RÉPARE ELLE-MÊME AVANT D'ABANDONNER. La carte s'arrêtait
   * jusqu'ici sur le message brut de git, et il fallait qu'un humain le
   * repère à l'écran puis demande la réparation à la main (constaté sur le
   * projet ProjetB). Chaque panne connue porte ses gestes
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
  direLesDroitsRendus(racine, card, gestesTentes);

  // La base ne se note QUE pour une branche qu'on vient de créer : plus tard,
  // la principale aura avancé et ne dirait plus d'où la carte est partie.
  const base = etat.neuve ? (await git(racine, ['rev-parse', branche], 20000)).out.trim() || undefined : undefined;

  relierLesLourds(racine, dossier);
  // Une mémoire gardée HORS du dépôt n'arrive pas par git : le fichier
  // d'instructions est déposé dans la copie, sans être enregistré.
  deposerLesFichiersIgnores(racine, dossier);
  return { kind: 'pret', dossier, branche, base };
}

/**
 * UNE RÉPARATION DE DROITS NE SE FAIT PAS EN SILENCE.
 *
 * Choix explicite de l'utilisateur : le système a le droit de se réparer seul,
 * à condition de l'ÉCRIRE dans la carte. Sans cela, la panne disparaîtrait de
 * la vue — et avec elle le signe qu'un projet a perdu sa propriété, qui mérite
 * d'être vu même quand la carte repart.
 *
 * La phrase posée dans le fil reste LISIBLE ; le détail technique (le chemin,
 * le compte, la commande) vit dans le journal du démon, pas ici. L'écriture ne
 * peut pas faire tomber le lancement : `ajouterAuJournal` avale tout et rend
 * `null`, et la carte ne change ni de colonne ni d'état.
 */
function direLesDroitsRendus(racine: string, card: Card, gestesTentes: string[]): void {
  if (!gestesTentes.includes('rendre-les-droits')) return;
  const entree = ajouterAuJournal({
    cardId: card.id,
    phase: phaseDeLaCarte(card.id, 'task'),
    nature: 'jalon',
    libelle: 'Droits du projet remis d’aplomb',
    resultat:
      `Les dossiers du projet (${path.basename(racine)}) n’appartenaient plus au compte qui fait tourner ` +
      'Beluga Build : la copie de travail de cette carte ne pouvait pas s’ouvrir. Les droits ont été rendus ' +
      'automatiquement avant de reprendre, et le lancement a suivi son cours normal.',
    reussie: true,
  });
  if (entree) bus.emit({ type: 'journal.entree', entree });
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

    case 'rendre-les-droits':
      return rendreLesDroits(racine);

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
/* ------------------------------------------------------------------ */
/* RENDRE AU SERVICE LA PROPRIÉTÉ DU DOSSIER DU PROJET                 */
/*                                                                     */
/* Constat du 22 septembre 2026 : 19 projets sur 24 ne pouvaient plus  */
/* lancer une carte. Leurs dossiers appartenaient à l'uid ORPHELIN     */
/* 539936 — aucun compte ne le portait —, reste de l'aller-retour des  */
/* dépôts vers la Storage Box, qui avait conservé les uid distants. Le */
/* service (`haiko`, membre du groupe `sudo`) ne pouvait plus y créer  */
/* `.worktrees/`, et chaque carte s'arrêtait sur « Permission denied ».*/
/* ------------------------------------------------------------------ */

/**
 * Les dossiers sur lesquels un `chown -R` ne se lance JAMAIS, quoi qu'en dise
 * la base. Un chemin vide ou mal lu deviendrait sinon une catastrophe : la
 * leçon « UN `chown -R` TROP LARGE COUPE LES ACCÈS SSH DE L'ADMINISTRATEUR »
 * vient précisément de là, et l'invariant projets dit que l'élévation vise
 * toujours le dossier CIBLE, jamais son parent.
 */
const JAMAIS_REPARABLE = new Set([
  '/',
  '/root',
  '/home',
  '/usr',
  '/etc',
  '/var',
  '/opt',
  '/srv',
  '/tmp',
  '/boot',
  '/mnt',
  '/media',
  '/bin',
  '/sbin',
  '/lib',
  '/dev',
  '/proc',
  '/sys',
]);

/**
 * Ce chemin peut-il recevoir une reprise de droits ? Quatre conditions, toutes
 * nécessaires : un chemin ABSOLU et normalisé, hors des dossiers de système,
 * d'au moins deux segments (jamais `/quelquechose` posé à la racine), et qui
 * porte un `.git` — c'est cette dernière qui fait le gros du travail : seul un
 * dépôt git se répare ici, et un chemin vide, relatif ou mal lu n'en a pas.
 *
 * Le dossier personnel du compte courant est écarté à part : il contient un
 * `.ssh` dont la propriété ne se touche pas, et un dépôt ne vit jamais là.
 */
export function cheminReparableEnDroits(racine: string): boolean {
  if (!racine || typeof racine !== 'string') return false;
  if (!path.isAbsolute(racine)) return false;
  const chemin = path.resolve(racine);
  if (JAMAIS_REPARABLE.has(chemin)) return false;
  if (chemin.split('/').filter(Boolean).length < 2) return false;
  try {
    if (memeDossier(chemin, os.homedir())) return false;
  } catch {
    /* pas de dossier personnel connu : rien à écarter */
  }
  return fs.existsSync(path.join(chemin, '.git'));
}

/**
 * Rend le dossier du projet au compte qui fait tourner le service, puis
 * rouvre le chemin des copies de travail. Le compte visé n'est JAMAIS écrit en
 * dur : c'est l'utilisateur EFFECTIF du processus (`os.userInfo()`), en
 * numérique — un nom de groupe peut manquer là où l'uid est toujours juste.
 *
 * Un démon lancé en `root` ne passe pas par là : root écrit partout, un
 * « Permission denied » sous root ne vient donc pas de la propriété des
 * fichiers (montage en lecture seule, attribut immuable) et un `chown -R 0:0`
 * ne ferait que déposséder un autre compte du projet.
 */
async function rendreLesDroits(racine: string): Promise<boolean> {
  if (!cheminReparableEnDroits(racine)) {
    log.warn(`droits du projet : réparation REFUSÉE sur « ${racine} » (chemin hors des dépôts réparables)`);
    return false;
  }
  const moi = os.userInfo();
  if (moi.uid === 0) {
    log.warn('droits du projet : le service tourne en root, un « Permission denied » ne vient pas de la propriété');
    return false;
  }
  const cible = path.resolve(racine);
  const proprietaire = `${moi.uid}:${moi.gid}`;
  try {
    /* `-n` : jamais de mot de passe demandé. Un sudo qui interrogerait ici
       resterait suspendu jusqu'au délai, en plein lancement de carte. */
    await execFileAsync('sudo', ['-n', 'chown', '-R', proprietaire, cible], { timeout: 10 * 60_000 });
  } catch (err: any) {
    log.warn(`droits du projet (${cible}) : chown impossible (${err?.message ?? err})`);
    return false;
  }
  try {
    fs.mkdirSync(path.join(cible, '.worktrees'), { recursive: true });
  } catch {
    /* le dossier des copies se recrée de toute façon à l'ouverture suivante */
  }
  log.info(`droits du projet (${cible}) : rendus à ${moi.username} (${proprietaire})`);
  return true;
}

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
  // Ce que git ignore ne part avec aucune branche : les règles déposées par la
  // carte rejoignent le dossier du projet AVANT que la copie disparaisse.
  if (fs.existsSync(dossier)) recollerLesDepotsIgnores(racine, dossier);
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
 * Fin de tour : le travail est mis à l'abri sur la branche de la carte, et la
 * copie de travail se referme. LA BRANCHE, ELLE, RESTE.
 *
 * Du travail non enregistré traînait-il dans la copie ? On l'ENREGISTRE d'office
 * sur la branche de la carte au lieu de laisser le dossier ouvert pour toujours
 * (`enregistrerLeTravailEnCours`) : c'est du travail réel, il doit pouvoir être
 * déployé comme le reste. Un seul refus subsiste, et il est DIT : l'enregistre-
 * ment d'office n'a pas pris (dépôt en plein conflit, droits) — on garde alors
 * le dossier plutôt que de perdre le travail.
 *
 * PLUS AUCUNE FUSION ICI. La branche rejoignait la principale à la seconde où
 * l'agent rendait sa réponse : sur un projet servi depuis son dossier, le
 * travail d'une tâche terminée passait donc en ligne sans que personne n'ait
 * cliqué. La fusion appartient maintenant à la publication seule
 * (`server/src/deploy.ts`, étape « merge »), qui la fait sur la branche de
 * DÉPLOIEMENT, une branche à la fois, avec son recollage de documents et son
 * dépannage. `fusionnee` reste dans le bilan pour ceux qui le lisent, et vaut
 * désormais toujours faux : rien n'est fusionné en fin de tour.
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
      const raison = "du travail non enregistré reste dans le dossier de la carte : il n'est ni enregistré ni refermé";
      log.warn(`fermeture du dossier ${dossier} : ${raison}`);
      return { fusionnee: false, retire: false, raison, enregistre };
    }

    const retire = await retirerLeDossier(racine, dossier);
    let raison =
      `branche « ${branche} » gardée telle quelle : son travail attend le clic « Tout déployer », ` +
      'qui la fusionnera sur la branche de déploiement';
    if (!retire) raison = `${raison} — dossier resté ouvert`;
    log.info(`dossier de carte refermé (${dossier}) : ${raison}`);
    return { fusionnee: false, retire, raison, enregistre };
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

/**
 * CE DOSSIER EST-IL UNE COPIE DE TRAVAIL, ET NON LE DÉPÔT PRINCIPAL ?
 *
 * Dans une copie ouverte par `git worktree`, `.git` est un FICHIER qui pointe
 * vers le dépôt ; dans le dépôt principal, c'est un dossier. Aucun appel à git
 * n'est nécessaire pour le savoir.
 */
/** Le démon lui-même a-t-il été lancé depuis une copie de travail (`<copie>/server/dist/main.js`) ? */
export function demonLanceDepuisUneCopie(): boolean {
  return estUneCopieDeTravail(ROOT);
}

/**
 * Cette racine est-elle le dépôt du démon lui-même — celui dont sa copie de
 * travail dépend ? C'est le seul dépôt qu'un démon d'essai ne doit jamais
 * ranger : y refermer les copies, c'est refermer la sienne. Un dépôt d'essai
 * posé ailleurs (les tests en montent dans un dossier temporaire) se range
 * normalement.
 */
function estLeDepotDuDemon(racine: string): boolean {
  /*
   * DEUX chemins à protéger, pas un. Depuis une copie de carte, `selfPath` est
   * la COPIE, tandis que le dépôt inscrit comme projet est le PRINCIPAL
   * (`adoptServerProjects` adopte tout `/root` sur une base neuve). Ne comparer
   * qu'à `selfPath` laissait donc passer le seul dépôt qu'il fallait épargner :
   * le ménage refermait les copies de toutes les cartes en cours, y compris
   * celle de l'agent qui venait de lancer le contrôle. C'est arrivé deux fois
   * de suite sur `scripts/verif-erreurs-interface.mjs`.
   */
  return [CONFIG.selfPath, CONFIG.depotDuDemon].some((connu) => memeDossier(racine, connu));
}

/** Deux chemins désignent-ils le même dossier ? Les liens résolus quand on peut. */
function memeDossier(a: string, b: string): boolean {
  try {
    return fs.realpathSync(path.resolve(a)) === fs.realpathSync(path.resolve(b));
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

export function estUneCopieDeTravail(racine: string): boolean {
  try {
    return fs.statSync(path.join(racine, '.git')).isFile();
  } catch {
    return false;
  }
}

/** Ce qu'un dossier de carte refermé au démarrage a laissé derrière lui. */
export interface DossierRattrape {
  dossier: string;
  branche: string;
  /** Du travail non enregistré a été sauvé sur la branche de la carte. */
  enregistre: boolean;
  /**
   * La branche a rejoint sa branche d'accueil. Depuis que la fusion attend le
   * clic « Tout déployer », vaut toujours faux : gardé pour ceux qui le lisent.
   */
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
  /*
   * UN DÉMON LANCÉ DEPUIS UNE COPIE DE TRAVAIL NE RANGE RIEN DU TOUT.
   *
   * `git worktree list` lancé DANS une copie répond pour le dépôt ENTIER : la
   * copie voit donc les dossiers de toutes les autres cartes. Un démon d'essai
   * démarré depuis `<copie>/server/dist/main.js` s'inscrit lui-même comme
   * projet (`ensureSelfProject`, chemin = la copie) et démarre sur une base
   * VIERGE, où aucun agent n'occupe rien : ce ménage refermait alors les
   * dossiers de TOUTES les cartes en cours — commit « tâche interrompue » et
   * `git worktree remove --force` compris —, sous les pieds des agents qui y
   * travaillaient. C'est arrivé.
   *
   * Le ménage n'appartient donc qu'au DÉPÔT PRINCIPAL, celui dont le `.git`
   * est un vrai dossier.
   */
  if (estUneCopieDeTravail(racine)) {
    log.warn(`ménage des dossiers ignoré : ${racine} est une copie de travail, pas le dépôt principal`);
    return [];
  }
  /*
   * …ET LA GARDE SE JUGE AUSSI SUR LE DÉMON LUI-MÊME, PAR PRÉCAUTION. Si un
   * jour le projet « Beluga Build » d'un démon d'essai portait le chemin du
   * dépôt principal (dont le `.git` est un vrai dossier), la garde ci-dessus
   * ne verrait plus rien : un démon lancé depuis une copie ne range donc
   * jamais le dépôt dont il dépend, quelle que soit la racine qu'on lui tend.
   * Un dépôt d'essai monté ailleurs par un test se range normalement.
   *
   * Cette garde n'est PAS ce qui a effacé une copie de travail en plein tour
   * le 06.09.2026 : c'était le nettoyage système du serveur
   * (`/usr/local/bin/root-storage-cleanup`, toutes les 30 minutes), dont le
   * test « un fichier récent ? » (`find … | grep -q .` sous `pipefail`)
   * tombe faux dès que la copie a beaucoup de fichiers — un `node_modules`
   * suffit — et qui la retire alors comme « abandonnée depuis sept jours ».
   */
  if (demonLanceDepuisUneCopie() && estLeDepotDuDemon(racine)) {
    log.warn(`ménage des dossiers ignoré : le démon tourne depuis une copie de travail (${ROOT})`);
    return [];
  }
  const ouverts = await dossiersOuverts(racine);
  const orphelins = dossiersOrphelins(racine, ouverts, occupes, racinesDesCopiesDuProjet(racine));
  const rattrapes: DossierRattrape[] = [];
  for (const dossier of orphelins) {
    // Seule une copie posée sur une branche de CARTE — vivante ou archivée — se
    // referme toute seule : un dossier ouvert à la main sur une autre branche ne
    // se fait pas retirer à la faveur d'un redémarrage.
    const branche = await brancheCourante(dossier);
    const estVivante = branche.startsWith('tache/');
    const estArchivee = branche.startsWith(PREFIXE_BRANCHE_ARCHIVEE);
    if (!estVivante && !estArchivee) continue;
    // Une carte vivante referme comme en fin de tour : travail en cours
    // enregistré d'office sur SA branche, copie retirée, aucune fusion. Une
    // carte ARCHIVÉE se contente elle aussi de rendre sa copie.
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

/* ------------------------------------------------------------------ */
/* L'archivage : la branche de la carte, et rien d'autre               */
/* ------------------------------------------------------------------ */

/** Ce que l'archivage a fait de la branche, pour l'écrire sur la carte et au journal. */
export interface BilanDArchivage {
  /** Le geste réellement fait — « laisser » couvre aussi un geste refusé, dit dans `detail`. */
  geste: DecisionDArchivage['geste'];
  /** Le nom que la carte doit désormais porter ; absent quand la branche n'existe plus. */
  branche?: string;
  detail: string;
}

/**
 * ARCHIVER LA BRANCHE D'UNE CARTE, selon `decisionDArchivage`
 * (`shared/src/archivage-de-branche.ts`) :
 *
 *  - une branche du projet (principale, « dev », « main », « master », celles
 *    des réglages) ou déjà « archive/… » : rien ne bouge, et on le dit ;
 *  - une branche de carte FUSIONNÉE dans la branche de déploiement : elle est
 *    SUPPRIMÉE, par `git branch -d` — jamais `-D` : git refuse lui-même de
 *    supprimer ce qui n'est pas fusionné, c'est le second filet. Si une copie
 *    de travail la tient encore, on referme d'abord cette copie (travail en
 *    cours enregistré d'office, comme en fin de tour) ; si elle ne se laisse
 *    pas refermer, ou si le dossier PRINCIPAL est posé dessus, on ne supprime
 *    pas et on le dit ;
 *  - une branche de carte NON fusionnée : renommée « archive/tache/… », une
 *    seule fois.
 *
 * Rend TOUJOURS un bilan, jamais une exception : l'archivage de la carte doit
 * aboutir même quand git refuse.
 */
export async function archiverLaBrancheDeCarte(
  racine: string,
  branche: string | undefined | null,
  reglees?: BranchesDePublication,
): Promise<BilanDArchivage> {
  const nom = (branche ?? '').trim();
  if (!nom) return { geste: 'laisser', detail: 'la carte ne porte aucune branche' };

  const deploiement = await brancheDeDeploiement(racine, reglees);
  const principale = await branchePrincipale(racine);
  const protegees = [principale, brancheReglee(reglees, 'dev'), brancheReglee(reglees, 'production')].filter(
    (b): b is string => !!b,
  );
  const existe = await existeLaBranche(racine, nom);
  const fusionnee = existe && (await brancheContenueDans(racine, nom, deploiement));
  const decision = decisionDArchivage({ branche: nom, brancheDeDeploiement: deploiement, fusionnee, protegees });

  if (decision.geste === 'laisser') return { geste: 'laisser', branche: nom, detail: decision.raison };
  if (!existe) {
    return { geste: 'laisser', branche: nom, detail: `« ${nom} » n’existe plus dans le dépôt : rien à archiver` };
  }

  return aLaQueue(racine, async () => {
    if (decision.geste === 'supprimer') {
      /*
       * Une copie encore posée sur la branche empêche `git branch -d`. Une
       * copie de CARTE se referme comme en fin de tour ; le dossier principal,
       * lui, ne se touche pas — on laisse la branche et on le dit.
       */
      const detentrice = await copieQuiTientLaBranche(racine, nom);
      if (detentrice && path.resolve(detentrice) === path.resolve(racine)) {
        return {
          geste: 'laisser',
          branche: nom,
          detail: `« ${nom} » est la branche courante du dossier principal : elle n’est pas supprimée`,
        };
      }
      if (detentrice && estDossierDeCarte(racine, detentrice, racinesDesCopiesDuProjet(racine))) {
        const bilan = await refermerSansFile(racine, detentrice);
        if (!bilan.retire) {
          return {
            geste: 'laisser',
            branche: nom,
            detail: `« ${nom} » est encore montée dans ${detentrice} (${bilan.raison}) : elle n’est pas supprimée`,
          };
        }
      } else if (detentrice) {
        return {
          geste: 'laisser',
          branche: nom,
          detail: `« ${nom} » est montée dans un dossier ouvert à la main (${detentrice}) : elle n’est pas supprimée`,
        };
      }
      const suppression = await supprimerLaBrancheFusionnee(racine, nom, deploiement);
      if (!suppression.ok) {
        log.warn(`archivage : suppression de « ${nom} » refusée par git : ${suppression.out.slice(-200)}`);
        return { geste: 'laisser', branche: nom, detail: `git a refusé de supprimer « ${nom} » : ${suppression.out.slice(-160)}` };
      }
      log.info(`archivage : ${decision.raison}`);
      return { geste: 'supprimer', detail: decision.raison };
    }

    const nouveau = decision.branche ?? nom;
    const renommage = await git(racine, ['branch', '-m', nom, nouveau], 30000);
    if (!renommage.ok) {
      log.warn(`archivage : renommage de « ${nom} » refusé par git : ${renommage.out.slice(-200)}`);
      return { geste: 'laisser', branche: nom, detail: `git a refusé de renommer « ${nom} » : ${renommage.out.slice(-160)}` };
    }
    log.info(`archivage : ${decision.raison}`);
    return { geste: 'renommer', branche: nouveau, detail: decision.raison };
  });
}

/**
 * SUPPRIMER UNE BRANCHE DÉJÀ FUSIONNÉE, SANS JAMAIS FORCER.
 *
 * `git branch -d` d'abord : c'est le geste sûr, git refuse lui-même ce qui
 * n'est pas fusionné. Mais il ne juge « fusionné » que contre la branche
 * COURANTE du dossier principal (ou l'amont de la branche) — pas contre la
 * branche de DÉPLOIEMENT. Un dépôt dont le dossier principal est posé sur
 * « main » refuse donc de supprimer une branche pourtant entièrement contenue
 * dans « dev ». Dans ce seul cas, et APRÈS avoir revérifié nous-mêmes que la
 * branche est un ancêtre de la branche de déploiement
 * (`git merge-base --is-ancestor`), on retire la référence par `update-ref -d`
 * en lui donnant le sommet attendu : si la branche a bougé entre-temps, git
 * refuse. Jamais `git branch -D` : ce serait supprimer sans regarder.
 */
async function supprimerLaBrancheFusionnee(racine: string, branche: string, deploiement: string): Promise<SortieGit> {
  const douce = await git(racine, ['branch', '-d', branche], 30000);
  if (douce.ok) return douce;
  if (!/not fully merged/i.test(douce.out)) return douce;
  if (!(await brancheContenueDans(racine, branche, deploiement))) return douce;
  const sommet = await git(racine, ['rev-parse', '--verify', '--quiet', `refs/heads/${branche}`], 20000);
  if (!sommet.ok || !sommet.out.trim()) return douce;
  return git(racine, ['update-ref', '-d', `refs/heads/${branche}`, sommet.out.trim()], 20000);
}

/** `refermerDossierDeCarte` sans la file — pour un appelant qui la tient déjà. */
async function refermerSansFile(racine: string, dossier: string): Promise<BilanFermeture> {
  if (!fs.existsSync(dossier)) return { fusionnee: false, retire: true, raison: 'dossier déjà refermé' };
  const enregistre = await enregistrerLeTravailEnCours(dossier);
  const sale = await git(dossier, ['status', '--porcelain'], 60000);
  if (sale.out.trim()) {
    return { fusionnee: false, retire: false, raison: 'du travail non enregistré reste dans la copie', enregistre };
  }
  const retire = await retirerLeDossier(racine, dossier);
  return { fusionnee: false, retire, raison: retire ? 'copie retirée' : 'copie restée ouverte', enregistre };
}

/* ------------------------------------------------------------------ */
/* Les copies mortes : vues, listées, effacées sur un geste seulement  */
/* ------------------------------------------------------------------ */

/** La taille d'un dossier sur le disque, approximative, par `du` — ou rien si `du` ne répond pas. */
async function tailleDuDossier(dossier: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', dossier], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const ko = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(ko) ? ko * 1024 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * La branche sur laquelle une copie MORTE était posée : git ne la connaît
 * plus, on relit donc le fichier `.git` de la copie (qui pointe vers son
 * ancienne inscription) puis le `HEAD` qui s'y trouve, s'ils existent encore.
 */
function brancheDUneCopieMorte(copie: string): string | undefined {
  try {
    const pointeur = fs.readFileSync(path.join(copie, '.git'), 'utf8').trim();
    const gitdir = pointeur.replace(/^gitdir:\s*/, '');
    const head = fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * LES COPIES DE TRAVAIL MORTES DE CE PROJET : les dossiers de `.worktrees/`
 * que `git worktree list` ne nomme plus (`copiesMortes`,
 * `shared/src/copies-mortes.ts`). `git worktree prune` ne les voit pas — il ne
 * range que ce que git a inscrit. Lecture seule : rien n'est effacé ici, et un
 * démon lancé depuis une copie ne regarde rien du tout, pour la même raison
 * que le ménage (`menageDesDossiers`).
 */
export async function copiesMortesDuProjet(racine: string): Promise<{ racine: string; copies: CopieMorte[] }> {
  /* Les deux rangements : l'actuel (disque local pour un projet distant) et
     l'historique `<projet>/.worktrees`, où des copies d'avant peuvent traîner. */
  const racines = racinesDesCopiesDuProjet(racine);
  const dossier = racines[0];
  if (estUneCopieDeTravail(racine)) return { racine: dossier, copies: [] };

  const presentes: CopieMorte[] = [];
  for (const copies of racines) {
    if (!fs.existsSync(copies)) continue;
    for (const entree of fs.readdirSync(copies, { withFileTypes: true })) {
      if (!entree.isDirectory()) continue;
      presentes.push({ chemin: path.join(copies, entree.name), nom: entree.name });
    }
  }
  if (!presentes.length) return { racine: dossier, copies: [] };
  const mortes = copiesMortes(presentes, await dossiersOuverts(racine));
  for (const copie of mortes) {
    try {
      copie.modifieA = fs.statSync(copie.chemin).mtimeMs;
    } catch {
      /* dossier disparu entre-temps : il n'a plus de date */
    }
    copie.tailleOctets = await tailleDuDossier(copie.chemin);
    copie.branche = brancheDUneCopieMorte(copie.chemin);
  }
  mortes.sort((a, b) => (b.tailleOctets ?? 0) - (a.tailleOctets ?? 0));
  return { racine: dossier, copies: mortes };
}

/**
 * EFFACER DES COPIES MORTES, sur une liste EXPLICITE de chemins — jamais tout
 * seul. Chaque chemin passe par `trierLeNettoyage` : posé directement sous le
 * dossier des copies du projet, sinon refusé ; encore inscrit dans git, refusé
 * aussi. Ce qui passe est effacé du disque, puis `git worktree prune` range ce
 * que git gardait encore de ces copies (inscriptions dont le dossier a disparu).
 */
export async function nettoyerLesCopies(
  racine: string,
  chemins: readonly string[],
): Promise<{ effacees: string[]; refusees: { chemin: string; raison: string }[] }> {
  if (estUneCopieDeTravail(racine) || (demonLanceDepuisUneCopie() && estLeDepotDuDemon(racine))) {
    return {
      effacees: [],
      refusees: chemins.map((chemin) => ({ chemin, raison: 'le projet est lui-même une copie de travail : rien n’est nettoyé' })),
    };
  }
  /* Chaque chemin se juge contre le rangement qui le porte : le local ou l'historique. */
  const racines = racinesDesCopiesDuProjet(racine);
  const ouvertes = await dossiersOuverts(racine);
  const tri: ReturnType<typeof trierLeNettoyage> = { aEffacer: [], refusees: [] };
  for (const copies of racines) {
    const siens = chemins.filter(
      (chemin) => cheminNettoyable(chemin, copies) || (copies === racines[0] && !racines.some((r) => cheminNettoyable(chemin, r))),
    );
    const partiel = trierLeNettoyage(siens, copies, ouvertes);
    tri.aEffacer.push(...partiel.aEffacer);
    tri.refusees.push(...partiel.refusees);
  }
  const effacees: string[] = [];
  for (const chemin of tri.aEffacer) {
    try {
      fs.rmSync(chemin, { recursive: true, force: true });
      effacees.push(chemin);
      log.info(`copie de travail morte effacée : ${chemin}`);
    } catch (err) {
      tri.refusees.push({ chemin, raison: `effacement impossible : ${String(err).slice(0, 160)}` });
    }
  }
  await git(racine, ['worktree', 'prune'], 60000);
  return { effacees, refusees: tri.refusees };
}
