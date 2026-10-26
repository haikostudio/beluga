import fs from 'node:fs';
import path from 'node:path';
import {
  AmorcePosee,
  CreneauDuCompte,
  EtatCompteAmorce,
  alerterApresEchec,
  comptesAAmorcer,
  creneauxDesComptes,
  dansLesHeuresDeSilence,
  decisionAmorce,
  DUREE_FENETRE_MS,
  estRefusDeSaturation,
  finDeFenetre,
  instantDuRenouvellementPreventif,
  MARGE_DE_RENOUVELLEMENT_DU_MOTEUR_MS,
  modeleLePlusLeger,
  peutRenouvelerLaSession,
  renouvellementPreventif,
  texteEchecAmorce,
} from '@beluga/shared';
import {
  AccountRecord,
  brancherFenetreDuCompte,
  cachedQuotas,
  comptesACaler,
  jetonEnAttenteDuCreneau,
  listAccountRecords,
  lireCoffreDuCompte,
  oublierAttenteDuCreneau,
  renouvelerSessionClaude,
} from './accounts.js';
import { claudeCatalog } from './engines/catalog.js';
import { getMeta, setMeta } from './db.js';
import { comptesOccupes } from './runtime.js';
import { notify } from './notify.js';
import { getSettings, recordAmorce } from './store.js';
import { log } from './logger.js';

/**
 * Amorcer la fenêtre de cinq heures de CHAQUE compte Claude (voir [[amorce]]
 * côté partagé pour la règle). Une requête minuscule suffit à lancer le
 * décompte : quelques dizaines de jetons sur le modèle le moins gourmand, pas
 * une conversation.
 */

/** Le beta d'authentification des jetons Claude Code. */
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';

/** Sans catalogue joignable, on ne devine pas : ce modèle-là est le plus léger connu. */
const MODELE_DE_REPLI = 'claude-haiku-4-5-20251001';

/** Le modèle du message que le moteur envoie pour renouveler une session (`lancerRenouvellement`). */
const MODELE_DU_RENOUVELLEMENT = 'claude-haiku-4-5-20251001';

/** Le plus court des messages : l'amorce n'attend aucune réponse utile. */
const MESSAGE = 'ok';

/** Les amorces déjà posées, retenues d'un redémarrage à l'autre. */
const CLE_MEMOIRE = 'amorce.fenetres';

function amorcesPosees(): Record<string, AmorcePosee> {
  try {
    const raw = getMeta(CLE_MEMOIRE);
    return raw ? (JSON.parse(raw) as Record<string, AmorcePosee>) : {};
  } catch {
    return {};
  }
}

function retenirAmorce(accountId: string, amorce: AmorcePosee): void {
  const toutes = amorcesPosees();
  toutes[accountId] = amorce;
  try {
    setMeta(CLE_MEMOIRE, JSON.stringify(toutes));
  } catch (err) {
    // Sans trace retenue, on risquerait de ré-amorcer la même fenêtre : on le dit.
    log.warn("amorce : impossible de retenir la trace de l'amorce", err);
  }
}

/** L'état de chaque compte Claude, tel que la règle a besoin de le voir. */
export function etatDesComptes(): EtatCompteAmorce[] {
  const quotas = cachedQuotas();
  const occupes = new Set(comptesOccupes());
  const amorces = amorcesPosees();
  return listAccountRecords()
    .filter((account) => account.engine === 'claude')
    .sort((a, b) => a.priority - b.priority)
    .map((account) => {
      const quota = quotas.find((q) => q.id === account.id);
      return {
        id: account.id,
        engine: 'claude',
        sessionPct: quota?.session?.usedPct,
        resetsAt: quota?.session?.resetsAt,
        // Pas de relevé du tout : on n'a rien constaté, donc on ne fait rien.
        // Un jeton qui ATTEND son créneau n'est pas une lecture ratée : c'est
        // justement l'amorce du créneau qui doit le renouveler.
        lectureEnEchec: !quota || (!!quota.error && !jetonEnAttenteDuCreneau(account.id)),
        agentEnCours: occupes.has(account.id),
        derniereAmorce: amorces[account.id],
      };
    });
}

