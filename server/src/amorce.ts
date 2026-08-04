import fs from 'node:fs';
import path from 'node:path';
import {
  AmorcePosee,
  EtatCompteAmorce,
  alerterApresEchec,
  comptesAAmorcer,
  dansLesHeuresDeSilence,
  decisionAmorce,
  finDeFenetre,
  modeleLePlusLeger,
} from '@haikodev/shared';
import { AccountRecord, cachedQuotas, listAccountRecords } from './accounts.js';
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
        lectureEnEchec: !quota || !!quota.error,
        agentEnCours: occupes.has(account.id),
        derniereAmorce: amorces[account.id],
      };
    });
}

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

function oublierEchecs(accountId: string): void {
  echecs.delete(accountId);
}

/**
 * Un refus isolé n'intéresse personne (un jeton en cours de renouvellement en
 * produit). Trois de suite sur le même compte, si : là, le compte ne répond
 * plus et cela se dit sur le téléphone — une seule fois, au franchissement.
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

/** Une seule amorce à la fois : deux passages ne doivent pas se chevaucher. */
let enCours = false;

/**
 * Le passage régulier : on regarde chaque compte, et on amorce ceux dont la
 * fenêtre est retombée à zéro — l'un après l'autre, jamais en parallèle.
 */
export async function amorcerFenetres(): Promise<number> {
  if (enCours) return 0;
  if (!getSettings().primeClaudeWindow) return 0;
  enCours = true;
  let amorces = 0;
  try {
    const etats = etatDesComptes();
    const aFaire = comptesAAmorcer(etats, Date.now(), silenceMaintenant());
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
      const resultat = await envoyerAmorce(account, model);
      const heure = new Date(maintenant).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
      if (resultat.ok) {
        const jusqua = finDeFenetre(maintenant, etat.resetsAt);
        retenirAmorce(account.id, { at: maintenant, jusqua, model });
        // Le journal lisible depuis l'application : une ligne par tentative.
        recordAmorce({ account: account.id, at: maintenant, ok: true, model, tokens: resultat.tokens, jusqua });
        amorces += 1;
        log.info(
          `amorce de la fenêtre de 5 h à ${heure} — ${account.label} (modèle ${model}, ${resultat.tokens ?? 0} jetons), ` +
            `prochaine amorce possible après ${new Date(jusqua).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`,
        );
        oublierEchecs(account.id);
      } else {
        // Un échec ne pose pas de trace d'amorce : la fenêtre n'est pas lancée,
        // on réessaiera au passage suivant. En revanche il se compte, et
        // plusieurs de suite finissent par se dire à voix haute.
        log.warn(`amorce impossible à ${heure} — ${account.label} : ${resultat.error}`);
        recordAmorce({ account: account.id, at: maintenant, ok: false, model, error: resultat.error });
        signalerEchec(account.id, account.label, resultat.error ?? 'raison inconnue');
      }
    }
  } catch (err) {
    log.error('amorce des fenêtres de 5 h', err);
  } finally {
    enCours = false;
  }
  return amorces;
}

/** Ce que le mécanisme ferait maintenant, compte par compte : de quoi le lire au journal. */
export function apercuAmorce(): { id: string; raison: string }[] {
  const maintenant = Date.now();
  const silence = silenceMaintenant();
  return etatDesComptes().map((etat) => ({ id: etat.id, raison: decisionAmorce(etat, maintenant, silence) }));
}
