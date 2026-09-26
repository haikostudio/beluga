import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DeployRun,
  GithubTracking,
  avecLesLignes,
  deploiementsDeLaCarte,
  fichiersDepuisNameStatus,
  lignesDepuisNumstat,
  variablesGithub,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { branchePrincipale, sortieGit } from './git.js';
import { brancheDeDeploiement } from './branche-de-deploiement.js';

const execFileAsync = promisify(execFile);

/**
 * Combien d'enregistrements de la branche s'affichent. Une carte reprise dix
 * fois en aligne parfois des dizaines ; la liste doit rester lisible, et le
 * compte de fichiers dit déjà l'ampleur.
 */
const COMMITS_MONTRES_MAX = 20;

/**
 * Suivi GitHub (PLAN §8). La lecture passe par l'outil GitHub en ligne de
 * commande DÉJÀ authentifié sur le serveur : aucun jeton à saisir dans
 * l'interface. La couche est isolée pour accepter demain GitLab ou Gitea.
 */

async function gh(args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await execFileAsync('gh', args, { cwd, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, out: stdout };
  } catch (err: any) {
    return { ok: false, out: (err?.stderr ?? err?.message ?? '').toString() };
  }
}

/*
 * LE JETON GITHUB DE L'ENVIRONNEMENT DES AGENTS.
 *
 * L'outil `gh` est identifié sur le serveur : son jeton dort dans le dossier
 * personnel du compte qui porte le démon. Un agent, lui, travaille dans une copie
 * de travail ou dans un bac à sable, où ce dossier n'est pas forcément lisible :
 * on lui passe donc le jeton par l'ENVIRONNEMENT (`variablesGithub`), ce qui rend
 * `gh` utilisable partout sans rien lire sur le disque.
 *
 * Le jeton est demandé À `gh` lui-même (`gh auth token`) : aucune clé à saisir
 * dans l'interface, aucun chemin en dur, et un changement d'identification est
 * repris tout seul. La réponse est gardée une heure — le relever à chaque tour
 * ajouterait un lancement de processus pour une valeur qui ne bouge pas.
 */
const DUREE_CACHE_JETON_MS = 60 * 60 * 1000;
let jetonEnCache: { valeur?: string; at: number } | undefined;

/** Le jeton GitHub du serveur, ou rien si l'outil n'est pas identifié. */
export async function jetonGithub(): Promise<string | undefined> {
  const depuisEnv = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (depuisEnv) return depuisEnv;
  if (jetonEnCache && Date.now() - jetonEnCache.at < DUREE_CACHE_JETON_MS) return jetonEnCache.valeur;
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10000 });
    const valeur = stdout.trim() || undefined;
    jetonEnCache = { valeur, at: Date.now() };
    if (!valeur) log.warn("gh est présent mais ne rend aucun jeton : les agents n'auront pas GitHub");
    return valeur;
  } catch (err: any) {
    jetonEnCache = { valeur: undefined, at: Date.now() };
    log.warn(`jeton GitHub indisponible pour les agents : ${(err?.stderr ?? err?.message ?? '').toString().trim()}`);
    return undefined;
  }
}

/**
 * Les variables GitHub à poser dans l'environnement d'un agent. Vide quand le
 * serveur n'est pas identifié : on ne pose jamais de variable creuse.
 */
export async function envGithub(): Promise<Record<string, string>> {
  return variablesGithub(await jetonGithub());
}

/*
 * Le dialogue avec git vit dans `server/src/git.ts` : ici, on ne lit que des
 * sorties (`log`, `diff`, `merge-base`), et une lecture qui échoue vaut « rien ».
 */
async function git(args: string[], cwd: string): Promise<string> {
  return (await sortieGit(cwd, args)) ?? '';
}

/* ------------------------------------------------------------------ */
/* Les branches du dépôt                                               */
/* ------------------------------------------------------------------ */

/** D'où vient la liste de branches rendue. */
export type SourceDesBranches = 'github' | 'local' | 'aucune';

export interface BranchesDuDepot {
  /** Les noms de branches, rangés : les branches de carte en dernier. */
  branches: string[];
  source: SourceDesBranches;
  /** Ce qui a empêché de lire GitHub, quand c'est le cas. */
  raison?: string;
}