/**
 * LES CRÉNEAUX DE CHAQUE COMPTE CLAUDE, calés sur le prioritaire (règle pure
 * `creneauxDesComptes`). Notre propre trace d'amorce fait foi pour la fin de
 * la fenêtre lancée ; un compte en échec d'amorce ou en recul ne peut pas
 * servir de repère — les autres gardent alors l'ancien comportement.
 */
export function creneauxActuels(maintenant = Date.now()): Map<string, CreneauDuCompte> {
  const quotas = cachedQuotas();
  const amorces = amorcesPosees();
  const signatures = new Map<string, string>();
  for (const quota of quotas) {
    if (quota.jumeaux?.length) signatures.set(quota.id, [quota.id, ...quota.jumeaux.map((j) => j.id)].sort()[0]);
  }
  const comptes = comptesACaler(quotas, signatures).map((compte) => ({
    ...compte,
    finAmorce: amorces[compte.id]?.jusqua ?? compte.finAmorce,
    incertain:
      compte.incertain || (echecs.get(compte.id) ?? 0) > 0 || (prochaineTentative.get(compte.id) ?? 0) > maintenant,
  }));
  return creneauxDesComptes(comptes, maintenant);
}

/**
 * LA FENÊTRE DE CINQ HEURES DE CE COMPTE TOURNE-T-ELLE MAINTENANT ? Un agent au
 * travail, un compteur qui a bougé sur une fenêtre pas encore finie, ou notre
 * propre amorce encore valable. Le relevé s'en sert pour décider si renouveler
 * la session (un vrai message) peut se faire sans ouvrir une fenêtre.
 */
export function fenetreOuverteMaintenant(accountId: string, maintenant = Date.now()): boolean {
  if (comptesOccupes().includes(accountId)) return true;
  const session = cachedQuotas().find((q) => q.id === accountId)?.session;
  if ((session?.usedPct ?? 0) > 0 && (session?.resetsAt ?? 0) > maintenant) return true;
  const amorce = amorcesPosees()[accountId];
  return !!amorce && amorce.jusqua > maintenant;
}

/** Les créneaux ne valent que si l'amorce tourne : sinon, aucun créneau à attendre. */
function amorceActive(): boolean {
  if (process.env.BELUGA_SANS_AMORCE === '1') return false;
  try {
    return !!getSettings().primeClaudeWindow;
  } catch {
    return false;
  }
}

brancherFenetreDuCompte((accountId) => {
  const maintenant = Date.now();
  const fenetreOuverte = fenetreOuverteMaintenant(accountId, maintenant);
  if (!amorceActive()) return { fenetreOuverte };
  try {
    return { fenetreOuverte, prochainCreneau: creneauxActuels(maintenant).get(accountId)?.prochainCreneau };
  } catch {
    return { fenetreOuverte };
  }
});

/** Le modèle le moins gourmand du catalogue Claude, demandé au moteur lui-même. */
async function modeleDAmorce(): Promise<string> {
  try {
    const { models } = await claudeCatalog();
    return modeleLePlusLeger(models)?.id ?? MODELE_DE_REPLI;
  } catch {
    return MODELE_DE_REPLI;
  }
}

function jetonDuCompte(account: AccountRecord): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(account.configDir, '.credentials.json'), 'utf8'));
    return raw?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * L'amorce elle-même : un aller-retour direct avec l'API, sur le jeton DU
 * compte visé. Pas de moteur lancé, pas de dossier de travail touché.
 */
