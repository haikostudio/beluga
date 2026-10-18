import { execFile, spawn, type ChildProcess } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ADRESSE_D_UN_JETON_CLASSIQUE,
  BIBLIOTHEQUES_PROPOSEES,
  DROITS_GITHUB_DEMANDES,
  DUREE_DU_CODE_GITHUB_MS,
  REFUS_JETON_SANS_DEPOTS_PRIVES,
  REFUS_JETON_SANS_WORKFLOW,
  codeDeConnexionLu,
  droitsDeLEntete,
  refusDuJetonGithub,
  type ConnexionGithubParCode,
  type LectureDuJetonGithub,
  FICHIER_REGISTRE_BIBLIOTHEQUES,
  adresseEstProvisoire,
  apresEtape,
  hoteNu,
  identiteDInstallation,
  nettoyerIdentite,
  nomDeDomaineValide,
  registreDepuisTexte,
  GENRES_DE_SECRET,
  type EtapeDeLAssistant,
  type GenreDeSecret,
  type Settings,
} from '@beluga/shared';
import { importerUneBibliotheque } from './bibliotheques-competences.js';
import { bus } from './bus.js';
import { oublierLeJetonGithub } from './github.js';
import { enregistrerAcces, listerAcces } from './coffre-fort.js';
import { CONFIG, PATHS } from './config.js';
import { serverIp } from './dns.js';
import { modeRetenu, raisonDeLExtinction } from './envoi-des-courriels.js';
import { SECRETS_DES_FOURNISSEURS } from './fournisseurs-de-noms.js';
import { machineHebergee } from './offre-hebergee.js';
import { log } from './logger.js';
import * as store from './store.js';
import { getSettings, saveSettings } from './store.js';
import { vectoriseurDisponible } from './vectoriseur.js';
import { voiceAvailable } from './voice.js';

const execFileAsync = promisify(execFile);

/**
 * CE QUE L'ASSISTANT DE DÉMARRAGE ET LA PAGE « INSTALLATION » DEMANDENT AU DÉMON.
 *
 * Les réglages simples (noms, adresses de courriel) passent par l'enregistrement
 * ordinaire des réglages. Ici vit ce qui demande un GESTE sur la machine : poser
 * une adresse dans le reverse-proxy, ranger un secret au coffre-fort, relier
 * GitHub, importer une bibliothèque de compétences — et dire où chacun en est.
 */

/* ------------------------------------------------------------------ */
/* Le reverse-proxy                                                     */
/* ------------------------------------------------------------------ */

/**
 * LE DOSSIER DES ADRESSES DE BELUGA DANS LE REVERSE-PROXY. C'est l'installateur
 * (`scripts/installer.sh`) qui le crée et le fait lire par Caddy. Un serveur
 * monté autrement ne l'a pas : on le DIT, au lieu d'écrire un fichier que
 * personne ne lirait et d'annoncer un succès.
 */
const DOSSIER_CADDY = '/etc/caddy/beluga.d';
const CADDYFILE = '/etc/caddy/Caddyfile';

function reverseProxyPoseParLInstallateur(): boolean {
  try {
    return fs.existsSync(DOSSIER_CADDY) && fs.readFileSync(CADDYFILE, 'utf8').includes('beluga.d');
  } catch {
    return false;
  }
}

/** Le nom mène-t-il à cette machine ? Demandé à un résolveur public, pas au cache local. */
async function leNomMeneIci(hote: string, ip: string): Promise<boolean> {
  const resolveur = new dns.promises.Resolver({ timeout: 5000, tries: 2 });
  resolveur.setServers(['1.1.1.1', '8.8.8.8']);
  try {
    return (await resolveur.resolve4(hote)).includes(ip);
  } catch {
    return false;
  }
}

async function ecrireAvecSudo(fichier: string, contenu: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const enfant = spawn('sudo', ['-n', 'tee', fichier], { stdio: ['pipe', 'ignore', 'pipe'] });
    let erreur = '';
    enfant.stderr.on('data', (d) => (erreur += String(d)));
    enfant.on('error', reject);
    enfant.on('close', (code) => (code === 0 ? resolve() : reject(new Error(erreur.trim() || `tee a rendu ${code}`))));
    enfant.stdin.end(contenu);
  });
}

