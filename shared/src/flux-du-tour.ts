/**
 * LE FIL D'UN TOUR, À LA FAÇON DE L'EXTENSION CHROME (décision du 13/11/2026, captures #322f et #de1b).
 *
 * Toutes les conversations d'agents — cartes, Studio, Communication, assistant, publication — se lisent comme le
 * panneau de l'extension : de haut en bas, dans l'ORDRE RÉEL du journal.
 *
 *  - une NOTE de l'agent (phrase écrite entre deux actions, `estUneNoteDAgent`) se lit en clair, comme un message ;
 *  - des ACTIONS qui se suivent (lectures, commandes, recherches, outils…) se réunissent en UN groupe replié, nommé en
 *    toutes lettres d'après ce qu'il contient (« 5 fichiers lus, 2 recherches, 1 mémoire ouverte » — maquette A #1a2b),
 *    ou « A utilisé Chrome (N actions) » pour le navigateur ;
 *  - une QUESTION se pose à sa place, une CAPTURE regardée aussi (sa vignette) : chacune ferme le groupe en cours ;
 *  - la RÉPONSE du tour n'est pas ici : l'écran la pose APRÈS ce flux, en dernier.
 *
 * Les phrases de passage (« Je vérifie le fichier… ») ne sont plus repliées derrière « Réflexions » : c'est ce récit
 * qu'on vient lire (renverse MEM-5351 / capture #47ac). Les lignes de la liste de tâches n'y entrent pas : elles
 * vivent dans le repère collé au champ d'écriture.
 *
 * Règle PURE : l'écran ne fait que dessiner la liste rendue. Éprouvée dans `server/src/test/flux-du-tour.test.ts`.
 */
import type { EntreeJournal } from './journal-carte.js';
import { nomAfficheDOutil } from './noms-outils.js';
import {
  estDePlomberie,
  estUneNoteDAgent,
  recitDeLEntree,
  type GenreDeBloc,
  type PhraseDuRecit,
} from './recit-du-tour.js';

/** Ce qu'un groupe d'actions compte, genre par genre (les genres qui ne se replient jamais en sont exclus). */
export type GenreDeGroupe = Extract<GenreDeBloc, 'lecture' | 'ecriture' | 'commande' | 'recherche' | 'memoire' | 'web' | 'outil'>;

/** UN ÉLÉMENT DU FIL D'UN TOUR, dans l'ordre où il est arrivé. */
export type ElementDuFluxDuTour =
  | { sorte: 'note'; cle: string; entree: EntreeJournal }
  | { sorte: 'question'; cle: string; entree: EntreeJournal }
  | { sorte: 'capture'; cle: string; entree: EntreeJournal }
  /** Un geste humain dit en une ligne neutre (tâche suspendue à la main). */
  | { sorte: 'evenement'; cle: string; entree: EntreeJournal }
  | {
      sorte: 'actions';
      cle: string;
      entrees: EntreeJournal[];
      /** Le libellé, morceau par morceau (motifs du dictionnaire), à joindre par « , ». */
      libelle: PhraseDuRecit[];
      /** Le genre le plus présent : son icône précède le libellé. `chrome` pour le navigateur. */
      dominant: GenreDeGroupe | 'chrome';
      /** Une action du groupe a été refusée. */
      enEchec: boolean;
    };

/**
 * LE LIBELLÉ D'UN GENRE DANS UN GROUPE, toujours avec son nombre — « 1 fichier lu », « 5 fichiers lus ». Ce sont des
 * clés du dictionnaire (`shared/src/traductions.ts`).
 */
export const LIBELLES_DU_GROUPE: Record<GenreDeGroupe, { un: string; plusieurs: string }> = {
  lecture: { un: '1 fichier lu', plusieurs: '{v0} fichiers lus' },
  ecriture: { un: '1 fichier modifié', plusieurs: '{v0} fichiers modifiés' },
  commande: { un: '1 commande lancée', plusieurs: '{v0} commandes lancées' },
  recherche: { un: '1 recherche', plusieurs: '{v0} recherches' },
  memoire: { un: '1 mémoire ouverte', plusieurs: 'mémoire ouverte {v0} fois' },
  web: { un: '1 page web consultée', plusieurs: '{v0} pages web consultées' },
  outil: { un: '1 outil utilisé', plusieurs: '{v0} outils utilisés' },
};

