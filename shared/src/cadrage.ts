/**
 * LA CARTE-FIL : ON DISCUTE SA TÂCHE DANS LA CARTE, PLUS DANS LE CHEF D'ORCHESTRE.
 *
 * Avant, poser une tâche demandait deux endroits : le fil du chef d'orchestre
 * pour expliquer le besoin, puis une carte proposée, validée, lancée — et la
 * discussion restait derrière, dans un autre fil, invisible de la carte.
 *
 * Désormais le « + » de la colonne « Planifié » crée DIRECTEMENT la carte et
 * l'ouvre sur sa conversation. Un agent de CADRAGE, sur un modèle économe, y
 * discute le besoin : il questionne, reformule, et écrit au fur et à mesure le
 * titre, la description et le NIVEAU d'exécution sur la carte elle-même
 * (`board_update_card`). Il ne touche à aucun fichier — la carte n'a pas encore
 * de branche.
 *
 * Un bouton « Lancer la tâche », en pleine largeur au-dessus du champ de
 * saisie, ferme le cadrage : la carte part en « En cours » sur un modèle
 * ADAPTÉ à la demande (le niveau retenu, traduit par `niveau-agent.ts`), et
 * TOUTE la discussion lui est remise comme contexte de départ.
 *
 * Règle PURE : ni base, ni disque, ni moteur. Elle se rejoue seule.
 */

import type { ColumnKey } from './columns.js';

/** Le titre d'une carte qui vient de naître et n'a encore rien dit. */
export const TITRE_CARTE_DE_CADRAGE = 'Nouvelle tâche';

/** Ce que la conversation d'une carte de cadrage encore vide annonce. */
export const MOT_CADRAGE = {
  titre: 'Dites ce que vous voulez faire',
  indice:
    'Expliquez votre besoin en quelques mots. On en discute ici, à moindre coût, puis « Lancer la tâche » confie le travail à un agent complet.',
};

/** Le libellé du bouton qui ferme le cadrage et lance le travail. */
export const BOUTON_LANCER_LA_TACHE = 'Lancer la tâche';

/**
 * Le libellé du geste qui l'accompagne : mettre la carte en file plutôt que de
 * la lancer tout de suite. Il vit DANS le fil, juste au-dessus du champ de
 * saisie, et non plus au pied du tiroir — les deux gestes de lancement d'une
 * carte de cadrage se prennent là où la discussion se termine.
 */
export const BOUTON_DES_QUE_POSSIBLE = 'Dès que possible';

/**
 * Les deux raisons qui éteignent ce bouton, réunies pour être TRADUITES : elles
 * s'affichent à l'écran sans qu'aucun `t('…')` littéral ne les nomme, la règle
 * vivant ici et l'affichage dans le fil de la carte.
 */
export const RAISONS_DU_BOUTON_LANCER = [
  'Attendez la fin de la réponse en cours.',
  'Dites d’abord ce que vous voulez faire.',
] as const;

/* ------------------------------------------------------------------ */
/* Le bouton « Lancer la tâche »                                       */
/* ------------------------------------------------------------------ */

export interface EtatBoutonLancer {
  /** Le bouton est-il seulement à sa place ici ? */
  affiche: boolean;
  /** Le geste est-il possible en l'état ? */
  possible: boolean;
  /** Pourquoi il ne l'est pas — dit à l'écran, jamais tu. */
  raison?: string;
}

export interface ContexteBoutonLancer {
  /** La colonne de la carte. */
  colonne: ColumnKey;
  /** Le rôle de l'agent qui tient la conversation de la carte. */
  roleAgent?: string;
  /** Un tour est en cours dans ce fil. */
  agentAuTravail: boolean;
  /** Combien de messages ont déjà été échangés. */
  messages: number;
}

/**
 * LE BOUTON NE S'AFFICHE QUE LÀ OÙ IL A UN SENS : dans une carte de cadrage
 * encore en « Planifié ». Une carte déjà lancée, une note, une carte rangée
 * n'ont rien à lancer depuis ici — le pied du tiroir garde ses propres gestes.
 *
 * Et il ne PEUT partir qu'une fois quelque chose dit : lancer un agent complet
 * sur une carte vide, c'est payer un tour pour lui faire deviner la demande.
 */
