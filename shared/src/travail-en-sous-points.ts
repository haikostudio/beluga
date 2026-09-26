import { EntreeJournal } from './journal-carte.js';
import { objetJson } from './contenu-journal.js';

/**
 * LE POINT « TRAVAIL » SE LIT À TROIS NIVEAUX.
 *
 * Le passage « Travail » d'une carte empilait ses actions à plat : quarante
 * cartons à la file, sans savoir lequel appartenait à quoi. Le journal, lui,
 * porte déjà la LISTE DE TÂCHES de l'agent — une entrée `nature: 'point'` par
 * ligne et par état, avec son libellé, son rang, son total et ses heures de
 * début et de fin. Cette règle rapproche les deux : les actions se rangent
 * SOUS le point de la liste pendant lequel elles ont eu lieu.
 *
 * TROIS NIVEAUX, DONC : « Travail », puis un sous-point par ligne de la liste,
 * puis les actions faites sous chacun. Le premier sous-point s'appelle
 * « Réflexion » : c'est tout ce que l'agent a fait AVANT d'annoncer sa liste,
 * et c'est le seul sous-point d'un tour qui n'en a jamais annoncé — une carte
 * ancienne reste donc lisible, simplement à deux niveaux.
 *
 * DEUX CHOSES LA GOUVERNENT :
 *
 *  1. LA DURÉE VIENT DU JOURNAL, JAMAIS D'UNE ESTIMATION. Le démon écrit
 *     `debutLe` et `finLe` sur chaque point (`runtime.ts`) ; à défaut — un
 *     journal ancien, une ligne jamais démarrée — on retombe sur l'heure des
 *     entrées elles-mêmes.
 *  2. UN ÉCHEC REMONTE. Dès qu'une action d'un sous-point a été refusée, le
 *     sous-point le dit (`enEchec`) : on repère l'endroit exact où un tour a
 *     déraillé sans avoir à tout déplier.
 *
 * Règle pure : ni base, ni disque, ni React. Éprouvée seule dans
 * `server/src/test/travail-en-sous-points.test.ts`.
 */

/** La clé du dictionnaire du premier sous-point : ce qui précède la liste. */
export const LIBELLE_DE_LA_REFLEXION = 'Réflexion';

/** Un sous-point du travail : la réflexion, ou une ligne de la liste de tâches. */
export interface SousPointDuTravail {
  /** La clé de rendu, stable d'un rafraîchissement à l'autre. */
  cle: string;
  /** `reflexion` pour le premier, `point` pour une ligne de la liste. */
  sorte: 'reflexion' | 'point';
  /**
   * Ce qui s'affiche. Pour la réflexion, c'est une CLÉ du dictionnaire ; pour
   * une ligne de la liste, c'est le texte de l'agent, qui ne se traduit pas.
   */
  libelle: string;
  /** Le libellé passe-t-il par le dictionnaire ? */
  traduire: boolean;
  /** L'état de la ligne, tel que le moteur l'a écrit (`todo`, `running`, …). */
  etat?: string;
  /** Le rang de la ligne dans la liste, et le total annoncé. */
  rang?: number;
  sur?: number;
  /** Le début du sous-point, en horodatage. */
  debut?: number;
  /** Sa durée en millisecondes, quand elle se connaît. */
  dureeMs?: number;
  /** Une de ses actions a été refusée. */
  enEchec: boolean;
  /** Les actions faites pendant ce sous-point, dans l'ordre du journal. */
  entrees: EntreeJournal[];
}

/** L'ordre d'avancement des états : on garde toujours le plus avancé. */
const AVANCEMENT_DE_L_ETAT: Readonly<Record<string, number>> = {
  todo: 0,
  running: 1,
  unfinished: 2,
  done: 3,
};

/** Un nombre relu dans les données d'un point, quand il y en a un. */
function nombreDes(donnees: Record<string, unknown> | null, champ: string): number | undefined {
  const valeur = donnees?.[champ];
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : undefined;
}

/** Ce qu'un chantier de sous-point accumule avant d'être figé. */
interface ChantierDeSousPoint {
  cle: string;
  sorte: 'reflexion' | 'point';
  libelle: string;
  traduire: boolean;
  etat?: string;
  rang?: number;
  sur?: number;
  debutLe?: number;
  finLe?: number;
  premierAt?: number;
  dernierAt?: number;
  enEchec: boolean;
  entrees: EntreeJournal[];
}

/** La clé d'une ligne de liste : son rang quand il est là, son libellé sinon. */
function cleDuPoint(entree: EntreeJournal, donnees: Record<string, unknown> | null): string {
  const rang = nombreDes(donnees, 'rang');
  return rang === undefined ? `point:${entree.libelle}` : `point:${rang}`;
}

/**
 * LE TRAVAIL, DÉCOUPÉ EN SOUS-POINTS.
 *
 * On parcourt le journal DANS SON ORDRE (le rang, jamais l'heure) : les
 * entrées `point` ouvrent ou mettent à jour les sous-points, toutes les autres
 * se rangent sous le sous-point courant. Le moteur renvoyant sa liste ENTIÈRE
 * à chaque changement, le sous-point courant est celui qu'il annonce
 * « en cours » ; à défaut, le dernier qui n'est pas encore coché.
 */
