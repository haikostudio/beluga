import { reponseALaQuestion } from './contenu-journal.js';
import { ETAPES_DU_PARCOURS, EtapeDuParcours, LigneDuCarnet, lignesDeLEtape } from './carnet-memoire.js';
import { COLONNES_AVANT_LE_TRAVAIL, type ColumnKey } from './columns.js';
import {
  EntreeJournal,
  JALON_COMPREHENSION,
  JALON_ECARTEE_DU_LOT,
  JALON_PLAN_DEMANDE,
  JALON_PLAN_PROPOSE,
  JALON_TOUR_LANCE,
  fusionnerLesAppelsEnDouble,
  genreDAction,
  ordonnerJournal,
} from './journal-carte.js';
import type { ParcoursDeCarte, SuiviDUneFille } from './models.js';
import { PHRASES_DU_SUIVI, etatsDesPointsDeLaMere } from './regroupements.js';
import {
  comprehensionApresLePlan,
  comprehensionPourLePlan,
  comprehensionValideePourLaVersionCourante,
  type ChapitreDuParcours,
} from './parcours-carte.js';
import { EtapeDeLancement, libelleEtapeDeLancement } from './lancement-en-cours.js';
import { natureDeLaMention, type NatureDeLaMention } from './suivi-colonne.js';
import { decisionDePlanOuverte } from './plan-conversation.js';
import {
  ETAPES_DE_SUIVI,
  etapeCouranteDeSuivi,
  etatDuDeploiement,
  type CarteDeSuivi,
  type EtapeDeSuivi,
} from './frise-de-suivi.js';

/**
 * LE PARCOURS D'UNE CARTE EN CINQ POINTS — LE MODÈLE PUR.
 *
 * Le flux d'une carte se lisait ligne par action : « Tour lancé »,
 * « Commande », « Lecture », repères de phase, blocs de travail, réponses,
 * JSON — un déroulé technique imbriqué à tant de niveaux qu'on ne savait plus
 * ce qui était quoi. Un vibe codeur veut CINQ MOMENTS, et rien d'autre à
 * première vue : sa demande, ce que l'agent a compris, le plan, le travail, le
 * compte rendu. Le développeur, lui, veut pouvoir OUVRIR un point et y lire
 * les traces exactes — sans qu'elles encombrent le reste.
 *
 * Ce fichier range donc CHAQUE entrée du journal sous UN des cinq points :
 *
 *  | Point          | Ce qu'il porte                                            |
 *  | -------------- | --------------------------------------------------------- |
 *  | demande        | ce que l'utilisateur a demandé, et ses précisions         |
 *  | comprehension  | ce que l'agent a compris (versions), ses lectures         |
 *  | plan           | les versions du plan, la machine qui les a écrites        |
 *  | travail        | l'exécution : commandes, fichiers, dépôt, erreurs         |
 *  | rapport        | le compte rendu final, un par tour de travail             |
 *
 * LE FLUX EST UNE SUITE DE PASSAGES, PAS CINQ CASES QUI SE REMPLISSENT.
 *
 * Le flux ne comptait autrefois que CINQ points, un par étape, où tout
 * s'empilait : une deuxième compréhension revenait s'écrire dans le point de
 * la première, et les versions d'un plan se cachaient derrière un sélecteur.
 * On avait l'impression de REJOUER dans les étapes passées au lieu d'avancer.
 *
 * Le flux est maintenant une LISTE ORDONNÉE DE PASSAGES : on parcourt le
 * journal dans le temps, et un passage NEUF s'ouvre dès que l'étape change ou
 * qu'une itération recommence — chaque demande de l'utilisateur, chaque
 * compréhension rendue, chaque version de plan, chaque compte rendu. Une
 * demande, une compréhension, un plan, une précision, une deuxième
 * compréhension, un deuxième plan : SIX points, dans cet ordre. Une itération
 * se lit donc comme un BLOC qui s'ajoute EN BAS — demande, compréhension,
 * plan — et rien ne se réécrit jamais plus haut.
 *
 * ET LE TOUR VIVANT A SON PROPRE POINT, LUI AUSSI. Tant que le plan v2
 * s'écrit, aucun jalon ne l'annonce : c'est le passage du plan v1 qui se
 * mettait à tourner, à sa date d'hier. Un passage ANTICIPÉ est donc ouvert
 * pour le tour en cours (`avecLePassageDuTourVivant`), en bas du flux, et il
 * s'efface de lui-même dès que le tour rend ou tombe.
 *
 * La BARRE, elle, garde ses CINQ segments : elle replie les passages sur leur
 * étape et montre l'état du DERNIER passage de chacune (`barreDuParcours`).
 * Elle ne compte donc jamais les itérations, elle dit seulement où on en est.
 *
 * Une étape que rien n'a encore touchée garde un point VIDE à sa place, pour
 * qu'on voie ce qui vient — inséré à son rang, jamais à la fin.
 *
 * Chaque passage porte son ÉTAT (à venir, en cours, fait, en question, en
 * erreur), sa PHRASE simple, son RANG dans son étape, ses MOMENTS (ce qui se
 * lit dans le point ouvert), ses TRACES (repliées : le détail technique), ses
 * QUESTIONS, ses ERREURS et la MÉMOIRE que le carnet dit de son étape, rangée
 * au passage qui l'a consommée. Une question encore ouverte devient un POINT
 * JAUNE à part, inséré juste après le passage qui l'a posée : c'est là qu'elle
 * arrête l'agent.
 *
 * Règle PURE : ni base, ni disque, ni moteur. Elle se rejoue seule
 * (`server/src/test/parcours-en-points.test.ts`).
 */

export type EtatDuPoint = 'avenir' | 'encours' | 'fait' | 'question' | 'erreur';

/**
 * LA PHRASE SIMPLE DE CHAQUE POINT, SELON SON ÉTAT. C'est ce que le vibe
 * codeur lit sous le titre du point, sans rien ouvrir. Affichée telle quelle,
 * donc traduite comme le reste (`shared/src/traductions.ts`).
 */
export const PHRASES_DU_POINT: Record<EtapeDuParcours, Record<EtatDuPoint, string>> = {
  configuration: {
    avenir: 'Choisissez avec quoi la tâche va tourner.',
    encours: 'Choisissez avec quoi la tâche va tourner.',
    fait: 'Moteur, modèle et réflexion sont choisis.',
    question: 'Moteur, modèle et réflexion sont choisis.',
    erreur: 'Moteur, modèle et réflexion sont choisis.',
  },
  demande: {
    avenir: 'Dites ce que vous voulez faire.',
    encours: 'Dites ce que vous voulez faire.',
    fait: 'Votre demande est notée.',
    question: 'Votre demande est notée.',
    erreur: 'Votre demande est notée.',
  },
  comprehension: {
    avenir: 'L’agent dira ce qu’il a compris.',
    encours: 'L’agent lit le projet et comprend votre demande…',
    fait: 'L’agent a dit ce qu’il a compris.',
    question: 'L’agent a une question pour vous.',
    erreur: 'La compréhension s’est arrêtée sur une erreur.',
  },
  plan: {
    avenir: 'Un plan sera proposé quand vous le demanderez.',
    encours: 'L’agent écrit le plan…',
    fait: 'Le plan est prêt.',
    question: 'L’agent a une question avant de finir le plan.',
    erreur: 'Le plan n’est pas venu.',
  },
  preparation: {
    avenir: 'La préparation commencera au lancement.',
    encours: 'Préparation du lancement…',
    fait: 'La préparation est faite.',
    question: 'La préparation attend votre réponse.',
    erreur: 'Le lancement n’a pas pu aboutir.',
  },
  travail: {
    avenir: 'Le travail commencera au lancement.',
    encours: 'L’agent travaille sur sa branche…',
    fait: 'Le travail est fait.',
    question: 'L’agent attend votre réponse pour continuer.',
    erreur: 'Le travail s’est arrêté : reprenez-le.',
  },
  rapport: {
    avenir: 'Le compte rendu viendra à la fin.',
    encours: 'Le compte rendu s’écrit…',
    fait: 'Le compte rendu est rendu.',
    question: 'Le compte rendu attend votre réponse.',
    erreur: 'Le tour s’est interrompu avant le compte rendu.',
  },
};

/** Ce qui se lit dans un point ouvert, en plus des traces techniques. */
export type MomentDuPoint =
  /** Une demande de l'utilisateur, ou une précision. */
  | { sorte: 'demande'; entree: EntreeJournal; premiere: boolean }
  /** Une compréhension rendue par l'outil, numérotée. */
  | { sorte: 'comprehension'; entree: EntreeJournal; numero: number; derniere: boolean }
  /** Le clic « Générer le plan » (ou un affinage) : la demande de plan. */
  | { sorte: 'plan-demande'; entree: EntreeJournal }
  /** Un plan rendu, avec sa version quand l'outil l'a écrite. */
  | { sorte: 'plan'; entree: EntreeJournal; version?: number }
  /*
   * IL N'Y A PLUS DE « MESSAGE À L'AGENT » À PART. Un message humain reçu carte
   * en cours est une DEMANDE comme les autres (`etapeDeLEntree`) : il ouvre son
   * passage et se lit sous « Précision », au lieu de se ranger au milieu des
   * lectures de fichiers de l'agent.
   */
  /** Un compte rendu rendu par un agent de tâche. */
  | { sorte: 'rapport'; entree: EntreeJournal; dernier: boolean };

/** Une question posée à cette étape, répondue ou non. */
export interface QuestionDuPoint {
  entree: EntreeJournal;
  repondue: boolean;
}

/** Une erreur survenue à cette étape : un tour interrompu, un écartement du lot, un incident. */
export interface ErreurDuPoint {
  cle: string;
  texte: string;
  at: number;
  entree?: EntreeJournal;
  /** Le geste direct qui la règle, quand il y en a un. */
  action?: 'reprendre' | 'relancer' | 'repondre' | 'redemander-plan' | 'redemander-comprehension';
}

export interface PointDuParcours {
  etape: EtapeDuParcours;
  /** L'ancrage nommé du point dans le flux : c'est lui que la barre vise. */
  ancre: string;
  /** LE RANG DE CE PASSAGE DANS SON ÉTAPE : 1 pour le premier, 2 pour le suivant… */
  rang: number;
  /** Combien de passages son étape compte en tout : le dernier est celui qui vit encore. */
  total: number;
  /**
   * CE PASSAGE N'ANNONCE QUE CE QUI VIENT : il a été posé sous la dernière
   * demande pour dire l'étape à venir de cette itération
   * (`avecLaSuiteDeLIteration`). Il ne se coche jamais — sans lui, un point
   * « Travail » vide posé en bas d'une carte déjà travaillée aurait hérité de
   * l'état de son étape et affiché « Le travail est fait. » sous une demande
   * que personne n'a encore prise.
   */
  annonce?: boolean;
  /**
   * CETTE ÉTAPE EST PASSÉE SANS RIEN LAISSER : la colonne la dit franchie, mais
   * aucun contenu n'existe pour elle (`avecLeContenuDeLaCarte`). Elle ne se
   * coche pas — une coche sans rien dessous est une phrase fausse.
   */
  sautee?: boolean;
  etat: EtatDuPoint;
  phrase: string;
  /**
   * LE RÉSUMÉ ÉCRIT PAR L'AGENT, lu sous le titre SANS OUVRIR le point : ce qui
   * a été demandé, compris, ou ce qui va être fait (`resumesDuFil`). Présent,
   * il se lit À LA PLACE de la phrase fixe — sauf le plan qui attend une
   * décision, dont la consigne reste dessous. Écrit dans la langue de
   * l'utilisateur : il ne passe jamais au dictionnaire.
   */
  resume?: string;
  /** L'instant du dernier moment, pour la date sous le point. */
  at?: number;
  /** L'instant du PREMIER moment : c'est lui qui range la mémoire au bon passage. */
  debut?: number;
  moments: MomentDuPoint[];
  traces: EntreeJournal[];
  /**
   * LA RÉPONSE D'UN TOUR QUI A RÉPONDU AU LIEU DE CADRER (`reponseDuPassage`).
   * Elle est SORTIE des traces : rangée parmi les actions, elle se cachait
   * derrière « voir les N de plus », et il fallait déplier trois fois pour
   * lire ce que l'agent avait répondu. Elle se lit dans son propre cadre.
   */
  reponse?: EntreeJournal;
  questions: QuestionDuPoint[];
  erreurs: ErreurDuPoint[];
  memoire: LigneDuCarnet[];
  /**
   * LA PHRASE DE LA CARTE, posée sur le DERNIER point du flux : c'est l'issue
   * du dernier tour, et c'est là que l'œil arrive. Le tableau et le tiroir
   * disent alors la même chose, mot pour mot.
   */
  mention?: { texte: string; nature: NatureDeLaMention };
  /**
   * LES FILLES D'UNE CARTE MÈRE, sur ses points « Travail » et « Rapport »
   * (`avecLeSuiviDesFilles`) : une ligne par projet touché, avec son état et
   * de quoi ouvrir sa carte. Absent sur une carte ordinaire.
   */
  filles?: SuiviDUneFille[];
}

/**
 * L'ANCRAGE D'UN PASSAGE, écrit une fois pour l'écran et le contrôle. Le
 * PREMIER passage d'une étape garde le nom court (`point-plan`) : c'est lui que
 * la barre vise quand il n'y a rien d'autre. Les suivants portent leur rang
 * (`point-plan-2`), pour que deux plans ne se disputent jamais la même ancre.
 */
export function ancreDuPoint(etape: EtapeDuParcours, rang = 1): string {
  return rang > 1 ? `point-${etape}-${rang}` : `point-${etape}`;
}

/* ------------------------------------------------------------------ */
/* Ranger chaque entrée sous son point                                  */
/* ------------------------------------------------------------------ */

const estJalon = (entree: EntreeJournal, libelle: string) => entree.nature === 'jalon' && entree.libelle === libelle;
const estDemande = (entree: EntreeJournal) => estJalon(entree, 'Demande');
const estReponseRendue = (entree: EntreeJournal) => estJalon(entree, 'Réponse rendue');
const estTourInterrompu = (entree: EntreeJournal) => estJalon(entree, 'Tour interrompu');
const duCadrage = (entree: EntreeJournal) => entree.agentRole === 'cadrage' || entree.phase === 'cadrage' || entree.phase === 'recadrage';

