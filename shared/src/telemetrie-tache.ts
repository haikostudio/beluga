/**
 * LA TÉLÉMÉTRIE D'UNE TÂCHE — CE QU'ELLE A COÛTÉ, CE QU'ELLE EST ALLÉE
 * CHERCHER, ET CE QUE ÇA VAUT.
 *
 * Jusqu'ici trois grandeurs vivaient chacune dans son coin : les jetons dans la
 * table `usage`, le tri de la mémoire dans `memoire_economie`, la durée dans la
 * carte. Aucune ne se lisait à côté des autres, donc personne ne pouvait
 * répondre à « pourquoi cette tâche a-t-elle pris cinquante minutes ? ».
 *
 * Ce module réunit les trois en UNE mesure par tâche, et n'en tire que des
 * règles PURES : aucune base, aucun disque, donc il se rejoue seul dans un test.
 *
 * TROIS PRÉCAUTIONS, les mêmes que pour l'économie de mémoire :
 *
 *   • RIEN N'EST INVENTÉ. Les jetons viennent de l'événement d'usage du moteur,
 *     les signes de textes réellement construits, les millisecondes d'un
 *     chronomètre. Une grandeur absente reste ABSENTE — jamais un zéro, qui se
 *     lirait comme une mesure.
 *   • AUCUN CONTENU NE VOYAGE. Une mesure ne porte que des NOMBRES et des NOMS
 *     DE SUJETS (« cartes », « publication »). Jamais le texte d'un fait, jamais
 *     une demande, jamais une réponse : la télémétrie ne doit rien pouvoir
 *     divulguer que la conversation ne montre déjà.
 *   • LA NOTE DE QUALITÉ EST UNE ESTIMATION, ET ELLE LE DIT. Chaque critère
 *     porte sa raison en français, pour qu'un 40/100 s'explique sans ouvrir le
 *     code.
 */

/** Comment le dernier tour de la tâche s'est terminé. */
export type IssueDeTache = 'terminee' | 'interrompue' | 'echec';

/** Ce que les ouvertures de mémoire d'une tâche ont coûté et rapporté. */
export interface MesureDeMemoire {
  /** Combien de fois `project_memory` a été appelé pendant la tâche. */
  ouvertures: number;
  /** Le temps cumulé passé dans ces ouvertures, en millisecondes. */
  millisecondes: number;
  /** Les SUJETS ouverts, dans l'ordre, sans doublon. Des noms, jamais du texte. */
  sujets: string[];
  /** Les blocs de mémoire que les demandes ont fait remonter. */
  demandes: number;
  /** Ceux qui sont réellement partis au moteur — les autres étaient déjà lus. */
  rendus: number;
  /** Ce qui serait parti sans le tri, en signes. */
  signesEntiers: number;
  /** Ce qui est parti, en signes. */
  signesServis: number;
}

/** La mesure complète d'une tâche : une ligne du tableau de bord. */
export interface MesureDeTache {
  cardId: string;
  titre?: string;
  projet?: string;
  issue: IssueDeTache;
  /** Combien de tours de moteur la tâche a demandés. */
  tours: number;
  /** L'entrée NEUVE, hors relecture au cache. */
  tokensEntree: number;
  /** L'entrée relue au cache — payée bien moins cher, comptée à part. */
  tokensCache: number;
  tokensSortie: number;
  memoire: MesureDeMemoire;
  /** La durée machine cumulée des tours, en secondes. */
  secondes: number;
  /** Le moment du dernier relevé. */
  at: number;
}

/**
 * LES JETONS QUI COÛTENT VRAIMENT : l'entrée neuve plus la sortie. La relecture
 * au cache est comptée à part parce qu'elle se paie une fraction du prix — la
 * mêler ferait passer une tâche économe pour une gloutonne, ses 75 millions de
 * jetons relus masquant ses 200 000 jetons réels.
 */
export function jetonsFacturables(mesure: {
  tokensEntree: number;
  tokensSortie: number;
}): number {
  return Math.max(0, mesure.tokensEntree) + Math.max(0, mesure.tokensSortie);
}

/**
 * LES DEUX RÉFÉRENCES SONT MESURÉES, PAS CHOISIES. Relevées le 25/08/2026 sur
 * les 1 123 tâches des trente derniers jours de ce dépôt : 122 578 jetons
 * facturables et 729 secondes pour la tâche MÉDIANE. Une tâche à la médiane
 * vaut donc tous les points, une tâche à trois fois la médiane n'en vaut aucun.
 * Ces deux nombres se re-relèvent, ils ne se devinent pas.
 */
export const JETONS_DE_REFERENCE = 120_000;
export const SECONDES_DE_REFERENCE = 720;
/** Au-delà de ce multiple de la référence, le critère ne rapporte plus rien. */
export const MULTIPLE_SANS_POINT = 3;

