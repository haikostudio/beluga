/**
 * L'ASSISTANT GLOBAL — un robot en bas à droite de toute l'application (sur
 * téléphone, un bouton de l'entête, juste avant le menu).
 *
 * Il répond aux questions sur TOUT Beluga (projets, cartes, mémoire, coffre,
 * messagerie de l'espace client, marketing, statistiques, surveillance,
 * sauvegardes, notes, facturation, bases des serveurs) et il y AGIT : ajouter,
 * modifier, supprimer.
 *
 * UN AGENT ORDINAIRE, AVEC TOUS LES DROITS (demande du 18/10/2026). Il reçoit
 * les outils, la consigne et les règles de message d'un agent ordinaire, le
 * modèle se règle dans la barre d'écriture comme partout, et il a l'accès
 * complet à la machine (commandes, fichiers). Plus d'interrupteur
 * « validation automatique », plus de niveau choisi tout seul.
 *
 * L'ACCORD NE RESTE QUE POUR CE QUI NE SE REPREND PAS, et il est tenu par le
 * démon, pas par la consigne. Chaque appel d'outil Beluga est CLASSÉ
 * (`genreDeLAppel`) puis jugé (`decisionDAccord`) AVANT d'être exécuté :
 *
 *  - lecture            → direct ;
 *  - écriture           → direct ;
 *  - suppression        → accord TOUJOURS ;
 *  - envoi au client    → accord TOUJOURS (ce qui part chez un client, ou le
 *                          prévient, ne se reprend pas) ;
 *  - écriture serveur   → accord TOUJOURS : une requête qui EFFACE des données
 *                          d'une base de serveur (`requeteDestructive`). Les
 *                          autres écritures sur un serveur sont des écritures.
 *
 * UN OUTIL OU UN GESTE INCONNU EST UNE SUPPRESSION : la classification ne
 * laisse jamais passer en silence ce qu'elle ne connaît pas.
 *
 * Rien ici ne touche à la base ni au disque : la règle se lit et se rejoue seule.
 */

import { CONSIGNE_PERIMETRE_ASSISTANT } from './perimetre-des-agents.js';
import { REGLE_DEMANDE_DE_CLONAGE } from './clonage.js';
import { nomAfficheDOutil } from './noms-outils.js';
import {
  HAUTEUR_CHAT_MIN,
  LARGEUR_CHAT_MAX,
  LARGEUR_CHAT_MIN,
  MARGE_CHAT,
  estTelephoneChat,
  type ChatFlottant,
  type FenetreChat,
} from './chat-flottant.js';

export type GenreDeGeste = 'lecture' | 'ecriture' | 'suppression' | 'envoi-client' | 'ecriture-serveur';
export type DecisionDAccord = 'direct' | 'accord';

/**
 * Les outils du démon que l'assistant reçoit EN PLUS de ceux d'un agent
 * ordinaire (`marketing` n'est servi d'ordinaire qu'à l'agent Marketing), et
 * ses six outils propres.
 */
export const OUTILS_DE_L_ASSISTANT = [
  'ask_user',
  'proposer_suites',
  'attach_file',
  'board_list_cards',
  'board_create_card',
  'board_update_card',
  'board_move_card',
  'board_delete_card',
  'project_manage',
  'group_manage',
  'memoire',
  'competences',
  'coffre_fort',
  'marketing',
  'statistiques',
  'surveillance_essai',
  'surveillance_recette',
  'backup_essai',
  'backup_recette',
  'assistant_resume',
  'assistant_notes',
  'assistant_messagerie',
  'assistant_surveillances',
  'assistant_backups',
  'assistant_base_serveur',
] as const;

/** Les outils créés pour l'assistant : aucun autre agent ne les reçoit. */
export const OUTILS_PROPRES_A_L_ASSISTANT: ReadonlySet<string> = new Set([
  'assistant_resume',
  'assistant_notes',
  'assistant_messagerie',
  'assistant_surveillances',
  'assistant_backups',
  'assistant_base_serveur',
]);


