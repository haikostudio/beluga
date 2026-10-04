import { EntreeJournal, JALON_TOUR_LANCE, genreDAction } from './journal-carte.js';
import { libelleDOutil, libelleLisible, nomSansPont } from './noms-outils.js';
import { VueDEntree, vueDeLEntree } from './contenu-journal.js';

/**
 * CE QUE L'AGENT A FAIT, RACONTÉ EN BLOCS — PAS EN TRACES.
 *
 * Un passage ouvert du flux montrait ses actions en LIGNES TECHNIQUES : le nom
 * de l'outil, son premier paramètre, sa durée. Pour savoir ce que l'agent avait
 * compris, il fallait déplier « Détails techniques », puis chaque ligne, et
 * traduire soi-même « Read » en « il a lu ce fichier ». Le flux disait tout et
 * ne racontait rien.
 *
 * Cette règle RACONTE. Elle relit les mêmes entrées de journal
 * (`vueDeLEntree`, qui les a déjà rangées en onze sortes) et rend des BLOCS :
 * un titre court en français, une phrase de détail, et le chemin d'une image
 * quand l'agent a regardé une capture d'écran. L'écran n'a plus qu'à les
 * empiler.
 *
 * DEUX CHOSES LA GOUVERNENT :
 *
 *  1. AUCUN NOM TECHNIQUE NE SORT D'ICI, sauf ce qui est un nom propre — un
 *     fichier, une commande, une adresse. Un outil qu'on ne reconnaît pas
 *     passe par `libelleLisible`, jamais par son identifiant d'appel.
 *  2. UN TOUR DE CINQUANTE ACTIONS RESTE LISIBLE : les actions voisines de
 *     même genre se réunissent en UN bloc (« 6 fichiers lus », puis leurs
 *     noms), et au-delà d'un plafond de blocs on réunit tout ce qui partage un
 *     genre, même à distance. Un mur de cartons ne vaut pas mieux qu'un mur de
 *     lignes.
 *
 * LES TEXTES SONT DES MOTIFS, PAS DES PHRASES FINIES : la règle rend
 * `{ motif, valeurs }`, l'écran passe le motif au dictionnaire (`t()`). Sans
 * quoi l'interface cesserait de parler cinq langues dès ce fichier.
 *
 * Règle pure : ni base, ni disque, ni React. Éprouvée seule dans
 * `server/src/test/recit-du-tour.test.ts`.
 */

/** Les genres de bloc : un par façon de raconter, pas un de plus. */
export const GENRES_DE_BLOC = [
  'capture',
  'lecture',
  'ecriture',
  'commande',
  'recherche',
  'memoire',
  'question',
  'web',
  'tache',
  'note',
  'outil',
] as const;
export type GenreDeBloc = (typeof GENRES_DE_BLOC)[number];

/**
 * UNE PHRASE À TRADUIRE : son motif (la clé du dictionnaire) et ses trous.
 * `t(phrase.motif, phrase.valeurs)` rend le texte affiché.
 */
export interface PhraseDuRecit {
  motif: string;
  valeurs?: Record<string, string | number>;
}

/**
 * UNE QUESTION, RACONTÉE EN TROIS MORCEAUX : ce qui a été demandé, ce qui
 * était proposé, ce qui a été retenu. Ces textes sont ceux de l'agent et de
 * l'utilisateur : ils ne passent PAS par le dictionnaire.
 */
export interface QuestionRacontee {
  intitule: string;
  /** Ce qui éclairait la question, quand l'agent l'a écrit. */
  description?: string;
  /** Les réponses proposées, dans l'ordre où elles ont été posées. */
  options: string[];
  /** Un seul choix, plusieurs, ou une réponse libre — ce que dit l'entête. */
  choix: 'single' | 'multiple' | 'text';
  /** La réponse retenue, quand elle est venue. */
  reponse?: string;
}