/** La fenêtre des courbes de tendance du tableau de bord. */
export const JOURS_DE_TENDANCE = 7;

/** Un critère de la note, avec ce qu'il vaut et POURQUOI. */
export interface CritereDeQualite {
  cle: 'issue' | 'memoire' | 'jetons' | 'duree';
  points: number;
  sur: number;
  /** La raison, en français, telle qu'elle s'affiche. */
  raison: string;
}

export interface NoteDeQualite {
  /** De 0 à 100. C'est une ESTIMATION, jamais une mesure. */
  note: number;
  criteres: CritereDeQualite[];
}

/** Le score d'un critère qui décroît à mesure qu'on dépasse sa référence. */
function pointsDegressifs(valeur: number, reference: number, sur: number): number {
  if (valeur <= reference) return sur;
  const plafond = reference * MULTIPLE_SANS_POINT;
  if (valeur >= plafond) return 0;
  const reste = (plafond - valeur) / (plafond - reference);
  return Math.round(reste * sur * 10) / 10;
}

/** La part du texte de mémoire que le tri a évité d'envoyer, entre 0 et 1. */
export function partEviteeParLeTri(memoire: MesureDeMemoire): number {
  const entiers = Math.max(0, memoire.signesEntiers);
  if (!entiers) return 0;
  const servis = Math.min(entiers, Math.max(0, memoire.signesServis));
  return (entiers - servis) / entiers;
}

/**
 * LA NOTE DE QUALITÉ D'UNE TÂCHE — quatre critères de 25 points, chacun avec sa
 * raison écrite. Elle ne juge pas le CODE produit (personne ne sait le faire
 * depuis une base de données) : elle juge le DÉROULÉ, c'est-à-dire les quatre
 * seules choses qu'on ait réellement mesurées — la tâche est-elle allée au
 * bout, a-t-elle ouvert la mémoire du projet, a-t-elle été sobre en jetons,
 * a-t-elle été rapide.
 */
export function noteDeQualite(mesure: MesureDeTache): NoteDeQualite {
  const criteres: CritereDeQualite[] = [];

  criteres.push(
    mesure.issue === 'terminee'
      ? { cle: 'issue', points: 25, sur: 25, raison: 'la tâche est allée au bout' }
      : mesure.issue === 'interrompue'
        ? { cle: 'issue', points: 10, sur: 25, raison: 'la tâche a été interrompue en route' }
        : { cle: 'issue', points: 0, sur: 25, raison: 'la tâche a échoué' },
  );

  const evitee = partEviteeParLeTri(mesure.memoire);
  criteres.push(
    !mesure.memoire.ouvertures
      ? { cle: 'memoire', points: 0, sur: 25, raison: 'la mémoire du projet n’a jamais été ouverte' }
      : !mesure.memoire.rendus
        ? { cle: 'memoire', points: 8, sur: 25, raison: 'la mémoire a été ouverte, mais n’a rien rendu de neuf' }
        : {
            cle: 'memoire',
            points: Math.round((15 + 10 * evitee) * 10) / 10,
            sur: 25,
            raison: `${mesure.memoire.ouvertures} ouverture${mesure.memoire.ouvertures > 1 ? 's' : ''} de mémoire, ${Math.round(evitee * 100)} % du texte évité par le tri`,
          },
  );

  const facturables = jetonsFacturables(mesure);
  criteres.push({
    cle: 'jetons',
    points: pointsDegressifs(facturables, JETONS_DE_REFERENCE, 25),
    sur: 25,
    raison: `${facturables.toLocaleString('fr-CH')} jetons facturables pour une médiane mesurée à ${JETONS_DE_REFERENCE.toLocaleString('fr-CH')}`,
  });

  criteres.push({
    cle: 'duree',
    points: pointsDegressifs(mesure.secondes, SECONDES_DE_REFERENCE, 25),
    sur: 25,
    raison: `${Math.round(mesure.secondes / 60)} min de travail machine pour une médiane mesurée à ${Math.round(SECONDES_DE_REFERENCE / 60)} min`,
  });

  const note = Math.round(criteres.reduce((total, c) => total + c.points, 0));
  return { note: Math.max(0, Math.min(100, note)), criteres };
}

/** Un point de courbe : un jour, ce qu'il a coûté et ce qu'il valait. */
export interface PointDeTendance {
  /** « 2026-08-25 ». */
  jour: string;
  taches: number;
  jetons: number;
  /** La durée machine cumulée du jour, en minutes. */
  minutes: number;
  /** La durée MOYENNE d'une tâche du jour, en minutes. */
  minutesParTache: number;
  /** La part du texte de mémoire évitée par le tri, entre 0 et 1. */
  rendementMemoire: number;
  /** La note moyenne des tâches du jour, de 0 à 100. */
  note: number;
}

