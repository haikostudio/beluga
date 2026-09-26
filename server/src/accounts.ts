import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import {
  compteQuiRecoitLeTravail,
  echeanceDeLaLimite,
  jumeauxParCompte,
  natureParCompte,
  signaturesDeGroupe,
  raisonDuChoix,
  API_CURSOR,
  AccountQuota,
  dossiersDuCoffre,
  marqueDuCoffre,
  EngineId,
  type LienDuCoffre,
  reparationsDuCoffre,
  type EtatSeuilsSemaine,
  compteDeSecours,
  raisonDeRefusCursor,
  doitAlerterEmballement,
  doitAlerterEpuisementProche,
  doitAlerterFinDeFenetre,
  emballementConsommation,
  etatDeConnexion,
  peutRenouvelerLaSession,
  decisionDeRenouvellement,
  enUnSeulVol,
  ligneDeRenouvellement,
  franchissementSemaine,
  historiquePourProfil,
  memeFenetre,
  previsionEpuisement,
  tempsRestant,
} from '@beluga/shared';
import { PATHS, CONFIG } from './config.js';
import { getDb, getMeta, setMeta } from './db.js';
import { comptesEcartesParLimite, effacerLesLimitesLevees, limitesConnues } from './limites-connues.js';
import { dernieresAmorces, quotaHistory, quotaResume, recordQuotaSample, usageDuCompte } from './store.js';
import { bus } from './bus.js';
import { notify } from './notify.js';
import { log } from './logger.js';

/**
 * Les comptes des moteurs (PLAN §13). Chaque compte a SON PROPRE COFFRE : un
 * dossier de configuration isolé. Jamais deux comptes dans le même dossier —
 * ils se déconnecteraient mutuellement en réécrivant leurs jetons.
 */

export interface AccountRecord {
  id: string;
  engine: EngineId;
  label: string;
  plan?: string;
  /** Ordre déclaré : le plus petit passe en premier (x20 avant Pro). */
  priority: number;
  configDir: string;
  disabled?: boolean;
}

const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';

/**
 * Nombre de lectures 401 de suite sur un compte Claude, pour alerter au
 * franchissement plutôt qu'à chaque relevé (un renouvellement en cours
 * en produit un ou deux, sans gravité).
 */
const echecsRenouvellementJeton = new Map<string, number>();

/**
 * Un 401 sur la lecture de quota Claude veut dire un jeton expiré, pas un
 * compte désactivé ni un vrai dépassement de quota (429, traité ailleurs).
 * Un compte peu utilisé peut rester des jours sans qu'aucun agent ne le
 * fasse tourner — donc sans que son jeton se renouvelle jamais tout seul.
 * On force ici le même renouvellement qu'un agent réel déclenche : un
 * appel minimal au CLI dans SON coffre, qui réécrit `.credentials.json`
 * avec un jeton frais via son propre `refresh_token`.
 */
/*
 * ENQUÊTE DU 15/09/2026 (compte Max x20, coupures des 11, 13 et 15/09) : la
 * course entre deux renouvellements du SERVEUR n'est pas la cause — le moteur
 * tient déjà son propre verrou entre processus, et deux coupures sur trois sont
 * tombées sur un compte où rien ne tournait. Le jeton de renouvellement a été
 * REFUSÉ par le fournisseur au premier renouvellement après l'expiration du
 * jeton d'accès, et le moteur a vidé le coffre. Ce qui suit évite pourtant les
 * lancements en double, et surtout TRACE chaque renouvellement : la prochaine
 * coupure se lira dans le journal.
 */
const renouvellementsEnVol = new Map<string, Promise<boolean>>();

/** Le délai laissé au moteur : mesuré à 6-8 s, jamais coupé en plein échange. */
const DELAI_RENOUVELLEMENT_MS = 60_000;

/**
 * Qui travaille sur un compte en ce moment. Branché par l'ordonnanceur
 * (`runtime.ts`), qui importe ce module : l'inverse ferait une boucle.
 */
let agentsDuCompte: (accountId: string) => string[] = () => [];
export function brancherAgentsDuCompte(lire: (accountId: string) => string[]): void {
  agentsDuCompte = lire;
}

function lancerRenouvellement(configDir: string): Promise<{ ok: boolean; raison?: string }> {
  return new Promise((resolve) => {
    const enfant = execFile(
      'claude',
      ['-p', 'ok', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'json'],
      { cwd: configDir, env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }, timeout: DELAI_RENOUVELLEMENT_MS },
      (err: any, stdout) => {
        if (!err) return resolve({ ok: true });
        // La raison utile est dans la réponse JSON du moteur, pas dans stderr.
        let raison = err.killed ? `coupé après ${DELAI_RENOUVELLEMENT_MS / 1000} s` : `code ${err.code ?? '?'}`;
        try {
          const rendu = JSON.parse(String(stdout || '{}'));
          if (typeof rendu?.result === 'string' && rendu.result) raison += ` : ${rendu.result.slice(0, 160)}`;
        } catch {
          /* pas de JSON : la raison courte suffit */
        }
        resolve({ ok: false, raison });
      },
    );
    // Entrée fermée tout de suite : ouverte, le moteur attendait 3 s de plus.
    enfant.stdin?.end();
  });
}

/**
 * Renouveler la session d'un compte Claude, UNE fois à la fois : une demande
 * qui arrive pendant un renouvellement en cours attend son issue et relit le
 * coffre frais, au lieu d'en lancer un second.
 */
export function renouvelerSessionClaude(account: AccountRecord, demandeur: string): Promise<boolean> {
  return enUnSeulVol(renouvellementsEnVol, account.id, async () => {
    const issue = await lancerRenouvellement(account.configDir);
    const coffre = lireCoffreDuCompte(account);
    const ligne = ligneDeRenouvellement({
      compte: account.label,
      demandeur,
      ok: issue.ok,
      raison: issue.raison,
      expireA: coffre.expireA,
      renouvellementExpireA: coffre.renouvellementExpireA,
      coffreVide: coffre.coffreVide,
    });
    if (issue.ok) log.info(ligne);
    else log.warn(ligne);
    return issue.ok;
  });
}

/**
 * Coffres déjà signalés vidés, et comptes vus connectés depuis le démarrage :
 * un coffre vide se signale UNE fois, et n'alerte que s'il marchait avant —
 * pas à chaque redémarrage pour un compte laissé débranché.
 */
const coffresSignalesVides = new Set<string>();
const comptesVusConnectes = new Set<string>();

function signalerCoffreVide(account: AccountRecord): void {
  if (coffresSignalesVides.has(account.id)) return;
  coffresSignalesVides.add(account.id);
  let reecrit = 'inconnue';
  try {
    reecrit = fs.statSync(path.join(account.configDir, '.credentials.json')).mtime.toISOString();
  } catch {
    /* fichier illisible : on le dit « inconnue » */
  }
  const agents = agentsDuCompte(account.id);
  log.warn(
    `session Claude trouvée VIDÉE — ${account.label} : fichier de connexion réécrit à ${reecrit}, ` +
      `agents au travail sur ce compte : ${agents.length ? agents.join(', ') : 'aucun'}`,
  );
  if (!comptesVusConnectes.has(account.id)) return;
  notify({
    motif: 'jeton-claude-bloque',
    title: 'Compte Claude déconnecté',
    body: `${account.label} : la session est tombée, reconnexion nécessaire.`,
    reference: account.id,
  });
}

/**
 * Le compte Cursor né de la clé du serveur. Les autres comptes Cursor sont des
 * comptes de RELÈVE : chacun porte SA clé dans son dossier (`api-key`), sans
 * quoi il n'en a aucune — voir `cleDuCompteCursor`.
 */
export const COMPTE_CURSOR_PRINCIPAL = 'cursor-principal';

/**
 * Les comptes RÉELLEMENT utilisables : un compte coupé à la main (`disabled`)
 * est écarté. C'est la liste que voient l'ordonnanceur, l'amorçage des fenêtres,
 * le catalogue des modèles — partout où un compte éteint ne doit plus servir.
 */
export function listAccountRecords(): AccountRecord[] {
  return listAllAccountRecords().filter((a) => !a.disabled);
}

/**
 * TOUS les comptes déclarés, coupés compris. Sert au volet Quotas, qui garde le
 * compte éteint visible avec son interrupteur, et à la commande qui le coupe.
 */
export function listAllAccountRecords(): AccountRecord[] {
  const rows = getDb().prepare('SELECT data FROM accounts ORDER BY id').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as AccountRecord);
}

/**
 * Coupe ou remet en service un compte. Le réglage est écrit sur le compte, donc
 * il survit à un redémarrage. Rien n'est supprimé : le compte reste déclaré,
 * simplement marqué éteint.
 */
export function setAccountDisabled(id: string, disabled: boolean): AccountRecord | null {
  const account = listAllAccountRecords().find((a) => a.id === id);
  if (!account) return null;
  const updated: AccountRecord = { ...account, disabled };
  saveAccountRecord(updated);
  return updated;
}

/**
 * Renomme un compte : on ne touche QU'au nom affiché (`label`), écrit sur le
 * compte donc durable au redémarrage. Un nom vide (ou fait d'espaces) est
 * refusé — le compte garde son ancien nom et la fonction rend `null`.
 */
export function renameAccount(id: string, label: string): AccountRecord | null {
  const propre = label.trim();
  if (!propre) return null;
  const account = listAllAccountRecords().find((a) => a.id === id);
  if (!account) return null;
  const updated: AccountRecord = { ...account, label: propre };
  saveAccountRecord(updated);
  // Le nom affiché d'un compte vient de son relevé de quota. Un compte dont la
  // lecture est en pause (après un refus 429) repousse tel quel son dernier
  // relevé mémorisé : sans cette mise à jour, il garderait l'ancien nom. On
  // corrige le relevé en cache pour que le nouveau nom remonte AUSSITÔT, même
  // sans nouvelle lecture.
  loadCache();
  const enCache = quotaCache.get(id);
  if (enCache) {
    quotaCache.set(id, { ...enCache, label: propre });
    persistCache();
  }
  return updated;
}

