import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  DEPOT_PUBLIC,
  DISTANT_PUBLIC,
  NOM_DE_COPIE_PAR_DEFAUT,
  depotDeLAdresse,
  nomDeDepotValide,
  type EtatDesNouveautes,
} from '@beluga/shared';
import { bus } from './bus.js';
import { CONFIG, DEMON_D_ESSAI } from './config.js';
import { etatGitHub } from './installation-commandes.js';
import type { EtapeDeTravail, RecetteDeTravail } from './installation-travaux.js';
import { log } from './logger.js';
import { ensureSelfProject } from './projects.js';
import * as store from './store.js';
import { createCard } from './tools.js';

const execFileAsync = promisify(execFile);

/**
 * LA COPIE PERSONNELLE, ET LES NOUVEAUTÉS DU DÉPÔT PUBLIC.
 *
 * Beluga Build n'est pas un logiciel qu'on suit : c'est une base aboutie dont
 * chacun fait SON outil. Une installation neuve vient du dépôt public ; la page
 * « Votre propre Beluga » en fait un dépôt PRIVÉ de qui l'installe, et inscrit
 * le projet de l'application sur son tableau — c'est de là qu'il le modifie,
 * avec ses propres agents.
 *
 * DEUX DISTANTS, DEUX RÔLES, une fois la copie faite :
 *  - `origin` est le dépôt de la personne : ses modifications y sont sauvegardées ;
 *  - `amont` reste le dépôt public : les nouveautés en viennent, À LA DEMANDE.
 *
 * LES NOUVEAUTÉS NE S'APPLIQUENT JAMAIS SEULES. Le démon regarde une fois par
 * jour si le dépôt public a avancé et le DIT (bandeau, réglages). Récupérer est
 * un geste : sur une copie personnelle, il pose une carte dans le projet de
 * l'application — un agent rapproche les nouveautés des modifications locales,
 * et la mise en ligne reste celle de l'utilisateur ; sur une installation
 * jamais modifiée, il avance simplement le code et le reconstruit.
 *
 * UNE INSTALLATION QUI NE SUIT PAS LE DÉPÔT PUBLIC NE VOIT RIEN DE TOUT CELA :
 * sans distant `amont` et avec un `origin` qui n'est pas le dépôt public — le
 * cas d'un dépôt de travail privé —, il n'y a ni bandeau ni bouton.
 */

const DEPOT = () => CONFIG.selfPath;
const BRANCHE_PUBLIQUE = 'main';

async function git(args: string[], timeout = 30000): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', DEPOT(), ...args], { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function estUnDepot(): boolean {
  return fs.existsSync(path.join(DEPOT(), '.git'));
}

async function distants(): Promise<Record<string, string>> {
  if (!estUnDepot()) return {};
  const rendu: Record<string, string> = {};
  try {
    for (const ligne of (await git(['remote', '-v'])).split('\n')) {
      const [nom, adresse] = ligne.split(/\s+/);
      if (nom && adresse && !rendu[nom]) rendu[nom] = adresse;
    }
  } catch {
    /* pas de distant lisible : aucun */
  }
  return rendu;
}

function estLeDepotPublic(adresse: string | undefined): boolean {
  return !!adresse && depotDeLAdresse(adresse) === depotDeLAdresse(DEPOT_PUBLIC);
}

/** Le distant d'où viennent les nouveautés : `amont`, sinon `origin` s'il est le dépôt public. */
async function distantDesNouveautes(): Promise<string | null> {
  const connus = await distants();
  if (connus[DISTANT_PUBLIC]) return DISTANT_PUBLIC;
  return estLeDepotPublic(connus.origin) ? 'origin' : null;
}

function projetDeLApplication() {
  return store.listProjects(true).find((p) => p.isSelf && !p.archived) ?? null;
}

/** L'installation est-elle devenue une copie personnelle ? Un dépôt à soi ET le projet sur le tableau. */
async function estUneCopie(): Promise<boolean> {
  const connus = await distants();
  return Boolean(connus[DISTANT_PUBLIC] && connus.origin && projetDeLApplication());
}

/* ------------------------------------------------------------------ */
/* Le relevé des nouveautés                                             */
/* ------------------------------------------------------------------ */