function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/** Le genre d'un appel d'outil de l'assistant. Un inconnu est une suppression. */
export function genreDeLAppel(outil: string, args: Record<string, unknown> = {}): GenreDeGeste {
  const action = texte(args.action);
  switch (outil) {
    case 'ask_user':
    case 'proposer_suites':
    case 'attach_file':
    case 'media_en_cours':
    case 'board_list_cards':
    case 'assistant_resume':
    case 'surveillance_essai':
    case 'deleguer':
    case 'evaluer':
    case 'suggerer_modele':
      return 'lecture';
    case 'board_create_card':
    case 'board_update_card':
    case 'board_move_card':
    case 'propose_task':
    case 'write_document':
    case 'make_archive':
    case 'remember':
    case 'realiser':
    case 'relancer_publication':
    case 'surveillance_recette':
    case 'backup_recette':
    case 'backup_essai':
      return 'ecriture';
    case 'board_delete_card':
      return 'suppression';
    case 'project_manage':
      if (action === 'lister') return 'lecture';
      if (action === 'retirer') return 'suppression';
      return ['creer', 'renommer', 'deplacer', 'remettre'].includes(action) ? 'ecriture' : 'suppression';
    case 'group_manage':
      if (action === 'lister') return 'lecture';
      return ['creer', 'renommer', 'regler'].includes(action) ? 'ecriture' : 'suppression';
    case 'memoire': {
      const geste = texte(args.geste);
      if (geste === 'chercher' || geste === 'lire') return 'lecture';
      if (geste === 'proposer' && action === 'deprecate') return 'suppression';
      return ['proposer', 'changelog', 'brouillon'].includes(geste) ? 'ecriture' : 'suppression';
    }
    case 'competences':
      if (action === 'lister') return 'lecture';
      if (action === 'etat') return texte(args.etat) === 'active' ? 'ecriture' : 'suppression';
      return ['ecrire', 'retour', 'importer'].includes(action) ? 'ecriture' : 'suppression';
    case 'coffre_fort':
      if (action === 'lister' || action === 'archives' || action === 'dossiers') return 'lecture';
      if (
        action === 'enregistrer' ||
        action === 'restaurer' ||
        action === 'dossier_enregistrer' ||
        action === 'dossier_restaurer'
      )
        return 'ecriture';
      return 'suppression';
    case 'marketing':
      if (action === 'lire') return 'lecture';
      if (action === 'action' && args.supprimer === true) return 'suppression';
      return ['configurer', 'fiche', 'canaux', 'action', 'contenu', 'poser_suivi', 'rapport'].includes(action)
        ? 'ecriture'
        : 'suppression';
    case 'statistiques':
      if (action === 'etat' || action === 'lire') return 'lecture';
      return ['activer', 'reperes', 'parcours'].includes(action) ? 'ecriture' : 'suppression';
    case 'assistant_notes':
      if (action === 'lister' || action === 'lire') return 'lecture';
      if (action === 'creer' || action === 'modifier') return 'ecriture';
      return 'suppression';
    case 'assistant_messagerie':
      if (['lister', 'lire', 'en_attente', 'fil_lire'].includes(action)) return 'lecture';
      // Tout ce qui s'écrit dans l'espace client prévient le client : c'est un envoi.
      if (['repondre', 'creer', 'modifier', 'deplacer', 'fil_envoyer'].includes(action)) return 'envoi-client';
      return 'suppression';
    case 'assistant_surveillances':
      if (['lister', 'historique', 'verifier'].includes(action)) return 'lecture';
      return 'suppression';
    case 'assistant_backups':
      if (action === 'lister' || action === 'points') return 'lecture';
      if (action === 'lancer') return 'ecriture';
      return 'suppression';
    case 'assistant_base_serveur':
      if (texte(args.mode) === 'lecture') return 'lecture';
      return requeteDestructive(args.requete) ? 'ecriture-serveur' : 'ecriture';
    default:
      return 'suppression';
  }
}

/**
 * UNE REQUÊTE QUI EFFACE DES DONNÉES : DELETE, DROP (table, colonne…), TRUNCATE.
 * Une requête absente ou illisible compte comme destructive — on ne laisse pas
 * passer en silence ce qu'on ne sait pas lire.
 */
export function requeteDestructive(requete: unknown): boolean {
  const sql = texte(requete);
  if (!sql) return true;
  return /\b(delete|drop|truncate)\b/i.test(sql);
}

/** Faut-il l'accord de l'utilisateur avant d'exécuter ce geste ? Seulement pour ce qui ne se reprend pas. */
export function decisionDAccord(genre: GenreDeGeste): DecisionDAccord {
  return genre === 'lecture' || genre === 'ecriture' ? 'direct' : 'accord';
}

export const REPONSE_AUTORISER_ASSISTANT = 'Autoriser';
export const REPONSE_REFUSER_ASSISTANT = 'Refuser';

