import { z } from 'zod';
import { EngineId } from './models.js';

/**
 * Connecter un compte de moteur depuis les réglages.
 *
 * Les moteurs restent les outils en ligne de commande du serveur : connecter un
 * compte, c'est lancer LEUR commande de connexion dans le coffre du compte, puis
 * lire ce qu'elle écrit. Tout ce qui se décide sans base ni disque vit ici :
 * quelle commande lancer, ce qu'il faut retenir de sa sortie, ce que vaut la
 * connexion d'un compte, et comment dire une fin de course en français.
 *
 * Les deux moteurs ne se connectent PAS de la même façon :
 *
 * - Claude ouvre une page et attend qu'on lui RECOPIE un code par son entrée
 *   standard (« Paste code here »).
 * - Codex, lui, montre une adresse ET un code à saisir SUR la page, puis attend
 *   tout seul que l'échange aboutisse. C'est le mode « device » : sans lui, le
 *   moteur ouvrirait une page qui renvoie vers le serveur lui-même, injoignable
 *   depuis le navigateur de l'utilisateur.
 */

export interface CommandeDeConnexion {
  /** L'outil en ligne de commande à lancer. */
  commande: string;
  args: string[];
  /** La variable d'environnement qui désigne le coffre du compte. */
  variableDossier: string;
  /** Le moteur attend-il qu'on lui renvoie un code par son entrée standard ? */
  codeARecopier: boolean;
}

export function commandeDeConnexion(engine: EngineId): CommandeDeConnexion {
  if (engine === 'codex') {
    return {
      commande: 'codex',
      args: ['login', '--device-auth'],
      variableDossier: 'CODEX_HOME',
      codeARecopier: false,
    };
  }
  return {
    commande: 'claude',
    args: ['auth', 'login'],
    variableDossier: 'CLAUDE_CONFIG_DIR',
    codeARecopier: true,
  };
}

/**
 * Les couleurs et les liens cliquables des terminaux, retirés. Sans ce ménage,
 * l'adresse remonterait à l'écran collée à des suites d'échappement, et le code
 * à usage unique serait introuvable.
 */
export function nettoyerSortie(texte: string): string {
  return (
    texte
      // Lien cliquable d'un terminal : ESC ] 8 ;; adresse BEL
      .replace(/\]8;;[^]*(?:|\\)/g, '')
      // Couleurs et déplacements du curseur
      .replace(/\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\r/g, '')
  );
}

export interface InviteConnexion {
  /** L'adresse à ouvrir dans SON navigateur. */
  lien?: string;
  /** Le code à recopier SUR la page (Codex). */
  code?: string;
  /** Le moteur réclame-t-il qu'on lui renvoie un code (Claude) ? */
  attendLeCode: boolean;
}

/** Un code à usage unique : des blocs de lettres et de chiffres séparés par un tiret. */
const CODE = /\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/;

/**
 * Ce qu'il y a à montrer dans la sortie du moteur, à chaque bouffée reçue. La
 * fonction est rejouée sur la sortie ENTIÈRE : elle ne retient donc rien d'un
 * appel à l'autre et rend toujours le même résultat pour le même texte.
 */