let releve: EtatDesNouveautes = { suivi: false, disponibles: false, copie: false };
let releveEnCours: Promise<EtatDesNouveautes> | null = null;
/** En dessous de ce délai, un relevé non forcé rend ce qui est déjà connu. */
const FRAICHEUR_MS = 6 * 60 * 60 * 1000;
const PERIODE_MS = 24 * 60 * 60 * 1000;

async function reussit(args: string[]): Promise<boolean> {
  try {
    await git(args);
    return true;
  } catch {
    return false;
  }
}

async function relever(): Promise<EtatDesNouveautes> {
  const distant = await distantDesNouveautes();
  const copie = await estUneCopie();
  if (!distant) return { suivi: false, disponibles: false, copie };
  try {
    await git(['fetch', '--quiet', distant, BRANCHE_PUBLIQUE], 90000);
  } catch (err: any) {
    // Un dépôt qui ne répond pas ne fait pas disparaître ce qu'on savait.
    return { ...releve, suivi: true, copie, releveLe: Date.now(), erreur: 'Le dépôt public ne répond pas pour l’instant.' };
  }
  const sommet = await git(['rev-parse', `${distant}/${BRANCHE_PUBLIQUE}`]);
  /*
   * À JOUR, C'EST « TOUT CE QUE LE DÉPÔT PUBLIC PORTE EST DÉJÀ ICI ». Le cas
   * ordinaire se lit dans l'historique (le sommet public est un ancêtre). Mais
   * une installation posée depuis une archive, ou un dépôt public reparti d'un
   * enregistrement sans parent, n'ont AUCUN historique commun : on compare
   * alors les fichiers eux-mêmes, sinon le bandeau annoncerait pour toujours
   * des nouveautés qui n'en sont pas.
   */
  const aJour =
    (await reussit(['merge-base', '--is-ancestor', sommet, 'HEAD'])) || (await reussit(['diff', '--quiet', 'HEAD', sommet, '--']));
  let nombre: number | undefined;
  if (!aJour && (await reussit(['merge-base', 'HEAD', sommet]))) {
    nombre = Number(await git(['rev-list', '--count', `HEAD..${sommet}`])) || undefined;
  }
  return { suivi: true, disponibles: !aJour, nombre, sommet, copie, releveLe: Date.now() };
}

/** L'état des nouveautés ; `forcer` interroge le dépôt public tout de suite. */
export async function nouveautes(forcer = false): Promise<EtatDesNouveautes> {
  const frais = releve.releveLe && Date.now() - releve.releveLe < FRAICHEUR_MS;
  if (!forcer && frais) return releve;
  // Un démon d'essai n'interroge le réseau que si on le lui demande.
  if (!forcer && DEMON_D_ESSAI) return releve;
  releveEnCours ??= relever()
    .then((etat) => {
      const change = etat.disponibles !== releve.disponibles || etat.sommet !== releve.sommet || etat.suivi !== releve.suivi;
      releve = etat;
      if (change) bus.emit({ type: 'installation.nouveautes', etat });
      return etat;
    })
    .catch((err) => {
      log.warn('nouveautés : relevé impossible', err?.message ?? err);
      return releve;
    })
    .finally(() => {
      releveEnCours = null;
    });
  return releveEnCours;
}

/** Le relevé quotidien. Rend de quoi l'arrêter. */
export function surveillerLesNouveautes(): () => void {
  if (DEMON_D_ESSAI || !estUnDepot()) return () => undefined;
  const premier = setTimeout(() => void nouveautes(true), 3 * 60 * 1000);
  const periodique = setInterval(() => void nouveautes(true), PERIODE_MS);
  premier.unref?.();
  periodique.unref?.();
  return () => {
    clearTimeout(premier);
    clearInterval(periodique);
  };
}

/* ------------------------------------------------------------------ */
/* La copie personnelle                                                 */
/* ------------------------------------------------------------------ */

function etapeGit(...args: string[]): EtapeDeTravail {
  return { titre: `git ${args.join(' ')}`, programme: 'git', args: ['-C', DEPOT(), ...args], cwd: DEPOT() };
}

/**
 * LA RECETTE DE « VOTRE PROPRE BELUGA ». Rejouable : chaque geste regarde
 * d'abord s'il est déjà fait. Le nom du dépôt est le SEUL texte venu de
 * l'écran ; il est jugé (`nomDeDepotValide`) et voyage comme un argument, jamais
 * dans une ligne de shell.
 */