/** Un jour « 2026-08-25 » depuis un instant, dans le fuseau de la machine. */
function jourDe(instant: number): string {
  const d = new Date(instant);
  const deuxChiffres = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;
}

/**
 * LES COURBES DE TENDANCE, jour par jour, du plus ancien au plus récent.
 *
 * Un jour SANS tâche garde sa place, à zéro : un trou dans une courbe se lit
 * comme une panne du relevé, alors qu'une journée creuse est une information.
 * `aujourdhui` est passé en paramètre — ce module ne lit pas l'horloge, sinon il
 * ne se testerait pas.
 */
export function tendancesParJour(
  mesures: MesureDeTache[],
  aujourdhui: number,
  jours = JOURS_DE_TENDANCE,
): PointDeTendance[] {
  const nombreDeJours = Math.max(1, Math.round(jours));
  const cases = new Map<string, MesureDeTache[]>();
  for (let i = nombreDeJours - 1; i >= 0; i -= 1) {
    cases.set(jourDe(aujourdhui - i * 24 * 3600 * 1000), []);
  }
  for (const mesure of mesures) {
    const jour = jourDe(mesure.at);
    const tas = cases.get(jour);
    if (tas) tas.push(mesure);
  }

  return [...cases.entries()].map(([jour, tas]) => {
    const jetons = tas.reduce((total, m) => total + jetonsFacturables(m), 0);
    const secondes = tas.reduce((total, m) => total + m.secondes, 0);
    const entiers = tas.reduce((total, m) => total + m.memoire.signesEntiers, 0);
    const servis = tas.reduce((total, m) => total + m.memoire.signesServis, 0);
    const notes = tas.map((m) => noteDeQualite(m).note);
    return {
      jour,
      taches: tas.length,
      jetons,
      minutes: Math.round(secondes / 60),
      minutesParTache: tas.length ? Math.round(secondes / 60 / tas.length) : 0,
      rendementMemoire: entiers ? Math.max(0, (entiers - servis) / entiers) : 0,
      note: notes.length ? Math.round(notes.reduce((t, n) => t + n, 0) / notes.length) : 0,
    };
  });
}

/** Le total de la fenêtre, pour les tuiles de tête du tableau de bord. */
export interface ResumeDeTendance {
  taches: number;
  jetons: number;
  /** La durée moyenne d'une tâche, en minutes. Zéro sans tâche. */
  minutesParTache: number;
  /** La part de mémoire évitée sur toute la fenêtre, entre 0 et 1. */
  rendementMemoire: number;
  /** La note moyenne, de 0 à 100. */
  note: number;
  /** Le temps moyen d'une ouverture de mémoire, en millisecondes. */
  memoireMs: number;
}

export function resumeDeTendance(mesures: MesureDeTache[]): ResumeDeTendance {
  if (!mesures.length) {
    return { taches: 0, jetons: 0, minutesParTache: 0, rendementMemoire: 0, note: 0, memoireMs: 0 };
  }
  const jetons = mesures.reduce((total, m) => total + jetonsFacturables(m), 0);
  const secondes = mesures.reduce((total, m) => total + m.secondes, 0);
  const entiers = mesures.reduce((total, m) => total + m.memoire.signesEntiers, 0);
  const servis = mesures.reduce((total, m) => total + m.memoire.signesServis, 0);
  const ouvertures = mesures.reduce((total, m) => total + m.memoire.ouvertures, 0);
  const ms = mesures.reduce((total, m) => total + m.memoire.millisecondes, 0);
  const notes = mesures.map((m) => noteDeQualite(m).note);
  return {
    taches: mesures.length,
    jetons,
    minutesParTache: Math.round(secondes / 60 / mesures.length),
    rendementMemoire: entiers ? Math.max(0, (entiers - servis) / entiers) : 0,
    note: Math.round(notes.reduce((t, n) => t + n, 0) / notes.length),
    memoireMs: ouvertures ? Math.round(ms / ouvertures) : 0,
  };
}

/**
 * UN SUJET DE MÉMOIRE EST UN NOM, JAMAIS UNE PHRASE.
 *
 * `project_memory` accepte n'importe quoi : un sujet (« cartes »), une branche,
 * ou des mots quelconques. Ce qui part dans la télémétrie doit rester un NOM
 * court — une demande entière recopiée telle quelle ferait entrer du texte de
 * travail dans une table de mesures, exactement ce qu'on s'interdit. On garde
 * donc le premier mot, en minuscules, borné ; tout le reste est jeté.
 */
export const LONGUEUR_MAX_SUJET = 40;

export function nomDeSujetMesure(demande: string): string {
  const propre = demande.trim().toLowerCase();
  if (!propre) return '(la carte)';
  const premier = propre.split(/[\s,;:/]+/)[0] ?? '';
  return premier.slice(0, LONGUEUR_MAX_SUJET) || '(la carte)';
}
