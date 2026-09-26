import { COLONNES_AVANT_LE_TRAVAIL, COLUMN_LABELS, type ColumnKey } from './columns.js';

/**
 * CHANGER UNE CARTE DE PROJET — la règle, écrite UNE FOIS.
 *
 * Une carte appartient à son projet depuis sa naissance ; le seul déplacement
 * connu jusqu'ici la faisait changer de COLONNE. Se tromper de projet à la
 * création obligeait donc à tout recommencer : recréer la carte, reperdre le
 * cadrage déjà écrit.
 *
 * Le geste existe désormais, mais il est BORNÉ. Une carte n'emporte avec elle
 * que ce qui vit en base (sa conversation, ses pièces jointes, ses commentaires,
 * son journal) ; tout ce qui vit sur DISQUE — sa branche `tache/…`, sa copie de
 * travail, ses commits — reste attaché au dépôt du projet d'origine et ne peut
 * pas suivre. D'où la borne : une carte ne change de projet QU'AVANT tout
 * travail.
 *
 * PIÈGE — la colonne ne suffit pas. Une carte interrompue REVIENT en
 * « Planifié » avec sa branche et son dossier intacts (le bouton « Reprendre »).
 * La règle exige donc aussi l'absence de toute trace de travail passé :
 * `codeDejaEnregistre`, une branche posée, un agent d'exécution, une date de
 * clôture, de mise en ligne ou d'archivage.
 *
 * Cette règle sert aux DEUX mains — le serveur qui refuse, l'écran qui éteint
 * l'entrée de menu et refuse le dépôt — pour qu'on ne propose jamais une
 * destination qui serait ensuite rejetée.
 */

/** L'état de la carte candidate, tel que l'écran comme le serveur le connaissent. */
export interface CarteCandidateAuDeplacement {
  /** La colonne où la carte se trouve. */
  colonne: ColumnKey;
  /** Le projet où elle vit aujourd'hui. */
  projetId: string;
  /** Un agent de la carte est-il en train de travailler (ou de démarrer) ? */
  agentActif?: boolean;
  /** Un agent d'EXÉCUTION (rôle `task`) a-t-il déjà existé pour cette carte ? */
  agentDeTache?: boolean;
  /** La branche `tache/…` de la carte, si elle a déjà été créée. */
  branche?: string | null;
  /** La carte a-t-elle déjà enregistré du code au cours de sa vie ? */
  codeDejaEnregistre?: boolean;
  /** Dates de clôture : une carte qui en porte une a forcément travaillé. */
  doneAt?: number;
  deployedAt?: number;
  archivedAt?: number;
  /** La carte est-elle née d'une demande envoyée par un client ? */
  neeDUneDemandeClient?: boolean;
}

/** Le projet d'accueil envisagé. */
export interface ProjetDAccueil {
  id: string;
  /**
   * Le dossier de Beluga Build lui-même. Il ne CHANGE RIEN au verdict — cet
   * espace reçoit une carte comme n'importe quel projet, et en laisse repartir
   * une de la même façon. Le champ reste pour que l'appelant n'ait pas à
   * trier ses projets avant de demander.
   */
  isSelf?: boolean;
  /** Un projet rangé ne reçoit rien. */
  archived?: boolean;
}

export interface VerdictDeplacementProjet {
  possible: boolean;
  /** Le motif du refus, en mots lisibles — affiché tel quel. */
  raison?: string;
}

export const RAISON_DEPLACEMENT_MEME_PROJET = 'La carte est déjà dans ce projet.';
export const RAISON_DEPLACEMENT_PROJET_INCONNU = 'Ce projet d’accueil est introuvable.';
export const RAISON_DEPLACEMENT_PROJET_RANGE = 'Ce projet est archivé : il ne reçoit plus de carte.';
export const RAISON_DEPLACEMENT_AGENT_AU_TRAVAIL =
  'Un agent travaille sur cette carte : elle ne peut pas changer de projet maintenant.';
export const RAISON_DEPLACEMENT_DEJA_TRAVAILLEE =
  'Cette carte a déjà été travaillée : sa branche et son code appartiennent à son projet d’origine.';
export const RAISON_DEPLACEMENT_DEMANDE_CLIENT =
  'Cette carte vient d’une demande client : elle reste liée à l’espace de son projet.';