export async function envoyerAmorce(
  account: AccountRecord,
  model: string,
): Promise<{ ok: boolean; tokens?: number; error?: string }> {
  const token = jetonDuCompte(account);
  if (!token) return { ok: false, error: 'compte non connecté' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': CLAUDE_OAUTH_BETA,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        // Le jeton d'un compte Claude Code n'est accepté qu'avec cette ligne.
        system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
        messages: [{ role: 'user', content: MESSAGE }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, error: `refus (${res.status})` };
    const data: any = await res.json();
    const usage = data?.usage ?? {};
    return { ok: true, tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'envoi impossible' };
  }
}

/**
 * UNE COURTE RÉDACTION PAR UN COMPTE CLAUDE (la traduction des consignes de
 * génération, quand le coffre n'a pas de clé de relais) : le modèle le plus
 * léger, sur le premier compte connecté qui répond. Rend le texte, ou `null`.
 */
export async function redigerParUnCompteClaude(consigne: string, texte: string, maxTokens = 1024): Promise<string | null> {
  const model = await modeleDAmorce();
  const comptes = listAccountRecords()
    .filter((account) => account.engine === 'claude')
    .sort((a, b) => a.priority - b.priority);
  for (const account of comptes) {
    const token = jetonDuCompte(account);
    if (!token) continue;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'anthropic-beta': CLAUDE_OAUTH_BETA,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          // Le jeton d'un compte Claude Code n'est accepté qu'avec cette première ligne.
          system: [
            { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
            { type: 'text', text: consigne },
          ],
          messages: [{ role: 'user', content: texte }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const data: any = await res.json();
      const sortie = (Array.isArray(data?.content) ? data.content : [])
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => String(b.text ?? ''))
        .join('')
        .trim();
      if (sortie) return sortie;
    } catch {
      /* compte suivant */
    }
  }
  return null;
}

/**
 * Les heures de silence réglées pour les notifications valent aussi ici : la
 * nuit, on laisse les comptes tranquilles. La dernière fenêtre amorcée avant
 * le silence a le temps de s'éteindre, et le premier passage du matin en
 * rouvre une aussitôt — c'est ce qu'on veut, une fenêtre fraîche au réveil.
 */
function silenceMaintenant(): boolean {
  const settings = getSettings();
  return dansLesHeuresDeSilence(new Date().getHours(), settings.quietHoursStart, settings.quietHoursEnd);
}

/* ------------------------------------------------------------------ */
/* Les échecs répétés                                                  */
/* ------------------------------------------------------------------ */

/** Échecs d'affilée par compte : remis à zéro dès qu'une amorce passe. */
const echecs = new Map<string, number>();

/** Les comptes saturés déjà annoncés : on ne le redit pas à chaque passage. */
const saturationSignalee = new Set<string>();

/** Prochaine tentative autorisée après une saturation : recul progressif, comme les lectures de quota. */
const prochaineTentative = new Map<string, number>();

function oublierEchecs(accountId: string): void {
  echecs.delete(accountId);
  saturationSignalee.delete(accountId);
  prochaineTentative.delete(accountId);
  creneauxManques.delete(accountId);
}

/**
 * LE CRÉNEAU MANQUÉ D'UN COMPTE QUI A ÉCHOUÉ À SON RÉVEIL. Sans lui, un refus
 * au créneau, puis dix minutes de tolérance passées, renvoyaient le compte
 * cinq heures plus loin : « le dernier qui a échoué » n'était jamais réveillé
 * au bon moment. Le créneau reste dû jusqu'à ce qu'une amorce passe (ou que
 * la fenêtre qu'il aurait ouverte soit elle-même finie).
 */
const creneauxManques = new Map<string, number>();

function creneauDu(accountId: string, creneau: number | undefined, maintenant: number): number | undefined {
  const manque = creneauxManques.get(accountId);
  if (manque === undefined) return creneau;
  if (maintenant - manque >= DUREE_FENETRE_MS) {
    creneauxManques.delete(accountId);
    return creneau;
  }
  return manque;
}

/** Les alignements déjà dits au journal : une ligne par fenêtre hors créneau, pas une par passage. */
const alignementsSignales = new Map<string, number>();