export function lireInvite(sortie: string): InviteConnexion {
  const texte = nettoyerSortie(sortie);

  const lien = texte.match(/https?:\/\/[^\s'"<>]+/)?.[0]?.replace(/[.,;:)\]]+$/, '');

  // Le code ne se cherche qu'APRÈS l'adresse : sinon un morceau de l'adresse
  // elle-même (jeton, empreinte) passerait pour un code à recopier.
  const apres = lien ? texte.slice(texte.indexOf(lien) + lien.length) : texte;
  const code = apres.match(CODE)?.[1];

  return {
    lien,
    code,
    attendLeCode: /paste code here|colle[rz]? (?:le|ce) code/i.test(texte),
  };
}

/* ------------------------------------------------------------------ */
/* La fin de course                                                    */
/* ------------------------------------------------------------------ */

export interface FinDeConnexion {
  /** Sortie du programme : `null` quand il a été tué. */
  code: number | null;
  /** Le signal qui l'a tué, quand il en a reçu un. */
  signal?: string | null;
  /** Ce que le moteur a écrit, du début à la fin. */
  texte?: string;
  /** L'utilisateur a demandé l'arrêt. */
  annulee?: boolean;
  /** Le moteur n'a jamais abouti dans le temps imparti. */
  delaiDepasse?: boolean;
  /** Le programme n'a même pas pu démarrer (commande absente). */
  introuvable?: boolean;
}

/**
 * Une fin de course se dit en français, et jamais en silence : un refus, une
 * commande absente ou un délai dépassé s'affichent à l'écran comme la réussite.
 */
export function raisonDeSortie(fin: FinDeConnexion): { ok: boolean; message: string } {
  if (fin.introuvable) {
    return { ok: false, message: "La commande du moteur est introuvable sur le serveur : rien n'a pu être lancé." };
  }
  if (fin.annulee) return { ok: false, message: 'Connexion abandonnée à la demande.' };
  if (fin.delaiDepasse) {
    return { ok: false, message: "La connexion n'a pas abouti dans le temps imparti : elle a été abandonnée." };
  }
  if (fin.code === 0) return { ok: true, message: 'Compte connecté.' };

  const detail = dernierePhrase(fin.texte);
  const fin_ = fin.signal ? `interrompue (${fin.signal})` : `refusée (code ${fin.code ?? '?'})`;
  return { ok: false, message: detail ? `Connexion ${fin_} : ${detail}` : `Connexion ${fin_}.` };
}

/** La dernière ligne qui apprend quelque chose, pour ne pas rendre un pavé. */
function dernierePhrase(texte: string | undefined): string {
  if (!texte) return '';
  const lignes = nettoyerSortie(texte)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^https?:\/\//.test(l));
  const derniere = lignes[lignes.length - 1] ?? '';
  return derniere.length > 200 ? `${derniere.slice(0, 200)}…` : derniere;
}

/* ------------------------------------------------------------------ */
/* Ce que vaut la connexion d'un compte                                */
/* ------------------------------------------------------------------ */

export type EtatConnexion = 'valide' | 'absente' | 'expiree' | 'refusee' | 'inconnue';

export interface EtatCompteConnexion {
  etat: EtatConnexion;
  /** Ce qui s'écrit sur la ligne du compte, en français simple. */
  libelle: string;
  /** Faut-il proposer « Reconnecter » ? */
  doitReconnecter: boolean;
}

export interface LectureCompte {
  /** L'erreur du dernier relevé de quota, telle quelle. */
  erreur?: string;
  /** Quand le jeton du compte arrive à échéance, si on a su le lire. */
  expireA?: number;
  maintenant?: number;
}

/**
 * L'état RÉEL de la connexion d'un compte. On ne se contente pas du badge
 * « épuisé » : un compte peut avoir tout son quota et un jeton mort, et rien à
 * l'écran ne le disait — il fallait ouvrir un terminal pour le découvrir.
 */
export function etatDeConnexion(lecture: LectureCompte): EtatCompteConnexion {
  const erreur = (lecture.erreur ?? '').toLowerCase();
  const maintenant = lecture.maintenant ?? Date.now();

  // Un coffre sans fichier d'identifiants : le compte n'a jamais été connecté.
  // La lecture du quota échoue alors sur le FICHIER ABSENT (« ENOENT »), pas sur
  // un jeton vide — sans ce cas, l'écran restait muet sur un compte à connecter.
  if (/non connect|aucun jeton|no credentials|enoent|no such file/.test(erreur)) {
    return { etat: 'absente', libelle: 'jamais connecté', doitReconnecter: true };
  }
  if (/\b(401|403)\b|refus/.test(erreur)) {
    return { etat: 'refusee', libelle: 'connexion refusée', doitReconnecter: true };
  }
  if (typeof lecture.expireA === 'number' && Number.isFinite(lecture.expireA) && lecture.expireA <= maintenant) {
    return { etat: 'expiree', libelle: 'connexion expirée', doitReconnecter: true };
  }
  if (erreur) {
    // Une lecture de quota ratée ne prouve rien sur la connexion : on ne pousse
    // pas à reconnecter un compte qui marche peut-être très bien.
    return { etat: 'inconnue', libelle: 'état de connexion inconnu', doitReconnecter: false };
  }
  return { etat: 'valide', libelle: 'connexion valide', doitReconnecter: false };
}

/* ------------------------------------------------------------------ */
/* Le suivi d'une connexion en cours                                   */
/* ------------------------------------------------------------------ */

export const EtapeConnexion = z.enum(['demarrage', 'attente', 'reussie', 'echec']);
export type EtapeConnexion = z.infer<typeof EtapeConnexion>;

export const ConnexionCompte = z.object({
  /** L'identifiant de CETTE tentative, jamais celui du compte. */
  id: z.string(),
  engine: EngineId,
  /** Le compte visé, quand on en reconnecte un déjà déclaré. */
  accountId: z.string().optional(),
  label: z.string(),
  etape: EtapeConnexion,
  /** L'adresse à ouvrir dans SON navigateur. */
  lien: z.string().optional(),
  /** Le code à recopier sur la page. */
  code: z.string().optional(),
  /** Le moteur réclame-t-il qu'on lui renvoie un code ? */
  attendLeCode: z.boolean().default(false),
  /** Ce qui est arrivé, quand c'est fini. */
  message: z.string().optional(),
  commenceeA: z.number(),
  finieA: z.number().optional(),
});
export type ConnexionCompte = z.infer<typeof ConnexionCompte>;

/** Une tentative finie ne se relance pas et n'accepte plus de code. */
export function connexionTerminee(connexion: Pick<ConnexionCompte, 'etape'>): boolean {
  return connexion.etape === 'reussie' || connexion.etape === 'echec';
}
