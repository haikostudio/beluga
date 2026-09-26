/*
 * LE FIL HISTORIQUE D'UNE ÉTAPE DE PUBLICATION.
 *
 * Le déroulé d'une mise en ligne disait l'ESSENTIEL et rien d'autre : sept
 * lignes, un état chacune (« en cours », « à venir »), une ligne de progression
 * TRANSITOIRE effacée dès l'étape finie. Pendant la fusion de dix branches, on
 * voyait « Branche 10 sur 10 » — jamais les neuf précédentes ; un agent de
 * dépannage passait sans laisser d'autre trace qu'un compte de reprises ; une
 * étape terminée ne gardait que sa durée. Pour savoir ce qui s'était réellement
 * passé, il fallait ouvrir le journal du service.
 *
 * Chaque étape porte donc son FIL : des événements HORODATÉS, gardés avec la
 * publication, lisibles pendant qu'elle tourne comme des semaines plus tard.
 *
 * TROIS PRINCIPES.
 *
 *  1. RIEN N'EST INVENTÉ : un événement est écrit par le code qui fait le
 *     geste, au moment où il le fait. Aucune reconstitution après coup.
 *  2. LE FIL EST BORNÉ (`EVENEMENTS_PAR_ETAPE_MAX`) : une fusion de cent
 *     branches ne doit pas faire enfler la base ni le premier envoi. Ce sont
 *     les PLUS RÉCENTS qui restent, et la coupe se DIT.
 *  3. UN FIL VIDE N'EST PAS UNE PANNE : toute publication écrite avant cette
 *     règle n'en a pas, et se relit exactement comme avant.
 *
 * Ces règles sont PURES : ni base, ni disque, ni horloge imposée — l'instant
 * est toujours passé en argument.
 */

/**
 * DE QUELLE NATURE est un événement du fil. Le genre décide de l'icône et de la
 * couleur ; il ne change jamais le texte, qui est écrit une fois pour toutes
 * par celui qui a fait le geste.
 */
export type GenreDEvenement =
  /** L'étape commence. */
  | 'debut'
  /** Ce que l'étape est en train de faire (branche fusionnée, contrôle lancé). */
  | 'progression'
  /** Une commande réellement lancée sur la machine. */
  | 'commande'
  /** Un agent de dépannage : son procédé, son passage, son issue. */
  | 'depannage'
  /**
   * UNE SOUS-ÉTAPE NOMMÉE, qui a un avant et un après : l'espace de travail
   * qu'on est en train de compiler, le lot qu'on est en train de fusionner.
   * C'est le seul genre dont le rond CHANGE en cours de route — il porte un
   * `etat` (voir plus bas), et `acheverLeMoment` le referme à sa sortie.
   */
  | 'sous-etape'
  /** L'étape se termine — réussie, sautée ou tombée. */
  | 'issue';

/**
 * OÙ EN EST UN MOMENT QUI DURE. Sans lui, le rond d'une sous-étape ne disait
 * rien : « shared », « server », « web » se lisaient tous pareil, qu'ils
 * soient en train de compiler, passés ou tombés.
 */
export type EtatDuMoment =
  | 'encours'
  | 'fait'
  | 'echec'
  /** Sautée : ni réussie ni tombée — le rond reste neutre. */
  | 'saute'
  /**
   * RATTRAPÉE : l'étape est tombée, la cause a été réparée, et elle est passée
   * à la reprise. Ni le vert du succès franc, ni le rouge de l'échec : l'orange
   * de ce qui a demandé un secours, pour qu'une coupure rattrapée se VOIE après
   * coup au lieu de disparaître derrière une coche.
   */
  | 'rattrape';

