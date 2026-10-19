import fs from 'node:fs';
import type { GenreMessage, ReseauSocial } from '@beluga/shared';

/**
 * CE QUE TOUT RÉSEAU SAIT FAIRE, VU DU DÉMON — l'adaptateur commun.
 *
 * Chaque réseau (`server/src/reseaux/<réseau>.ts`) parle à son interface
 * OFFICIELLE et rend des objets de cette forme ; `publication-sociale.ts` ne
 * connaît que ce contrat. Les adaptateurs ne lisent ni la base ni le coffre :
 * ils reçoivent les identifiants de l'application et le jeton du compte, et
 * rendent ce que le réseau a répondu.
 *
 * Écrits d'après les documentations officielles de chaque réseau ; Postiz
 * (AGPL-3.0) n'a servi qu'à repérer les points d'entrée, aucune ligne n'en
 * vient.
 */

export interface IdentifiantsApplication {
  clientId: string;
  secret: string;
}

export interface Jetons {
  acces: string;
  rafraichissement?: string;
  /** Instant d'expiration de l'accès, s'il expire. */
  expireLe?: number;
}

/** Un compte trouvé à la connexion : une page, un profil, une chaîne, un établissement. */
export interface CompteTrouve {
  reseau: ReseauSocial;
  distantId: string;
  nom: string;
  avatar?: string;
  jetons: Jetons;
  /** Un accès renouvelable sans l'utilisateur ? */
  renouvelable: boolean;
  /** Ce que l'adaptateur doit retrouver plus tard (page parente, tableau Pinterest, URN…). */
  details?: Record<string, unknown>;
}

/** Ce qu'un adaptateur reçoit pour agir au nom d'un compte. */
export interface ContexteCompte {
  distantId: string;
  nom: string;
  jeton: string;
  details: Record<string, any>;
}

export interface MediaAEnvoyer {
  genre: 'image' | 'video';
  mime: string;
  /** Le fichier sur le disque, pour les réseaux qui reçoivent les octets. */
  chemin: string;
  taille: number;
  /** Une adresse publique signée et temporaire, pour ceux qui viennent le chercher. */
  urlPublique: string;
}

export interface ArticleAPublier {
  titre: string;
  /** Le texte déjà adapté au réseau (`texteDuReseau`), lien de suivi compris. */
  texte: string;
  /** Le lien de suivi, pour les réseaux qui le portent à part (Pinterest, fiche Google). */
  lien?: string | null;
  medias: MediaAEnvoyer[];
  langue?: string;
}

export interface Publie {
  distantId: string;
  url?: string;
}

/** Un commentaire ou un message relu chez le réseau. */
export interface MessageRelu {
  genre: GenreMessage;
  distantId: string;
  /** La publication commentée, ou la conversation. */
  fil: string;
  auteur: string;
  auteurId?: string;
  texte: string;
  instant: number;
  sortant: boolean;
  url?: string;
}

export interface PublicationConnue {
  distantId: string;
  contenuId: string;
}

export interface Adaptateur {
  /** L'adresse où l'utilisateur donne son accord. `verificateur` sert aux réseaux qui exigent PKCE. */
  urlDeConnexion(p: { app: IdentifiantsApplication; retour: string; etat: string; verificateur: string }): string;
  /** Le code rendu par le réseau, échangé contre les comptes qu'il ouvre. */
  echangerCode(p: { app: IdentifiantsApplication; retour: string; code: string; verificateur: string }): Promise<CompteTrouve[]>;
  rafraichir?(p: { app: IdentifiantsApplication; rafraichissement: string; ctx: ContexteCompte }): Promise<Jetons>;
  publier(p: { app: IdentifiantsApplication; ctx: ContexteCompte; article: ArticleAPublier }): Promise<Publie>;
  lireCommentaires?(p: { app: IdentifiantsApplication; ctx: ContexteCompte; publications: PublicationConnue[] }): Promise<MessageRelu[]>;
  repondreCommentaire?(p: { app: IdentifiantsApplication; ctx: ContexteCompte; message: { distantId: string; fil: string }; texte: string }): Promise<{ distantId: string; url?: string }>;
  lireMessages?(p: { app: IdentifiantsApplication; ctx: ContexteCompte }): Promise<MessageRelu[]>;
  repondreMessage?(p: { app: IdentifiantsApplication; ctx: ContexteCompte; message: { fil: string; auteurId?: string }; texte: string }): Promise<{ distantId: string }>;
}