/** Le bloc d'une adresse : le nom, et le démon derrière. L'entête d'hôte arrive INTACT. */
function blocDAdresse(hotes: string[]): string {
  return `${hotes.join(', ')} {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:${CONFIG.port}\n}\n`;
}

export interface ResultatDAdresse {
  ok: boolean;
  erreur?: string;
  adresse?: string;
}

/**
 * POSE UNE ADRESSE DE BELUGA — celle de l'administration, ou celle de l'espace
 * client. Dans l'ordre qui évite la limitation des certificats : le nom doit
 * déjà mener ici, PUIS le reverse-proxy est écrit, validé, rechargé.
 *
 * L'ancienne adresse de l'administration est GARDÉE à côté de la nouvelle :
 * l'écran d'où part ce geste est servi par elle, et la retirer couperait la
 * réponse en plein vol.
 */
export async function poserUneAdresse(genre: 'administration' | 'espace-client', saisie: string): Promise<ResultatDAdresse> {
  const hote = hoteNu(saisie);
  if (!nomDeDomaineValide(hote)) return { ok: false, erreur: `« ${saisie} » n'est pas un nom de domaine.` };
  if (!reverseProxyPoseParLInstallateur()) {
    return {
      ok: false,
      erreur:
        "Le reverse-proxy de ce serveur n'a pas été posé par l'installateur de Beluga Build : l'adresse se crée à la main, puis s'enregistre dans le champ.",
    };
  }
  const ip = await serverIp();
  if (!ip) return { ok: false, erreur: "L'adresse publique de ce serveur n'a pas pu être lue." };
  if (!(await leNomMeneIci(hote, ip))) {
    return {
      ok: false,
      erreur: `${hote} ne mène pas encore à ce serveur. Créez chez votre fournisseur de noms un enregistrement « A » vers ${ip}, attendez quelques minutes, puis réessayez.`,
    };
  }

  const identite = identiteDInstallation();
  const fichier = path.join(DOSSIER_CADDY, `${genre}.caddy`);
  const avant = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8') : null;
  const hotes =
    genre === 'administration' ? [...new Set([hote, hoteNu(identite.adressePublique)].filter(Boolean))] : [hote];
  try {
    await ecrireAvecSudo(fichier, blocDAdresse(hotes));
    await execFileAsync('sudo', ['-n', 'caddy', 'validate', '--config', CADDYFILE], { timeout: 30000 });
    await execFileAsync('sudo', ['-n', 'systemctl', 'reload', 'caddy'], { timeout: 30000 });
  } catch (err: any) {
    // Une configuration refusée ne reste pas en place : la précédente revient.
    try {
      if (avant === null) await execFileAsync('sudo', ['-n', 'rm', '-f', fichier], { timeout: 20000 });
      else await ecrireAvecSudo(fichier, avant);
    } catch {
      /* le fichier précédent n'a pas pu revenir : l'erreur d'origine le dit déjà */
    }
    return { ok: false, erreur: `Le service web a refusé la configuration : ${String(err?.stderr ?? err?.message ?? err).slice(0, 300)}` };
  }

  const neuve = nettoyerIdentite(
    genre === 'administration' ? { ...identite, adressePublique: `https://${hote}` } : { ...identite, hoteEspaceClient: hote },
  );
  saveSettings({ installation: neuve });
  log.info(`installation : adresse ${genre} posée sur ${hote}`);
  return { ok: true, adresse: `https://${hote}` };
}

/* ------------------------------------------------------------------ */
/* Les secrets : au coffre-fort, jamais dans les réglages               */
/* ------------------------------------------------------------------ */

interface ModeleDeFiche {
  nom: string;
  type: 'cle-api' | 'jeton' | 'mot-de-passe';
  /** Le champ de la fiche qui porte le secret. */
  champ: string;
  /** Les autres champs d'une fiche NEUVE (le service, l'identifiant). */
  autres: () => Record<string, string>;
  /** Ce qui fait reconnaître la fiche, lu sur « service nom ». */
  motif: RegExp;
}

