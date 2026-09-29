import { COLONNES_AVANT_LE_TRAVAIL, type ColumnKey } from './columns.js';
import { COLONNES_HORS_REPRISE } from './suivi-colonne.js';

/**
 * Le voyant d'une carte, au bout de son titre.
 *
 * Une carte reste dans « En cours » même quand son agent a fini : la clôture
 * est un geste de l'utilisateur. Un simple point gris ne disait donc pas la
 * différence entre « personne n'y touche » et « c'est fait, venez voir ». La
 * coche verte dit ce moment-là, et une relance repasse à la roue qui tourne.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

export interface EtatVisuelEntree {
  /** Statut de l'agent de la carte, s'il y en a un. */
  agentStatut?: 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'done';
  /** Un agent de la carte travaille, sans être celui qu'elle a retenu. */
  analyseEnCours?: boolean;
  /** La carte attend quelque chose (heure creuse, place libre, réponse). */
  enAttente?: boolean;
  /** Le chiffrage s'est terminé sans chiffres exploitables. */
  estimationEchouee?: boolean;
  /** La carte est en ligne. */
  enLigne?: boolean;
  /**
   * L'agent est ARRÊTÉ SUR SA QUESTION (`Agent.attendReponse`). Son tour vit
   * encore — l'outil `ask_user` bloque jusqu'à la réponse —, mais il n'est en
   * travail pour personne : la carte ne tourne pas, elle attend.
   */
  attendReponse?: boolean;
}

export type EtatVisuelCarte =
  | 'question'
  | 'travaille'
  | 'echec'
  | 'attente'
  | 'termine'
  | 'enligne'
  | 'repos';

export function etatVisuelCarte(entree: EtatVisuelEntree): EtatVisuelCarte {
  // Une question ouverte passe devant le travail : le tour vit, mais il attend vous.
  if (entree.attendReponse) return 'question';
  // Ce qui tourne prime sur tout le reste : c'est l'information la plus fraîche.
  if (entree.agentStatut === 'running' || entree.agentStatut === 'starting') return 'travaille';
  if (entree.analyseEnCours) return 'travaille';

  if (entree.agentStatut === 'failed' || entree.estimationEchouee) return 'echec';
  if (entree.enAttente) return 'attente';

  /* L'agent a rendu son résultat. La LECTURE ne pèse plus ici : la pastille
     « rendu non consulté » est un repère à part, posé par sa propre règle
     (`carteNonLue`, `travail-rendu.ts`), et l'état visuel ne dit que
     l'avancement. */
  if (entree.agentStatut === 'done') return 'termine';

  if (entree.enLigne) return 'enligne';
  // « stopped » et « idle » ne sont pas des fins : rien n'a été rendu.
  return 'repos';
}

/* ------------------------------------------------------------------ */
/* Les gestes de décision                                              */
/* ------------------------------------------------------------------ */

/**
 * Un bouton ne doit pas exister avant d'avoir du sens. « Terminer la tâche »
 * s'affichait dès l'entrée en colonne « En cours », donc pendant que l'agent
 * travaillait encore : on pouvait sauter une étape et clôturer une carte dont
 * personne n'avait lu la réponse.
 */
export type GesteCarte = 'valider' | 'lancer' | 'terminer' | 'publier' | 'reprendre';

export interface ContexteGeste {
  colonne: string;
  /** L'état visuel de la carte, tel que le voyant le montre. */
  etat: EtatVisuelCarte;
  /** Un agent a-t-il déjà travaillé sur cette carte ? */
  agentLance?: boolean;
  /**
   * La carte a-t-elle DÉJÀ son chiffrage, ou l'a-t-elle déjà demandé ? C'est ce
   * qui décide de l'existence du bouton « Valider (autorise la dépense) » :
   * autoriser deux fois la même dépense n'aurait pas de sens, et une analyse
   * refaite passe par le geste rare « Relancer l'analyse ».
   */
  chiffree?: boolean;
}

export interface DecisionGeste {
  /** Le geste a-t-il sa place ici ? Faux : le bouton ne s'affiche pas du tout. */
  affiche: boolean;
  /** Le geste est-il permis maintenant ? Faux : le bouton s'affiche, éteint. */
  possible: boolean;
  /** Pourquoi il est éteint, dit à l'utilisateur. */
  raison?: string;
}