/**
 * À QUEL POINT APPARTIENT UNE ENTRÉE. La règle lit la phase, le libellé du
 * jalon et le rôle de l'agent — et UN SEUL état qui court : le plan a-t-il
 * déjà été demandé ? Avant, le cadrage COMPREND ; après, il ÉCRIT LE PLAN, et
 * chaque message de l'utilisateur est un affinage. Un cadrage qui reprend une
 * carte déjà exécutée (recadrage) repart de la compréhension.
 */
export function etapeDeLEntree(entree: EntreeJournal, planDemande: boolean): EtapeDuParcours {
  if (estJalon(entree, JALON_PLAN_DEMANDE) || estJalon(entree, JALON_PLAN_PROPOSE)) return 'plan';
  if (estJalon(entree, JALON_COMPREHENSION)) return 'comprehension';
  if (estJalon(entree, JALON_ECARTEE_DU_LOT)) return 'travail';
  /*
   * UN MESSAGE HUMAIN EST TOUJOURS UNE « DEMANDE », MÊME CARTE EN COURS.
   *
   * Cette règle vivait DANS la branche du cadrage : un message envoyé pendant
   * que la carte travaillait n'y passait donc pas, tombait dans le `return
   * 'travail'` du bas, et se rangeait au milieu des lectures de fichiers et des
   * commandes de l'agent — invisible comme demande, impossible à retrouver dans
   * le flux. Ce que l'utilisateur ÉCRIT n'est jamais du travail d'agent : c'est
   * ce qui le déclenche. Elle est donc remontée devant, pour tous les rôles.
   *
   * Le passage qu'elle ouvre est neuf (`ouvreUnPassage` : le point courant est
   * « Travail », l'étape demandée « Demande »), et il se lit en bas du flux —
   * le début visible de ce que l'utilisateur vient de demander.
   */
  if (estDemande(entree)) return 'demande';
  if (duCadrage(entree)) return planDemande ? 'plan' : 'comprehension';
  if (entree.phase === 'rapport' && estReponseRendue(entree)) return 'rapport';
  return 'travail';
}

/** Une compréhension d'AVANT le plan : c'est elle qui referme la phase de compréhension. */
function ouvreLePlan(entree: EntreeJournal): boolean {
  return estJalon(entree, JALON_PLAN_DEMANDE) || estJalon(entree, JALON_PLAN_PROPOSE);
}

/**
 * UNE NOUVELLE DEMANDE REPART DE ZÉRO. Le drapeau « le plan a été demandé »
 * courait jusqu'à la fin du journal : tout ce qui suivait un plan — lectures,
 * appels d'outils, compréhension — restait donc collé à l'étape « plan ». Une
 * précision de l'utilisateur le referme : ce qui vient après est une nouvelle
 * compréhension, jusqu'à ce qu'un plan soit redemandé.
 */
function refermeLePlan(entree: EntreeJournal): boolean {
  return duCadrage(entree) && estDemande(entree);
}

/** Un recadrage repart de la compréhension : la demande de plan d'avant ne compte plus. */
function rouvreLaComprehension(entree: EntreeJournal, phasePrecedente: string | undefined): boolean {
  return entree.phase === 'recadrage' && phasePrecedente !== 'recadrage' && phasePrecedente !== undefined;
}

/** Un passage en construction : le point avant qu'on lui donne son état. */
export type PassageNu = Omit<PointDuParcours, 'etat' | 'phrase' | 'total'>;

/**
 * UNE ITÉRATION DE PLUS DANS LA MÊME ÉTAPE. Le passage courant a-t-il déjà
 * rendu ce que cette entrée apporte ? Une deuxième compréhension, une
 * deuxième version de plan, une nouvelle demande de l'utilisateur, un second
 * compte rendu : chacun OUVRE son propre passage, au lieu de venir s'empiler
 * dans celui d'avant.
 */
function ouvreUnPassage(entree: EntreeJournal, etape: EtapeDuParcours, courant: PassageNu | undefined): boolean {
  if (!courant || courant.etape !== etape) return true;
  const porte = (sorte: MomentDuPoint['sorte']) => courant.moments.some((moment) => moment.sorte === sorte);
  if (estJalon(entree, JALON_COMPREHENSION)) return porte('comprehension');
  if (estJalon(entree, JALON_PLAN_PROPOSE)) return porte('plan');
  if (estJalon(entree, JALON_PLAN_DEMANDE)) return porte('plan');
  /*
   * Une demande de l'utilisateur ouvre l'itération suivante. Une précision qui
   * suit un plan rendu ouvre donc un passage « Demande » NEUF, en bas du flux :
   * c'est le début visible de la nouvelle itération, suivi de sa compréhension
   * et de son plan. Une demande reçue CARTE EN COURS n'arrive plus ici avec
   * l'étape « travail » — elle porte la sienne (`etapeDeLEntree`) et ouvre donc
   * son propre passage, au lieu de disparaître dans le travail de l'agent.
   */
  if (estDemande(entree)) return porte('demande');
  if (estReponseRendue(entree) && etape === 'rapport') return porte('rapport');
  return false;
}

/** L'écart au-delà duquel un « Plan demandé » n'est plus celui de la demande voisine. */
const ECART_PLAN_DU_MEME_MESSAGE_MS = 2_000;

/**
 * LE PLAN DEMANDÉ AVEC UN MESSAGE SE RANGE APRÈS LA COMPRÉHENSION DE CE MESSAGE.
 *
 * L'interrupteur « Plan » demande le plan DANS LE MÊME TOUR que le message : le
 * démon notait « Plan demandé » quelques millisecondes AVANT la ligne « Demande »
 * (carte « Atelier marketing », 23.09.2026). Le passage du plan s'ouvrait donc
 * au-dessus de la nouvelle demande, collé à l'itération précédente, qui
 * semblait relancée. Même écrit après la demande (`apresLaDemande`,
 * `server/src/runtime.ts`), il précéderait encore la compréhension que ce tour
 * rend avant son plan. Un « Plan demandé » collé (juste avant ou juste après,
 * à moins de deux secondes) à une demande RÉELLE du cadrage est donc déplacé juste après la première
 * compréhension qui suit cette demande dans son itération — ou juste après la
 * demande tant qu'aucune n'est rendue. L'ordre lu devient Demande →
 * Compréhension → Plan, en bas du fil, pour les cartes déjà écrites comme
 * pour les nouvelles. Le clic « Générer le plan », sans message, ne bouge pas.
 */
export function planDemandeApresSonMessage(entrees: readonly EntreeJournal[]): EntreeJournal[] {
  const suite = [...entrees];
  const estMessage = (entree: EntreeJournal) => estDemande(entree) && duCadrage(entree) && !entree.provisoire;
  const deplaces = new Set<string>();
  for (let i = 0; i < suite.length; i += 1) {
    const jalon = suite[i];
    if (!estJalon(jalon, JALON_PLAN_DEMANDE) || deplaces.has(jalon.id)) continue;
    /* La demande VOISINE, collée au jalon : juste avant (ordre corrigé) ou
       juste après (ordre d'avant). Un plan demandé par le bouton suit une
       compréhension, jamais directement un message. */
    const collee = (j: number) =>
      j >= 0 && j < suite.length && estMessage(suite[j]) && Math.abs(suite[j].at - jalon.at) <= ECART_PLAN_DU_MEME_MESSAGE_MS;
    const voisine = collee(i + 1) ? i + 1 : collee(i - 1) ? i - 1 : -1;
    if (voisine < 0) continue;
    suite.splice(i, 1);
    const demande = voisine > i ? voisine - 1 : voisine;
    let cible = demande + 1;
    for (let j = demande + 1; j < suite.length; j += 1) {
      if (estMessage(suite[j]) || estJalon(suite[j], JALON_PLAN_PROPOSE) || estJalon(suite[j], JALON_PLAN_DEMANDE)) break;
      if (estJalon(suite[j], JALON_COMPREHENSION)) {
        cible = j + 1;
        break;
      }
    }
    suite.splice(cible, 0, jalon);
    deplaces.add(jalon.id);
    /* L'entrée a pu glisser vers l'avant : on repart d'où elle était. */
    i -= 1;
  }
  return suite;
}

/**
 * LE CONTENU DES PASSAGES, tiré du journal. Le journal est d'abord ORDONNÉ et
 * ses doubles RÉUNIS (le pont et l'étape du moteur écrivent le même appel) ;
 * puis on le parcourt DANS LE TEMPS : chaque entrée rejoint le passage ouvert,
 * et un passage neuf s'ouvre dès que l'étape change ou qu'une itération
 * recommence. Les jalons qui racontent deviennent des MOMENTS, les questions
 * des QUESTIONS, les incidents des ERREURS, tout le reste des TRACES repliées.
 *
 * Une étape que rien n'a touchée garde un passage VIDE à son rang : le flux
 * montre toujours ce qui vient.
 */
export function contenuDesPoints(
  entrees: readonly EntreeJournal[],
  carnet: readonly LigneDuCarnet[] = [],
): PassageNu[] {
  const rangs = new Map<EtapeDuParcours, number>();
  const passages: PassageNu[] = [];
  const ouvrir = (etape: EtapeDuParcours): PassageNu => {
    const rang = (rangs.get(etape) ?? 0) + 1;
    rangs.set(etape, rang);
    const passage: PassageNu = {
      etape,
      rang,
      ancre: ancreDuPoint(etape, rang),
      moments: [],
      traces: [],
      questions: [],
      erreurs: [],
      memoire: [],
    };
    passages.push(passage);
    return passage;
  };

  let planDemande = false;
  let phasePrecedente: string | undefined;
  let comprehensions = 0;
  let demandes = 0;
  let courant: PassageNu | undefined;
  /*
   * UN TOUR DE POURSUITE NE ROUVRE RIEN. Un tour coupé par la limite d'un
   * compte repart sur un autre compte : c'est le MÊME travail qui continue, pas
   * une itération de plus. Ses entrées rejoignent donc le DERNIER passage de
   * leur étape — ni nouvelle « Demande », ni nouvelle « Compréhension », et le
   * rang des passages ne bouge pas. Trois reprises enchaînées faisaient trois
   * points de plus (6/7 → 9/9) sur une carte du 06.09.2026.
   *
   * …MAIS ELLE EST BORNÉE À SON ITÉRATION. Sans borne, une poursuite renvoyait
   * le travail dans le passage d'AVANT, à sa date d'origine, même quand une
   * nouvelle demande de l'utilisateur avait été enregistrée entre-temps. Une
   * poursuite ne rejoint donc le dernier passage de son étape que si AUCUNE
   * demande n'a été écrite depuis l'ouverture de ce passage ; sinon elle ouvre
   * un passage neuf, comme un tour ordinaire.
   */
  const poursuites = new Set<string>();
  /** L'instant de la dernière demande RÉELLE vue : la borne des poursuites. */
  let derniereDemandeA = -1;
  /*
   * LES TOURS QUI ONT RENDU UN PLAN. Une compréhension écrite APRÈS le plan,
   * dans le même tour (réclamée à tort par le démon, 14.09.2026), n'est pas
   * une nouvelle itération : elle ouvrait un passage « Compréhension », puis
   * un second « Plan » vide, et l'écran croyait le cadrage repris. Elle reste
   * une trace du passage du plan. Seul un vrai message rouvre le cadrage.
   */
  const toursDePlan = new Set<string>();
  for (const entree of planDemandeApresSonMessage(fusionnerLesAppelsEnDouble(ordonnerJournal(entrees)))) {
    if (estJalon(entree, JALON_PLAN_PROPOSE) && entree.tourId) toursDePlan.add(entree.tourId);
    if (courant && estJalon(entree, JALON_COMPREHENSION) && !!entree.tourId && toursDePlan.has(entree.tourId)) {
      courant.traces.push(entree);
      continue;
    }
    if (rouvreLaComprehension(entree, phasePrecedente)) planDemande = false;
    phasePrecedente = entree.phase;
    const etape = etapeDeLEntree(entree, planDemande);
    if (ouvreLePlan(entree)) planDemande = true;
    else if (refermeLePlan(entree)) planDemande = false;
    if (poursuiteDuJalon(entree) && entree.tourId) poursuites.add(entree.tourId);
    const poursuite = !!entree.tourId && poursuites.has(entree.tourId);
    if (poursuite) {
      const dernierDeLEtape = [...passages].reverse().find((passage) => passage.etape === etape);
      /* Une demande s'est glissée depuis l'ouverture de ce passage : la
         poursuite n'a plus le droit d'y retourner, elle ouvre son propre rang. */
      const perime = !!dernierDeLEtape && (dernierDeLEtape.debut ?? 0) < derniereDemandeA;
      courant = dernierDeLEtape && !perime ? dernierDeLEtape : ouvrir(etape);
    } else if (ouvreUnPassage(entree, etape, courant)) courant = ouvrir(etape);
    const point = courant as PassageNu;
    point.at = Math.max(point.at ?? 0, entree.at);
    point.debut = Math.min(point.debut ?? entree.at, entree.at);

    if (estDemande(entree)) {
      /* La consigne de reprise n'est pas une demande de l'utilisateur : une trace. */
      if (poursuite) point.traces.push(entree);
      else {
        /* UNE PRÉCISION SE LIT, elle ne se cache plus dans les traces : c'est
           elle qui explique la version de plan qui suit. Et une demande reçue
           CARTE EN COURS se lit de la même façon : elle porte désormais l'étape
           « Demande » (`etapeDeLEntree`), au lieu du simple « message » qu'elle
           devenait au milieu du travail de l'agent. */
        demandes += 1;
        if (!entree.provisoire) derniereDemandeA = Math.max(derniereDemandeA, entree.at);
        point.moments.push({ sorte: 'demande', entree, premiere: demandes === 1 });
      }
      continue;
    }
    if (estJalon(entree, JALON_COMPREHENSION)) {
      comprehensions += 1;
      /* UNE COMPRÉHENSION PAR PASSAGE : elle s'y lit toujours dépliée, c'est le
         PASSAGE qui se referme quand le suivant s'ouvre. Une poursuite qui la
         réécrit dans le même passage remplace la précédente comme dernière. */
      for (const moment of point.moments) if (moment.sorte === 'comprehension') moment.derniere = false;
      point.moments.push({ sorte: 'comprehension', entree, numero: comprehensions, derniere: true });
      continue;
    }
    if (estJalon(entree, JALON_PLAN_DEMANDE)) {
      point.moments.push({ sorte: 'plan-demande', entree });
      continue;
    }
    if (estJalon(entree, JALON_PLAN_PROPOSE)) {
      point.moments.push({ sorte: 'plan', entree, version: versionDuJalon(entree) });
      continue;
    }
    if (estTourInterrompu(entree) || estJalon(entree, JALON_ECARTEE_DU_LOT)) {
      point.erreurs.push({
        cle: entree.id,
        texte: (entree.resultat ?? '').trim() || entree.libelle,
        at: entree.at,
        entree,
        action: etape === 'plan' ? 'redemander-plan' : etape === 'travail' || etape === 'rapport' ? 'reprendre' : 'relancer',
      });
      continue;
    }
    if (estReponseRendue(entree)) {
      if (etape === 'rapport') {
        for (const moment of point.moments) if (moment.sorte === 'rapport') moment.dernier = false;
        point.moments.push({ sorte: 'rapport', entree, dernier: true });
      } else point.traces.push(entree);
      continue;
    }
    if (entree.nature === 'requete' && genreDAction(entree) === 'question') {
      point.questions.push({ entree, repondue: reponseALaQuestion(entree.resultat) !== undefined });
      continue;
    }
    point.traces.push(entree);
  }

  const complet = avecLesEtapesManquantes(passages, rangs);
  rangerLaMemoire(complet, carnet);
  return complet;
}

