/**
 * « OÙ EN EST CETTE CARTE ? » — LA FRISE DES CINQ ÉTAPES.
 *
 * LA MÊME SUITE PARTOUT : cette frise sur « Tableaux de bord », et la barre
 * d'étapes en tête du tiroir d'une carte (`barreDeSuivi`,
 * `parcours-en-points.ts`), qui lit la même étape courante ici. Les deux ne
 * peuvent donc plus se contredire.
 *
 * Sur « Tableaux de bord », les cartes de tous les projets sont mêlées dans une
 * seule colonne : aucune rangée ne dit plus l'étape. Une petite frise, posée
 * dans le corps de la carte sous le texte de la demande, la montre d'un coup
 * d'œil : Demande, Compréhension, Travail, À déployer, Archivée.
 *
 * Deux étapes du parcours n'ont PAS de rond à elles : le PLAN, facultatif, fait
 * partie de « Compréhension » ; le RAPPORT rendu clôt « Travail » (la carte
 * passe alors dans « À déployer »). La frise garde ainsi toujours cinq ronds.
 *
 * On ne lit que ce que la carte porte déjà dans la liste (colonne, parcours,
 * agent au travail, décision attendue) : aucun journal à charger.
 *
 * Règle pure : sans base ni réseau, elle se teste seule.
 */

export const ETAPES_DE_SUIVI = ['demande', 'comprehension', 'travail', 'a_deployer', 'archivee'] as const;

/**
 * LA CARTE DU RENDEZ-VOUS DE NUIT A SES TROIS ÉTAPES À ELLE. Elle n'est pas
 * une tâche : rien à comprendre avant de dépenser, rien à déployer. Elle se
 * lisait pourtant sur les cinq ronds d'une tâche — « Compréhension » sautée,
 * puis « À déployer » et « Archivée » cochés sur un travail que personne
 * n'avait à publier. Elle se lit désormais Demande, Examen, Propositions
 * (`estCarteDuRendezVousDeNuit`, `avecLeParcoursDeLaNuit`).
 */
export const ETAPES_DE_SUIVI_DE_LA_NUIT = ['demande', 'examen', 'propositions'] as const;
export type EtapeDeSuivi = (typeof ETAPES_DE_SUIVI)[number] | (typeof ETAPES_DE_SUIVI_DE_LA_NUIT)[number];

/** Le nom affiché au survol de chaque rond (traduit comme le reste). */
export const LIBELLE_ETAPE_DE_SUIVI: Record<EtapeDeSuivi, string> = {
  demande: 'Demande',
  comprehension: 'Compréhension',
  travail: 'Travail',
  a_deployer: 'À déployer',
  archivee: 'Archivée',
  examen: 'Examen',
  propositions: 'Propositions',
};

/** Les ronds de CETTE carte : ceux d'une tâche, ou les trois de la nuit. */
export function etapesDeSuivi(carte: Pick<CarteDeSuivi, 'rendezVousDeNuit'>): readonly EtapeDeSuivi[] {
  return carte.rendezVousDeNuit ? ETAPES_DE_SUIVI_DE_LA_NUIT : ETAPES_DE_SUIVI;
}

/** L'étape d'ARRIVÉE, finie pour de bon : rien ne s'y attend plus. */
function etapeDArrivee(etape: EtapeDeSuivi): boolean {
  return etape === 'archivee' || etape === 'propositions';
}

/** L'état d'un rond : passé, celui où se trouve la carte, ou à venir. */
export type EtatEtapeDeSuivi = 'fait' | 'courant' | 'avenir';

/** Ce qui se passe SUR l'étape courante. */
export type AllureEtapeDeSuivi =
  /** Un agent y travaille, ou la mise en ligne l'emporte : orange, animé. */
  | 'travaille'
  /** Sa mise en ligne est tombée : rouge. */
  | 'erreur'
  /** Elle attend votre réponse ou votre geste. */
  | 'attend'
  /** Rien ne bouge. */
  | 'repos';

export interface CarteDeSuivi {
  colonne: string;
  parcours?: { comprehension?: unknown; plans?: unknown[] };
  /** Un agent de la carte tourne en ce moment. */
  agentActif?: boolean;
  /** Au moins une décision attendue de l'utilisateur. */
  decisionEnAttente?: boolean;
  /** Date de mise en ligne (`card.deployedAt`) : seule elle dit « en ligne ». */
  deployeeA?: number;
  /** « À déployer », et la publication de son projet tourne en ce moment. */
  enPublication?: boolean;
  /** « À déployer », et la dernière publication de son projet est tombée. */
  publicationEchouee?: boolean;
  /** La carte du rendez-vous de nuit (`estCarteDuRendezVousDeNuit`) : trois ronds à elle. */
  rendezVousDeNuit?: boolean;
}

/**
 * OÙ EN EST SA MISE EN LIGNE — ce que disent les deux dernières étapes et le
 * point « Déploiement » en bas de la conversation.
 *  - `aucun` : la carte n'est pas encore arrivée à « À déployer » ;
 *  - `attend` : elle est dans « À déployer », rien ne la publie ;
 *  - `en_cours` : la publication de son projet tourne ;
 *  - `echec` : la dernière publication de son projet est tombée ;
 *  - `en_ligne` : rangée ET publiée (`deployeeA`) ;
 *  - `archivee` : rangée sans avoir été publiée.
 */
export type EtatDuDeploiement = 'aucun' | 'attend' | 'en_cours' | 'echec' | 'en_ligne' | 'archivee';