/**
 * L'ACCORD N'EST DONNÉ QUE PAR LE BOUTON « AUTORISER ». Une réponse écrite à la
 * main — même « oui » — n'en est pas un : elle part à l'assistant comme un
 * refus commenté, pour qu'il reformule ou repose la question.
 */
export function accordDonne(reponse: string): boolean {
  return reponse.trim().toLowerCase() === REPONSE_AUTORISER_ASSISTANT.toLowerCase();
}

const TITRE_DU_GENRE: Record<Exclude<GenreDeGeste, 'lecture'>, string> = {
  ecriture: 'Autoriser cette modification ?',
  suppression: 'Autoriser cette suppression ?',
  'envoi-client': 'Autoriser cet envoi au client ?',
  'ecriture-serveur': 'Autoriser cette écriture sur le serveur ?',
};

/** L'intitulé de la question d'accord. */
export function questionDAccord(genre: GenreDeGeste): string {
  return genre === 'lecture' ? TITRE_DU_GENRE.ecriture : TITRE_DU_GENRE[genre];
}

/** Ce qui ne s'affiche jamais en clair dans l'aperçu d'un geste. */
const CHAMPS_SECRETS = /mot.?de.?passe|password|secret|cle$|^cle|jeton|token/i;
const MASQUE = '••••••';
/** Un texte (un message à un client, une description) se lit en entier jusque-là. */
const MAX_TEXTE = 4000;
/** Une valeur structurée (liste, objet) rendue sur une ligne. */
const MAX_LIGNE = 900;
const MAX_APERCU = 6000;
/** Les champs qui NOMMENT un élément : c'est eux qu'une puce montre d'abord. */
const CHAMPS_TITRE = ['titre', 'title', 'nom', 'name', 'label', 'libelle'];
const CHAMPS_DETAIL = ['description', 'detail', 'texte', 'resume'];

const couper = (texte: string, max: number) => (texte.length > max ? `${texte.slice(0, max)}…` : texte);
const vide = (valeur: unknown) =>
  valeur === undefined || valeur === null || valeur === '' || (Array.isArray(valeur) && valeur.length === 0);
const scalaire = (valeur: unknown) => typeof valeur !== 'object' || valeur === null;

function scalaireLisible(valeur: unknown): string {
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  return String(valeur);
}