/**
 * LES ÉTAPES QUE RIEN N'A TOUCHÉES gardent un passage VIDE, inséré À LEUR RANG :
 * avant le premier passage d'une étape plus tardive, sinon à la fin. Le flux
 * montre ainsi toujours ce qui vient, sans jamais le mettre dans le désordre.
 */
function avecLesEtapesManquantes(passages: PassageNu[], rangs: Map<EtapeDuParcours, number>): PassageNu[] {
  /* SAUF « PRÉPARATION » : elle n'annonce rien, elle ne vit QUE pendant qu'elle
     se fait (`avecLePassageDeLaPreparation`). Une carte jamais lancée n'a pas à
     porter un point de plus qui ne dirait rien. */
  const manquantes = new Set(
    ETAPES_DU_PARCOURS.filter((etape) => etape !== 'preparation' && !rangs.has(etape)),
  );
  if (!manquantes.size) return passages;
  const vide = (etape: EtapeDuParcours): PassageNu => ({
    etape,
    rang: 1,
    ancre: ancreDuPoint(etape, 1),
    moments: [],
    traces: [],
    questions: [],
    erreurs: [],
    memoire: [],
  });
  const resultat: PassageNu[] = [];
  for (const passage of passages) {
    const place = ETAPES_DU_PARCOURS.indexOf(passage.etape);
    for (const etape of ETAPES_DU_PARCOURS) {
      if (manquantes.has(etape) && ETAPES_DU_PARCOURS.indexOf(etape) < place) {
        resultat.push(vide(etape));
        manquantes.delete(etape);
      }
    }
    resultat.push(passage);
  }
  for (const etape of ETAPES_DU_PARCOURS) if (manquantes.has(etape)) resultat.push(vide(etape));
  return resultat;
}

/**
 * LA MÉMOIRE VA AU PASSAGE QUI L'A CONSOMMÉE, pas à tous ceux de son étape.
 * Le carnet range ses lignes « à l'étape … » ; avec plusieurs passages par
 * étape, la mémoire d'une DEUXIÈME compréhension s'afficherait sinon sous la
 * première. Chaque ligne rejoint donc le dernier passage de son étape ouvert
 * AVANT elle — à défaut, le premier.
 */
function rangerLaMemoire(passages: readonly PassageNu[], carnet: readonly LigneDuCarnet[]): void {
  if (!carnet.length) return;
  for (const etape of ETAPES_DU_PARCOURS) {
    const candidats = passages.filter((passage) => passage.etape === etape);
    if (!candidats.length) continue;
    for (const ligne of lignesDeLEtape(carnet, etape)) {
      let choisi = candidats[0];
      for (const passage of candidats) if ((passage.debut ?? 0) <= ligne.at) choisi = passage;
      choisi.memoire.push(ligne);
    }
  }
}

/**
 * CE TOUR EN POURSUIT-IL UN AUTRE ? Le jalon « Tour lancé » d'un tour de reprise
 * après limite porte `poursuiteDe` (le message du tour coupé,
 * `server/src/runtime.ts`). Toutes les entrées de ce tour partagent son
 * `tourId` : c'est par lui qu'on les rattache au point du tour poursuivi.
 */
export function poursuiteDuJalon(entree: EntreeJournal): string | undefined {
  if (!entree.donnees || !estJalon(entree, JALON_TOUR_LANCE)) return undefined;
  try {
    const lu = JSON.parse(entree.donnees) as { poursuiteDe?: unknown };
    return typeof lu.poursuiteDe === 'string' && lu.poursuiteDe ? lu.poursuiteDe : undefined;
  } catch {
    return undefined;
  }
}