/** Un bloc raconté : ce qui s'affiche dans un carton du passage. */
export interface BlocRaconte {
  /** La clé de rendu : l'identifiant de la première entrée réunie. */
  cle: string;
  genre: GenreDeBloc;
  /**
   * QUAND CE GESTE A COMMENCÉ — l'horodatage de la PREMIÈRE entrée réunie,
   * dans l'ordre du journal (`rang`), jamais dans l'ordre des horloges.
   *
   * L'écran en fait « 16:34 » : la liste des gestes se lit alors de haut en
   * bas comme une chronologie, exactement comme les étapes d'une mise en ligne
   * (`heureEtDureeEtape`).
   */
  debutAt: number;
  /**
   * COMBIEN DE TEMPS CE GESTE A PRIS — l'ENVELOPPE des entrées réunies : de
   * l'instant de la première à la fin de la dernière qui a été chronométrée.
   *
   * Une enveloppe, et pas la somme des durées mesurées : entre deux appels
   * d'outil l'agent réfléchit, et ce temps-là est bien passé. Il compte donc
   * dans ce que l'utilisateur lit comme « le temps de ce geste ».
   *
   * `undefined` quand AUCUNE entrée du bloc n'est chronométrée : on n'affiche
   * alors que l'heure, jamais « 0 s » ni une parenthèse vide.
   */
  dureeMs?: number;
  /** Le titre court, en petites capitales à l'écran. */
  titre: PhraseDuRecit;
  /**
   * LE NOM D'APPEL DE L'OUTIL RÉUNI DANS CE BLOC, son préfixe de pont retiré,
   * quand toutes ses actions appellent le même. Il ne s'affiche jamais : il
   * sert à choisir la PHRASE du bloc (`phraseDuBloc`).
   */
  outil?: string;
  /**
   * CE QUE LE BLOC PORTE, UNE INFO PAR ENTRÉE — plus une phrase à rallonge.
   *
   * C'était « a.ts, b.ts, c.ts, et 69 de plus » : un pavé de virgules qui, sur
   * une colonne étroite, se cassait en une lettre par ligne et cachait
   * justement ce qu'on venait lire. Le bloc rend la LISTE ; l'écran la pose
   * une info par ligne, précédée d'un tiret, dans sa part dépliée.
   *
   * Les doublons sont retirés (six lectures du même fichier n'en font qu'une
   * ligne), l'ordre est celui du journal, et RIEN n'est coupé : c'est
   * l'affichage qui décide où poser son « voir les N de plus ».
   */
  sujets: string[];
  /** Le chemin de l'image regardée, quand l'agent en a regardé une. */
  vignette?: string;
  /** Combien d'actions ce bloc réunit. */
  compte: number;
  /** Les entrées réunies, pour le détail exact d'un cran de plus. */
  entrees: EntreeJournal[];
  /** Une des actions réunies a été refusée : le carton le dit sans qu'on le déplie. */
  enEchec?: boolean;
  /** Le contenu d'une question posée, quand c'en est une. */
  question?: QuestionRacontee;
  /**
   * CE QUE L'AGENT A DIT LUI-MÊME DE CE GESTE, quand le journal le porte
   * déjà : la `description` jointe à une commande, l'intitulé d'une ligne de
   * sa liste de tâches, la première ligne d'une note, l'intention d'une
   * consultation web. C'est GRATUIT — aucun appel de plus au moteur — et c'est
   * ce qui raconte le mieux. `phraseDuBloc` lui donne la priorité sur le motif
   * fabriqué par le démon.
   *
   * Un bloc ne le porte que si toutes les actions réunies disent LA MÊME
   * chose : trois commandes de trois intentions différentes ne se réunissent
   * plus (la clé de regroupement porte cette phrase), et aucune ne passe donc
   * pour les autres.
   */
  ditParLAgent?: string;
}

/** Ce qu'une entrée seule raconte, avant tout regroupement. */
export interface RecitDEntree {
  genre: GenreDeBloc;
  /** Ce qui distingue un bloc d'un autre du même genre (le nom d'un outil). */
  variante?: string;
  /**
   * LE NOM D'APPEL DE L'OUTIL, son préfixe de pont retiré. Il ne s'affiche
   * JAMAIS : il sert à `phrasesDuBloc` pour choisir la phrase propre à cet
   * outil (« Je renomme la carte… ») plutôt que le motif de son genre.
   */
  outil?: string;
  /** Le mot qui identifie l'action : un fichier, une commande, un sujet. */
  sujet?: string;
  /** Le chemin de l'image, quand c'en est une. */
  vignette?: string;
  /** Ce qu'une question a demandé, proposé et obtenu. */
  question?: QuestionRacontee;
  /** Ce que l'agent a écrit de son geste, quand le journal le porte. */
  ditParLAgent?: string;
}

