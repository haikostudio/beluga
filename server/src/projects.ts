import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BranchesDePublication,
  EngineId,
  ProcedureDeDeploiement,
  Project,
  PLAGE_PORTS_PROJETS,
  TITRE_ETAPE_ADRESSE,
  adresseDuSousDomaine,
  choisirPortLibre,
  jugerAdresseDemandee,
  normaliserPort,
  portsDansVhostCaddy,
  portsEnEcouteDansSs,
  refusPortDejaAttribue,
  sansRegroupements,
} from '@beluga/shared';
import * as store from './store.js';
import { reglageDeDeploiementConstate } from './services-du-projet.js';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { creerFichierInstructions } from './memory.js';
import { DnsResult, publishSubdomain } from './dns.js';
import { recupererFaviconEnTache } from './favicon.js';
import { assurerLesBranchesDeLaRegle } from './branche-de-deploiement.js';

const execFileAsync = promisify(execFile);

/** Registre de projets : les dossiers du VPS et leurs métadonnées git. */

async function gitInfo(dir: string): Promise<{ remote?: string; branch?: string } | null> {
  try {
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      timeout: 8000,
    });
    let remote: string | undefined;
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: dir, timeout: 8000 });
      remote = stdout.trim();
    } catch {
      /* dépôt local sans distant */
    }
    return { branch: branch.trim(), remote };
  } catch {
    return null;
  }
}

export function registerProject(input: {
  name: string;
  path: string;
  gitRemote?: string;
  defaultEngine?: EngineId;
  devUrl?: string;
  rank?: number;
  /**
   * Les branches de publication à poser d'emblée. Un projet MONTÉ par Beluga Build
   * arrive avec sa branche de déploiement (« dev ») : c'est elle qui reçoit le
   * lot au clic « Tout déployer », et c'est d'elle que partent ses cartes. Une
   * nouvelle exploration du serveur n'écrase jamais un réglage déjà fait.
   */
  branchesDePublication?: BranchesDePublication;
  /** Le port attribué au montage (`portDuNouveauProjet`). Jamais écrasé s'il existe déjà. */
  port?: number;
  /**
   * Ce que l'utilisateur a écrit de sa mise en ligne AU MONTAGE : la
   * destination et les consignes (`shared/src/procedure-publication.ts`). Un
   * projet déjà inscrit garde les siennes — une nouvelle exploration du serveur
   * n'efface jamais un texte écrit à la main.
   */
  deploiement?: ProcedureDeDeploiement;
}): Project {
  const resolved = path.resolve(input.path);
  if (!fs.existsSync(resolved)) throw new Error(`le dossier ${resolved} n'existe pas`);

  const existing = store.getProjectByPath(resolved);
  const project = Project.parse({
    id: existing?.id ?? store.newId(),
    // Un projet déjà inscrit garde le nom que vous lui avez donné : une
    // nouvelle exploration du serveur ne doit jamais l'écraser.
    name: existing?.name ?? input.name,
    path: resolved,
    gitRemote: input.gitRemote ?? existing?.gitRemote,
    gitBranch: existing?.gitBranch,
    defaultEngine: input.defaultEngine ?? existing?.defaultEngine ?? 'claude',
    defaultModel: existing?.defaultModel,
    // Le basculement « agent complet » se décide sur le CHEMIN, jamais sur une
    // adresse distante (PLAN §5).
    isSelf: resolved === path.resolve(CONFIG.selfPath),
    // Une nouvelle exploration du serveur ne doit pas effacer l'adresse de dev
    // réglée à la main.
    devUrl: input.devUrl ?? existing?.devUrl,
    // Le port réglé ou rattrapé fait foi : une nouvelle exploration ne le touche pas.
    port: existing?.port ?? input.port,
    branchesDePublication: existing?.branchesDePublication ?? input.branchesDePublication,
    // La destination et les consignes écrites au montage : jamais écrasées.
    deploiement: existing?.deploiement ?? input.deploiement,
    billing: existing?.billing,
    rank: input.rank ?? existing?.rank ?? nextRank(),
    archived: false,
    createdAt: existing?.createdAt ?? store.now(),
    updatedAt: store.now(),
  });

  // Un projet qui arrive sans fichier d'instructions en reçoit un, vide mais
  // cadré : les agents savent alors où écrire les règles durables du projet.
  if (!existing) {
    try {
      if (creerFichierInstructions(resolved, project.name)) {
        log.info(`fichier d'instructions du moteur créé pour ${project.name}`);
      }
    } catch (err) {
      log.warn("fichier d'instructions non créé", err);
    }
  }

  const saved = store.saveProject(project);
  recupererFaviconEnTache(saved);
  return saved;
}