export function boutonLancerLaTache(ctx: ContexteBoutonLancer): EtatBoutonLancer {
  if (ctx.colonne !== 'planned' || ctx.roleAgent !== 'cadrage') {
    return { affiche: false, possible: false };
  }
  /*
   * TANT QUE RIEN N'EST DIT, RIEN NE S'AFFICHE. Le bouton restait posé, gris,
   * sur une carte vierge : il occupait la place au-dessus du champ de saisie
   * juste au moment où l'on cherche ce champ, et sa seule phrase disait
   * d'écrire quelque chose — ce que l'accueil de la conversation dit déjà.
   * Les gestes de lancement n'apparaissent donc qu'une fois la DISCUSSION
   * ENGAGÉE ; leur raison reste rendue, pour qui voudrait l'expliquer.
   */
  if (ctx.messages <= 0) {
    return { affiche: false, possible: false, raison: RAISONS_DU_BOUTON_LANCER[1] };
  }
  if (ctx.agentAuTravail) {
    return { affiche: true, possible: false, raison: RAISONS_DU_BOUTON_LANCER[0] };
  }
  return { affiche: true, possible: true };
}

/* ------------------------------------------------------------------ */
/* La discussion devenue contexte de départ                            */
/* ------------------------------------------------------------------ */

/** Ce qu'un message apporte au contexte de départ, et rien de plus. */
export interface MessageDeCadrage {
  role: string;
  content: string;
}

/**
 * Le contexte de départ ne doit pas coûter plus cher que le travail : au-delà
 * de ce plafond, on garde la FIN de la discussion (la plus récente, donc la
 * plus proche de ce qui a été décidé) et on dit ce qu'on a laissé.
 */
export const PLAFOND_DISCUSSION = 12000;

const QUI = (role: string): string => (role === 'user' ? 'VOUS' : 'CADRAGE');

/**
 * La discussion mise à plat, prête à être recollée dans la demande de
 * lancement. Rend une chaîne vide quand rien n'a été dit : l'appelant n'a
 * alors aucun bloc à poser.
 *
 * Seuls les tours de PAROLE comptent — un message d'outil ou de système n'est
 * pas ce que l'utilisateur a expliqué.
 */
export function discussionDeCadrage(messages: MessageDeCadrage[]): string {
  const utiles = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: (m.content ?? '').trim() }))
    .filter((m) => m.content.length > 0);
  if (!utiles.length) return '';

  const lignes = utiles.map((m) => `${QUI(m.role)} :\n${m.content}`);
  const texte = lignes.join('\n\n');
  if (texte.length <= PLAFOND_DISCUSSION) return texte;

  // On rogne par le DÉBUT : la fin porte les décisions.
  const gardees: string[] = [];
  let total = 0;
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    total += lignes[i].length + 2;
    if (total > PLAFOND_DISCUSSION && gardees.length) break;
    gardees.unshift(lignes[i]);
  }
  const coupes = lignes.length - gardees.length;
  const garde = gardees.join('\n\n');
  return coupes > 0 ? `(${coupes} échange(s) plus ancien(s) non recopié(s).)\n\n${garde}` : garde;
}

/**
 * LE BLOC ENTIER remis à l'agent d'exécution, en tête de sa demande. Il dit
 * d'où vient la discussion et ce qu'elle vaut : une intention exprimée par
 * l'utilisateur, pas une étude du projet.
 */
export function contexteDeDepart(messages: MessageDeCadrage[]): string {
  const discussion = discussionDeCadrage(messages);
  if (!discussion) return '';
  return `CE QUI A ÉTÉ DIT AVANT LE LANCEMENT — la conversation de cadrage de cette carte, entre l'utilisateur (« VOUS ») et un agent léger (« CADRAGE ») qui n'a PAS ouvert le projet. C'est l'intention, pas une étude : ce qui y est affirmé sur le code se vérifie avant d'être repris.

${discussion}

FIN DE LA CONVERSATION DE CADRAGE.`;
}

/* ------------------------------------------------------------------ */
/* Le titre d'une carte qui n'en a pas encore                          */
/* ------------------------------------------------------------------ */

/** Le titre porte-t-il encore le mot par défaut ? */
export function titreEncoreVide(titre: string | undefined): boolean {
  const mot = (titre ?? '').trim();
  return !mot || mot.toLowerCase() === TITRE_CARTE_DE_CADRAGE.toLowerCase();
}