export async function recetteDeLaCopie(nomDemande: string | undefined): Promise<RecetteDeTravail | { erreur: string }> {
  const nom = (nomDemande ?? '').trim() || NOM_DE_COPIE_PAR_DEFAUT;
  if (!nomDeDepotValide(nom)) return { erreur: `« ${nom} » n'est pas un nom de dépôt possible (lettres, chiffres, tirets).` };
  const github = await etatGitHub();
  if (!github.connecte || !github.compte) {
    return { erreur: 'GitHub n’est pas encore relié : reliez-le à la page « GitHub et votre premier projet », puis revenez ici.' };
  }
  const compte = github.compte;
  const cible = `${compte}/${nom}`;

  return {
    etapes: [],
    apres: async ({ ecrire, lancer }) => {
      const exiger = async (etape: EtapeDeTravail) => {
        if ((await lancer(etape)) !== 0) throw new Error(`« ${etape.titre} » a échoué.`);
      };
      const identite = ['-c', `user.name=${compte}`, '-c', `user.email=${compte}@users.noreply.github.com`];

      // 1. Une installation posée depuis une archive n'a pas d'historique : elle en reçoit un.
      if (!estUnDepot()) {
        await exiger(etapeGit('init', '--quiet', '-b', 'main'));
        await exiger(etapeGit('add', '-A'));
        await exiger({
          titre: 'git commit — Beluga Build, tel qu’installé',
          programme: 'git',
          args: ['-C', DEPOT(), ...identite, 'commit', '--quiet', '-m', 'Beluga Build, tel qu’installé'],
          cwd: DEPOT(),
        });
      }
      // Les agents enregistreront leur travail ici : il leur faut un nom d'auteur.
      if (!(await reussit(['config', 'user.name']))) {
        await exiger(etapeGit('config', 'user.name', compte));
        await exiger(etapeGit('config', 'user.email', `${compte}@users.noreply.github.com`));
      }

      // 2. Le dépôt public passe sous le nom « amont » : les nouveautés en viendront.
      let connus = await distants();
      if (!connus[DISTANT_PUBLIC]) {
        if (estLeDepotPublic(connus.origin)) await exiger(etapeGit('remote', 'rename', 'origin', DISTANT_PUBLIC));
        else if (!connus.origin) await exiger(etapeGit('remote', 'add', DISTANT_PUBLIC, DEPOT_PUBLIC));
      }

      // 3. Le dépôt privé de la personne, créé s'il n'existe pas, puis la sauvegarde.
      connus = await distants();
      if (connus.origin) {
        ecrire(`Cette installation est déjà reliée à un dépôt à vous : ${connus.origin}\n`);
      } else {
        const existe =
          (await lancer({ titre: `gh repo view ${cible}`, programme: 'gh', args: ['repo', 'view', cible, '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], facultative: true })) === 0;
        if (existe) {
          ecrire(`Le dépôt ${cible} existe déjà : il est réutilisé.\n`);
          await exiger(etapeGit('remote', 'add', 'origin', `https://github.com/${cible}.git`));
        } else {
          ecrire(`Création du dépôt privé ${cible}.\n`);
          await exiger({
            titre: `gh repo create ${cible} --private`,
            programme: 'gh',
            args: ['repo', 'create', cible, '--private', '--source', DEPOT(), '--remote', 'origin', '--description', 'Ma copie de Beluga Build'],
            cwd: DEPOT(),
          });
        }
        await exiger(etapeGit('push', '--set-upstream', 'origin', 'HEAD'));
      }

      // 4. Le projet de l'application arrive sur le tableau : c'est de là qu'on le personnalise.
      const projet = await ensureSelfProject({ forcer: true });
      store.ensureLocalGroup();
      if (projet) {
        bus.emit({ type: 'project.upsert', project: store.getProject(projet.id) ?? projet });
        ecrire(`Le projet « ${projet.name} » est sur votre tableau.\n`);
      }
      void nouveautes(true);
    },
  };
}

/** Où en est la copie, pour l'écran. */
export async function etatDeLaCopie(): Promise<{ faite: boolean; depot: string; projet: boolean }> {
  const connus = await distants();
  const aSoi = connus.origin && !estLeDepotPublic(connus.origin) ? connus.origin : '';
  const projet = Boolean(projetDeLApplication());
  return { faite: Boolean(aSoi && projet), depot: aSoi ? depotDeLAdresse(aSoi) || aSoi : '', projet };
}

/* ------------------------------------------------------------------ */
/* Récupérer les nouveautés                                             */
/* ------------------------------------------------------------------ */

const TITRE_DE_LA_CARTE = 'Récupérer les nouveautés de Beluga Build';

export type RecuperationDesNouveautes =
  | { ok: true; mode: 'carte'; projectId: string; cardId: string }
  | { ok: true; mode: 'simple'; recette: RecetteDeTravail }
  | { ok: false; erreur: string };

/**
 * RÉCUPÈRE LES NOUVEAUTÉS, selon ce qu'est devenue l'installation.
 *
 *  - COPIE PERSONNELLE : une carte est posée dans le projet de l'application.
 *    Elle naît dans « Planifié » et ne part que lancée — rapprocher deux
 *    versions d'un outil qu'on a modifié est un travail d'agent, relu avant
 *    d'être mis en ligne.
 *  - INSTALLATION JAMAIS MODIFIÉE : le code avance tout droit et se
 *    reconstruit ; il reste à redémarrer, ce que l'écran propose.
 */
export async function recupererLesNouveautes(): Promise<RecuperationDesNouveautes> {
  const distant = await distantDesNouveautes();
  if (!distant) return { ok: false, erreur: 'Cette installation ne suit pas le dépôt public de Beluga Build.' };

  const projet = projetDeLApplication();
  if (projet) {
    const deja = store
      .listCards(projet.id)
      .find((carte) => carte.title === TITRE_DE_LA_CARTE && (carte.column === 'planned' || carte.column === 'running'));
    if (deja) return { ok: true, mode: 'carte', projectId: projet.id, cardId: deja.id };
    const carte = createCard(projet.id, {
      title: TITRE_DE_LA_CARTE,
      origin: 'user',
      auteur: 'utilisateur',
      description: [
        `Le dépôt public de Beluga Build a avancé. Rapproche ses nouveautés de cette copie personnelle.`,
        ``,
        `- Récupère le dépôt public : \`git fetch ${distant} ${BRANCHE_PUBLIQUE}\`.`,
        `- Fusionne \`${distant}/${BRANCHE_PUBLIQUE}\` dans la branche de cette carte. S'il n'y a aucun historique commun (installation posée depuis une archive, ou dépôt public reparti de zéro), fusionne avec \`--allow-unrelated-histories\`.`,
        `- En cas de heurt, garde les modifications propres à cette copie quand elles sont voulues, et dis lesquelles tu as tranchées.`,
        `- Construis et rejoue les tests ; donne leur résultat.`,
        ``,
        `Ne mets rien en ligne : la mise en ligne reste le geste de l'utilisateur.`,
      ].join('\n'),
    });
    return { ok: true, mode: 'carte', projectId: projet.id, cardId: carte.id };
  }

  if (await git(['status', '--porcelain', '--untracked-files=no']).catch(() => 'x')) {
    return {
      ok: false,
      erreur:
        'Des fichiers de Beluga Build ont été modifiés sur ce serveur. Passez par la page « Votre propre Beluga » : vos modifications seront gardées, et les nouveautés rapprochées par un agent.',
    };
  }
  const npm = (titre: string, args: string[]): EtapeDeTravail => ({
    titre,
    programme: 'bash',
    args: ['-lc', `NODE_ENV=development npm ${args.join(' ')}`],
    cwd: DEPOT(),
  });
  return {
    ok: true,
    mode: 'simple',
    recette: {
      etapes: [
        etapeGit('fetch', distant, BRANCHE_PUBLIQUE),
        etapeGit('merge', '--ff-only', `${distant}/${BRANCHE_PUBLIQUE}`),
        npm('npm install', ['install', '--include=dev', '--no-audit', '--no-fund', '--loglevel=error']),
        npm('npm run build', ['run', 'build', '--silent']),
      ],
      apres: ({ ecrire }) => {
        ecrire('Les nouveautés sont en place. Redémarrez Beluga Build pour les appliquer.\n');
        void nouveautes(true);
      },
    },
  };
}