const ABSENT: DecisionGeste = { affiche: false, possible: false };

/**
 * Le tour de l'agent vit-il encore ? Une carte arrêtée sur sa question ne
 * TRAVAILLE pas à l'écran, mais son tour est ouvert : les gestes qui
 * supposeraient un tour rendu restent fermés.
 */
function tourVivant(etat: EtatVisuelCarte): boolean {
  return etat === 'travaille' || etat === 'question';
}

export function gesteCarte(geste: GesteCarte, ctx: ContexteGeste): DecisionGeste {
  switch (geste) {
    case 'valider':
      /*
       * Autoriser la dépense se fait depuis « Planifié », la colonne où la carte
       * naît, et de nulle part ailleurs. Le geste ne déplace rien : il lance le
       * chiffrage SUR PLACE. Une carte déjà chiffrée — ou dont le chiffrage est
       * en route — n'affiche plus le bouton : il n'y a plus rien à autoriser.
       */
      if (!COLONNES_AVANT_LE_TRAVAIL.includes(ctx.colonne as ColumnKey)) return ABSENT;
      return ctx.chiffree ? ABSENT : { affiche: true, possible: true };

    case 'lancer':
      /* Un lancement part de « Demande » COMME de « Plan » : la carte attend
         le clic dans les deux colonnes du cadrage. */
      if (!COLONNES_AVANT_LE_TRAVAIL.includes(ctx.colonne as ColumnKey)) return ABSENT;
      return tourVivant(ctx.etat)
        ? { affiche: true, possible: false, raison: 'Un agent travaille déjà sur cette carte.' }
        : { affiche: true, possible: true };

    case 'terminer':
      if (ctx.colonne !== 'running') return ABSENT;
      if (tourVivant(ctx.etat)) {
        return {
          affiche: true,
          possible: false,
          raison: 'L’agent travaille encore : attendez qu’il ait rendu sa réponse.',
        };
      }
      // Rien n'a jamais tourné : il n'y a pas de travail à clôturer.
      if (!ctx.agentLance) {
        return {
          affiche: true,
          possible: false,
          raison: 'Aucun agent n’a encore travaillé sur cette carte.',
        };
      }
      return { affiche: true, possible: true };

    case 'publier':
      // Une carte rendue tombe déjà directement dans « À déployer » : il n'y a
      // plus de geste « publier » distinct de la clôture — la colonne
      // « Terminé » qui le justifiait a disparu.
      return ABSENT;

    case 'reprendre':
      /*
       * Sortir une carte d'une fin de parcours. Le bouton n'existe QUE là, et
       * c'est le seul chemin volontaire : la règle par défaut reste que rien
       * ne ressort tout seul de « Archivé » ni de « À déployer ».
       */
      return COLONNES_HORS_REPRISE.includes(ctx.colonne as ColumnKey)
        ? { affiche: true, possible: true }
        : ABSENT;

    default:
      return ABSENT;
  }
}

/**
 * Peut-on SORTIR cette carte de sa colonne ? Le glisser-déposer doit obéir aux
 * mêmes règles que les boutons : emporter une carte hors de « En cours »
 * pendant que son agent écrit, c'est perdre le fil de son travail.
 */
export function sortieAutorisee(ctx: ContexteGeste, vers: string): DecisionGeste {
  if (ctx.colonne === vers) return { affiche: true, possible: true };
  /*
   * Une seule sortie est permise pendant que l'agent écrit : le retour en
   * « Planifié ». Ce n'est pas un déplacement de rangement, c'est la demande
   * de SUSPENDRE — le tour est arrêté proprement, la carte reste en file.
   * Toutes les autres destinations perdraient le fil du travail en cours.
   */
  if (ctx.colonne === 'running' && vers === 'planned') return { affiche: true, possible: true };
  if (ctx.colonne === 'running' && tourVivant(ctx.etat)) {
    return {
      affiche: true,
      possible: false,
      raison: 'L’agent travaille encore sur cette carte : arrêtez-le avant de la déplacer.',
    };
  }
  return { affiche: true, possible: true };
}