/** Le libellé d'un outil NOMMÉ dans un groupe (libellé français ou nom nu). */
export const LIBELLE_OUTIL_NOMME = { un: 'Outil « {v0} »', plusieurs: 'Outil « {v0} » ({v1} fois)' } as const;

/** Le libellé d'un groupe fait dans le navigateur, repris de l'extension. */
export const LIBELLE_GROUPE_CHROME = { un: 'A utilisé Chrome (1 action)', plusieurs: 'A utilisé Chrome ({v0} actions)' };

const GENRES_DE_GROUPE = new Set<string>(Object.keys(LIBELLES_DU_GROUPE));

/** Une action faite par l'outil « chrome » (l'extension reliée) ? */
export function estUneActionChrome(entree: Pick<EntreeJournal, 'outil'>): boolean {
  return /(?:^|__|\b)chrome(?:$|__|\b)/i.test(entree.outil ?? '');
}

/** Le libellé et l'icône d'un groupe d'actions. Rend `null` quand rien ne s'y compte. */
export function libelleDuGroupe(entrees: readonly EntreeJournal[]): { libelle: PhraseDuRecit[]; dominant: GenreDeGroupe | 'chrome' } | null {
  const chrome = entrees.filter(estUneActionChrome).length;
  /* UN GROUPE SURTOUT FAIT DANS LE NAVIGATEUR SE DIT COMME DANS L'EXTENSION, avec le nombre de ses actions. */
  if (chrome > 0 && chrome * 2 >= entrees.length) {
    const n = entrees.length;
    return {
      libelle: [n > 1 ? { motif: LIBELLE_GROUPE_CHROME.plusieurs, valeurs: { v0: n } } : { motif: LIBELLE_GROUPE_CHROME.un }],
      dominant: 'chrome',
    };
  }
  /* UN OUTIL SE NOMME, JAMAIS « 1 OUTIL UTILISÉ » : chaque outil sans genre à
     lui compte à part, sous son libellé français (`nomAfficheDOutil`). */
  const comptes = new Map<string, { genre: GenreDeGroupe; nom?: string; n: number; premier: number }>();
  entrees.forEach((entree, rang) => {
    const genre = recitDeLEntree(entree).genre;
    const g = (GENRES_DE_GROUPE.has(genre) ? genre : 'outil') as GenreDeGroupe;
    const nom = g === 'outil' && entree.outil ? nomAfficheDOutil(entree.outil) || undefined : undefined;
    const cle = nom ? `outil:${nom}` : g;
    const deja = comptes.get(cle);
    if (deja) deja.n += 1;
    else comptes.set(cle, { genre: g, nom, n: 1, premier: rang });
  });
  if (!comptes.size) return null;
  /* Le plus fréquent d'abord ; à égalité, celui qui est arrivé le premier. */
  const ordre = [...comptes.values()].sort((a, b) => b.n - a.n || a.premier - b.premier);
  return {
    libelle: ordre.map(({ genre, nom, n }): PhraseDuRecit => {
      if (nom) {
        return n > 1
          ? { motif: LIBELLE_OUTIL_NOMME.plusieurs, valeurs: { v0: nom, v1: n } }
          : { motif: LIBELLE_OUTIL_NOMME.un, valeurs: { v0: nom } };
      }
      return n > 1 ? { motif: LIBELLES_DU_GROUPE[genre].plusieurs, valeurs: { v0: n } } : { motif: LIBELLES_DU_GROUPE[genre].un };
    }),
    dominant: ordre[0]!.genre,
  };
}

/**
 * LE FLUX D'UN TOUR (ou d'un passage de carte) : ses entrées, déjà rangées par RANG, relues en éléments.
 * La plomberie est écartée, les lignes de la liste de tâches aussi ; elles ne coupent pas un groupe.
 */
export function fluxDesEntrees(entrees: readonly EntreeJournal[]): ElementDuFluxDuTour[] {
  const flux: ElementDuFluxDuTour[] = [];
  let groupe: EntreeJournal[] = [];
  const fermer = () => {
    if (!groupe.length) return;
    const nom = libelleDuGroupe(groupe);
    if (nom) {
      flux.push({
        sorte: 'actions',
        cle: groupe[0]!.id,
        entrees: groupe,
        libelle: nom.libelle,
        dominant: nom.dominant,
        enEchec: groupe.some((entree) => entree.reussie === false),
      });
    }
    groupe = [];
  };
  for (const entree of entrees) {
    if (estDePlomberie(entree)) continue;
    if (estUneNoteDAgent(entree)) {
      fermer();
      flux.push({ sorte: 'note', cle: entree.id, entree });
      continue;
    }
    const genre = recitDeLEntree(entree).genre;
    if (genre === 'tache') continue;
    if (genre === 'note') {
      /* Un texte qui n'est pas une phrase de l'agent (plan, réponse, incident) se lit ailleurs. */
      continue;
    }
    if (genre === 'question' || genre === 'capture' || genre === 'suspension') {
      fermer();
      flux.push({ sorte: genre === 'suspension' ? 'evenement' : genre, cle: entree.id, entree });
      continue;
    }
    groupe.push(entree);
  }
  fermer();
  return flux;
}