/**
 * UNE FICHE PAR SECRET, reconnue à son SERVICE ou à son nom. Les secrets des
 * fournisseurs de noms sont décrits là où ils sont lus
 * (`SECRETS_DES_FOURNISSEURS`, `server/src/fournisseurs-de-noms.ts`) : l'écran
 * qui les range et le démon qui s'en sert ne peuvent pas diverger.
 */
const FICHES: Record<GenreDeSecret, ModeleDeFiche> = {
  courriels: { nom: 'Resend — envoi des courriels', type: 'cle-api', champ: 'cle', autres: () => ({ service: 'Resend' }), motif: /resend/i },
  // Le mot de passe du service de courriel : `envoi-des-courriels.ts` le
  // reconnaît à « SMTP » dans le NOM (une fiche « mot de passe » n'a pas de champ service).
  smtp: {
    nom: 'SMTP — envoi des courriels',
    type: 'mot-de-passe',
    champ: 'motDePasse',
    autres: () => ({ identifiant: identiteDInstallation().smtpIdentifiant }),
    motif: /smtp/i,
  },
  ...(Object.fromEntries(
    Object.values(SECRETS_DES_FOURNISSEURS)
      .flat()
      .map((secret) => [
        secret.genre,
        { nom: secret.nom, type: secret.type, champ: secret.champ, autres: () => ({ service: secret.service }), motif: secret.motif },
      ]),
  ) as unknown as Record<Exclude<GenreDeSecret, 'courriels' | 'smtp'>, ModeleDeFiche>),
};

function ficheDuSecret(genre: GenreDeSecret) {
  const modele = FICHES[genre];
  return listerAcces().find((fiche) => modele.motif.test(`${fiche.champs.service ?? ''} ${fiche.nom}`));
}

/** Range (ou remplace) un secret de l'installation au coffre-fort. */
export function rangerUnSecret(genre: GenreDeSecret, valeur: string): { ok: boolean; erreur?: string } {
  const propre = valeur.trim();
  if (!propre) return { ok: false, erreur: 'La valeur est vide.' };
  const modele = FICHES[genre];
  if (!modele) return { ok: false, erreur: 'Ce secret n’est pas connu de Beluga Build.' };
  const existante = ficheDuSecret(genre);
  // Une fiche du même genre est CORRIGÉE ; sinon une fiche neuve est rangée.
  const rendu =
    existante && existante.type === modele.type
    ? enregistrerAcces({
        id: existante.id,
        nom: existante.nom,
        note: existante.note,
        type: modele.type,
        champs: { ...existante.champs, [modele.champ]: propre },
      })
    : enregistrerAcces({ nom: modele.nom, type: modele.type, champs: { ...modele.autres(), [modele.champ]: propre } });
  return rendu.ok ? { ok: true } : { ok: false, erreur: rendu.raison };
}

/* ------------------------------------------------------------------ */
/* GitHub                                                               */
/* ------------------------------------------------------------------ */

export interface EtatGitHub {
  /** L'outil `gh` est-il sur le serveur ? */
  installe: boolean;
  connecte: boolean;
  compte?: string;
}

export async function etatGitHub(): Promise<EtatGitHub> {
  try {
    await execFileAsync('gh', ['--version'], { timeout: 10000 });
  } catch {
    return { installe: false, connecte: false };
  }
  try {
    const { stdout } = await execFileAsync('gh', ['api', 'user', '--jq', '.login'], { timeout: 20000 });
    return { installe: true, connecte: true, compte: stdout.trim() || undefined };
  } catch {
    return { installe: true, connecte: false };
  }
}

/**
 * L'ENVIRONNEMENT D'UN APPEL À L'OUTIL GITHUB QUI DOIT ÉCRIRE SA CONNEXION. Un
 * jeton posé dans l'environnement du démon (`GH_TOKEN`, `GITHUB_TOKEN`) passe
 * avant tout le reste : l'outil refuse alors de se connecter (« The value of
 * the GH_TOKEN environment variable is being used »). On les retire donc de ce
 * seul appel — vérifié le 18/10/2026 avec gh 2.98.0.
 */