/** Le numéro de version écrit sur le jalon d'un plan rendu par l'outil. */
export function versionDuJalon(entree: EntreeJournal): number | undefined {
  if (!entree.donnees) return undefined;
  try {
    const lu = JSON.parse(entree.donnees) as { version?: unknown };
    return typeof lu.version === 'number' ? lu.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * LA VERSION DU PLAN QU'UN PASSAGE « PLAN » MONTRE : un numéro, la version
 * COURANTE de la carte, ou RIEN.
 *
 * Un passage sans jalon « Plan proposé » à lui se repliait sur la version
 * courante. Pendant qu'un tour écrivait la v2, le point neuf, ouvert par le clic
 * « Générer le plan », affichait donc le plan v1 sous son propre récit — comme
 * si la v1 était la réponse de ce tour (carte « Snapshots », 09.09.2026). Un
 * passage ne montre donc QUE ce que son jalon a écrit. Le repli sur la courante
 * ne reste permis que pour un plan d'avant l'outil — un jalon sans numéro —, ou
 * pour un journal ancien où AUCUN passage ne porte de jalon « Plan proposé ».
 */
export type VersionDuPassage = number | 'courante' | null;

/**
 * …MAIS UN PLAN QUE LA CARTE CONNAÎT NE SE CACHE JAMAIS. Le journal affiché
 * peut manquer une ligne (canal coupé pendant la veille d'un téléphone) : la
 * carte savait la v3, la rangée du bas proposait « Valider le plan v3 », et
 * aucun passage ne la montrait, faute de jalon (carte #88b9, 11.09.2026). Quand
 * la plus haute version connue de la carte (`versionsConnues`) n'est portée par
 * AUCUN jalon, le DERNIER passage « Plan » sans jalon la montre.
 */
export function versionDuPassageDePlan(
  passage: Pick<PassageNu, 'etape' | 'moments'>,
  passages: readonly Pick<PassageNu, 'etape' | 'moments'>[],
  versionsConnues: readonly number[] = [],
): VersionDuPassage {
  if (passage.etape !== 'plan') return null;
  const moment = passage.moments.find((m) => m.sorte === 'plan');
  if (moment?.sorte === 'plan') return moment.version ?? 'courante';
  const jalons = passages.flatMap((autre) => autre.moments.flatMap((m) => (m.sorte === 'plan' ? [m] : [])));
  if (!jalons.length) return 'courante';
  if (!versionsConnues.length || jalons.some((m) => m.version === undefined)) return null;
  const plusHaute = Math.max(...versionsConnues);
  if (jalons.some((m) => m.version === plusHaute)) return null;
  const sansJalon = passages.filter((autre) => autre.etape === 'plan' && !autre.moments.some((m) => m.sorte === 'plan'));
  return sansJalon[sansJalon.length - 1] === passage ? plusHaute : null;
}

/* ------------------------------------------------------------------ */
/* L'état de chaque point                                               */
/* ------------------------------------------------------------------ */

export interface ContexteDesPoints {
  /** Le chapitre décidé par `chapitreDuParcours` (`parcours-carte.ts`). */
  chapitre: ChapitreDuParcours;
  /**
   * CE QUE LA CARTE PORTE ELLE-MÊME, pour les étapes dont le journal ne dit
   * rien (`avecLeContenuDeLaCarte`) : sa description tient lieu de demande,
   * l'analyse jointe à sa proposition de compréhension.
   */
  descriptionDeLaCarte?: string;
  analyseDeLaCarte?: string;
  /** L'instant de création de la carte : la date de sa demande reconstituée. */
  creeeA?: number;
  colonne: ColumnKey;
  tourEnCours: boolean;
  parcours?: Pick<
    ParcoursDeCarte,
    'comprehension' | 'plans' | 'planDemandeA' | 'incident' | 'planValide' | 'issueDuTour' | 'cadrageRouvertA'
  > | null;
  /**
   * LES QUESTIONS ENCORE OUVERTES DANS LE FIL (`questionsOuvertesDuFil`),
   * quand l'écran les connaît : c'est le fil qui fait foi sur ce qui attend
   * une réponse, le journal n'en garde que la trace. À zéro, aucune question
   * n'arrête plus personne, même si sa trace n'a pas reçu de réponse.
   */
  questionsOuvertes?: number;
  /**
   * L'ÉTAT EST-IL PÉRIMÉ (canal coupé, état pas encore redemandé) ? Alors
   * `tourEnCours` ne prouve plus rien : il n'ouvre plus de passage « en train
   * de tourner ». Ce qui vient du SERVEUR (`planDemandeA`) reste, lui, cru : il
   * a été écrit sur la carte, pas déduit à l'écran.
   */
  etatPerime?: boolean;
  /**
   * L'AGENT QUI TIENT LA CARTE et LE CODE DÉJÀ ENREGISTRÉ : deux constats qui
   * disent qu'un plan n'est PLUS à décider (`travailDeLaCarteDejaLance`). Sans
   * eux, le point « Plan » inviterait à valider un plan déjà exécuté.
   */
  agentDeLaCarte?: string;
  codeDejaEnregistre?: boolean;
  /**
   * LA MARQUE DE VOL DE LA CARTE : l'instant du clic sur « Lancer ». Elle date
   * le moment « Préparation » quand aucun signal d'étape n'est arrivé — page
   * ouverte en cours de route, second appareil, rechargement.
   */
  tourEnVolDepuis?: number;
  /**
   * L'ÉTAPE DE PRÉPARATION EN COURS, quand le client l'a reçue
   * (`card.lancement`, `shared/src/lancement-en-cours.ts`). Elle n'est jamais
   * enregistrée : son absence ne prouve rien, elle enlève seulement le détail.
   */
  lancement?: EtapeDeLancement;
  /**
   * LE TOUR NE S'EST PAS RENDU JUSQU'AU BOUT (`tourNonAbouti`,
   * `shared/src/parcours-carte.ts`) : des lignes de la liste de tâches n'ont
   * jamais été faites, ou le dernier tour s'est mal terminé. Les points
   * « Travail » et « Rapport » cessent alors de se cocher tout seuls.
   */
  tourNonAbouti?: boolean;
  /**
   * LE DERNIER TOUR DE L'AGENT EST TOMBÉ (échec, arrêt), et UNE DÉCISION DE
   * TOUR ATTEND (« Renvoyer ma demande / Ignorer / Arrêter », ou le choix d'un
   * compte — `decisionsEnAttente`). Ensemble, ils disent qu'un tour de CADRAGE
   * est tombé : l'étape qui tournait (Compréhension, Plan) passe en erreur au
   * lieu de tourner à vide. La décision tranchée, l'étape se calme — le renvoi
   * rouvre un tour vivant, « Ignorer » la laisse à venir.
   */
  dernierTourEnEchec?: boolean;
  decisionDeTourOuverte?: boolean;
  /**
   * LA PHRASE PORTÉE PAR LA CARTE (`card.sansModification`).
   *
   * Elle ne se lisait QUE sur la vignette du tableau : on y voyait « Travail
   * retrouvé après une interruption », on ouvrait la carte, et le tiroir n'en
   * disait pas un mot — il montrait seulement l'erreur du tour. Les deux
   * mondes racontaient deux histoires différentes de la même carte. La phrase
   * suit donc la carte jusque dans son parcours, avec le TON que sa nature lui
   * donne (`natureDeLaMention`) : un travail acquis, une attente, un constat.
   */
  mentionDeLaCarte?: string | null;
  /**
   * LE RELEVÉ DES FILLES D'UNE CARTE MÈRE (`card.suiviDesFilles`). La mère ne
   * lance aucun agent : ses points « Travail » et « Rapport » se lisent sur
   * ses filles, au lieu de se dire « sautée ».
   */
  suiviDesFilles?: readonly SuiviDUneFille[] | null;
}

/**
 * L'ÉTAPE COURANTE, lue sur le chapitre : le cadrage est la compréhension dès
 * qu'une demande existe, la demande avant, et le plan dès qu'il est demandé ;
 * les autres chapitres portent leur nom.
 */
export function etapeCourante(
  chapitre: ChapitreDuParcours,
  aUneDemande: boolean,
  planDemande = false,
  repriseDuCadrage = false,
): EtapeDuParcours {
  if (chapitre === 'cadrage') {
    if (planDemande) return 'plan';
    return aUneDemande ? 'comprehension' : 'demande';
  }
  /*
   * LE CADRAGE A REPRIS APRÈS UN PLAN RENDU. Le chapitre reste « plan » — une
   * version existe sur la carte —, mais ce qui se joue maintenant est une
   * nouvelle COMPRÉHENSION : plus aucune consigne d'affinage ne part toute
   * seule (`server/src/runtime.ts`), et le point qui tourne doit être celui de
   * l'étape réellement en cours, jamais le plan déjà rendu.
   */
  if (chapitre === 'plan' && !planDemande && repriseDuCadrage) return 'comprehension';
  return chapitre;
}

/**
 * LE FLUX A-T-IL REPRIS APRÈS SON DERNIER PLAN ? Vrai dès qu'une demande ou
 * une compréhension s'écrit après le dernier passage « Plan ». C'est le
 * journal qui fait foi ; les dates de la carte (`comprehensionApresLePlan`)
 * prennent le relais quand le journal a été purgé.
 */
export function repriseDuCadrageApresLePlan(etapes: readonly EtapeDuParcours[]): boolean {
  const dernierPlan = etapes.lastIndexOf('plan');
  if (dernierPlan < 0) return false;
  return etapes.slice(dernierPlan + 1).some((etape) => etape === 'demande' || etape === 'comprehension');
}

/**
 * LE TOUR VIVANT OUVRE SON PROPRE PASSAGE, EN BAS DU FLUX.
 *
 * L'état « en cours » se posait sur le DERNIER passage EXISTANT de l'étape.
 * Pendant l'écriture d'un deuxième plan, c'était donc le point du plan DÉJÀ
 * RENDU — plus haut dans la ligne de temps, à sa date d'hier — qui se mettait
 * à tourner avec « L'agent écrit le plan… ». Rien ne disait qu'une NOUVELLE
 * réflexion avait commencé, et l'ancien plan avait l'air de se réécrire.
 *
 * Un passage ANTICIPÉ s'ouvre donc à la FIN du flux — après tout ce qui s'est
 * vraiment passé, avant les points encore vides qui annoncent la suite — dès
 * que le dernier passage de l'étape a DÉJÀ rendu ce que le tour est en train de
 * refaire. Le passage précédent redevient calme, à sa date, à l'état « fait ».
 *
 * ET CELA VAUT POUR LE TRAVAIL ET LE RAPPORT, PAS SEULEMENT POUR LE PLAN. Une
 * nouvelle demande posée après un compte rendu rendu faisait retourner le
 * PREMIER point « Travail », à sa date d'origine, à l'état « en cours » : le
 * travail de la deuxième demande avait l'air de réécrire celui de la première,
 * plus haut dans la ligne de temps (captures du 12.09.2026). Chaque itération
 * ouvre donc ses propres points « Travail » et « Rapport », en bas du flux.
 *
 * Il n'a AUCUNE entrée de journal derrière lui : il vit tant que le tour vit.
 * Le plan rendu (`rendre_plan`) efface `planDemandeA` et écrit son jalon, un
 * tour arrêté ou tombé l'efface aussi — le point anticipé disparaît alors de
 * lui-même, et le passage réel prend sa place. Jamais deux points pour une
 * seule version.
 */
const estVide = (passage: PassageNu): boolean =>
  !passage.moments.length && !passage.traces.length && !passage.questions.length && !passage.erreurs.length;

const ETAPES_DU_TOUR_VIVANT = ['comprehension', 'travail', 'rapport'] as const;

/**
 * LE DERNIER PASSAGE D'UNE ÉTAPE A-T-IL DÉJÀ RENDU CE QUE LE TOUR RECOMMENCE ?
 *
 * Le critère change avec l'étape. La compréhension, le plan et le rapport
 * laissent chacun un MOMENT sur leur passage : sa présence suffit. Le TRAVAIL,
 * lui, n'en laisse aucun — il n'écrit que des traces et des erreurs. On juge
 * donc sur le fait qu'une DEMANDE de l'utilisateur a été enregistrée depuis
 * l'ouverture de ce passage : c'est la nouvelle demande qui ouvre l'itération,
 * pas le simple fait qu'un tour tourne.
 */
function passageDejaRendu(
  dernier: PassageNu,
  etape: EtapeDuParcours,
  passages: readonly PassageNu[],
): boolean {
  /* UN PASSAGE VIDE N'A RIEN RENDU. Une étape que rien n'a touchée porte déjà
     son passage annoncé (`avecLesEtapesManquantes`) : c'est LUI que le tour
     remplit, il ne faut pas en ouvrir un second par-dessus. */
  if (estVide(dernier)) return false;
  if (etape === 'travail') return demandeApres(passages, dernier.debut ?? dernier.at ?? 0);
  const sorte: MomentDuPoint['sorte'] = etape === 'plan' ? 'plan' : etape === 'rapport' ? 'rapport' : 'comprehension';
  return dernier.moments.some((moment) => moment.sorte === sorte);
}

/** Une demande RÉELLE de l'utilisateur enregistrée après cet instant ? */
function demandeApres(passages: readonly PassageNu[], at: number): boolean {
  return passages.some(
    (passage) =>
      passage.etape === 'demande' &&
      (passage.debut ?? 0) > at &&
      passage.moments.some((moment) => moment.sorte === 'demande' && !moment.entree.provisoire),
  );
}

function avecLePassageDuTourVivant(
  passages: PassageNu[],
  ctx: ContexteDesPoints,
  courante: EtapeDuParcours,
): PassageNu[] {
  const tourCru = !!ctx.tourEnCours && !ctx.etatPerime;
  const planEnRoute = !!ctx.parcours?.planDemandeA || (courante === 'plan' && tourCru);
  const etape: EtapeDuParcours | undefined = planEnRoute
    ? 'plan'
    : tourCru && (ETAPES_DU_TOUR_VIVANT as readonly string[]).includes(courante)
      ? courante
      : undefined;
  if (!etape) return passages;
  /* Un incident non levé se lit sur le passage du plan : il ne faut pas en
     ouvrir un neuf par-dessus, sinon l'erreur passerait à la trappe. */
  if (etape === 'plan' && ctx.parcours?.incident?.texte) return passages;
  const memes = passages.filter((passage) => passage.etape === etape);
  const dernier = memes[memes.length - 1];
  /* Le dernier passage n'a encore rien rendu : c'est LUI qui tourne. */
  if (dernier && !passageDejaRendu(dernier, etape, passages)) return passages;
  /*
   * UN PLAN RENDU SANS NOUVELLE DEMANDE N'OUVRE PAS DE SECOND POINT. Le tour
   * qui vient de rendre son plan vit encore quelques instants — la relance
   * « Compréhension réclamée » tourne après `rendre_plan`, chapitre « plan » —
   * et le seul fait qu'un tour tourne ouvrait un point « L'agent écrit le
   * plan… » juste sous « Le plan est prêt », à la même minute (capture du
   * 14.09.2026). Une nouvelle version ne s'annonce QUE par sa demande
   * (`planDemandeA`), jamais par un tour vivant.
   */
  if (etape === 'plan' && dernier && !ctx.parcours?.planDemandeA) return passages;
  const rang = (dernier?.rang ?? 0) + 1;
  const debut =
    etape === 'plan' && ctx.parcours?.planDemandeA
      ? ctx.parcours.planDemandeA
      : passages.reduce((haut, passage) => Math.max(haut, passage.at ?? 0), 0) || undefined;
  const neuf: PassageNu = {
    etape,
    rang,
    ancre: ancreDuPoint(etape, rang),
    at: debut,
    debut,
    moments: [],
    traces: [],
    questions: [],
    erreurs: [],
    memoire: [],
  };
  /*
   * IL SE POSE APRÈS TOUT CE QUI S'EST VRAIMENT PASSÉ, et avant les points
   * encore VIDES qui annoncent la suite (« Travail », « Rapport »). On ne peut
   * plus se fier à l'ordre des étapes : depuis qu'une itération rouvre
   * « Demande », le flux remonte les étapes en cours de route.
   */
  const suite = [...passages];
  let apres = suite.length;
  while (apres > 0 && estVide(suite[apres - 1])) apres -= 1;
  suite.splice(apres, 0, neuf);
  return suite;
}

/**
 * LE MOMENT « PRÉPARATION », POSÉ DÈS LE CLIC.
 *
 * Aucune entrée de journal ne le porte : entre le clic et le premier mot du
 * moteur, le démon ne raconte rien à la carte — il diffuse seulement l'étape
 * franchie, qui n'est jamais enregistrée. Le passage est donc SYNTHÉTIQUE,
 * ouvert tant que le chapitre dit « préparation » et refermé au premier mot du
 * moteur, où « Travail » prend le relais. Il se pose à la FIN de ce qui s'est
 * vraiment passé, avant les points encore vides qui annoncent la suite.
 */
function avecLePassageDeLaPreparation(passages: PassageNu[], ctx: ContexteDesPoints): PassageNu[] {
  if (ctx.chapitre !== 'preparation') return passages;
  const debut = ctx.tourEnVolDepuis || passages.reduce((haut, passage) => Math.max(haut, passage.at ?? 0), 0) || undefined;
  const neuf: PassageNu = {
    etape: 'preparation',
    rang: 1,
    ancre: ancreDuPoint('preparation', 1),
    at: debut,
    debut,
    moments: [],
    traces: [],
    questions: [],
    erreurs: [],
    memoire: [],
  };
  /*
   * IL SE POSE APRÈS TOUT CE QUI S'EST VRAIMENT PASSÉ, et avant les points
   * encore VIDES qui annoncent la suite — mais JAMAIS au-dessus de son propre
   * rang. Sur une carte dont le journal est vide (carte du chef, journal
   * purgé), tous les passages sont vides : la préparation remontait alors en
   * TÊTE du flux, avant même la configuration, comme si elle avait précédé la
   * demande.
   */
  const suite = [...passages];
  const rangDeLaPreparation = ETAPES_DU_PARCOURS.indexOf('preparation');
  let apres = suite.length;
  while (
    apres > 0 &&
    estVide(suite[apres - 1]) &&
    ETAPES_DU_PARCOURS.indexOf(suite[apres - 1].etape) > rangDeLaPreparation
  )
    apres -= 1;
  suite.splice(apres, 0, neuf);
  return suite;
}

/**
 * LA SUITE DE L'ITÉRATION S'ANNONCE SOUS SA DEMANDE.
 *
 * `avecLesEtapesManquantes` n'insère un passage vide que pour les étapes que
 * RIEN n'a touchées de TOUT le journal. Conséquence : une fois un premier
 * travail fait, une nouvelle demande posée en bas du flux n'était plus suivie
 * d'aucun point — le flux s'arrêtait sur la demande, et rien ne disait ce qui
 * allait venir tant que le moteur n'avait pas parlé.
 *
 * On raisonne donc PAR ITÉRATION : ce qui suit la dernière demande. Les étapes
 * qui viennent APRÈS la plus avancée de cette itération, et que la carte a
 * DÉJÀ traversées au moins une fois, reçoivent leur passage annoncé, à leur
 * rang, en bas du flux. Se limiter aux étapes déjà traversées évite d'annoncer
 * un plan à une carte qui n'en a jamais eu.
 *
 * « Préparation » n'est jamais annoncée : elle ne vit que pendant qu'elle se
 * fait (`avecLePassageDeLaPreparation`).
 */
function avecLaSuiteDeLIteration(passages: PassageNu[]): PassageNu[] {
  let depart = -1;
  passages.forEach((passage, index) => {
    /* Une demande RÉELLEMENT écrite : l'écho local d'un envoi (`provisoire`)
       n'ouvre pas encore d'itération, comme partout ailleurs. */
    if (passage.etape === 'demande' && passage.moments.some((moment) => !moment.entree.provisoire)) depart = index;
  });
  if (depart < 0) return passages;
  const iteration = passages.slice(depart + 1);
  /* L'étape la plus avancée de l'itération : la demande elle-même à défaut. */
  let plusAvancee = ETAPES_DU_PARCOURS.indexOf('demande');
  for (const passage of iteration) plusAvancee = Math.max(plusAvancee, ETAPES_DU_PARCOURS.indexOf(passage.etape));
  /* Les étapes que la carte a RÉELLEMENT traversées : un passage vide ne
     compte pas, sinon une carte de cadrage annoncerait un plan qu'elle n'a
     jamais eu, simplement parce qu'un point vide en portait déjà le nom. */
  const traversees = new Set(passages.filter((passage) => !estVide(passage)).map((passage) => passage.etape));
  const suite = [...passages];
  for (const etape of ETAPES_DU_PARCOURS) {
    if (etape === 'preparation') continue;
    if (ETAPES_DU_PARCOURS.indexOf(etape) <= plusAvancee) continue;
    if (!traversees.has(etape)) continue;
    const rang = suite.reduce((haut, passage) => (passage.etape === etape ? Math.max(haut, passage.rang) : haut), 0) + 1;
    suite.push({
      etape,
      rang,
      ancre: ancreDuPoint(etape, rang),
      annonce: true,
      moments: [],
      traces: [],
      questions: [],
      erreurs: [],
      memoire: [],
    });
  }
  return suite;
}

/**
 * CE QUE LA PRÉPARATION EST EN TRAIN DE FAIRE, en une phrase. Le détail vient
 * du signal d'étape quand il est arrivé (« Vérification des accès et de la
 * place »), sinon on s'en tient à la phrase générale : une page ouverte en
 * cours de route ne reçoit pas les étapes déjà passées.
 */
export function phraseDeLaPreparation(etape?: EtapeDeLancement): string {
  if (!etape) return PHRASES_DU_POINT.preparation.encours;
  return `${libelleEtapeDeLancement(etape)}…`;
}

/**
 * CE QUE DIT LE POINT « COMPRÉHENSION » D'UN TOUR QUI A RÉPONDU.
 *
 * L'agent de cadrage a désormais deux fins de tour (`ISSUES_DE_TOUR_DE_CADRAGE`,
 * `shared/src/cadrage.ts`) : cadrer un travail, ou RÉPONDRE à une question, en
 * texte libre dans le fil et sans aucun jalon. La seconde ne pose rien sur la
 * carte — et le point restait donc à tourner sur « L'agent lit le projet et
 * comprend votre demande… », des heures après un tour parfaitement terminé.
 */
export const PHRASE_COMPREHENSION_REPONDUE = 'L’agent a répondu à votre question.';

/**
 * CE PASSAGE EST-IL UN TOUR DE RÉPONSE SEULE ? Il porte une réponse rendue —
 * rangée en TRACE, parce qu'un jalon de rapport du cadrage tombe sous l'étape
 * « Compréhension » (`etapeDeLEntree`) — et aucune compréhension. Autrement
 * dit : le tour est allé au bout, il n'avait simplement rien à cadrer.
 */
export function tourDeReponseSeule(
  passage: Pick<PassageNu, 'moments' | 'traces'>,
  parcours?: Pick<ParcoursDeCarte, 'issueDuTour'> | null,
): boolean {
  if (passage.moments.some((moment) => moment.sorte === 'comprehension')) return false;
  /*
   * L'ISSUE ÉCRITE PASSE DEVANT LA DÉDUCTION. Le démon écrit désormais, à la
   * fermeture de chaque tour de cadrage, s'il a CADRÉ ou RÉPONDU
   * (`shared/src/tour-de-cadrage.ts`). La recherche d'une trace de réponse
   * rendue reste en second, pour les cartes d'avant : c'est elle qui échouait
   * dès qu'un jalon manquait, et laissait le passage allumé pour toujours.
   */
  if (parcours?.issueDuTour?.issue === 'reponse') return true;
  return passage.traces.some((trace) => estReponseRendue(trace));
}

/**
 * LA RÉPONSE D'UN TOUR-QUESTION, À LIRE SANS DÉPLIER.
 *
 * Un tour de cadrage qui RÉPOND rend son texte dans une trace « Réponse
 * rendue », rangée parmi les actions du passage : le récit en faisait un carton
 * comme les autres, et le plafond le cachait derrière « voir les N de plus »
 * (cartes #f9af et #7430). La règle rend cette trace — la DERNIÈRE, c'est le
 * texte final du tour — pour qu'elle sorte du récit et se lise dans un cadre.
 *
 * Rien pour un tour qui a CADRÉ (sa compréhension est déjà son cadre), ni pour
 * un passage hors « Compréhension », ni pour une réponse vide.
 */
export function reponseDuPassage(
  passage: Pick<PassageNu, 'etape' | 'moments' | 'traces'>,
  parcours?: Pick<ParcoursDeCarte, 'issueDuTour'> | null,
): EntreeJournal | undefined {
  if (passage.etape !== 'comprehension' || !tourDeReponseSeule(passage, parcours)) return undefined;
  const reponses = passage.traces.filter((trace) => estReponseRendue(trace) && (trace.resultat ?? '').trim());
  return reponses[reponses.length - 1];
}

/** Le cadre qui referme un passage : ce que l'agent a RENDU, et qu'on vient lire. */
export type BlocDeFin = 'reponse' | 'comprehension' | 'plan';

/**
 * LE BLOC DE FIN D'UN PASSAGE, s'il en porte un : la réponse d'un tour-question,
 * la compréhension d'un tour cadré, ou la version de plan rendue. C'est lui qui
 * s'ouvre d'office, que l'écran vise par son DÉBUT, et devant lequel la
 * réflexion se replie.
 */
export function blocDeFinDuPassage(
  passage: Pick<PointDuParcours, 'etape' | 'moments' | 'reponse'>,
): { sorte: BlocDeFin; cle: string } | null {
  if (passage.etape === 'comprehension') {
    if (passage.reponse) return { sorte: 'reponse', cle: passage.reponse.id };
    const comprise = [...passage.moments].reverse().find((moment) => moment.sorte === 'comprehension');
    return comprise ? { sorte: 'comprehension', cle: comprise.entree.id } : null;
  }
  if (passage.etape === 'plan') {
    const plan = [...passage.moments].reverse().find((moment) => moment.sorte === 'plan');
    return plan ? { sorte: 'plan', cle: plan.entree.id } : null;
  }
  return null;
}

/**
 * LA RÉFLEXION SE REPLIE DEVANT LA RÉPONSE. Quand un passage « Compréhension »
 * a rendu son bloc de fin, ses cartons d'actions passent derrière UNE ligne
 * « Réflexion » : la réponse se lit en tête, le détail reste à un clic.
 */
export function reflexionRepliee(passage: Pick<PointDuParcours, 'etape' | 'moments' | 'reponse'>): boolean {
  const bloc = blocDeFinDuPassage(passage);
  return !!bloc && bloc.sorte !== 'plan';
}

/**
 * LE BLOC QUE L'ÉCRAN VISE QUAND IL EST RENDU : celui du DERNIER passage qui
 * raconte quelque chose. Un passage annoncé ou vide (« Travail » à venir) ne
 * compte pas ; un bloc d'un passage dépassé ne se vise plus — c'est la suite
 * qu'on lit. Sa `cle` change à chaque rendu neuf : c'est elle qui déclenche le
 * défilement, une seule fois.
 */
export function blocDeFinAViser(
  points: readonly PointDuParcours[],
): { ancre: string; sorte: BlocDeFin; cle: string } | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point.annonce) continue;
    const raconte = point.moments.length > 0 || point.traces.length > 0 || !!point.reponse || point.erreurs.length > 0;
    if (!raconte) continue;
    const bloc = blocDeFinDuPassage(point);
    return bloc ? { ancre: point.ancre, ...bloc } : null;
  }
  return null;
}

