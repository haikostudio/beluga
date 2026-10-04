/**
 * L'ASSISTANT GLOBAL — un robot en bas à droite de toute l'application (sur
 * téléphone, un bouton de l'entête, juste avant le menu).
 *
 * Il répond aux questions sur TOUT Beluga (projets, cartes, mémoire, coffre,
 * messagerie de l'espace client, marketing, statistiques, surveillance,
 * sauvegardes, notes, facturation, bases des serveurs) et il y AGIT : ajouter,
 * modifier, supprimer. Il ne touche JAMAIS au code ni aux branches : aucun
 * outil d'édition de fichier, aucune commande (`DISALLOWED_NATIVE_ASSISTANT`).
 *
 * LA VALIDATION EST TENUE PAR LE DÉMON, PAS PAR LA CONSIGNE (demande du
 * 02.10.2026). Chaque appel d'outil est CLASSÉ (`genreDeLAppel`) puis jugé
 * (`decisionDAccord`) AVANT d'être exécuté. Un geste qui demande l'accord
 * s'arrête sur une question « Autoriser / Refuser » posée dans le fil, et
 * n'est exécuté qu'après le clic. Le modèle ne peut pas contourner la règle :
 * il n'a aucun autre chemin vers les données.
 *
 *  - lecture            → toujours direct ;
 *  - écriture           → accord, SAUF interrupteur « validation automatique » ;
 *  - suppression        → accord TOUJOURS ;
 *  - envoi au client    → accord TOUJOURS (ce qui part chez un client, ou le
 *                          prévient, ne se reprend pas) ;
 *  - écriture serveur   → accord TOUJOURS (base de données d'un serveur).
 *
 * UN OUTIL OU UN GESTE INCONNU EST UNE SUPPRESSION : la classification ne
 * laisse jamais passer en silence ce qu'elle ne connaît pas.
 *
 * Rien ici ne touche à la base ni au disque : la règle se lit et se rejoue seule.
 */

import {
  HAUTEUR_CHAT_MIN,
  LARGEUR_CHAT_MAX,
  LARGEUR_CHAT_MIN,
  MARGE_CHAT,
  estTelephoneChat,
  type ChatFlottant,
  type FenetreChat,
} from './chat-flottant.js';
import {
  NIVEAU_PAR_DEFAUT,
  niveauDemande,
  plafonnerLeNiveau,
  reglagesDuNiveau,
  type NiveauAgent,
} from './niveau-agent.js';
import type { MoteurCatalogue } from './reglages-proposition.js';

export type GenreDeGeste = 'lecture' | 'ecriture' | 'suppression' | 'envoi-client' | 'ecriture-serveur';
export type DecisionDAccord = 'direct' | 'accord';

/** Les outils du démon servis à l'assistant, et à lui seul pour les cinq derniers. */
export const OUTILS_DE_L_ASSISTANT = [
  'ask_user',
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
  'compta',
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

/**
 * LES OUTILS NATIFS DU MOTEUR FERMÉS À L'ASSISTANT : tout ce qui écrit un
 * fichier, lance une commande ou délègue à un sous-agent. Il garde la lecture
 * (`Read`, `Grep`, `Glob`) et la recherche en ligne.
 */
export const DISALLOWED_NATIVE_ASSISTANT = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'Task',
  'Agent',
  'Workflow',
  'Skill',
  'CronCreate',
  'CronDelete',
  'RemoteTrigger',
  'EnterWorktree',
  'ExitWorktree',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
] as const;

