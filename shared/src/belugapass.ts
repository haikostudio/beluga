/**
 * LA LIAISON AVEC BELUGA PASS — les règles pures du côté Beluga Build (carte « Audits passés et synchro Beluga Pass »,
 * 15/11/2026). Le contrat d'échange est celui de Beluga Pass (`/root/belugapass/docs/contrat-beluga-build.md`) :
 *
 *  - Beluga Build GÉNÈRE une clé de liaison (≥ 20 signes), montrée une fois, que l'utilisateur colle dans Beluga Pass
 *    avec l'adresse de Beluga Build. Tous les appels, dans les deux sens, portent `Authorization: Bearer <clé>`.
 *  - Beluga Pass envoie un MIROIR chiffré (sauvegarde illisible pour Beluga : les clés des coffres y sont scellées pour
 *    la clé de l'UTILISATEUR), règle l'interrupteur « Accès des agents » et pose ses questions à l'ASSISTANT.
 *  - Beluga Build ouvre ou ferme l'accès des agents (webhook) et, accès ouvert, LIT les coffres choisis : leurs clés
 *    sont alors scellées pour la clé publique de ses agents.
 *
 * Ici : le format du miroir, la clé de liaison, l'adresse de Beluga Pass, et l'INTENTION de l'assistant (validée,
 * puis tirée par des règles quand aucun moteur ne répond). Le chiffrement vit côté démon (`server/src/belugapass-crypto.ts`).
 */

import { zoneDesProjets } from './installation.js';

export const FORMAT_DU_MIROIR = 'belugapass-mirror-1';
/** Un miroir plus gros est refusé : plusieurs milliers de fiches tiennent dans quelques mégaoctets. */
export const PLAFOND_DU_MIROIR_OCTETS = 25 * 1024 * 1024;
/** La clé de liaison : un préfixe lisible, puis 32 octets aléatoires en base64url (43 signes). */
export const PREFIXE_DE_LA_CLE = 'bpl_';
/** L'adresse habituelle de Beluga Pass : « belugapass. » devant la zone des projets de l'installation ; vide si la zone n'est pas réglée. */
export function adresseBelugaPassParDefaut(): string {
  const zone = zoneDesProjets();
  return zone ? `https://belugapass.${zone}` : '';
}
/** Les noms des fiches du coffre-fort qui portent les secrets de la liaison (une fiche par secret). */
export const FICHE_CLE_DE_LIAISON = 'Beluga Build — Beluga Pass — clé de liaison';
export const FICHE_CLE_DES_AGENTS = 'Beluga Build — Beluga Pass — clé privée des agents';
export const DOSSIER_DES_FICHES_BELUGAPASS = 'Beluga Pass';

/** Ce que la page « Beluga Pass » des Réglages montre de la liaison. Jamais une clé, jamais un contenu. */
export interface EtatBelugaPass {
  /** Une liaison existe (une clé a été générée). */
  existe: boolean;
  endpoint: string;
  /**
   * L'adresse PUBLIQUE de cette installation de Beluga Build (réglage « Installation »), celle que Beluga Pass doit
   * appeler ; null quand aucune n'est réglée (l'écran retombe alors sur l'adresse de la page).
   */
  adresseDeBelugaBuild: string | null;
  /** Beluga Pass a répondu au moins une fois avec la clé (premier `GET /link`). */
  relie: boolean;
  creeLe: number | null;
  relieLe: number | null;
  agentAccess: boolean;
  derniereSauvegardeLe: number | null;
  /** Taille de la dernière sauvegarde chiffrée, en octets. */
  volume: number | null;
  coffres: number | null;
  fiches: number | null;
  derniereErreur: string | null;
  /** Les dernières lectures par un agent (qui, quand, combien) — jamais ce qui a été lu. */
  lectures: { quand: number; agent: string; coffres: number; fiches: number; erreur: string | null }[];
}

/* ------------------------------------------------------------------ */
/* Adresse et clé                                                      */
/* ------------------------------------------------------------------ */

/** L'adresse de Beluga Pass, nettoyée ; HTTPS seulement (sauf la machine elle-même, pour les essais). */
export function adresseBelugaPass(brut: unknown): string | null {
  const texte = String(brut ?? '').trim().replace(/\/+$/, '');
  if (!texte) return null;
  let url: URL;
  try {
    url = new URL(texte);
  } catch {
    return null;
  }
  const locale = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && locale)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')}`;
}

