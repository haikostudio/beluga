/**
 * « L'agent attendait une réponse, et personne ne l'a su. »
 *
 * Un agent qui a besoin d'un arbitrage doit appeler l'outil `ask_user` : la
 * question est alors enregistrée, le triangle orange s'allume sur la carte, et
 * la réponse relance le tour. Mais rien n'oblige le moteur à s'en servir — il
 * lui suffit d'écrire sa question en TEXTE ORDINAIRE à la fin de sa réponse.
 * Le tour se termine alors normalement (code de sortie 0), aucune décision
 * n'est enregistrée, et la carte reste en « En cours » avec sa liste de tâches
 * inachevée : l'attente est invisible du tableau.
 *
 * On ne peut pas empêcher le moteur d'écrire ce qu'il veut. On peut, en
 * revanche, le RECONNAÎTRE : le dernier message d'un tour achevé qui se termine
 * sur une question adressée à l'utilisateur vaut une décision attendue, et
 * allume le même triangle que l'outil.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Le strict nécessaire pour juger : ce qu'un message porte de pertinent. */
export interface MessageAJuger {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** L'agent écrit-il encore ? Un message en cours ne se juge pas. */
  streaming?: boolean;
  /** Des questions posées par l'outil : le mécanisme prévu a servi. */
  questions?: unknown[];
  /** Des propositions en attente : elles comptent déjà comme décision. */
  proposals?: unknown[];
  /**
   * Un tour coupé par la limite d'un compte : le choix du compte de reprise est
   * DÉJÀ une décision attendue, comptée à un seul endroit. La compter deux fois
   * ferait annoncer deux attentes là où l'écran n'en montre qu'une.
   */
  repriseCompte?: unknown;
  /** Le bouton « Annuler » du repère a déjà fermé cette question. */
  texteLibreAnnulee?: boolean;
}

/**
 * Une question doit dire quelque chose. En dessous de cette longueur, on est
 * devant un « ok ? » de politesse ou une fin de phrase tronquée, pas devant un
 * arbitrage qui bloque le travail.
 */
export const LONGUEUR_MINIMALE = 20;

/** Au-delà, ce n'est plus une question mais un paragraphe qui finit mal. */
export const LONGUEUR_MAXIMALE = 400;

/**
 * Les tournures qui ne demandent RIEN : l'agent se parle à lui-même, ou
 * annonce ce qu'il va faire. Comparées sur le texte mis en minuscules et
 * débarrassé de ses accents.
 */
const TOURNURES_SANS_DEMANDE = [
  'que faire ensuite',
  'qu est-ce qui a change',
  'pourquoi cela',
  'est-ce vraiment le cas',
];