const COMMANDES_COMPTA_LECTURE = new Set(['companies', 'clients', 'list', 'get', 'report']);

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/** Le genre d'un appel d'outil de l'assistant. Un inconnu est une suppression. */
export function genreDeLAppel(outil: string, args: Record<string, unknown> = {}): GenreDeGeste {
  const action = texte(args.action);
  switch (outil) {
    case 'ask_user':
    case 'attach_file':
    case 'board_list_cards':
    case 'assistant_resume':
    case 'surveillance_essai':
      return 'lecture';
    case 'board_create_card':
    case 'board_update_card':
    case 'board_move_card':
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
    case 'compta': {
      const commande = texte(args.command);
      if (COMMANDES_COMPTA_LECTURE.has(commande)) return 'lecture';
      // Une relance part chez le client par courriel : l'aperçu même passe par l'accord.
      if (commande === 'relance') return 'envoi-client';
      if (commande === 'delete' || commande === 'raw' || !commande) return 'suppression';
      return 'ecriture';
    }
    case 'coffre_fort':
      if (action === 'lister' || action === 'archives') return 'lecture';
      if (action === 'enregistrer' || action === 'restaurer') return 'ecriture';
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
      return texte(args.mode) === 'lecture' ? 'lecture' : 'ecriture-serveur';
    default:
      return 'suppression';
  }
}

