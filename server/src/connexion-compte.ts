import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import {
  ConnexionCompte,
  EngineId,
  VoieConnexion,
  commandeDeConnexion,
  connexionTerminee,
  lireInvite,
  raisonDeSortie,
  refusCodeAppareil,
  validerAdresseDeRetour,
  messageAdresseRefusee,
  issueDuControle,
  modeleRefuse,
  modeleDeConfig,
  modeleDeRemplacement,
  remplacerModeleDeConfig,
  descriptionMoteur,
  nomCourtDuMoteur,
} from '@beluga/shared';
import { codexAdapter } from './engines/codex.js';
import { PATHS } from './config.js';
import {
  authCodexConnecte,
  coffresCodexAReprendre,
  listAccountRecords,
  listAllAccountRecords,
  saveAccountRecord,
  refreshQuotas,
  type AccountRecord,
} from './accounts.js';
import { relierCompetencesAuxCoffres } from './competences.js';
import { listEngines } from './engines/index.js';
import { bus } from './bus.js';
import { log } from './logger.js';

/**
 * Connecter un compte de moteur SANS ouvrir de terminal.
 *
 * Le serveur lance la commande de connexion du moteur (les règles pures sont
 * dans `shared/src/connexion-compte.ts`) dans le COFFRE du compte — un dossier
 * de configuration par compte, jamais deux comptes dans le même —, lit ce que le
 * moteur écrit, et pousse à l'écran l'adresse et le code à saisir. Rien n'est
 * changé à la façon dont les comptes sont stockés : un compte neuf prend sa
 * place dans `data/accounts/<id>/`, exactement comme un compte déclaré à la
 * main, et n'est INSCRIT qu'une fois la connexion réussie.
 */

/** Au-delà, on abandonne : le code à usage unique des moteurs vit un quart d'heure. */
const DELAI_MS = 15 * 60 * 1000;

/**
 * LE PORT OÙ CODEX ATTEND LE RETOUR D'OPENAI (voie navigateur). Il est FIXE
 * (1455) pour le vrai Codex : une seule connexion par navigateur peut donc
 * tourner sur toute la machine. La variable ne sert qu'aux contrôles, pour ne
 * jamais heurter une vraie connexion.
 */
export function portDeRappel(): number {
  const port = Number(process.env.BELUGA_CODEX_PORT_RAPPEL);
  return Number.isInteger(port) && port > 0 ? port : 1455;
}

/** L'essai réel après connexion ne retient pas l'écran plus longtemps. */
const DELAI_CONTROLE_MS = 60_000;

interface Tentative {
  vue: ConnexionCompte;
  child: ChildProcess;
  sortie: string;
  minuteur: NodeJS.Timeout;
  configDir: string;
  /** Le `state` de l'adresse d'autorisation : jamais à l'écran, jamais au journal. */
  state?: string;
  /** Le compte à inscrire à la réussite, quand il n'existe pas encore. */
  aInscrire?: AccountRecord;
  annulee?: boolean;
  delaiDepasse?: boolean;
}

const tentatives = new Map<string, Tentative>();
let compteur = 0;

export function connexionsEnCours(): ConnexionCompte[] {
  return [...tentatives.values()].map((t) => t.vue);
}

function diffuser(tentative: Tentative): void {
  bus.emit({ type: 'connexion-compte', connexion: tentative.vue });
}

/* ------------------------------------------------------------------ */
/* Le coffre du compte                                                 */
/* ------------------------------------------------------------------ */

/**
 * Un compte neuf reçoit son propre dossier, sur le modèle des comptes de relève
 * déclarés à la main : `data/accounts/<id>/`, avec son `meta.json`. Le dossier
 * est créé tout de suite (le moteur doit avoir où écrire) mais le compte n'est
 * DÉCLARÉ qu'à la réussite — une tentative ratée ne laisse pas un compte
 * fantôme dans la liste.
 */