/** Une ligne de puce pour un élément de liste : « titre — description », sinon ses valeurs simples. */
function puceDUnObjet(objet: Record<string, unknown>): string {
  const lire = (cles: string[]) =>
    cles.map((c) => objet[c]).find((v): v is string | number => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number');
  const titre = lire(CHAMPS_TITRE);
  const detail = lire(CHAMPS_DETAIL);
  if (titre !== undefined) return detail !== undefined ? `${titre} — ${detail}` : String(titre);
  return Object.entries(objet)
    .filter(([cle, v]) => !vide(v) && scalaire(v) && !CHAMPS_SECRETS.test(cle))
    .map(([, v]) => scalaireLisible(v))
    .join(' — ');
}

/**
 * UNE VALEUR, EN LIGNES LISIBLES — jamais en JSON (MEM-2737). Un texte reste
 * tel quel, un oui/non s'écrit en mots, une liste de valeurs simples se joint
 * par des virgules, une liste d'éléments se lit en puces « titre — description »,
 * un objet en lignes « clé : valeur » décalées. Une clé secrète, à n'importe
 * quelle profondeur, est masquée.
 */
export function valeurLisible(valeur: unknown, profondeur = 0): string[] {
  if (vide(valeur)) return [];
  if (typeof valeur === 'string') return [couper(valeur, MAX_TEXTE)];
  if (scalaire(valeur)) return [scalaireLisible(valeur)];
  if (Array.isArray(valeur)) {
    const elements = valeur.filter((v) => !vide(v));
    if (elements.every(scalaire)) return [couper(elements.map(scalaireLisible).join(', '), MAX_LIGNE)];
    return elements.map((element) => {
      if (scalaire(element)) return `• ${scalaireLisible(element)}`;
      if (Array.isArray(element)) return `• ${valeurLisible(element, profondeur + 1).join(' ; ')}`;
      return `• ${couper(puceDUnObjet(element as Record<string, unknown>), MAX_LIGNE)}`;
    });
  }
  const lignes: string[] = [];
  for (const [cle, sous] of Object.entries(valeur as Record<string, unknown>)) {
    if (vide(sous)) continue;
    lignes.push(...ligneDeChamp(cle, sous, profondeur + 1));
  }
  return lignes;
}

/** « clé : valeur » sur une ligne, ou « clé : » suivi des lignes de la valeur, décalées. */
function ligneDeChamp(cle: string, valeur: unknown, profondeur = 0): string[] {
  if (CHAMPS_SECRETS.test(cle)) return [`${cle} : ${MASQUE}`];
  const lignes = valeurLisible(valeur, profondeur);
  if (!lignes.length) return [];
  if (lignes.length === 1 && (scalaire(valeur) || (Array.isArray(valeur) && !lignes[0].startsWith('• ')))) return [`${cle} : ${lignes[0]}`];
  return [`${cle} :`, ...lignes.map((l) => `  ${l}`)];
}

/**
 * L'APERÇU DU GESTE, pour la question d'accord, EN TEXTE EXPLICITE : la phrase
 * de l'assistant, le nom français du geste, puis chaque paramètre en clair.
 * Ni accolade, ni crochet, ni nom technique d'outil (capture #7db7 du
 * 18/10/2026). Un message à un client s'y lit EN ENTIER — c'est lui qu'on
 * autorise. Les valeurs secrètes sont masquées, même dans un objet imbriqué.
 */
export function apercuDuGeste(outil: string, args: Record<string, unknown>, explication?: string): string {
  const lignes: string[] = [];
  if (explication?.trim()) lignes.push(explication.trim(), '');
  lignes.push(`Geste : ${nomAfficheDOutil(outil)}`);
  for (const [cle, valeur] of Object.entries(args)) {
    if (cle === 'pourquoi') continue;
    lignes.push(...ligneDeChamp(cle, valeur));
  }
  /* La borne de sécurité coupe ENTRE deux lignes, jamais au milieu d'une puce. */
  const gardees: string[] = [];
  let longueur = 0;
  for (const ligne of lignes) {
    if (longueur + ligne.length + 1 > MAX_APERCU) {
      gardees.push('…');
      break;
    }
    gardees.push(ligne);
    longueur += ligne.length + 1;
  }
  return gardees.join('\n');
}

export function texteDeRefus(reponse: string): string {
  const commentaire = reponse.trim();
  const libre = commentaire && commentaire.toLowerCase() !== REPONSE_REFUSER_ASSISTANT.toLowerCase();
  return libre
    ? `REFUSÉ — l'utilisateur n'a pas autorisé ce geste et a répondu : « ${commentaire} ». Rien n'a été exécuté. Tiens compte de sa réponse avant toute autre tentative.`
    : "REFUSÉ — l'utilisateur n'a pas autorisé ce geste. Rien n'a été exécuté. Ne le retente pas sans qu'il le redemande.";
}

/* ------------------------------------------------------------------ */
/* Le robot et sa fenêtre                                               */
/* ------------------------------------------------------------------ */

/** La préférence du compte (place du robot, taille et état du chat). */
export const CLE_ASSISTANT_GLOBAL = 'assistant-global';

/**
 * PLACE PAR DÉFAUT DU ROBOT : DANS LE COIN, à 16 px du bord droit (demande du
 * 14/10/2026). Le rond de l'agent marketing qui le poussait à gauche sur la
 * page Marketing a disparu (20/10/2026) : le coin est au robot partout.
 */
export const DROITE_ROBOT_DEFAUT = 16;
export const ROND_ROBOT = 48;
/** L'ancienne place par défaut : une préférence qui la porte encore n'a jamais été choisie à la main. */
const ANCIENNE_DROITE_PAR_DEFAUT = 16 + 48 + 12;

/** La distance du robot au bord droit, ramenée dans l'écran. */
export function droiteDuRobot(droite: unknown, largeurFenetre: number, marge = 8): number {
  const brut = typeof droite === 'number' && Number.isFinite(droite) ? droite : DROITE_ROBOT_DEFAUT;
  const max = Math.max(marge, largeurFenetre - marge - ROND_ROBOT);
  return Math.min(max, Math.max(marge, brut));
}

/**
 * La hauteur du robot au-dessus du bas de l'écran. Sur ordinateur seulement :
 * sur téléphone, le robot ne flotte plus — l'assistant s'ouvre depuis un
 * bouton de l'entête (demande du 02.10.2026).
 */
export const BAS_ROBOT = 16;

/** L'entête du haut (`quota-bar.tsx`) mesure 44 px, SANS la zone sûre du haut. */
export const HAUT_ENTETE = 44;
/**
 * SUR TÉLÉPHONE, LE CHAT S'ARRÊTE AU-DESSUS DU MENU DU BAS : 36 px de boutons,
 * 4 px de marge intérieure de chaque côté, son filet, et ses blancs (≈ 58 px,
 * SANS la zone sûre du bas), plus la marge.
 */
export const BAS_CHAT_TELEPHONE = 58 + MARGE_CHAT;

/** Ce qu'on retient du chat de l'assistant (préférence du compte). */
/** Ce qu'on retient du chat de l'assistant (préférence du compte). */
export interface ChatAssistant {
  ouvert: boolean;
  /** La distance du ROBOT au bord droit : le chat la suit. */
  droite: number;
  largeur: number;
  hauteur: number;
}

export const CHAT_ASSISTANT_DEFAUT: ChatAssistant = { ouvert: false, droite: DROITE_ROBOT_DEFAUT, largeur: 420, hauteur: 600 };

export function chatAssistantRetenu(valeur: unknown): ChatAssistant {
  if (!valeur || typeof valeur !== 'object') return CHAT_ASSISTANT_DEFAUT;
  const v = valeur as Partial<ChatAssistant>;
  const nombre = (x: unknown, repli: number) => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 20_000 ? x : repli);
  return {
    ouvert: v.ouvert === true,
    // L'ancienne place par défaut revient au coin ; une place glissée à la main reste la sienne.
    droite: v.droite === ANCIENNE_DROITE_PAR_DEFAUT ? DROITE_ROBOT_DEFAUT : nombre(v.droite, CHAT_ASSISTANT_DEFAUT.droite),
    largeur: nombre(v.largeur, CHAT_ASSISTANT_DEFAUT.largeur),
    hauteur: nombre(v.hauteur, CHAT_ASSISTANT_DEFAUT.hauteur),
  };
}