/**
 * LE LIEN QUI OUVRE BELUGA PASS DÉJÀ REMPLI (carte « Relier Beluga Pass dans les réglages », 16/11/2026) — contrat
 * partagé avec la carte jumelle du projet BelugaPass « Liaison à Beluga Build en un clic » :
 * `<adresse Beluga Pass>/app/beluga#endpoint=<adresse Beluga Build encodée>&token=<bpl_…>`.
 * Les deux valeurs passent dans le FRAGMENT (après `#`) : jamais envoyé au serveur de Beluga Pass, jamais dans ses
 * journaux ni dans l'en-tête Referer. Null si une des deux adresses ou la clé n'a pas la bonne forme.
 */
export function lienDeLiaison(adresseDeBelugaPass: unknown, adresseDeBelugaBuild: unknown, cle: string): string | null {
  const pass = adresseBelugaPass(adresseDeBelugaPass);
  const build = adresseBelugaPass(adresseDeBelugaBuild);
  if (!pass || !build || !formeDeCleDeLiaison(cle)) return null;
  /* Beluga Pass qui s'appellerait lui-même : la panne du 16/11/2026 (404 sur /api/belugapass/link). */
  if (pass === build) return null;
  return `${pass}/app/beluga#endpoint=${encodeURIComponent(build)}&token=${encodeURIComponent(cle)}`;
}

/** Une clé de liaison a-t-elle la forme attendue ? (Le contrat exige au moins 20 signes.) */
export function formeDeCleDeLiaison(cle: string): boolean {
  return cle.startsWith(PREFIXE_DE_LA_CLE) && /^[A-Za-z0-9_-]{20,200}$/.test(cle.slice(PREFIXE_DE_LA_CLE.length));
}

/** Le jeton d'un en-tête `Authorization: Bearer …`, ou null. */
export function jetonDeLEntete(entete: string | string[] | undefined): string | null {
  const v = Array.isArray(entete) ? entete[0] : entete;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(v ?? '');
  return m ? m[1]! : null;
}

/* ------------------------------------------------------------------ */
/* Le miroir chiffré                                                   */
/* ------------------------------------------------------------------ */

export type JugementDuMiroir = { ok: true; coffres: number; fiches: number } | { ok: false; raison: string };

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * UN MIROIR RECEVABLE : le bon format, un compte, des coffres et des fiches dont les blocs sont du base64url opaque.
 * Beluga ne cherche RIEN à lire dedans — il vérifie seulement qu'il range bien une sauvegarde, pas n'importe quoi.
 */
export function jugerLeMiroir(corps: unknown): JugementDuMiroir {
  const m = corps as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return { ok: false, raison: 'corps illisible' };
  if (m.format !== FORMAT_DU_MIROIR) return { ok: false, raison: `format attendu : ${FORMAT_DU_MIROIR}` };
  const compte = m.account as Record<string, unknown> | undefined;
  if (!compte || typeof compte !== 'object' || typeof compte.keyset_enc !== 'string') return { ok: false, raison: 'compte absent' };
  if (!Array.isArray(m.vaults) || !Array.isArray(m.items)) return { ok: false, raison: 'coffres ou fiches absents' };
  for (const v of m.vaults as Record<string, unknown>[]) {
    if (!v || typeof v.id !== 'string' || typeof v.meta_enc !== 'string' || typeof v.key_sealed !== 'string') return { ok: false, raison: 'coffre mal formé' };
    if (!B64URL.test(v.meta_enc) || !B64URL.test(v.key_sealed)) return { ok: false, raison: 'coffre non chiffré' };
  }
  let fiches = 0;
  for (const i of m.items as Record<string, unknown>[]) {
    if (!i || typeof i.id !== 'string' || typeof i.vault_id !== 'string' || typeof i.data_enc !== 'string') return { ok: false, raison: 'fiche mal formée' };
    if (!B64URL.test(i.data_enc)) return { ok: false, raison: 'fiche non chiffrée' };
    if (!i.deleted_at) fiches++;
  }
  return { ok: true, coffres: (m.vaults as unknown[]).length, fiches };
}