/**
 * Les branches du dépôt GITHUB de ce projet, pour les proposer au choix.
 *
 * La liste est RELATIVE au projet : `gh` résout `{owner}/{repo}` depuis le
 * dossier du dépôt, il n'y a donc aucun nom de dépôt à saisir nulle part. Le
 * jeton est celui du serveur, déjà identifié.
 *
 * GitHub injoignable (pas de dépôt distant, réseau coupé, jeton refusé) n'est
 * pas une panne : on retombe sur les branches connues LOCALEMENT et on le DIT,
 * plutôt que de rendre une liste vide sans explication.
 *
 * L'ORDRE compte : un vieux dépôt en compte des centaines, et l'utilisateur
 * cherche « main » ou « dev », pas la branche d'une carte de l'an dernier. On
 * range donc en trois paquets — les branches de mise en ligne connues d'abord,
 * les branches ordinaires ensuite, les éphémères (branches de carte, branches
 * archivées) en dernier. Rien n'est coupé : la liste reste entière.
 */
const BRANCHES_EN_TETE = [
  'main',
  'master',
  'dev',
  'develop',
  'staging',
  'preprod',
  'production',
  'prod',
  'release',
  'livraison',
];

export async function branchesDuDepot(cwd: string): Promise<BranchesDuDepot> {
  const ranger = (noms: string[]): string[] => {
    const propres = [...new Set(noms.map((nom) => nom.trim()).filter(Boolean))];
    const ephemere = (nom: string) => nom.includes('tache/') || nom.startsWith('archive/');
    const rang = (nom: string) => {
      const enTete = BRANCHES_EN_TETE.indexOf(nom);
      if (enTete >= 0) return enTete;
      return ephemere(nom) ? 2000 : 1000;
    };
    return propres.sort((a, b) => rang(a) - rang(b) || a.localeCompare(b));
  };

  const distant = await gh(
    ['api', '--paginate', 'repos/{owner}/{repo}/branches?per_page=100', '--jq', '.[].name'],
    cwd,
  );
  if (distant.ok) {
    const branches = ranger(distant.out.split('\n'));
    if (branches.length) return { branches, source: 'github' };
  }

  // Repli LOCAL : le dépôt existe, mais GitHub n'a rien rendu.
  const local = await git(['branch', '--format=%(refname:short)'], cwd);
  const branches = ranger(local.split('\n'));
  const raison = distant.out.trim().split('\n').pop()?.slice(0, 200);
  if (branches.length) return { branches, source: 'local', raison };
  return { branches: [], source: 'aucune', raison };
}

/* ------------------------------------------------------------------ */
/* Le point de départ de la branche d'une carte                         */
/* ------------------------------------------------------------------ */

/**
 * D'OÙ PART LA BRANCHE DE CETTE CARTE ?
 *
 * Toute la question de l'onglet « GitHub » tient là : sans ce point, un
 * `git log branche` rend l'historique GÉNÉRAL du dépôt — le travail des autres
 * cartes, parfois de l'année d'avant. Trois chemins, du plus sûr au plus faible :
 *
 *   1. la base RETENUE à la création de la branche (`baseSha`) — la seule qui ne
 *      puisse pas mentir ;
 *   2. l'ancêtre commun avec la principale, tant que la branche n'a pas été
 *      fusionnée ;
 *   3. après la fusion, cet ancêtre devient la branche elle-même (la principale
 *      la contient) : on retrouve alors le commit de FUSION — celui dont le
 *      second parent est le sommet de la branche — et on repart de son PREMIER
 *      parent, l'état de la principale juste avant.
 *
 * Rien de trouvé rend `undefined` : on préfère un onglet qui dit ne pas savoir à
 * un onglet qui invente un périmètre.
 */
export async function baseDeLaBranche(
  cwd: string,
  branche: string,
  principale: string,
  baseConnue?: string,
): Promise<string | undefined> {
  if (baseConnue) {
    const valide = await git(['rev-parse', '--verify', '--quiet', `${baseConnue}^{commit}`], cwd);
    if (valide.trim()) return valide.trim();
  }

  const sommet = (await git(['rev-parse', '--verify', '--quiet', `${branche}^{commit}`], cwd)).trim();
  if (!sommet) return undefined;

  const ancetre = (await git(['merge-base', principale, branche], cwd)).trim();
  if (ancetre && ancetre !== sommet) return ancetre;

  // La principale contient déjà la branche : on cherche la fusion qui l'a prise.
  const fusions = await git(
    ['rev-list', '--merges', '--first-parent', '--format=%H %P', '-n', '200', principale],
    cwd,
  );
  for (const ligne of fusions.split('\n')) {
    const parts = ligne.trim().split(/\s+/);
    if (parts.length < 3 || ligne.startsWith('commit ')) continue;
    const parents = parts.slice(1);
    if (!parents.slice(1).includes(sommet)) continue;
    const avant = (await git(['merge-base', parents[0], branche], cwd)).trim();
    if (avant && avant !== sommet) return avant;
  }
  return undefined;
}