/**
 * LES PASSAGES, AVEC LEUR ÉTAT ET LEUR PHRASE. L'ordre des ÉTAPES décide
 * d'abord — fait avant l'étape courante, à venir après — puis le rang du
 * passage : un passage qui n'est PAS le dernier de son étape est un passage
 * PASSÉ, donc fait ; seul le dernier de chaque étape est encore vivant et
 * s'affine sur ce qu'il porte (une question ouverte le met en jaune, une
 * erreur non levée en rouge, un plan demandé en cours, une compréhension
 * rendue faite même si c'est l'étape courante — l'agent attend qu'on demande
 * le plan).
 */
export function pointsDuParcours(
  entrees: readonly EntreeJournal[],
  ctx: ContexteDesPoints,
  carnet: readonly LigneDuCarnet[] = [],
): PointDuParcours[] {
  let passages = contenuDesPoints(entrees, carnet);
  if (ctx.questionsOuvertes === 0) {
    for (const passage of passages) for (const question of passage.questions) question.repondue = true;
  }
  /* LE POINT « DEMANDE » NE LIT QUE CE QUI EST ÉCRIT : l'écho local d'un envoi
     (`provisoire`) se lit dans le flux, mais n'avance aucun point tant que le
     démon n'a pas enregistré la demande. */
  const aUneDemande =
    passages.some(
      (passage) => passage.etape === 'demande' && passage.moments.some((moment) => !moment.entree.provisoire),
    ) ||
    /*
     * CE QUE LA CARTE PORTE VAUT UN JALON PERDU. Une compréhension rendue, ou
     * une issue de tour écrite, PROUVE qu'une demande a bien été faite : on ne
     * comprend pas une demande qui n'existe pas. Sans cela, un jalon
     * « Demande » manquant — tour coupé, journal purgé — laissait le point
     * « Demande » en cours POUR TOUJOURS et l'étape « Compréhension » à
     * « à venir », pendant que le bouton « Générer le plan », qui lit la
     * carte, s'allumait juste en dessous. Les deux affichages lisent
     * désormais le MÊME fait.
     */
    !!ctx.parcours?.comprehension?.texte?.trim() ||
    !!ctx.parcours?.issueDuTour ||
    !!ctx.parcours?.incident;
  const reprise =
    repriseDuCadrageApresLePlan(passages.map((passage) => passage.etape)) || comprehensionApresLePlan(ctx.parcours);
  const courante = etapeCourante(ctx.chapitre, aUneDemande, !!ctx.parcours?.planDemandeA, reprise);
  /* LE TOUR VIVANT OUVRE SON PROPRE PASSAGE, EN BAS DU FLUX (voir plus bas). */
  const avant = passages.length;
  passages = avecLePassageDuTourVivant(passages, ctx, courante);
  /* ET LA PRÉPARATION OUVRE LE SIEN, entre le clic et le premier mot du moteur. */
  passages = avecLePassageDeLaPreparation(passages, ctx);
  if (carnet.length && passages.length !== avant) {
    /* La mémoire lue PENDANT ce tour appartient au passage qui tourne, pas au
       précédent : on la range une seconde fois, sur le flux complet. */
    for (const passage of passages) passage.memoire = [];
    rangerLaMemoire(passages, carnet);
  }
  /* ET LA SUITE DE L'ITÉRATION S'ANNONCE SOUS SA DEMANDE — après le rangement
     de la mémoire : un passage annoncé n'a consommé aucun morceau de carnet. */
  passages = avecLaSuiteDeLIteration(passages);
  const rang = ETAPES_DU_PARCOURS.indexOf(courante);
  const plans = ctx.parcours?.plans?.length ?? 0;
  const derniereErreur = derniereErreurDuJournal(entrees);
  /* Combien de passages chaque étape compte, et lequel est le dernier. */
  const totaux = new Map<EtapeDuParcours, number>();
  for (const passage of passages) totaux.set(passage.etape, Math.max(totaux.get(passage.etape) ?? 0, passage.rang));

  const points: PointDuParcours[] = passages.map((point) => {
    const index = ETAPES_DU_PARCOURS.indexOf(point.etape);
    const total = totaux.get(point.etape) ?? 1;
    /* UN PASSAGE ANNONCÉ NE SE COCHE JAMAIS : il dit ce qui vient, rien de
       plus. Sans cela, un « Travail » posé sous une nouvelle demande héritait
       de l'état de son étape et affichait « Le travail est fait. » avant que
       quiconque ait repris la carte. */
    if (point.annonce) {
      return { ...point, total, etat: 'avenir' as EtatDuPoint, phrase: PHRASES_DU_POINT[point.etape].avenir, erreurs: [] };
    }
    const dernier = point.rang === total;
    let etat: EtatDuPoint = index < rang ? 'fait' : index === rang ? 'encours' : 'avenir';

    /* UN PASSAGE DÉPASSÉ EST UN PASSAGE FAIT : la deuxième compréhension ne
       laisse pas la première « en cours ». */
    if (!dernier) etat = 'fait';
    else {
      /* UNE DEMANDE DÉPASSÉE EST UNE DEMANDE FAITE : quand le TRAVAIL tourne,
         le point « Demande » ne peut pas rester « en cours », même si le
         journal n'a pas (encore) livré son jalon. */
      if (point.etape === 'demande') etat = aUneDemande || index < rang ? 'fait' : 'encours';
      if (point.etape === 'comprehension' && courante === 'comprehension') {
        const rendue = !!ctx.parcours?.comprehension?.texte?.trim() || point.moments.some((m) => m.sorte === 'comprehension');
        /* UN TOUR QUI A RÉPONDU AU LIEU DE CADRER EST UN TOUR FINI. */
        etat = ctx.tourEnCours || (!rendue && !tourDeReponseSeule(point, ctx.parcours)) ? 'encours' : 'fait';
        /* LE TOUR DE COMPRÉHENSION EST TOMBÉ : plus rien ne tourne. L'étape le
           dit tant que la décision du bas attend, puis retombe « à venir » —
           jamais un « L'agent lit le projet… » sur un agent à l'arrêt. */
        if (etat === 'encours' && !ctx.tourEnCours && ctx.dernierTourEnEchec) {
          etat = ctx.decisionDeTourOuverte ? 'erreur' : 'avenir';
        }
      }
      /* LA COMPRÉHENSION MANQUÉE SE LIT SUR SON POINT, pas sur celui du plan :
         l'incident nommé par la relance porte l'étape qu'il vise, et il la
         rougit quelle que soit l'étape courante — une carte dont AUCUNE
         compréhension n'a jamais été rendue reste, elle, à l'étape d'avant. */
      if (point.etape === 'comprehension' && ctx.parcours?.incident?.etape === 'comprehension') etat = 'erreur';
      if (point.etape === 'plan') {
        /* Un plan déjà rendu sur ce passage ne se remet pas à tourner sous un
           tour qui vit encore : seule une nouvelle demande le rouvre. */
        const renduIci = point.moments.some((m) => m.sorte === 'plan');
        if (ctx.parcours?.planDemandeA || (courante === 'plan' && ctx.tourEnCours && !renduIci)) etat = 'encours';
        /* UN PLAN DÉJÀ RENDU RESTE FAIT, même quand le cadrage a repris
           derrière lui : l'étape courante redescend alors à la compréhension,
           mais une version écrite sur la carte n'est pas « à venir ». */
        else if (plans > 0) etat = 'fait';
        else if (index > rang) etat = 'avenir';
        /* Un incident qui vise la COMPRÉHENSION ne rougit pas le plan : c'est
           l'étape d'avant qui a manqué son rendez-vous. Une carte d'avant, dont
           l'incident ne nomme aucune étape, garde l'ancien comportement. */
        if (ctx.parcours?.incident?.texte && ctx.parcours.incident.etape !== 'comprehension') etat = 'erreur';
      }
      if (point.etape === 'travail' && courante === 'travail') {
        if (ctx.tourEnCours) etat = 'encours';
        else if (COLONNES_AVANT_LE_TRAVAIL.includes(ctx.colonne)) etat = 'erreur';
        else etat = derniereErreur && derniereErreur.etape === 'travail' ? 'erreur' : 'encours';
      }
      if (point.etape === 'rapport' && courante === 'rapport') {
        const rendu = point.moments.some((m) => m.sorte === 'rapport');
        etat = rendu ? 'fait' : derniereErreur ? 'erreur' : ctx.tourEnCours ? 'encours' : 'fait';
      }
      /*
       * UN TOUR QUI NE S'EST PAS RENDU JUSQU'AU BOUT NE COCHE RIEN.
       *
       * Le chapitre « rapport » se déduisait de la seule colonne : une carte
       * restée dans « En cours » sans tour vivant affichait « Le travail est
       * fait. » puis « Le compte rendu est rendu. » — au-dessus d'une liste de
       * tâches qui disait, elle, que deux lignes n'avaient jamais été faites.
       *
       * Le point « Travail » prend donc son état d'erreur, qui existait déjà et
       * n'était jamais choisi ici. Le point « Rapport » ne le prend QUE si
       * aucun compte rendu n'a été écrit : un rapport réellement rendu reste
       * rendu — une phrase de carte ne dit jamais le contraire de ce qui s'est
       * passé.
       */
      if (ctx.tourNonAbouti) {
        if (point.etape === 'travail') etat = 'erreur';
        if (point.etape === 'rapport' && !point.moments.some((m) => m.sorte === 'rapport')) etat = 'erreur';
      }
    }
    /* UNE QUESTION OUVERTE ARRÊTE L'AGENT : le point passe en jaune, quoi qu'il porte d'autre. */
    if (point.questions.some((q) => !q.repondue) && etat !== 'erreur') etat = 'question';

    const erreurs = etat === 'erreur' ? avecLIncident(point.erreurs, point.etape, dernier ? ctx : null) : [];
    /* LA PRÉPARATION DIT L'ÉTAPE QU'ELLE FRANCHIT, quand le signal est arrivé. */
    const phrase =
      point.etape === 'preparation' && etat === 'encours'
        ? phraseDeLaPreparation(ctx.lancement)
        : point.etape === 'plan' && etat === 'fait' && dernier
          ? phraseDuPointPlan(point, ctx)
          : /* LE TOUR A RÉPONDU, IL N'A PAS COMPRIS : la phrase le dit. */
            point.etape === 'comprehension' && etat === 'fait' && dernier && tourDeReponseSeule(point, ctx.parcours)
            ? PHRASE_COMPREHENSION_REPONDUE
            : PHRASES_DU_POINT[point.etape][etat];
    /* LA RÉPONSE QUITTE LE RÉCIT, et se lit dans son propre cadre. */
    const reponse = reponseDuPassage(point, ctx.parcours);
    if (reponse) return { ...point, total, etat, phrase, erreurs, reponse, traces: point.traces.filter((trace) => trace !== reponse) };
    return { ...point, total, etat, phrase, erreurs };
  });

  return avecLeSuiviDesFilles(
    sansLePlanJamaisOuvert(
      avecLaMentionDeLaCarte(
        resumesDuFil(avecLeContenuDeLaCarte(uneSeuleEtapeEnCours(points), passages, ctx), ctx),
        ctx.mentionDeLaCarte,
      ),
      ctx,
    ),
    ctx.suiviDesFilles,
  );
}