/**
 * LES IMAGES ENVOYÉES À LA SUITE FORMENT UN PAQUET (carte « Images groupées dans le fil », 19/11/2026, capture #347e) :
 * un agent qui joint cinq visuels d'affilée posait cinq « Je joins un fichier à ma réponse. » sous cinq grandes
 * images, et l'on ne savait plus ce qui allait avec quoi. Les CAPTURES consécutives d'une même famille — jointes
 * (« attach_file », « attach_screenshot ») ou regardées (une image lue) — se réunissent en un élément `paquet`,
 * dessiné en jeu de cartes.
 *
 *  - un groupe d'ACTIONS (commandes, lectures) peut s'intercaler : il ne coupe pas le paquet et se rend APRÈS lui ;
 *  - une NOTE de l'agent, une QUESTION ou un ÉVÉNEMENT coupent le paquet — un texte annonce autre chose ;
 *  - une image SEULE reste une capture ordinaire, dessinée comme avant ;
 *  - des actions qui suivent la dernière image restent à leur place.
 *
 * Règle PURE, éprouvée dans `server/src/test/flux-du-tour.test.ts`.
 */
export type FamilleDeCapture = 'jointe' | 'regardee';

export type ElementDuFilGroupe =
  | ElementDuFluxDuTour
  | {
      sorte: 'paquet';
      cle: string;
      famille: FamilleDeCapture;
      /** Les captures du paquet, dans l'ordre (deux au moins). */
      captures: Extract<ElementDuFluxDuTour, { sorte: 'capture' }>[];
      /** Les groupes d'actions venus entre deux images : rendus après le paquet. */
      intercalees: Extract<ElementDuFluxDuTour, { sorte: 'actions' }>[];
    };

/** Une capture jointe à la réponse (outil qui joint), ou regardée par l'agent (lecture d'une image). */
export function familleDeCapture(entree: EntreeJournal): FamilleDeCapture {
  const outil = recitDeLEntree(entree).outil ?? '';
  return outil === 'attach_file' || outil === 'attach_screenshot' ? 'jointe' : 'regardee';
}

export function paquetsDuFlux(elements: readonly ElementDuFluxDuTour[]): ElementDuFilGroupe[] {
  const sortie: ElementDuFilGroupe[] = [];
  let i = 0;
  while (i < elements.length) {
    const premier = elements[i]!;
    if (premier.sorte !== 'capture') {
      sortie.push(premier);
      i += 1;
      continue;
    }
    const famille = familleDeCapture(premier.entree);
    const captures: Extract<ElementDuFluxDuTour, { sorte: 'capture' }>[] = [premier];
    const intercalees: Extract<ElementDuFluxDuTour, { sorte: 'actions' }>[] = [];
    let j = i + 1;
    /* On avance tant qu'une capture de la même famille suit, des actions seules pouvant s'intercaler. */
    for (;;) {
      let k = j;
      const enAttente: Extract<ElementDuFluxDuTour, { sorte: 'actions' }>[] = [];
      while (k < elements.length && elements[k]!.sorte === 'actions') {
        enAttente.push(elements[k] as Extract<ElementDuFluxDuTour, { sorte: 'actions' }>);
        k += 1;
      }
      const suivante = elements[k];
      if (!suivante || suivante.sorte !== 'capture' || familleDeCapture(suivante.entree) !== famille) break;
      intercalees.push(...enAttente);
      captures.push(suivante);
      j = k + 1;
    }
    if (captures.length < 2) {
      sortie.push(premier);
      i += 1;
      continue;
    }
    sortie.push({ sorte: 'paquet', cle: `paquet-${premier.cle}`, famille, captures, intercalees });
    sortie.push(...intercalees);
    i = j;
  }
  return sortie;
}