function nextRank(): number {
  const ranks = store.listProjects(true).map((p) => p.rank ?? 1000);
  return ranks.length ? Math.max(...ranks) + 10 : 10;
}

/** Une étape du montage d'un projet, telle qu'elle se lit dans l'interface. */
export type EtapeCreation = { titre: string; fait: boolean; detail?: string };

/**
 * LE PORT D'UN PROJET QU'ON MONTE (`shared/src/port-projet.ts`).
 *
 * Un port SAISI est gardé tel quel — mais REFUSÉ s'il est déjà attribué à un
 * autre projet, et ce refus part AVANT de toucher au disque. Sans saisie, un
 * port libre est attribué : ni porté par un autre projet, ni en écoute sur la
 * machine, ni visé par un vhost Caddy (un projet arrêté y garde sa place, comme
 * le lanceur `ensure-port.sh` le respecte déjà). `undefined` si la plage est
 * pleine : le projet se monte quand même, et le journal le dit.
 */
export async function portDuNouveauProjet(saisi?: number | null): Promise<number | undefined> {
  const projets = store.listProjects(true);
  if (saisi !== undefined && saisi !== null) {
    const port = normaliserPort(saisi);
    if (port === null) throw new Error(`port invalide : ${saisi} (un nombre entier entre 1 et 65535)`);
    const refus = refusPortDejaAttribue(port, projets);
    if (refus) throw new Error(refus);
    return port;
  }
  const occupes: number[] = [];
  try {
    const { stdout } = await execFileAsync('ss', ['-ltnH'], { timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
    occupes.push(...portsEnEcouteDansSs(stdout));
  } catch {
    // Pas de `ss` lisible : les ports attribués et les vhosts suffisent à éviter les doublons connus.
  }
  const fichiers = ['/etc/caddy/Caddyfile'];
  try {
    const dossier = '/etc/caddy/project-autostart.d';
    for (const nom of fs.readdirSync(dossier)) if (nom.endsWith('.caddy')) fichiers.push(path.join(dossier, nom));
  } catch {
    // Pas de dossier de vhosts : rien de plus à éviter.
  }
  for (const fichier of fichiers) {
    try {
      occupes.push(...portsDansVhostCaddy(fs.readFileSync(fichier, 'utf8')));
    } catch {
      // Fichier illisible : il n'apprend rien de plus.
    }
  }
  const libre = choisirPortLibre({ attribues: projets.map((projet) => projet.port), enEcoute: occupes });
  if (libre === null) {
    log.warn(
      `aucun port libre dans la plage des projets (${PLAGE_PORTS_PROJETS.min}-${PLAGE_PORTS_PROJETS.max}) : projet monté sans port`,
    );
  }
  return libre ?? undefined;
}

/**
 * L'ADRESSE PUBLIQUE, étape du montage comme les autres.
 *
 * Rien de demandé : AUCUNE étape et aucun échec — un projet sans adresse reste
 * parfaitement normal. Demandé mais mal saisi, ou refusé par le fournisseur :
 * l'étape est notée en échec, avec sa cause, et le montage continue. Le
 * mécanisme de création lui-même n'est pas touché : on l'appelle, c'est tout.
 *
 * `creer` n'est là que pour être remplacé par un contrôle : en vrai, c'est
 * toujours le mécanisme existant.
 */
export async function etapeAdressePublique(
  saisie: { sousDomaine?: string | null; port?: string | number | null },
  creer: (sousDomaine: string, port: number) => Promise<DnsResult> = publishSubdomain,
): Promise<{ etape?: EtapeCreation; url?: string }> {
  const demande = jugerAdresseDemandee(saisie);
  if (!demande.demandee) return {};

  if (demande.erreur || !demande.sousDomaine || demande.port === undefined) {
    return { etape: { titre: TITRE_ETAPE_ADRESSE, fait: false, detail: demande.erreur ?? 'adresse incomplète' } };
  }

  const attendue = adresseDuSousDomaine(demande.sousDomaine);
  try {
    const resultat = await creer(demande.sousDomaine, demande.port);
    if (!resultat.ok) {
      return { etape: { titre: TITRE_ETAPE_ADRESSE, fait: false, detail: resultat.error ?? 'création impossible' } };
    }
    const url = resultat.url ?? attendue;
    return { etape: { titre: TITRE_ETAPE_ADRESSE, fait: true, detail: `${url} → port ${demande.port}` }, url };
  } catch (err: any) {
    return { etape: { titre: TITRE_ETAPE_ADRESSE, fait: false, detail: messageErreur(err) } };
  }
}

/**
 * Crée un dossier NEUF sur le serveur puis l'inscrit : un nouveau projet
 * existe pour de vrai, il n'est pas seulement une ligne dans une liste.
 *
 * Le montage est TOUJOURS le même, sinon chaque projet démarre différemment et
 * les agents ne savent plus où chercher : le dossier, le dépôt git sur sa
 * branche principale, le dépôt distant sur GitHub, les fichiers d'instructions
 * des moteurs, la mémoire, l'historique et une documentation de départ.
 *
 * Une étape qui échoue n'arrête pas les autres : le dossier existe déjà, on ne
 * le jette pas parce que GitHub a refusé. Chaque étape rend son compte, et
 * l'interface montre ce qui est passé et ce qui ne l'est pas.
 */
export async function createProjectFolder(input: {
  name: string;
  folder?: string;
  description?: string;
  git?: boolean;
  gitRemote?: string;
  /** Créer le dépôt sur GitHub. Ignoré si une adresse est fournie à la main. */
  github?: boolean;
  /** Dépôt privé (défaut) ou public. */
  githubPublic?: boolean;
  /** Le nom court de l'adresse publique voulue. Vide : aucune adresse créée. */
  sousDomaine?: string;
  /** Le port sur lequel le projet écoute sur le serveur. */
  port?: number;
}): Promise<{ project: Project; etapes: EtapeCreation[] }> {
  const slug =
    (input.folder?.trim() || input.name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'projet';

  const etapes: EtapeCreation[] = [];
  const noter = (titre: string, fait: boolean, detail?: string) => etapes.push({ titre, fait, detail });

  const target = path.resolve(CONFIG.projectsRoot, slug);
  if (!target.startsWith(path.resolve(CONFIG.projectsRoot) + path.sep)) {
    throw new Error('emplacement refusé');
  }
  if (fs.existsSync(target)) throw new Error(`le dossier ${slug} existe déjà`);
  // Le port AVANT le disque : un port déjà attribué à un autre projet est un refus.
  const port = await portDuNouveauProjet(input.port);

  // Le dossier des projets appartient à l'administrateur du serveur : si le
  // démon ne peut pas y écrire directement, il crée avec élévation puis se
  // donne le dossier — c'est la convention en place sur cette machine.
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err: any) {
    if (err?.code !== 'EACCES' && err?.code !== 'EPERM') throw err;
    // À qui rendre le dossier : celui qui fait TOURNER le démon, lu du système
    // et non d'un nom écrit en dur — un nom emprunté à un autre projet donnait
    // un dossier appartenant à un compte qui n'existe pas forcément ici.
    const user = process.env.USER?.trim() || os.userInfo().username;
    await execFileAsync('sudo', ['-n', 'mkdir', '-p', target], { timeout: 20000 });
    await execFileAsync('sudo', ['-n', 'chown', '-R', `${user}:${user}`, target], { timeout: 20000 });
  }
  noter('Dossier créé sur le serveur', true, target);
  noter(
    'Port du projet attribué',
    port !== undefined,
    port !== undefined
      ? `port ${port}${input.port ? '' : ' (choisi libre automatiquement)'}`
      : `aucun port libre dans la plage ${PLAGE_PORTS_PROJETS.min}-${PLAGE_PORTS_PROJETS.max}`,
  );

  const ecrits = ecrireFichiersDeDepart(target, input.name, input.description);
  noter('Fichiers de départ écrits', true, ecrits.join(', '));

  const avecGit = input.git !== false;
  if (avecGit) {
    try {
      // La branche principale s'appelle « main » d'emblée : c'est le nom
      // qu'attend GitHub, et renommer après coup casse ce qui est déjà poussé.
      await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: target, timeout: 20000 });
      await execFileAsync('git', ['add', '-A'], { cwd: target, timeout: 20000 });
      await execFileAsync(
        'git',
        ['-c', 'user.email=beluga@local', '-c', 'user.name=Beluga Build', 'commit', '-qm', 'Départ du projet'],
        { cwd: target, timeout: 20000 },
      );
      noter('Dépôt git démarré sur la branche « main »', true);
    } catch (err: any) {
      noter('Dépôt git démarré sur la branche « main »', false, messageErreur(err));
    }
  }

  /*
   * Le dépôt distant. Une adresse fournie à la main gagne toujours : on la pose
   * telle quelle. Sinon on demande à GitHub d'en fabriquer un, par l'outil en
   * ligne de commande DÉJÀ authentifié sur le serveur — aucune clé à saisir.
   */
  let remote = input.gitRemote?.trim() || undefined;
  if (avecGit && remote) {
    try {
      await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: target, timeout: 20000 });
      noter('Dépôt distant rattaché', true, remote);
    } catch (err: any) {
      noter('Dépôt distant rattaché', false, messageErreur(err));
    }
  } else if (avecGit && input.github !== false) {
    const resultat = await creerDepotGithub(target, slug, input.description, input.githubPublic === true);
    remote = resultat.remote ?? remote;
    noter('Dépôt GitHub créé et poussé', resultat.ok, resultat.detail);
  }

  /*
   * LES DEUX BRANCHES DE LA RÈGLE D'OR, DÈS LA PREMIÈRE MINUTE — et APRÈS le
   * dépôt distant, pour qu'elles y soient poussées du même coup. Tout projet
   * monté par Beluga Build applique d'emblée le schéma unique : chaque carte
   * travaille sur sa propre branche, partie de « dev » ; le clic « Tout
   * déployer » fusionne le lot sur « dev » ; la mise en production le fusionne
   * sur « main ». Aucun autre schéma n'est autorisé. Un échec ici n'arrête
   * rien : le projet existe, il lui manque seulement une branche.
   */
  let branchesDePublication: BranchesDePublication | undefined;
  if (avecGit) {
    const posees = await assurerLesBranchesDeLaRegle(target);
    if (posees.branches.dev || posees.branches.production) branchesDePublication = posees.branches;
    noter('Branches « dev » et « main » en place', posees.ok, posees.details.join(' ; '));
  }

  /*
   * L'adresse publique, AVANT l'inscription : c'est elle qu'on range dans le
   * projet, et c'est elle que chaque déploiement contrôlera à la fin. Un échec
   * n'arrête rien — le projet existe, il lui manque seulement son adresse.
   */
  // Le port attribué ne sert l'adresse QUE si une adresse est demandée : sans
  // nom d'adresse, la saisie d'origine est transmise telle quelle, comme avant.
  const adresse = await etapeAdressePublique({
    sousDomaine: input.sousDomaine,
    port: input.sousDomaine?.trim() ? port : input.port,
  });
  if (adresse.etape) etapes.push(adresse.etape);

  log.info(`nouveau projet créé sur le serveur : ${target}`);
  const project = registerProject({
    name: input.name,
    path: target,
    gitRemote: remote,
    devUrl: adresse.url,
    rank: 5,
    branchesDePublication,
    port,
    deploiement: reglageDeDeploiementConstate(target),
  });
  noter('Projet inscrit dans la colonne de gauche', true);
  return { project, etapes };
}

