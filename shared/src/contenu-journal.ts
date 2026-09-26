import { estUneConsigneAuMoteur } from './attente-question.js';
import { EntreeJournal, GenreAction, genreDAction } from './journal-carte.js';
import { MemoireLue, RefMemoire, lireLaMemoire } from './memoire-lue.js';

/**
 * CE QU'UNE ENTRÉE DU JOURNAL VEUT DIRE — EN DONNÉES, PAS EN JSON.
 *
 * Le parcours d'une carte montrait chaque entrée de la même façon : un titre,
 * puis deux pavés `<pre>` — les paramètres en JSON, le texte rendu tel quel. On
 * y lisait `{"file_path":"/root/beluga/web/src/app.tsx","offset":120}` au lieu
 * de « app.tsx, à partir de la ligne 120 ». Le journal disait tout et ne
 * montrait rien : pour savoir ce qu'un tour avait fait, il fallait lire du JSON
 * ligne à ligne, exactement ce que le flux vertical devait éviter.
 *
 * Ce fichier est la charnière. Il ne dessine rien : il RELIT une entrée et dit
 * de quelle SORTE de contenu elle est faite — une question posée avec ses
 * choix, une commande avec sa sortie, un fichier lu avec son extrait, une
 * modification avec son avant et son après, un texte à mettre en forme. L'écran
 * (`web/src/components/contenu-journal.tsx`) n'a plus qu'à donner un composant
 * à chaque sorte.
 *
 * C'EST UNE RÈGLE PURE, donc éprouvable seule : les noms de paramètres que les
 * moteurs emploient (`file_path`, `old_string`, `command`…) changent d'un outil
 * à l'autre, et les reconnaître dans un composant React reviendrait à ne jamais
 * pouvoir le tester. `server/src/test/contenu-journal.test.ts` les fige.
 *
 * LE JSON NE DISPARAÎT PAS POUR AUTANT : il reste ENTIER au dernier point du
 * flux (« JSON intégral »), qui est sa place — tout, d'un bloc, copiable. Ce
 * qu'on retire, c'est le JSON éparpillé sur chaque ligne.
 */

/** Une réponse proposée par une question, telle qu'elle a été posée. */
export interface OptionDeLEntree {
  id: string;
  label: string;
  description?: string;
}

/**
 * UN CHAMP LISIBLE : le refuge de tout ce qui n'entre dans aucune sorte connue.
 * `libelle` est le mot français du champ quand on le connaît, sinon le nom
 * technique tel que le moteur l'a écrit — jamais une clé inventée. `long` dit
 * que la valeur veut son propre bloc : une ligne de tableau ne tiendrait pas un
 * texte de vingt lignes.
 */
export interface ChampLisible {
  cle: string;
  libelle: string;
  valeur: string;
  long: boolean;
}

/**
 * LES SORTES DE CONTENU. Une par composant à l'écran, pas une de plus : une
 * sorte qui n'aurait pas son dessin propre ne serait qu'un `champs` déguisé.
 */