export async function refreshCard(cardId: string): Promise<GithubTracking | null> {
  const card = store.getCard(cardId);
  if (!card) return null;
  const project = store.getProject(card.projectId);
  if (!project) return null;

  const branch = card.github?.branch;
  const tracking: GithubTracking = GithubTracking.parse({
    ...(card.github ?? {}),
    checks: [],
    commits: [],
    fichiers: [],
    activity: [],
    fetchedAt: Date.now(),
  });

  if (branch) {
    /*
     * LA BRANCHE DE LA CARTE, ET ELLE SEULE. Le relevé part du point de départ
     * de la branche : les enregistrements faits depuis, les fichiers touchés
     * depuis, et la date du plus ancien — sa naissance réelle.
     */
    const principale = await branchePrincipale(project.path);
    tracking.branchePrincipale = principale;
    const base = await baseDeLaBranche(project.path, branch, principale, card.github?.baseSha);
    tracking.baseSha = base;

    if (base) {
      // Date complète (heure comprise) : « le 2 à 09:14 » est plus utile que « le 2 ».
      const logOut = await git(['log', '--format=%H|%s|%aI', `${base}..${branch}`], project.path);
      tracking.commits = logOut
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha, message, date] = line.split('|');
          return { sha: sha ?? '', message: message ?? '', date };
        })
        .slice(0, COMMITS_MONTRES_MAX);
      tracking.creeLe = tracking.commits.length
        ? tracking.commits[tracking.commits.length - 1]?.date
        : undefined;

      /*
       * LES FICHIERS, ET CE QU'ILS ONT VRAIMENT PRIS OU PERDU. `--name-status`
       * donne le sort de chaque fichier, `--numstat` ses lignes ajoutées et
       * supprimées : deux lectures de git, une seule liste rendue.
       */
      const diff = await git(['diff', '--name-status', `${base}`, branch], project.path);
      const numstat = await git(['diff', '--numstat', `${base}`, branch], project.path);
      tracking.fichiers = avecLesLignes(fichiersDepuisNameStatus(diff), lignesDepuisNumstat(numstat));
    }

    /*
     * « FUSIONNÉE » SE JUGE SUR LA BRANCHE DE DÉPLOIEMENT, PAS SEULEMENT SUR LA
     * PRINCIPALE. Depuis que la fusion attend le clic « Tout déployer », une
     * carte déployée voit sa branche entrer dans la branche de déploiement
     * (« dev » le plus souvent) ; elle n'atteint la principale qu'à la mise en
     * production. Regarder la seule principale aurait affiché « pas encore
     * fusionnée » sur des cartes bel et bien déployées.
     */
    const deploiement = await brancheDeDeploiement(project.path, project.branchesDePublication);
    const contenue = await git(['branch', '--contains', branch, '--format=%(refname:short)'], project.path);
    const accueils = contenue.split('\n').map((l) => l.trim());
    tracking.fusionnee = accueils.includes(principale) || accueils.includes(deploiement);

    const prJson = await gh(
      ['pr', 'view', branch, '--json', 'number,title,state,url,mergeable,reviewDecision,statusCheckRollup,comments,reviews'],
      project.path,
    );
    if (prJson.ok) {
      try {
        const data = JSON.parse(prJson.out);
        tracking.prNumber = data.number;
        tracking.prTitle = data.title;
        tracking.prState = data.state === 'MERGED' ? 'merged' : data.state === 'CLOSED' ? 'closed' : 'open';
        tracking.prUrl = data.url;
        tracking.mergeable = data.mergeable;
        tracking.reviewDecision = data.reviewDecision ?? undefined;
        tracking.checks = (data.statusCheckRollup ?? []).map((check: any) => ({
          name: check.name ?? check.context ?? 'test',
          status: check.status ?? check.state ?? 'UNKNOWN',
          conclusion: check.conclusion ?? undefined,
        }));
        tracking.activity = [
          ...(data.comments ?? []).map((c: any) => ({
            kind: 'commentaire',
            author: c.author?.login ?? '—',
            body: (c.body ?? '').slice(0, 400),
            date: c.createdAt ?? '',
          })),
          ...(data.reviews ?? []).map((r: any) => ({
            kind: `revue (${r.state ?? ''})`,
            author: r.author?.login ?? '—',
            body: (r.body ?? '').slice(0, 400),
            date: r.submittedAt ?? '',
          })),
        ].sort((a, b) => (a.date < b.date ? 1 : -1));
      } catch (err) {
        log.warn('lecture de la demande de fusion impossible', err);
      }
    }
  }

  /*
   * LES DÉPÔTS ANNEXES d'un projet à plusieurs dépôts : la MÊME branche, lue
   * dans chacun. Un dépôt où elle n'existe pas, ou n'a rien changé, ne laisse
   * aucune trace dans l'onglet.
   */
  if (branch && project.depots?.length) {
    const depots: NonNullable<GithubTracking['depots']> = [];
    for (const annexe of project.depots) {
      const baseConnue = card.github?.depots?.find((d) => d.nom === annexe.nom)?.baseSha;
      const lu = await suiviDansLeDepot(annexe.path, branch, baseConnue, annexe.branchesDePublication);
      if (lu && (lu.commits.length || lu.fichiers.length)) depots.push({ nom: annexe.nom, ...lu });
      else if (baseConnue) depots.push({ nom: annexe.nom, baseSha: baseConnue, commits: [], fichiers: [] });
    }
    tracking.depots = depots;
  }

  const updated = store.saveCard({ ...card, github: tracking });
  bus.emit({ type: 'card.upsert', card: updated });
  return tracking;
}