function messageErreur(err: any): string {
  const texte = (err?.stderr ?? err?.message ?? String(err)).toString().trim();
  return texte.split('\n').slice(-2).join(' ').slice(0, 220);
}

/**
 * Les fichiers qu'un projet doit avoir dès la première minute : de quoi lancer
 * un agent dessus sans qu'il ait à deviner où écrire quoi. Rien n'est écrasé —
 * un fichier déjà là est laissé tel quel.
 */
export function ecrireFichiersDeDepart(target: string, nom: string, description?: string): string[] {
  const ecrits: string[] = [];
  const poser = (fichier: string, contenu: string) => {
    const chemin = path.join(target, fichier);
    if (fs.existsSync(chemin)) return;
    fs.writeFileSync(chemin, contenu, 'utf8');
    ecrits.push(fichier);
  };
  const date = new Date().toLocaleDateString('fr-CH');
  const resume = description?.trim() || '_À remplir : ce que fait ce projet, en une phrase._';

  poser(
    'README.md',
    `# ${nom}\n\n${resume}\n\nProjet créé depuis Beluga Build le ${date}.\n\n` +
      `## Documents du projet\n\n` +
      `- \`CLAUDE.md\` — les instructions du moteur : lancer, vérifier, où vivent les choses.\n` +
      `- \`DOCUMENTATION.md\` — la documentation du projet, tenue à jour au fil des tâches.\n` +
      `- La mémoire du projet — faits, règles, contrôles — vit en classeurs dans Beluga Build (écran « Mémoire »).\n` +
      `- \`HISTORIQUE.md\` — les livraisons datées.\n`,
  );

  // Le fichier d'instructions du moteur : le squelette partagé de la mémoire.
  if (creerFichierInstructions(target, nom)) ecrits.push('CLAUDE.md');

  /* Codex lit AGENTS.md, Claude lit CLAUDE.md. Deux fichiers qui divergent,
     c'est deux vérités : le second renvoie au premier. */
  poser(
    'AGENTS.md',
    `# ${nom} — instructions du moteur\n\n` +
      `Les instructions de ce projet vivent dans \`CLAUDE.md\`. Lis-le : il fait foi.\n`,
  );

  poser(
    'DOCUMENTATION.md',
    `# ${nom} — documentation\n\n` +
      `${resume}\n\n` +
      `_Tenue à jour AU FIL des tâches. Elle explique le projet à quelqu'un qui arrive :\n` +
      `à quoi il sert, comment il est bâti, comment on s'en sert._\n\n` +
      `## À quoi sert ce projet\n\n_À remplir._\n\n` +
      `## Comment il est bâti\n\n_À remplir : les grandes pièces et leur rôle._\n\n` +
      `## Comment on s'en sert\n\n_À remplir : installer, lancer, vérifier._\n\n` +
      `## Ce qui reste à faire\n\n_À remplir._\n`,
  );

  poser(
    'HISTORIQUE.md',
    `# Historique des livraisons\n\n` +
      `_Tenu automatiquement par Beluga Build. Ce fichier n'est JAMAIS envoyé au moteur : il se relit à la main._\n\n`,
  );

  poser('.gitignore', `node_modules/\ndist/\n.env\n.env.local\n*.log\n.DS_Store\n`);

  return ecrits;
}