/**
 * LE RÉCIT D'UN PASSAGE : tous ses blocs, et combien s'en montrent d'office.
 * Le reste attend derrière un « voir les N de plus » — la règle ne cache rien,
 * elle dit seulement où couper.
 */
export interface RecitDUnPassage {
  blocs: BlocRaconte[];
  /** Combien de blocs l'écran affiche avant de proposer le repli. */
  montresDOffice: number;
  /** L'instant du PREMIER geste du passage, quand il en porte un. */
  debutAt?: number;
  /**
   * LE TEMPS TOTAL DU PASSAGE : du premier geste à la fin du dernier
   * chronométré. C'est ce que l'écran rappelle en tête de l'étape ET sous la
   * liste des gestes — la question « combien de temps l'agent a-t-il mis ? »
   * se répond sans additionner soi-même une colonne de cartons.
   *
   * Calculé sur TOUTES les entrées de travail du passage, y compris celles qui
   * attendent derrière « voir les N de plus » : un total qui ne compterait que
   * les blocs visibles changerait en dépliant la liste.
   */
  dureeMs?: number;
}

/**
 * L'ENVELOPPE D'UNE SUITE D'ENTRÉES : son début, et le temps qu'elle a pris.
 *
 * Le début est le plus petit horodatage, la fin le plus grand `at + dureeMs`
 * des entrées CHRONOMÉTRÉES. Sans aucune entrée chronométrée, il n'y a pas de
 * durée à dire — pas « 0 s », rien.
 */
export function enveloppeDesEntrees(
  entrees: readonly EntreeJournal[],
): { debutAt: number; dureeMs?: number } | undefined {
  if (!entrees.length) return undefined;
  let debut = Infinity;
  let fin: number | undefined;
  for (const entree of entrees) {
    if (entree.at < debut) debut = entree.at;
    if (entree.dureeMs === undefined) continue;
    const bout = entree.at + entree.dureeMs;
    if (fin === undefined || bout > fin) fin = bout;
  }
  if (!Number.isFinite(debut)) return undefined;
  /* UNE FIN ANTÉRIEURE AU DÉBUT NE SE DIT PAS : deux entrées lointaines
     réunies par genre peuvent poser la seule durée mesurée sur la PREMIÈRE. */
  if (fin === undefined || fin <= debut) return { debutAt: debut };
  return { debutAt: debut, dureeMs: fin - debut };
}

/**
 * LE TEMPS DE TRAVAIL D'UN PASSAGE, sans avoir à en refaire le récit.
 *
 * L'entête d'une étape du fil a besoin du total, pas des blocs : le recalculer
 * par `recitDuPoint` regrouperait cinquante entrées pour n'en garder qu'un
 * nombre. La PLOMBERIE est écartée comme dans le récit — sinon le total
 * démarrerait au chargement d'un schéma d'outil, qui n'est pas du travail.
 */
export function tempsDuPassage(
  entrees: readonly EntreeJournal[],
): { debutAt: number; dureeMs?: number } | undefined {
  return enveloppeDesEntrees(entrees.filter((entree) => !estDePlomberie(entree)));
}

/**
 * LA PLOMBERIE : CE QUI N'EST PAS DU TRAVAIL, ET NE SE RACONTE PAS.
 *
 * Le récit montrait « Tour lancé — claude », « Recherche dans le projet —
 * select:mcp__beluga__rendre_plan », « rendre_plan (2 fois) » : trois cartons
 * qui ne disent RIEN de ce que l'agent a fait. Le moteur est déjà annoncé au
 * premier point du parcours, un chargement de schéma d'outil n'est pas une
 * recherche, et ce que `rendre_plan` a rendu a DÉJÀ sa carte dans le même
 * passage.
 *
 * CETTE LISTE SE RELÈVE, ELLE NE SE DEVINE PAS : chaque nom ci-dessous a été
 * lu dans de vrais journaux de cartes (`card_journal`), jamais supposé. Un
 * motif attrape-tout ferait disparaître du vrai travail — c'est le seul risque
 * de ce tamis, et il se tient en NOMMANT ce qu'on écarte.
 *
 * LE JOURNAL, LUI, N'EST PAS TOUCHÉ : `JALON_TOUR_LANCE` continue d'être écrit
 * et relu par `parcours-en-points.ts`, qui en a besoin pour savoir qu'un tour a
 * démarré. C'est l'AFFICHAGE qui se tait.
 */