function environnementSansJeton(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: '1', GH_BROWSER: 'true', BROWSER: 'true' };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

/** Ce que GitHub dit du jeton, lu AVANT de l'enregistrer : le jeton voyage dans l'entête, jamais dans une commande. */
async function lireLeJeton(jeton: string, requete: typeof fetch = fetch): Promise<LectureDuJetonGithub> {
  const entetes = { authorization: `Bearer ${jeton}`, accept: 'application/vnd.github+json', 'user-agent': 'Beluga Build' };
  let reponse: Response;
  try {
    reponse = await requete('https://api.github.com/user', { headers: entetes, signal: AbortSignal.timeout(15000) });
  } catch {
    return { reconnu: false, joignable: false, droits: null };
  }
  if (reponse.status >= 500) return { reconnu: false, joignable: false, droits: null };
  if (!reponse.ok) return { reconnu: false, droits: null };
  const utilisateur = (await reponse.json().catch(() => ({}))) as { owned_private_repos?: number; total_private_repos?: number };
  const droits = droitsDeLEntete(reponse.headers.get('x-oauth-scopes'));
  const lecture: LectureDuJetonGithub = {
    reconnu: true,
    droits,
    privesPossedes:
      typeof utilisateur.owned_private_repos === 'number'
        ? utilisateur.owned_private_repos
        : typeof utilisateur.total_private_repos === 'number'
          ? utilisateur.total_private_repos
          : undefined,
  };
  // Un jeton classique dit ses droits : la sonde ne sert qu'aux jetons à grain fin.
  if (droits === null) {
    try {
      const sonde = await requete('https://api.github.com/user/repos?visibility=private&per_page=1', {
        headers: entetes,
        signal: AbortSignal.timeout(15000),
      });
      const liste = sonde.ok ? ((await sonde.json().catch(() => [])) as unknown[]) : [];
      lecture.privesVisibles = Array.isArray(liste) ? liste.length : 0;
    } catch {
      return { reconnu: false, joignable: false, droits: null };
    }
  }
  return lecture;
}

/**
 * RELIE GITHUB PAR UN JETON D'ACCÈS. Le jeton est d'abord LU auprès de GitHub :
 * un jeton qui ne verrait pas les dépôts privés est refusé sans rien
 * enregistrer (`refusDuJetonGithub`). Puis il entre par l'entrée standard de
 * l'outil, jamais par sa ligne de commande (visible de tout le serveur), et git
 * est réglé pour s'en servir : un dépôt privé se clone ensuite sans rien demander.
 */
export async function connecterGitHub(
  jeton: string,
  requete: typeof fetch = fetch,
): Promise<EtatGitHub & { erreur?: string; lienDuJeton?: string }> {
  const propre = jeton.trim();
  if (!propre) return { ...(await etatGitHub()), erreur: 'Le jeton est vide.' };
  const refus = refusDuJetonGithub(await lireLeJeton(propre, requete));
  if (refus) {
    const mauvaisDroits = refus === REFUS_JETON_SANS_DEPOTS_PRIVES || refus === REFUS_JETON_SANS_WORKFLOW;
    return { ...(await etatGitHub()), erreur: refus, ...(mauvaisDroits ? { lienDuJeton: ADRESSE_D_UN_JETON_CLASSIQUE } : {}) };
  }
  const erreur = await new Promise<string | null>((resolve) => {
    const enfant = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token'], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: environnementSansJeton(),
    });
    let sortie = '';
    enfant.stderr.on('data', (d) => (sortie += String(d)));
    enfant.on('error', (err) => resolve(err.message));
    enfant.on('close', (code) => resolve(code === 0 ? null : sortie.trim().slice(0, 300) || `gh a rendu ${code}`));
    enfant.stdin.end(`${propre}\n`);
  });
  if (erreur) return { ...(await etatGitHub()), erreur };
  await execFileAsync('gh', ['auth', 'setup-git'], { timeout: 20000 }).catch(() => undefined);
  oublierLeJetonGithub();
  return etatGitHub();
}