export function travailEnSousPoints(entrees: readonly EntreeJournal[]): SousPointDuTravail[] {
  const ordonnees = [...entrees].sort((a, b) => a.rang - b.rang);

  const reflexion: ChantierDeSousPoint = {
    cle: 'reflexion',
    sorte: 'reflexion',
    libelle: LIBELLE_DE_LA_REFLEXION,
    traduire: true,
    enEchec: false,
    entrees: [],
  };
  const points = new Map<string, ChantierDeSousPoint>();
  const ordreDesPoints: string[] = [];
  let courant: ChantierDeSousPoint = reflexion;

  /* UN LOT DE POINTS ARRIVE D'UN COUP : le moteur réécrit sa liste entière à
     chaque changement. On lit le lot en entier avant de décider où vont les
     actions qui le suivent. */
  let lot: ChantierDeSousPoint[] = [];
  const refermerLeLot = () => {
    if (!lot.length) return;
    const enCours = lot.find((p) => p.etat === 'running');
    const pasFini = [...lot].reverse().find((p) => p.etat !== 'done');
    courant = enCours ?? pasFini ?? lot[lot.length - 1];
    lot = [];
  };

  for (const entree of ordonnees) {
    if (entree.nature === 'point') {
      const donnees = objetJson(entree.donnees);
      const cle = cleDuPoint(entree, donnees);
      let chantier = points.get(cle);
      if (!chantier) {
        chantier = {
          cle,
          sorte: 'point',
          libelle: entree.libelle,
          traduire: false,
          enEchec: false,
          entrees: [],
        };
        points.set(cle, chantier);
        ordreDesPoints.push(cle);
      }
      /* LE LIBELLÉ ET L'ÉTAT SUIVENT LA DERNIÈRE ÉCRITURE, mais l'état ne
         RECULE jamais : une liste renvoyée en entier peut redire « à faire »
         une ligne déjà cochée si le moteur se répète. */
      if (entree.libelle) chantier.libelle = entree.libelle;
      const avant = AVANCEMENT_DE_L_ETAT[chantier.etat ?? ''] ?? -1;
      const apres = AVANCEMENT_DE_L_ETAT[entree.etat ?? ''] ?? -1;
      if (entree.etat && apres >= avant) chantier.etat = entree.etat;
      chantier.rang = nombreDes(donnees, 'rang') ?? chantier.rang;
      chantier.sur = nombreDes(donnees, 'sur') ?? chantier.sur;
      chantier.debutLe = nombreDes(donnees, 'debutLe') ?? chantier.debutLe;
      chantier.finLe = nombreDes(donnees, 'finLe') ?? chantier.finLe;
      if (chantier.premierAt === undefined) chantier.premierAt = entree.at;
      chantier.dernierAt = entree.at;
      lot.push(chantier);
      continue;
    }

    refermerLeLot();
    courant.entrees.push(entree);
    if (entree.reussie === false) courant.enEchec = true;
    if (courant.premierAt === undefined) courant.premierAt = entree.at;
    courant.dernierAt = Math.max(courant.dernierAt ?? entree.at, entree.at);
  }
  refermerLeLot();

  const finDuPassage = ordonnees.length ? ordonnees[ordonnees.length - 1].at : undefined;

  /** Un chantier devient un sous-point affichable. */
  const figer = (chantier: ChantierDeSousPoint, suivant?: ChantierDeSousPoint): SousPointDuTravail => {
    const debut = chantier.debutLe ?? chantier.premierAt;
    /* LA FIN : celle que le démon a écrite ; sinon le début du sous-point
       suivant ; sinon la dernière heure vue dans le passage. */
    const fin = chantier.finLe ?? suivant?.debutLe ?? suivant?.premierAt ?? chantier.dernierAt ?? finDuPassage;
    const dureeMs = debut !== undefined && fin !== undefined && fin >= debut ? fin - debut : undefined;
    return {
      cle: chantier.cle,
      sorte: chantier.sorte,
      libelle: chantier.libelle,
      traduire: chantier.traduire,
      ...(chantier.etat ? { etat: chantier.etat } : {}),
      ...(chantier.rang === undefined ? {} : { rang: chantier.rang }),
      ...(chantier.sur === undefined ? {} : { sur: chantier.sur }),
      ...(debut === undefined ? {} : { debut }),
      ...(dureeMs === undefined ? {} : { dureeMs }),
      enEchec: chantier.enEchec,
      entrees: chantier.entrees,
    };
  };

  /* LES LIGNES DE LA LISTE SE LISENT DANS L'ORDRE DE LEUR RANG, pas dans
     celui où le journal les a vues : un moteur qui coche la deuxième avant la
     première ne doit pas retourner l'affichage. */
  const chantiersDesPoints = ordreDesPoints
    .map((cle) => points.get(cle)!)
    .sort((a, b) => (a.rang ?? Number.MAX_SAFE_INTEGER) - (b.rang ?? Number.MAX_SAFE_INTEGER));

  /* UN TOUR SANS AUCUNE LIGNE DE LISTE NE REND QUE « RÉFLEXION » — et rien du
     tout s'il n'a rien fait. */
  if (!chantiersDesPoints.length) {
    return reflexion.entrees.length ? [figer(reflexion)] : [];
  }

  /* LA RÉFLEXION NE S'AFFICHE QUE SI ELLE PORTE QUELQUE CHOSE : un agent qui
     annonce sa liste avant tout autre geste n'a pas de sous-point vide. */
  const suite = [reflexion, ...chantiersDesPoints];
  return suite
    .map((chantier, index) => figer(chantier, suite[index + 1]))
    .filter((sousPoint, index) => index > 0 || sousPoint.entrees.length > 0);
}