function signalerAlignements(creneaux: Map<string, CreneauDuCompte>): void {
  for (const creneau of creneaux.values()) {
    const hors = creneau.horsCreneau;
    if (!hors) continue;
    const cle = Math.round(hors.finFenetre / 60_000);
    if (alignementsSignales.get(creneau.id) === cle) continue;
    alignementsSignales.set(creneau.id, cle);
    const heure = (at?: number) =>
      at ? new Date(at).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' }) : '?';
    const label = listAccountRecords().find((a) => a.id === creneau.id)?.label ?? creneau.id;
    log.info(
      `amorce : ${label} a perdu son créneau${hors.alignee ? ' (fenêtre alignée sur le repère)' : ''} — ` +
        `fenêtre jusqu'à ${heure(hors.finFenetre)}, écart ${Math.round(hors.ecartMs / 60_000)} min ; ` +
        `au repos ensuite, réveil prévu à ${heure(creneau.prochainReveil)}`,
    );
  }
}

/**
 * Un refus isolé n'intéresse personne (un jeton en cours de renouvellement en
 * produit). Trois de suite sur le même compte, si : là, le compte ne répond
 * plus et cela se dit sur le téléphone — une seule fois, au franchissement.
 * Un refus 429 (compte saturé) ne passe JAMAIS par ici : voir `signalerSaturation`.
 */
function signalerEchec(accountId: string, label: string, raison: string): void {
  const compte = (echecs.get(accountId) ?? 0) + 1;
  echecs.set(accountId, compte);
  if (!alerterApresEchec(compte)) return;
  log.error(`amorce en échec ${compte} fois de suite sur ${label} : ${raison}`);
  // L'amorçage d'une fenêtre est une affaire de machine : il se dit dans
  // l'application, jamais sur un téléphone.
  notify({
    motif: 'amorcage-impossible',
    title: 'Amorçage impossible',
    body: `${label} : ${compte} échecs de suite (${raison}).`,
    reference: accountId,
  });
}

/**
 * Un compte SATURÉ (refus 429) n'est pas une panne : la limite est atteinte,
 * une situation normale et attendue. On le dit une seule fois par saturation
 * — jamais à chaque tentative —, en clair et avec l'heure de reprise quand
 * elle est connue, jamais avec le code technique du refus.
 */
function signalerSaturation(accountId: string, label: string, resetsAt?: number): void {
  if (saturationSignalee.has(accountId)) return;
  saturationSignalee.add(accountId);
  const heureReprise = resetsAt
    ? ` — de nouveau disponible vers ${new Date(resetsAt).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`
    : '';
  log.info(`amorce : ${label} a atteint sa limite${heureReprise}`);
  notify({
    motif: 'compte-sature',
    title: 'Compte saturé',
    body: `${label} a atteint sa limite${heureReprise}.`,
    reference: `${accountId}:sature`,
  });
}

/**
 * Recule la prochaine tentative sur un compte saturé, en doublant l'attente à
 * chaque refus (deux minutes, quatre, huit… jusqu'à trente minutes) — la même
 * mécanique que `refreshQuotas` pour les lectures de quota, pour ne jamais
 * insister tant que la limite tient.
 */
function reculerTentative(accountId: string): void {
  const precedent = Math.max(2 * 60_000, (prochaineTentative.get(accountId) ?? 0) - Date.now());
  prochaineTentative.set(accountId, Date.now() + Math.min(30 * 60_000, precedent * 2));
}

/** Une seule amorce à la fois : deux passages ne doivent pas se chevaucher. */
let enCours = false;

/**
 * Le passage régulier : on regarde chaque compte, et on amorce ceux dont la
 * fenêtre est retombée à zéro — l'un après l'autre, jamais en parallèle.
 */