/* ------------------------------------------------------------------ */
/* GitHub : la page des réglages                                        */
/* ------------------------------------------------------------------ */

/** Un compte GitHub connu de l'outil, tel que la page des réglages le montre. */
export interface CompteGithubConnu {
  login: string;
  actif: boolean;
  /** D'où vient son jeton : « environnement du service » ou le fichier de l'outil. */
  source: 'environnement' | 'outil';
  /** Les droits du jeton (vide : inconnus, jeton à grain fin ou d'application). */
  droits: string[];
  /** Le jeton est-il encore accepté par GitHub ? */
  valide: boolean;
}

export interface DetailGithub extends EtatGitHub {
  version?: string;
  comptes: CompteGithubConnu[];
  /** Le dossier où l'outil garde sa connexion, pour qui veut la voir sans l'écran. */
  dossierDeConfiguration: string;
  /** Le compte système du service : c'est sous lui que l'outil se règle en ligne de commande. */
  compteDuService: string;
  /** Les projets de la colonne de gauche récupérés depuis GitHub. */
  projets: { id: string; nom: string; depot: string; dossier: string }[];
}

/**
 * TOUT CE QUE LA PAGE « GITHUB » DES RÉGLAGES MONTRE : le compte relié, d'où
 * vient son jeton et ses droits, l'outil, et les projets récupérés depuis
 * GitHub. Lecture seule.
 */
export async function detailGithub(): Promise<DetailGithub> {
  const etat = await etatGitHub();
  const dossierDeConfiguration = process.env.GH_CONFIG_DIR || path.join(os.homedir(), '.config', 'gh');
  const projets = store
    .listProjects(false)
    .filter((projet) => /github\.com[/:]/i.test(projet.gitRemote ?? ''))
    .map((projet) => ({
      id: projet.id,
      nom: projet.name,
      depot: (projet.gitRemote ?? '').replace(/^.*github\.com[/:]/i, '').replace(/\.git$/, ''),
      dossier: projet.path,
    }));
  const base: DetailGithub = { ...etat, comptes: [], dossierDeConfiguration, compteDuService: compteDuService(), projets };
  if (!etat.installe) return base;
  try {
    const { stdout } = await execFileAsync('gh', ['--version'], { timeout: 10000 });
    base.version = stdout.split('\n')[0]?.replace(/^gh version\s*/, '').trim();
  } catch {
    /* la version reste inconnue */
  }
  try {
    // L'état se lit même quand un jeton est refusé : la sortie est alors sur le code 1.
    const sortie = await execFileAsync('gh', ['auth', 'status', '--json', 'hosts'], { timeout: 20000 }).then(
      (r) => r.stdout,
      (err: any) => String(err?.stdout ?? ''),
    );
    const lu = JSON.parse(sortie || '{}') as { hosts?: Record<string, Array<Record<string, any>>> };
    base.comptes = (lu.hosts?.['github.com'] ?? []).map((compte) => ({
      login: String(compte.login ?? ''),
      actif: compte.active === true,
      source: /TOKEN/.test(String(compte.tokenSource ?? '')) ? 'environnement' : 'outil',
      droits: String(compte.scopes ?? '')
        .split(',')
        .map((droit) => droit.trim())
        .filter(Boolean),
      valide: compte.state === 'success',
    }));
  } catch {
    /* outil trop ancien pour `--json` : l'état simple suffit */
  }
  return base;
}

/**
 * RÉINITIALISE LA CONNEXION GITHUB : chaque compte rangé par l'outil est
 * déconnecté, et la valeur gardée en mémoire oubliée. On relie ensuite GitHub
 * de nouveau, par code ou par jeton. Un jeton posé dans l'ENVIRONNEMENT du
 * service ne s'efface pas d'ici : on le dit, avec l'endroit où il vit.
 */