/**
 * Le dépôt sur GitHub, par l'outil en ligne de commande déjà authentifié. On
 * pousse dans la foulée : un dépôt vide ne dirait pas si le rattachement a
 * vraiment marché.
 */
async function creerDepotGithub(
  target: string,
  slug: string,
  description: string | undefined,
  publique: boolean,
): Promise<{ ok: boolean; remote?: string; detail?: string }> {
  const args = ['repo', 'create', slug, publique ? '--public' : '--private', '--source', '.', '--remote', 'origin', '--push'];
  if (description?.trim()) args.push('--description', description.trim());
  try {
    await execFileAsync('gh', args, { cwd: target, timeout: 120000 });
    let remote: string | undefined;
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: target, timeout: 10000 });
      remote = stdout.trim();
    } catch {
      /* le dépôt est là, seule son adresse manque */
    }
    return { ok: true, remote, detail: remote };
  } catch (err: any) {
    const detail = messageErreur(err);
    log.warn('dépôt GitHub non créé', detail);
    return { ok: false, detail };
  }
}

/** Parcourt le dossier des projets et propose ceux qui ne sont pas encore inscrits. */
export async function scanProjects(): Promise<{ name: string; path: string; git: boolean }[]> {
  const root = CONFIG.projectsRoot;
  const known = new Set(store.listProjects(true).map((p) => p.path));
  const found: { name: string; path: string; git: boolean }[] = [];

  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(root, entry.name);
      if (known.has(full)) continue;
      const hasGit = fs.existsSync(path.join(full, '.git'));
      const hasPackage = fs.existsSync(path.join(full, 'package.json'));
      if (!hasGit && !hasPackage) continue;
      found.push({ name: entry.name, path: full, git: hasGit });
    }
  } catch (err) {
    log.warn('exploration des projets impossible', err);
  }
  return found;
}