const OUTILS_DE_PLOMBERIE = [
  /* Le chargement du schéma d'un outil différé : un geste de tuyauterie du
     moteur, que le journal enregistre comme une « recherche ». */
  'toolsearch',
  'tool_search',
  /* Les deux outils par lesquels le cadrage REND son plan et sa compréhension :
     leur contenu s'affiche déjà en grand, dans le même passage. */
  'rendre_plan',
  'rendre_comprehension',
] as const;

/** Cette entrée appelle-t-elle l'outil nommé, sous l'une de ses écritures ? */
function estLOutil(entree: EntreeJournal, cle: string): boolean {
  if (nomSansPont(entree.outil ?? '').toLowerCase() === cle) return true;
  const ecrit = (entree.libelle ?? '').trim();
  if (!ecrit) return false;
  /* « Outil ToolSearch » : sur les vieilles entrées, le nom n'est que là. */
  const dansLeTexte = /^outil\s+(\S+)$/i.exec(ecrit)?.[1];
  if (dansLeTexte && nomSansPont(dansLeTexte).toLowerCase() === cle) return true;
  return ecrit === libelleDOutil(cle);
}

/**
 * CETTE ENTRÉE EST-ELLE DE LA PLOMBERIE ? Écartée du récit, elle ne forme plus
 * de bloc — et le plafond de blocs se compte sur ce qui reste.
 */
export function estDePlomberie(entree: EntreeJournal): boolean {
  if (entree.nature === 'jalon') return (entree.libelle ?? '') === JALON_TOUR_LANCE;
  if (entree.nature !== 'requete') return false;
  return OUTILS_DE_PLOMBERIE.some((cle) => estLOutil(entree, cle));
}

/**
 * UNE VALEUR TECHNIQUE NE DEVIENT PAS UNE PHRASE.
 *
 * Le refuge posait sa phrase de détail sur le PREMIER champ court venu : un
 * identifiant de carte (`e412b95a-23ad-…`), un délai en millisecondes
 * (`300000`), un nom de fonction (`rendre_comprehension`), un nom de moteur
 * seul. Mieux vaut un bloc réduit à son titre qu'un bloc qui ment sur ce qu'il
 * raconte : sans sujet LISIBLE, on n'en met pas.
 *
 * Ce jugement ne vaut QUE pour le refuge : un chemin de fichier, une commande
 * ou un motif de recherche sont des noms propres, et se citent tels quels.
 */
export function sujetLisible(valeur: string | undefined): boolean {
  const texte = (valeur ?? '').trim();
  if (!texte) return false;
  /* Les identifiants d'appel du pont et les sélections d'outils. */
  if (/mcp__/i.test(texte) || /^select:/i.test(texte)) return false;
  /* Un identifiant : uuid, empreinte, suite de chiffres, liste de nombres. */
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(texte)) return false;
  if (/^[0-9a-f]{12,}$/i.test(texte)) return false;
  if (/^[\d\s.,:_-]+$/.test(texte)) return false;
  /* Un nom de fonction en serpent : `rendre_plan`, `board_update_card`. */
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(texte)) return false;
  /* Un nom de moteur ou de modèle seul : il est déjà dit en tête du parcours. */
  if (/^(?:claude|codex|cursor|gemini|opus|sonnet|haiku|gpt[\w.-]*)$/i.test(texte)) return false;
  return true;
}

/** LES EXTENSIONS QU'ON REGARDE au lieu de les lire. */
const EXTENSIONS_D_IMAGE = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'];

/** Ce chemin désigne-t-il une image ? */
export function estUneImage(chemin: string): boolean {
  const bas = (chemin ?? '').toLowerCase().split('?')[0];
  return EXTENSIONS_D_IMAGE.some((ext) => bas.endsWith(ext));
}

/** Le nom d'un fichier, son dossier retiré : c'est lui qu'on reconnaît. */
function nomDeFichier(chemin: string): string {
  const morceaux = (chemin ?? '').split('/').filter(Boolean);
  return morceaux[morceaux.length - 1] ?? chemin;
}