export async function reinitialiserGithub(): Promise<{ ok: boolean; texte: string; detail: DetailGithub }> {
  annulerLaConnexionParCode();
  const avant = await detailGithub();
  const comptesRanges = avant.comptes.filter((compte) => compte.source === 'outil');
  const refus: string[] = [];
  for (const compte of comptesRanges) {
    try {
      await execFileAsync('gh', ['auth', 'logout', '--hostname', 'github.com', '--user', compte.login], {
        timeout: 20000,
        env: environnementSansJeton(),
      });
    } catch (err: any) {
      refus.push(`${compte.login} : ${String(err?.stderr ?? err?.message ?? err).trim().slice(0, 160)}`);
    }
  }
  oublierLeJetonGithub();
  const detail = await detailGithub();
  diffuserLaConnexion();
  log.info(`installation : connexion GitHub réinitialisée (${comptesRanges.length} compte(s) déconnecté(s))`);
  if (refus.length) return { ok: false, texte: `La déconnexion a été refusée pour ${refus.join(' ; ')}.`, detail };
  if (detail.comptes.some((compte) => compte.source === 'environnement')) {
    return {
      ok: false,
      texte:
        'Le jeton rangé par l’outil GitHub est retiré, mais un autre jeton est posé dans l’environnement du service (variable GH_TOKEN ou GITHUB_TOKEN) : retirez-le de la configuration du service, puis redémarrez-le.',
      detail,
    };
  }
  return { ok: true, texte: comptesRanges.length ? 'Le jeton est retiré : reliez GitHub de nouveau ci-dessus.' : 'Aucun jeton n’était rangé sur ce serveur.', detail };
}

/* ------------------------------------------------------------------ */
/* GitHub : la connexion par code                                       */
/* ------------------------------------------------------------------ */

/*
 * LA CONNEXION PAR CODE, SANS JETON À COLLER. Le démon lance l'outil GitHub en
 * tâche de fond ; l'outil écrit un code à usage unique, puis interroge GitHub
 * jusqu'à ce que quelqu'un l'accepte sur https://github.com/login/device.
 *
 *  - UNE SEULE À LA FOIS : un second clic pendant l'attente rend le MÊME code ;
 *  - BORNÉE : le code meurt au bout de quinze minutes, l'enfant aussi — il ne
 *    sonde jamais GitHub à l'infini ;
 *  - LA FIN SE DIT : à la sortie de l'outil, git est réglé (`auth setup-git`)
 *    et l'événement `installation.github` prévient tous les écrans, qui
 *    relisent l'état et passent au vert d'eux-mêmes.
 */
let connexionParCode: (ConnexionGithubParCode & { enfant?: ChildProcess }) | null = null;

function diffuserLaConnexion(): void {
  bus.emit({ type: 'installation.github', connexion: connexionGithubParCode() });
}

/** Où en est la connexion par code — sans l'enfant, qui ne voyage pas. */
export function connexionGithubParCode(): ConnexionGithubParCode {
  if (!connexionParCode) return { etat: 'aucune' };
  const { enfant: _enfant, ...visible } = connexionParCode;
  return visible;
}

/** Arrête l'attente en cours (nouvel essai, abandon) : l'enfant ne reste jamais seul derrière. */
export function annulerLaConnexionParCode(): ConnexionGithubParCode {
  if (connexionParCode?.etat === 'attente') {
    connexionParCode.enfant?.kill('SIGTERM');
    connexionParCode = null;
  }
  return connexionGithubParCode();
}

/**
 * LANCE LA CONNEXION PAR CODE et rend le code dès que l'outil l'a écrit (au
 * plus vingt secondes). `programme` se remplace dans un essai.
 */