/** Faut-il l'accord de l'utilisateur avant d'exécuter ce geste ? */
export function decisionDAccord(genre: GenreDeGeste, validationAuto: boolean): DecisionDAccord {
  if (genre === 'lecture') return 'direct';
  if (genre === 'ecriture') return validationAuto ? 'direct' : 'accord';
  return 'accord';
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

/**
 * L'APERÇU EXACT DU GESTE, pour la question d'accord : l'outil, puis chaque
 * paramètre sur sa ligne. Un message à un client s'y lit EN ENTIER — c'est
 * lui qu'on autorise. Les valeurs secrètes sont masquées.
 */
export function apercuDuGeste(outil: string, args: Record<string, unknown>, explication?: string): string {
  const lignes: string[] = [];
  if (explication?.trim()) lignes.push(explication.trim(), '');
  lignes.push(`Outil : ${outil}`);
  for (const [cle, valeur] of Object.entries(args)) {
    if (cle === 'pourquoi' || valeur === undefined || valeur === null || valeur === '') continue;
    let rendu = typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
    if (CHAMPS_SECRETS.test(cle)) rendu = '••••••';
    if (rendu.length > 900) rendu = `${rendu.slice(0, 900)}…`;
    lignes.push(`${cle} : ${rendu}`);
  }
  return lignes.join('\n').slice(0, 1200);
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
 * PLACE PAR DÉFAUT DU ROBOT : à GAUCHE du rond de l'agent marketing (posé à
 * 16 px du bord droit), pour que les deux ronds ne se recouvrent jamais.
 */
export const DROITE_ROBOT_DEFAUT = 16 + 48 + 12;
export const ROND_ROBOT = 48;

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
    droite: nombre(v.droite, CHAT_ASSISTANT_DEFAUT.droite),
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
/* Le niveau de l'assistant : automatique sous un plafond, ou figé       */
/* ------------------------------------------------------------------ */

/**
 * L'ASSISTANT N'EST PLUS SUR LE MODÈLE LE PLUS PUISSANT PAR DÉFAUT (demande du
 * 02.10.2026 : une simple consultation du marketing partait sur Opus). En mode
 * « auto », le juge rapide (usage `niveau-assistant`) range chaque message en
 * léger / standard / approfondi, plafonné ; sans verdict, le niveau est
 * « standard ». En mode « figé », l'utilisateur a posé un modèle à la main : rien
 * ne le réécrit (DEC-213).
 */
export const PLAFOND_ASSISTANT_PAR_DEFAUT: NiveauAgent = 'standard';

export type ModeNiveauAssistant = 'auto' | 'fige';

export interface ReglageNiveauAssistant {
  mode: ModeNiveauAssistant;
  plafond: NiveauAgent;
}

export const REGLAGE_NIVEAU_ASSISTANT_DEFAUT: ReglageNiveauAssistant = {
  mode: 'auto',
  plafond: PLAFOND_ASSISTANT_PAR_DEFAUT,
};

/** Le réglage stocké, relu sans jamais échouer : une valeur inconnue retombe sur le défaut. */
export function reglageNiveauAssistant(plafond: unknown, fige: unknown): ReglageNiveauAssistant {
  return {
    mode: fige === true || fige === '1' ? 'fige' : 'auto',
    plafond: niveauDemande(plafond) ?? PLAFOND_ASSISTANT_PAR_DEFAUT,
  };
}

/** Le niveau d'un tour : le verdict du juge (ou « standard » sans lui), sous le plafond. */
export function niveauDuTourDeLAssistant(verdict: NiveauAgent | undefined, plafond: NiveauAgent): NiveauAgent {
  return plafonnerLeNiveau(verdict ?? NIVEAU_PAR_DEFAUT, plafond);
}

/**
 * Ce qu'il faut écrire sur l'agent avant un tour, ou `undefined` si rien ne
 * change : un modèle ne se réécrit que pour un vrai changement de niveau, car
 * changer de modèle ouvre un fil moteur neuf et perd le cache du contexte.
 */
export function reglagesDuTourDeLAssistant(
  moteur: MoteurCatalogue | undefined,
  niveau: NiveauAgent,
  actuel: { model?: string; thinking?: string },
): { model: string; thinking: string } | undefined {
  if (!moteur) return undefined;
  const voulu = reglagesDuNiveau(moteur, niveau);
  if (!voulu.model) return undefined;
  if (voulu.model === actuel.model && voulu.thinking === actuel.thinking) return undefined;
  return { model: voulu.model, thinking: voulu.thinking };
}

/* ------------------------------------------------------------------ */
/* La consigne                                                          */
/* ------------------------------------------------------------------ */

export const TITRE_ASSISTANT_GLOBAL = 'Assistant Beluga';

/**
 * LA CONSIGNE DE L'ASSISTANT, stable d'un tour à l'autre (elle est le préfixe
 * du cache). Elle décrit le rôle ; la frontière, elle, est tenue par le démon.
 */
export const CONSIGNE_ASSISTANT_GLOBAL = `Tu es l'ASSISTANT de Beluga Build, ouvert depuis le robot en bas à droite de l'application (sur téléphone, depuis un bouton du haut de l'écran). L'utilisateur te parle depuis n'importe quel écran : réponds-lui directement, en français simple, comme un collègue.

TU ES BRANCHÉ SUR TOUT BELUGA, pour TOUS les projets. Chaque outil accepte un paramètre « projet » (nom ou identifiant) pour viser un projet précis ; sans lui, il vise Beluga Build. Ce que tu peux faire :
- le RÉSUMÉ de tous les projets, les cartes et leur avancement : assistant_resume, board_list_cards, board_create_card, board_update_card, board_move_card, board_delete_card ;
- les PROJETS et leurs groupes : project_manage, group_manage ;
- la MÉMOIRE et les compétences : memoire, competences ;
- le COFFRE-FORT : coffre_fort (tu peux ressortir un accès en clair quand on te le demande) ;
- la MESSAGERIE de l'espace client : assistant_messagerie (ce qui attend une réponse, lire une demande, répondre, créer, archiver) ;
- le MARKETING et son calendrier : marketing ; les STATISTIQUES : statistiques ;
- la SURVEILLANCE : assistant_surveillances, surveillance_essai, surveillance_recette ;
- les BACKUPS : assistant_backups, backup_essai, backup_recette ;
- les NOTES : assistant_notes ; la FACTURATION : compta ;
- les BASES DE DONNÉES des serveurs : assistant_base_serveur (mode « lecture » pour consulter, « ecriture » pour modifier).

TU NE TOUCHES JAMAIS AU CODE NI AUX BRANCHES : tu n'as ni commande, ni éditeur de fichier. Un changement de programme se propose en carte (board_create_card), confiée ensuite à un agent de tâche.

LA VALIDATION EST AUTOMATIQUE ET TENUE PAR BELUGA : quand un geste demande l'accord de l'utilisateur, ton appel d'outil affiche lui-même « Autoriser / Refuser » et attend son clic. Appelle donc l'outil DIRECTEMENT, sans demander la permission avant, et ajoute « pourquoi » (une phrase) pour qu'il sache ce qu'il autorise. Un refus te revient en résultat : n'insiste pas.

Réponds court. Quand tu as fait un geste, dis ce qui a changé en une phrase.`;
