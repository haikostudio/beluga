import { BlocRaconte, GenreDeBloc, sujetLisible } from './recit-du-tour.js';

/**
 * CE QUE L'AGENT FAIT, DIT À LA PREMIÈRE PERSONNE.
 *
 * Le récit d'un passage NOMMAIT une catégorie d'action : « 15 commandes
 * lancées », « 2 fichiers modifiés ». C'est juste, et ça ne raconte rien : on
 * lisait un inventaire de gestes techniques, pas quelqu'un qui explique son
 * travail. Cette règle fabrique la PHRASE — « Je lance 15 commandes »,
 * « Je modifie 2 fichiers » —, au présent, à la première personne du
 * singulier.
 *
 * TROIS CHOSES LA GOUVERNENT :
 *
 *  1. LA PHRASE DE L'AGENT L'EMPORTE SUR CELLE DU DÉMON. Quand le journal
 *     porte déjà ce que l'agent a dit de son geste — la `description` qu'il
 *     joint à une commande, l'intitulé d'une ligne de sa liste de tâches, la
 *     première ligne d'une note —, c'est ce texte qui s'affiche. Il ne coûte
 *     aucun jeton : il est DÉJÀ écrit dans le journal. Le motif du démon ne
 *     comble que le reste.
 *  2. AUCUN NOM TECHNIQUE NE SORT D'ICI. Pas de chemin de fichier, pas de
 *     ligne de commande, pas de nom d'outil : le premier niveau du fil se lit
 *     sans vocabulaire de développeur. Tout cela reste à un clic, sous la
 *     ligne repliée de chaque point.
 *  3. UNE PHRASE FABRIQUÉE NE PRÉTEND PAS SAVOIR. Un sujet qui n'est pas
 *     LISIBLE (`sujetLisible`) ne se cite pas : le bloc retombe sur sa phrase
 *     générique. Mieux vaut « Je fouille le projet » que « Je cherche
 *     mcp__beluga__ask_user ».
 *
 * LES TEXTES SONT DES MOTIFS, PAS DES PHRASES FINIES : la règle rend
 * `{ motif, valeurs }`, l'écran passe le motif au dictionnaire (`t()`). Sans
 * quoi l'interface cesserait de parler cinq langues dès ce fichier.
 *
 * Règle pure : ni base, ni disque, ni React. Éprouvée seule dans
 * `server/src/test/phrases-du-recit.test.ts`.
 */

/**
 * LA PHRASE D'UN BLOC. Deux provenances, et elles ne se traitent pas pareil :
 * ce que l'AGENT a écrit s'affiche tel quel (c'est sa matière, elle ne se
 * traduit pas) ; ce que le DÉMON fabrique passe par le dictionnaire.
 */
export type PhraseRacontee =
  | { dit: 'agent'; texte: string }
  | { dit: 'demon'; motif: string; valeurs?: Record<string, string | number> };

/**
 * UN MOTIF PAR GENRE ET PAR NOMBRE, plus la forme qui cite son sujet quand
 * celui-ci se lit en français (un sujet de mémoire, un motif cherché). Ce sont
 * des clés du dictionnaire (`shared/src/traductions.ts`).
 */
export const MOTIFS_DE_PHRASE: Record<
  GenreDeBloc,
  { un: string; plusieurs: string; avecSujet?: string }