export async function lancerLaConnexionParCode(programme = 'gh'): Promise<ConnexionGithubParCode> {
  if (connexionParCode?.etat === 'attente' && (connexionParCode.expireA ?? 0) > Date.now()) return connexionGithubParCode();
  annulerLaConnexionParCode();

  let enfant: ChildProcess;
  try {
    enfant = spawn(
      programme,
      ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--scopes', DROITS_GITHUB_DEMANDES.join(',')],
      { stdio: ['ignore', 'pipe', 'pipe'], env: environnementSansJeton() },
    );
  } catch (err: any) {
    return { etat: 'echouee', erreur: String(err?.message ?? err) };
  }
  const courante: ConnexionGithubParCode & { enfant?: ChildProcess } = { etat: 'attente', enfant };
  connexionParCode = courante;

  let sortie = '';
  const premierCode = new Promise<void>((resolve) => {
    const lire = (morceau: Buffer) => {
      sortie += String(morceau);
      if (courante.code) return;
      const lu = codeDeConnexionLu(sortie);
      if (!lu) return;
      courante.code = lu.code;
      courante.adresse = lu.adresse;
      courante.expireA = Date.now() + DUREE_DU_CODE_GITHUB_MS;
      resolve();
    };
    enfant.stdout?.on('data', lire);
    enfant.stderr?.on('data', lire);
    setTimeout(resolve, 20_000);
  });

  const garde = setTimeout(() => {
    if (connexionParCode !== courante || courante.etat !== 'attente') return;
    enfant.kill('SIGTERM');
    courante.etat = 'expiree';
    courante.erreur = 'Le code a expiré avant d’être accepté sur GitHub : recommencez.';
    delete courante.enfant;
    diffuserLaConnexion();
  }, DUREE_DU_CODE_GITHUB_MS + 30_000);

  enfant.on('error', (err) => {
    clearTimeout(garde);
    if (connexionParCode !== courante) return;
    courante.etat = 'echouee';
    courante.erreur = /ENOENT/.test(err.message) ? 'L’outil GitHub n’est pas installé sur ce serveur.' : err.message;
    delete courante.enfant;
    diffuserLaConnexion();
  });
  enfant.on('close', (code) => {
    clearTimeout(garde);
    if (connexionParCode !== courante || courante.etat !== 'attente') return;
    delete courante.enfant;
    void (async () => {
      if (code === 0) {
        await execFileAsync('gh', ['auth', 'setup-git'], { timeout: 20000 }).catch(() => undefined);
        oublierLeJetonGithub();
        const etat = await etatGitHub();
        courante.etat = etat.connecte ? 'reussie' : 'echouee';
        courante.compte = etat.compte;
        if (!etat.connecte) courante.erreur = 'GitHub a accepté, mais le serveur ne voit toujours pas le compte : recommencez.';
        log.info(`installation : GitHub relié par code${etat.compte ? ` au compte ${etat.compte}` : ''}`);
      } else {
        courante.etat = 'echouee';
        const derniere = sortie.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
        courante.erreur = /expired|timed out/i.test(sortie)
          ? 'Le code a expiré avant d’être accepté sur GitHub : recommencez.'
          : /denied|cancel/i.test(sortie)
            ? 'La connexion a été refusée sur GitHub.'
            : `La connexion n’a pas abouti${derniere ? ` : ${derniere.slice(0, 200)}` : '.'}`;
      }
      diffuserLaConnexion();
    })();
  });

  await premierCode;
  if (courante.etat === 'attente' && !courante.code) {
    enfant.kill('SIGTERM');
    courante.etat = 'echouee';
    const derniere = sortie.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 240);
    courante.erreur = `L’outil GitHub n’a pas donné de code${derniere ? ` : ${derniere}` : '.'}`;
    delete courante.enfant;
  }
  return connexionGithubParCode();
}

/* ------------------------------------------------------------------ */
/* Les fonctions facultatives                                           */
/* ------------------------------------------------------------------ */

export interface FonctionFacultative {
  id: 'dictee' | 'voix';
  installee: boolean;
  /**
   * La commande, pour qui préfère un terminal : l'écran installe d'un bouton
   * (`installation.installer`) et ne la montre qu'après un échec.
   */
  commande: string;
}

const scriptDuDepot = (nom: string) => `node ${path.join(CONFIG.selfPath, 'scripts', nom)}`;

function fonctionsFacultatives(): FonctionFacultative[] {
  const voix = voiceAvailable();
  return [
    { id: 'dictee', installee: voix.transcribe, commande: scriptDuDepot('installer-transcription.mjs') },
    { id: 'voix', installee: voix.speak, commande: `${scriptDuDepot('installer-transcription.mjs')} && ${scriptDuDepot('installer-voix.mjs')}` },
  ];
}