/** Le motif du refus quand la carte a dépassé le cadrage. */
function raisonDeColonne(colonne: ColumnKey): string {
  const libelle = COLUMN_LABELS[colonne] ?? colonne;
  return `Seule une carte encore en « Demande » ou « Plan » peut changer de projet (celle-ci est en « ${libelle} »).`;
}

/**
 * LA TRACE D'UN TRAVAIL PASSÉ — vraie dès qu'un indice existe, quel qu'il soit.
 * Volontairement large : mieux vaut refuser une carte propre qu'orpheliner une
 * branche.
 */
export function carteDejaTravaillee(carte: CarteCandidateAuDeplacement): boolean {
  return Boolean(
    carte.codeDejaEnregistre ||
      carte.agentDeTache ||
      (carte.branche && carte.branche.length > 0) ||
      carte.doneAt ||
      carte.deployedAt ||
      carte.archivedAt,
  );
}

/**
 * CETTE CARTE PEUT-ELLE PARTIR DANS CE PROJET ? Sans projet d'accueil, la
 * question est « peut-elle partir tout court » : c'est ce que lit le menu pour
 * décider d'éteindre son entrée avant même d'ouvrir la liste des destinations.
 */
export function deplacementVersProjetPossible(
  carte: CarteCandidateAuDeplacement,
  accueil?: ProjetDAccueil | null,
): VerdictDeplacementProjet {
  if (carte.agentActif) return { possible: false, raison: RAISON_DEPLACEMENT_AGENT_AU_TRAVAIL };

  if (!COLONNES_AVANT_LE_TRAVAIL.includes(carte.colonne)) {
    return { possible: false, raison: raisonDeColonne(carte.colonne) };
  }

  if (carteDejaTravaillee(carte)) return { possible: false, raison: RAISON_DEPLACEMENT_DEJA_TRAVAILLEE };

  if (carte.neeDUneDemandeClient) return { possible: false, raison: RAISON_DEPLACEMENT_DEMANDE_CLIENT };

  // Sans destination nommée, la carte est simplement « déplaçable ».
  if (accueil === undefined) return { possible: true };
  if (!accueil) return { possible: false, raison: RAISON_DEPLACEMENT_PROJET_INCONNU };

  if (accueil.id === carte.projetId) return { possible: false, raison: RAISON_DEPLACEMENT_MEME_PROJET };
  if (accueil.archived) return { possible: false, raison: RAISON_DEPLACEMENT_PROJET_RANGE };

  return { possible: true };
}

/**
 * LA LIGNE DÉPOSÉE DANS LE FIL ET LE JOURNAL, pour qu'on retrouve l'origine du
 * déplacement en relisant l'historique. Le texte est le même des deux côtés :
 * un seul endroit à traduire, un seul endroit à lire.
 */
export function phraseDeDeplacement(nomDuProjetDOrigine: string): string {
  return `Cette carte a été déplacée depuis le projet « ${nomDuProjetDOrigine} ».`;
}

/**
 * LA CARTE, TELLE QUE L'ÉCRAN LA CONNAÎT. Le tableau n'interroge pas la base :
 * il a la carte et ses agents en main. Cet adaptateur traduit ce qu'il voit
 * dans les termes de la règle, pour que le menu éteigne exactement ce que le
 * serveur refuserait.
 *
 * SEUL ÉCART CONNU, ET ASSUMÉ : une carte née d'une demande client AVANT que
 * `demandeClientId` n'existe n'est pas reconnue ici. Le serveur, lui, lit le
 * vrai lien (`demandes.carte_id`) et la refuse : le motif s'affiche alors au
 * clic au lieu d'éteindre l'entrée d'avance.
 */
export function candidatDepuisLaCarte(
  carte: {
    column: ColumnKey;
    projectId: string;
    github?: { branch?: string } | undefined;
    codeDejaEnregistre?: boolean;
    doneAt?: number;
    deployedAt?: number;
    archivedAt?: number;
    demandeClientId?: string;
  },
  contexte: { agentActif?: boolean; agentDeTache?: boolean } = {},
): CarteCandidateAuDeplacement {
  return {
    colonne: carte.column,
    projetId: carte.projectId,
    agentActif: contexte.agentActif,
    agentDeTache: contexte.agentDeTache,
    branche: carte.github?.branch,
    codeDejaEnregistre: carte.codeDejaEnregistre,
    doneAt: carte.doneAt,
    deployedAt: carte.deployedAt,
    archivedAt: carte.archivedAt,
    neeDUneDemandeClient: !!carte.demandeClientId,
  };
}