/** Un moment du fil : quand, de quelle nature, et quoi. */
export type EvenementDEtape = {
  /** L'instant, en millisecondes. */
  at: number;
  genre: GenreDEvenement;
  texte: string;
  /**
   * L'état du moment, quand il en a un — une sous-étape, jamais une simple
   * progression. Absent, le rond suit le genre, comme avant cette règle.
   */
  etat?: EtatDuMoment;
  /**
   * L'agent de dépannage qui a écrit ce moment, s'il y en a un — jamais posé
   * sur l'`Agent` lui-même (voir `resoudreConflit`), seulement ICI, pour que
   * le tiroir puisse ouvrir sa conversation sans le confondre avec l'agent de
   * la carte.
   */
  agentId?: string;
};

/**
 * Combien d'événements une étape garde au plus.
 *
 * Deux cents : de quoi tenir une fusion de cent branches avec son début et son
 * issue, sans qu'une publication pathologique ne fasse enfler la base. Au-delà,
 * ce sont les PLUS ANCIENS qui partent — ce qu'on cherche après coup est
 * presque toujours la fin.
 */
export const EVENEMENTS_PAR_ETAPE_MAX = 200;

/** La longueur d'un texte d'événement : au-delà, c'est un journal, pas un fil. */
export const TEXTE_EVENEMENT_MAX = 600;

/**
 * AJOUTER UN MOMENT AU FIL.
 *
 * Trois refus, tous nécessaires :
 *
 *  - un texte VIDE n'entre pas (la progression est parfois réémise à blanc) ;
 *  - le MÊME texte du MÊME genre, deux fois de suite, n'entre pas non plus :
 *    le serveur réémet l'état de la publication à chaque pas, et une
 *    progression inchangée se réécrirait à chaque fois ;
 *  - au-delà du plafond, les plus anciens sortent.
 *
 * Rien n'est jamais modifié SUR PLACE : un ajout rend un tableau neuf, un refus
 * rend le fil tel quel. La règle se rejoue donc sans surprise pour l'appelant.
 */
export function ajouterAuJournal(
  journal: EvenementDEtape[] | undefined,
  evenement: EvenementDEtape,
): EvenementDEtape[] {
  const fil = journal ?? [];
  const texte = evenement.texte.trim().slice(0, TEXTE_EVENEMENT_MAX);
  if (!texte) return fil;
  const dernier = fil[fil.length - 1];
  if (dernier && dernier.genre === evenement.genre && dernier.texte === texte) return fil;
  const suite = [
    ...fil,
    {
      at: evenement.at,
      genre: evenement.genre,
      texte,
      ...(evenement.etat ? { etat: evenement.etat } : {}),
      ...(evenement.agentId ? { agentId: evenement.agentId } : {}),
    },
  ];
  return suite.length > EVENEMENTS_PAR_ETAPE_MAX ? suite.slice(-EVENEMENTS_PAR_ETAPE_MAX) : suite;
}

/**
 * REFERMER UN MOMENT QUI DURAIT.
 *
 * Une sous-étape s'annonce quand elle part (« shared… », état « en cours »)
 * et doit DIRE ce qu'elle est devenue quand elle rend la main. Ajouter un
 * second moment à la suite laisserait le premier tourner pour toujours : on
 * REMPLACE donc le dernier moment qui portait ce texte, en gardant son heure
 * de départ — c'est elle qui situe la sous-étape dans le fil.
 *
 * Un moment introuvable — fil coupé par le plafond, publication reprise en
 * route — n'est pas une panne : l'issue s'AJOUTE alors à la fin, plutôt que
 * de se perdre.
 */
export function acheverLeMoment(
  journal: EvenementDEtape[] | undefined,
  reperage: { genre: GenreDEvenement; texte: string },
  issue: { at: number; etat: EtatDuMoment; texte: string },
): EvenementDEtape[] {
  const fil = journal ?? [];
  const cible = reperage.texte.trim().slice(0, TEXTE_EVENEMENT_MAX);
  const texte = issue.texte.trim().slice(0, TEXTE_EVENEMENT_MAX);
  if (!texte) return fil;
  for (let i = fil.length - 1; i >= 0; i--) {
    if (fil[i].genre !== reperage.genre || fil[i].texte !== cible) continue;
    const suite = [...fil];
    suite[i] = { ...fil[i], texte, etat: issue.etat };
    return suite;
  }
  return ajouterAuJournal(fil, { at: issue.at, genre: reperage.genre, texte, etat: issue.etat });
}