/* ------------------------------------------------------------------ */
/* L'état d'ensemble                                                    */
/* ------------------------------------------------------------------ */

export interface EtatDeLInstallation {
  /** L'adresse de l'administration est-elle encore l'adresse provisoire ? */
  adresseProvisoire: boolean;
  /** Ce serveur sait-il poser lui-même une adresse dans son reverse-proxy ? */
  reverseProxyGere: boolean;
  ip: string;
  /**
   * Le compte système sous lequel tourne le démon. Un outil de moteur installé
   * sous un AUTRE compte lui reste invisible : l'assistant écrit donc ses
   * commandes d'installation pour celui-ci.
   */
  compte: string;
  github: EtatGitHub;
  secrets: Record<GenreDeSecret, boolean>;
  /** Par où partent les courriels (`null` : rien ne part), et ce qui manque, en une phrase. */
  courriels: { mode: string | null; extinction: string };
  /** Les bibliothèques de compétences déjà importées (identifiants du registre). */
  bibliotheques: string[];
  bibliothequesProposees: typeof BIBLIOTHEQUES_PROPOSEES;
  facultatif: FonctionFacultative[];
  /**
   * LA MÉMOIRE « PAR LE SENS » N'EST PAS UNE OPTION : c'est par elle que Beluga
   * Build retrouve ce qu'il a appris. L'installateur la pose d'office ; ici,
   * l'écran lit si elle est en place — et propose de la réparer sinon.
   */
  memoire: { enPlace: boolean; commande: string };
}

function bibliothequesImportees(): string[] {
  try {
    return Object.keys(registreDepuisTexte(fs.readFileSync(path.join(PATHS.competences, FICHIER_REGISTRE_BIBLIOTHEQUES), 'utf8')));
  } catch {
    return [];
  }
}

function compteDuService(): string {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

export async function etatDeLInstallation(): Promise<EtatDeLInstallation> {
  const [ip, github] = await Promise.all([serverIp().catch(() => ''), etatGitHub()]);
  return {
    adresseProvisoire: adresseEstProvisoire(identiteDInstallation().adressePublique),
    reverseProxyGere: reverseProxyPoseParLInstallateur(),
    ip,
    compte: compteDuService(),
    github,
    secrets: Object.fromEntries(GENRES_DE_SECRET.map((genre) => [genre, Boolean(ficheDuSecret(genre))])) as Record<GenreDeSecret, boolean>,
    courriels: { mode: modeRetenu(), extinction: raisonDeLExtinction() },
    bibliotheques: bibliothequesImportees(),
    bibliothequesProposees: BIBLIOTHEQUES_PROPOSEES,
    facultatif: fonctionsFacultatives(),
    memoire: { enPlace: vectoriseurDisponible(), commande: scriptDuDepot('installer-modele-vecteurs.mjs') },
  };
}

/** Importe une bibliothèque proposée et dit, en une phrase, ce qui est entré. */
export async function importerUneBibliothequeProposee(source: string): Promise<{ ok: boolean; texte: string }> {
  if (!BIBLIOTHEQUES_PROPOSEES.some((b) => b.source === source)) {
    return { ok: false, texte: 'Cette bibliothèque ne fait pas partie de celles proposées.' };
  }
  const bilan = await importerUneBibliotheque({ source });
  if (!bilan.ok) return { ok: false, texte: bilan.erreur ?? 'Import impossible.' };
  const entrees = bilan.creees.length + bilan.misesAJour.length + bilan.inchangees.length;
  return { ok: true, texte: `${entrees} compétence(s) disponibles.` };
}

/** Une page de l'assistant est quittée : faite, ou remise à plus tard. */
export function noterUneEtape(etape: EtapeDeLAssistant, issue: 'faite' | 'passee'): Settings {
  return saveSettings({ assistant: apresEtape(getSettings().assistant, etape, issue, machineHebergee()) });
}
