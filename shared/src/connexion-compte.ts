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
 *   tout seul que l'échange aboutisse. C'est le mode « device » (voie
 *   « appareil »), la voie par défaut.
 * - OpenAI REFUSE parfois ce mode (« device code login is not enabled »). Codex
 *   a alors une SECONDE voie, « navigateur » : la page d'OpenAI renvoie vers
 *   `http://localhost:1455/auth/callback?code=…&state=…`, c'est-à-dire vers
 *   l'appareil de l'utilisateur, où rien n'écoute — la page d'erreur qu'il voit
 *   porte pourtant tout ce qu'il faut. Il en colle l'adresse dans Beluga, et le
 *   SERVEUR la rejoue sur son propre port 1455, où Codex attend.
 */

export type VoieConnexion = 'appareil' | 'navigateur';

export interface CommandeDeConnexion {
  /** L'outil en ligne de commande à lancer. */
  commande: string;
  args: string[];
  /** La variable d'environnement qui désigne le coffre du compte. */
  variableDossier: string;
  /** Le moteur attend-il qu'on lui renvoie un code par son entrée standard ? */
  codeARecopier: boolean;
}

export function commandeDeConnexion(engine: EngineId, voie: VoieConnexion = 'appareil'): CommandeDeConnexion {
  if (engine === 'codex') {
    return {
      commande: 'codex',
      args: voie === 'navigateur' ? ['login'] : ['login', '--device-auth'],
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
  /**
   * Le `state` de l'adresse d'autorisation (voie navigateur) : le seul moyen de
   * reconnaître le retour de CETTE tentative. Il reste côté serveur.
   */
  state?: string;
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

  /*
   * LA PREMIÈRE ADRESSE N'EST PAS FORCÉMENT LA BONNE. En voie navigateur, Codex
   * écrit d'abord « Starting local login server on http://localhost:1455. » :
   * c'est son propre port, injoignable depuis l'appareil de l'utilisateur. On
   * retient la première adresse qui ne vise PAS la machine elle-même.
   */
  const adresses = [...texte.matchAll(/https?:\/\/[^\s'"<>]+/g)].map((m) => m[0].replace(/[.,;:)\]]+$/, ''));
  const lien = adresses.find((a) => !estAdresseLocale(a)) ?? adresses[0];

  // Le code ne se cherche qu'APRÈS l'adresse : sinon un morceau de l'adresse
  // elle-même (jeton, empreinte) passerait pour un code à recopier.
  const apres = lien ? texte.slice(texte.indexOf(lien) + lien.length) : texte;
  const code = apres.match(CODE)?.[1];

  return {
    lien,
    code,
    attendLeCode: /paste code here|colle[rz]? (?:le|ce) code/i.test(texte),
    state: lien ? stateDeLAdresse(lien) : undefined,
  };
}

function estAdresseLocale(adresse: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(adresse);
}

function stateDeLAdresse(adresse: string): string | undefined {
  try {
    return new URL(adresse).searchParams.get('state') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * OPENAI A-T-IL REFUSÉ LE CODE D'APPAREIL ? Le refus se lit dans la sortie de
 * Codex (pendant la tentative ou à sa fin) ; l'écran bascule alors d'office sur
 * la voie navigateur. L'invite « Use `codex login --device-auth` instead » de la
 * voie navigateur n'est PAS un refus.
 */
export function refusCodeAppareil(sortie: string): boolean {
  const texte = nettoyerSortie(sortie);
  return /device code login is not enabled|enable device code (?:authorization|login|auth)|activez la connexion par code d.appareil|failed to request device code|device code request failed with status 4\d\d/i.test(
    texte,
  );
}

/* ------------------------------------------------------------------ */
/* L'adresse de retour collée (voie navigateur)                        */
/* ------------------------------------------------------------------ */

export type RaisonAdresseRefusee =
  | 'pas-une-adresse'
  | 'mauvais-chemin'
  | 'sans-code'
  | 'sans-state'
  | 'ancienne-tentative'
  | 'erreur-openai';

export type AdresseDeRetour =
  | { ok: true; chemin: string }
  | { ok: false; raison: RaisonAdresseRefusee; detail?: string };

/**
 * L'ADRESSE DE LA PAGE D'ERREUR, telle que l'utilisateur la colle : avec des
 * espaces, sans « http:// », sur `localhost` ou `127.0.0.1`. Elle n'est rejouée
 * que si son `state` est celui de la tentative EN COURS : une adresse d'une
 * ancienne tentative ferait échouer Codex (« state mismatch ») et l'arrêterait.
 * Rend le seul chemin à rejouer sur le port local, jamais l'hôte collé.
 */
export function validerAdresseDeRetour(collee: string, stateAttendu: string | undefined): AdresseDeRetour {
  const brute = (collee ?? '').replace(/\s+/g, '');
  // Ni chemin ni paramètres : un mot, pas une adresse.
  if (!brute || !/[/?]/.test(brute.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''))) return { ok: false, raison: 'pas-une-adresse' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(brute) ? brute : `http://${brute}`);
  } catch {
    return { ok: false, raison: 'pas-une-adresse' };
  }
  const erreur = url.searchParams.get('error');
  if (erreur) {
    const detail = url.searchParams.get('error_description') || erreur;
    return { ok: false, raison: 'erreur-openai', detail };
  }
  if (url.pathname.replace(/\/+$/, '') !== '/auth/callback') return { ok: false, raison: 'mauvais-chemin' };
  const code = url.searchParams.get('code');
  if (!code) return { ok: false, raison: 'sans-code' };
  const state = url.searchParams.get('state');
  if (!state) return { ok: false, raison: 'sans-state' };
  if (!stateAttendu || state !== stateAttendu) return { ok: false, raison: 'ancienne-tentative' };
  return { ok: true, chemin: `/auth/callback${url.search}` };
}

/** Ce que l'écran dit d'une adresse refusée, en français simple. */
export function messageAdresseRefusee(raison: RaisonAdresseRefusee, detail?: string): string {
  switch (raison) {
    case 'pas-une-adresse':
      return "Ce texte n'est pas une adresse. Copiez l'adresse complète de la page d'erreur, dans la barre du navigateur.";
    case 'mauvais-chemin':
      return "Ce n'est pas l'adresse attendue : elle doit commencer par localhost:1455/auth/callback.";
    case 'sans-code':
      return "L'adresse est incomplète : il y manque le code rendu par OpenAI. Copiez-la en entier.";
    case 'sans-state':
      return "L'adresse est incomplète : il y manque sa fin. Copiez-la en entier.";
    case 'ancienne-tentative':
      return "Cette adresse vient d'une connexion précédente. Cliquez à nouveau sur « Se connecter à OpenAI », puis collez la nouvelle adresse.";
    case 'erreur-openai':
      return `OpenAI a refusé la connexion${detail ? ` : ${detail}` : '.'}`;
  }
}

/* ------------------------------------------------------------------ */
/* L'essai réel après connexion                                        */
/* ------------------------------------------------------------------ */

/** Le modèle du réglage du compte est-il refusé par un compte ChatGPT ? */
export function modeleRefuse(sortie: string): boolean {
  return /model is not supported when using codex with a chatgpt account|model[^\n]{0,80}(?:is not supported|does not exist|not found)/i.test(
    nettoyerSortie(sortie),
  );
}

/**
 * LE MODÈLE DE REMPLACEMENT, pris dans la liste que Codex garde lui-même
 * (`models_cache.json` du coffre) : le premier modèle PROPOSÉ (`visibility:
 * 'list'`) — Codex les range du plus récent au plus ancien. Rien d'inventé : sans
 * liste lisible, aucun remplacement.
 */
export function modeleDeRemplacement(cache: unknown, refuse?: string): string | undefined {
  const modeles = (cache as { models?: unknown })?.models;
  if (!Array.isArray(modeles)) return undefined;
  for (const m of modeles) {
    const slug = (m as { slug?: unknown })?.slug;
    const visibilite = (m as { visibility?: unknown })?.visibility;
    if (typeof slug === 'string' && slug && visibilite === 'list' && slug !== refuse) return slug;
  }
  return undefined;
}

/** Le modèle réglé dans un `config.toml` (la ligne `model = "…"` de tête). */
export function modeleDeConfig(toml: string): string | undefined {
  for (const ligne of (toml ?? '').split('\n')) {
    if (/^\s*\[/.test(ligne)) return undefined; // une table commence : plus de réglage de tête
    const m = ligne.match(/^\s*model\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Remplace la SEULE ligne `model = "…"` de tête d'un `config.toml`, sans rien
 * toucher d'autre ; l'ajoute en tête si elle manque.
 */
export function remplacerModeleDeConfig(toml: string, modele: string): string {
  const lignes = (toml ?? '').split('\n');
  for (let i = 0; i < lignes.length; i += 1) {
    if (/^\s*\[/.test(lignes[i])) break;
    if (/^\s*model\s*=/.test(lignes[i])) {
      lignes[i] = `model = "${modele}"`;
      return lignes.join('\n');
    }
  }
  return `model = "${modele}"\n${toml ?? ''}`;
}

/**
 * L'issue de l'essai réel (`codex exec … "Réponds uniquement: OK"`), en
 * français. Seul un essai qui RÉPOND dit « opérationnel » : ni la présence des
 * identifiants, ni `codex login status` ne le prouvent.
 */
export function issueDuControle(fin: { code: number | null; sortie: string; delaiDepasse?: boolean }): {
  ok: boolean;
  message: string;
} {
  const texte = nettoyerSortie(fin.sortie ?? '');
  if (fin.delaiDepasse) return { ok: false, message: "Le moteur n'a pas répondu à l'essai dans le temps imparti." };
  if (fin.code === 0) return { ok: true, message: 'Connecté et opérationnel.' };
  if (modeleRefuse(texte)) return { ok: false, message: 'Le modèle réglé pour ce compte est refusé par OpenAI.' };
  if (/\b401\b|unauthorized|sign in again|log out and sign in|not logged in|refresh token/i.test(texte)) {
    return { ok: false, message: 'OpenAI refuse la session de ce compte : reconnectez-le.' };
  }
  if (/\b429\b|usage limit|rate limit|quota/i.test(texte)) {
    return { ok: false, message: 'Le compte est connecté, mais son quota est atteint pour le moment.' };
  }
  const detail = dernierePhrase(texte);
  return { ok: false, message: detail ? `L'essai du moteur a échoué : ${detail}` : "L'essai du moteur a échoué." };
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
    // L'invite du moteur précède sa réponse sur la même ligne (pas de retour
    // après « > ») : sans ce retrait, la raison commençait par elle.
    .map((l) => l.replace(/^.*paste code here if prompted\s*>\s*/i, '').trim())
    .filter((l) => l && !/^https?:\/\//.test(l));
  const derniere = lignes[lignes.length - 1] ?? '';
  return derniere.length > 200 ? `${derniere.slice(0, 200)}…` : derniere;
}

/**
 * Y A-T-IL ENCORE DE QUOI RENOUVELER LA SESSION ? Le jeton d'accès de Claude se
 * refait tout seul tant que le jeton de RENOUVELLEMENT tient. Absent ou lui-même
 * échu, la porte est fermée : seule une reconnexion à la main rouvrira le
 * compte. Sans cette question, le serveur relançait le moteur en ligne de
 * commande à CHAQUE relevé de quota, pour trente secondes d'attente et un échec
 * certain.
 */
export function peutRenouvelerLaSession(
  jetons: { refreshToken?: string; refreshTokenExpiresAt?: number } | undefined,
  maintenant = Date.now(),
): boolean {
  if (!jetons?.refreshToken) return false;
  const echeance = Number(jetons.refreshTokenExpiresAt);
  return !(Number.isFinite(echeance) && echeance > 0 && echeance <= maintenant);
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
  /**
   * Quand le jeton de RENOUVELLEMENT arrive à échéance. C'est lui qui décide de
   * la vraie fin de vie d'une session : le jeton d'accès, lui, se refait tout
   * seul tant que celui-ci tient.
   */
  renouvellementExpireA?: number;
  /**
   * Le coffre existe, mais ses jetons sont VIDES. Le moteur les efface lui-même
   * quand il n'a plus de quoi renouveler : le compte a donc bien été connecté un
   * jour, sa session est simplement finie.
   */
  coffreVide?: boolean;
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
  if (/enoent|no such file|no credentials/.test(erreur)) {
    return { etat: 'absente', libelle: 'non connecté', doitReconnecter: true };
  }

  /*
   * UN COFFRE VIDÉ N'EST PAS UN COMPTE JAMAIS CONNECTÉ. Quand le jeton de
   * renouvellement arrive à échéance, le moteur RÉÉCRIT son fichier
   * d'identifiants avec des jetons vides : le compte tombe alors sur « compte
   * non connecté » alors qu'il a servi la veille. Dire « jamais connecté »
   * envoyait chercher un problème d'installation là où il n'y a qu'une session
   * à refaire — arrivé sur Claude Pro le 30/08/2026.
   */
  const renouvellementFini =
    typeof lecture.renouvellementExpireA === 'number' &&
    Number.isFinite(lecture.renouvellementExpireA) &&
    lecture.renouvellementExpireA <= maintenant;
  if (lecture.coffreVide || renouvellementFini) {
    return { etat: 'expiree', libelle: 'session expirée', doitReconnecter: true };
  }

  if (/non connect|aucun jeton/.test(erreur)) {
    return { etat: 'absente', libelle: 'non connecté', doitReconnecter: true };
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
  /**
   * Quand le code recopié est parti au moteur. Entre cet instant et la fin, le
   * moteur échange le code contre ses jetons : l'écran montre un chargement et
   * rien d'autre (champ optionnel : un navigateur ancien l'ignore).
   */
  codeEnvoyeA: z.number().optional(),
  /** La voie de cette tentative (Codex) : code d'appareil ou navigateur. */
  voie: z.enum(['appareil', 'navigateur']).optional(),
  /** Quand la tentative sera abandonnée : l'écran affiche le temps restant. */
  expireA: z.number().optional(),
  /** Voie navigateur : l'écran attend l'adresse de la page d'erreur. */
  attendAdresseDeRetour: z.boolean().optional(),
  /** OpenAI a refusé le code d'appareil : l'écran bascule sur la voie navigateur. */
  proposerNavigateur: z.boolean().optional(),
  /** L'adresse collée est partie au moteur : chargement jusqu'à l'issue. */
  adresseEnvoyeeA: z.number().optional(),
  /** L'essai réel après connexion, et ce qu'il a dit. */
  controle: z.enum(['en-cours', 'operationnel', 'echec']).optional(),
});
export type ConnexionCompte = z.infer<typeof ConnexionCompte>;

/** Une tentative finie ne se relance pas et n'accepte plus de code. */
export function connexionTerminee(connexion: Pick<ConnexionCompte, 'etape'>): boolean {
  return connexion.etape === 'reussie' || connexion.etape === 'echec';
}

/** Combien de temps le résultat d'une connexion reste seul sur la ligne du compte. */
export const DUREE_RESULTAT_CONNEXION_MS = 6000;

/**
 * CE QUE MONTRE LA LIGNE D'UN COMPTE PENDANT UNE CONNEXION.
 *
 * - `saisie` : l'adresse et le champ du code sont affichés ; les pastilles et
 *   les boutons restent visibles.
 * - `validation` : le code est parti, le moteur l'échange. Pastilles et boutons
 *   se cachent derrière un chargement — un « Retirer » cliqué à ce moment
 *   visait un coffre en pleine réécriture.
 * - `resultat` : « Connexion réussie » ou « Connexion échouée » avec sa raison,
 *   seul, quelques secondes. Le quota est relu AVANT que la fin ne parte (côté
 *   serveur) : les pastilles qui reviennent ensuite sont déjà à jour.
 * - `aucune` : la ligne habituelle.
 */
export type PhaseLigneCompte = 'aucune' | 'saisie' | 'validation' | 'resultat';

export function phaseDeLigneCompte(
  connexion: Pick<ConnexionCompte, 'etape' | 'finieA' | 'codeEnvoyeA'> | undefined,
  maintenant = Date.now(),
): PhaseLigneCompte {
  if (!connexion) return 'aucune';
  if (connexionTerminee(connexion)) {
    const fin = connexion.finieA ?? 0;
    return maintenant - fin < DUREE_RESULTAT_CONNEXION_MS ? 'resultat' : 'aucune';
  }
  return connexion.codeEnvoyeA ? 'validation' : 'saisie';
}

/* ------------------------------------------------------------------ */
/* Le renouvellement forcé d'une session Claude                        */
/* ------------------------------------------------------------------ */

/**
 * UN SEUL RENOUVELLEMENT EN VOL PAR COMPTE. Une deuxième demande qui arrive
 * pendant le premier ne relance rien : elle reçoit la MÊME promesse, puis relit
 * le coffre frais. La place se libère dès que le vol est posé, réussi ou non.
 */
export function enUnSeulVol<T>(vols: Map<string, Promise<T>>, cle: string, lancer: () => Promise<T>): Promise<T> {
  const enVol = vols.get(cle);
  if (enVol) return enVol;
  const vol = (async () => {
    try {
      return await lancer();
    } finally {
      vols.delete(cle);
    }
  })();
  vols.set(cle, vol);
  return vol;
}

export type DecisionDeRenouvellement = 'forcer' | 'laisser-aux-agents' | 'impossible';

/**
 * LE RELEVÉ DE QUOTA NE FORCE UN RENOUVELLEMENT QUE SUR UN COMPTE AU REPOS.
 * Un agent au travail sur le compte renouvelle lui-même sa session : lancer un
 * moteur de plus sur le même coffre ne fait que disputer le verrou du moteur
 * (« another Claude Code process is holding the refresh lock ») et coûter un
 * tour raté à l'agent.
 */
export function decisionDeRenouvellement(entree: {
  peutRenouveler: boolean;
  agentsAuTravail: number;
}): DecisionDeRenouvellement {
  if (!entree.peutRenouveler) return 'impossible';
  return entree.agentsAuTravail > 0 ? 'laisser-aux-agents' : 'forcer';
}

const deuxChiffres = (n: number) => String(n).padStart(2, '0');
function momentEnClair(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return 'inconnue';
  const d = new Date(ms);
  return `${deuxChiffres(d.getUTCDate())}/${deuxChiffres(d.getUTCMonth() + 1)} ${deuxChiffres(d.getUTCHours())}:${deuxChiffres(d.getUTCMinutes())} UTC`;
}

/**
 * LA LIGNE DE JOURNAL D'UN RENOUVELLEMENT : quel compte, qui l'a demandé, son
 * issue, et quand tomberont le jeton d'accès puis la session. Si une coupure
 * revient, sa cause se LIT au lieu de se reconstituer.
 */
export function ligneDeRenouvellement(entree: {
  compte: string;
  demandeur: string;
  ok: boolean;
  raison?: string;
  expireA?: number;
  renouvellementExpireA?: number;
  coffreVide?: boolean;
}): string {
  const tete = `renouvellement de la session Claude — ${entree.compte}, demandé par ${entree.demandeur}`;
  if (entree.ok) {
    return `${tete} : réussi, jeton valable jusqu'au ${momentEnClair(entree.expireA)}, session jusqu'au ${momentEnClair(entree.renouvellementExpireA)}`;
  }
  const vide = entree.coffreVide ? ' ; le moteur a VIDÉ le coffre (jeton de renouvellement refusé)' : '';
  return `${tete} : échoué${entree.raison ? ` (${entree.raison})` : ''}${vide}`;
}

/**
 * « ÉPUISÉ » NE SE DIT QUE D'UN COMPTE QUI RÉPOND. Un compte hors du choix
 * parce que sa connexion est refusée (clé rejetée, session morte) n'est pas à
 * sec : l'étiquette de connexion le dit déjà, et « épuisé » à côté envoyait
 * chercher un solde vide là où il fallait changer de clé.
 */
export function compteEpuise(quota: { available: boolean; connexion?: { doitReconnecter: boolean } }): boolean {
  return !quota.available && !quota.connexion?.doitReconnecter;
}