/**
 * LA MÈRE RACONTE SES FILLES.
 *
 * Une carte mère ne lance aucun agent : son journal n'a ni travail ni compte
 * rendu, et ses deux derniers points se disaient « sautée » pendant que ses
 * filles travaillaient, chacune dans son projet. Ils se lisent désormais sur
 * le relevé des filles : « Travail » dit où en est chaque projet (en attente,
 * au travail et sur quoi, question, panne, terminé), « Rapport » donne le
 * compte rendu de chaque fille terminée. L'état du point suit les filles.
 * Une carte sans relevé est rendue telle quelle.
 */
function avecLeSuiviDesFilles(
  points: PointDuParcours[],
  suivi: readonly SuiviDUneFille[] | null | undefined,
): PointDuParcours[] {
  if (!suivi?.length) return points;
  const etats = etatsDesPointsDeLaMere(suivi);
  return points.map((point) => {
    if (point.annonce || point.rang !== point.total) return point;
    if (point.etape === 'travail') {
      return {
        ...point,
        etat: etats.travail,
        sautee: undefined,
        phrase: PHRASES_DU_SUIVI.travail[etats.travail],
        filles: [...suivi],
      };
    }
    if (point.etape === 'rapport') {
      return {
        ...point,
        etat: etats.rapport,
        sautee: undefined,
        phrase: PHRASES_DU_SUIVI.rapport[etats.rapport],
        filles: suivi.filter((fille) => fille.etat === 'fait'),
      };
    }
    return point;
  });
}

/**
 * LA CARTE A-T-ELLE UN PLAN — ou en attend-elle un ? LA question, posée UNE
 * FOIS et à un seul endroit.
 *
 * Le plan de cadrage ne se rend plus tout seul : il faut le demander. La
 * plupart des cartes n'en ont donc JAMAIS, et leur flux affichait quand même
 * un point « Plan » vide, éternellement « à venir », entre la compréhension et
 * le travail — un rendez-vous annoncé que personne n'avait pris. Le point et
 * son segment de barre ne paraissent désormais que si l'un de ces cinq faits
 * est vrai :
 *
 *  - une version de plan est écrite sur la carte (`parcours.plans`) ;
 *  - un plan est EN COURS D'ÉCRITURE (`parcours.planDemandeA`) ;
 *  - le tour en cours est un tour de plan (`ctx.chapitre`) ;
 *  - un jalon du journal l'a demandé ou rendu (moments `plan-demande`, `plan`) ;
 *  - un incident non levé vise cette étape — une carte d'avant, dont
 *    l'incident ne nomme aucune étape, compte aussi : c'est le point du plan
 *    qui le porte (voir le calcul d'état plus haut).
 *
 * Écrire la condition ici, et nulle part ailleurs, évite qu'un des cinq cas
 * soit oublié dans un coin du module : le flux et la barre lisent le MÊME
 * fait.
 */
export function laCarteAUnPlan(points: readonly PointDuParcours[], ctx: ContexteDesPoints): boolean {
  if ((ctx.parcours?.plans?.length ?? 0) > 0) return true;
  if (ctx.parcours?.planDemandeA) return true;
  if (ctx.chapitre === 'plan') return true;
  if (ctx.parcours?.incident?.texte && ctx.parcours.incident.etape !== 'comprehension') return true;
  return points.some(
    (point) =>
      point.etape === 'plan' &&
      point.moments.some((moment) => moment.sorte === 'plan' || moment.sorte === 'plan-demande'),
  );
}

/** Le passage du plan disparaît du flux tant que la carte n'en a jamais eu. */
function sansLePlanJamaisOuvert(points: PointDuParcours[], ctx: ContexteDesPoints): PointDuParcours[] {
  if (laCarteAUnPlan(points, ctx)) return points;
  return points.filter((point) => point.etape !== 'plan');
}

/** Les résumés portés par un jalon (`donnees`), quand l'outil les a écrits. */
export function resumesDuJalon(entree: EntreeJournal | undefined): {
  resumeDemande?: string;
  resumeComprehension?: string;
  synthese?: string;
} {
  if (!entree?.donnees) return {};
  try {
    const lu = JSON.parse(entree.donnees) as Record<string, unknown>;
    const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    return { resumeDemande: texte(lu.resumeDemande), resumeComprehension: texte(lu.resumeComprehension), synthese: texte(lu.synthese) };
  } catch {
    return {};
  }
}

/**
 * LE RÉSUMÉ SOUS CHAQUE TITRE « DEMANDE », « COMPRÉHENSION » ET « PLAN ».
 *
 * Les trois points disaient la même phrase fixe pour toutes les cartes (« Votre
 * demande est notée. ») : pour savoir ce qu'ils contenaient, il fallait les
 * ouvrir un par un. L'agent de cadrage écrit désormais deux résumés avec chaque
 * compréhension et une synthèse avec chaque plan ; chaque PASSAGE reçoit celui
 * de SON tour :
 *  - « Compréhension » : le `resumeComprehension` de sa dernière compréhension ;
 *  - « Demande » : le `resumeDemande` écrit SUR SON PROPRE JALON dès l'ouverture
 *    du tour, affiné par celui de la compréhension qui la SUIT dès qu'elle est
 *    rendue ; une demande sans ni l'un ni l'autre garde sa phrase ;
 *  - « Plan » : la `synthese` de la version que montre le passage.
 *
 * LE POINT « DEMANDE » N'ATTEND PLUS LA FIN DU TOUR. Son résumé était emprunté à
 * la compréhension qui vient APRÈS lui, écrite en toute fin de tour : le fil
 * restait donc sur « Votre demande est notée. » pendant tout le travail de
 * l'agent. Celui-ci écrit désormais sa synthèse juste après le titre, sur le
 * jalon « Demande » de son tour (`board_update_card`, champ `resumeDemande`) —
 * d'où la garde assouplie POUR CE SEUL POINT : dès qu'un résumé écrit existe, il
 * s'affiche, quel que soit l'avancement du reste du tour.
 *
 * Partout ailleurs, seul un point FAIT reçoit un résumé : à venir, en cours, en
 * question ou en erreur, la phrase fixe dit mieux l'état. Une carte d'avant n'a
 * rien sur son jalon de demande : elle repasse par l'emprunt à la compréhension,
 * exactement comme avant.
 */
function resumesDuFil(points: PointDuParcours[], ctx: ContexteDesPoints): PointDuParcours[] {
  const carte = ctx.parcours?.comprehension;
  const plans = ctx.parcours?.plans ?? [];
  const resumesDuPoint = (point: PointDuParcours) => {
    const comprises = point.moments.filter((m) => m.sorte === 'comprehension');
    const derniere = comprises[comprises.length - 1];
    if (!derniere) return {};
    const lus = resumesDuJalon(derniere.entree);
    /* Le journal ne porte pas les résumés (jalon d'avant, ou tenu par la carte) :
       ceux de la carte valent pour la compréhension QU'ELLE porte, pas une autre. */
    if (!lus.resumeDemande && !lus.resumeComprehension && carte && carte.tourId && carte.tourId === derniere.entree.tourId) {
      return { resumeDemande: carte.resumeDemande, resumeComprehension: carte.resumeComprehension };
    }
    return lus;
  };
  /* Ce que l'agent a écrit SUR le point « Demande » lui-même, au début de son
     tour. Les cartes d'avant n'ont rien ici : elles rendent `undefined`. */
  const resumeEcritSurLaDemande = (point: PointDuParcours): string | undefined => {
    const demandes = point.moments.filter((moment) => moment.sorte === 'demande');
    const derniere = demandes[demandes.length - 1];
    return derniere ? resumesDuJalon(derniere.entree).resumeDemande : undefined;
  };
  return points.map((point, index) => {
    if (point.annonce) return point;
    const ecritSurLaDemande = point.etape === 'demande' ? resumeEcritSurLaDemande(point) : undefined;
    /* La garde s'ouvre pour le seul point « Demande », et seulement quand un
       résumé écrit existe : rien d'autre ne s'affiche avant d'être terminé. */
    if (point.etat !== 'fait' && !ecritSurLaDemande) return point;
    let resume: string | undefined;
    if (point.etape === 'comprehension' && point.phrase === PHRASES_DU_POINT.comprehension.fait) {
      resume = resumesDuPoint(point).resumeComprehension;
    }
    if (point.etape === 'demande') {
      for (let i = index + 1; i < points.length && points[i].etape !== 'demande'; i += 1) {
        if (points[i].etape !== 'comprehension') continue;
        resume = resumesDuPoint(points[i]).resumeDemande ?? resume;
      }
      /* La compréhension du tour AFFINE la synthèse d'ouverture ; tant qu'elle
         n'est pas rendue, c'est celle d'ouverture qui tient la place. */
      resume = resume ?? ecritSurLaDemande;
    }
    if (point.etape === 'plan') {
      const moment = point.moments.filter((m) => m.sorte === 'plan').pop();
      const version = moment?.sorte === 'plan' ? moment.version : undefined;
      const vu = version !== undefined ? plans.find((plan) => plan.numero === version) : moment ? plans[plans.length - 1] : undefined;
      resume = vu?.synthese?.trim() || resumesDuJalon(moment?.entree).synthese;
    }
    return resume?.trim() ? { ...point, resume: resume.trim() } : point;
  });
}

/** Ce qui se lit sous une étape passée dont rien n'a été enregistré. */
export const PHRASE_ETAPE_SAUTEE = 'Rien n’a été enregistré pour cette étape.';

const ETAPES_A_CONTENU: readonly EtapeDuParcours[] = ['demande', 'comprehension', 'plan', 'travail', 'rapport'];

/**
 * UNE ÉTAPE COCHÉE A TOUJOURS SON CONTENU.
 *
 * Une carte sans journal — posée par un agent, par l'encart « sans carte », ou
 * dont le journal a été purgé — cochait toutes ses étapes d'après sa seule
 * colonne : « Votre demande est notée », « Le plan est prêt »… et rien à
 * ouvrir dessous (capture du 14.09.2026, plus de 1 500 cartes de la base).
 *
 * Deux temps. D'abord, ce que la CARTE porte tient lieu du jalon perdu : sa
 * description devient la demande, sa compréhension écrite (ou l'analyse jointe
 * à la proposition) la compréhension, son dernier plan le plan. Ensuite, une
 * étape « faite » qui n'a toujours RIEN n'est plus cochée : elle se lit
 * « sautée », sans coche, avec une phrase qui le dit.
 */
function avecLeContenuDeLaCarte(
  points: PointDuParcours[],
  /* Les passages BRUTS, dans le même ordre : leurs erreurs n'ont pas encore été
     filtrées par l'état, et une erreur passée est bien un contenu. */
  passages: readonly PassageNu[],
  ctx: ContexteDesPoints,
): PointDuParcours[] {
  const synthese = (libelle: string, resultat: string, at: number | undefined, donnees?: string): EntreeJournal => ({
    id: `carte-${libelle}`,
    cardId: '',
    rang: 0,
    phase: 'cadrage',
    nature: 'jalon',
    at: at ?? 0,
    libelle,
    resultat,
    reussie: true,
    ...(donnees ? { donnees } : {}),
  });
  const videIci = (index: number): boolean => {
    const point = points[index];
    const brut = passages[index];
    return estVide(point) && (!brut || estVide(brut)) && !point.reponse && !point.memoire.length;
  };
  return points.map((point, index) => {
    if (point.annonce || point.etat !== 'fait' || !ETAPES_A_CONTENU.includes(point.etape)) return point;
    if (!videIci(index)) return point;
    let moment: MomentDuPoint | undefined;
    if (point.etape === 'demande' && ctx.descriptionDeLaCarte?.trim()) {
      moment = { sorte: 'demande', entree: synthese('Demande', ctx.descriptionDeLaCarte.trim(), ctx.creeeA), premiere: true };
    }
    if (point.etape === 'comprehension') {
      const ecrite = ctx.parcours?.comprehension;
      const texte = ecrite?.texte?.trim() || ctx.analyseDeLaCarte?.trim();
      if (texte) {
        const donnees = ecrite?.texte?.trim()
          ? JSON.stringify({
              hypotheses: ecrite.hypotheses ?? [],
              sujets: ecrite.sujets ?? [],
              resumeDemande: ecrite.resumeDemande,
              resumeComprehension: ecrite.resumeComprehension,
            })
          : undefined;
        moment = {
          sorte: 'comprehension',
          entree: synthese(JALON_COMPREHENSION, texte, ecrite?.at ?? ctx.creeeA, donnees),
          numero: 1,
          derniere: true,
        };
      }
    }
    if (point.etape === 'plan') {
      const plans = ctx.parcours?.plans ?? [];
      const dernierPlan = plans[plans.length - 1];
      if (dernierPlan?.texte?.trim()) {
        moment = { sorte: 'plan', entree: synthese(JALON_PLAN_PROPOSE, dernierPlan.texte, dernierPlan.at), version: dernierPlan.numero };
      }
    }
    if (moment) return { ...point, at: point.at ?? (moment.entree.at || undefined), moments: [moment] };
    /*
     * RESTE COCHÉE, faute de mieux, une étape vide :
     * - pendant un tour vivant : son journal arrive, la cocher puis la décocher
     *   ferait clignoter le fil ;
     * - qui porte une phrase à elle (« le tour a répondu », « à décider ») :
     *   c'est un état écrit sur la carte, pas une coche déduite de la colonne ;
     * - « Demande », quand une étape PLUS LOIN a un contenu : on ne comprend
     *   pas une demande qui n'existe pas.
     */
    if (ctx.tourEnCours) return point;
    if (point.phrase !== PHRASES_DU_POINT[point.etape].fait) return point;
    if (point.etape === 'demande') {
      const prouvee =
        !!ctx.parcours?.comprehension?.texte?.trim() ||
        !!ctx.parcours?.plans?.length ||
        !!ctx.parcours?.issueDuTour ||
        !!ctx.analyseDeLaCarte?.trim() ||
        points.some((autre, i) => i > index && !autre.annonce && !videIci(i));
      if (prouvee) return point;
    }
    return { ...point, etat: 'avenir' as EtatDuPoint, sautee: true, phrase: PHRASE_ETAPE_SAUTEE, erreurs: [] };
  });
}