/** La place du chat à l'écran. `haut` n'existe que sur téléphone, où il est ANCRÉ SOUS L'ENTÊTE. */
export interface ChatAssistantVu extends ChatFlottant {
  /** Distance du haut de la fenêtre, SANS la zone sûre du haut (que l'écran ajoute). */
  haut?: number;
}

/**
 * SUR ORDINATEUR, LE CHAT SUIT LE ROBOT : il se pose juste au-dessus de lui, son
 * bord droit aligné sur celui du robot, ramené dans l'écran. Sa taille est
 * bornée par l'écran actuel, SOUS l'entête ; l'écran la borne EN PLUS par la zone sûre du haut
 * et le clavier, qu'aucune règle pure ne connaît.
 *
 * SUR TÉLÉPHONE, IL S'OUVRE SOUS L'ENTÊTE : ancré en haut, juste sous le bouton
 * de l'entête qui l'ouvre, pleine largeur avec la marge, et il s'arrête
 * au-dessus du menu du bas. Il ne passe donc jamais sous la barre d'état.
 */
export function chatDeLAssistant(etat: ChatAssistant, fenetre: FenetreChat, marge = MARGE_CHAT): ChatAssistantVu {
  if (estTelephoneChat(fenetre)) {
    const haut = HAUT_ENTETE + marge;
    const bas = BAS_CHAT_TELEPHONE;
    return {
      ouvert: etat.ouvert,
      droite: marge,
      haut,
      bas,
      largeur: Math.max(0, fenetre.width - 2 * marge),
      hauteur: Math.max(0, fenetre.height - haut - bas),
    };
  }
  const bas = BAS_ROBOT + ROND_ROBOT + 8;
  // Le chat ne monte jamais sur l'entête : grandi au maximum, il recouvrait le
  // menu des trois points et le rendait inatteignable.
  const hauteurLibre = Math.max(0, fenetre.height - bas - HAUT_ENTETE - marge);
  const borner = (v: number, min: number, max: number) => (max < min ? min : Math.min(max, Math.max(min, v)));
  const largeur = borner(etat.largeur, LARGEUR_CHAT_MIN, Math.min(LARGEUR_CHAT_MAX, fenetre.width - 2 * marge));
  const hauteur = borner(etat.hauteur, Math.min(HAUTEUR_CHAT_MIN, hauteurLibre), hauteurLibre);
  const droite = borner(droiteDuRobot(etat.droite, fenetre.width, marge), marge, fenetre.width - marge - largeur);
  return { ouvert: etat.ouvert, droite, bas, largeur, hauteur };
}