/* ------------------------------------------------------------------ */
/* L'assistant                                                         */
/* ------------------------------------------------------------------ */

export const FILTRES_DE_L_ASSISTANT = ['weak', 'reused', 'breached', 'old', 'no_2fa', 'expiring'] as const;
export type FiltreDeLAssistant = (typeof FILTRES_DE_L_ASSISTANT)[number];
export const TYPES_DE_FICHE_BELUGAPASS = ['login', 'passkey', 'card', 'bank', 'identity', 'address', 'note', 'api_key', 'ssh_key', 'database', 'token'] as const;
export type TypeDeFicheBelugaPass = (typeof TYPES_DE_FICHE_BELUGAPASS)[number];

export interface IntentionDeLAssistant {
  intent: 'filter' | 'type' | 'search';
  filter?: FiltreDeLAssistant;
  type?: TypeDeFicheBelugaPass;
  terms: string[];
  reply: string;
}

/** Ce que Beluga Pass envoie : la question et des COMPTEURS, jamais une fiche. */
export interface QuestionDeLAssistant {
  question: string;
  locale: string;
  signals: { score?: number; counts?: Record<string, number>; sensitive_with_issues?: number; issue_kinds?: string[] };
}

/** Une intention rendue par un moteur est-elle conforme au contrat ? Rend sa forme propre, ou null. */
export function validerIntention(brut: unknown): IntentionDeLAssistant | null {
  const x = brut as Record<string, unknown> | null;
  if (!x || typeof x !== 'object') return null;
  const intent = x.intent;
  if (intent !== 'filter' && intent !== 'type' && intent !== 'search') return null;
  const reply = typeof x.reply === 'string' ? x.reply.trim().slice(0, 400) : '';
  if (!reply) return null;
  const terms = Array.isArray(x.terms) ? x.terms.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim().slice(0, 60)).slice(0, 8) : [];
  if (intent === 'filter') {
    if (!FILTRES_DE_L_ASSISTANT.includes(x.filter as FiltreDeLAssistant)) return null;
    return { intent, filter: x.filter as FiltreDeLAssistant, terms, reply };
  }
  if (intent === 'type') {
    if (!TYPES_DE_FICHE_BELUGAPASS.includes(x.type as TypeDeFicheBelugaPass)) return null;
    return { intent, type: x.type as TypeDeFicheBelugaPass, terms, reply };
  }
  return { intent, terms, reply };
}

/** La question ramenée à des mots simples : minuscules, sans accents. */
function mots(texte: string): string {
  return ` ${texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')} `;
}

const MOTS_DES_FILTRES: Record<FiltreDeLAssistant, RegExp> = {
  breached: /\b(fuit\w*|pirat\w*|compromis\w*|vol\w*|breach\w*|leak\w*|pwn\w*|hacked|filtr\w*|gestohl\w*|geleakt)\b/,
  reused: /\b(reutilis\w*|meme mot de passe|identiques?|doublons?|reus\w*|same password|duplicat\w*|repetid\w*|wiederverwend\w*)\b/,
  weak: /\b(faibles?|simples?|courts?|weak|short|debil\w*|schwach\w*|fragile\w*)\b/,
  no_2fa: /\b(2fa|a2f|double authentification|deux facteurs|two factor|totp|mfa|doble factor|zwei faktor)\b/,
  expiring: /\b(expir\w*|perim\w*|echeanc\w*|bientot|caduc\w*|vencim\w*|ablauf\w*|ablaufen)\b/,
  old: /\b(anciens?|vieux|vieil\w*|old|jamais change\w*|pas change\w*|antig\w*|alt)\b/,
};