export type VueDEntree =
  /** Un texte à lire — une demande, un plan, un dernier mot : du markdown. */
  | { sorte: 'texte'; texte: string }
  /** Une question posée, ses choix, et la réponse donnée s'il y en a une. */
  | {
      sorte: 'question';
      question: string;
      /** Ce qui éclaire la question, tel que l'agent l'a écrit. */
      description?: string;
      choix: 'single' | 'multiple' | 'text';
      options: OptionDeLEntree[];
      reponse?: string;
    }
  /** Une commande lancée, et ce qu'elle a écrit. */
  | { sorte: 'commande'; commande: string; intention?: string; sortie: string }
  /** Un fichier regardé, et l'extrait qui en est revenu. */
  | { sorte: 'fichier'; chemin: string; extrait: string; depuis?: number }
  /** Un fichier modifié : ce qui a été remplacé, et par quoi. */
  | { sorte: 'modification'; chemin: string; avant?: string; apres?: string; compte?: string }
  /**
   * LA MÉMOIRE DU PROJET OUVERTE SUR UN SUJET, en RÉFÉRENCES quand c'en est
   * une liste (`shared/src/memoire-lue.ts`). `texte` reste là en entier : c'est
   * le repli de tout ce qui n'est pas une recherche — une unité lue d'un bloc,
   * une fiche, le changelog —, et l'écran s'en sert tel quel.
   */
  | {
      sorte: 'memoire';
      sujet?: string;
      mode: MemoireLue['mode'];
      /** La phrase de tête d'une recherche (« 8 unité(s) pour « … » »). */
      entete?: string;
      references: RefMemoire[];
      texte: string;
    }
  /** Une recherche, son motif, et les lignes trouvées. */
  | { sorte: 'recherche'; motif: string; ou?: string; lignes: string[] }
  /** Une adresse consultée sur le web. */
  | { sorte: 'web'; adresse: string; intention?: string; texte: string }
  /** Un point de travail : son état, son rang dans la liste. */
  | { sorte: 'point'; etat?: string; rang?: number; sur?: number }
  /**
   * UN APPEL D'OUTIL, avec le NOM de l'outil et ce qu'il a rendu. C'est la
   * sorte de tout ce qui n'est ni une lecture, ni une écriture, ni une
   * commande : les outils du démon (`coffre_fort`, `board_list_cards`…) et
   * ceux d'un moteur qu'on ne reconnaît pas. Le nom est une VARIABLE — il
   * s'écrit tel que le moteur l'a demandé, jamais deviné.
   */
  | { sorte: 'outil'; nom: string; champs: ChampLisible[]; texte?: string }
  /**
   * LA DEMANDE REÇUE, avec ses PIÈCES JOINTES. Un texte seul retombe sur la
   * sorte « texte » : les pièces ne se dessinent que s'il y en a.
   */
  | { sorte: 'demande'; texte: string; pieces: string[] }
  /** Le refuge : des champs nommés, et le texte rendu s'il y en a un. */
  | { sorte: 'champs'; champs: ChampLisible[]; texte?: string };

/**
 * LE MOT FRANÇAIS DE CHAQUE CHAMP CONNU. Les moteurs nomment leurs paramètres
 * en anglais technique (`file_path`) et le démon les siens en français
 * (`sujet`) : le flux les affiche des deux côtés, il lui faut donc UNE table.
 * Un champ absent de cette table garde son nom tel quel — inventer un libellé
 * pour un paramètre qu'on ne connaît pas ferait mentir l'écran.
 *
 * Ce catalogue est AFFICHÉ TEL QUEL par l'interface : il se traduit comme le
 * reste (`shared/src/traductions.ts`, contrôlé par `scripts/verif-langues.mjs`).
 */
export const LIBELLE_DE_CHAMP: Readonly<Record<string, string>> = {
  file_path: 'Fichier',
  path: 'Chemin',
  chemin: 'Chemin',
  command: 'Commande',
  commande: 'Commande',
  description: 'Intention',
  pattern: 'Motif',
  glob: 'Filtre',
  url: 'Adresse',
  prompt: 'Consigne',
  query: 'Recherche',
  sujet: 'Sujet',
  action: 'Action',
  projet: 'Projet',
  nom: 'Nom',
  titre: 'Titre',
  title: 'Titre',
  /* Les outils du tableau désignent une carte par son identifiant : l'écran
     le remplace par le titre de la carte quand il la connaît. */
  cardId: 'Carte',
  card_id: 'Carte',
  question: 'Question',
  content: 'Contenu',
  old_string: 'Texte remplacé',
  new_string: 'Texte écrit',
  replace_all: 'Partout dans le fichier',
  limit: 'Limite',
  offset: 'À partir de la ligne',
  timeout: 'Délai',
  moteur: 'Moteur',
  modele: 'Modèle',
  reflexion: 'Réflexion',
  session: 'Session',
  mode: 'Mode',
  compte: 'Compte',
  jetons: 'Jetons',
  rang: 'Rang',
  sur: 'Total',
  etat: 'État',
  /* Les outils du mode Création. */
  role: 'Rôle',
  consigne: 'Consigne',
  fichiers: 'Fichiers',
  propositions: 'Propositions',
  critere: 'Critère',
  raison: 'Raison',
};

/**
 * LES QUATRE ÉTATS D'UN POINT DE TRAVAIL, EN FRANÇAIS.
 *
 * Les moteurs les écrivent en anglais technique (`running`, `done`) et le flux
 * les affichait tels quels, au milieu d'une interface qui parle cinq langues.
 * Un état inconnu garde son mot brut : un moteur qui en inventerait un
 * cinquième doit se voir, pas disparaître.
 *
 * Ce catalogue est AFFICHÉ TEL QUEL par l'interface : il se traduit comme le
 * reste (`shared/src/traductions.ts`, contrôlé par `scripts/verif-langues.mjs`).
 */