export async function amorcerFenetres(): Promise<number> {
  if (enCours) return 0;
  /* UN DÉMON D'ESSAI N'AMORCE JAMAIS : sa base est neuve, mais les comptes
     qu'il lit sont les VRAIS. Chaque contrôle d'écran ouvrait ainsi la fenêtre
     de cinq heures du compte principal (35 jetons) à l'heure où il tournait,
     alors que son décor promet « aucun quota dépensé »
     (`scripts/lib/demon-d-essai.mjs`, qui pose cette variable). */
  if (process.env.BELUGA_SANS_AMORCE === '1') return 0;
  if (!getSettings().primeClaudeWindow) return 0;
  enCours = true;
  let amorces = 0;
  try {
    const etats = etatDesComptes();
    // Un compte qui suit le repère n'est réveillé qu'à son créneau — ou au
    // créneau qu'il a manqué en échouant, tant qu'il reste dû.
    const avant = Date.now();
    const creneaux = creneauxActuels(avant);
    for (const [id, creneau] of creneaux) {
      const du = creneauDu(id, creneau.prochainCreneau, avant);
      if (du !== creneau.prochainCreneau) creneaux.set(id, { ...creneau, prochainCreneau: du });
    }
    // Un compte encore en recul après une saturation attend son tour : retenter
    // tout de suite ne ferait que prolonger le refus.
    const aFaire = comptesAAmorcer(etats, avant, silenceMaintenant(), creneaux).filter(
      (etat) => (prochaineTentative.get(etat.id) ?? 0) <= Date.now(),
    );
    if (!aFaire.length) return 0;

    const model = await modeleDAmorce();
    const comptes = listAccountRecords();
    for (const [index, etat] of aFaire.entries()) {
      const account = comptes.find((a) => a.id === etat.id);
      if (!account) continue;
      // Les comptes sont servis l'un après l'autre, avec un souffle entre deux :
      // deux appels collés font refuser le second pour excès d'appels.
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 2000));

      const maintenant = Date.now();
      /*
       * UN JETON EXPIRÉ (ou sur le point de l'être) NE S'AMORCE PAS PAR L'API :
       * elle le refuserait (401), compté comme un échec. Au créneau, c'est le
       * renouvellement de la session qui fait office d'amorce — son message
       * ouvre la fenêtre, et c'est justement le moment voulu.
       */
      const expireA = lireCoffreDuCompte(account).expireA;
      const parRenouvellement =
        jetonEnAttenteDuCreneau(account.id) ||
        (expireA !== undefined && expireA - maintenant <= MARGE_DE_RENOUVELLEMENT_DU_MOTEUR_MS);
      const modeleUtilise = parRenouvellement ? MODELE_DU_RENOUVELLEMENT : model;
      const resultat: { ok: boolean; tokens?: number; error?: string } = parRenouvellement
        ? (await renouvelerSessionClaude(account, "l'amorce de son créneau"))
          ? { ok: true }
          : { ok: false, error: 'renouvellement de la session impossible' }
        : await envoyerAmorce(account, model);
      if (parRenouvellement && resultat.ok) oublierAttenteDuCreneau(account.id);
      const heure = new Date(maintenant).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
      if (resultat.ok) {
        const jusqua = finDeFenetre(maintenant, etat.resetsAt);
        retenirAmorce(account.id, { at: maintenant, jusqua, model: modeleUtilise });
        // Le journal lisible depuis l'application : une ligne par tentative.
        recordAmorce({ account: account.id, at: maintenant, ok: true, model: modeleUtilise, tokens: resultat.tokens, jusqua });
        amorces += 1;
        log.info(
          `amorce de la fenêtre de 5 h à ${heure} — ${account.label} ` +
            `(${parRenouvellement ? 'par le renouvellement de la session' : `modèle ${model}, ${resultat.tokens ?? 0} jetons`}), ` +
            `prochaine amorce possible après ${new Date(jusqua).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`,
        );
        oublierEchecs(account.id);
      } else {
        // Un échec ne pose pas de trace d'amorce : la fenêtre n'est pas lancée,
        // on réessaiera plus tard. Le journal et l'application ne montrent
        // jamais le code technique du refus : « limite atteinte » pour une
        // saturation, la raison telle quelle pour une vraie panne.
        const raison = resultat.error ?? 'raison inconnue';
        const texte = texteEchecAmorce(raison);
        // Un compte qui suivait le repère garde son créneau dû : il sera
        // réessayé dessus, pas renvoyé au créneau suivant.
        const creneauVise = creneaux.get(account.id)?.prochainCreneau;
        if (creneauVise !== undefined && creneauVise <= maintenant + 60_000 && !creneauxManques.has(account.id)) {
          creneauxManques.set(account.id, creneauVise);
        }
        log.warn(`amorce impossible à ${heure} — ${account.label} : ${raison}`);
        recordAmorce({ account: account.id, at: maintenant, ok: false, model: modeleUtilise, error: texte });
        if (estRefusDeSaturation(raison)) {
          // Une limite atteinte est une situation normale et attendue : elle ne
          // compte pas comme un échec, on espace les prochaines tentatives au
          // lieu d'insister, et on le dit une seule fois, en clair.
          reculerTentative(account.id);
          signalerSaturation(account.id, account.label, etat.resetsAt);
        } else {
          signalerEchec(account.id, account.label, raison);
        }
      }
    }
  } catch (err) {
    log.error('amorce des fenêtres de 5 h', err);
  } finally {
    enCours = false;
    rearmerReveil();
  }
  return amorces;
}