export function saveAccountRecord(account: AccountRecord): void {
  getDb()
    .prepare(
      `INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(account.id, account.engine, JSON.stringify(account), Date.now());
  // Déclarer un compte le fait SORTIR de la liste des retirés : reconnecter un
  // coffre écarté doit le ramener, sans quoi il repartirait au redémarrage.
  oublierLeRetrait(account.id);
}

/* ------------------------------------------------------------------ */
/* Retrait d'un compte                                                 */
/* ------------------------------------------------------------------ */

/**
 * LES COMPTES RETIRÉS À LA MAIN. Effacer la ligne en base NE SUFFIT PAS :
 * `bootstrapAccounts` reconstruit au démarrage tout compte dont le coffre est
 * encore là (`~/.claude/.credentials.json` pour le principal, un `meta.json`
 * pour un compte de relève). Le compte retiré reviendrait donc au premier
 * redémarrage. La liste est écrite en base, elle survit au redémarrage, et
 * l'amorçage la consulte avant de recréer quoi que ce soit.
 */
const CLE_COMPTES_RETIRES = 'accounts.retires';

export function comptesRetires(): string[] {
  try {
    const brut = getMeta(CLE_COMPTES_RETIRES);
    const liste = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? liste.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function noterLeRetrait(id: string): void {
  const liste = comptesRetires();
  if (liste.includes(id)) return;
  setMeta(CLE_COMPTES_RETIRES, JSON.stringify([...liste, id]));
}

function oublierLeRetrait(id: string): void {
  const liste = comptesRetires();
  if (!liste.includes(id)) return;
  setMeta(CLE_COMPTES_RETIRES, JSON.stringify(liste.filter((autre) => autre !== id)));
}

/**
 * RETIRER UN COMPTE, POUR DE BON.
 *
 * Le compte quitte la base, son relevé quitte le cache, son identité quitte la
 * mémoire, et son coffre est MARQUÉ pour que l'amorçage ne le ressuscite pas.
 * Les fichiers d'identifiants, eux, restent sur la machine : le retrait fait
 * disparaître le compte de l'application, il n'efface aucun jeton.
 *
 * DEUX REFUS, dits en clair plutôt que subis : un compte sur lequel un agent
 * travaille, et le dernier compte encore actif de son moteur — le retirer
 * priverait tout le tableau de ce moteur.
 */
export function retirerCompte(
  id: string,
  opts: { comptesOccupes?: readonly string[] } = {},
): { ok: boolean; erreur?: string } {
  const compte = listAllAccountRecords().find((a) => a.id === id);
  if (!compte) return { ok: false, erreur: 'ce compte n’existe plus' };

  if (opts.comptesOccupes?.includes(id)) {
    return { ok: false, erreur: 'un agent travaille sur ce compte en ce moment' };
  }

  const actifsRestants = listAccountRecords().filter((a) => a.engine === compte.engine && a.id !== id);
  if (!actifsRestants.length) {
    return { ok: false, erreur: `c’est le dernier compte ${compte.engine} encore actif` };
  }

  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
  noterLeRetrait(id);
  loadCache();
  quotaCache.delete(id);
  persistCache();
  identitesClaude.delete(id);
  nextTry.delete(id);

  /*
   * LE COFFRE D'UN COMPTE DE RELÈVE PORTE LA MARQUE, en plus de la liste : son
   * `meta.json` dit qu'il est retiré. Deux verrous plutôt qu'un, parce qu'une
   * base restaurée depuis une sauvegarde ancienne ferait sinon revenir le
   * compte sans que rien ne le dise.
   */
  try {
    const metaFile = path.join(PATHS.accounts, id, 'meta.json');
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      fs.writeFileSync(metaFile, JSON.stringify({ ...meta, retire: true, retireLe: Date.now() }, null, 2));
    }
  } catch (err: any) {
    log.warn(`retrait du compte ${id} : le coffre n’a pas pu être marqué`, err?.message ?? err);
  }

  log.info(`compte retiré : ${compte.label} (${id})`);
  return { ok: true };
}

/** Déclare les comptes déjà authentifiés sur le serveur au premier démarrage. */
export function bootstrapAccounts(): void {
  // On compte les comptes DÉJÀ connus sur la liste COMPLÈTE : un compte coupé à
  // la main (`disabled`) est bien connu, il ne doit surtout pas être reconstruit
  // à neuf — cela effacerait son drapeau et le rallumerait au redémarrage.
  const knownIds = new Set(listAllAccountRecords().map((account) => account.id));
  // UN COMPTE RETIRÉ NE REVIENT PAS. Son coffre est toujours sur le disque :
  // sans cette liste, l'amorçage le recréerait à chaque redémarrage.
  const retires = new Set(comptesRetires());
  const dejaVu = (id: string) => knownIds.has(id) || retires.has(id);
  const home = CONFIG.homeDir || os.homedir();

  const claudeDir = path.join(home, '.claude');
  if (!dejaVu('claude-principal') && fs.existsSync(path.join(claudeDir, '.credentials.json'))) {
    saveAccountRecord({
      id: 'claude-principal',
      engine: 'claude',
      label: 'Claude — compte principal',
      plan: readClaudePlan(claudeDir),
      priority: 10,
      configDir: claudeDir,
    });
  }

  const codexDir = path.join(home, '.codex');
  if (!dejaVu('codex-principal') && fs.existsSync(path.join(codexDir, 'auth.json'))) {
    saveAccountRecord({
      id: 'codex-principal',
      engine: 'codex',
      label: 'Codex — compte principal',
      priority: 10,
      configDir: codexDir,
    });
  }

  /*
   * CURSOR n'a pas de coffre à jetons sur la machine : sa clé vit hors du dépôt
   * (`CURSOR_API_KEY`, fichier d'environnement du service). Le compte n'est donc
   * déclaré que si la clé est là — sinon le moteur n'apparaît nulle part, ce qui
   * est exactement le comportement voulu.
   */
  if (!dejaVu(COMPTE_CURSOR_PRINCIPAL) && (process.env.CURSOR_API_KEY ?? '').trim()) {
    saveAccountRecord({
      id: COMPTE_CURSOR_PRINCIPAL,
      engine: 'cursor',
      label: 'Cursor — compte principal',
      priority: 10,
      configDir: path.join(PATHS.accounts, COMPTE_CURSOR_PRINCIPAL),
    });
  }

  // Les comptes de relève déclarés à la main dans data/accounts/<id>/
  try {
    for (const entry of fs.readdirSync(PATHS.accounts, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaFile = path.join(PATHS.accounts, entry.name, 'meta.json');
      if (!fs.existsSync(metaFile)) continue;
      if (dejaVu(entry.name)) continue;
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      // Le coffre porte lui-même la marque du retrait : deux verrous, pour
      // qu'une base restaurée d'hier ne fasse pas revenir un compte écarté.
      if (meta?.retire) continue;
      const accountDir = path.join(PATHS.accounts, entry.name);
      const configuredDir = typeof meta.configDir === 'string' ? meta.configDir.trim() : '';
      const configDir = configuredDir
        ? path.isAbsolute(configuredDir)
          ? configuredDir
          : path.resolve(accountDir, configuredDir)
        : accountDir;
      saveAccountRecord({
        id: entry.name,
        engine: meta.engine ?? 'claude',
        label: meta.label ?? entry.name,
        // Le « plan » ne se lit que sur un coffre Claude : les autres moteurs
        // n'en ont pas, et aller y chercher un fichier absent n'apprend rien.
        plan: meta.plan ?? ((meta.engine ?? 'claude') === 'claude' ? readClaudePlan(configDir) : undefined),
        priority: meta.priority ?? 50,
        configDir,
      });
      knownIds.add(entry.name);
    }
  } catch {
    /* aucun compte de relève */
  }

  // Au démarrage déjà, pas seulement au premier lancement : un coffre dont les
  // liens sont morts prive TOUS les agents de leur liste de sous-tâches.
  for (const compte of listAllAccountRecords()) {
    reparerLeCoffreDuCompte(compte.configDir, compte.engine);
  }
}

/**
 * REMET LE COFFRE D'UN COMPTE MOTEUR D'APLOMB — CLAUDE COMME CODEX.
 *
 * Les liens du coffre portent un chemin absolu vers le compte principal. Le
 * dossier personnel déménage (compte système renommé) et ils deviennent morts,
 * sans un mot : Claude n'écrit alors plus sa liste de tâches et les trois
 * affichages d'avancement s'éteignent ; Codex, lui, perd son `auth.json` et ne
 * s'authentifie plus. On rapatrie donc ces liens vers le dossier personnel
 * d'aujourd'hui, et on s'assure que les dossiers dont ce moteur a besoin
 * existent (`tasks/` pour Claude, rien pour Codex).
 *
 * CURSOR n'a pas de coffre — sa clé voyage par l'environnement : la fonction
 * repart aussitôt, sans rien toucher.
 *
 * Sans bruit quand tout va bien : cette fonction part à CHAQUE lancement.
 */
export function reparerLeCoffreDuCompte(configDir: string, moteur: string): number {
  if (!marqueDuCoffre(moteur)) return 0;
  const home = CONFIG.homeDir || os.homedir();
  let repares = 0;
  try {
    const liens: LienDuCoffre[] = [];
    for (const entree of fs.readdirSync(configDir, { withFileTypes: true })) {
      if (!entree.isSymbolicLink()) continue;
      const chemin = path.join(configDir, entree.name);
      liens.push({
        nom: entree.name,
        cible: fs.readlinkSync(chemin),
        vivant: fs.existsSync(chemin),
      });
    }
    for (const reparation of reparationsDuCoffre(liens, home, moteur)) {
      if (!fs.existsSync(reparation.nouvelleCible)) continue;
      const chemin = path.join(configDir, reparation.nom);
      fs.rmSync(chemin, { force: true });
      fs.symlinkSync(reparation.nouvelleCible, chemin);
      repares += 1;
      log.info(
        `coffre ${path.basename(configDir)} (${moteur}) : lien « ${reparation.nom} » rapatrié (${reparation.ancienneCible} → ${reparation.nouvelleCible})`,
      );
    }
    // Le dossier des tâches de Claude, lui, se recrée même sans lien : c'est
    // lui qui porte la liste de sous-tâches de chaque session.
    for (const dossier of dossiersDuCoffre(moteur)) {
      const chemin = path.join(configDir, dossier);
      if (!fs.existsSync(chemin)) fs.mkdirSync(chemin, { recursive: true });
    }
  } catch {
    /* coffre illisible : le moteur dira lui-même ce qui lui manque. */
  }
  return repares;
}

function readClaudePlan(configDir: string): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf8'));
    const oauth = raw?.claudeAiOauth;
    const tier = typeof oauth?.rateLimitTier === 'string' ? oauth.rateLimitTier : '';
    const subscription = typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : '';
    if (/20/.test(tier)) return 'Max x20';
    if (/max/i.test(tier) || /max/i.test(subscription)) return 'Max';
    if (/pro/i.test(subscription)) return 'Pro';
    return subscription || tier || undefined;
  } catch {
    /* plan inconnu */
  }
  return undefined;
}

/**
 * Prépare l'environnement d'un lancement : un compte, un dossier. Cursor n'a
 * pas de coffre sur la machine — il n'a qu'une CLÉ, qui voyage de la même
 * façon : le moteur ne lit jamais un compte, il lit son environnement.
 */
export function applyAccountEnv(account: AccountRecord): Record<string, string> {
  // Le coffre est remis d'aplomb AVANT chaque lancement : un lien mort
  // (`tasks` chez Claude, `auth.json` chez Codex) ne se voit pas dans Beluga Build,
  // il fait juste échouer en silence (`shared/src/coffre-du-compte.ts`). Cursor
  // n'a pas de coffre : l'appel repart aussitôt.
  reparerLeCoffreDuCompte(account.configDir, account.engine);

  if (account.engine === 'claude') {
    return { CLAUDE_CONFIG_DIR: account.configDir };
  }
  if (account.engine === 'cursor') {
    const cle = cleDuCompteCursor(account);
    return cle ? { CURSOR_API_KEY: cle } : {};
  }
  return { CODEX_HOME: account.configDir };
}

/* ------------------------------------------------------------------ */
/* Lecture des quotas                                                  */
/* ------------------------------------------------------------------ */

const quotaCache = new Map<string, AccountQuota>();
let lastFetch = 0;

/**
 * QUAND CHAQUE COMPTE A ÉTÉ LU POUR LA DERNIÈRE FOIS.
 *
 * `lastFetch` ne dit que le dernier relevé GÉNÉRAL : un relevé CIBLÉ ne le pose
 * pas (il gèlerait des comptes que personne n'a interrogés). Résultat, deux
 * relevés ciblés qui se suivent — la porte dure du lancement, puis le choix du
 * compte quelques secondes plus tard — repayaient tous les deux la même lecture
 * dans le même lancement. Chaque compte porte donc SA date de lecture, et un
 * relevé ciblé dont tous les comptes viennent d'être lus se contente du cache.
 */
const derniereLecture = new Map<string, number>();

/** Fenêtre de validité d'un relevé : au-delà, on redemande. */
const CACHE_MS = 5 * 60 * 1000;

/**
 * Le dernier relevé connu est conservé en base : un redémarrage du démon ne
 * doit pas faire retomber les jauges à zéro, et l'API de quota n'aime pas
 * qu'on l'interroge trop souvent.
 */
function loadCache(): void {
  if (quotaCache.size) return;
  try {
    const raw = getMeta('quotas.last');
    if (!raw) return;
    for (const entry of JSON.parse(raw)) {
      const quota = AccountQuota.parse(entry);
      quotaCache.set(quota.id, quota);
    }
  } catch {
    /* relevé illisible : on repartira d'une lecture */
  }
}

function persistCache(): void {
  try {
    setMeta('quotas.last', JSON.stringify([...quotaCache.values()]));
  } catch {
    /* la persistance du relevé ne doit jamais bloquer */
  }
}

/**
 * QUI EST DERRIÈRE CE COFFRE — LU, JAMAIS DÉDUIT.
 *
 * Le relevé de quota (`/api/oauth/usage`) ne dit RIEN de l'identité du compte :
 * deux coffres branchés au même abonnement rendent deux relevés identiques, et
 * l'application ne pouvait que le SUPPOSER en comparant des pourcentages. Le
 * profil (`/api/oauth/profile`), lui, rend l'identifiant du compte, son adresse
 * et le palier réel de l'abonnement — la preuve directe.
 *
 * L'identité ne bouge pas d'une heure à l'autre : elle est gardée en mémoire et
 * relue seulement quand elle vieillit ou quand le JETON change (une reconnexion
 * peut brancher le coffre ailleurs). Son échec n'a AUCUNE conséquence : pas de
 * profil, pas d'identité, le relevé reste servi tel quel.
 */
const identitesClaude = new Map<string, { identite: NonNullable<AccountQuota['identite']>; jeton: string }>();
const IDENTITE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * LE PALIER TEL QUE LE FOURNISSEUR LE NOMME, mis en mots d'ici. Il fait FOI
 * sur le plan deviné dans le coffre (`readClaudePlan`) : un coffre reconnecté
 * garde parfois un `subscriptionType` périmé, et l'écran affichait alors
 * « Claude Pro » sur un abonnement Max x20.
 */
export function palierLisible(tier: string | undefined): string | undefined {
  if (!tier) return undefined;
  if (/20x/i.test(tier)) return 'Max x20';
  if (/5x/i.test(tier)) return 'Max x5';
  if (/max/i.test(tier)) return 'Max';
  if (/pro/i.test(tier)) return 'Pro';
  if (/team|enterprise/i.test(tier)) return tier.replace(/_/g, ' ');
  if (/free|default/i.test(tier)) return undefined;
  return tier.replace(/_/g, ' ');
}

async function lireIdentiteClaude(
  account: AccountRecord,
  token: string,
): Promise<NonNullable<AccountQuota['identite']> | undefined> {
  const connu = identitesClaude.get(account.id);
  if (connu && connu.jeton === token && Date.now() - (connu.identite.luA ?? 0) < IDENTITE_TTL_MS) {
    return connu.identite;
  }
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/profile', {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': CLAUDE_OAUTH_BETA,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return connu?.identite;
    const data: any = await res.json();
    const compteFournisseur = typeof data?.account?.uuid === 'string' ? data.account.uuid : undefined;
    if (!compteFournisseur) return connu?.identite;
    const identite = {
      compteFournisseur,
      adresse: typeof data?.account?.email === 'string' ? data.account.email : undefined,
      nom:
        typeof data?.account?.display_name === 'string'
          ? data.account.display_name
          : typeof data?.account?.full_name === 'string'
            ? data.account.full_name
            : undefined,
      organisation: typeof data?.organization?.uuid === 'string' ? data.organization.uuid : undefined,
      palier: palierLisible(data?.organization?.rate_limit_tier),
      luA: Date.now(),
    };
    identitesClaude.set(account.id, { identite, jeton: token });
    return identite;
  } catch {
    // Une identité déjà lue vaut mieux qu'un vide : on garde la dernière connue.
    return connu?.identite;
  }
}

async function fetchClaudeQuota(account: AccountRecord): Promise<AccountQuota> {
  const base: AccountQuota = {
    id: account.id,
    engine: 'claude',
    label: account.label,
    plan: account.plan,
    priority: account.priority,
    active: false,
    available: true,
    fetchedAt: Date.now(),
    // Une lecture qui échoue ne doit pas faire disparaître l'identité déjà lue.
    identite: identitesClaude.get(account.id)?.identite,
  };
  /*
   * LE PLAN SE RELIT À CHAQUE RELEVÉ, il ne se fige plus au premier démarrage.
   *
   * `bootstrapAccounts` lisait le plan UNE FOIS, à la création du compte. Le
   * jour où le coffre est reconnecté sur un autre abonnement — un compte Pro
   * saturé rebranché sur le Max x20, 02/09/2026 —, l'étiquette restait « Pro »
   * alors que le coffre disait « Max x20 ». Or la taille du plan commande la
   * place restante (`placeRestante`, un Pro vaut 1 fenêtre, un Max x20 en vaut
   * 20) : le travail partait donc sur une réserve mal mesurée. Codex fait
   * pareil depuis toujours avec `plan_type`.
   */
  const planLu = readClaudePlan(account.configDir);
  if (planLu && planLu !== account.plan) {
    log.info(`compte ${account.label} : plan relu sur son coffre — « ${account.plan ?? 'inconnu'} » → « ${planLu} »`);
    saveAccountRecord({ ...account, plan: planLu });
    base.plan = planLu;
  }

  try {
    const credFile = path.join(account.configDir, '.credentials.json');
    let raw = JSON.parse(fs.readFileSync(credFile, 'utf8'));
    let token = raw?.claudeAiOauth?.accessToken;
    if (!token) {
      /*
       * DEUX ABSENCES QUI NE SE DISENT PAS PAREIL. Un coffre dont les jetons
       * sont vidés est un compte qui a servi et dont la session est finie : le
       * moteur efface lui-même ses jetons quand le renouvellement expire. Le
       * dire « non connecté » envoyait chercher une installation ratée.
       */
      const vide = !raw?.claudeAiOauth?.refreshToken;
      if (vide) signalerCoffreVide(account);
      return {
        ...base,
        error: vide ? 'session expirée, reconnexion nécessaire' : 'compte non connecté',
        available: false,
      };
    }

    let res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': CLAUDE_OAUTH_BETA,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (res.status === 401) {
      /*
       * Jeton expiré : on force le même renouvellement qu'un agent réel
       * déclenche, puis on relit une seule fois avec le jeton frais. MAIS
       * SEULEMENT S'IL Y A DE QUOI RENOUVELER : sans jeton de renouvellement
       * valide, l'appel au moteur ne peut QUE échouer, et il coûtait trente
       * secondes d'attente à CHAQUE relevé de quota, indéfiniment.
       */
      const decision = decisionDeRenouvellement({
        peutRenouveler: peutRenouvelerLaSession(raw?.claudeAiOauth),
        agentsAuTravail: agentsDuCompte(account.id).length,
      });
      if (decision === 'laisser-aux-agents') {
        // L'agent au travail renouvelle lui-même : ni moteur de plus, ni échec
        // compté, ni « connexion refusée » à l'écran pour un compte qui marche.
        return { ...base, error: 'jeton en cours de renouvellement par un agent au travail' };
      }
      const renouvele = decision === 'forcer' ? await renouvelerSessionClaude(account, 'le relevé de quota') : false;
      if (renouvele) {
        raw = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        token = raw?.claudeAiOauth?.accessToken;
        res = await fetch('https://api.anthropic.com/api/oauth/usage', {
          headers: {
            authorization: `Bearer ${token}`,
            'anthropic-beta': CLAUDE_OAUTH_BETA,
            'content-type': 'application/json',
          },
          signal: AbortSignal.timeout(12000),
        });
      }
      if (res.status === 401) {
        const compte = (echecsRenouvellementJeton.get(account.id) ?? 0) + 1;
        echecsRenouvellementJeton.set(account.id, compte);
        if (compte === 3) {
          log.error(`renouvellement du jeton Claude en échec ${compte} fois de suite sur ${account.label}`);
          notify({
            motif: 'jeton-claude-bloque',
            title: 'Compte Claude bloqué',
            body: `${account.label} : le jeton ne se renouvelle plus, reconnexion nécessaire.`,
            reference: account.id,
          });
        }
      } else {
        echecsRenouvellementJeton.delete(account.id);
      }
    } else {
      echecsRenouvellementJeton.delete(account.id);
    }

    if (!res.ok) return { ...base, error: `lecture impossible (${res.status})` };
    // Le compte répond : un prochain coffre vidé sera une vraie coupure, à signaler.
    comptesVusConnectes.add(account.id);
    coffresSignalesVides.delete(account.id);
    const data: any = await res.json();

    const window = (w: any) =>
      w
        ? {
            usedPct: typeof w.utilization === 'number' ? w.utilization : undefined,
            resetsAt: w.resets_at ? new Date(w.resets_at).getTime() : undefined,
            durationSeconds: typeof w.duration_seconds === 'number' ? w.duration_seconds : undefined,
          }
        : undefined;

    const session = data.five_hour
      ? { ...window(data.five_hour), durationSeconds: 5 * 60 * 60 }
      : undefined;
    const weekly = data.seven_day
      ? { ...window(data.seven_day), durationSeconds: 7 * 24 * 60 * 60 }
      : undefined;
    const exhausted = (weekly?.usedPct ?? 0) >= 100 || (session?.usedPct ?? 0) >= 100;

    /*
     * L'IDENTITÉ EST LUE AVEC LE MÊME JETON, juste après le relevé. Elle voyage
     * avec lui : le badge « même abonnement » cesse d'être une déduction, et le
     * PALIER lu fait foi sur le plan deviné dans le coffre.
     */
    const identite = await lireIdentiteClaude(account, token);
    if (identite?.palier && identite.palier !== base.plan) {
      log.info(
        `compte ${account.label} : palier lu chez le fournisseur — « ${base.plan ?? 'inconnu'} » → « ${identite.palier} »`,
      );
      saveAccountRecord({ ...account, plan: identite.palier });
      base.plan = identite.palier;
    }

    return { ...base, session, weekly, available: !exhausted, identite: identite ?? base.identite };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'lecture impossible' };
  }
}

async function fetchCodexQuota(account: AccountRecord): Promise<AccountQuota> {
  const base: AccountQuota = {
    id: account.id,
    engine: 'codex',
    label: account.label,
    plan: account.plan,
    priority: account.priority,
    active: false,
    available: true,
    fetchedAt: Date.now(),
  };
  try {
    const authFile = path.join(account.configDir, 'auth.json');
    const raw = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const token = raw?.tokens?.access_token ?? raw?.OPENAI_API_KEY;
    if (!token) return { ...base, error: 'compte non connecté', available: false };

    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { authorization: `Bearer ${token}`, originator: 'codex_cli_rs' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ...base, error: `lecture impossible (${res.status})` };
    const data: any = await res.json();
    const win = (w: any) =>
      w
        ? {
            usedPct: w.used_percent ?? undefined,
            resetsAt:
              typeof w.resets_in_seconds === 'number'
                ? Date.now() + w.resets_in_seconds * 1000
                : w.reset_at
                  ? w.reset_at * 1000
                  : undefined,
            durationSeconds: typeof w.limit_window_seconds === 'number' ? w.limit_window_seconds : undefined,
          }
        : undefined;
    // Codex ne garantit PAS que la première fenêtre soit la courte : sur un
    // compte dont la fenêtre courte dort, la seule fenêtre annoncée est celle
    // de la semaine, et elle arrive en première position. On classe donc sur la
    // durée déclarée, sinon l'interface affiche la semaine sous « fenêtre ».
    const fenetres = [data?.rate_limit?.primary_window, data?.rate_limit?.secondary_window].filter(Boolean);
    const courte = (w: any) => typeof w?.limit_window_seconds !== 'number' || w.limit_window_seconds <= 24 * 3600;
    const courtes = fenetres.filter((w: any) => courte(w));
    const longues = fenetres.filter((w: any) => !courte(w));
    const session = win(courtes[0]);
    // Deux fenêtres sans durée déclarée : on retombe sur l'ordre reçu.
    const weekly = win(longues[0] ?? courtes[1]);
    if (typeof data?.plan_type === 'string') base.plan = data.plan_type.replace(/^plus$/i, 'Plus');
    const exhausted = (weekly?.usedPct ?? 0) >= 100 || (session?.usedPct ?? 0) >= 100;
    return { ...base, session, weekly, available: !exhausted };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'lecture impossible' };
  }
}

/**
 * LA CLÉ D'ACCÈS D'UN COMPTE CURSOR. Ce moteur n'a pas de coffre à jetons comme
 * les outils en ligne de commande : il a une CLÉ, posée hors du dépôt dans
 * `CURSOR_API_KEY` (fichier d'environnement du service), ou déposée dans le
 * dossier du compte (`api-key`) pour un compte de relève. Rien n'est écrit en
 * dur ici.
 */
export function cleDuCompteCursor(account: AccountRecord): string {
  try {
    const contenu = fs.readFileSync(path.join(account.configDir, 'api-key'), 'utf8').trim();
    if (contenu) return contenu;
  } catch {
    /* pas de fichier de clé : voir juste en dessous */
  }
  /*
   * LA CLÉ DE L'ENVIRONNEMENT N'APPARTIENT QU'AU COMPTE PRINCIPAL — celui
   * qu'elle a fait naître. Sans cette limite, un compte de RELÈVE dont le
   * fichier de clé manque retomberait en SILENCE sur la clé du principal :
   * deux comptes, une seule clé, et une bascule qui ne bascule rien. Mieux vaut
   * une clé absente, qui se voit dans les réglages, qu'un doublon invisible.
   */
  return account.id === COMPTE_CURSOR_PRINCIPAL ? (process.env.CURSOR_API_KEY ?? '').trim() : '';
}

/**
 * DÉCLARER UNE CLÉ CURSOR DE PLUS, depuis les réglages.
 *
 * Claude et Codex se connectent par une page de connexion, dans le coffre du
 * compte. Cursor n'a qu'une CLÉ : sans cette porte, ajouter un second compte
 * demandait de créer des fichiers sur le serveur à la main — autant dire que la
 * possibilité n'existait pas pour qui n'ouvre pas de terminal.
 *
 * Deux règles reprises de la connexion des autres moteurs : la clé est
 * ÉPROUVÉE avant d'entrer dans la liste (une clé refusée ne laisse pas une
 * ligne morte dans les réglages), et le compte est écrit dans son propre
 * dossier — jamais deux comptes dans le même.
 */
export async function declarerCleCursor(
  label: string,
  cle: string,
): Promise<{ ok: boolean; erreur?: string; account?: AccountRecord }> {
  const nom = label.trim();
  const secret = cle.trim();
  if (!nom) return { ok: false, erreur: 'il faut un nom pour ce compte' };
  if (!secret) return { ok: false, erreur: "il faut une clé d'accès" };

  // La clé est éprouvée AVANT d'être retenue : le moteur ne doit pas se
  // retrouver avec un compte qui ne répondra jamais.
  try {
    const res = await fetch(`${API_CURSOR}/v1/me`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const corps: any = await res.json().catch(() => null);
      return { ok: false, erreur: raisonDeRefusCursor(res.status, corps?.message ?? corps?.error?.message) };
    }
  } catch (err: any) {
    return { ok: false, erreur: err?.message ?? "la clé n'a pas pu être éprouvée" };
  }

  const base = `cursor-${nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'compte'}`;
  const connus = new Set(listAllAccountRecords().map((a) => a.id));
  let id = base;
  for (let suffixe = 2; connus.has(id); suffixe += 1) id = `${base}-${suffixe}`;

  const configDir = path.join(PATHS.accounts, id);
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'meta.json'),
      JSON.stringify({ engine: 'cursor', label: nom, priority: 50 }, null, 2),
    );
    fs.writeFileSync(path.join(configDir, 'api-key'), `${secret}\n`, { mode: 0o600 });
  } catch (err: any) {
    return { ok: false, erreur: err?.message ?? 'le compte n\'a pas pu être écrit sur le serveur' };
  }

  const account: AccountRecord = { id, engine: 'cursor', label: nom, priority: 50, configDir };
  saveAccountRecord(account);
  return { ok: true, account };
}

/**
 * Cursor ne publie AUCUNE fenêtre de pourcentage : sa facturation se lit à la
 * dépense. On ne montre donc pas de jauge inventée — on rapporte le MONTANT
 * demandé à Cursor, l'usage déjà mesuré ici, et si la clé RÉPOND.
 */
async function fetchCursorQuota(account: AccountRecord): Promise<AccountQuota> {
  const usageLocal = usageDuCompte(account.id);
  const base: AccountQuota = {
    id: account.id,
    engine: 'cursor',
    label: account.label,
    plan: account.plan,
    priority: account.priority,
    active: false,
    available: true,
    fetchedAt: Date.now(),
    usageLocal,
  };
  const cle = cleDuCompteCursor(account);
  if (!cle) return { ...base, error: 'aucune clé configurée', available: false };
  try {
    // Import tardif : le module du moteur importe déjà les comptes. L'usage se
    // lit EN MÊME TEMPS que la clé s'éprouve : deux lectures à la suite
    // doublaient le temps d'un relevé déjà plafonné (DEC-128).
    const { creditCursor } = await import('./engines/cursor.js');
    const [res, credit] = await Promise.all([
      fetch(`${API_CURSOR}/v1/me`, {
        headers: { authorization: `Bearer ${cle}` },
        signal: AbortSignal.timeout(12000),
      }),
      creditCursor(cle),
    ]);
    if (!res.ok) {
      const corps: any = await res.json().catch(() => null);
      return {
        ...base,
        error: raisonDeRefusCursor(res.status, corps?.message ?? corps?.error?.message),
        available: false,
      };
    }
    const data: any = await res.json();
    return {
      ...base,
      plan: typeof data?.apiKeyName === 'string' ? data.apiKeyName : account.plan,
      credit,
    };
  } catch (err: any) {
    return { ...base, error: err?.message ?? 'lecture impossible' };
  }
}

/**
 * La lecture de quota du moteur de CE compte. Un seul endroit décide : ajouter
 * un moteur, c'est ajouter une ligne ici, jamais chercher les trois appels
 * dispersés qui répétaient la même condition.
 */
/**
 * DES RELEVÉS FACTICES, POUR LES CONTRÔLES BOUT-EN-BOUT. `BELUGA_QUOTAS_FACTICES`
 * désigne un fichier JSON — `{ "<compte>": { available, plan, session, weekly } }` —
 * lu à chaque tournée à la place du fournisseur. Un démon d'essai peut ainsi
 * jouer un compte disponible et un compte à sec sans toucher un seul compte
 * réel (`scripts/verif-flux-compte-et-plan.mjs`). Jamais posé en production.
 */
function quotaFactice(account: AccountRecord): AccountQuota | null {
  const fichier = process.env.BELUGA_QUOTAS_FACTICES;
  if (!fichier) return null;
  try {
    const table = JSON.parse(fs.readFileSync(fichier, 'utf8')) as Record<string, Partial<AccountQuota>>;
    const factice = table[account.id];
    if (!factice) return null;
    return AccountQuota.parse({
      id: account.id,
      engine: account.engine,
      label: account.label,
      plan: factice.plan ?? account.plan,
      priority: account.priority,
      active: false,
      available: factice.available ?? true,
      session: factice.session,
      weekly: factice.weekly,
      fetchedAt: Date.now(),
    });
  } catch {
    return null;
  }
}

function lireQuotaDuMoteur(account: AccountRecord): Promise<AccountQuota> {
  const factice = quotaFactice(account);
  if (factice) return Promise.resolve(factice);
  if (account.engine === 'claude') return fetchClaudeQuota(account);
  if (account.engine === 'cursor') return fetchCursorQuota(account);
  return fetchCodexQuota(account);
}

/** Prochaine tentative autorisée par compte : le service limite la fréquence. */
const nextTry = new Map<string, number>();

/** Le planificateur d'échéance respecte la même pause que les lectures manuelles. */
export function prochaineTentativeQuota(accountId: string): number | undefined {
  return nextTry.get(accountId);
}

/**
 * LA TOURNÉE EN COURS, AVEC SA PORTÉE.
 *
 * `portee` vaut `null` pour une tournée GÉNÉRALE (tous les comptes), ou
 * l'ensemble des comptes réellement lus pour une tournée CIBLÉE.
 */
let actualisationEnCours: { portee: ReadonlySet<string> | null; tournee: Promise<AccountQuota[]> } | null = null;

/**
 * La tournée déjà en route répond-elle à CETTE demande-là ?
 *
 * Une tournée générale couvre tout. Une tournée ciblée ne couvre que ses
 * propres comptes : elle ne peut pas tenir lieu de relevé général, ni de relevé
 * d'un compte qu'elle n'interroge pas.
 */
function porteeCouvre(enRoute: ReadonlySet<string> | null, demandee: ReadonlySet<string> | null): boolean {
  if (enRoute === null) return true;
  if (demandee === null) return false;
  for (const compte of demandee) if (!enRoute.has(compte)) return false;
  return true;
}

/*
 * UNE LECTURE DE QUOTA QUI NE REVIENT PAS N'EST PAS UNE LECTURE LENTE.
 *
 * Chaque appel au fournisseur porte déjà son propre délai (douze secondes), et
 * le renouvellement d'un jeton le sien (trente secondes). Cela ne suffit pas :
 * le 06.09.2026, une tournée partie à 10 h 29 n'est JAMAIS revenue. Or la
 * tournée est PARTAGÉE (`actualisationEnCours`) — tout ce qui a demandé un
 * relevé ensuite a hérité de la même promesse morte :
 *
 *  - les jauges sont restées figées sur 10 h 29 pendant quatre heures, le
 *    minuteur de dix minutes ne relançant rien puisqu'il retombait dessus ;
 *  - et chaque clic sur « poursuivre sur ce compte » (`reprendreSurCompte`,
 *    qui commence par un relevé frais) est resté sans effet, ce que l'écran
 *    montre comme une question de compte reposée indéfiniment.
 *
 * D'où DEUX plafonds, et non un seul : celui de la LECTURE d'un compte, qui
 * empêche un moteur muet de retenir la tournée, et celui de la TOURNÉE, la
 * ceinture derrière la bretelle — passé ce délai la promesse partagée est
 * relâchée, quitte à repartir à neuf au prochain appel.
 */
const PLAFOND_LECTURE_COMPTE_MS = 60_000;

/** Le plafond de la tournée entière : quoi qu'il arrive, elle finit. */
const PLAFOND_TOURNEE_QUOTAS_MS = 5 * 60_000;

/**
 * Une promesse qui NE PEUT PAS ne pas finir : passé le délai, on rend ce que
 * `secours` dit, et la promesse d'origine est laissée à sa vie de son côté —
 * on ne l'annule pas, mais on ne l'attend plus. Son rejet éventuel est avalé :
 * plus personne ne l'écoute.
 */
function avecPlafond<T>(promesse: Promise<T>, delai: number, secours: () => T): Promise<T> {
  let minuteur: NodeJS.Timeout | undefined;
  const echeance = new Promise<T>((resolve) => {
    minuteur = setTimeout(() => resolve(secours()), delai);
    minuteur.unref?.();
  });
  return Promise.race([promesse, echeance]).finally(() => clearTimeout(minuteur));
}

export function refreshQuotas(force = false, seulement?: readonly string[]): Promise<AccountQuota[]> {
  const portee = seulement ? new Set(seulement) : null;
  /*
   * UNE TOURNÉE NE SE PARTAGE QU'AVEC QUI ELLE RENSEIGNE.
   *
   * Une lecture périodique, manuelle et planifiée peuvent tomber dans la même
   * seconde : elles partagent alors LA lecture déjà en cours au lieu d'envoyer
   * plusieurs fois la même requête au fournisseur. Mais ce partage était
   * AVEUGLE. Un relevé ciblé — celui d'un seul compte, au clic sur « poursuivre
   * sur ce compte » ou avant un tour — était rendu tel quel à qui demandait les
   * chiffres de TOUS les comptes. Chacun croyait ses comptes fraîchement lus
   * quand un seul l'avait été : deux comptes distincts, un seul relevé, et des
   * jauges qui n'avancent plus.
   *
   * Une tournée en route ne sert donc que les demandes qu'elle COUVRE. Les
   * autres attendent qu'elle finisse — le fournisseur n'est jamais interrogé
   * deux fois en même temps — puis partent pour de bon.
   */
  const enRoute = actualisationEnCours;
  if (enRoute && porteeCouvre(enRoute.portee, portee)) return enRoute.tournee;
  if (enRoute) return enRoute.tournee.catch(() => undefined).then(() => refreshQuotas(force, seulement));

  const tournee = avecPlafond(executerActualisationQuotas(force, seulement), PLAFOND_TOURNEE_QUOTAS_MS, () => {
    log.warn(
      `tournée de quotas sans fin (plus de ${PLAFOND_TOURNEE_QUOTAS_MS / 60_000} min) : ` +
        'on rend le dernier relevé connu et la prochaine demande repart à neuf',
    );
    return cachedQuotas();
  });
  const partagee = { portee, tournee };
  actualisationEnCours = partagee;
  // La promesse PARTAGÉE est celle qu'on rend : le rangement se fait à côté,
  // sinon un rejet ferait deux promesses, dont une que personne n'écoute.
  void tournee
    .finally(() => {
      if (actualisationEnCours === partagee) actualisationEnCours = null;
    })
    .catch(() => undefined);
  return tournee;
}

async function executerActualisationQuotas(force = false, seulement?: readonly string[]): Promise<AccountQuota[]> {
  loadCache();
  if (!force && Date.now() - lastFetch < CACHE_MS && quotaCache.size) {
    return [...quotaCache.values()];
  }
  /*
   * UN RELEVÉ CIBLÉ NE RELIT PAS DES COMPTES QU'IL VIENT DE LIRE. Sans cela, la
   * porte dure du lancement et le choix du compte, à quelques secondes d'écart,
   * payaient DEUX FOIS la même lecture — le poste le plus cher de la
   * préparation, doublé.
   */
  if (!force && seulement?.length && quotaCache.size) {
    const frais = seulement.every((id) => Date.now() - (derniereLecture.get(id) ?? 0) < CACHE_MS);
    if (frais) return [...quotaCache.values()];
  }
  /*
   * SEULE UNE TOURNÉE GÉNÉRALE FAIT DATE. `lastFetch` dit « tous les comptes
   * viennent d'être lus » : un relevé ciblé le posait pourtant lui aussi, et
   * les cinq minutes de cache s'appliquaient alors à des comptes que personne
   * n'avait interrogés. Le relevé d'UN compte gelait les autres.
   */
  if (!seulement) lastFetch = Date.now();
  const demandes = seulement ? new Set(seulement) : null;
  const comptesActifs = listAccountRecords();
  const accounts = comptesActifs.filter((account) => !demandes || demandes.has(account.id));
  let lecturesLancees = 0;
  for (const [index, account] of accounts.entries()) {
    // Un compte qui vient d'être refusé attend son tour : insister ne fait que
    // prolonger le refus, et le dernier relevé connu reste affiché.
    const attendre = nextTry.get(account.id) ?? 0;
    const connu = quotaCache.get(account.id);
    if (Date.now() < attendre && connu) {
      // Le relevé mémorisé est repoussé tel quel, mais son NOM peut avoir changé
      // depuis (renommage) : on réapplique toujours celui du compte, jamais
      // celui figé dans le relevé.
      quotaCache.set(account.id, { ...connu, label: account.label });
      continue;
    }

    // Les comptes sont interrogés l'un après l'autre, avec un souffle entre
    // deux : deux lectures collées déclenchent un refus pour excès d'appels.
    if (index > 0 && lecturesLancees > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    lecturesLancees += 1;
    // Le plafond de la LECTURE : un moteur qui ne rend jamais la main devient un
    // relevé en erreur — donc les chiffres déjà connus, repris juste en dessous —
    // au lieu de retenir la tournée, et avec elle tous ceux qui l'attendent.
    const quota = await avecPlafond(lireQuotaDuMoteur(account), PLAFOND_LECTURE_COMPTE_MS, () => {
      log.warn(
        `lecture de quota sans réponse sur ${account.label} après ` +
          `${PLAFOND_LECTURE_COMPTE_MS / 1000} s : on passe au compte suivant`,
      );
      return {
        id: account.id,
        engine: account.engine,
        label: account.label,
        plan: account.plan,
        priority: account.priority,
        active: false,
        available: true,
        fetchedAt: Date.now(),
        error: 'lecture sans réponse',
      };
    });

    if (quota.error?.includes('429')) {
      // Refus pour excès d'appels : on double l'attente, jusqu'à trente minutes.
      const precedent = Math.max(60_000, (nextTry.get(account.id) ?? 0) - Date.now());
      nextTry.set(account.id, Date.now() + Math.min(30 * 60_000, precedent * 2));
      quota.error = 'lecture momentanément indisponible';
    } else if (!quota.error) {
      nextTry.delete(account.id);
    }
    // Un compte marqué indisponible par un événement de limite le reste jusqu'à sa remise à zéro.
    const previous = quotaCache.get(account.id);
    // Une lecture RÉUSSIE fait foi : un compte remis à zéro, ou simplement mal
    // classé la fois d'avant, redevient disponible. Sans cela, un compte marqué
    // indisponible le restait jusqu'à la remise à zéro hebdomadaire, même quand
    // le fournisseur annonçait qu'il restait du quota.
    if (quota.error && previous?.available === false) {
      quota.available = false;
    }
    // Lecture refusée ou impossible : on garde les derniers chiffres RÉELLEMENT
    // relevés plutôt que d'afficher des zéros trompeurs.
    if (quota.error && previous) {
      quota.session = previous.session ?? quota.session;
      quota.weekly = previous.weekly ?? quota.weekly;
      quota.plan = previous.plan ?? quota.plan;
      quota.fetchedAt = previous.fetchedAt ?? quota.fetchedAt;
      quota.credit = previous.credit ?? quota.credit;
      // L'IDENTITÉ NE S'EFFACE PAS SUR UNE LECTURE RATÉE : savoir qui est
      // derrière un coffre reste vrai même quand son relevé ne répond plus.
      quota.identite = quota.identite ?? previous.identite;
    }
    // Codex recalcule `resetsAt` en relatif à chaque lecture, si bien qu'il
    // dérive de quelques secondes sans que la fenêtre ait changé : les paliers
    // hebdomadaires repartaient alors à zéro à chaque relevé. On épingle donc
    // l'échéance sur celle déjà connue tant qu'elle décrit la MÊME fenêtre
    // (`memeFenetre`). Un vrai changement de fenêtre s'écarte de plusieurs jours
    // et n'est jamais confondu. Claude, dont `resetsAt` est absolu, ne bouge pas.
    if (previous?.weekly && quota.weekly && memeFenetre(previous.weekly.resetsAt, quota.weekly.resetsAt)) {
      quota.weekly = { ...quota.weekly, resetsAt: previous.weekly.resetsAt };
    }
    if (previous?.session && quota.session && memeFenetre(previous.session.resetsAt, quota.session.resetsAt)) {
      quota.session = { ...quota.session, resetsAt: previous.session.resetsAt };
    }
    quotaCache.set(account.id, quota);
    // Ce compte vient d'être lu : un relevé ciblé qui suit s'en contentera.
    derniereLecture.set(account.id, Date.now());
    if (!quota.error) {
      recordQuotaSample(account.id, quota.session?.usedPct, quota.weekly?.usedPct, quota.credit?.demandeCentimes);
    }
  }
  // Une tournée ciblée rend aussi les autres comptes depuis le cache, mais
  // seulement ceux qui existent encore et sont actifs. Les comptes coupés sont
  // ajoutés juste dessous avec leur vrai drapeau `disabled`.
  const results = comptesActifs
    .map((account) => quotaCache.get(account.id))
    .filter((quota): quota is AccountQuota => !!quota);
  ajouterComptesDesactives(results);
  markActive(results);
  persistCache();
  /*
   * UN RELEVÉ FRAIS PEUT LEVER UNE LIMITE CONNUE : une fenêtre remise à zéro
   * depuis la limite rend son compte au choix (`server/src/limites-connues.ts`).
   * Jugé sur les chiffres BRUTS du fournisseur, avant qu'on y pose la marque.
   */
  effacerLesLimitesLevees(results);
  avecLesLimitesConnues(results);
  // Seulement sur une VRAIE lecture : le cache est rejoué à chaque connexion
  // d'un navigateur, et l'alerte partirait sur des chiffres déjà vus.
  alerterFinsDeFenetre(results);
  alerterSeuilsSemaine(results);
  alerterEpuisementsProches(results);
  alerterEmballements(results);
  return results;
}

export function cachedQuotas(): AccountQuota[] {
  loadCache();
  const list = [...quotaCache.values()];
  ajouterComptesDesactives(list);
  markActive(list);
  avecLesLimitesConnues(list);
  return list;
}

/**
 * LA LIMITE CONNUE SE LIT SUR LE RELEVÉ DIFFUSÉ. Le relevé du fournisseur ne
 * voit pas un manque de crédits ; la table des limites, elle, sait que le
 * moteur a refusé ce compte. On la pose sur chaque relevé rendu — à l'écran, le
 * compte n'est plus proposé pour poursuivre ; dans le démon, `comptesConnus`
 * le dit indisponible. Jamais écrite dans le cache : c'est un état À CÔTÉ du
 * relevé, qui vit et meurt avec la table.
 */
function avecLesLimitesConnues(list: AccountQuota[]): void {
  const limites = limitesConnues();
  for (const quota of list) {
    const limite = limites.find((l) => l.compte === quota.id);
    quota.limiteConnue = limite
      ? { motif: limite.motif, resetsAt: limite.resetsAt, echeance: echeanceDeLaLimite(limite) }
      : undefined;
  }
}

/**
 * Un compte coupé n'est plus interrogé (il ne fait pas partie de
 * `listAccountRecords`), mais il doit RESTER visible dans le volet Quotas, éteint,
 * pour qu'on puisse le rallumer. On le rejoue depuis son dernier relevé connu,
 * ou depuis un état minimal s'il n'a jamais été lu, toujours marqué `disabled` et
 * indisponible.
 */
function ajouterComptesDesactives(list: AccountQuota[]): void {
  const dejaLa = new Set(list.map((q) => q.id));
  for (const account of listAllAccountRecords()) {
    if (!account.disabled) continue;
    const connu = quotaCache.get(account.id);
    const quota: AccountQuota = connu
      ? { ...connu, disabled: true, active: false, available: false }
      : {
          id: account.id,
          engine: account.engine,
          label: account.label,
          plan: account.plan,
          priority: account.priority,
          active: false,
          available: false,
          disabled: true,
          fetchedAt: Date.now(),
        };
    quotaCache.set(account.id, quota);
    if (!dejaLa.has(account.id)) {
      list.push(quota);
      dejaLa.add(account.id);
    }
  }
}

/**
 * Les deux pourcentages consommés d'un compte, lus dans le DERNIER relevé connu
 * (le cache). Sert de point de départ AVANT un tour : la lecture est déjà
 * fraîche, un agent vient d'être choisi sur ce compte (`pickAccount` relève les
 * quotas). Aucun appel réseau : on ne bouscule pas le rythme des lectures.
 */
export function partsQuotaEnCache(accountId: string): { session?: number; weekly?: number } {
  loadCache();
  const quota = quotaCache.get(accountId);
  return { session: quota?.session?.usedPct, weekly: quota?.weekly?.usedPct };
}

/**
 * Relève À NEUF les deux pourcentages d'UN compte, hors du tour de ronde de
 * `refreshQuotas`. Sert de point d'arrivée APRÈS un tour, pour mesurer ce que la
 * tâche a réellement dépensé. Lecture PURE : ni cache mis à jour, ni relevé
 * enregistré, ni alerte déclenchée — le calcul des quotas et ses alertes ne
 * bougent pas. Une lecture en échec rend `null` : on n'attribue rien plutôt que
 * d'inventer une part.
 */
export async function relireQuotaDuCompte(
  accountId: string,
): Promise<{ session?: number; weekly?: number } | null> {
  const account = listAccountRecords().find((a) => a.id === accountId);
  if (!account) return null;
  const quota = await lireQuotaDuMoteur(account);
  if (quota.error) return null;
  return { session: quota.session?.usedPct, weekly: quota.weekly?.usedPct };
}

/** Les échéances pour lesquelles on a déjà prévenu, retenues d'un redémarrage à l'autre. */
const CLE_ALERTE_FENETRE = 'quota.alerte.fenetre';

function annoncesFaites(): Record<string, number> {
  try {
    const raw = getMeta(CLE_ALERTE_FENETRE);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * La fenêtre de cinq heures qui s'achève se dit sur le téléphone, une seule
 * fois par fenêtre. Les heures de silence s'appliquent : c'est la notification
 * elle-même qui les fait respecter.
 */
function alerterFinsDeFenetre(list: AccountQuota[]): void {
  const annonces = annoncesFaites();
  let change = false;
  for (const quota of list) {
    const etat = {
      resetsAt: quota.session?.resetsAt,
      lectureEnEchec: !!quota.error,
      dejaAnnoncee: annonces[quota.id],
    };
    if (!doitAlerterFinDeFenetre(etat)) continue;
    // Une fenêtre de cinq heures qui s'achève se remplit d'elle-même : cela se
    // lit dans le volet des quotas, cela ne réveille plus personne.
    notify({
      motif: 'fenetre-bientot-finie',
      title: 'Fenêtre de 5 h bientôt finie',
      body: `${quota.label} : ${tempsRestant(quota.session?.resetsAt)} avant la remise à zéro (${Math.round(
        quota.session?.usedPct ?? 0,
      )} % consommés).`,
      reference: `${quota.id}:fenetre`,
    });
    annonces[quota.id] = quota.session!.resetsAt!;
    change = true;
  }
  if (!change) return;
  try {
    setMeta(CLE_ALERTE_FENETRE, JSON.stringify(annonces));
  } catch (err) {
    // Sans trace retenue, la même fenêtre se signalerait à chaque lecture.
    log.warn('quota : impossible de retenir l’alerte de fin de fenêtre', err);
  }
}

/** Les paliers de consommation déjà annoncés, fenêtre hebdomadaire par fenêtre. */
const CLE_SEUILS_SEMAINE = 'quota.alerte.seuils';

/**
 * Les DEUX paliers qui comptent sur la semaine : 70 % (il est temps de
 * s'organiser) et 90 % (la fin approche). Chacun se dit une seule fois par
 * fenêtre, et la remise à zéro hebdomadaire efface l'ardoise. Passer de 60 à
 * 95 % d'un coup ne fait qu'une alerte : la règle est dans
 * `franchissementSemaine` (shared), le disque n'est ici que sa mémoire.
 */
function alerterSeuilsSemaine(list: AccountQuota[]): void {
  let etats: Record<string, EtatSeuilsSemaine> = {};
  try {
    const raw = getMeta(CLE_SEUILS_SEMAINE);
    etats = raw ? (JSON.parse(raw) as Record<string, EtatSeuilsSemaine>) : {};
  } catch {
    etats = {};
  }

  let change = false;
  for (const quota of list) {
    // Chiffres périmés : prévenir sur une preuve qu'on n'a plus n'aide personne.
    if (quota.error) continue;
    const franchi = franchissementSemaine(etats[quota.id], quota.weekly?.usedPct, quota.weekly?.resetsAt);
    if (!franchi) continue;

    notify({
      motif: 'quota-seuil',
      title: `Quota de la semaine : ${franchi.seuil} % atteints`,
      body: `${quota.label} : ${Math.round(quota.weekly?.usedPct ?? 0)} % du quota hebdomadaire sont consommés.`,
      // Pas de `resetsAt` dans la référence : côté Codex il dérive et la mémoire
      // courte du guichet `notify` ne rattraperait rien. La marque persistante
      // (`quota.alerte.seuils`) distingue déjà les vraies fenêtres ; ici, un même
      // compte au même palier ne fait qu'une alerte, second filet de dix minutes.
      reference: `${quota.id}:seuil-${franchi.seuil}`,
      element: `${quota.label} — ${franchi.seuil} %`,
    });
    etats[quota.id] = franchi.etat;
    change = true;
  }

  if (!change) return;
  try {
    setMeta(CLE_SEUILS_SEMAINE, JSON.stringify(etats));
  } catch (err) {
    // Sans trace retenue, le même palier se signalerait à chaque lecture.
    log.warn('quota : impossible de retenir le palier franchi', err);
  }
}

/** Les semaines pour lesquelles on a déjà annoncé un manque annoncé. */
const CLE_ALERTE_EPUISEMENT = 'quota.alerte.epuisement';

/**
 * « Au rythme actuel, ce compte n'ira pas au bout de la semaine » se dit sur le
 * téléphone, UNE seule fois par semaine et par compte. Le message porte le
 * compte de secours quand il en existe un : prévenir sans dire quoi faire ne
 * sert à rien au milieu de la nuit.
 */
function alerterEpuisementsProches(list: AccountQuota[]): void {
  let annonces: Record<string, number> = {};
  try {
    const raw = getMeta(CLE_ALERTE_EPUISEMENT);
    annonces = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    annonces = {};
  }

  const histoire = quotaHistory(7);
  // Le profil des heures creuses puise aussi dans le RÉSUMÉ des semaines
  // passées ; la pente du moment, elle, reste mesurée sur les relevés récents.
  const resume = quotaResume();
  const previsions = new Map(
    list.map(
      (quota) =>
        [
          quota.id,
          previsionEpuisement(historiquePourProfil(resume[quota.id], histoire[quota.id]), quota.weekly),
        ] as const,
    ),
  );

  let change = false;
  for (const quota of list) {
    const prevision = previsions.get(quota.id);
    const etat = {
      resetsAt: quota.weekly?.resetsAt,
      niveau: prevision?.niveau,
      lectureEnEchec: !!quota.error,
      dejaAnnoncee: annonces[quota.id],
    };
    if (!doitAlerterEpuisementProche(etat)) continue;

    const secours = compteDeSecours(
      { id: quota.id, engine: quota.engine },
      list.map((autre) => ({
        id: autre.id,
        label: autre.label,
        engine: autre.engine,
        disponible: autre.available !== false,
        tientJusquAuBout: !previsions.get(autre.id),
        consommePct: autre.weekly?.usedPct ?? 0,
      })),
    );

    notify({
      motif: 'quota-surconsommation',
      title: 'Le quota de la semaine va manquer',
      body:
        `${quota.label} : ${prevision!.texte} (${Math.round(quota.weekly?.usedPct ?? 0)} % consommés).` +
        (secours ? ` Bascule possible sur ${secours.label}.` : ''),
      reference: `${quota.id}:epuisement:${quota.weekly!.resetsAt}`,
      element: `${quota.label} : ${prevision!.texte}`,
    });
    annonces[quota.id] = quota.weekly!.resetsAt!;
    change = true;
  }

  if (!change) return;
  try {
    setMeta(CLE_ALERTE_EPUISEMENT, JSON.stringify(annonces));
  } catch (err) {
    // Sans trace retenue, la même semaine se signalerait à chaque lecture.
    log.warn('quota : impossible de retenir l’alerte d’épuisement proche', err);
  }
}

/** Les emballements déjà annoncés, compte par compte : le départ de la série. */
const CLE_ALERTE_EMBALLEMENT = 'quota.alerte.emballement';

/**
 * « Ce compte consomme bien plus vite que d'habitude » se dit sur le téléphone
 * AVANT que la prévision de fin de semaine n'ait basculé — c'est tout l'objet
 * de cette alerte-là. Une seule fois par emballement : le départ de la série
 * sert de marque, gardée sur le disque, donc un redémarrage n'en refait pas une
 * et il faut un retour à la normale pour redonner droit à la suivante.
 *
 * On prévient, on ne décide pas : aucun agent n'est arrêté, aucun compte n'est
 * changé.
 */
function alerterEmballements(list: AccountQuota[]): void {
  let annonces: Record<string, number> = {};
  try {
    const raw = getMeta(CLE_ALERTE_EMBALLEMENT);
    annonces = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    annonces = {};
  }

  const histoire = quotaHistory(14);

  let change = false;
  for (const quota of list) {
    const emballement = emballementConsommation(histoire[quota.id] ?? []);
    // Retour à la normale : l'ardoise s'efface, la prochaine pointe pourra parler.
    if (!emballement && annonces[quota.id] !== undefined) {
      delete annonces[quota.id];
      change = true;
    }
    if (
      !doitAlerterEmballement({
        emballement,
        lectureEnEchec: !!quota.error,
        dejaAnnoncee: annonces[quota.id],
      })
    ) {
      continue;
    }

    notify({
      motif: 'quota-emballement',
      title: 'Consommation inhabituelle',
      body: `${quota.label} : ${emballement!.texte}.`,
      reference: `${quota.id}:emballement:${emballement!.depuis}`,
      element: `${quota.label} — ${emballement!.facteur.toFixed(1)} fois l’habitude`,
    });
    annonces[quota.id] = emballement!.depuis;
    change = true;
  }

  if (!change) return;
  try {
    setMeta(CLE_ALERTE_EMBALLEMENT, JSON.stringify(annonces));
  } catch (err) {
    // Sans trace retenue, le même emballement se signalerait à chaque lecture.
    log.warn('quota : impossible de retenir l’alerte d’emballement', err);
  }
}

/**
 * La dernière amorce posée par le serveur voyage avec le quota : c'est ce qui
 * permet de lire à l'écran QUAND la fenêtre a été lancée, sans ouvrir la base.
 */
function attacherAmorces(list: AccountQuota[]): void {
  try {
    const amorces = dernieresAmorces();
    for (const quota of list) quota.derniereAmorce = amorces[quota.id];
  } catch {
    // Journal illisible : le quota reste affichable, c'est l'essentiel.
  }
}

/** Ce que le coffre d'un compte apprend sur sa session, sans appeler personne. */
export interface CoffreDuCompte {
  /** Échéance du jeton d'accès, quand on a su la lire. */
  expireA?: number;
  /** Échéance du jeton de RENOUVELLEMENT : la vraie fin de vie de la session. */
  renouvellementExpireA?: number;
  /** Le fichier est là, mais ses jetons sont vides : session finie, pas compte neuf. */
  coffreVide?: boolean;
}

/**
 * LIRE LE COFFRE SANS RIEN LANCER. Un compte Claude dont le jeton de
 * renouvellement est échu voit le moteur RÉÉCRIRE `.credentials.json` avec des
 * jetons VIDES : le fichier existe, le compte a servi la veille, et pourtant
 * plus rien ne marche. C'est ce que dit `coffreVide` — sans lui, l'écran
 * annonçait « jamais connecté » sur un compte qui tournait l'avant-veille
 * (Claude Pro, 30/08/2026).
 */
export function lireCoffreDuCompte(account: AccountRecord): CoffreDuCompte {
  try {
    if (account.engine === 'claude') {
      const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, '.credentials.json'), 'utf8'));
      const oauth = raw?.claudeAiOauth ?? {};
      const expire = Number(oauth.expiresAt);
      const renouvellement = Number(oauth.refreshTokenExpiresAt);
      return {
        expireA: Number.isFinite(expire) && expire > 0 ? expire : undefined,
        renouvellementExpireA: Number.isFinite(renouvellement) && renouvellement > 0 ? renouvellement : undefined,
        coffreVide: !oauth.accessToken && !oauth.refreshToken,
      };
    }
    const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, 'auth.json'), 'utf8'));
    const jeton = raw?.tokens?.access_token;
    if (typeof jeton !== 'string' || !jeton) return { coffreVide: !raw?.tokens?.refresh_token };
    return { expireA: expirationDuCompte(account) };
  } catch {
    // Fichier absent ou illisible : l'absence de coffre se lit déjà dans le quota.
    return {};
  }
}

/**
 * Quand le jeton d'un compte arrive à échéance, quand on sait le lire. Claude
 * l'écrit en clair ; Codex le range dans le jeton lui-même — un jeton signé en
 * trois parties, dont celle du milieu porte la date.
 */
export function expirationDuCompte(account: AccountRecord): number | undefined {
  try {
    if (account.engine === 'claude') {
      const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, '.credentials.json'), 'utf8'));
      const expire = Number(raw?.claudeAiOauth?.expiresAt);
      return Number.isFinite(expire) ? expire : undefined;
    }
    const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, 'auth.json'), 'utf8'));
    const jeton = raw?.tokens?.access_token;
    if (typeof jeton !== 'string') return undefined;
    const milieu = jeton.split('.')[1];
    if (!milieu) return undefined;
    const charge = JSON.parse(Buffer.from(milieu, 'base64url').toString('utf8'));
    return typeof charge?.exp === 'number' ? charge.exp * 1000 : undefined;
  } catch {
    // Fichier absent ou illisible : l'absence de jeton se lit déjà dans le quota.
    return undefined;
  }
}

/**
 * L'état RÉEL de la connexion voyage avec le quota : un compte peut avoir tout
 * son quota et un jeton mort, et rien à l'écran ne le disait — il fallait ouvrir
 * un terminal pour le découvrir. La règle est pure (`etatDeConnexion`), le
 * disque n'apporte ici que l'échéance du jeton.
 */
function attacherEtatConnexion(list: AccountQuota[]): void {
  const comptes = new Map(listAccountRecords().map((a) => [a.id, a]));
  for (const quota of list) {
    const compte = comptes.get(quota.id);
    const coffre = compte ? lireCoffreDuCompte(compte) : {};
    quota.connexion = etatDeConnexion({
      erreur: quota.error,
      expireA: coffre.expireA,
      renouvellementExpireA: coffre.renouvellementExpireA,
      coffreVide: coffre.coffreVide,
    });
  }
}

/**
 * DEUX COMPTES QUI RENDENT LE MÊME RELEVÉ NE SONT PAS DEUX RÉSERVES.
 *
 * Chaque compte est relevé avec le jeton de SON coffre : des chiffres
 * identiques au pourcentage ET à la minute d'échéance près disent que les deux
 * coffres aboutissent au même abonnement. On le POSE sur le relevé, pour que
 * l'écran le dise et que le choix du compte cesse de compter la même place
 * deux fois. La séparation, elle, demande une reconnexion — ce n'est pas au
 * démon de la décider.
 */
function attacherJumeaux(list: AccountQuota[]): void {
  // Une identité lue suffit : un compte dont le relevé a échoué reste
  // rapprochable de son jumeau, puisqu'on sait qui est derrière son coffre.
  const lisibles = list.filter(
    (quota) => quota.identite?.compteFournisseur || (!quota.error && (quota.session || quota.weekly)),
  );
  const comparables = lisibles.map(releveComparable);
  const jumeaux = jumeauxParCompte(comparables);
  const natures = natureParCompte(comparables);
  for (const quota of list) {
    const autres = jumeaux.get(quota.id);
    quota.jumeaux = autres?.length
      ? autres.map((id) => ({ id, label: list.find((q) => q.id === id)?.label ?? id }))
      : undefined;
    quota.jumeauxCertains = autres?.length ? natures.get(quota.id) === 'certain' : undefined;
  }
}

/**
 * CE QU'ON DONNE À LA RÈGLE PURE pour rapprocher deux comptes : son identité
 * chez le fournisseur d'abord, ses chiffres ensuite. Un seul endroit le décide,
 * pour que le volet Quotas et le choix du compte lisent exactement la même
 * chose.
 */
function releveComparable(quota: AccountQuota) {
  return {
    id: quota.id,
    engine: quota.engine,
    compteFournisseur: quota.identite?.compteFournisseur,
    sessionPct: quota.session?.usedPct,
    sessionResetsAt: quota.session?.resetsAt,
    weeklyPct: quota.weekly?.usedPct,
    weeklyResetsAt: quota.weekly?.resetsAt,
  };
}

function markActive(list: AccountQuota[]): void {
  attacherAmorces(list);
  attacherEtatConnexion(list);
  attacherJumeaux(list);
  const signatures = signaturesDeGroupe(list.map(releveComparable));
  for (const engine of ['claude', 'codex', 'cursor'] as EngineId[]) {
    // Un compte coupé ne peut pas être « celui qui sert » : on l'écarte du choix.
    const candidates = list
      .filter((q) => q.engine === engine && !q.disabled)
      .sort((a, b) => a.priority - b.priority);
    // « Celui qui sert » doit être celui que `pickAccount` retiendra vraiment :
    // le compte de plus petit rang (priorité) tant qu'il a de la place, puis
    // le suivant dans l'ordre réglé.
    const aPlace = candidates.filter((q) => q.available);
    const chosen =
      compteQuiRecoitLeTravail(
        aPlace.map((q) => ({
          id: q.id,
          plan: q.plan,
          priority: q.priority,
          sessionPct: q.session?.usedPct,
          weeklyPct: q.weekly?.usedPct,
          jumeauDe: signatures.get(q.id),
        })),
      ) ??
      aPlace[0] ??
      candidates[0];
    for (const quota of candidates) quota.active = quota.id === chosen?.id;
  }
}

/**
 * CE QU'ON ACCEPTE D'ATTENDRE POUR RELEVER LES QUOTAS AVANT DE LANCER UN TOUR.
 *
 * Le relevé interroge les comptes L'UN APRÈS L'AUTRE, avec un souffle de 1,5 s
 * entre deux, et un compte peut coûter très cher : douze secondes de lecture,
 * puis, sur un jeton expiré, trente secondes de renouvellement par le moteur,
 * puis douze secondes de relecture. Assez pour dépasser les CINQ MINUTES au bout
 * desquelles la veille referme un tour qui n'a jamais démarré (`tourBloque`) —
 * et la carte meurt sans que le moteur ait lu la première ligne.
 *
 * Le vrai remède est plus haut (`quotasPourChoisirUnCompte` : on ne relève QUE
 * les comptes du moteur demandé). Ce plafond reste la ceinture : un seul moteur
 * dont tous les comptes sont mal en point ne doit pas non plus tuer sa carte.
 */
const DELAI_RELEVE_AVANT_TOUR_MS = 20_000;

/**
 * ON NE RELÈVE QUE LES COMPTES DU MOTEUR QUI VA TRAVAILLER.
 *
 * Le relevé portait sur TOUS les comptes, tous moteurs confondus, alors qu'on
 * cherchait le compte d'un seul moteur. Les autres ne pesaient pas dans la
 * décision — mais ils pesaient dans l'ATTENTE : un compte Codex au jeton expiré
 * a tué des tours Claude le 05.09.2026, deux cartes à deux minutes d'intervalle,
 * en faisant dépasser le plafond de préparation à des tours qui ne lui
 * demandaient rien. Une tâche ne regarde donc que le moteur qu'elle utilise.
 *
 * ET LE PLAFOND RESTE, EN CEINTURE. Passé le délai, on cesse d'attendre — on
 * n'annule pas : la lecture continue en tâche de fond (`refreshQuotas` partage
 * sa promesse) et servira au tour suivant. Le choix se fait alors sur le DERNIER
 * RELEVÉ CONNU, ce que la suite sait déjà traiter : un compte sans quota lu
 * garde sa place et n'est jamais écarté sur une lecture manquante. Partir sur un
 * compte peut-être saturé est sans gravité — le moteur dira sa limite, et un
 * tour coupé par une limite n'est pas un échec —, alors que ne pas partir du
 * tout tue la carte.
 */
async function quotasPourChoisirUnCompte(comptes: readonly AccountRecord[]): Promise<AccountQuota[]> {
  const releve = refreshQuotas(
    false,
    comptes.map((compte) => compte.id),
  );
  let minuteur: NodeJS.Timeout | undefined;
  const echeance = new Promise<null>((resolve) => {
    minuteur = setTimeout(() => resolve(null), DELAI_RELEVE_AVANT_TOUR_MS);
    minuteur.unref?.();
  });
  try {
    const quotas = await Promise.race([releve, echeance]);
    if (quotas) return quotas;
    log.warn(
      `relevé des quotas trop lent (plus de ${DELAI_RELEVE_AVANT_TOUR_MS / 1000} s) : ` +
        'le tour part sur le dernier relevé connu plutôt que d’attendre',
    );
    // Elle continue sans nous : on ne la laisse pas mourir sans avoir été lue.
    void releve.catch(() => undefined);
    return cachedQuotas();
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * LES QUOTAS DU SEUL MOTEUR QUI VA TRAVAILLER, RELEVÉS SOUS PLAFOND.
 *
 * C'est la porte d'entrée des quotas pour tout ce qui prépare un lancement. La
 * porte dure appelait jusqu'ici `refreshQuotas()` NU : tous les comptes, tous
 * moteurs confondus, l'un après l'autre avec 1,5 s de souffle et sans aucun
 * plafond de temps — mesuré à 5,8 s sur quatre comptes en bonne santé
 * (`scripts/mesure-lancement.mjs`), et bien au-delà dès qu'un jeton a expiré
 * (douze secondes de lecture, trente de renouvellement, douze de relecture).
 * Un compte Codex fatigué faisait donc attendre un lancement Claude qui ne lui
 * demandait rien.
 *
 * Le relevé rendu ici est celui du choix de compte : même portée, même plafond,
 * même repli sur le dernier relevé connu. Les deux appels d'un même lancement
 * se partagent la lecture (promesse en cours), puis le cache par compte.
 */
export async function quotasDuMoteur(engine: EngineId): Promise<AccountQuota[]> {
  const comptes = listAccountRecords().filter((account) => account.engine === engine);
  if (!comptes.length) return cachedQuotas();
  return quotasPourChoisirUnCompte(comptes);
}

/**
 * La décision se prend AU LANCEMENT d'un agent : le compte du plus petit rang
 * d'abord, le suivant dans l'ordre réglé en relève. Une limite en plein vol
 * arrête forcément le processus du moteur ; la reprise automatique est alors
 * menée par `server/src/reprise-compte.ts`.
 */
export async function pickAccount(engine: EngineId): Promise<AccountRecord | null> {
  const tous = listAccountRecords()
    .filter((a) => a.engine === engine)
    .sort((a, b) => a.priority - b.priority);
  if (!tous.length) return null;
  /*
   * UN COMPTE À SA LIMITE CONNUE N'EST PAS CANDIDAT, quoi qu'en dise le relevé :
   * le moteur l'a refusé, et le relevé ne voit pas un manque de crédits. Sans
   * cette exclusion, chaque tour ordinaire repartait sur le compte qui venait de
   * tomber (`server/src/limites-connues.ts`, `shared/src/compte-du-tour.ts`).
   */
  const ecartes = comptesEcartesParLimite();
  const accounts = tous.filter((a) => !ecartes.has(a.id));
  if (!accounts.length) {
    log.info(`aucun compte ${engine} candidat : ${tous.map((a) => a.label).join(', ')} à leur limite connue`);
    return null;
  }

  const quotas = await quotasPourChoisirUnCompte(accounts);

  /*
   * L'ORDRE RÉGLÉ D'ABORD, LA PLACE RESTANTE POUR DÉPARTAGER. La règle pure
   * (`shared/src/choix-de-compte.ts`) suit le rang (priorité) réglé sur chaque
   * compte, et ne regarde la place restante que pour deux comptes du même
   * rang. Un compte sans quota lu du tout garde sa place : on ne l'écarte pas
   * sur une lecture manquante.
   */
  /*
   * DEUX COMPTES AU MÊME RELEVÉ NE COMPTENT QUE POUR UN. Leurs coffres
   * aboutissent au même abonnement : la règle pure garde le mieux classé et
   * écarte l'autre, au lieu de croire à une réserve de secours qui n'existe
   * pas (`shared/src/comptes-jumeaux.ts`).
   */
  const signatures = signaturesDeGroupe(quotas.map(releveComparable));

  const disponibles = accounts
    .map((account) => ({ account, quota: quotas.find((q) => q.id === account.id) }))
    .filter(({ quota }) => !quota || quota.available)
    .map(({ account, quota }) => ({
      id: account.id,
      plan: quota?.plan ?? account.plan,
      priority: account.priority,
      sessionPct: quota?.session?.usedPct,
      weeklyPct: quota?.weekly?.usedPct,
      disabled: quota?.disabled,
      jumeauDe: signatures.get(account.id),
      account,
    }));

  const retenu = compteQuiRecoitLeTravail(disponibles);
  if (retenu) {
    const quota = quotas.find((q) => q.id === retenu.id);
    if (quota && !quota.active) {
      log.info(`bascule de compte : ${retenu.account.label} prend le relais (${raisonDuChoix(retenu, disponibles)})`);
      bus.toast('info', `Bascule de compte : ${retenu.account.label}`);
    }
    return retenu.account;
  }
  // Aucun compte n'est marqué disponible. Avant de faire attendre la carte, on
  // regarde s'il en reste un qui n'est pas réellement à 100 % : mieux vaut
  // travailler sur le compte le moins consommé que de refuser à tort.
  const tousLesCandidats = accounts.map((account) => {
    const quota = quotas.find((q) => q.id === account.id);
    return {
      id: account.id,
      plan: quota?.plan ?? account.plan,
      priority: account.priority,
      sessionPct: quota?.session?.usedPct,
      weeklyPct: quota?.weekly?.usedPct,
      disabled: quota?.disabled,
      jumeauDe: signatures.get(account.id),
      account,
    };
  });
  const restant = compteQuiRecoitLeTravail(tousLesCandidats);

  if (restant) {
    log.info(
      `aucun compte marqué disponible : on retient ${restant.account.label}, qui a encore du quota (${raisonDuChoix(restant, tousLesCandidats)})`,
    );
    return restant.account;
  }

  return null; // tous à sec : la carte attend et le dit, elle n'échoue pas
}

/** Un événement de limite reçu en cours d'exécution met le compte de côté. */
/** Les statuts qui signifient vraiment « ce compte ne répond plus ». */
const STATUTS_BLOQUANTS = new Set(['rejected', 'exceeded', 'blocked', 'exhausted', 'limit_reached']);

/**
 * Cet événement de limite BLOQUE-T-IL le compte ? Un avertissement
 * (« allowed_warning ») dit qu'on approche, pas qu'on y est. Exporté parce que
 * le tour lui-même a besoin de le savoir : c'est la preuve la plus sûre qu'un
 * arrêt vient du quota, et non d'une panne.
 */
export function limiteBloquante(statut: string | undefined): boolean {
  return !!statut && STATUTS_BLOQUANTS.has(statut.toLowerCase());
}

export function noteAccountUse(accountId: string, rateLimit: { status: string; resetsAt?: number; type?: string }): void {
  const quota = quotaCache.get(accountId);
  if (!quota) return;
  // Un avertissement (« allowed_warning ») dit qu'on approche de la limite,
  // pas qu'on l'a atteinte : le compte reste utilisable.
  if (limiteBloquante(rateLimit.status)) {
    quota.available = false;
    if (rateLimit.type === 'seven_day' || rateLimit.type === 'weekly') {
      quota.weekly = { ...(quota.weekly ?? {}), resetsAt: rateLimit.resetsAt };
    } else {
      quota.session = { ...(quota.session ?? {}), resetsAt: rateLimit.resetsAt };
    }
    quotaCache.set(accountId, quota);
    bus.emit({ type: 'quotas', quotas: cachedQuotas() });
  }
}