export const LIBELLE_ETAT_POINT: Readonly<Record<string, string>> = {
  todo: 'À faire',
  running: 'En cours',
  done: 'Faite',
  unfinished: 'Non faite',
};

/** L'état d'un point, dit en français quand on le connaît. */
export function libelleDEtat(etat: string | undefined): string | undefined {
  if (!etat) return undefined;
  return LIBELLE_ETAT_POINT[etat] ?? etat;
}

/** L'ordre de lecture des champs connus : ce qui identifie l'action d'abord. */
const ORDRE_DES_CHAMPS = Object.keys(LIBELLE_DE_CHAMP);

/**
 * UN TEXTE JSON RELU EN OBJET. Tout ce qui n'est pas un objet — un tableau, un
 * nombre, une phrase, un JSON abîmé par le bornage du journal — rend `null` :
 * l'appelant retombe alors sur le texte brut, qui reste lisible.
 */
export function objetJson(texte: string | undefined): Record<string, unknown> | null {
  const propre = (texte ?? '').trim();
  if (!propre.startsWith('{')) return null;
  try {
    const lu: unknown = JSON.parse(propre);
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return null;
    return lu as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Le premier de ces champs qui porte un texte non vide. */
function texteDuChamp(objet: Record<string, unknown> | null, noms: string[]): string | undefined {
  if (!objet) return undefined;
  for (const nom of noms) {
    const valeur = objet[nom];
    if (typeof valeur === 'string' && valeur.trim()) return valeur;
    if (typeof valeur === 'number') return String(valeur);
  }
  return undefined;
}

/** Le premier de ces champs qui porte un nombre. */
/**
 * LA LISTE DE TEXTES D'UN CHAMP — les identifiants de pièces jointes, par
 * exemple. Ce qui n'est pas un tableau de chaînes rend une liste vide : mieux
 * vaut ne rien montrer qu'afficher un objet mal lu.
 */
function listeDeTextes(brut: unknown): string[] {
  if (!Array.isArray(brut)) return [];
  return brut.filter((valeur): valeur is string => typeof valeur === 'string' && !!valeur.trim());
}

function nombreDuChamp(objet: Record<string, unknown> | null, noms: string[]): number | undefined {
  if (!objet) return undefined;
  for (const nom of noms) {
    const valeur = objet[nom];
    if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur;
  }
  return undefined;
}

/**
 * UNE VALEUR ÉCRITE EN CLAIR. Les vrai/faux se disent en mots, les listes de
 * mots se posent à la suite, et ce qui reste vraiment imbriqué s'écrit en JSON
 * — mais SEULEMENT lui, et jamais l'objet entier qui le porte.
 */
function valeurLisible(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'string') return valeur;
  if (typeof valeur === 'number') return String(valeur);
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  if (Array.isArray(valeur)) {
    if (valeur.every((v) => typeof v === 'string' || typeof v === 'number')) return valeur.join(', ');
    return valeur.map((v) => valeurLisible(v)).join('\n');
  }
  try {
    return JSON.stringify(valeur, null, 2);
  } catch {
    return '';
  }
}

/** Une valeur veut son propre bloc dès qu'elle passe à la ligne ou s'allonge. */
function valeurLongue(valeur: string): boolean {
  return valeur.includes('\n') || valeur.length > 90;
}

/**
 * LES CHAMPS D'UN OBJET, À PLAT ET NOMMÉS. Un objet imbriqué est ouvert d'UN
 * étage — `donnees.moteur` devient un champ « moteur » —, au-delà de quoi on
 * s'arrête : creuser sans fin rendrait un tableau de trente lignes là où le
 * JSON intégral fait déjà ce travail, en bas du flux.
 *
 * Les champs connus passent devant, dans l'ordre de la table ; les autres
 * suivent dans l'ordre où le moteur les a écrits.
 */
export function champsLisibles(objet: Record<string, unknown> | null): ChampLisible[] {
  if (!objet) return [];
  const champs: ChampLisible[] = [];
  const poser = (cle: string, brut: unknown) => {
    const valeur = valeurLisible(brut).trim();
    if (!valeur) return;
    champs.push({ cle, libelle: LIBELLE_DE_CHAMP[cle] ?? cle, valeur, long: valeurLongue(valeur) });
  };
  for (const [cle, brut] of Object.entries(objet)) {
    if (brut && typeof brut === 'object' && !Array.isArray(brut)) {
      for (const [sousCle, sousValeur] of Object.entries(brut as Record<string, unknown>)) {
        poser(sousCle, sousValeur);
      }
      continue;
    }
    poser(cle, brut);
  }
  const rang = (champ: ChampLisible) => {
    const place = ORDRE_DES_CHAMPS.indexOf(champ.cle);
    return place === -1 ? ORDRE_DES_CHAMPS.length : place;
  };
  return champs
    .map((champ, ordre) => ({ champ, ordre }))
    .sort((a, b) => rang(a.champ) - rang(b.champ) || a.ordre - b.ordre)
    .map(({ champ }) => champ);
}

/**
 * LA RÉPONSE DONNÉE À UNE QUESTION, retrouvée dans ce que l'outil a rendu au
 * moteur. Ce texte porte la réponse ET la consigne qui la suit (« Reprends ton
 * travail… », `shared/src/attente-question.ts`) : afficher la consigne à
 * l'utilisateur lui donnerait à lire un ordre qui ne le concerne pas.
 */
export function reponseALaQuestion(resultat: string | undefined): string | undefined {
  const texte = (resultat ?? '').trim();
  if (!texte) return undefined;
  /* LA CONSIGNE RENDUE AU MOTEUR N'EST PAS UNE RÉPONSE. Elle reste dans le JSON
     intégral — c'est la trace, elle ne se réécrit pas —, mais le parcours dit
     alors « restée sans réponse », ce qui est exact. */
  if (estUneConsigneAuMoteur(texte)) return undefined;
  /* UNE REPRISE TECHNIQUE N'EST PAS UNE RÉPONSE. Quand le moteur ne rend aucun
     détail en refermant son étape, le démon garde celui du DÉPART : les
     paramètres de l'appel, en JSON, coupés à 200 signes (`humanStep`). Ce texte
     se lisait alors sous les pastilles comme la réponse de l'utilisateur — on
     relisait la question elle-même, en JSON, à la place du choix retenu. */
  if (objetJson(texte)) return undefined;
  const debut = /R[ée]ponse de l['’]utilisateur\s*:\s*/.exec(texte);
  if (!debut) return texte;
  const suite = texte.slice(debut.index + debut[0].length);
  const fin = /\n(?:Reprends ton travail|Fichiers joints)/.exec(suite);
  return (fin ? suite.slice(0, fin.index) : suite).trim() || undefined;
}

/** Les options d'une question, relues quelle que soit la forme reçue. */
function optionsLues(brut: unknown): OptionDeLEntree[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .map((option, rang): OptionDeLEntree | null => {
      if (typeof option === 'string') return { id: `o${rang}`, label: option };
      if (!option || typeof option !== 'object') return null;
      const objet = option as Record<string, unknown>;
      const label = typeof objet.label === 'string' ? objet.label : undefined;
      if (!label) return null;
      const id = typeof objet.id === 'string' ? objet.id : `o${rang}`;
      const description = typeof objet.description === 'string' ? objet.description : undefined;
      return description ? { id, label, description } : { id, label };
    })
    .filter((option): option is OptionDeLEntree => option !== null);
}

/** Le genre de choix d'une question ; à défaut, un choix unique. */
function choixLu(brut: unknown, options: OptionDeLEntree[]): 'single' | 'multiple' | 'text' {
  if (brut === 'multiple' || brut === 'text' || brut === 'single') return brut;
  return options.length ? 'single' : 'text';
}

/**
 * CE QUE PORTE UNE ENTRÉE, EN UNE SORTE ET SES PIÈCES.
 *
 * Le genre de l'action décide (`genreDAction`, la même règle qui décide
 * l'icône) : un écran ne montre jamais un contenu d'une autre couleur que son
 * rond. Quand une entrée n'a pas ce qu'il faut pour sa sorte — une étape du
 * moteur, qui porte un texte mais aucun paramètre —, on retombe sur le refuge
 * plutôt que d'afficher un bloc à moitié vide.
 */
export function vueDeLEntree(entree: EntreeJournal): VueDEntree {
  const genre: GenreAction = genreDAction(entree);
  const params = objetJson(entree.params);
  const donnees = objetJson(entree.donnees);
  const resultat = entree.resultat ?? '';

  switch (genre) {
    /* LA DEMANDE PORTE SES PIÈCES JOINTES. Le texte de l'utilisateur se lit
       comme un texte, mais les fichiers déposés avec lui appartiennent à la
       même demande : les afficher sous le prompt évite d'aller les chercher
       ailleurs. Sans pièce, on retombe sur la sorte « texte ». */
    case 'demande': {
      const texte = resultat.trim();
      if (texte) {
        const pieces = listeDeTextes(donnees?.pieces);
        return pieces.length ? { sorte: 'demande', texte, pieces } : { sorte: 'texte', texte };
      }
      break;
    }

    /* Ce qui se lit comme un texte : le plan proposé, le dernier mot rendu,
       la cause d'un tour tombé, une phrase de passage de l'agent. */
    case 'plan':
    case 'reponse':
    case 'note':
    case 'incident':
      if (resultat.trim()) return { sorte: 'texte', texte: resultat };
      break;

    case 'question': {
      const question = texteDuChamp(params, ['question']);
      if (question) {
        const options = optionsLues(params?.options);
        const reponse = reponseALaQuestion(resultat);
        /* CE QUI ÉCLAIRE LA QUESTION VOYAGE AVEC ELLE : la trace du parcours
           montre ce que l'utilisateur avait sous les yeux pour répondre, pas
           seulement la phrase interrogative. */
        const description = texteDuChamp(params, ['description']);
        return {
          sorte: 'question',
          question,
          ...(description ? { description } : {}),
          choix: choixLu(params?.kind, options),
          options,
          ...(reponse ? { reponse } : {}),
        };
      }
      break;
    }

    case 'commande': {
      const commande = texteDuChamp(params, ['command', 'commande']);
      if (commande) {
        const intention = texteDuChamp(params, ['description']);
        return { sorte: 'commande', commande, sortie: resultat, ...(intention ? { intention } : {}) };
      }
      break;
    }

    case 'lecture': {
      const chemin = texteDuChamp(params, ['file_path', 'path', 'chemin', 'notebook_path']);
      if (chemin) {
        const depuis = nombreDuChamp(params, ['offset']);
        return { sorte: 'fichier', chemin, extrait: resultat, ...(depuis === undefined ? {} : { depuis }) };
      }
      break;
    }

    case 'ecriture': {
      const chemin = texteDuChamp(params, ['file_path', 'path', 'chemin']);
      if (chemin) {
        const avant = texteDuChamp(params, ['old_string']);
        const apres = texteDuChamp(params, ['new_string', 'content']);
        const compte = texteDuChamp(params, ['replace_all']);
        return {
          sorte: 'modification',
          chemin,
          ...(avant ? { avant } : {}),
          ...(apres ? { apres } : {}),
          ...(compte ? { compte } : {}),
        };
      }
      break;
    }

    case 'memoire': {
      if (resultat.trim()) {
        /* LE SUJET EST CE QUE L'AGENT A DEMANDÉ. L'outil `memoire` nomme son
           champ `demande` (et `id`, `fiche`, `code` selon le geste) : ne
           chercher que `sujet` laissait la ligne muette neuf fois sur dix. */
        const sujet = texteDuChamp(params, ['demande', 'sujet', 'query', 'id', 'fiche', 'code', 'nom']);
        const lue = lireLaMemoire(resultat);
        return {
          sorte: 'memoire',
          texte: resultat,
          mode: lue.mode,
          references: lue.references,
          ...(lue.entete ? { entete: lue.entete } : {}),
          ...(sujet ? { sujet } : {}),
        };
      }
      break;
    }

    case 'recherche': {
      const motif = texteDuChamp(params, ['pattern', 'query', 'motif']);
      if (motif) {
        const ou = texteDuChamp(params, ['path', 'glob', 'chemin']);
        const lignes = resultat.split('\n').filter((ligne) => ligne.trim());
        return { sorte: 'recherche', motif, lignes, ...(ou ? { ou } : {}) };
      }
      break;
    }

    case 'web': {
      const adresse = texteDuChamp(params, ['url', 'adresse']);
      if (adresse) {
        const intention = texteDuChamp(params, ['prompt', 'query']);
        return { sorte: 'web', adresse, texte: resultat, ...(intention ? { intention } : {}) };
      }
      break;
    }

    case 'point': {
      const rang = nombreDuChamp(donnees, ['rang']);
      const sur = nombreDuChamp(donnees, ['sur']);
      return {
        sorte: 'point',
        ...(entree.etat ? { etat: entree.etat } : {}),
        ...(rang === undefined ? {} : { rang }),
        ...(sur === undefined ? {} : { sur }),
      };
    }

    default:
      break;
  }

  /* LE REFUGE : ce que l'entrée porte, nommé champ par champ, et son texte
     rendu en dessous. Aucune entrée ne tombe donc dans le vide, et aucune ne
     se rabat sur du JSON brut. */
  const champs = champsLisibles(params ?? donnees);

  /* UN APPEL D'OUTIL DIT SON NOM. Le refuge affichait ses paramètres et sa
     sortie sans jamais nommer l'outil : dix appels différents se lisaient
     comme dix pavés identiques, et il fallait remonter au libellé de la ligne
     — traduit, donc différent du nom réel — pour savoir qui avait parlé. Le
     nom BRUT ouvre donc le bloc, et les données rendues se lisent dessous. */
  const nom = (entree.outil ?? '').trim();
  if (nom && (genre === 'outil' || genre === 'memoire' || genre === 'web')) {
    return resultat.trim()
      ? { sorte: 'outil', nom, champs, texte: resultat }
      : { sorte: 'outil', nom, champs };
  }

  return resultat.trim() ? { sorte: 'champs', champs, texte: resultat } : { sorte: 'champs', champs };
}

/**
 * LA LIGNE REPLIÉE : CE QUE L'ENTRÉE A TOUCHÉ, EN QUELQUES MOTS.
 *
 * Replié, le flux ne montrait que le nom de l'outil — dix lignes « Read »
 * d'affilée, sans savoir QUOI. Ce résumé pose à côté du nom la seule chose qui
 * distingue un appel du suivant : le fichier, la commande, le sujet, la
 * question. Il est COURT par construction : c'est une ligne de flux, pas un
 * contenu — le détail se déplie.
 */
export function resumeDeLEntree(entree: EntreeJournal): string | undefined {
  const vue = vueDeLEntree(entree);
  switch (vue.sorte) {
    case 'question':
      return vue.question;
    case 'commande':
      return vue.commande;
    case 'fichier':
      return nomDeFichier(vue.chemin);
    case 'modification':
      return nomDeFichier(vue.chemin);
    case 'memoire':
      return vue.sujet;
    case 'recherche':
      return vue.motif;
    case 'web':
      return vue.adresse;
    case 'texte':
      return premiereLigne(vue.texte);
    case 'demande':
      return premiereLigne(vue.texte);
    /* UN APPEL D'OUTIL SE RÉSUME PAR SON PREMIER PARAMÈTRE, comme le refuge :
       c'est lui qui distingue dix appels du même outil les uns des autres. */
    case 'outil':
      return vue.champs[0]?.long ? undefined : vue.champs[0]?.valeur;
    case 'champs':
      return vue.champs[0]?.long ? undefined : vue.champs[0]?.valeur;
    default:
      return undefined;
  }
}

/** Le nom d'un fichier, son dossier retiré : c'est lui qu'on reconnaît. */
function nomDeFichier(chemin: string): string {
  const morceaux = chemin.split('/').filter(Boolean);
  return morceaux[morceaux.length - 1] ?? chemin;
}

/** La première ligne d'un texte, titre markdown débarrassé de ses dièses. */
function premiereLigne(texte: string): string | undefined {
  for (const ligne of texte.split('\n')) {
    const propre = ligne.replace(/^#{1,6}\s*/, '').trim();
    if (propre) return propre;
  }
  return undefined;
}

/** Un texte réduit à ses lettres et chiffres, en minuscules : ce qui se LIT. */
function lettresSeules(texte: string): string {
  return texte
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * CE TEXTE EST-IL DÉJÀ DIT PAR LA PHRASE AU-DESSUS ?
 *
 * Une étape ouverte montre directement son encadré sous la phrase du bloc
 * raconté. Pour une commande, cette phrase EST l'intention du moteur,
 * enchâssée (« Je lance une commande pour lire le module de TVA. ») : la
 * redire sous le bandeau (« Lire le module de TVA ») faisait lire deux fois
 * la même chose. Casse, accents et ponctuation ne comptent pas ; une phrase
 * coupée par « … » ne contient plus le texte entier, qui reste donc montré.
 */
export function dejaDitDans(phrase: string | undefined, texte: string | undefined): boolean {
  const cherche = lettresSeules(texte ?? '');
  if (!cherche) return false;
  return ` ${lettresSeules(phrase ?? '')} `.includes(` ${cherche} `);
}