/**
 * LA BRANCHE D'UNE CARTE DANS UN DÉPÔT ANNEXE : sa base, ses enregistrements,
 * ses fichiers et si elle a rejoint la branche de déploiement. `null` quand la
 * branche n'existe pas dans ce dépôt.
 */
async function suiviDansLeDepot(
  racine: string,
  branche: string,
  baseConnue: string | undefined,
  reglees: Parameters<typeof brancheDeDeploiement>[1],
): Promise<Omit<NonNullable<GithubTracking['depots']>[number], 'nom'> | null> {
  const existe = (await git(['rev-parse', '--verify', '--quiet', `${branche}^{commit}`], racine)).trim();
  if (!existe) return null;
  const principale = await branchePrincipale(racine);
  const base = await baseDeLaBranche(racine, branche, principale, baseConnue);
  let commits: { sha: string; message: string; date?: string }[] = [];
  let fichiers: GithubTracking['fichiers'] = [];
  if (base) {
    const logOut = await git(['log', '--format=%H|%s|%aI', `${base}..${branche}`], racine);
    commits = logOut
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, message, date] = line.split('|');
        return { sha: sha ?? '', message: message ?? '', date };
      })
      .slice(0, COMMITS_MONTRES_MAX);
    const diff = await git(['diff', '--name-status', base, branche], racine);
    const numstat = await git(['diff', '--numstat', base, branche], racine);
    fichiers = avecLesLignes(fichiersDepuisNameStatus(diff), lignesDepuisNumstat(numstat));
  }
  const deploiement = await brancheDeDeploiement(racine, reglees);
  const contenue = await git(['branch', '--contains', branche, '--format=%(refname:short)'], racine);
  const accueils = contenue.split('\n').map((l) => l.trim());
  return {
    baseSha: base,
    branchePrincipale: principale,
    fusionnee: accueils.includes(principale) || accueils.includes(deploiement),
    commits,
    fichiers,
  };
}

/**
 * LES PUBLICATIONS QUI ONT EMPORTÉ CETTE CARTE, du plus récent au plus ancien.
 *
 * Le tri et le plafond sont une règle pure (`deploiementsDeLaCarte`) : ici on ne
 * fait que relire la base du projet. Une carte jamais déployée rend une liste
 * vide — pas une panne.
 */
export function deploiementsDeCarte(cardId: string): DeployRun[] {
  const card = store.getCard(cardId);
  if (!card) return [];
  return deploiementsDeLaCarte(store.recentDeploys(card.projectId, 50), cardId);
}

export async function mergeCard(
  cardId: string,
  method: 'merge' | 'squash' | 'rebase',
  auto = false,
): Promise<{ ok: boolean; error?: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };
  const project = store.getProject(card.projectId);
  if (!project || !card.github?.prNumber) return { ok: false, error: 'aucune demande de fusion liée' };

  const args = ['pr', 'merge', String(card.github.prNumber), `--${method}`];
  if (auto) args.push('--auto');
  const result = await gh(args, project.path);
  if (!result.ok) return { ok: false, error: result.out.slice(0, 300) };

  await refreshCard(cardId);
  return { ok: true };
}

