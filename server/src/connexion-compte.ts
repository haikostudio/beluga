import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import {
  ConnexionCompte,
  EngineId,
  commandeDeConnexion,
  connexionTerminee,
  lireInvite,
  raisonDeSortie,
} from '@haikodev/shared';
import { PATHS } from './config.js';
import { listAccountRecords, saveAccountRecord, refreshQuotas, type AccountRecord } from './accounts.js';
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

interface Tentative {
  vue: ConnexionCompte;
  child: ChildProcess;
  sortie: string;
  minuteur: NodeJS.Timeout;
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

export function demarrerConnexion(opts: { engine: EngineId; accountId?: string; label?: string }): ConnexionCompte {
  const engine: EngineId = opts.engine === 'codex' ? 'codex' : 'claude';

  // Une seule tentative à la fois par compte : deux commandes de connexion dans
  // le même coffre se réécriraient leurs jetons.
  for (const tentative of tentatives.values()) {
    if (!connexionTerminee(tentative.vue) && tentative.vue.accountId && tentative.vue.accountId === opts.accountId) {
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

  const commande = commandeDeConnexion(engine);
  const id = `cnx-${Date.now().toString(36)}-${++compteur}`;
  const vue: ConnexionCompte = {
    id,
    engine,
    accountId: opts.accountId,
    label,
    etape: 'demarrage',
    attendLeCode: false,
    commenceeA: Date.now(),
  };

  let child: ChildProcess;
  try {
    child = spawn(commande.commande, commande.args, {
      cwd: configDir,
      env: {
        ...process.env,
        [commande.variableDossier]: configDir,
        // Le moteur ne doit pas essayer d'ouvrir un navigateur : il n'y en a pas
        // sur le serveur, et c'est l'utilisateur qui ouvrira l'adresse chez lui.
        BROWSER: 'true',
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    const fin = raisonDeSortie({ code: null, introuvable: true });
    const echec: ConnexionCompte = { ...vue, etape: 'echec', message: fin.message, finieA: Date.now() };
    log.warn('connexion de compte : commande impossible à lancer', err);
    bus.emit({ type: 'connexion-compte', connexion: echec });
    return echec;
  }

  const tentative: Tentative = {
    vue,
    child,
    sortie: '',
    aInscrire,
    minuteur: setTimeout(() => {
      tentative.delaiDepasse = true;
      child.kill('SIGTERM');
    }, DELAI_MS),
  };
  tentatives.set(id, tentative);

  const recevoir = (chunk: Buffer) => {
    tentative.sortie += chunk.toString();
    const invite = lireInvite(tentative.sortie);
    const change =
      invite.lien !== tentative.vue.lien ||
      invite.code !== tentative.vue.code ||
      invite.attendLeCode !== tentative.vue.attendLeCode;
    if (!change) return;
    tentative.vue = {
      ...tentative.vue,
      lien: invite.lien,
      code: invite.code,
      attendLeCode: invite.attendLeCode,
      etape: invite.lien ? 'attente' : tentative.vue.etape,
    };
    diffuser(tentative);
  };
  child.stdout?.on('data', recevoir);
  child.stderr?.on('data', recevoir);

  child.on('error', (err: any) => {
    tentative.sortie += `\n${err?.message ?? err}`;
    if (err?.code === 'ENOENT') tentative.vue = { ...tentative.vue, message: 'introuvable' };
  });

  child.on('close', (code, signal) => {
    clearTimeout(tentative.minuteur);
    void terminer(tentative, code, signal);
  });

  diffuser(tentative);
  return vue;
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

  tentative.vue = {
    ...tentative.vue,
    etape: fin.ok ? 'reussie' : 'echec',
    message: fin.message,
    attendLeCode: false,
    finieA: Date.now(),
  };
  diffuser(tentative);
  if (!fin.ok) log.warn(`connexion de compte refusée (${tentative.vue.label}) : ${fin.message}`);

  // Une tentative finie s'efface au bout d'un moment : elle a été lue à l'écran.
  setTimeout(() => tentatives.delete(tentative.vue.id), 5 * 60 * 1000).unref?.();

  if (!fin.ok) return;

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
  bus.toast('success', `${tentative.vue.label} : compte connecté.`);
}

/** Le code recopié depuis la page part au moteur par son entrée standard. */
export function envoyerCode(id: string, code: string): { ok: boolean; error?: string } {
  const tentative = tentatives.get(id);
  if (!tentative || connexionTerminee(tentative.vue)) return { ok: false, error: 'cette connexion est déjà terminée' };
  if (!tentative.vue.attendLeCode) return { ok: false, error: "ce moteur n'attend aucun code" };
  const propre = code.trim();
  if (!propre) return { ok: false, error: 'aucun code saisi' };
  try {
    tentative.child.stdin?.write(`${propre}\n`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'code non transmis' };
  }
}

export function annulerConnexion(id: string): { ok: boolean; error?: string } {
  const tentative = tentatives.get(id);
  if (!tentative || connexionTerminee(tentative.vue)) return { ok: true };
  tentative.annulee = true;
  tentative.child.kill('SIGTERM');
  return { ok: true };
}