/**
 * La carte ouverte par le BOUTON ROBO du menu du bas n'existe vraiment que si
 * quelque chose y a été saisi — un message envoyé, ou un brouillon en train
 * de s'écrire. Sans l'un ni l'autre, elle repart en base à la fermeture du
 * tiroir : c'est cette décision, pure et testée seule, que `app.tsx` applique
 * à la fermeture (voir `carteRobotIdRef` dans `web/src/app.tsx`).
 */
export function carteRobotEstVide(etat: { nbMessages: number; brouillon?: string }): boolean {
  return etat.nbMessages <= 0 && !(etat.brouillon ?? '').trim();
}

/**
 * Les tags « [fichier: nom] » posés par le composeur : illisibles dans un
 * titre de carte, ils ne disent rien du besoin. On les retire avant d'en
 * tirer une phrase — le même motif que `TAG_FICHIER` de `ancres.ts`.
 */
const TAG_FICHIER_DU_TITRE = /\[fichier:\s*[^\]\n]+\]/g;

/** Le texte d'un message, débarrassé de ses tags de fichiers. */
function sansTagsDeFichier(texte: string): string {
  return texte.replace(TAG_FICHIER_DU_TITRE, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Un titre tiré de la discussion, quand l'agent de cadrage n'a pas pris la
 * peine d'en écrire un : la première phrase de la première demande, coupée
 * court et débarrassée de ses tags de fichiers. Mieux qu'une colonne de
 * cartes toutes appelées « Nouvelle tâche » — ou toutes affublées d'un
 * « [fichier: IMG_1234.jpeg] » en tête.
 */
export function titreDepuisLaDiscussion(messages: MessageDeCadrage[], secours = TITRE_CARTE_DE_CADRAGE): string {
  const premier = messages.find(
    (m) => m.role === 'user' && sansTagsDeFichier((m.content ?? '').trim()).length > 0,
  );
  if (!premier) return secours;
  const ligne = sansTagsDeFichier(premier.content.trim().split(/\r?\n/)[0]);
  const phrase = ligne || sansTagsDeFichier(premier.content.trim());
  if (!phrase) return secours;
  if (phrase.length <= 80) return phrase;
  const coupe = phrase.slice(0, 80);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > 40 ? coupe.slice(0, espace) : coupe).trim()}…`;
}

/* ------------------------------------------------------------------ */
/* La consigne de l'agent de cadrage                                   */
/* ------------------------------------------------------------------ */

/**
 * LA CONSIGNE DE RÔLE de l'agent de cadrage. Elle est courte à dessein : cet
 * agent tourne sur un modèle économe, à chaque message, et son seul travail est
 * de comprendre puis d'écrire la carte.
 */
export const CONSIGNE_CADRAGE = `TU ES L'AGENT DE CADRAGE D'UNE CARTE. Tu ne codes pas, tu ne lances aucune commande, tu ne modifies aucun fichier : la carte n'a pas encore de branche, et le travail sera fait après par un agent complet.

TON TRAVAIL, ET RIEN D'AUTRE :
1. COMPRENDRE le besoin. Réponds court — quelques phrases, jamais de compte rendu à titres. Si un point change ce qui sera fait, pose UNE question à la fois avec l'outil « ask_user ». Ce qui se devine se devine : tu n'interroges pas sur des détails.
2. ÉCRIRE LA CARTE au fur et à mesure, avec l'outil « board_update_card » sur la carte de cette conversation : un titre court et parlant, une description qui dit ce qui est attendu, et le champ « niveau » (« leger », « standard » ou « approfondi ») selon l'ampleur du travail — « leger » pour un geste simple ou une tâche d'administration/rédaction, « standard » pour un travail de code ordinaire, « approfondi » pour un chantier. Tu la mets à jour à CHAQUE fois que la demande se précise.
3. DIRE, dans cette même discussion, QUEL MODÈLE exécutera la tâche : l'outil te répond, à chaque changement de niveau, avec le moteur, le modèle et la réflexion réels qu'il a retenus — recopie cette phrase pour l'utilisateur, sans l'inventer toi-même. Rappelle que ce réglage est visible et modifiable juste en dessous du champ de saisie, avant de lancer.
4. DIRE que le travail peut partir. Quand la demande est claire, annonce-le en une phrase : le bouton « Lancer la tâche », au-dessus du champ de saisie, confiera la carte à un agent complet qui recevra toute cette discussion.

TU NE LANCES RIEN TOI-MÊME et tu ne proposes aucune autre carte : cette conversation EST la carte. Tu n'inventes rien du projet — tu ne l'as pas ouvert ; ce que tu supposes se dit comme une supposition.`;