/**
 * LA PHRASE DE LA CARTE REJOINT SON PARCOURS.
 *
 * Elle vivait sur la seule vignette du tableau. Ouvrir la carte donnait donc
 * l'autre moitié de l'histoire — l'erreur du tour — sans jamais la phrase qui
 * l'explique, et l'utilisateur lisait deux versions contradictoires du même
 * événement. On la pose sur le DERNIER point du flux, celui où le regard
 * arrive, avec le TON que sa nature commande.
 */
function avecLaMentionDeLaCarte(points: PointDuParcours[], phrase?: string | null): PointDuParcours[] {
  const texte = phrase?.trim();
  if (!texte || !points.length) return points;
  const mention = { texte, nature: natureDeLaMention(texte) };
  /* Sur le dernier point qui RACONTE : un passage qui ne fait qu'annoncer la
     suite n'a rien à dire d'un travail déjà retrouvé. */
  let cible = points.length - 1;
  while (cible > 0 && points[cible].annonce) cible -= 1;
  return points.map((point, index) => (index === cible ? { ...point, mention } : point));
}

/**
 * LA PHRASE DU PLAN DIT OÙ SE DÉCIDE, ET SEULEMENT QUAND ÇA SE DÉCIDE.
 *
 * « Le plan est prêt : relisez-le, puis lancez le travail. » était écrit sous
 * tous les plans rendus — y compris ceux déjà validés, déjà lancés, déjà
 * travaillés — et il désignait un bouton qui avait changé de place. La phrase
 * suit donc l'ÉTAT RÉEL : elle nomme les deux gestes tant qu'une décision est
 * ouverte (`decisionDePlanOuverte`), et se tait ensuite.
 */
export const PHRASE_PLAN_A_DECIDER =
  'Le plan est prêt : relisez-le, puis validez et lancez via le bouton en dessous du champ de saisie.';

export function phraseDuPointPlan(
  point: Pick<PointDuParcours, 'moments'> | PassageNu,
  ctx: ContexteDesPoints,
): string {
  const plans = ctx.parcours?.plans ?? [];
  const courant = plans.length ? plans[plans.length - 1] : undefined;
  const moment = point.moments.find((m) => m.sorte === 'plan');
  const version = moment?.sorte === 'plan' ? moment.version : undefined;
  const estCourant = !courant || version === undefined || version === courant.numero;
  const vu = plans.find((plan) => plan.numero === version) ?? courant;
  const ouverte = decisionDePlanOuverte({
    estCourant,
    colonne: ctx.colonne,
    ...(ctx.parcours?.cadrageRouvertA ? { cadrageRouvertA: ctx.parcours.cadrageRouvertA } : {}),
    ...(vu ? { planRenduA: vu.at } : {}),
    ...(ctx.agentDeLaCarte ? { agentDeLaCarte: ctx.agentDeLaCarte } : {}),
    ...(ctx.codeDejaEnregistre ? { codeDejaEnregistre: true } : {}),
    ...(moment?.entree.agentId ? { agentDuPlan: moment.entree.agentId } : {}),
    /* LE PLAN NE SE VALIDE PLUS SEUL : c'est la COMPRÉHENSION qui porte la
       décision, et le plan la suit. La phrase dit donc où le geste se prend,
       et se tait dès qu'il n'y a plus rien à décider. */
    planValide: comprehensionValideePourLaVersionCourante(ctx.parcours),
    tourEnCours: ctx.tourEnCours,
  });
  return ouverte ? PHRASE_PLAN_A_DECIDER : PHRASES_DU_POINT.plan.fait;
}

/**
 * DEUX ÉTAPES NE PEUVENT PAS ÊTRE « EN COURS » ENSEMBLE.
 *
 * Une carte rouverte en plein travail affichait « Demande » ET « Travail » qui
 * tournaient tous les deux : le journal n'était pas encore arrivé, le point
 * « Demande » ne trouvait aucun jalon écrit et se croyait donc à faire, pendant
 * que le chapitre disait « travail ». L'écran racontait deux choses à la fois.
 *
 * On tranche donc APRÈS coup, sur le résultat entier : seul le DERNIER passage
 * en cours — le plus avancé dans le flux — le reste ; ceux qui le précèdent
 * sont derrière lui, donc FAITS. Une question ou une erreur, elles, ne sont
 * jamais touchées : elles disent autre chose que « ça tourne ».
 */
function uneSeuleEtapeEnCours(points: PointDuParcours[]): PointDuParcours[] {
  let dernierEnCours = -1;
  points.forEach((point, index) => {
    if (point.etat === 'encours') dernierEnCours = index;
  });
  if (dernierEnCours < 0) return points;
  return points.map((point, index) =>
    point.etat === 'encours' && index < dernierEnCours
      ? { ...point, etat: 'fait' as EtatDuPoint, phrase: PHRASES_DU_POINT[point.etape].fait }
      : point,
  );
}

/**
 * CE QUE DIT LE POINT « TRAVAIL » D'UN TOUR QUI S'EST ARRÊTÉ EN ROUTE. Texte
 * FIXE — donc traduit comme le reste : le nombre d'étapes restées non faites se
 * lit dans l'en-tête de la liste de tâches (`mentionTachesNonFaites`) et sur la
 * carte du tableau (`travailRestant`), jamais dans une phrase à trous que le
 * dictionnaire ne saurait pas ranger.
 */
export const TEXTE_TRAVAIL_NON_ABOUTI =
  'Des étapes n’ont pas été faites : le travail s’est arrêté avant la fin, il se reprend.';

/** Ce que dit le point « Compréhension » quand son tour est tombé et que la décision du bas attend. */
export const TEXTE_CADRAGE_TOMBE =
  'La compréhension n’a pas abouti : choisissez en bas de renvoyer votre demande, de l’ignorer ou d’arrêter.';

/** L'incident du parcours (plan non rendu) se lit comme une erreur du point Plan. */
function avecLIncident(erreurs: ErreurDuPoint[], etape: EtapeDuParcours, ctx: ContexteDesPoints | null): ErreurDuPoint[] {
  const liste = [...erreurs];
  if (!ctx) return liste.length ? [liste[liste.length - 1]] : liste;
  const incident = ctx.parcours?.incident;
  /* L'INCIDENT VA AU POINT QU'IL NOMME. Il ne visait que le plan ; la
     compréhension a désormais le sien, et son geste de reprise n'est pas
     « redemander le plan » mais RELANCER le cadrage par un message. */
  if (incident?.texte && (incident.etape ?? 'plan') === etape) {
    liste.push({
      cle: 'incident',
      texte: incident.texte,
      at: incident.at,
      action: etape === 'comprehension' ? 'relancer' : 'redemander-plan',
    });
  }
  /* UN TOUR DE CADRAGE TOMBÉ : aucun bouton de plus, la décision du bas est le
     seul chemin (`TEXTE_CADRAGE_TOMBE`). */
  if (etape === 'comprehension' && !liste.length && ctx.dernierTourEnEchec && ctx.decisionDeTourOuverte) {
    liste.push({ cle: 'tour-tombe', texte: TEXTE_CADRAGE_TOMBE, at: 0 });
  }
  if (etape === 'travail' && !liste.length && COLONNES_AVANT_LE_TRAVAIL.includes(ctx.colonne)) {
    liste.push({ cle: 'interrompue', texte: 'Le travail a été interrompu : il se reprend là où il s’était arrêté.', at: 0, action: 'reprendre' });
  }
  /* Le tour s'est arrêté en route et la carte est restée là : le geste qui la
     débloque se lit DANS le point, à côté de ce qui n'a pas été fait. */
  if (etape === 'travail' && !liste.length && ctx.tourNonAbouti) {
    liste.push({ cle: 'non-abouti', texte: TEXTE_TRAVAIL_NON_ABOUTI, at: 0, action: 'reprendre' });
  }
  /* Une erreur passée n'est plus une erreur : seule la DERNIÈRE se montre en rouge. */
  const retenues = liste.length ? [liste[liste.length - 1]] : liste;
  /* SANS COMPRÉHENSION, LE GESTE LA REDEMANDE — JAMAIS LE PLAN. « Redemander le
     plan » sur une carte dont le cadrage est mort avant la compréhension
     produisait un plan sans fondement (carte de nuit fd54689b). */
  if (ctx && !comprehensionPourLePlan({ column: ctx.colonne, parcours: ctx.parcours })) {
    return retenues.map((erreur) =>
      erreur.action === 'redemander-plan' || erreur.action === 'relancer'
        ? { ...erreur, action: 'redemander-comprehension' as const }
        : erreur,
    );
  }
  return retenues;
}

/** Le dernier jalon en échec du journal, et l'étape où il est tombé. */
function derniereErreurDuJournal(entrees: readonly EntreeJournal[]): { etape: EtapeDuParcours } | undefined {
  const ordonnees = ordonnerJournal(entrees);
  let planDemande = false;
  let derniere: { etape: EtapeDuParcours } | undefined;
  for (const entree of ordonnees) {
    const etape = etapeDeLEntree(entree, planDemande);
    if (ouvreLePlan(entree)) planDemande = true;
    else if (refermeLePlan(entree)) planDemande = false;
    if (estTourInterrompu(entree)) derniere = { etape };
    else if (estReponseRendue(entree)) derniere = undefined;
  }
  return derniere;
}

/* ------------------------------------------------------------------ */
/* Le flux et la barre                                                  */
/* ------------------------------------------------------------------ */

/** Ce que le flux dessine : les points du parcours, et les questions ouvertes en points jaunes. */
export type ElementDuFlux =
  | { sorte: 'point'; cle: string; point: PointDuParcours }
  | { sorte: 'question'; cle: string; etape: EtapeDuParcours; entree: EntreeJournal };

/**
 * LE FLUX : chaque point, suivi des questions ENCORE OUVERTES qu'il a posées,
 * en points jaunes à part. Une question répondue reste dans son point, avec sa
 * réponse : elle n'arrête plus personne.
 */
export function fluxDuParcours(points: readonly PointDuParcours[]): ElementDuFlux[] {
  const flux: ElementDuFlux[] = [];
  for (const point of points) {
    flux.push({ sorte: 'point', cle: point.ancre, point });
    for (const question of point.questions) {
      if (question.repondue) continue;
      flux.push({ sorte: 'question', cle: `question-${question.entree.id}`, etape: point.etape, entree: question.entree });
    }
  }
  return flux;
}

/** Un segment de la barre d'étapes : l'état de son point, rien de plus. */
export interface SegmentDeLaBarre {
  etape: EtapeDuParcours;
  etat: EtatDuPoint;
}

/**
 * LES ÉTAPES QUI ONT UN SEGMENT DANS LA BARRE : les six grandes. La
 * PRÉPARATION n'en a pas — elle dure quelques secondes, et un septième segment
 * qui apparaîtrait puis disparaîtrait ferait sauter toute la barre au moment
 * même où l'utilisateur la regarde. Elle se lit dans le flux, à sa place.
 */
export const ETAPES_DE_LA_BARRE = ETAPES_DU_PARCOURS.filter((etape) => etape !== 'preparation');

/**
 * LE SEGMENT MIS EN AVANT PAR LA BARRE. La préparation n'a pas de segment à
 * elle : c'est « Travail » qu'on est en train de préparer, et c'est donc lui
 * que la barre montre — encore gris, mais désigné.
 */
export function segmentActifDeLaBarre(courante: EtapeDuParcours): EtapeDuParcours {
  return courante === 'preparation' ? 'travail' : courante;
}

/**
 * LA BARRE GARDE UN SEGMENT PAR ÉTAPE, QUOI QU'IL ARRIVE AU FLUX. Elle replie
 * la suite des passages sur les six étapes : chaque segment prend l'état du
 * DERNIER passage de son étape. Trois plans ne font donc jamais trois
 * segments — la barre dit où on en est, pas combien de fois on y est passé.
 */
export function barreDuParcours(points: readonly PointDuParcours[]): SegmentDeLaBarre[] {
  /* ET LE SEGMENT « PLAN » SUIT SON POINT : une carte qui n'a jamais eu de
     plan n'en montre pas plus dans la barre que dans le flux. Cinq segments
     alors, à `flex-1` : la barre se répartit d'elle-même, et aucun raccourci
     ne vise une ancre qui n'existe pas (`laCarteAUnPlan` a déjà tranché, le
     flux fait foi). */
  const avecUnPoint = new Set(points.map((point) => point.etape));
  return ETAPES_DE_LA_BARRE.filter((etape) => etape !== 'plan' || avecUnPoint.has('plan')).map((etape) => {
    const passages = points.filter((point) => point.etape === etape);
    const dernier = passages[passages.length - 1];
    return { etape, etat: dernier?.etat ?? 'avenir' };
  });
}