const MOTS_DES_TYPES: [TypeDeFicheBelugaPass, RegExp][] = [
  ['card', /\b(cartes? (de credit|bancaires?|de paiement)|credit cards?|cards?|tarjetas?|kreditkart\w*)\b/],
  ['bank', /\b(banques?|iban|comptes? bancaires?|bank\w*|cuentas?)\b/],
  ['identity', /\b(identite|passeports?|permis|carte d identite|identity|passports?|ids?|ausweis\w*|pasaportes?)\b/],
  ['ssh_key', /\b(ssh|cles? ssh|ssh keys?|serveurs?)\b/],
  ['api_key', /\b(api|cles? d api|api keys?)\b/],
  ['database', /\b(bases? de donnees|database\w*|postgres\w*|mysql|datenbank\w*)\b/],
  ['token', /\b(jetons?|tokens?)\b/],
  ['note', /\b(notes?|notizen?)\b/],
  ['address', /\b(adresses? postales?|address\w*|adressen?)\b/],
  ['passkey', /\b(passkeys?|cles? d acces)\b/],
  ['login', /\b(identifiants?|connexions?|logins?|comptes?|accounts?)\b/],
];

const MOTS_VIDES = new Set(
  'le la les un une des de du d l mes mon ma tes ton ta ses son sa nos vos leurs a au aux et ou en dans pour par sur avec sans qui que quoi quel quelle quels quelles est sont ai as avez ont il elle ils je tu nous vous on ce cet cette ces y moi me montre montrer affiche afficher trouve trouver cherche chercher liste lister voir donne donner where which what show find my me the a an of for to in on is are all tous toutes tout mot mots passe passes fiche fiches coffre'.split(' '),
);

function phrase(locale: string, fr: string, en: string): string {
  return locale.toLowerCase().startsWith('fr') ? fr : en;
}

/**
 * L'INTENTION PAR RÈGLES : mots-clés de la question (français, anglais, allemand, espagnol), sans moteur. Une question
 * sur la santé du coffre devient un filtre ; une question sur un genre de fiche devient un type ; tout le reste est
 * une recherche sur ses mots utiles. La phrase de réponse s'appuie sur les compteurs reçus, jamais sur une fiche.
 */
export function intentionParRegles(q: QuestionDeLAssistant): IntentionDeLAssistant {
  const texte = mots(q.question ?? '');
  const locale = q.locale || 'fr';
  const compte = (cle: string) => (typeof q.signals?.counts?.[cle] === 'number' ? q.signals.counts[cle]! : null);
  const ordre: FiltreDeLAssistant[] = ['breached', 'reused', 'no_2fa', 'expiring', 'weak', 'old'];
  for (const filtre of ordre) {
    if (!MOTS_DES_FILTRES[filtre].test(texte)) continue;
    const n = compte(filtre);
    const libelles: Record<FiltreDeLAssistant, [string, string]> = {
      breached: ['mots de passe retrouvés dans une fuite', 'passwords found in a breach'],
      reused: ['mots de passe réutilisés', 'reused passwords'],
      weak: ['mots de passe faibles', 'weak passwords'],
      no_2fa: ['comptes sans double authentification', 'accounts without two-factor authentication'],
      expiring: ['fiches qui arrivent à échéance', 'items about to expire'],
      old: ['mots de passe anciens', 'old passwords'],
    };
    const [fr, en] = libelles[filtre];
    return {
      intent: 'filter',
      filter: filtre,
      terms: [],
      reply:
        n === null
          ? phrase(locale, `Voici vos ${fr}.`, `Here are your ${en}.`)
          : n === 0
            ? phrase(locale, `Aucun : vous n’avez pas de ${fr}.`, `None: you have no ${en}.`)
            : phrase(locale, `Voici vos ${fr} (${n}).`, `Here are your ${en} (${n}).`),
    };
  }
  for (const [type, re] of MOTS_DES_TYPES) {
    if (!re.test(texte)) continue;
    return { intent: 'type', type, terms: [], reply: phrase(locale, 'Voici les fiches de ce genre.', 'Here are the items of this kind.') };
  }
  const termes = texte
    .trim()
    .split(' ')
    .filter((m) => m.length > 1 && !MOTS_VIDES.has(m))
    .slice(0, 6);
  return {
    intent: 'search',
    terms: termes,
    reply: termes.length
      ? phrase(locale, `Je cherche « ${termes.join(' ')} » dans votre coffre.`, `Searching your vault for “${termes.join(' ')}”.`)
      : phrase(locale, 'Dites-moi ce que vous cherchez : un site, un genre de fiche ou un problème (mots de passe faibles, réutilisés…).', 'Tell me what you are looking for: a site, a kind of item or an issue (weak, reused passwords…).'),
  };
}