export function etatDuDeploiement(carte: CarteDeSuivi): EtatDuDeploiement {
  if (carte.colonne === 'archived') return carte.deployeeA ? 'en_ligne' : 'archivee';
  if (carte.colonne !== 'to_deploy') return 'aucun';
  if (carte.enPublication) return 'en_cours';
  if (carte.publicationEchouee) return 'echec';
  return 'attend';
}

export interface EtapeSuivie {
  etape: EtapeDeSuivi;
  etat: EtatEtapeDeSuivi;
}

export interface FriseDeSuivi {
  etapes: EtapeSuivie[];
  courante: EtapeDeSuivi;
  allure: AllureEtapeDeSuivi;
}

/** L'étape où se trouve la carte. */
export function etapeCouranteDeSuivi(carte: CarteDeSuivi): EtapeDeSuivi {
  /* LA NUIT : l'examen tant que son agent tourne ou qu'il est tombé (la panne
     ramène la carte dans « Planifié », `direLaPanneSurLaCarte`) ; les
     propositions une fois la carte rangée. */
  if (carte.rendezVousDeNuit) {
    if (carte.agentActif) return 'examen';
    return carte.colonne === 'archived' ? 'propositions' : 'examen';
  }
  if (carte.colonne === 'archived') return 'archivee';
  if (carte.colonne === 'to_deploy') return 'a_deployer';
  if (carte.colonne === 'running') return 'travail';
  // « Planifié » : le cadrage a-t-il rendu (ou est-il en train de rendre) ce
  // qu'il a compris ? Un plan compte comme une compréhension.
  if (carte.parcours?.comprehension || carte.parcours?.plans?.length || carte.agentActif) return 'comprehension';
  return 'demande';
}

/** La frise complète d'une carte : l'état de chaque rond et l'allure de la courante. */
export function friseDeSuivi(carte: CarteDeSuivi): FriseDeSuivi {
  const courante = etapeCouranteDeSuivi(carte);
  const suite = etapesDeSuivi(carte);
  const rang = suite.indexOf(courante);
  const etapes = suite.map((etape, i) => ({
    etape,
    etat: (i < rang ? 'fait' : i === rang ? 'courant' : 'avenir') as EtatEtapeDeSuivi,
  }));
  // Une carte archivée est arrivée : rien n'y attend, rien n'y travaille.
  const deploiement = etatDuDeploiement(carte);
  const allure: AllureEtapeDeSuivi =
    etapeDArrivee(courante)
      ? 'repos'
      : carte.decisionEnAttente
        ? 'attend'
        : carte.agentActif || deploiement === 'en_cours'
          ? 'travaille'
          : deploiement === 'echec'
            ? 'erreur'
            : 'repos';
  return { etapes, courante, allure };
}

/**
 * LA COULEUR DE CHAQUE ROND — exception voulue à la convention orange/bleu,
 * limitée à cette frise et à la barre d'étapes du tiroir :
 *  - `valide` (BLEU fixe) : une étape franchie, et l'arrivée « Archivée » ;
 *  - `fini` (BLEU fixe) : l'étape courante, finie, rien ne vous y attend ;
 *  - `a_voir` (BLEU qui clignote) : finie, et un geste vous y est attendu ;
 *  - `travail` (JAUNE qui scintille) : un agent ou une mise en ligne y travaille ;
 *  - `erreur` (ROUGE) : sa mise en ligne est tombée ;
 *  - `neutre` : une demande posée que rien n'a encore touchée ;
 *  - `avenir` (pâle) : pas encore atteinte.
 * Le trait qui MÈNE à un rond prend sa couleur (sans le mouvement) : une
 * étape validée verdit son rond, le trait qui y mène et le rond d'avant.
 */
export type TonDeSuivi = 'valide' | 'fini' | 'a_voir' | 'travail' | 'erreur' | 'neutre' | 'avenir';

/** Le ton d'un rond de la frise (`friseDeSuivi`). */
export function tonDeLEtapeDeSuivi(frise: FriseDeSuivi, etape: EtapeDeSuivi): TonDeSuivi {
  const etat = frise.etapes.find((e) => e.etape === etape)?.etat ?? 'avenir';
  if (etat === 'fait') return 'valide';
  if (etat === 'avenir') return 'avenir';
  if (etapeDArrivee(frise.courante)) return 'valide';
  if (frise.allure === 'travaille') return 'travail';
  if (frise.allure === 'attend') return 'a_voir';
  if (frise.allure === 'erreur') return 'erreur';
  return frise.courante === 'demande' ? 'neutre' : 'fini';
}

/**
 * Le ton d'un segment de la barre du tiroir (`barreDeSuivi`), dont l'état vient
 * des points du flux : un segment FAIT est validé, sauf l'étape où se trouve
 * la carte, qui est finie mais pas encore validée — comme sur la frise.
 */
export function tonDuSegmentDeSuivi(
  segment: { etape: EtapeDeSuivi; etat: 'avenir' | 'encours' | 'fait' | 'question' | 'erreur' },
  courante: EtapeDeSuivi,
): TonDeSuivi {
  switch (segment.etat) {
    case 'encours':
      return 'travail';
    case 'question':
      return 'a_voir';
    case 'erreur':
      return 'erreur';
    case 'avenir':
      return 'avenir';
    default:
      return segment.etape === courante && !etapeDArrivee(courante) ? 'fini' : 'valide';
  }
}