> = {
  capture: { un: 'Je regarde une capture d’écran.', plusieurs: 'Je regarde {v0} captures d’écran.' },
  lecture: { un: 'Je lis un fichier du projet.', plusieurs: 'Je lis {v0} fichiers du projet.' },
  ecriture: { un: 'Je modifie un fichier.', plusieurs: 'Je modifie {v0} fichiers.' },
  commande: { un: 'Je lance une commande.', plusieurs: 'Je lance {v0} commandes.' },
  recherche: {
    un: 'Je fouille le projet.',
    plusieurs: 'Je fouille le projet {v0} fois.',
    avecSujet: 'Je cherche « {v0} » dans le projet.',
  },
  memoire: {
    un: 'J’ouvre la mémoire du projet.',
    plusieurs: 'J’ouvre la mémoire du projet {v0} fois.',
    avecSujet: 'J’ouvre la mémoire du projet sur « {v0} ».',
  },
  question: { un: 'Je vous pose une question.', plusieurs: 'Je vous pose {v0} questions.' },
  web: { un: 'Je consulte une page web.', plusieurs: 'Je consulte {v0} pages web.' },
  tache: { un: 'Je mets ma liste de tâches à jour.', plusieurs: 'Je mets ma liste de tâches à jour {v0} fois.' },
  note: { un: 'Je note ce que je viens de voir.', plusieurs: 'Je pose {v0} notes.' },
  outil: { un: 'Je me sers d’un outil du projet.', plusieurs: 'Je me sers {v0} fois d’un outil du projet.' },
};

/**
 * UNE PHRASE D'AGENT SE LIT-ELLE ? Elle vient du journal, donc du moteur : on
 * y trouve aussi bien « Vérifier les tests du démon » qu'un identifiant nu ou
 * une ligne de commande recopiée. Le même tamis que pour les sujets, plus deux
 * refus propres à une phrase : ce qui commence par une ligne de commande, et
 * ce qui n'est qu'un mot.
 */
export function phraseDAgentLisible(texte: string | undefined): boolean {
  const propre = (texte ?? '').replace(/\s+/g, ' ').trim();
  if (propre.length < 4) return false;
  if (!sujetLisible(propre)) return false;
  /* Une commande recopiée n'est pas une phrase : elle a sa place dans le
     détail, jamais au premier niveau. */
  if (/^(?:cd|ls|git|npm|npx|node|cat|sed|grep|rg|awk|find|curl|chmod|mkdir|rm|cp|mv|echo|sudo|bash|sh)\b/i.test(propre))
    return false;
  if (/[/\\]/.test(propre) && !/\s/.test(propre)) return false;
  return true;
}

/** Un texte ramené à une ligne courte : une phrase du fil n'est pas un rapport. */
function courte(texte: string, taille = 140): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  return propre.length > taille ? `${propre.slice(0, taille - 1)}…` : propre;
}

/**
 * LE CADRE QUI MET LA PHRASE DE L'AGENT À LA PREMIÈRE PERSONNE.
 *
 * Les moteurs écrivent leurs intentions à l'INFINITIF — « vérifier que les
 * tests passent », « reconstruire le projet ». Posées telles quelles dans le
 * fil, elles cassent le récit : une ligne sur deux cesserait de parler à la
 * première personne. On ne les RÉÉCRIT pas — ce sont les mots de l'agent —, on
 * les ENCHÂSSE dans un motif qui, lui, se traduit.
 *
 * Une NOTE n'a pas de cadre : c'est déjà une phrase entière de l'agent, et
 * l'enchâsser la déformerait.
 */
const CADRE_DE_L_AGENT: Partial<Record<GenreDeBloc, string>> = {
  commande: 'Je lance une commande pour {v0}.',
  web: 'Je consulte une page web pour {v0}.',
  tache: 'Je passe à « {v0} ».',
};

/**
 * LE TEXTE DE L'AGENT RÉDUIT À UN MORCEAU DE PHRASE : sa capitale de tête
 * retombe et son point final s'en va, pour qu'il s'enchâsse sans heurt. Une
 * capitale qui en suit une autre (un sigle, un nom propre) ne bouge PAS.
 */
function enMorceau(texte: string): string {
  const propre = courte(texte).replace(/[.…]+$/, '');
  if (!propre) return propre;
  const deuxieme = propre.charAt(1);
  if (deuxieme && deuxieme === deuxieme.toLocaleUpperCase('fr') && /\p{L}/u.test(deuxieme)) return propre;
  return propre.charAt(0).toLocaleLowerCase('fr') + propre.slice(1);
}