/* ------------------------------------------------------------------ */
/* La consigne                                                          */
/* ------------------------------------------------------------------ */

export const TITRE_ASSISTANT_GLOBAL = 'Assistant Beluga';

/**
 * Ce que la consigne dit de la facturation : rien dans le dépôt public, où
 * l'application de facturation Haiko n'existe pas (la ligne privée est retirée
 * à la publication, la liste vide donne alors un texte vide).
 */
const MENTION_FACTURATION = [
].join('');

/**
 * CE QUE L'ASSISTANT REÇOIT EN PLUS DE LA CONSIGNE D'UN AGENT ORDINAIRE
 * (`server/src/runtime.ts`), stable d'un tour à l'autre (elle est le préfixe du
 * cache). Elle décrit son rôle et ses outils propres ; l'accord, lui, est tenu
 * par le démon.
 */
export const CONSIGNE_ASSISTANT_GLOBAL = `TU ES L'ASSISTANT DE BELUGA BUILD, ouvert depuis le robot en bas à droite de l'application (sur téléphone, depuis un bouton du haut de l'écran). L'utilisateur te parle depuis n'importe quel écran : réponds-lui directement, comme un collègue. Tu n'as ni carte ni branche.

TU AS L'ACCÈS COMPLET : tu lis, tu écris, tu lances des commandes et tu administres cette machine sans demander la permission au coup par coup. Une modification du PROGRAMME d'un projet (son code, ses branches) se propose en carte (board_create_card) : la carte a sa propre branche et son propre dossier, et son travail passe par « À déployer ». Un travail découpé en étapes ordonnées se propose en UNE suite (champ « etapes » du même appel), jamais en cartes séparées qui partiraient dans le désordre. Tu ne modifies jamais toi-même le dépôt d'un projet en place, ni celui que sert Beluga, et tu ne redémarres jamais Beluga.

TU ES BRANCHÉ SUR TOUT BELUGA, pour TOUS les projets. Chaque outil Beluga accepte un paramètre « projet » (nom ou identifiant) pour viser un projet précis ; sans lui, il vise le projet de l'application, « Beluga ». En plus des outils de tout agent :
- le RÉSUMÉ de tous les projets, les cartes et leur avancement : assistant_resume ;
- le COFFRE-FORT : coffre_fort (tu peux ressortir un accès en clair quand on te le demande, et JOINDRE ou RETIRER les photos d'une fiche : « enregistrer » avec « images », l'alias de la pièce jointe de la conversation — tu ne réponds jamais que tu n'en as pas le droit ; tu RANGES les fiches en dossiers et sous-dossiers (chemin « Clients/Acme/Prod ») : « enregistrer » avec « dossier », « dossiers », « dossier_enregistrer », « dossier_supprimer » et « dossier_restaurer ») ;
- la MESSAGERIE de l'espace client : assistant_messagerie (ce qui attend une réponse, lire une demande, répondre, créer, archiver) ;
- le MARKETING de chaque projet — calendrier, plan, contenus, canaux, comptes, rapport : marketing, TOUJOURS avec « projet » (l'écran Marketing n'a plus d'agent à lui : c'est toi qu'on y appelle, et un message qui commence par « Marketing de « X » : » vise le projet X ; les longues analyses restent à l'agent marketing du projet, lancées depuis son écran) ; les STATISTIQUES : statistiques ;
- la SURVEILLANCE : assistant_surveillances, surveillance_essai, surveillance_recette ;
- les BACKUPS : assistant_backups, backup_essai, backup_recette ;
- les NOTES : assistant_notes ;${MENTION_FACTURATION}
- les BASES DE DONNÉES des serveurs : assistant_base_serveur (mode « lecture » pour consulter, « ecriture » pour modifier).

${REGLE_DEMANDE_DE_CLONAGE}

${CONSIGNE_PERIMETRE_ASSISTANT}

SEULS CE QUI EFFACE ET CE QUI PART CHEZ UN CLIENT ATTENDENT L'ACCORD, et c'est Beluga qui le tient : une suppression, un envoi dans l'espace client ou une requête qui efface des données d'un serveur affiche lui-même « Autoriser / Refuser » et attend le clic. Appelle donc l'outil DIRECTEMENT, sans demander la permission avant, et ajoute « pourquoi » (une phrase) pour qu'il sache ce qu'il autorise. Tout le reste part sans question. Un refus te revient en résultat : n'insiste pas.`;