/**
 * Tous les projets présents sur le serveur sont inscrits d'office : on doit
 * les VOIR dans la colonne de gauche, comme avant. Ceux qui ne servent plus se
 * mettent de côté par archivage, ils ne disparaissent pas d'eux-mêmes.
 */
export async function adoptServerProjects(): Promise<number> {
  if (store.getMetaValue('projects.adopted') === '1') return 0;
  const found = await scanProjects();
  let count = 0;
  for (const entry of found) {
    try {
      registerProject({ name: entry.name, path: entry.path });
      count += 1;
    } catch (err) {
      log.warn(`projet ${entry.name} non inscrit`, err);
    }
  }
  store.setMetaValue('projects.adopted', '1');
  if (count) log.info(`${count} projet(s) du serveur inscrits automatiquement`);
  return count;
}

/** Le projet Beluga Build lui-même, inscrit au premier démarrage. */
export async function ensureSelfProject(): Promise<Project> {
  const selfPath = path.resolve(CONFIG.selfPath);
  const existing = store.getProjectByPath(selfPath);
  if (existing) {
    if (!existing.isSelf) return store.saveProject({ ...existing, isSelf: true });
    return existing;
  }
  const info = await gitInfo(selfPath);
  return registerProject({
    name: 'Beluga Build',
    path: selfPath,
    gitRemote: info?.remote,
    defaultEngine: 'claude',
  });
}

/** Rafraîchit la branche courante de chaque projet. */
export async function refreshGitInfo(): Promise<void> {
  for (const project of sansRegroupements(store.listProjects())) {
    const info = await gitInfo(project.path);
    if (info && info.branch !== project.gitBranch) {
      store.saveProject({ ...project, gitBranch: info.branch, gitRemote: info.remote ?? project.gitRemote });
    }
  }
}