/**
 * LA PREMIÈRE LETTRE EN CAPITALE, et un point final. Les intentions écrites
 * par les moteurs arrivent sous toutes les formes (« vérifier les tests »,
 * « Lance la construction ») : le fil se lit mieux quand chaque ligne est une
 * vraie phrase.
 */
function enPhrase(texte: string): string {
  const propre = courte(texte);
  if (!propre) return propre;
  const debut = propre.charAt(0).toLocaleUpperCase('fr') + propre.slice(1);
  return /[.!?…:»]$/.test(debut) ? debut : `${debut}.`;
}

/**
 * LA PHRASE D'UN BLOC RACONTÉ.
 *
 * D'abord ce que l'agent a dit lui-même, quand il l'a dit et que ça se lit ;
 * sinon le motif du démon, au singulier, au pluriel, ou dans sa forme qui cite
 * son sujet quand celui-ci est un vrai mot français.
 */
export function phraseDuBloc(bloc: BlocRaconte): PhraseRacontee {
  if (bloc.ditParLAgent && phraseDAgentLisible(bloc.ditParLAgent)) {
    const cadre = CADRE_DE_L_AGENT[bloc.genre];
    if (cadre) return { dit: 'demon', motif: cadre, valeurs: { v0: enMorceau(bloc.ditParLAgent) } };
    return { dit: 'agent', texte: enPhrase(bloc.ditParLAgent) };
  }
  const motifs = MOTIFS_DE_PHRASE[bloc.genre] ?? MOTIFS_DE_PHRASE.outil;
  /* LA PHRASE DE L'OUTIL PASSE AVANT CELLE DE SON GENRE : « Je modifie une
     carte » vaut mieux que « Je me sers d'un outil du projet ». */
  const parOutil = bloc.outil ? MOTIFS_PAR_OUTIL[bloc.outil.toLowerCase()] : undefined;
  /* Un outil sans forme au pluriel retombe sur celle de son genre : le NOMBRE
     compte plus que la précision quand vingt appels se réunissent. */
  if (bloc.compte > 1) {
    return { dit: 'demon', motif: parOutil?.plusieurs ?? motifs.plusieurs, valeurs: { v0: bloc.compte } };
  }
  const sujet = bloc.sujets[0];
  if (parOutil) {
    if (parOutil.avecSujet && sujet && sujetLisible(sujet)) {
      return { dit: 'demon', motif: parOutil.avecSujet, valeurs: { v0: courte(sujet, 60) } };
    }
    return { dit: 'demon', motif: parOutil.un };
  }
  if (motifs.avecSujet && sujet && sujetLisible(sujet)) {
    return { dit: 'demon', motif: motifs.avecSujet, valeurs: { v0: courte(sujet, 60) } };
  }
  return { dit: 'demon', motif: motifs.un };
}

/**
 * UNE PHRASE PAR OUTIL, ET NON PLUS UNE PAR CATÉGORIE.
 *
 * « Je me sers d'un outil du projet » est juste et ne raconte rien : on ne
 * sait ni lequel, ni pourquoi. Le projet nomme pourtant déjà chaque outil en
 * français (`shared/src/noms-outils.ts`), mais en libellés NOMINAUX
 * (« Modification d'une carte ») : ils font de bons TITRES, jamais de bonnes
 * phrases. Cette table les dit à la première personne.
 *
 * ELLE NE DOUBLE PAS LES GENRES DÉJÀ PARLANTS : lire un fichier, lancer une
 * commande, fouiller le projet, ouvrir la mémoire ou poser une question ont
 * déjà leur phrase de genre, qui vaut pour tous les moteurs. On ne nomme ici
 * que ce qui retombait sur le refuge.
 *
 * LA CLÉ EST LE NOM D'APPEL EN MINUSCULES, son préfixe de pont retiré — le
 * même que dans `noms-outils.ts`, car un moteur écrit `Read` là où un autre
 * écrit `read`. Un outil absent de cette table retombe sur le motif de son
 * genre : rien ne casse, on perd seulement la précision.
 */
