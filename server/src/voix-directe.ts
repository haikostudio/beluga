/*
 * LA CONVERSATION VOCALE EN DIRECT AVEC CODEX (carte « En-tête du projet et assistant vocal Codex », 15/11/2026).
 *
 * Le module de voix du navigateur ouvre une connexion WebRTC ; ce fichier la fait accepter par Codex, PAR
 * L'ABONNEMENT du compte Codex (jamais de clé payante — décision de l'utilisateur). Le chemin est celui de
 * `codex app-server --enable realtime_conversation` : un fil Codex (`thread/start`), puis
 * `thread/realtime/start` en version V3 et transport WebRTC — la SEULE combinaison que l'abonnement accepte
 * (vérifié le 15/11/2026 sur codex-cli 0.146 et 0.169, MEM-7524 ; ailleurs : « requires API key auth »).
 *
 * L'AGENT DU CHAMP (carte « Mode voix Jarvis dans le champ d'écriture », 17/11/2026) : le bouton voix d'un champ
 * d'écriture branche la conversation sur l'agent de CE champ (une carte) ; « Dis Jarvis » et Cmd+Espace, sans cible,
 * sur l'assistant général. La conversation PRÉPARE une demande : rien ne s'écrit dans le fil pendant la voix (sauf une
 * carte proposée, qui y trouve son message), et à la fermeture une SYNTHÈSE est rédigée par le même Codex puis envoyée
 * au champ (`voix.direct.synthese`), où elle s'ajoute au brouillon sans jamais partir seule.
 *
 * L'agent qui répond par défaut est l'ASSISTANT GÉNÉRAL (mêmes outils, mêmes droits, interlocuteur noté) : le pont d'outils
 * de Beluga est branché comme pour un tour (`surchargesDuPontBeluga`), sous un identifiant de tour propre à la
 * session, que la garde du pont reconnaît (`tourVocalDe`). La voix délègue le travail au fil Codex, qui appelle
 * les outils ; le son, lui, va directement du navigateur au fournisseur — rien d'audio ne passe ni ne reste ici.
 *
 * Ce qui reste : le TEXTE finalisé de chaque tour, dans le flux « Discussions » (`discussions-vocales.ts`),
 * marqué des projets dont il parle. Une erreur se DIT (événement `voix.direct`, état « erreur ») : jamais de
 * repli silencieux vers l'ancienne chaîne dictée + voix du serveur.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ACCENT_DE_LA_VOIX,
  consigneDeLaVoix,
  consigneDuSalut,
  salutDeJarvis,
  appelEnCoursPourLaVoix,
  noteDeContexte,
  questionSurLePasse,
  souvenirsPourLaVoix,
  DISCUSSIONS_EN_SOUVENIR,
  nomDeLAssistant,
  CONSIGNE_DU_DIRECT,
  DELAI_DE_LA_SYNTHESE_MS,
  EFFORT_DU_DIRECT,
  consigneDeLaSynthese,
  syntheseAColler,
  MODELE_DU_DIRECT,
  libelleDeLActivite,
  outilQuiAgit,
  REPRISE_DU_DIRECT_MS,
  VOIX_DU_DIRECT,
  idDeDiscussion,
  nomDeLaVoix,
  projetsCites,
  projetsDesArguments,
  reunirLesMarques,
  sourcesDeLaMemoireCitees,
  voixDuDirectRetenue,
  voixPermises,
  normaliserParole,
  INTITULE_DE_LA_VOIX,
  Message,
  type Agent,
  type CompteUtilisateur,
  type ProjetJoignable,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { CONFIG } from './config.js';
import { getInternalToken } from './auth.js';
import { applyAccountEnv, pickAccount } from './accounts.js';
import { codexAdapter, preparerMaisonDeTour, serveursTiersDuCompte, surchargesDuPontBeluga, texteDuResultatMcp } from './engines/codex.js';
import { agentAssistantGlobal } from './assistant-global.js';
import { noterLInterlocuteur } from './interlocuteur.js';
import { compteParId } from './comptes.js';
import { langueDesAgents } from './langue-configuree.js';
import * as discussions from './discussions-vocales.js';
import { poserLeClientDeLaVoix } from './gestes-de-jarvis.js';

/* ------------------------------------------------------------------ */
/* Le client JSON-RPC de `codex app-server`                             */
/* ------------------------------------------------------------------ */

type Notification = { method: string; params: any };

/** Un processus `codex app-server`, parlé en JSON-RPC ligne à ligne sur son entrée et sa sortie standard. */
class AppServer {
  private enfant: ChildProcess;
  private suivant = 0;
  private attentes = new Map<number, { ok: (v: any) => void; ko: (e: Error) => void; minuterie: NodeJS.Timeout }>();
  private tampon = '';
  private ferme = false;
  onNotification: (n: Notification) => void = () => {};
  onSortie: (code: number | null) => void = () => {};