/**
 * L'HEURE d'un événement, en quatre chiffres et deux points : « 14:32 ».
 *
 * Les secondes sont gardées : deux branches fusionnées dans la même minute
 * seraient sinon indiscernables, et c'est justement ce qu'on vient lire.
 */
export function heureDeLEvenement(at: number): string {
  const d = new Date(at);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`;
}

/**
 * L'ÉCART depuis le début de l'étape, dit en une poignée de signes : « +4 s ».
 *
 * C'est ce qui répond à « où est passé le temps ? » sans avoir à soustraire
 * deux heures de tête. Sans début connu, rien — jamais un « +NaN ».
 */
export function ecartDepuisLeDebut(at: number, debut?: number): string | null {
  if (!debut || at < debut) return null;
  const secondes = Math.round((at - debut) / 1000);
  if (secondes < 60) return `+${secondes} s`;
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return `+${minutes} min`;
  return `+${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * CE QU'UNE ÉTAPE A À RACONTER, en une ligne : « 12 moments ».
 *
 * Rien du tout quand le fil est vide — une étape qui n'a rien à dire ne doit
 * pas afficher un « 0 » qui donnerait envie de l'ouvrir.
 */
export function resumeDuFil(journal?: EvenementDEtape[]): string | null {
  const nombre = journal?.length ?? 0;
  if (!nombre) return null;
  return nombre > 1 ? `${nombre} moments` : '1 moment';
}

/**
 * LE FIL D'UNE ÉTAPE, PRÊT À AFFICHER.
 *
 * Il réunit deux sources, et c'est voulu : le journal écrit au fil de l'eau, et
 * les RÉCITS DE RÉPARATION (`steps[].reparations`), qui existaient avant lui et
 * qui vivent encore sur toutes les publications d'hier. Une publication ancienne
 * garde donc un fil lisible — celui de ses réparations — au lieu d'un vide.
 *
 * Les récits de réparation ne portent PAS d'instant : on les range à la fin,
 * sans heure inventée. C'est le seul endroit où le fil n'est pas horodaté, et
 * c'est assumé — mieux vaut un récit sans heure qu'un récit perdu.
 */
export function filDeLEtape(step: {
  journal?: EvenementDEtape[];
  reparations?: string[];
}): {
  evenement: EvenementDEtape | null;
  texte: string;
  genre: GenreDEvenement;
  etat?: EtatDuMoment;
  agentId?: string;
}[] {
  const fil = (step.journal ?? []).map((evenement) => ({
    evenement,
    texte: evenement.texte,
    genre: evenement.genre,
    etat: evenement.etat,
    agentId: evenement.agentId,
  }));
  const dejaDit = new Set(fil.map((ligne) => ligne.texte));
  const reparations = (step.reparations ?? [])
    .filter((recit) => recit.trim() && !dejaDit.has(recit.trim()))
    .map((recit) => ({ evenement: null, texte: recit.trim(), genre: 'depannage' as GenreDEvenement }));
  return [...fil, ...reparations];
}

/**
 * LE TITRE D'UNE PUBLICATION, tel qu'il s'écrit en tête de son tiroir et sur le
 * groupe de cartes qu'elle a mises en ligne : « Déploiement du 17 août, 14:32 ».
 *
 * La DATE en toutes lettres, parce qu'on relit ce titre des semaines plus tard
 * et qu'un « 17/08 » ne dit rien de l'année qu'on croit ; l'HEURE parce que
 * deux déploiements du même jour sont la règle, pas l'exception.
 */
const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export function titreDeLaPublication(etape: string, at: number): string {
  const d = new Date(at);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${etape} du ${d.getDate()} ${MOIS[d.getMonth()]}, ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}