/* ------------------------------------------------------------------ */
/* Le réveil à l'heure du créneau                                      */
/* ------------------------------------------------------------------ */

/**
 * UN SEUL MINUTEUR, RÉARMÉ APRÈS CHAQUE PASSAGE sur le plus proche créneau
 * encore à venir. Sans lui, l'amorce ne passait qu'après un relevé de quota
 * (toutes les dix minutes) : assez pour la tolérance, pas pour la minute près.
 * Il n'ajoute AUCUN appel à l'API de quota — il relance l'amorce sur le
 * dernier relevé connu. Au redémarrage, le premier relevé le réarme.
 */
let reveil: NodeJS.Timeout | undefined;

function rearmerReveil(): void {
  if (reveil) clearTimeout(reveil);
  reveil = undefined;
  rearmerRenouvellementPreventif();
  if (process.env.BELUGA_SANS_AMORCE === '1') return;
  try {
    if (!getSettings().primeClaudeWindow) return;
    const maintenant = Date.now();
    const creneaux = creneauxActuels(maintenant);
    signalerAlignements(creneaux);
    // Un créneau manqué se réessaie à la fin du recul (ou au relevé suivant) :
    // le minuteur vise aussi cette heure-là, une seule fois par passage.
    const reprises = [...creneauxManques.keys()].map((id) => prochaineTentative.get(id));
    const prochains = [...[...creneaux.values()].map((creneau) => creneau.prochainCreneau), ...reprises]
      .filter((at): at is number => at !== undefined && at > maintenant);
    if (!prochains.length) return;
    // Quelques secondes après le créneau, plafonné à une fenêtre : un minuteur
    // trop long dériverait, et le relevé suivant le réarme de toute façon.
    const attente = Math.min(Math.min(...prochains) - maintenant + 5_000, 5 * 60 * 60 * 1000);
    reveil = setTimeout(() => {
      reveil = undefined;
      void amorcerFenetres();
    }, attente);
    reveil.unref?.();
  } catch (err) {
    log.warn("amorce : impossible de programmer le prochain réveil", err);
  }
}

/* ------------------------------------------------------------------ */
/* Le renouvellement préventif, fenêtre ouverte                        */
/* ------------------------------------------------------------------ */

/**
 * UN MINUTEUR SUR LA PROCHAINE FIN DE JETON D'UN COMPTE CLAUDE. Le moteur ne
 * renouvelle qu'à ses cinq dernières minutes : on se réveille quatre minutes
 * avant l'expiration, et on renouvelle SI la fenêtre du compte tourne (le
 * message ne la déplace pas). Fenêtre fermée, on ne fait rien : le relevé
 * reportera le renouvellement au créneau. Aucun relevé de quota ajouté.
 */