/** La première ligne d'un texte, ses dièses de titre retirés. */
function premiereLigne(texte: string | undefined): string | undefined {
  for (const ligne of (texte ?? '').split('\n')) {
    const propre = ligne.replace(/^#{1,6}\s*/, '').trim();
    if (propre) return propre;
  }
  return undefined;
}

/** Un texte ramené à une ligne courte : le carton n'est pas un terminal. */
function court(texte: string | undefined, taille = 120): string | undefined {
  const propre = (texte ?? '').replace(/\s+/g, ' ').trim();
  if (!propre) return undefined;
  return propre.length > taille ? `${propre.slice(0, taille - 1)}…` : propre;
}

/**
 * CE QU'UNE ENTRÉE RACONTE : son genre de bloc et ce qui la distingue.
 *
 * On part de la SORTE déjà calculée par `vueDeLEntree` — c'est elle qui sait
 * lire les paramètres des moteurs — et on retombe sur le genre d'action pour
 * ce qu'elle range dans son refuge.
 */
export function recitDeLEntree(entree: EntreeJournal): RecitDEntree {
  const vue: VueDEntree = vueDeLEntree(entree);
  /* LE NOM D'APPEL DE L'OUTIL VOYAGE AVEC LE RÉCIT, sans jamais s'afficher :
     c'est lui qui permet à la phrase de dire « Je renomme la carte » plutôt
     que « Je me sers d'un outil du projet ». */
  const outil = nomSansPont(entree.outil ?? '');
  const avecLOutil = <T extends RecitDEntree>(recit: T): T =>
    outil ? { ...recit, outil } : recit;
  switch (vue.sorte) {
    case 'fichier':
      return avecLOutil(
        estUneImage(vue.chemin)
          ? { genre: 'capture', sujet: nomDeFichier(vue.chemin), vignette: vue.chemin }
          : { genre: 'lecture', sujet: nomDeFichier(vue.chemin) },
      );
    case 'modification':
      return avecLOutil({ genre: 'ecriture', sujet: nomDeFichier(vue.chemin) });
    case 'commande':
      /* L'INTENTION QUE LE MOTEUR JOINT À SA COMMANDE (`description`) EST DÉJÀ
         UNE PHRASE : c'est elle qui raconte le mieux, et elle ne coûte rien. */
      return avecLOutil({
        genre: 'commande',
        sujet: court(vue.intention || vue.commande, 90),
        ...(vue.intention ? { ditParLAgent: court(vue.intention, 140)! } : {}),
      });
    case 'recherche':
      return avecLOutil({ genre: 'recherche', sujet: court(vue.motif, 60) });
    case 'memoire':
      return avecLOutil({ genre: 'memoire', sujet: court(vue.sujet, 60) });
    case 'question':
      /* LA QUESTION NE SE TRONQUE PLUS EN UNE PHRASE. « question → réponse »
         coupé à 160 signes perdait justement ce qu'on vient lire : ce qui
         était proposé, et ce qui a été retenu. Le bloc porte les trois. */
      return avecLOutil({
        genre: 'question',
        sujet: court(vue.reponse ? `${vue.question} → ${vue.reponse}` : vue.question, 160),
        question: {
          intitule: vue.question,
          ...(vue.description ? { description: vue.description } : {}),
          options: vue.options.map((option) => option.label).filter(Boolean),
          choix: vue.choix,
          ...(vue.reponse ? { reponse: vue.reponse } : {}),
        },
      });
    case 'web':
      return avecLOutil({
        genre: 'web',
        sujet: court(vue.adresse, 80),
        ...(vue.intention ? { ditParLAgent: court(vue.intention, 140)! } : {}),
      });
    case 'point': {
      /* L'INTITULÉ D'UNE LIGNE DE LISTE DE TÂCHES EST DU TEXTE D'AGENT : il
         dit ce qu'il fait, mieux que « liste tenue à jour ». */
      const intitule = court(entree.libelle, 140);
      return avecLOutil({
        genre: 'tache',
        sujet: court(entree.libelle, 80),
        ...(intitule ? { ditParLAgent: intitule } : {}),
      });
    }
    case 'texte':
    case 'demande': {
      const debut = court(premiereLigne(vue.texte), 140);
      return avecLOutil({ genre: 'note', sujet: debut, ...(debut ? { ditParLAgent: debut } : {}) });
    }
    default:
      break;
  }

  /* LE REFUGE SUIT LE GENRE D'ACTION : la liste de tâches, la mémoire et les
     outils du démon n'ont pas de sorte de contenu à eux, mais ils se
     racontent quand même — sous leur nom français. */
  const genre = genreDAction(entree);
  if (genre === 'plan') return avecLOutil({ genre: 'tache' });
  if (genre === 'memoire') return avecLOutil({ genre: 'memoire', sujet: court(entree.libelle, 60) });
  const nom = libelleLisible(entree);
  const champ = vue.sorte === 'outil' || vue.sorte === 'champs' ? vue.champs[0] : undefined;
  const sujet = champ && !champ.long ? court(champ.valeur, 90) : undefined;
  return avecLOutil({
    genre: 'outil',
    ...(nom ? { variante: nom } : {}),
    ...(sujetLisible(sujet) ? { sujet } : {}),
  });
}

/**
 * LE TITRE DE CHAQUE GENRE, AU SINGULIER ET AU PLURIEL. Ce sont des clés du
 * dictionnaire (`shared/src/traductions.ts`) : l'écran les traduit.
 */
export const TITRES_DU_GENRE: Record<GenreDeBloc, { un: string; plusieurs: string }> = {
  capture: { un: 'Capture d’écran regardée', plusieurs: '{v0} captures d’écran regardées' },
  lecture: { un: 'Fichier lu', plusieurs: '{v0} fichiers lus' },
  ecriture: { un: 'Fichier modifié', plusieurs: '{v0} fichiers modifiés' },
  commande: { un: 'Commande lancée', plusieurs: '{v0} commandes lancées' },
  recherche: { un: 'Recherche dans le projet', plusieurs: '{v0} recherches dans le projet' },
  memoire: { un: 'Mémoire du projet ouverte', plusieurs: 'Mémoire du projet ouverte {v0} fois' },
  question: { un: 'Question posée', plusieurs: '{v0} questions posées' },
  web: { un: 'Page web consultée', plusieurs: '{v0} pages web consultées' },
  tache: { un: 'Liste des tâches tenue à jour', plusieurs: 'Liste des tâches tenue à jour {v0} fois' },
  note: { un: 'Note de l’agent', plusieurs: '{v0} notes de l’agent' },
  outil: { un: 'Outil du projet utilisé', plusieurs: 'Outil du projet utilisé {v0} fois' },
};


/**
 * L'INTITULÉ DU BANDEAU D'UN ENCADRÉ D'ÉTAPE.
 *
 * Les encadrés du fil (`web/src/components/contenu-journal.tsx`) portent en
 * tête le nom de ce qu'ils montrent. Ce nom n'est PAS un mot de plus : c'est
 * exactement le titre déjà écrit pour le récit, déjà traduit dans les cinq
 * langues. En inventer un second jeu aurait fait dire « Question posée » à un
 * endroit et « Une question » à trois lignes de là.
 *
 * Le texte rendu est un MOTIF à passer au dictionnaire (`t()`), comme partout
 * ailleurs dans ce fichier.
 */
export function titreDeLaSorte(sorte: VueDEntree['sorte']): string {
  switch (sorte) {
    case 'question':
      return TITRES_DU_GENRE.question.un;
    case 'commande':
      return TITRES_DU_GENRE.commande.un;
    case 'fichier':
      return TITRES_DU_GENRE.lecture.un;
    case 'modification':
      return TITRES_DU_GENRE.ecriture.un;
    case 'memoire':
      return TITRES_DU_GENRE.memoire.un;
    case 'recherche':
      return TITRES_DU_GENRE.recherche.un;
    case 'web':
      return TITRES_DU_GENRE.web.un;
    case 'point':
      return TITRES_DU_GENRE.tache.un;
    case 'texte':
      return TITRES_DU_GENRE.note.un;
    case 'demande':
      return 'Demande';
    default:
      return TITRES_DU_GENRE.outil.un;
  }
}

/**
 * LE PLAFOND DE BLOCS D'UN PASSAGE. Au-delà, on réunit tout ce qui partage un
 * genre, même à distance : un tour de cinquante actions rendrait sinon
 * quarante cartons, ce qui ne se lit pas mieux que quarante lignes.
 */
export const PLAFOND_DE_BLOCS = 12;

/** Le titre d'un bloc, selon ce qu'il réunit. */
function titreDuBloc(genre: GenreDeBloc, variante: string | undefined, compte: number): PhraseDuRecit {
  if (genre === 'outil' && variante) {
    return compte > 1 ? { motif: '{v0} ({v1} fois)', valeurs: { v0: variante, v1: compte } } : { motif: '{v0}', valeurs: { v0: variante } };
  }
  const titres = TITRES_DU_GENRE[genre];
  return compte > 1 ? { motif: titres.plusieurs, valeurs: { v0: compte } } : { motif: titres.un };
}

/** Un amas d'entrées de même genre, avant d'être mis en forme. */
interface AmasDuRecit {
  genre: GenreDeBloc;
  variante?: string;
  outil?: string;
  ditParLAgent?: string;
  sujets: string[];
  vignette?: string;
  entrees: EntreeJournal[];
  question?: QuestionRacontee;
  /** Cet amas ne se réunit avec AUCUN autre — une question reste seule. */
  isole?: boolean;
}

/**
 * LA CLÉ DE REGROUPEMENT : le genre, le nom de l'outil quand il en a un, et LA
 * PHRASE QUE L'AGENT A DITE.
 *
 * C'est ce dernier morceau qui rend le fil racontable : deux commandes de deux
 * intentions différentes ne se fondent PLUS en « 2 commandes lancées », elles
 * gardent chacune leur phrase. Deux gestes de MÊME intention, eux, se
 * réunissent — la même phrase écrite deux fois de suite n'apprend rien.
 */
function cleDAmas(recit: RecitDEntree): string {
  const base = recit.variante ? `${recit.genre}::${recit.variante}` : recit.genre;
  return recit.ditParLAgent ? `${base}::dit::${recit.ditParLAgent}` : base;
}

/** Un amas devient un bloc affichable. */
function blocDeLAmas(amas: AmasDuRecit): BlocRaconte {
  const compte = amas.entrees.length;
  const quand = enveloppeDesEntrees(amas.entrees);
  return {
    cle: amas.entrees[0]?.id ?? `${amas.genre}-${compte}`,
    genre: amas.genre,
    debutAt: quand?.debutAt ?? amas.entrees[0]?.at ?? 0,
    ...(quand?.dureeMs !== undefined ? { dureeMs: quand.dureeMs } : {}),
    titre: titreDuBloc(amas.genre, amas.variante, compte),
    ...(amas.outil ? { outil: amas.outil } : {}),
    sujets: [...new Set(amas.sujets.filter(Boolean))],
    ...(amas.vignette ? { vignette: amas.vignette } : {}),
    compte,
    entrees: amas.entrees,
    /* UNE ACTION REFUSÉE REMONTE SUR SON BLOC : sans ça, il fallait déplier
       chaque carton pour trouver où le tour a déraillé. */
    ...(amas.entrees.some((entree) => entree.reussie === false) ? { enEchec: true } : {}),
    ...(amas.question ? { question: amas.question } : {}),
    ...(amas.ditParLAgent ? { ditParLAgent: amas.ditParLAgent } : {}),
  };
}

/**
 * LE RÉCIT D'UN PASSAGE : ses actions, racontées en blocs.
 *
 * La PLOMBERIE est écartée d'abord (`estDePlomberie`) : ce qui reste est du
 * travail. Les entrées voisines de même genre se réunissent ensuite ; si le
 * passage dépasse malgré tout son plafond, on réunit une seconde fois — tout ce
 * qui partage un genre, dans l'ordre de sa première apparition. La règle dit
 * combien de blocs s'en montrent d'office ; le reste attend derrière un
 * « voir les N de plus ».
 */
export function recitDuPoint(
  entrees: EntreeJournal[],
  options?: { plafond?: number },
): RecitDUnPassage {
  const plafond = options?.plafond ?? PLAFOND_DE_BLOCS;
  const amas: AmasDuRecit[] = [];
  for (const entree of entrees) {
    /* LE TAMIS PASSE AVANT TOUT REGROUPEMENT : une entrée de plomberie ne
       forme pas de bloc, et ne coupe pas non plus l'amas qu'elle traversait. */
    if (estDePlomberie(entree)) continue;
    const recit = recitDeLEntree(entree);
    const dernier = amas[amas.length - 1];
    /* DEUX GENRES NE SE RÉUNISSENT JAMAIS. Une QUESTION se lit en trois
       morceaux — ce qui a été demandé, ce qui était proposé, ce qui a été
       retenu —, et deux questions fondues en un carton en perdraient deux sur
       trois. Une CAPTURE porte sa vignette SOUS sa phrase : trois captures
       fondues en une n'en montreraient qu'une, et perdraient les deux
       autres. */
    const isole = recit.genre === 'question' || recit.genre === 'capture';
    if (
      !isole &&
      dernier &&
      !dernier.isole &&
      cleDAmas({
        genre: dernier.genre,
        ...(dernier.variante ? { variante: dernier.variante } : {}),
        ...(dernier.ditParLAgent ? { ditParLAgent: dernier.ditParLAgent } : {}),
      }) === cleDAmas(recit)
    ) {
      dernier.entrees.push(entree);
      /* UN AMAS NE GARDE SON OUTIL QUE SI TOUTES SES ACTIONS APPELLENT LE
         MÊME : sinon sa phrase parlerait au nom du premier venu. */
      if (dernier.outil && dernier.outil !== recit.outil) delete dernier.outil;
      if (recit.sujet) dernier.sujets.push(recit.sujet);
      if (!dernier.vignette && recit.vignette) dernier.vignette = recit.vignette;
      continue;
    }
    amas.push({
      genre: recit.genre,
      ...(recit.variante ? { variante: recit.variante } : {}),
      ...(recit.outil ? { outil: recit.outil } : {}),
      ...(recit.ditParLAgent ? { ditParLAgent: recit.ditParLAgent } : {}),
      sujets: recit.sujet ? [recit.sujet] : [],
      ...(recit.vignette ? { vignette: recit.vignette } : {}),
      entrees: [entree],
      ...(recit.question ? { question: recit.question } : {}),
      ...(isole ? { isole: true } : {}),
    });
  }

  let blocs = amas.map(blocDeLAmas);

  if (amas.length > plafond) {
    /* SECOND TOUR : tout ce qui partage un genre se réunit, où qu'il soit dans
       le passage. L'ordre garde la PREMIÈRE apparition de chaque genre. */
    const parCle = new Map<string, AmasDuRecit>();
    for (const bloc of amas) {
      /* Un amas ISOLÉ garde sa propre clé : il ne rejoint personne, même au
         second tour. UN AMAS QUI PORTE UNE PHRASE D'AGENT NON PLUS : la fusion
         par genre effacerait justement ce qui raconte le travail, et le fil
         retomberait sur « 40 commandes lancées ». Ce qui dépasse le plafond
         attend derrière « voir les N de plus », il ne se fond pas. */
      const cle =
        bloc.isole || bloc.ditParLAgent
          ? `garde::${bloc.entrees[0]?.id ?? parCle.size}`
          : cleDAmas({ genre: bloc.genre, ...(bloc.variante ? { variante: bloc.variante } : {}) });
      const deja = parCle.get(cle);
      if (!deja) {
        parCle.set(cle, { ...bloc, sujets: [...bloc.sujets], entrees: [...bloc.entrees] });
        continue;
      }
      deja.entrees.push(...bloc.entrees);
      deja.sujets.push(...bloc.sujets);
      if (!deja.vignette && bloc.vignette) deja.vignette = bloc.vignette;
    }
    blocs = [...parCle.values()].map(blocDeLAmas);
  }

  /* LE TOTAL SE CALCULE SUR TOUTES LES ENTRÉES DE TRAVAIL, jamais sur les
     blocs montrés : déplier « voir les N de plus » ne doit pas changer le
     temps total du passage. */
  const quand = enveloppeDesEntrees(amas.flatMap((a) => a.entrees));
  return {
    blocs,
    montresDOffice: Math.min(plafond, blocs.length),
    ...(quand ? { debutAt: quand.debutAt } : {}),
    ...(quand?.dureeMs !== undefined ? { dureeMs: quand.dureeMs } : {}),
  };
}
