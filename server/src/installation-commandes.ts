import { execFile, spawn } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BIBLIOTHEQUES_PROPOSEES,
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
import { enregistrerAcces, listerAcces } from './coffre-fort.js';
import { CONFIG, PATHS } from './config.js';
import { serverIp } from './dns.js';
import { modeRetenu, raisonDeLExtinction } from './envoi-des-courriels.js';
import { SECRETS_DES_FOURNISSEURS } from './fournisseurs-de-noms.js';
import { log } from './logger.js';
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
 * RELIE GITHUB PAR UN JETON D'ACCÈS. Le jeton entre par l'entrée standard de
 * l'outil, jamais par sa ligne de commande (visible de tout le serveur), puis
 * git est réglé pour s'en servir : un dépôt privé se clone ensuite sans rien
 * demander.
 */
export async function connecterGitHub(jeton: string): Promise<EtatGitHub & { erreur?: string }> {
  const propre = jeton.trim();
  if (!propre) return { ...(await etatGitHub()), erreur: 'Le jeton est vide.' };
  const erreur = await new Promise<string | null>((resolve) => {
    const enfant = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token'], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let sortie = '';
    enfant.stderr.on('data', (d) => (sortie += String(d)));
    enfant.on('error', (err) => resolve(err.message));
    enfant.on('close', (code) => resolve(code === 0 ? null : sortie.trim().slice(0, 300) || `gh a rendu ${code}`));
    enfant.stdin.end(`${propre}\n`);
  });
  if (erreur) return { ...(await etatGitHub()), erreur };
  await execFileAsync('gh', ['auth', 'setup-git'], { timeout: 20000 }).catch(() => undefined);
  return etatGitHub();
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
  return saveSettings({ assistant: apresEtape(getSettings().assistant, etape, issue) });
}