  constructor(args: string[], env: NodeJS.ProcessEnv, cwd: string) {
    this.enfant = spawn(codexAdapter.binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.enfant.stdout?.setEncoding('utf8');
    this.enfant.stdout?.on('data', (morceau: string) => this.lire(morceau));
    this.enfant.stderr?.on('data', () => {
      /* journal de Codex : bavard (avertissements du bac à sable), sans rien d'utile à l'écran */
    });
    this.enfant.on('exit', (code) => {
      this.ferme = true;
      for (const [, attente] of this.attentes) {
        clearTimeout(attente.minuterie);
        attente.ko(new Error('Codex s’est arrêté.'));
      }
      this.attentes.clear();
      this.onSortie(code);
    });
    this.enfant.on('error', (err) => log.warn(`direct vocal : Codex n'a pas pu démarrer — ${err.message}`));
  }

  private lire(morceau: string): void {
    this.tampon += morceau;
    let i: number;
    while ((i = this.tampon.indexOf('\n')) >= 0) {
      const ligne = this.tampon.slice(0, i).trim();
      this.tampon = this.tampon.slice(i + 1);
      if (!ligne) continue;
      let message: any;
      try {
        message = JSON.parse(ligne);
      } catch {
        continue;
      }
      if (message.id != null && this.attentes.has(message.id)) {
        const attente = this.attentes.get(message.id)!;
        this.attentes.delete(message.id);
        clearTimeout(attente.minuterie);
        if (message.error) attente.ko(new Error(String(message.error.message ?? 'refus de Codex')));
        else attente.ok(message.result ?? {});
      } else if (typeof message.method === 'string') {
        try {
          this.onNotification({ method: message.method, params: message.params ?? {} });
        } catch (err) {
          log.warn('direct vocal : notification non traitée', err);
        }
      }
    }
  }

  appeler<T = any>(method: string, params: unknown, delaiMs = 30_000): Promise<T> {
    if (this.ferme) return Promise.reject(new Error('Codex n’est plus joignable.'));
    const id = ++this.suivant;
    return new Promise<T>((ok, ko) => {
      const minuterie = setTimeout(() => {
        this.attentes.delete(id);
        ko(new Error(`Codex n’a pas répondu (${method}).`));
      }, delaiMs);
      this.attentes.set(id, { ok, ko, minuterie });
      this.enfant.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notifier(method: string, params: unknown = {}): void {
    if (!this.ferme) this.enfant.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async initialiser(): Promise<void> {
    await this.appeler('initialize', { clientInfo: { name: 'beluga-voix', version: '1' }, capabilities: { experimentalApi: true } }, 20_000);
    this.notifier('initialized');
  }

  /** Le processus s'est-il arrêté (ou a-t-il été fermé) ? */
  estFerme(): boolean {
    return this.ferme;
  }

  fermer(): void {
    if (this.ferme) return;
    this.enfant.stdin?.end();
    this.enfant.kill('SIGTERM');
    const enfant = this.enfant;
    setTimeout(() => {
      if (enfant.exitCode == null && enfant.signalCode == null) enfant.kill('SIGKILL');
    }, 3000).unref();
  }
}

/* ------------------------------------------------------------------ */
/* L'état de la session                                                 */
/* ------------------------------------------------------------------ */

interface Session {
  tour: string;
  agentId: string;
  compteId: string;
  serveur: AppServer;
  threadId: string;
  discussion: number;
  /** Le message du fil qui porte les cartes proposées à la voix : créé à la première seulement. */
  messageId?: string;
  voix: string;
  enCours: { user: string; assistant: string };
  /** Les tours finalisés de la session, pour la synthèse de fin. */
  transcription: { role: 'user' | 'assistant'; texte: string }[];
  /** À qui la synthèse s'adresse, en mots courants (« l’assistant de Beluga », « l’agent de la tâche « … » »). */
  destinataire: string;
  cwd: string;
  sourcesEnAttente: number;
  projetsEnAttente: string[];
  derniereTache?: string;
  /**
   * L'écran fait entendre l'appel « Jarvis ? » au début (ouverture d'un clic) : la première phrase de l'utilisateur
   * entendue, si elle n'est que cet appel, n'a pas de bulle et n'entre pas dans la synthèse.
   */
  appelEnAttente: boolean;
  /** Le prénom de la personne qui parle : le salut le dit (`consigneDuSalut`). */
  prenom: string;
  /** Le salut a-t-il déjà été demandé pour cette ouverture ? (Un seul par ouverture voulue.) */
  salue: boolean;
  /** Faux quand la ligne s'est rouverte d'elle-même (reconnexion) : pas de salut. */
  salutVoulu: boolean;
  arret: boolean;
  /** Quand la session s'est ouverte (le journal de fermeture dit sa durée). */
  ouverteLe: number;
  /** Pourquoi l'écran l'a fermée (bouton, veille, coupure, rechargement…) : le journal le dit. */
  raison?: string;
}

let session: Session | null = null;
/** La dernière session close : relancée dans le délai, elle reprend le même fil et la même discussion. */
let derniere: { threadId: string; discussion: number; compteId: string; agentId: string; messageId?: string; fin: number } | null = null;

/**
 * LE TOUR VOCAL EN COURS D'OUVERTURE (17/11/2026). Codex lance son pont d'outils DÈS le démarrage de l'app-server,
 * bien avant que la session soit posée (après la réponse SDP) : sans ce registre, `/internal/pont` puis
 * `/internal/tools` refusaient « tour terminé » et Jarvis restait SANS AUCUN OUTIL pour toute la conversation (il ne
 * créait jamais de carte). Posé avant `lancerAppServer`, retiré dès que la session prend le relais ou que l'ouverture
 * échoue : un ancien identifiant reste refusé.
 */
let ouverture: { agentId: string; tour: string } | null = null;

/**
 * LA RÉSERVE : JARVIS PRÊT À L'AVANCE (carte « Jarvis n'entend ni ne répond », décision de l'utilisateur du
 * 17/11/2026 : « il faut quelques secondes avant qu'il ne puisse m'écouter »). Tant qu'un écran a la voix activée et
 * le dit (`voix.direct.preparer`, redit toutes les quelques minutes), un `codex app-server` de l'ASSISTANT attend,
 * lancé, initialisé, sa consigne calculée et son fil ouvert. L'ouverture n'a plus qu'à faire `thread/realtime/start`
 * — JAMAIS fait à l'avance : la ligne vocale consommerait l'abonnement. Une seule réserve ; rafraîchie après
 * `DUREE_DE_LA_RESERVE_MS`, fermée quand plus aucun écran ne la demande. Son tour est connu de la garde du pont DÈS
 * son lancement (`tourVocalDe`) : Codex lance son pont d'outils au démarrage, sinon Jarvis restait sans outils.
 */
interface Reserve {
  tour: string;
  agentId: string;
  compteId: string;
  cwd: string;
  serveur: AppServer | null;
  consigne: string;
  threadId: string;
  le: number;
  /** Vrai quand la réserve est prête ; faux si elle n'a pas pu se monter. */
  pret: Promise<boolean>;
}

let reserve: Reserve | null = null;
/** Les tours des sessions closes il y a peu, encore reçus par le pont (`tourVocalDe`). */
const toursEnGrace = new Map<string, { agentId: string; jusqua: number }>();
/** Le temps qu'une session close garde son tour : un outil en vol finit, la synthèse aussi. */
export const GRACE_DU_TOUR_VOCAL_MS = 45_000;
/** Le dernier écran qui a demandé que Jarvis soit prêt. */
let reserveDemandeeLe = 0;
let surveillanceDeLaReserve: NodeJS.Timeout | null = null;
/** Au-delà, la réserve est remontée (consigne relue). */
export const DUREE_DE_LA_RESERVE_MS = 15 * 60 * 1000;
/** Sans nouvelle demande pendant ce temps (écran fermé, voix coupée), la réserve est fermée. */
export const ABANDON_DE_LA_RESERVE_MS = 6 * 60 * 1000;

/** L'identifiant de tour de la session vocale de cet agent (ouverte, en ouverture ou en réserve) : la garde du pont l'accepte. */
export function tourVocalDe(agentId: string, tourAnnonce?: string): string | undefined {
  if (session && session.agentId === agentId && !session.arret) return session.tour;
  /* LA GRÂCE D'UNE SESSION FERMÉE (18/11/2026) : un appel d'outil parti juste avant la fermeture (ou le fil de la
     synthèse, qui démarre son pont après) finit au lieu d'être refusé « tour terminé ». Le même agent, le même tour,
     `GRACE_DU_TOUR_VOCAL_MS` au plus : jamais la porte d'un autre agent. */
  const maintenant = Date.now();
  for (const [tour, g] of toursEnGrace) if (g.jusqua < maintenant) toursEnGrace.delete(tour);
  if (tourAnnonce && toursEnGrace.get(tourAnnonce)?.agentId === agentId) return tourAnnonce;
  if (ouverture && ouverture.agentId === agentId) return ouverture.tour;
  return reserve && reserve.agentId === agentId ? reserve.tour : undefined;
}

function fermerLaReserve(): void {
  const r = reserve;
  reserve = null;
  if (r) void r.pret.then(() => r.serveur?.fermer());
}

function monterLaReserve(): void {
  const assistant = agentAssistantGlobal();
  if (!assistant || reserve) return;
  const cwd = assistant.workdir || path.join(os.homedir(), '.beluga', 'atelier-assistant');
  const r: Reserve = { tour: `voix-${crypto.randomUUID()}`, agentId: assistant.id, compteId: '', cwd, serveur: null, consigne: '', threadId: '', le: Date.now(), pret: Promise.resolve(false) };
  reserve = r;
  r.pret = (async () => {
    const debut = Date.now();
    try {
      const { id, codexHome } = await compteCodex();
      r.compteId = id;
      const serveur = lancerAppServer(codexHome, cwd, { agentId: r.agentId, tour: r.tour });
      r.serveur = serveur;
      serveur.onSortie = () => {
        if (reserve === r) reserve = null;
      };
      await serveur.initialiser();
      r.consigne = await consigneDeLAssistant(r.agentId, assistant.projectId);
      const t = await serveur.appeler<{ thread: { id: string } }>('thread/start', {
        cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        developerInstructions: r.consigne,
        model: MODELE_DU_DIRECT,
        config: { model_reasoning_effort: EFFORT_DU_DIRECT },
      });
      r.threadId = t.thread.id;
      log.info(`direct vocal : Jarvis prêt à l'avance (${Date.now() - debut} ms)`);
      return true;
    } catch (err) {
      log.warn(`direct vocal : la réserve n'a pas pu se préparer — ${(err as Error).message}`);
      if (reserve === r) reserve = null;
      r.serveur?.fermer();
      return false;
    }
  })();
}

/** Remonte la réserve si un écran la demande encore, sans session ni ouverture en cours. */
function reprendreLaReserve(): void {
  if (Date.now() - reserveDemandeeLe > ABANDON_DE_LA_RESERVE_MS) {
    fermerLaReserve();
    return;
  }
  if (session || ouverture) return;
  if (reserve && Date.now() - reserve.le > DUREE_DE_LA_RESERVE_MS) fermerLaReserve();
  if (!reserve) monterLaReserve();
}

/**
 * `voix.direct.preparer` : un écran a la voix activée, Jarvis doit être prêt. Répond tout de suite ; la réserve se
 * monte en arrière-plan.
 */
export function preparerLeDirect(): { ok: true } {
  reserveDemandeeLe = Date.now();
  if (!surveillanceDeLaReserve) {
    surveillanceDeLaReserve = setInterval(reprendreLaReserve, 60_000);
    surveillanceDeLaReserve.unref();
  }
  reprendreLaReserve();
  return { ok: true };
}

/** Prend la réserve de cet agent pour une ouverture (attend qu'elle soit prête) ; `null` : chemin ordinaire. */
async function prendreLaReserve(agentId: string): Promise<Reserve | null> {
  const r = reserve;
  if (!r || r.agentId !== agentId) return null;
  reserve = null;
  // Le tour de la réserve devient celui de l'ouverture : la garde du pont ne le refuse à aucun moment.
  ouverture = { agentId, tour: r.tour };
  const pret = await Promise.race([r.pret, new Promise<boolean>((fini) => setTimeout(() => fini(false), 20_000).unref())]);
  if (pret && r.serveur && !r.serveur.estFerme()) return r;
  r.serveur?.fermer();
  if (ouverture?.tour === r.tour) ouverture = null;
  return null;
}

/** Pour les tests : poser ou retirer un tour vocal en ouverture. */
export function poserLOuvertureVocalePourEssai(valeur: { agentId: string; tour: string } | null): void {
  ouverture = valeur;
}

/**
 * Le message du fil qui porte CE QUE JARVIS PRODUIT pendant la session — cartes proposées, images, documents, fichiers
 * (17/11/2026) —, sous l'intitulé « Jarvis · conversation vocale ». Créé à la PREMIÈRE production seulement ; les
 * phrases de l'échange, elles, restent dans les bulles et n'entrent pas dans le fil.
 */
export function messageDeLaSessionVocale(agentId: string, tour: string | undefined): string | undefined {
  if (!session || session.agentId !== agentId || session.tour !== tour) return undefined;
  /* Appelée à CHAQUE production : l'écran déplie le volet si la conversation se tenait dans la bulle vocale. */
  bus.emit({ type: 'voix.direct.production', agentId });
  if (session.messageId && store.getMessage(session.messageId)) return session.messageId;
  const message = store.saveMessage(
    Message.parse({
      id: store.newId(),
      agentId,
      role: 'assistant',
      content: INTITULE_DE_LA_VOIX,
      createdAt: store.now(),
    }),
  );
  bus.emit({ type: 'message.upsert', message });
  session.messageId = message.id;
  return message.id;
}

function projetsJoignables(): ProjetJoignable[] {
  return store.listProjects().map((p) => ({ id: p.id, name: p.name, archived: (p as { archived?: boolean }).archived }));
}

function annoncer(
  etat: 'connexion' | 'en-direct' | 'synthese' | 'arrete' | 'erreur',
  extra: { message?: string; voix?: string; discussion?: string; agentId?: string } = {},
): void {
  bus.emit({ type: 'voix.direct', etat, ...extra });
}

/** Une erreur de Codex, dite en mots courants. */
export function erreurLisible(brute: string): string {
  if (/api key auth/i.test(brute)) {
    return 'Codex refuse le direct avec ce compte : la conversation en direct par l’abonnement n’est plus acceptée (mise à jour de Codex ?).';
  }
  if (/usage|limit|quota|rate/i.test(brute)) return 'Le compte Codex a atteint sa limite pour la voix en direct. Réessayez plus tard.';
  return `Le direct avec Codex s’est interrompu : ${brute}`;
}

/* ------------------------------------------------------------------ */
/* Lancer Codex                                                         */
/* ------------------------------------------------------------------ */

const MAISONS = () => path.join(os.homedir(), '.beluga', 'maisons-codex');

async function compteCodex(): Promise<{ id: string; codexHome: string }> {
  const compte = await pickAccount('codex');
  if (!compte) throw new Error('Aucun compte Codex disponible : reliez un compte Codex (Réglages › Comptes et quotas), ou attendez qu’un compte retrouve du quota.');
  const env = applyAccountEnv(compte);
  const codexHome = env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
  return { id: compte.id, codexHome };
}

function lancerAppServer(codexHome: string, cwd: string, pont?: { agentId: string; tour: string }): AppServer {
  const args = ['app-server', '--enable', 'realtime_conversation'];
  if (pont) {
    // LA CONVERSATION RÉFLÉCHIT FORT (`EFFORT_DU_DIRECT`, « high »), SUR SOL (`MODELE_DU_DIRECT`, le plus puissant) : tout tour délégué
    // par la voix en hérite, quel que soit le `config.toml` du compte.
    args.push('-c', `model_reasoning_effort="${EFFORT_DU_DIRECT}"`, '-c', `model="${MODELE_DU_DIRECT}"`);
    args.push(
      ...surchargesDuPontBeluga({
        mcpBridgePath: path.join(CONFIG.selfPath, 'server', 'mcp-bridge.mjs'),
        env: {
          BELUGA_TOKEN: getInternalToken(),
          BELUGA_URL: `http://127.0.0.1:${CONFIG.port}`,
          BELUGA_AGENT: pont.agentId,
          BELUGA_TOUR: pont.tour,
          CODEX_HOME: codexHome,
        },
      }),
    );
  } else {
    // L'extrait d'une voix n'a besoin d'aucun outil : les serveurs du compte sont éteints, la mémoire de Codex aussi.
    for (const nom of serveursTiersDuCompte(codexHome)) args.push('-c', `mcp_servers.${nom}.enabled=false`);
    args.push('-c', 'features.memories=false');
  }
  let maison = codexHome;
  try {
    maison = preparerMaisonDeTour(codexHome, MAISONS());
  } catch {
    /* le dossier du compte reste utilisé tel quel */
  }
  fs.mkdirSync(cwd, { recursive: true });
  return new AppServer(args, { ...process.env, CODEX_HOME: maison, FORCE_COLOR: '0' }, cwd);
}

/** Attend la réponse SDP (ou l'erreur) que Codex rend après `thread/realtime/start`. */
function attendreLaReponse(serveur: AppServer, threadId: string, delaiMs = 45_000): { promesse: Promise<string>; traiter: (n: Notification) => boolean } {
  let ok!: (sdp: string) => void;
  let ko!: (e: Error) => void;
  let fini = false;
  const promesse = new Promise<string>((a, b) => {
    ok = a;
    ko = b;
  });
  const minuterie = setTimeout(() => {
    if (fini) return;
    fini = true;
    ko(new Error('Codex n’a pas ouvert la session vocale à temps.'));
  }, delaiMs);
  void serveur;
  const traiter = (n: Notification): boolean => {
    if (fini || n.params?.threadId !== threadId) return false;
    if (n.method === 'thread/realtime/sdp' && typeof n.params.sdp === 'string') {
      fini = true;
      clearTimeout(minuterie);
      ok(n.params.sdp);
      return true;
    }
    if (n.method === 'thread/realtime/error') {
      fini = true;
      clearTimeout(minuterie);
      ko(new Error(String(n.params.message ?? 'refus de Codex')));
      return true;
    }
    return false;
  };
  return { promesse, traiter };
}

/* ------------------------------------------------------------------ */
/* Les voix                                                             */
/* ------------------------------------------------------------------ */

let voixEnCache: { liste: string[]; le: number } | null = null;
const DUREE_DU_CACHE_DES_VOIX = 6 * 60 * 60 * 1000;

/** Les voix du direct (V3), lues chez Codex et gardées six heures ; la liste connue en repli. */
export async function voixDuDirect(): Promise<string[]> {
  if (voixEnCache && Date.now() - voixEnCache.le < DUREE_DU_CACHE_DES_VOIX) return voixEnCache.liste;
  let serveur: AppServer | null = null;
  try {
    const { codexHome } = await compteCodex();
    serveur = lancerAppServer(codexHome, path.join(os.homedir(), '.beluga', 'atelier-voix'));
    await serveur.initialiser();
    const t = await serveur.appeler<{ thread: { id: string } }>('thread/start', { cwd: path.join(os.homedir(), '.beluga', 'atelier-voix'), ephemeral: true });
    const r = await serveur.appeler<{ voices?: { v3?: unknown } }>('thread/realtime/listVoices', { threadId: t.thread.id }, 15_000);
    const liste = voixPermises(r?.voices?.v3);
    voixEnCache = { liste: liste.length ? liste : [...VOIX_DU_DIRECT], le: Date.now() };
  } catch (err) {
    log.warn(`direct vocal : liste des voix illisible (${(err as Error).message}), liste connue en repli`);
    voixEnCache = { liste: [...VOIX_DU_DIRECT], le: Date.now() - DUREE_DU_CACHE_DES_VOIX + 10 * 60 * 1000 };
  } finally {
    serveur?.fermer();
  }
  return voixEnCache.liste;
}

/* ------------------------------------------------------------------ */
/* La session                                                           */
/* ------------------------------------------------------------------ */

async function consigneDeLAssistant(agentId: string, projectId: string): Promise<string> {
  const { consigneDeLAssistantGlobal } = await import('./runtime.js');
  const projet = store.getProject(projectId);
  let consigne = consigneDeLAssistantGlobal(!!projet?.isSelf, 'codex', langueDesAgents());
  try {
    const { guideDesServicesDeLAgent } = await import('./services-des-agents.js');
    const guide = await guideDesServicesDeLAgent(agentId, projectId);
    if (guide) consigne = `${consigne}\n\n${guide}`;
  } catch {
    /* le guide des services n'est qu'un complément */
  }
  return `${consigne}\n\n${CONSIGNE_DU_DIRECT}`;
}

/**
 * LA CONSIGNE DE LA VOIX POUR L'AGENT D'UNE CARTE : celle de l'assistant (mêmes règles de voix) et, devant, ce que la
 * carte demande — titre, description et derniers échanges du fil —, pour que Jarvis questionne en connaissant la tâche.
 */
async function consigneDeLaCarte(agent: Agent): Promise<string> {
  const carte = agent.cardId ? store.getCard(agent.cardId) : null;
  const projet = store.getProject(agent.projectId);
  const derniers = store
    .listMessages(agent.id, 12)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Agent'} : ${m.content.replace(/\s+/g, ' ').trim().slice(0, 600)}`);
  const contexte = [
    'TU PARLES POUR L’AGENT D’UNE TÂCHE, depuis le champ d’écriture de sa carte : l’utilisateur prépare ce qu’il va lui écrire.',
    carte ? `Tâche : « ${carte.title} »${projet ? ` (projet ${projet.name})` : ''}.` : '',
    carte?.description?.trim() ? `Ce qu’elle demande : ${carte.description.trim().slice(0, 1500)}` : '',
    derniers.length ? `Les derniers échanges de son fil :\n${derniers.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `${await consigneDeLAssistant(agent.id, agent.projectId)}\n\n${contexte}`;
}

/** À qui la synthèse s'adresse, en mots courants. */
function destinataireDe(agent: Agent): string {
  const carte = agent.cardId ? store.getCard(agent.cardId) : null;
  return carte ? `l’agent de la tâche « ${carte.title} »` : 'l’assistant de Beluga';
}

/** Le prénom du compte qui ouvre la conversation (relu en base : il a pu changer depuis la connexion). */
function prenomDeLInterlocuteur(compte?: Pick<CompteUtilisateur, 'id'>): string {
  if (!compte) return '';
  try {
    return compteParId(compte.id)?.prenom ?? '';
  } catch {
    return '';
  }
}

/** Les tours de la discussion en cours (une reprise), rédigés pour la voix ; vide quand la lecture échoue. */
function appelEnCoursDeLaVoix(discussion: number): string {
  try {
    return appelEnCoursPourLaVoix(discussions.lireDiscussion(discussion)?.echanges ?? []);
  } catch (err) {
    log.warn(`direct vocal : appel en cours illisible — ${(err as Error).message}`);
    return '';
  }
}

/**
 * LE SALUT, DIT DÈS QUE L'ÉCRAN A LA LIGNE (18/11/2026) : une consigne glissée en rôle « developer » le fait dire mot
 * pour mot (essai réel, `consigneDuSalut`). Une seule fois par ouverture voulue ; rien pour une reconnexion.
 */
export async function saluerLeDirect(): Promise<{ ok: boolean; salut?: string }> {
  const courante = session;
  if (!courante || courante.arret || !courante.salutVoulu || courante.salue) return { ok: false };
  courante.salue = true;
  try {
    await courante.serveur.appeler('thread/realtime/appendText', { threadId: courante.threadId, text: consigneDuSalut(courante.prenom), role: 'developer' }, 5000);
    return { ok: true, salut: salutDeJarvis(courante.prenom) };
  } catch (err) {
    log.warn(`direct vocal : le salut n’a pas pu partir — ${(err as Error).message}`);
    return { ok: false };
  }
}

/**
 * LA RECHERCHE FAITE PAR BELUGA POUR LA VOIX (décision du 18/11/2026) : une phrase qui renvoie au passé déclenche,
 * en parallèle et sous `DELAI_DE_LA_RECHERCHE_MS`, trois recherches LOCALES (discussions vocales par les mots ramenés à
 * leur racine, mémoire du projet par le même moteur que les agents, tâches de tous les projets), puis une note glissée à la
 * voix. Jamais d'exception : une recherche qui tarde ou tombe est seulement absente de la note.
 */
export const DELAI_DE_LA_RECHERCHE_MS = 1500;

async function avantLeDelai<T>(travail: Promise<T>, repli: T, delaiMs = DELAI_DE_LA_RECHERCHE_MS): Promise<T> {
  let minuterie: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([travail.catch(() => repli), new Promise<T>((ok) => (minuterie = setTimeout(() => ok(repli), delaiMs)))]);
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

export async function chercherPourLaVoix(demande: string, o: { projectId?: string; sauf?: number } = {}): Promise<{ discussions: string[]; memoire: string[]; cartes: string[] }> {
  const jour = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const [disc, unites, cartes] = await Promise.all([
    avantLeDelai(
      Promise.resolve().then(() =>
        discussions
          .chercherDiscussionsPourLaVoix(demande, { projectId: o.projectId, sauf: o.sauf, limite: 3 })
          .map((d) => `- ${d.id}, le ${jour(d.debut)} : ${discussions.derniersEchanges(d.numero, 500)}`),
      ),
      [] as string[],
    ),
    avantLeDelai(
      import('./connaissances.js')
        .then(({ chercherUnitesMelees }) => chercherUnitesMelees(demande, o.projectId ? { projectId: o.projectId, limite: 4 } : { tous: true, limite: 4 }))
        .then((liste) => liste.slice(0, 4).map((t) => `- ${t.unite.id} — ${t.unite.titre} : ${String(t.unite.resume ?? '').slice(0, 220)}`)),
      [] as string[],
    ),
    avantLeDelai(
      import('./assistant-global.js').then(({ cartesApprochantes }) => cartesApprochantes(demande, 4)),
      [] as string[],
    ),
  ]);
  return { discussions: disc, memoire: unites, cartes };
}

async function glisserLeContexte(courante: Session, demande: string): Promise<void> {
  const debut = Date.now();
  const trouve = await chercherPourLaVoix(demande, { sauf: courante.discussion });
  if (session !== courante || courante.arret) return;
  try {
    await courante.serveur.appeler('thread/realtime/appendText', { threadId: courante.threadId, text: noteDeContexte(demande, trouve), role: 'developer' }, 5000);
    log.info(
      `direct vocal : contexte retrouvé pour la voix en ${Date.now() - debut} ms — ${trouve.discussions.length} discussion(s), ${trouve.memoire.length} unité(s), ${trouve.cartes.length} tâche(s)`,
    );
  } catch (err) {
    log.warn(`direct vocal : contexte non glissé — ${(err as Error).message}`);
  }
}

/** Les dernières discussions de cet agent, rédigées pour la voix ; vide quand la lecture échoue (jamais bloquant). */
function souvenirsDeLaVoix(agentId: string, discussionCourante: number): string {
  try {
    return souvenirsPourLaVoix(discussions.dernieresDiscussions(agentId, DISCUSSIONS_EN_SOUVENIR, discussionCourante));
  } catch (err) {
    log.warn(`direct vocal : souvenirs illisibles — ${(err as Error).message}`);
    return '';
  }
}

/**
 * OUVRE LE DIRECT : l'offre WebRTC du navigateur part chez Codex, la réponse revient au navigateur. Une session
 * déjà ouverte est d'abord close (une seule à la fois). Rend la réponse SDP, la voix retenue et la discussion.
 */
export async function demarrerLeDirect(
  offre: string,
  voixDemandee: string | undefined,
  compte?: Pick<CompteUtilisateur, 'id' | 'role'>,
  client?: string,
  agentIdCible?: string,
  appel = false,
): Promise<{ sdp: string; voix: string; discussion: string; agentId: string; appel: boolean }> {
  if (!/^v=0/.test(offre)) throw new Error('Offre de connexion invalide.');
  // L'ancienne session se détache tout de suite ; sa synthèse s'écrit à côté, sans retarder la nouvelle.
  if (session) void arreterLeDirect();
  // L'AGENT DU CHAMP où l'on a appuyé ; sans cible (« Dis Jarvis », Cmd+Espace), TOUJOURS l'assistant.
  const assistant = agentAssistantGlobal();
  const cible = agentIdCible && agentIdCible !== assistant?.id ? store.getAgent(agentIdCible) : null;
  if (agentIdCible && !cible && agentIdCible !== assistant?.id) throw new Error('L’agent de ce champ est introuvable.');
  const agent = cible ?? assistant;
  if (!agent) throw new Error('L’assistant de Beluga est introuvable : aucun projet n’est ouvert.');
  annoncer('connexion');
  const debut = Date.now();
  let tour = `voix-${crypto.randomUUID()}`;
  let serveur: AppServer | null = null;
  try {
    // JARVIS PRÊT À L'AVANCE : la réserve de l'assistant épargne le lancement de Codex, sa consigne et son fil.
    const prete = cible ? null : await prendreLaReserve(agent.id);
    let compteId: string;
    let cwd: string;
    let consigne: string;
    if (prete && prete.serveur) {
      tour = prete.tour;
      compteId = prete.compteId;
      cwd = prete.cwd;
      serveur = prete.serveur;
      consigne = prete.consigne;
    } else {
      const compte = await compteCodex();
      compteId = compte.id;
      cwd = agent.workdir || path.join(os.homedir(), '.beluga', 'atelier-assistant');
      ouverture = { agentId: agent.id, tour };
      serveur = lancerAppServer(compte.codexHome, cwd, { agentId: agent.id, tour });
      await serveur.initialiser();
      consigne = cible ? await consigneDeLaCarte(cible) : await consigneDeLAssistant(agent.id, agent.projectId);
    }
    const lance = Date.now();

    // UNE RELANCE PROCHE REPREND LE MÊME FIL ET LA MÊME DISCUSSION (changement de voix, coupure du réseau).
    const reprise = derniere && derniere.compteId === compteId && derniere.agentId === agent.id && Date.now() - derniere.fin < REPRISE_DU_DIRECT_MS && discussions.lireDiscussion(derniere.discussion) ? derniere : null;
    let threadId = '';
    if (reprise) {
      try {
        const r = await serveur.appeler<{ thread: { id: string } }>('thread/resume', {
          threadId: reprise.threadId,
          developerInstructions: consigne,
          approvalPolicy: 'never',
          sandbox: 'danger-full-access',
          model: MODELE_DU_DIRECT,
          config: { model_reasoning_effort: EFFORT_DU_DIRECT },
        });
        threadId = r.thread?.id ?? reprise.threadId;
      } catch {
        threadId = '';
      }
    }
    if (!threadId && prete?.threadId) threadId = prete.threadId;
    if (!threadId) {
      const r = await serveur.appeler<{ thread: { id: string } }>('thread/start', {
        cwd,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        developerInstructions: consigne,
        model: MODELE_DU_DIRECT,
          config: { model_reasoning_effort: EFFORT_DU_DIRECT },
      });
      threadId = r.thread.id;
    }
    const discussion = reprise && threadId === reprise.threadId ? reprise.discussion : discussions.ouvrirDiscussion({ agentId: agent.id, threadId, compte: compteId });
    if (reprise && discussion === reprise.discussion) discussions.rouvrirDiscussion(discussion);
    const messageId = reprise && discussion === reprise.discussion ? reprise.messageId : undefined;

    const voix = voixDuDirectRetenue(voixDemandee ?? store.getSettings().voixCodexDirect, voixEnCache?.liste ?? VOIX_DU_DIRECT);
    const reponse = attendreLaReponse(serveur, threadId);
    const nouvelle: Session = {
      tour,
      agentId: agent.id,
      compteId,
      serveur,
      threadId,
      discussion,
      messageId,
      voix,
      enCours: { user: '', assistant: '' },
      transcription: [],
      destinataire: destinataireDe(agent),
      cwd,
      sourcesEnAttente: 0,
      projetsEnAttente: [],
      // Plus aucun son « Jarvis ? » n'est joué : aucune phrase n'est à cacher.
      appelEnAttente: false,
      prenom: prenomDeLInterlocuteur(compte),
      salue: false,
      // LE SALUT À CHAQUE OUVERTURE VOULUE (décision du 18/11/2026), reprise du même fil comprise ; seule une
      // reconnexion automatique (`appel` faux) s'en passe. Il est dit quand l'écran a la ligne (`saluerLeDirect`).
      salutVoulu: appel,
      arret: false,
      ouverteLe: Date.now(),
    };
    serveur.onNotification = (n) => {
      if (reponse.traiter(n)) return;
      traiterLaNotification(nouvelle, n);
    };
    serveur.onSortie = () => {
      if (session === nouvelle && !nouvelle.arret) {
        annoncer('erreur', { message: 'Codex s’est arrêté pendant le direct.' });
        clore(nouvelle);
      }
    };
    session = nouvelle;
    if (ouverture?.tour === tour) ouverture = null;
    // L'ÉCRAN QUI PARLE est celui où Jarvis jouera ses gestes (`gestes-de-jarvis.ts`) — jamais un autre onglet.
    poserLeClientDeLaVoix(client);
    if (compte) noterLInterlocuteur({ agentId: agent.id }, compte);

    await serveur.appeler('thread/realtime/start', {
      threadId,
      outputModality: 'audio',
      version: 'v3',
      transport: { type: 'webrtc', sdp: offre },
      voice: voix,
      // LES SOUVENIRS sont relus ICI, à l'ouverture (jamais dans la réserve, qui peut dater de plusieurs minutes).
      prompt: consigneDeLaVoix(nomDeLAssistant(store.getSettings()), prenomDeLInterlocuteur(compte), {
        // « La ligne vient de se rétablir » : seulement pour une reconnexion automatique.
        reprise: !!reprise && !appel,
        souvenirs: souvenirsDeLaVoix(agent.id, discussion),
        // CET APPEL, JUSQU'ICI : une reprise du même fil emporte ce qui vient d'être dit (DISC-0038, 06:34).
        appelEnCours: reprise && discussion === reprise.discussion ? appelEnCoursDeLaVoix(discussion) : '',
      }),
    });
    const sdp = await reponse.promesse;
    annoncer('en-direct', { voix, discussion: idDeDiscussion(discussion), agentId: agent.id });
    // Les durées de l'ouverture, pour mesurer ce que la réserve fait gagner (et voir où une ouverture lente coince).
    log.info(
      `direct vocal ouvert (voix ${voix}, ${idDeDiscussion(discussion)}, agent ${agent.id}) en ${Date.now() - debut} ms — ` +
        `${prete ? 'Jarvis prêt à l’avance' : `Codex lancé en ${lance - debut} ms`}, ligne ouverte en ${Date.now() - lance} ms` +
        `${reprise ? ', reprise' : ''}${appel ? ', salut demandé' : ', reconnexion sans salut'}`,
    );
    return { sdp, voix, discussion: idDeDiscussion(discussion), agentId: agent.id, appel };
  } catch (err) {
    const message = erreurLisible((err as Error).message);
    log.warn(`direct vocal : ouverture échouée après ${Date.now() - debut} ms — ${(err as Error).message}`);
    if (ouverture?.tour === tour) ouverture = null;
    if (session && session.tour === tour) clore(session);
    else serveur?.fermer();
    annoncer('erreur', { message });
    throw new Error(message);
  }
}

/**
 * FERME LA SESSION, PUIS FAIT RÉDIGER LA SYNTHÈSE (17/11/2026). La session se DÉTACHE tout de suite (une nouvelle peut
 * s'ouvrir, le pont d'outils refuse désormais ses appels) ; le direct s'arrête chez Codex ; si l'utilisateur a parlé,
 * le même Codex rédige la demande préparée — bornée à `DELAI_DE_LA_SYNTHESE_MS` — AVANT que le processus s'éteigne ;
 * puis `voix.direct.synthese` la porte au champ de l'agent. Un échec se dit, jamais un champ muet.
 */
export async function arreterLeDirect(raison?: string): Promise<{ ok: true }> {
  const courante = session;
  if (!courante) return { ok: true };
  courante.arret = true;
  courante.raison = raison;
  session = null;
  toursEnGrace.set(courante.tour, { agentId: courante.agentId, jusqua: Date.now() + GRACE_DU_TOUR_VOCAL_MS });
  // Un tour à moitié dit compte aussi : on garde ce qui a été entendu.
  for (const role of ['user', 'assistant'] as const) {
    const reste = courante.enCours[role].trim();
    if (reste) courante.transcription.push({ role, texte: reste });
  }
  const aSynthetiser = courante.transcription.some((tour) => tour.role === 'user');
  if (aSynthetiser) annoncer('synthese', { agentId: courante.agentId });
  try {
    await courante.serveur.appeler('thread/realtime/stop', { threadId: courante.threadId }, 5000);
  } catch {
    /* le processus s'éteint de toute façon */
  }
  let synthese: { texte: string } | { erreur: string } | null = null;
  if (aSynthetiser) {
    try {
      synthese = { texte: syntheseAColler(await redigerLaSynthese(courante)) };
    } catch (err) {
      synthese = { erreur: `La synthèse n’a pas pu s’écrire : ${(err as Error).message}` };
    }
  }
  clore(courante);
  if (synthese) bus.emit({ type: 'voix.direct.synthese', agentId: courante.agentId, ...('texte' in synthese ? { texte: synthese.texte } : { texte: '', erreur: synthese.erreur }) });
  annoncer('arrete', { agentId: courante.agentId });
  return { ok: true };
}

/**
 * LA SYNTHÈSE, RÉDIGÉE PAR LE MÊME CODEX : un fil éphémère (sans outils utiles : le pont refuse la session close),
 * nourri de la transcription, en réflexion légère pour répondre vite. Rend le texte brut du modèle.
 */
async function redigerLaSynthese(courante: Session): Promise<string> {
  const { serveur } = courante;
  const debut = Date.now();
  const reste = () => Math.max(1000, DELAI_DE_LA_SYNTHESE_MS - (Date.now() - debut));
  const t = await serveur.appeler<{ thread: { id: string } }>(
    'thread/start',
    { cwd: courante.cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', model: MODELE_DU_DIRECT },
    reste(),
  );
  const threadId = t.thread.id;
  return await new Promise<string>((ok, ko) => {
    const morceaux: string[] = [];
    let fini = false;
    const finir = (erreur: Error | null) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      if (erreur) ko(erreur);
      else ok(morceaux.join('\n\n'));
    };
    const minuterie = setTimeout(() => finir(new Error('Codex a mis trop de temps à répondre.')), reste());
    serveur.onNotification = (n) => {
      if (n.params?.threadId !== threadId) return;
      if (n.method === 'item/completed' && n.params.item?.type === 'agentMessage' && typeof n.params.item.text === 'string') {
        morceaux.push(n.params.item.text);
      } else if (n.method === 'turn/completed') {
        const turn = n.params.turn ?? {};
        if (turn.status === 'failed') finir(new Error(String(turn.error?.message ?? 'refus de Codex')));
        else finir(null);
      } else if (n.method === 'error') {
        finir(new Error(String(n.params.error?.message ?? 'erreur de Codex')));
      }
    };
    serveur.onSortie = () => finir(new Error('Codex s’est arrêté.'));
    serveur
      .appeler('turn/start', {
        threadId,
        input: [{ type: 'text', text: consigneDeLaSynthese(courante.transcription, courante.destinataire) }],
        effort: 'low',
      }, reste())
      .catch((err: Error) => finir(err));
  });
}

function clore(courante: Session): void {
  courante.arret = true;
  if (!toursEnGrace.has(courante.tour)) toursEnGrace.set(courante.tour, { agentId: courante.agentId, jusqua: Date.now() + GRACE_DU_TOUR_VOCAL_MS });
  courante.serveur.fermer();
  // Un tour à moitié dit reste dans le fil : on garde ce qui a été entendu.
  for (const role of ['user', 'assistant'] as const) {
    if (courante.enCours[role].trim()) discussions.ajouterTour(courante.discussion, role, courante.enCours[role]);
  }
  discussions.fermerDiscussion(courante.discussion);
  poserLeClientDeLaVoix(null);
  derniere = {
    threadId: courante.threadId,
    discussion: courante.discussion,
    compteId: courante.compteId,
    agentId: courante.agentId,
    messageId: courante.messageId,
    fin: Date.now(),
  };
  if (session === courante) session = null;
  /* LA TRACE DE CHAQUE CONVERSATION (17/11/2026) : une discussion vide est effacée sans laisser de trace ; le journal
     dit désormais combien de phrases sont arrivées de chaque côté — zéro de l'utilisateur = sa voix n'est pas arrivée. */
  const deLui = courante.transcription.filter((tour) => tour.role === 'user').length;
  const deJarvis = courante.transcription.filter((tour) => tour.role === 'assistant').length;
  const message = `direct vocal fermé (${idDeDiscussion(courante.discussion)}) après ${Math.round((Date.now() - courante.ouverteLe) / 1000)} s : ${deLui} phrase(s) de l’utilisateur, ${deJarvis} de Jarvis${courante.raison ? ` — fermé par l’écran : ${courante.raison}` : ''}`;
  if (deLui === 0) log.warn(`${message} — aucune parole de l’utilisateur n’est arrivée`);
  else log.info(message);
  // Jarvis redevient prêt pour la prochaine fois, si un écran le demande encore.
  setTimeout(reprendreLaReserve, 3000).unref();
}

/** « Jarvis ? », « Jarvis. », « Dis Jarvis » : la phrase n'est que l'appel joué par l'écran. */
export function nEstQueLAppel(texte: string, nom: string): boolean {
  const mots = normaliserParole(texte).split(' ').filter(Boolean);
  const lui = normaliserParole(nom || 'Jarvis');
  return mots.length > 0 && mots.length <= 3 && mots.join(' ').includes(lui) && mots.every((m) => m === lui || ['dis', 'hey', 'he', 'eh', 'ok', 'oui'].includes(m));
}

function nomDuProjet(id: string): string {
  return store.getProject(id)?.name ?? id;
}

/** Ce que Codex dit pendant la session : les phrases, les appels d'outils, la fin. */
function traiterLaNotification(courante: Session, n: Notification): void {
  if (session !== courante) return;
  const p = n.params ?? {};
  switch (n.method) {
    case 'thread/realtime/transcript/delta': {
      const role = p.role === 'user' ? 'user' : 'assistant';
      courante.enCours[role] += String(p.delta ?? '');
      // L'appel joué par l'écran ne s'affiche pas pendant qu'il se transcrit.
      if (role === 'user' && courante.appelEnAttente) return;
      bus.emit({ type: 'voix.direct.tour', role, texte: courante.enCours[role].trim(), final: false, projets: [] });
      return;
    }
    case 'thread/realtime/transcript/done': {
      const role = p.role === 'user' ? 'user' : 'assistant';
      const texte = String(p.text ?? courante.enCours[role]).trim();
      courante.enCours[role] = '';
      if (!texte) return;
      if (role === 'user' && courante.appelEnAttente) {
        courante.appelEnAttente = false;
        if (nEstQueLAppel(texte, nomDeLAssistant(store.getSettings()))) return;
      }
      const projets = reunirLesMarques(projetsCites(texte, projetsJoignables()), role === 'assistant' ? courante.projetsEnAttente : []);
      const sources = role === 'assistant' && courante.sourcesEnAttente ? courante.sourcesEnAttente : undefined;
      if (role === 'assistant') {
        courante.projetsEnAttente = [];
        courante.sourcesEnAttente = 0;
      }
      discussions.ajouterTour(courante.discussion, role, texte, projets);
      courante.transcription.push({ role, texte });
      // UNE PHRASE QUI RENVOIE AU PASSÉ : Beluga cherche pour la voix, sans attendre qu'elle le demande.
      if (role === 'user' && questionSurLePasse(texte)) void glisserLeContexte(courante, texte);
      bus.emit({ type: 'voix.direct.tour', role, texte, final: true, projets: projets.map(nomDuProjet), ...(sources ? { sources } : {}) });
      return;
    }
    /* CE QUE JARVIS FAIT, EN DIRECT (16/11/2026) : chaque appel d'outil pose sa ligne vivante dans le fil du volet. */
    case 'item/started': {
      const item = p.item ?? {};
      if (item.type !== 'mcpToolCall' || !item.id) return;
      const args = (item.arguments && typeof item.arguments === 'object' ? item.arguments : {}) as Record<string, any>;
      const libelle = libelleDeLActivite(String(item.tool ?? ''), args);
      if (libelle) bus.emit({ type: 'voix.direct.activite', id: String(item.id), libelle, etat: 'en-cours', ...(outilQuiAgit(String(item.tool ?? ''), args) ? { agit: true } : {}) });
      return;
    }
    case 'item/completed': {
      const item = p.item ?? {};
      if (item.type !== 'mcpToolCall') return;
      const args = (item.arguments && typeof item.arguments === 'object' ? item.arguments : {}) as Record<string, any>;
      const libelleFini = item.id ? libelleDeLActivite(String(item.tool ?? ''), args) : null;
      if (libelleFini) {
        // Un refus rendu par Beluga (`ok: false` → `isError`) est un échec : il se voit, Jarvis le dit à voix haute.
        const echec = !!item.error || item.status === 'failed' || item.result?.isError === true;
        bus.emit({ type: 'voix.direct.activite', id: String(item.id), libelle: libelleFini, etat: echec ? 'echec' : 'finie' });
      }
      const projets = projetsDesArguments(args, projetsJoignables());
      courante.projetsEnAttente = reunirLesMarques(courante.projetsEnAttente, projets);
      discussions.marquerDiscussion(courante.discussion, projets);
      const reussi = !item.error && item.status !== 'failed' && item.result?.isError !== true;
      if (item.tool === 'memoire' && args.geste === 'chercher' && reussi) {
        courante.sourcesEnAttente += sourcesDeLaMemoireCitees(texteDuResultatMcp(item.result) ?? '');
      }
      if (item.tool === 'board_create_card' && reussi && typeof args.title === 'string') {
        courante.derniereTache = args.title;
        bus.emit({
          type: 'voix.direct.tache',
          titre: args.title,
          ...(projets[0] ? { projet: nomDuProjet(projets[0]) } : {}),
          ...(typeof args.niveau === 'string' ? { niveau: args.niveau } : {}),
          ...(typeof args.moteur === 'string' ? { moteur: args.moteur } : {}),
          ...(typeof args.modele === 'string' ? { modele: args.modele } : {}),
          ...(typeof args.reflexion === 'string' ? { reflexion: args.reflexion } : {}),
          etat: 'proposee',
        });
      }
      if (item.tool === 'assistant_gestes' && reussi && courante.derniereTache) {
        const etat = args.action === 'valider_proposition' ? 'creee' : args.action === 'lancer' ? 'lancee' : null;
        if (etat) bus.emit({ type: 'voix.direct.tache', titre: courante.derniereTache, etat });
      }
      return;
    }
    case 'thread/realtime/error': {
      if (courante.arret) return;
      annoncer('erreur', { message: erreurLisible(String(p.message ?? 'erreur inconnue')) });
      clore(courante);
      return;
    }
    case 'thread/realtime/closed': {
      if (courante.arret) return;
      clore(courante);
      annoncer('arrete', { message: p.reason && p.reason !== 'requested' ? `Le direct s’est fermé (${p.reason}).` : undefined });
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------------ */
/* L'extrait d'une voix                                                 */
/* ------------------------------------------------------------------ */

/**
 * UNE COURTE SESSION SANS OUTILS pour écouter une voix (Réglages › Voix, « Écouter ») : le navigateur y « dit »
 * une phrase fabriquée par la voix du serveur, la voix demandée répond. Rien n'est gardé ; la session se ferme
 * seule au bout de vingt secondes. Aucune autre session n'est touchée.
 */
export async function extraitDeVoix(offre: string, voixDemandee: string): Promise<{ sdp: string; voix: string }> {
  if (!/^v=0/.test(offre)) throw new Error('Offre de connexion invalide.');
  const voix = voixDuDirectRetenue(voixDemandee, voixEnCache?.liste ?? VOIX_DU_DIRECT);
  const { codexHome } = await compteCodex();
  const cwd = path.join(os.homedir(), '.beluga', 'atelier-voix');
  const serveur = lancerAppServer(codexHome, cwd);
  const fin = setTimeout(() => serveur.fermer(), 20_000);
  fin.unref();
  try {
    await serveur.initialiser();
    const t = await serveur.appeler<{ thread: { id: string } }>('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
    const reponse = attendreLaReponse(serveur, t.thread.id, 30_000);
    serveur.onNotification = (n) => void reponse.traiter(n);
    await serveur.appeler('thread/realtime/start', {
      threadId: t.thread.id,
      outputModality: 'audio',
      version: 'v3',
      transport: { type: 'webrtc', sdp: offre },
      voice: voix,
      prompt: `Tu es ${nomDeLaVoix(voix)}, une voix de Codex dans Beluga. ${ACCENT_DE_LA_VOIX}Quand on te demande de te présenter, réponds en une seule phrase courte et chaleureuse, en français de France, en disant ton nom. Ne fais rien d'autre.`,
    });
    return { sdp: await reponse.promesse, voix };
  } catch (err) {
    clearTimeout(fin);
    serveur.fermer();
    throw new Error(erreurLisible((err as Error).message));
  }
}