export const MOTIFS_PAR_OUTIL: Record<string, { un: string; plusieurs?: string; avecSujet?: string }> = {
  /* Le tableau des cartes */
  board_list_cards: { un: 'Je lis la liste des cartes.', plusieurs: 'Je lis la liste des cartes {v0} fois.' },
  board_create_card: { un: 'Je crée une carte.', avecSujet: 'Je crée la carte « {v0} ».' },
  board_update_card: { un: 'Je modifie une carte.', avecSujet: 'Je modifie la carte « {v0} ».' },
  board_move_card: { un: 'Je déplace une carte.', avecSujet: 'Je déplace la carte « {v0} ».' },
  deplacer_vers_projet: { un: 'J’envoie la carte dans le bon projet.', avecSujet: 'J’envoie la carte dans le projet « {v0} ».' },
  board_delete_card: { un: 'Je supprime une carte.', avecSujet: 'Je supprime la carte « {v0} ».' },
  propose_task: { un: 'Je propose une tâche.', avecSujet: 'Je propose la tâche « {v0} ».' },

  /* Les réglages et les documents */
  project_manage: { un: 'Je règle le projet.' },
  group_manage: { un: 'Je règle un groupe de projets.' },
  write_document: { un: 'Je rédige un document.', avecSujet: 'Je rédige le document « {v0} ».' },
  make_archive: { un: 'Je prépare une archive.' },
  remember: { un: 'Je note un fait dans la mémoire du projet.', plusieurs: 'Je note {v0} faits dans la mémoire du projet.' },
  competences: { un: 'Je lis les compétences partagées.' },
  coffre_fort: { un: 'J’ouvre le coffre-fort.' },
  compta: { un: 'Je passe par la facturation.' },
  attach_file: { un: 'Je joins un fichier à ma réponse.', plusieurs: 'Je joins {v0} fichiers à ma réponse.' },
  /* L'ANCIEN NOM RESTE SERVI : un fil ouvert avant le renommage l'appelle encore. */
  attach_screenshot: { un: 'Je joins un fichier à ma réponse.' },
  backup_recette: { un: 'Je prends un aperçu du site.' },
  backup_essai: { un: 'Je prends un aperçu d’un essai.' },
  relancer_publication: { un: 'Je relance la publication.' },
  surveillance_essai: { un: 'J’essaie le contrôle du site.', plusieurs: 'J’essaie le contrôle du site {v0} fois.' },
  surveillance_recette: { un: 'J’enregistre la surveillance.' },

  /* Les outils du moteur qui n'ont pas de genre à eux */
  taskcreate: { un: 'Je mets ma liste de tâches à jour.', plusieurs: 'Je mets ma liste de tâches à jour {v0} fois.' },
  taskupdate: { un: 'Je mets ma liste de tâches à jour.', plusieurs: 'Je mets ma liste de tâches à jour {v0} fois.' },
  todowrite: { un: 'Je mets ma liste de tâches à jour.', plusieurs: 'Je mets ma liste de tâches à jour {v0} fois.' },
  tasklist: { un: 'Je relis ma liste de tâches.' },
  taskget: { un: 'Je relis une de mes tâches.' },
  taskoutput: { un: 'Je relis le travail d’une tâche.' },
  taskstop: { un: 'J’arrête une tâche.' },
  bashoutput: { un: 'Je relis la suite d’une commande.' },
  killshell: { un: 'J’arrête une commande.' },
  monitor: { un: 'Je surveille une commande.' },
  skill: { un: 'J’ouvre une compétence.', avecSujet: 'J’ouvre la compétence « {v0} ».' },
  slashcommand: { un: 'Je lance une commande de l’assistant.' },
  exitplanmode: { un: 'Je sors du mode plan.' },
  agent: { un: 'Je confie un travail à un autre agent.', plusieurs: 'Je confie {v0} travaux à d’autres agents.' },
  task: { un: 'Je confie un travail à un autre agent.', plusieurs: 'Je confie {v0} travaux à d’autres agents.' },
};