let reveilPreventif: NodeJS.Timeout | undefined;
/** L'échéance de jeton déjà examinée par compte : un compte au repos ou un échec ne se réexamine pas en boucle. */
const echeancesExaminees = new Map<string, number>();

function comptesClaude(): AccountRecord[] {
  return listAccountRecords().filter((account) => account.engine === 'claude' && !account.disabled);
}

function rearmerRenouvellementPreventif(): void {
  if (reveilPreventif) clearTimeout(reveilPreventif);
  reveilPreventif = undefined;
  if (!amorceActive()) return;
  try {
    const maintenant = Date.now();
    const instants = comptesClaude()
      .map((account) => {
        const expireA = lireCoffreDuCompte(account).expireA;
        if (expireA !== undefined && echeancesExaminees.get(account.id) === expireA) return undefined;
        return instantDuRenouvellementPreventif(expireA, maintenant);
      })
      .filter((at): at is number => at !== undefined);
    if (!instants.length) return;
    const attente = Math.min(Math.max(Math.min(...instants) - maintenant, 1_000), 5 * 60 * 60 * 1000);
    reveilPreventif = setTimeout(() => {
      reveilPreventif = undefined;
      void renouvelerPreventivement().finally(rearmerRenouvellementPreventif);
    }, attente);
    reveilPreventif.unref?.();
  } catch (err) {
    log.warn('amorce : impossible de programmer le renouvellement préventif', err);
  }
}

export async function renouvelerPreventivement(maintenant = Date.now()): Promise<number> {
  let renouveles = 0;
  const occupes = comptesOccupes();
  for (const account of comptesClaude()) {
    let jetons: { refreshToken?: string; refreshTokenExpiresAt?: number } | undefined;
    try {
      jetons = JSON.parse(fs.readFileSync(path.join(account.configDir, '.credentials.json'), 'utf8'))?.claudeAiOauth;
    } catch {
      continue;
    }
    const expireA = lireCoffreDuCompte(account).expireA;
    // Seule l'échéance arrivée dans la marge du moteur est examinée, une seule fois.
    if (expireA === undefined || expireA - maintenant > MARGE_DE_RENOUVELLEMENT_DU_MOTEUR_MS) continue;
    if (echeancesExaminees.get(account.id) === expireA) continue;
    echeancesExaminees.set(account.id, expireA);
    const doit = renouvellementPreventif({
      peutRenouveler: peutRenouvelerLaSession(jetons, maintenant),
      agentsAuTravail: occupes.filter((id) => id === account.id).length,
      fenetreOuverte: fenetreOuverteMaintenant(account.id, maintenant),
      expireA,
      maintenant,
    });
    if (!doit) continue;
    if (await renouvelerSessionClaude(account, 'le renouvellement préventif, fenêtre ouverte')) {
      oublierAttenteDuCreneau(account.id);
      renouveles += 1;
    }
  }
  return renouveles;
}

/** Ce que le mécanisme ferait maintenant, compte par compte : de quoi le lire au journal. */
export function apercuAmorce(): {
  id: string;
  raison: string;
  prochainCreneau?: number;
  prochainReveil?: number;
  horsCreneau?: CreneauDuCompte['horsCreneau'];
}[] {
  const maintenant = Date.now();
  const silence = silenceMaintenant();
  const creneaux = creneauxActuels(maintenant);
  return etatDesComptes().map((etat) => {
    const creneau = creneaux.get(etat.id);
    const prochainCreneau = creneauDu(etat.id, creneau?.prochainCreneau, maintenant);
    return {
      id: etat.id,
      raison: decisionAmorce(etat, maintenant, silence, prochainCreneau),
      prochainCreneau,
      prochainReveil: creneau?.prochainReveil,
      horsCreneau: creneau?.horsCreneau,
    };
  });
}