/** Minuscules, sans accents : pour comparer des tournures sans se tromper. */
function aplati(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La dernière phrase du texte : ce qui suit le dernier saut de ligne, puis le
 * dernier point ou point d'exclamation. Les marques de mise en forme
 * (**gras**, listes, citations) sont retirées — elles ne changent pas le sens
 * et fausseraient la lecture du dernier signe.
 */
function dernierePhrase(texte: string): string {
  const propre = texte
    .replace(/```[\s\S]*?```/g, ' ') // les blocs de code ne posent pas de question
    .replace(/[*_`>#]/g, '')
    .trim();
  const derniereLigne = propre.split(/\n+/).filter((l) => l.trim()).pop() ?? '';
  const morceaux = derniereLigne.split(/(?<=[.!])\s+/);
  return (morceaux.pop() ?? '').replace(/^[-–—•\d.)\s]+/, '').trim();
}

/**
 * Le dernier message d'un tour achevé pose-t-il une question restée sans
 * mécanisme ? On rend la question elle-même — c'est elle qu'on affichera —, ou
 * `null` quand il n'y a rien à trancher.
 *
 * Ce qui l'écarte, dans l'ordre : un message qui n'est pas de l'agent, un
 * message encore en cours d'écriture, un message qui porte DÉJÀ une question de
 * l'outil ou une proposition (la décision est comptée ailleurs, on ne la
 * doublerait pas), une question déjà fermée par le bouton « Annuler », un texte
 * qui ne finit pas par un point d'interrogation, et enfin une question trop
 * courte, trop longue ou purement rhétorique.
 */
export function questionEnTexteLibre(message: MessageAJuger): string | null {
  if (message.role !== 'assistant') return null;
  if (message.streaming) return null;
  if (message.questions?.length) return null;
  if (message.proposals?.length) return null;
  if (message.repriseCompte) return null;
  if (message.texteLibreAnnulee) return null;

  const phrase = dernierePhrase(message.content ?? '');
  if (!phrase.endsWith('?')) return null;
  if (phrase.length < LONGUEUR_MINIMALE || phrase.length > LONGUEUR_MAXIMALE) return null;

  const compare = aplati(phrase);
  if (TOURNURES_SANS_DEMANDE.some((t) => compare.startsWith(t))) return null;

  return phrase;
}

/** L'état d'un agent, réduit à ce qui dit s'il travaille encore. */
export type StatutAgent = 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'done';

/** Un agent au travail : son dernier message n'est pas le mot de la fin. */
export function agentAuTravail(statut: StatutAgent | undefined): boolean {
  return statut === 'starting' || statut === 'running';
}

/**
 * Les colonnes où le travail est RANGÉ : plus rien ne s'y décide. Une carte
 * arrivée là a été menée au bout — une question écrite en chemin a forcément
 * trouvé sa réponse, sans quoi la carte ne serait pas close.
 */
export const COLONNES_RANGEES = ['to_deploy', 'archived'] as const;

/** La carte est-elle rangée ? Sans colonne connue, on ne présume rien. */
export function carteRangee(colonne: string | undefined): boolean {
  return colonne ? (COLONNES_RANGEES as readonly string[]).includes(colonne) : false;
}

/**
 * Le tour est-il ACHEVÉ sur cette question ? Trois conditions, toutes trois
 * nécessaires : l'agent ne travaille plus, le message jugé est bien le DERNIER
 * de la CARTE — tous agents confondus, pas seulement du fil de celui qui a
 * écrit —, et la carte n'est pas déjà rangée.
 *
 * Le premier point était le piège : un ancien agent finissait son fil sur une
 * question, un agent suivant répondait et terminait le travail, mais le message
 * de l'ancien restait le dernier de SON fil — la question se comptait pour
 * toujours. C'est l'appelant qui choisit le message ; le garde-fou de la
 * colonne, lui, vit ici et rattrape le cas où la carte a été menée au bout par
 * un autre chemin.
 */
export function decisionEnTexteLibre(entree: {
  statut?: StatutAgent;
  dernierMessage?: MessageAJuger;
  /** La colonne de la carte, quand il y en a une. */
  colonne?: string;
}): string | null {
  if (agentAuTravail(entree.statut)) return null;
  if (carteRangee(entree.colonne)) return null;
  if (!entree.dernierMessage) return null;
  return questionEnTexteLibre(entree.dernierMessage);
}

/* ------------------------------------------------------------------ */
/* LA QUESTION POSÉE PAR L'AGENT, ET RIEN D'AUTRE                      */
/* ------------------------------------------------------------------ */

/** Une question posée par l'outil `ask_user`, réduite à ce qui décide. */
export interface QuestionAJuger {
  answer?: string;
  cancelled?: boolean;
}

/**
 * CE MESSAGE ATTEND-IL ENCORE UNE RÉPONSE ?
 *
 * Une question de l'outil `ask_user` compte tant qu'elle n'a ni réponse ni
 * annulation. C'est le seul signal qui retienne une carte en « En cours » à la
 * fin d'un tour (`issueDeFinDeTour`) — et il est volontairement ÉTROIT :
 *
 *  - une carte PROPOSÉE en fin de travail attend bien une décision, mais elle
 *    ne dit rien de la tâche qui vient de se finir ;
 *  - un INCIDENT (tour coupé par une erreur, compte à sec) attend lui aussi un
 *    choix, mais c'est un échec — et un échec laisse déjà la carte là où on la
 *    relance, par sa propre règle. Le compter ici bloquerait la carte pour
 *    toujours : le tour de relance verrait encore l'incident du tour d'avant.
 */
export function messageAttendUneReponse(message: { questions?: QuestionAJuger[] } | undefined): boolean {
  return (message?.questions ?? []).some((q) => !q.answer && !q.cancelled);
}

/* ------------------------------------------------------------------ */
/* LES CHOIX CACHÉS DANS UNE QUESTION ÉCRITE EN TEXTE ORDINAIRE        */
/* ------------------------------------------------------------------ */

/**
 * UNE SEULE FAÇON DE POSER UNE QUESTION.
 *
 * Une question posée par l'outil `ask_user` porte ses options : elles
 * s'affichent en pastilles cliquables. Une question écrite en texte ordinaire
 * n'en porte aucune — et elle n'offrait donc qu'un champ vide, alors que le
 * texte de l'agent énumère presque toujours les réponses attendues.
 *
 * Cette règle RELIT ce texte et en tire les choix, pour que la bulle soit la
 * même des deux côtés. Elle est volontairement PRUDENTE : mieux vaut aucun
 * choix qu'un choix inventé, l'écriture libre restant toujours ouverte.
 */

/** Au-delà, ce n'est plus un choix mais un paragraphe. */
export const LONGUEUR_CHOIX_MAX = 90;

/** Une pastille d'un seul signe ne veut rien dire. */
export const LONGUEUR_CHOIX_MIN = 2;

/** Plus de six pastilles, ce n'est plus un choix : c'est une liste à lire. */
export const NOMBRE_CHOIX_MAX = 6;

/** Le début d'une ligne de liste : tiret, puce, numéro ou lettre. */
const MARQUEUR_DE_LISTE = /^\s*(?:[-–—*•]|\d+[.)]|[A-Za-z][.)])\s+/;

/** Les marques de mise en forme, qui ne changent pas le sens d'un choix. */
function nettoyerChoix(ligne: string): string {
  return ligne
    .replace(MARQUEUR_DE_LISTE, '')
    .replace(/[*_`]/g, '')
    .replace(/^[«"']\s*|\s*[»"']$/g, '')
    .replace(/\s*[.;,]$/, '')
    .trim();
}

/** Un choix retenu : ni vide, ni trop long, ni une question de plus. */
function choixRecevable(texte: string): boolean {
  return (
    texte.length >= LONGUEUR_CHOIX_MIN &&
    texte.length <= LONGUEUR_CHOIX_MAX &&
    !texte.endsWith('?')
  );
}

/** Deux choix identiques ne font qu'une pastille. */
function sansDoublons(choix: string[]): string[] {
  const vus = new Set<string>();
  return choix.filter((c) => {
    const cle = aplati(c);
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/**
 * Le bloc de liste qui touche la ligne `depart`, en avançant de `pas` (+1 vers
 * le bas, -1 vers le haut). Une ligne vide s'enjambe tant qu'aucun élément n'a
 * encore été trouvé ; dès qu'un élément est lu, elle ferme le bloc.
 */
function blocDeListe(lignes: string[], depart: number, pas: 1 | -1): string[] {
  const trouves: string[] = [];
  for (let i = depart; i >= 0 && i < lignes.length; i += pas) {
    const ligne = lignes[i];
    if (!ligne.trim()) {
      if (trouves.length) break;
      continue;
    }
    if (!MARQUEUR_DE_LISTE.test(ligne)) break;
    trouves.push(nettoyerChoix(ligne));
  }
  return pas === -1 ? trouves.reverse() : trouves;
}

/**
 * L'ÉNUMÉRATION QUI SUIT UN DEUX-POINTS. « Deux chemins : refaire le calcul ou
 * garder l'ancien ? » donne bien deux pastilles. Sans deux-points, on ne coupe
 * RIEN : « Veux-tu que je continue ou que j'arrête ? » se découperait en deux
 * moitiés de phrase, ce qui serait pire que pas de choix du tout.
 */
function enumerationApresDeuxPoints(phrase: string): string[] {
  const coupe = phrase.lastIndexOf(':');
  if (coupe < 0) return [];
  const queue = phrase.slice(coupe + 1).replace(/\s*\?$/, '').trim();
  if (!queue) return [];
  /*
   * « ou » d'abord, la virgule SEULEMENT à défaut : « 2 600 CHF/an ou 3 900
   * CHF/an » se coupe bien en deux, alors qu'une coupe à la virgule aurait
   * découpé les montants eux-mêmes en morceaux illisibles.
   */
  const parOu = queue.split(/\s+ou\s+bien\s+|\s+ou\s+/i).map(nettoyerChoix).filter(Boolean);
  if (parOu.length >= 2) return parOu;
  const parVirgule = queue.split(/\s*[,;]\s*/).map(nettoyerChoix).filter(Boolean);
  return parVirgule.length >= 2 ? parVirgule : [];
}

/**
 * LES CHOIX QUE PROPOSE UNE QUESTION ÉCRITE EN TEXTE ORDINAIRE.
 *
 * On regarde, dans cet ordre : la liste posée JUSTE APRÈS la question, celle
 * posée JUSTE AVANT, puis l'énumération qui suit un deux-points dans la phrase
 * elle-même. Rien de recevable : on rend une liste vide, et la bulle se
 * contente de son écriture libre.
 */
export function choixDeQuestionEnTexte(contenu: string): string[] {
  const propre = (contenu ?? '').replace(/```[\s\S]*?```/g, ' ');
  const lignes = propre.split(/\n/);
  const iQuestion = (() => {
    for (let i = lignes.length - 1; i >= 0; i -= 1) {
      if (lignes[i].replace(/[*_`>#]/g, '').trim().endsWith('?')) return i;
    }
    return -1;
  })();
  if (iQuestion < 0) return [];

  const candidats = [
    blocDeListe(lignes, iQuestion + 1, 1),
    blocDeListe(lignes, iQuestion - 1, -1),
    enumerationApresDeuxPoints(dernierePhrase(propre)),
  ];

  for (const brut of candidats) {
    const choix = sansDoublons(brut.filter(choixRecevable));
    if (choix.length >= 2 && choix.length <= NOMBRE_CHOIX_MAX) return choix;
  }
  return [];
}