/**
 * LA BARRE DU TIROIR PARLE COMME LA FRISE DE « TABLEAUX DE BORD » : cinq
 * étapes, Demande, Compréhension, Travail, À déployer, Archivée
 * (`ETAPES_DE_SUIVI`). Chaque étape du flux se range sous l'une d'elles — le
 * PLAN sous Compréhension, la PRÉPARATION et le RAPPORT sous Travail —, et la
 * CONFIGURATION, simple réglage de l'agent, sous aucune.
 */
export const ETAPE_DE_SUIVI_DU_POINT: Record<EtapeDuParcours, EtapeDeSuivi | null> = {
  configuration: null,
  demande: 'demande',
  comprehension: 'comprehension',
  plan: 'comprehension',
  preparation: 'travail',
  travail: 'travail',
  rapport: 'travail',
};

/** Les étapes du flux rangées sous une étape de suivi, dans l'ordre du parcours. */
export function etapesDuFluxSous(suivi: EtapeDeSuivi): EtapeDuParcours[] {
  return ETAPES_DU_PARCOURS.filter((etape) => ETAPE_DE_SUIVI_DU_POINT[etape] === suivi);
}

/** Un segment de la barre du tiroir. */
export interface SegmentDeSuivi {
  etape: EtapeDeSuivi;
  etat: EtatDuPoint;
}

/**
 * L'ÉTAT D'UN GROUPE D'ÉTAPES : ce qui arrête tout l'emporte (question, puis
 * erreur), puis ce qui tourne ; sinon le groupe est fait quand sa DERNIÈRE
 * étape présente l'est, à venir quand rien n'y a commencé, en cours entre les
 * deux. Chaque étape y compte par son DERNIER passage, comme dans
 * `barreDuParcours`.
 */
function etatDuGroupe(points: readonly PointDuParcours[], etapes: readonly EtapeDuParcours[]): EtatDuPoint {
  const derniers = etapes
    .map((etape) => points.filter((point) => point.etape === etape).at(-1)?.etat)
    .filter((etat): etat is EtatDuPoint => etat !== undefined);
  for (const etat of ['question', 'erreur', 'encours'] as const) if (derniers.includes(etat)) return etat;
  if (!derniers.length || derniers.every((etat) => etat === 'avenir')) return 'avenir';
  return derniers[derniers.length - 1] === 'fait' ? 'fait' : 'encours';
}

/**
 * LA BARRE DU TIROIR : les trois premières étapes se lisent sur les points du
 * flux, les deux dernières sur la mise en ligne de la carte
 * (`etatDuDeploiement`). Attendre dans « À déployer » n'est pas « en cours » :
 * le segment reste gris, désigné comme étape actuelle ; il passe à l'orange
 * pendant la publication, au rouge si elle est tombée.
 */
export function barreDeSuivi(points: readonly PointDuParcours[], carte: CarteDeSuivi): SegmentDeSuivi[] {
  const deploiement = etatDuDeploiement(carte);
  const range = deploiement === 'en_ligne' || deploiement === 'archivee';
  return ETAPES_DE_SUIVI.map((etape) => {
    if (etape === 'a_deployer') {
      const etat: EtatDuPoint =
        deploiement === 'en_cours' ? 'encours' : deploiement === 'echec' ? 'erreur' : range ? 'fait' : 'avenir';
      return { etape, etat };
    }
    if (etape === 'archivee') return { etape, etat: range ? 'fait' : 'avenir' };
    return { etape, etat: etatDuGroupe(points, etapesDuFluxSous(etape)) };
  });
}

/** Le segment désigné : la MÊME étape courante que la frise (`etapeCouranteDeSuivi`). */
export function segmentActifDeSuivi(carte: CarteDeSuivi): EtapeDeSuivi {
  return etapeCouranteDeSuivi(carte);
}

/**
 * OÙ MÈNE UN SEGMENT : au dernier passage de son groupe dans le flux — la
 * dernière compréhension ou le dernier plan, le rapport plutôt que le travail.
 * Rend `undefined` pour « À déployer » et « Archivée », qui visent le point
 * « Déploiement » posé en bas de la conversation.
 */
export function passageViseParLeSegment(
  points: readonly PointDuParcours[],
  suivi: EtapeDeSuivi,
): PointDuParcours | undefined {
  const etapes = etapesDuFluxSous(suivi);
  let vise: PointDuParcours | undefined;
  let rang = -1;
  for (const etape of etapes) {
    const passage = dernierPassage(points, etape);
    if (!passage || passage.etat === 'avenir') continue;
    const ici = points.indexOf(passage);
    if (ici > rang) [vise, rang] = [passage, ici];
  }
  if (vise) return vise;
  /* Rien de commencé dans le groupe : sa première étape présente, à venir. */
  for (const etape of etapes) {
    const passage = dernierPassage(points, etape);
    if (passage) return passage;
  }
  return undefined;
}

/**
 * LE DERNIER PASSAGE D'UNE ÉTAPE : c'est lui que la barre ouvre et vise.
 *
 * Un passage qui ne fait qu'ANNONCER la suite de l'itération est sauté tant
 * qu'un autre existe : toucher le segment « Travail » mènerait sinon au point
 * vide posé sous la nouvelle demande, au lieu du travail qu'on vient relire.
 * Le passage ANTICIPÉ d'un tour vivant, lui, est bien visé — il est vide, mais
 * c'est là que ça se passe.
 */
export function dernierPassage(
  points: readonly PointDuParcours[],
  etape: EtapeDuParcours,
): PointDuParcours | undefined {
  const passages = points.filter((point) => point.etape === etape);
  const liste = passages.some((point) => !point.annonce)
    ? passages.filter((point) => !point.annonce)
    : passages;
  return liste[liste.length - 1];
}

/**
 * LES PASSAGES OUVERTS D'OFFICE, par leur ANCRE : la CONFIGURATION, le dernier
 * de l'étape courante, le dernier plan dès qu'il est rendu tant qu'on n'a pas
 * lancé — c'est lui qu'on vient relire —, et celui qui porte une question ou
 * une erreur. Jamais deux passages de la MÊME étape : c'est l'accordéon.
 */
export function pointsOuvertsDOffice(points: readonly PointDuParcours[], courante: EtapeDuParcours): string[] {
  const ouverts = new Set<string>();
  const courant = dernierPassage(points, courante);
  if (courant) ouverts.add(courant.ancre);
  /* LA CONFIGURATION EST OUVERTE D'OFFICE : c'est le point d'accès aux
     réglages du moteur, qui vivait jusqu'ici en bande fixe au-dessus de la
     barre. Il reste visible sans un clic, et se referme comme les autres. */
  const configuration = dernierPassage(points, 'configuration');
  if (configuration) ouverts.add(configuration.ancre);
  const plan = dernierPassage(points, 'plan');
  if (plan && plan.etat === 'fait' && (courante === 'plan' || courante === 'comprehension')) ouverts.add(plan.ancre);
  /* LA RÉPONSE OU LA COMPRÉHENSION RENDUE S'OUVRE COMME LE PLAN : c'est elle
     qu'on vient lire, sans un clic. */
  const comprehension = dernierPassage(points, 'comprehension');
  if (courante === 'comprehension' && comprehension && comprehension.etat !== 'avenir' && blocDeFinDuPassage(comprehension)) {
    ouverts.add(comprehension.ancre);
  }
  const enQuestion = points.find((p) => p.etat === 'question' || p.etat === 'erreur');
  if (enQuestion) {
    /* Un seul passage ouvert par étape : celui qui arrête tout l'emporte. */
    for (const autre of points) if (autre.etape === enQuestion.etape) ouverts.delete(autre.ancre);
    ouverts.add(enQuestion.ancre);
  }
  return points.filter((point) => ouverts.has(point.ancre)).map((point) => point.ancre);
}

/* ------------------------------------------------------------------ */
/* L'attente, sous le point « Demande »                                 */
/* ------------------------------------------------------------------ */

/**
 * CE QUI SE PASSE PENDANT QUE LA DEMANDE ATTEND SON MOTEUR.
 *
 * Entre la demande écrite et le premier mot de l'agent, le démon enregistre,
 * diffuse, choisit un compte et ouvre une copie de travail. Rien de tout cela
 * ne se voyait : un rond qui tourne, et c'est tout. Pire, une demande retombée
 * EN FILE faute de quota tournait exactement pareil — on croyait à un tour qui
 * travaille alors que rien ne partait.
 *
 * Cette règle dit, en un mot, LAQUELLE de ces attentes est en cours. Elle est
 * pure : l'écran lui donne ce qu'il sait, elle ne lit ni base ni disque.
 */
export type SorteDAttente = 'quota' | 'file' | 'envoi' | 'preparation';

export interface AttenteDeLaDemande {
  sorte: SorteDAttente;
  /** La place dans la file, quand la demande y attend (1 = la prochaine). */
  position?: number;
}

export interface ContexteDeLAttente {
  /** La demande vient d'être cliquée et le serveur ne l'a pas encore renvoyée. */
  envoiLocal?: boolean;
  /** Les demandes en file pour cet agent (`state.queues`). */
  file?: readonly { position: number; messageId?: string }[];
  /** Un tour est-il vivant ? */
  tourEnCours?: boolean;
  /** Le tour a-t-il déjà été lancé (jalon « Tour lancé » après la demande) ? */
  tourLance?: boolean;
  /**
   * DEPUIS COMBIEN DE TEMPS CE TOUR ATTEND. La préparation — choix du compte,
   * ouverture de la copie de travail — dure quelques secondes. Passé le
   * plafond, l'écran affichait encore « Préparation du tour… » sous un
   * chronomètre à « 54 min » : la phrase mentait, et rendait l'incohérence
   * plus trompeuse encore.
   */
  depuisMs?: number;
}

/**
 * AU-DELÀ DE CE DÉLAI, LA PRÉPARATION N'EN EST PLUS UNE. Deux minutes suffisent
 * largement au démon pour choisir un compte et ouvrir une copie de travail ;
 * au-delà, ce qui tourne est autre chose, et le parcours le dit tout seul.
 */
export const PREPARATION_MAX_MS = 120_000;

/**
 * L'ATTENTE, EN UN MOT. L'ordre compte : le manque de QUOTA passe devant tout
 * — c'est la seule attente qui ne se résorbera pas d'elle-même en une seconde,
 * et la seule qu'il faut ÉCRIRE pour ne pas laisser croire à un tour qui
 * tourne. Une demande empilée derrière un agent occupé vient ensuite, puis
 * l'envoi tout juste parti, puis la préparation du tour.
 *
 * Rien à dire dès que le tour est VRAIMENT lancé : c'est le parcours lui-même
 * qui raconte, à partir de là.
 */
export function attenteDeLaDemande(ctx: ContexteDeLAttente): AttenteDeLaDemande | undefined {
  const file = ctx.file ?? [];
  /* UNE BULLE DÉJÀ ÉCRITE QUI RETOMBE EN FILE, C'EST LE MANQUE DE QUOTA
     (`QueuedPrompt.messageId`, `shared/src/models.ts`) : la demande est partie,
     elle a été enregistrée, et aucun compte n'a pu la prendre. */
  const sansQuota = file.find((item) => !!item.messageId);
  if (sansQuota) return { sorte: 'quota', position: sansQuota.position };
  if (file.length) return { sorte: 'file', position: file[0].position };
  if (ctx.envoiLocal) return { sorte: 'envoi' };
  if (ctx.tourEnCours && !ctx.tourLance) {
    /* UNE PRÉPARATION QUI DURE N'EST PLUS UNE PRÉPARATION : au-delà du
       plafond, on ne dit plus rien plutôt que de mentir. */
    if (ctx.depuisMs !== undefined && ctx.depuisMs > PREPARATION_MAX_MS) return undefined;
    return { sorte: 'preparation' };
  }
  return undefined;
}

/** Ce que l'écran écrit sous le point « Demande », selon l'attente. */
export const PHRASES_DE_L_ATTENTE: Record<SorteDAttente, string> = {
  quota: 'En attente d’un compte disponible : la demande partira dès qu’un quota se libère.',
  file: 'En file derrière le tour en cours : elle partira juste après.',
  envoi: 'Demande envoyée — l’agent va la prendre.',
  preparation: 'Préparation du tour : choix du compte et ouverture de la copie de travail…',
};

/** Le tour de la DERNIÈRE demande a-t-il déjà été lancé ? (jalon « Tour lancé ») */
export function tourLanceApresLaDemande(entrees: readonly EntreeJournal[]): boolean {
  const ordonnees = ordonnerJournal(entrees);
  let vu = false;
  for (const entree of ordonnees) {
    if (estDemande(entree)) vu = false;
    else if (entree.nature === 'jalon' && entree.libelle === JALON_TOUR_LANCE) vu = true;
  }
  return vu;
}

/**
 * L'ÉCRAN NE PEUT PLUS SE CONTREDIRE : LE GESTE ET LA LIGNE DE TEMPS DISENT LA
 * MÊME CHOSE.
 *
 * Le bouton du bas lit la CARTE (`gesteDuParcours`, `parcours-carte.ts`), le
 * flux en points reconstruit son état à partir du JOURNAL du tour. Quand l'une
 * des deux écritures manquait — un jalon perdu avec un tour coupé —, on voyait
 * « Générer le plan » allumé au-dessus d'une étape « Compréhension » encore
 * annoncée « à venir ».
 *
 * Cette règle NOMME la contradiction au lieu de la laisser passer : elle rend
 * l'étape fautive, ou `null` quand tout concorde. Les contrôles s'en servent
 * pour balayer les états possibles (`node scripts/verif-cadrage-cheminement.mjs`).
 */
export function contradictionDuFlux(
  points: readonly Pick<PointDuParcours, 'etape' | 'etat'>[],
  geste: { geste: string; possible: boolean } | null,
): EtapeDuParcours | null {
  if (!geste?.possible) return null;
  /* Le geste d'une étape suppose FRANCHIES toutes celles qui la précèdent. */
  const exigees: Record<string, EtapeDuParcours> = {
    /* Le seul geste de décision du cadrage porte sur la COMPRÉHENSION : elle
       doit donc être franchie à l'écran quand le bouton est allumé. Le plan,
       devenu facultatif, n'exige plus rien. */
    'valider-et-lancer': 'comprehension',
  };
  const exigee = exigees[geste.geste];
  if (!exigee) return null;
  const point = [...points].reverse().find((p) => p.etape === exigee);
  if (!point) return exigee;
  return point.etat === 'avenir' ? exigee : null;
}