/**
 * UN REFUS DU RÉSEAU. `aRelier` : l'accès n'est plus bon (expiré, retiré) — le
 * compte passe « à relier » au lieu de rester en erreur.
 */
export class ErreurReseau extends Error {
  constructor(
    message: string,
    readonly statut = 0,
    readonly aRelier = false,
  ) {
    super(message);
  }
}

const DELAI_APPEL_MS = 60_000;

/** Tire le message lisible d'une réponse d'erreur, quelle que soit sa forme. */
function messageDErreur(corps: any, statut: number): string {
  const brut =
    corps?.error?.error_user_msg ??
    corps?.error?.message ??
    corps?.error_description ??
    corps?.message ??
    corps?.detail ??
    corps?.title ??
    (typeof corps?.error === 'string' ? corps.error : null) ??
    corps?.errors?.[0]?.message ??
    corps?.error?.code;
  return String(brut ?? `réponse ${statut}`).slice(0, 400);
}

/**
 * UN APPEL HTTP À UN RÉSEAU : délai borné, réponse lue en JSON, refus rendu
 * en `ErreurReseau`. Un 401 (ou le code 190 de Meta) vaut « accès à refaire ».
 */
export async function appel<T = any>(url: string, init: RequestInit & { delaiMs?: number } = {}): Promise<{ corps: T; entetes: Headers; statut: number }> {
  const { delaiMs, ...reste } = init;
  let reponse: Response;
  try {
    reponse = await fetch(url, { ...reste, signal: AbortSignal.timeout(delaiMs ?? DELAI_APPEL_MS) });
  } catch (err: any) {
    throw new ErreurReseau(`réseau injoignable (${err?.name === 'TimeoutError' ? 'délai dépassé' : (err?.message ?? 'erreur')})`);
  }
  const texte = await reponse.text();
  let corps: any = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    corps = { message: texte.slice(0, 300) };
  }
  if (!reponse.ok || corps?.error?.code === 190) {
    const aRelier = reponse.status === 401 || corps?.error?.code === 190 || corps?.error === 'invalid_grant';
    throw new ErreurReseau(messageDErreur(corps, reponse.status), reponse.status, aRelier);
  }
  return { corps: corps as T, entetes: reponse.headers, statut: reponse.status };
}

export function formulaire(champs: Record<string, string | number | undefined | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(champs)) if (valeur !== undefined && valeur !== null) p.set(cle, String(valeur));
  return p;
}

export function adresse(base: string, champs: Record<string, string | number | undefined | null>): string {
  const q = formulaire(champs).toString();
  return q ? `${base}${base.includes('?') ? '&' : '?'}${q}` : base;
}

export function basique(app: IdentifiantsApplication): string {
  return `Basic ${Buffer.from(`${app.clientId}:${app.secret}`).toString('base64')}`;
}

/** L'échéance d'un jeton qui dure `secondes`. */
export function echeance(secondes: unknown): number | undefined {
  const n = Number(secondes);
  return Number.isFinite(n) && n > 0 ? Date.now() + n * 1000 : undefined;
}

export function lireOctets(m: MediaAEnvoyer): Buffer {
  return fs.readFileSync(m.chemin);
}

export function premierMedia(article: ArticleAPublier, genre?: 'image' | 'video'): MediaAEnvoyer | undefined {
  return genre ? article.medias.find((m) => m.genre === genre) : (article.medias.find((m) => m.genre === 'video') ?? article.medias[0]);
}

export const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function instantDe(valeur: unknown): number {
  const t = typeof valeur === 'number' ? (valeur < 1e12 ? valeur * 1000 : valeur) : Date.parse(String(valeur ?? ''));
  return Number.isFinite(t) ? t : Date.now();
}