function coffreNeuf(engine: EngineId, label?: string): { record: AccountRecord; configDir: string } {
  const existants = listAccountRecords().filter((a) => a.engine === engine);
  let numero = existants.length + 1;
  let id = `${engine}-${numero}`;
  while (existants.some((a) => a.id === id) || fs.existsSync(path.join(PATHS.accounts, id))) {
    numero += 1;
    id = `${engine}-${numero}`;
  }
  const configDir = path.join(PATHS.accounts, id);
  fs.mkdirSync(configDir, { recursive: true });
  const nomMoteur = engine === 'codex' ? 'Codex' : 'Claude';
  return {
    configDir,
    record: {
      id,
      engine,
      label: label?.trim() || `${nomMoteur} — compte ${numero}`,
      // La relève passe APRÈS le compte principal : la priorité déclarée ne
      // bouge pas, on se contente de prendre le rang suivant.
      priority: 50 + existants.length,
      configDir,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Lancer, suivre, finir                                               */
/* ------------------------------------------------------------------ */

export async function demarrerConnexion(opts: {
  engine: EngineId;
  accountId?: string;
  label?: string;
  voie?: VoieConnexion;
}): Promise<ConnexionCompte> {
  /*
   * LE MOTEUR VIENT DU COMPTE, et un moteur À CLÉ n'a pas de page de
   * connexion. Autrefois, tout ce qui n'était pas Codex était ramené sur
   * Claude : « Reconnecter » un compte MiMo ou Cursor ouvrait donc la page de
   * connexion de Claude, pour un compte qui n'en a jamais eu. Ces comptes se
   * reconnectent en remplaçant leur clé (`remplacerCleDuCompte`).
   */
  const compteVise = opts.accountId ? listAllAccountRecords().find((a) => a.id === opts.accountId) : undefined;
  const demande = compteVise?.engine ?? opts.engine;
  if (descriptionMoteur(demande)?.connexion !== 'page') {
    throw new Error(`${nomCourtDuMoteur(demande)} se connecte par une clé d'accès, pas par une page de connexion`);
  }
  const engine: EngineId = demande === 'codex' ? 'codex' : 'claude';
  const voie: VoieConnexion = engine === 'codex' && opts.voie === 'navigateur' ? 'navigateur' : 'appareil';

  // Une seule tentative à la fois par compte : deux commandes de connexion dans
  // le même coffre se réécriraient leurs jetons. Une autre VOIE demandée pour
  // le même compte relance la tentative sur cette voie, sans en ouvrir une 2e.
  for (const tentative of tentatives.values()) {
    if (!connexionTerminee(tentative.vue) && tentative.vue.accountId && tentative.vue.accountId === opts.accountId) {
      if (engine === 'codex' && (tentative.vue.voie ?? 'appareil') !== voie) return basculerVoie(tentative.vue.id, voie);
      return tentative.vue;
    }
  }

  let configDir: string;
  let label: string;
  let aInscrire: AccountRecord | undefined;
  if (opts.accountId) {
    const compte = listAccountRecords().find((a) => a.id === opts.accountId);
    if (!compte) throw new Error('compte introuvable');
    configDir = compte.configDir;
    label = compte.label;
  } else {
    const neuf = coffreNeuf(engine, opts.label);
    configDir = neuf.configDir;
    label = neuf.record.label;
    aInscrire = neuf.record;
  }

  const id = `cnx-${Date.now().toString(36)}-${++compteur}`;
  const vue: ConnexionCompte = {
    id,
    engine,
    accountId: opts.accountId,
    label,
    etape: 'demarrage',
    attendLeCode: false,
    commenceeA: Date.now(),
    ...(engine === 'codex' ? { voie } : {}),
  };
  const tentative: Tentative = {
    vue,
    child: undefined as unknown as ChildProcess,
    sortie: '',
    configDir,
    aInscrire,
    minuteur: undefined as unknown as NodeJS.Timeout,
  };
  tentatives.set(id, tentative);
  await lancerProcessus(tentative, voie);
  return tentative.vue;
}

/**
 * CHANGER DE VOIE SANS CHANGER DE TENTATIVE : le moteur en cours est arrêté
 * sans bruit (aucun « échec » à l'écran), et la même tentative — même coffre,
 * même compte à inscrire — repart sur l'autre voie.
 */
export async function basculerVoie(id: string, voie: VoieConnexion): Promise<ConnexionCompte> {
  const tentative = tentatives.get(id);
  if (!tentative || connexionTerminee(tentative.vue)) throw new Error('cette connexion est déjà terminée');
  if (tentative.vue.engine !== 'codex') throw new Error("ce moteur n'a qu'une seule façon de se connecter");
  if ((tentative.vue.voie ?? 'appareil') === voie && tentative.child && tentative.child.exitCode === null) return tentative.vue;
  await arreterSansBruit(tentative);
  await lancerProcessus(tentative, voie);
  return tentative.vue;
}

/** Arrête le moteur d'une tentative sans conclure la tentative elle-même. */
async function arreterSansBruit(tentative: Tentative): Promise<void> {
  const child = tentative.child;
  clearTimeout(tentative.minuteur);
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // L'ancien moteur n'est plus celui de la tentative : sa fin est ignorée.
  tentative.child = undefined as unknown as ChildProcess;
  await new Promise<void>((resolve) => {
    const dur = setTimeout(() => child.kill('SIGKILL'), 3000);
    const garde = setTimeout(resolve, 4000);
    child.once('close', () => {
      clearTimeout(dur);
      clearTimeout(garde);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

/** Quelqu'un écoute-t-il déjà sur ce port local ? */
function portOccupe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const prise = net.connect({ host: '127.0.0.1', port });
    const finir = (occupe: boolean) => {
      prise.destroy();
      resolve(occupe);
    };
    prise.once('connect', () => finir(true));
    prise.once('error', () => finir(false));
    prise.setTimeout(1000, () => finir(false));
  });
}

async function attendreQueLePortSeLibere(port: number, delaiMs: number): Promise<boolean> {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    if (!(await portOccupe(port))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return !(await portOccupe(port));
}

function echouer(tentative: Tentative, message: string): void {
  clearTimeout(tentative.minuteur);
  tentative.vue = { ...tentative.vue, etape: 'echec', message, attendLeCode: false, attendAdresseDeRetour: false, finieA: Date.now() };
  diffuser(tentative);
  setTimeout(() => tentatives.delete(tentative.vue.id), 5 * 60 * 1000).unref?.();
}

async function lancerProcessus(tentative: Tentative, voie: VoieConnexion): Promise<void> {
  const engine = tentative.vue.engine as EngineId;

  /*
   * UNE SEULE CONNEXION PAR NAVIGATEUR SUR TOUTE LA MACHINE : Codex attend le
   * retour d'OpenAI sur un port FIXE. L'ancienne tentative par navigateur est
   * arrêtée (sa tentative conclue « remplacée »), puis on attend que le port se
   * libère ; s'il reste pris (un `codex login` lancé hors de Beluga), on le dit.
   */
  if (voie === 'navigateur') {
    for (const autre of tentatives.values()) {
      if (autre === tentative || connexionTerminee(autre.vue) || autre.vue.voie !== 'navigateur') continue;
      await arreterSansBruit(autre);
      echouer(autre, 'Connexion remplacée par une nouvelle tentative.');
    }
    if (!(await attendreQueLePortSeLibere(portDeRappel(), 4000))) {
      echouer(
        tentative,
        `Une autre connexion occupe déjà le port ${portDeRappel()} du serveur (lancée hors de Beluga ?). Réessayez dans une minute.`,
      );
      return;
    }
  }

  // Abandonnée pendant l'attente du port : rien ne repart.
  if (connexionTerminee(tentative.vue) || tentative.annulee) return;

  const commande = commandeDeConnexion(engine, voie);
  const binaire = engine === 'codex' ? codexAdapter.binary : commande.commande;
  tentative.sortie = '';
  tentative.state = undefined;
  tentative.delaiDepasse = false;
  tentative.vue = {
    ...tentative.vue,
    etape: 'demarrage',
    lien: undefined,
    code: undefined,
    attendLeCode: false,
    message: undefined,
    expireA: Date.now() + DELAI_MS,
    ...(engine === 'codex'
      ? { voie, attendAdresseDeRetour: false, adresseEnvoyeeA: undefined, proposerNavigateur: voie === 'navigateur' ? tentative.vue.proposerNavigateur : false }
      : {}),
  };

  let child: ChildProcess;
  try {
    child = spawn(binaire, commande.args, {
      cwd: tentative.configDir,
      env: {
        ...process.env,
        [commande.variableDossier]: tentative.configDir,
        // Le moteur ne doit pas essayer d'ouvrir un navigateur : il n'y en a pas
        // sur le serveur, et c'est l'utilisateur qui ouvrira l'adresse chez lui.
        BROWSER: 'true',
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    log.warn('connexion de compte : commande impossible à lancer', err?.message ?? err);
    echouer(tentative, raisonDeSortie({ code: null, introuvable: true }).message);
    return;
  }
  tentative.child = child;
  tentative.minuteur = setTimeout(() => {
    if (tentative.child !== child) return;
    tentative.delaiDepasse = true;
    child.kill('SIGTERM');
  }, DELAI_MS);

  const recevoir = (chunk: Buffer) => {
    if (tentative.child !== child) return;
    tentative.sortie += chunk.toString();
    const invite = lireInvite(tentative.sortie);
    if (invite.state) tentative.state = invite.state;
    const attendAdresse = voie === 'navigateur' && Boolean(invite.state);
    const refus = voie === 'appareil' && engine === 'codex' && refusCodeAppareil(tentative.sortie);
    const change =
      invite.lien !== tentative.vue.lien ||
      invite.code !== tentative.vue.code ||
      invite.attendLeCode !== tentative.vue.attendLeCode ||
      (engine === 'codex' && attendAdresse !== Boolean(tentative.vue.attendAdresseDeRetour)) ||
      (refus && !tentative.vue.proposerNavigateur);
    if (!change) return;
    tentative.vue = {
      ...tentative.vue,
      lien: invite.lien,
      code: invite.code,
      attendLeCode: invite.attendLeCode,
      etape: invite.lien ? 'attente' : tentative.vue.etape,
      ...(engine === 'codex' ? { attendAdresseDeRetour: attendAdresse } : {}),
      ...(refus ? { proposerNavigateur: true } : {}),
    };
    diffuser(tentative);
  };
  child.stdout?.on('data', recevoir);
  child.stderr?.on('data', recevoir);

  child.on('error', (err: any) => {
    if (tentative.child !== child) return;
    tentative.sortie += `\n${err?.message ?? err}`;
    if (err?.code === 'ENOENT') tentative.vue = { ...tentative.vue, message: 'introuvable' };
  });

  child.on('close', (code, signal) => {
    if (tentative.child !== child) return;
    clearTimeout(tentative.minuteur);
    /*
     * OPENAI REFUSE LE CODE D'APPAREIL : la tentative ne se conclut pas sur un
     * échec, elle repart d'office sur la voie navigateur — même coffre, même
     * écran —, qui affiche aussitôt « Se connecter à OpenAI ».
     */
    if (engine === 'codex' && voie === 'appareil' && !tentative.annulee && code !== 0 && refusCodeAppareil(tentative.sortie)) {
      log.info(`connexion de compte : code d'appareil refusé par OpenAI, bascule sur la voie navigateur (${tentative.vue.label})`);
      tentative.vue = { ...tentative.vue, proposerNavigateur: true };
      void lancerProcessus(tentative, 'navigateur').catch((err) => echouer(tentative, String(err?.message ?? err)));
      return;
    }
    void terminer(tentative, code, signal);
  });

  diffuser(tentative);
}

/**
 * L'ADRESSE DE LA PAGE D'ERREUR, collée par l'utilisateur (voie navigateur).
 * Elle n'est rejouée que si elle porte le `state` de la tentative EN COURS ; le
 * serveur l'envoie alors à SON port local, où Codex attend, puis laisse la fin
 * du moteur conclure la tentative.
 */
export async function recevoirAdresseDeRetour(id: string, adresse: string): Promise<{ ok: boolean; error?: string }> {
  const tentative = tentatives.get(id);
  if (!tentative || connexionTerminee(tentative.vue)) return { ok: false, error: 'Cette connexion est déjà terminée : relancez-la.' };
  if (tentative.vue.voie !== 'navigateur' || !tentative.vue.attendAdresseDeRetour) {
    return { ok: false, error: "Cette connexion n'attend pas d'adresse." };
  }
  const verdict = validerAdresseDeRetour(adresse, tentative.state);
  if (!verdict.ok) return { ok: false, error: messageAdresseRefusee(verdict.raison, verdict.detail) };

  const child = tentative.child;
  tentative.vue = { ...tentative.vue, adresseEnvoyeeA: Date.now() };
  diffuser(tentative);
  try {
    const reponse = await fetch(`http://127.0.0.1:${portDeRappel()}${verdict.chemin}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    // Le moteur a reçu l'adresse : sa fin dira la suite (réussite ou refus).
    if (reponse.status < 400) return { ok: true };
    const corps = (await reponse.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (tentative.child === child && !connexionTerminee(tentative.vue)) {
      tentative.vue = { ...tentative.vue, adresseEnvoyeeA: undefined };
      diffuser(tentative);
    }
    return { ok: false, error: `Le moteur a refusé l'adresse${corps ? ` : ${corps}` : '.'}` };
  } catch (err: any) {
    log.warn(`connexion de compte : retour non rejoué (${tentative.vue.label}) : ${err?.name ?? ''} ${err?.code ?? err?.cause?.code ?? ''}`);
    if (tentative.child === child && !connexionTerminee(tentative.vue)) {
      tentative.vue = { ...tentative.vue, adresseEnvoyeeA: undefined };
      diffuser(tentative);
    }
    return { ok: false, error: "Le moteur n'attend plus de retour sur le serveur : relancez la connexion." };
  }
}

/* ------------------------------------------------------------------ */
/* L'essai réel après connexion (Codex)                                */
/* ------------------------------------------------------------------ */

function essaiCodex(configDir: string): Promise<{ code: number | null; sortie: string; delaiDepasse?: boolean }> {
  return new Promise((resolve) => {
    // Un dossier vide et jetable : l'essai ne lit ni n'écrit aucun projet.
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-essai-codex-'));
    let sortie = '';
    let delaiDepasse = false;
    let minuteur: NodeJS.Timeout | undefined;
    const fin = (code: number | null) => {
      clearTimeout(minuteur);
      fs.rmSync(dossier, { recursive: true, force: true });
      resolve({ code, sortie, delaiDepasse });
    };
    let child: ChildProcess;
    try {
      child = spawn(codexAdapter.binary, ['exec', '--skip-git-repo-check', 'Réponds uniquement: OK'], {
        cwd: dossier,
        env: { ...process.env, CODEX_HOME: configDir, NO_COLOR: '1', BROWSER: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      sortie = String(err?.message ?? err);
      fin(null);
      return;
    }
    minuteur = setTimeout(() => {
      delaiDepasse = true;
      child.kill('SIGKILL');
    }, DELAI_CONTROLE_MS);
    child.stdout?.on('data', (c: Buffer) => (sortie += c.toString()));
    child.stderr?.on('data', (c: Buffer) => (sortie += c.toString()));
    child.on('error', (err) => (sortie += `\n${err.message}`));
    child.on('close', (code) => fin(code));
  });
}

/**
 * LE COMPTE RÉPOND-IL VRAIMENT ? Un vrai petit tour de Codex dans le coffre du
 * compte. Si le modèle réglé dans le coffre (`config.toml`) est refusé, il est
 * remplacé par le premier modèle proposé de la liste que Codex garde
 * (`models_cache.json`), et l'essai est rejoué UNE fois. Seul ce réglage du
 * coffre est touché : jamais les modèles choisis pour les agents ou les cartes.
 */
export async function controleReelCodex(configDir: string): Promise<{ ok: boolean; message: string }> {
  let essai = await essaiCodex(configDir);
  let issue = issueDuControle(essai);
  if (issue.ok || !modeleRefuse(essai.sortie)) return issue;

  const fichierConfig = path.join(configDir, 'config.toml');
  let toml = '';
  try {
    toml = fs.readFileSync(fichierConfig, 'utf8');
  } catch {
    /* pas de réglage : le modèle refusé est celui par défaut du moteur */
  }
  let cache: unknown;
  try {
    cache = JSON.parse(fs.readFileSync(path.join(configDir, 'models_cache.json'), 'utf8'));
  } catch {
    cache = undefined;
  }
  const ancien = modeleDeConfig(toml);
  const nouveau = modeleDeRemplacement(cache, ancien);
  if (!nouveau) return { ok: false, message: `${issue.message} Aucun modèle de remplacement connu pour ce compte.` };
  fs.writeFileSync(fichierConfig, remplacerModeleDeConfig(toml, nouveau));
  log.info(`connexion de compte : modèle du coffre ${ancien ?? '(défaut)'} refusé, remplacé par ${nouveau} (${configDir})`);
  essai = await essaiCodex(configDir);
  issue = issueDuControle(essai);
  const change = `Le modèle du compte${ancien ? ` (${ancien})` : ''} était refusé : remplacé par ${nouveau}.`;
  return { ok: issue.ok, message: `${issue.message} ${change}` };
}

async function terminer(tentative: Tentative, code: number | null, signal: string | null): Promise<void> {
  const introuvable = /ENOENT|introuvable/i.test(tentative.sortie) || tentative.vue.message === 'introuvable';
  const fin = raisonDeSortie({
    code,
    signal,
    texte: tentative.sortie,
    annulee: tentative.annulee,
    delaiDepasse: tentative.delaiDepasse,
    introuvable,
  });

  // Une adresse collée rejouée sur une tentative qui n'attendait plus de retour,
  // ou un port déjà pris : la raison se dit en clair, pas en code de sortie.
  if (!fin.ok && tentative.vue.voie === 'navigateur' && /address already in use|EADDRINUSE|already in use/i.test(tentative.sortie)) {
    fin.message = `Une autre connexion occupe déjà le port ${portDeRappel()} du serveur (lancée hors de Beluga ?). Réessayez dans une minute.`;
  }

  if (fin.ok && tentative.aInscrire) {
    // Le compte n'entre dans la liste qu'une fois connecté pour de bon.
    try {
      fs.writeFileSync(
        path.join(PATHS.accounts, tentative.aInscrire.id, 'meta.json'),
        JSON.stringify(
          { engine: tentative.aInscrire.engine, label: tentative.aInscrire.label, priority: tentative.aInscrire.priority },
          null,
          2,
        ),
      );
    } catch (err) {
      log.warn('connexion de compte : fiche du compte non écrite', err);
    }
    saveAccountRecord(tentative.aInscrire);
  }

  /*
   * LE QUOTA DU COMPTE EST RELU AVANT QUE LA RÉUSSITE NE PARTE. L'écran montre
   * « Connexion réussie » puis rend la ligne habituelle : relue après, elle
   * aurait gardé « session expirée » jusqu'au relevé suivant. Relecture bornée,
   * ciblée sur le compte : une lecture lente ne retient pas le résultat.
   */
  /*
   * « CONNECTÉ » NE SUFFIT PAS : un vrai petit tour du moteur dit s'il RÉPOND.
   * L'écran montre l'essai en cours, puis « Connecté et opérationnel » ou
   * l'erreur exacte — jamais sur la seule présence des identifiants.
   */
  let controle: ConnexionCompte['controle'];
  if (fin.ok && tentative.vue.engine === 'codex') {
    tentative.vue = { ...tentative.vue, controle: 'en-cours', attendAdresseDeRetour: false, attendLeCode: false };
    diffuser(tentative);
    try {
      const issue = await controleReelCodex(tentative.configDir);
      controle = issue.ok ? 'operationnel' : 'echec';
      fin.message = issue.ok ? issue.message : `Compte connecté, mais ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`;
    } catch (err: any) {
      controle = 'echec';
      fin.message = `Compte connecté, mais l'essai du moteur n'a pas pu partir : ${err?.message ?? err}`;
    }
  }

  if (fin.ok) {
    try {
      const cible = tentative.vue.accountId ?? tentative.aInscrire?.id;
      const relue = await Promise.race([
        refreshQuotas(true, cible ? [cible] : undefined),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000).unref?.()),
      ]);
      if (relue) bus.emit({ type: 'quotas', quotas: relue });
    } catch (err) {
      log.warn('connexion de compte : quota non relu', err);
    }
  }

  tentative.vue = {
    ...tentative.vue,
    etape: fin.ok ? 'reussie' : 'echec',
    message: fin.message,
    attendLeCode: false,
    finieA: Date.now(),
    ...(tentative.vue.engine === 'codex' ? { attendAdresseDeRetour: false, controle } : {}),
  };
  diffuser(tentative);
  if (fin.ok) log.info(`connexion de compte réussie (${tentative.vue.label})`);
  else log.warn(`connexion de compte refusée (${tentative.vue.label}) : ${fin.message}`);

  // Une tentative finie s'efface au bout d'un moment : elle a été lue à l'écran.
  setTimeout(() => tentatives.delete(tentative.vue.id), 5 * 60 * 1000).unref?.();

  if (!fin.ok) return;

  // Un coffre neuf n'a aucune compétence : sans ce geste, le premier agent
  // lancé sur ce compte ne saurait plus faire ce que les autres savent.
  try {
    relierCompetencesAuxCoffres();
  } catch (err) {
    log.warn('connexion de compte : compétences partagées non posées', err);
  }

  // Une connexion réussie rafraîchit aussitôt ce qui en dépend : le catalogue
  // des modèles (qui tombait sur sa liste de secours) et le quota du compte.
  try {
    const engines = await listEngines(true);
    bus.emit({ type: 'engines', engines });
  } catch (err) {
    log.warn('connexion de compte : catalogue des modèles non rafraîchi', err);
  }
  try {
    bus.emit({ type: 'quotas', quotas: await refreshQuotas(true) });
  } catch (err) {
    log.warn('connexion de compte : quota non rafraîchi', err);
  }
  bus.toast(
    controle === 'echec' ? 'error' : 'success',
    controle ? `${tentative.vue.label} : ${fin.message}` : `${tentative.vue.label} : compte connecté.`,
  );
}

/** Le code recopié depuis la page part au moteur par son entrée standard. */
export function envoyerCode(id: string, code: string): { ok: boolean; error?: string } {
  const tentative = tentatives.get(id);
  if (!tentative || connexionTerminee(tentative.vue)) return { ok: false, error: 'cette connexion est déjà terminée' };
  if (!tentative.vue.attendLeCode) return { ok: false, error: "ce moteur n'attend aucun code" };
  const propre = code.trim();
  if (!propre) return { ok: false, error: 'aucun code saisi' };
  try {
    tentative.child?.stdin?.write(`${propre}\n`);
    // Le code est parti : la ligne du compte passe au chargement jusqu'à l'issue.
    tentative.vue = { ...tentative.vue, codeEnvoyeA: Date.now(), attendLeCode: false };
    diffuser(tentative);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'code non transmis' };
  }
}

export function annulerConnexion(id: string): { ok: boolean; error?: string } {
  const tentative = tentatives.get(id);
  if (!tentative || connexionTerminee(tentative.vue)) return { ok: true };
  tentative.annulee = true;
  if (tentative.child) tentative.child.kill('SIGTERM');
  else echouer(tentative, raisonDeSortie({ code: null, annulee: true }).message);
  return { ok: true };
}


/* ------------------------------------------------------------------ */
/* Reprendre une connexion trouvée ailleurs                            */
/* ------------------------------------------------------------------ */

const horodatage = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * REPRENDRE, D'UN CLIC, UNE CONNEXION CODEX TROUVÉE DANS UN AUTRE DOSSIER.
 *
 * Les identifiants sont DÉPLACÉS dans le coffre du compte : copiés, puis la
 * source renommée `auth.json.repris-<date>`. Jamais deux dossiers ne détiennent
 * le même jeton de renouvellement — OpenAI le fait tourner à chaque usage, et le
 * premier qui s'en sert couperait l'autre. Seul un dossier que le serveur a
 * lui-même proposé (`coffresCodexAReprendre`) est accepté. Puis l'essai réel.
 */
export async function reprendreConnexion(accountId: string, source: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const compte = listAccountRecords().find((a) => a.id === accountId);
  if (!compte) return { ok: false, error: 'compte introuvable' };
  if (compte.engine !== 'codex') return { ok: false, error: 'seule une connexion Codex se reprend ainsi' };
  if (!coffresCodexAReprendre().includes(source)) {
    return { ok: false, error: "Ce dossier ne détient plus de connexion Codex à reprendre." };
  }
  const cible = path.join(compte.configDir, 'auth.json');
  if (authCodexConnecte(cible)) return { ok: false, error: 'Ce compte a déjà une connexion dans son dossier.' };

  const origine = path.join(source, 'auth.json');
  try {
    fs.mkdirSync(compte.configDir, { recursive: true });
    // Un lien mort (coffre d'un compte de relève) laisse place au vrai fichier.
    fs.rmSync(cible, { force: true });
    fs.copyFileSync(origine, cible);
    fs.chmodSync(cible, 0o600);
    fs.renameSync(origine, `${origine}.repris-${horodatage()}`);
  } catch (err: any) {
    // Rien de moitié : la copie est retirée si la source n'a pas pu être écartée.
    if (fs.existsSync(origine)) fs.rmSync(cible, { force: true });
    return { ok: false, error: `Reprise impossible : ${err?.message ?? err}` };
  }
  log.info(`connexion Codex reprise de ${source} vers le compte ${compte.label}`);

  /*
   * LA REPRISE SE SUIT SUR LA LIGNE DU COMPTE comme une connexion : essai du
   * moteur en cours, puis « Connecté et opérationnel » ou l'erreur exacte. Le
   * bloc de reprise, lui, disparaît dès que le quota relu ne la propose plus.
   */
  const tentative: Tentative = {
    vue: {
      id: `cnx-${Date.now().toString(36)}-${++compteur}`,
      engine: 'codex',
      accountId: compte.id,
      label: compte.label,
      etape: 'attente',
      attendLeCode: false,
      commenceeA: Date.now(),
      controle: 'en-cours',
    },
    child: undefined as unknown as ChildProcess,
    sortie: '',
    configDir: compte.configDir,
    minuteur: undefined as unknown as NodeJS.Timeout,
  };
  tentatives.set(tentative.vue.id, tentative);
  diffuser(tentative);

  const issue = await controleReelCodex(compte.configDir).catch((err: any) => ({
    ok: false,
    message: `L'essai du moteur n'a pas pu partir : ${err?.message ?? err}`,
  }));
  try {
    const relue = await Promise.race([
      refreshQuotas(true, [compte.id]),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000).unref?.()),
    ]);
    if (relue) bus.emit({ type: 'quotas', quotas: relue });
  } catch (err) {
    log.warn('reprise de connexion : quota non relu', err);
  }
  const message = issue.ok ? `Connexion reprise. ${issue.message}` : `Connexion reprise, mais ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`;
  tentative.vue = {
    ...tentative.vue,
    etape: 'reussie',
    controle: issue.ok ? 'operationnel' : 'echec',
    message,
    finieA: Date.now(),
  };
  diffuser(tentative);
  setTimeout(() => tentatives.delete(tentative.vue.id), 5 * 60 * 1000).unref?.();
  bus.toast(issue.ok ? 'success' : 'error', `${compte.label} : ${message}`);
  return { ok: true, message };
}
