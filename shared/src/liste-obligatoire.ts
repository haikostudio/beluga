/**
 * LA LISTE DE TÂCHES EST OBLIGATOIRE, ET C'EST L'OUTIL QUI LA TIENT.
 *
 * La consigne disait déjà « avant d'agir, annonce ta liste ». Mesuré le
 * 14/10/2026 sur sept jours d'agents de tâche : 77 tours sur 213 (36 %) qui
 * lançaient au moins cinq commandes ou modifications n'avaient annoncé AUCUNE
 * liste — tous sous Claude (Codex : 6 sur 6). L'utilisateur ne voyait alors que
 * la ligne des actions, jamais le volet de tâches. Une consigne seule ne tient
 * pas : le modèle prend le chemin le plus court que l'outil laisse ouvert.
 *
 * La règle est donc tenue par REFUS D'OUTIL, à l'appel : un crochet posé devant
 * les commandes et les modifications (`server/verrou-liste.mjs`) demande au
 * démon si le tour a annoncé sa liste. Tant que non :
 *
 *   - une MODIFICATION de fichier est refusée tout de suite ;
 *   - quelques COMMANDES de lecture passent (`COMMANDES_TOLEREES_SANS_LISTE`) :
 *     regarder avant de dresser la liste reste permis, et une simple réponse
 *     qui lance une ou deux commandes n'a pas de liste à tenir ;
 *   - au-delà, la commande est refusée, avec le geste qui lève le refus.
 *
 * Le refus ne coupe RIEN : ni le tour, ni la carte, ni la demande. L'agent lit
 * le refus comme résultat de son outil, annonce sa liste, et relance la même
 * commande. Couper le tour puis le relancer aurait perdu le travail en vol,
 * déplacé la carte et posé l'alerte des tours tombés.
 *
 * UN FILET BORNÉ contre la boucle : un agent qui ne PEUT pas obéir (outil de
 * liste absent, moteur qui l'ignore) est refusé `REFUS_AVANT_DE_LACHER` fois,
 * puis on le laisse passer pour le reste du tour — et le démon le trace.
 *
 * Les SOUS-AGENTS (aides de lecture) ne sont jamais retenus : la liste est
 * celle de l'agent principal, pas la leur.
 */

/** Les outils retenus tant que la liste n'est pas annoncée (vocabulaire du moteur Claude). */
export const OUTILS_DE_MODIFICATION = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const;
export const OUTILS_SOUS_LISTE = ['Bash', ...OUTILS_DE_MODIFICATION] as const;

/** Les commandes qu'on laisse passer sans liste : regarder avant de lister. */
export const COMMANDES_TOLEREES_SANS_LISTE = 4;

/** Au-delà de ce nombre de refus dans un tour, on lâche — jamais de boucle sans issue. */
export const REFUS_AVANT_DE_LACHER = 3;

export interface EtatDeLaListeObligatoire {
  /** Le tour a-t-il une liste (annoncée ce tour-ci, ou reprise d'un tour coupé) ? */
  listeAnnoncee: boolean;
  /** Commandes déjà laissées passer sans liste. */
  commandesSansListe: number;
  /** Refus déjà opposés dans ce tour. */
  refus: number;
  /** Le filet a lâché : plus aucun refus jusqu'à la fin du tour. */
  lache: boolean;
}

export const ETAT_INITIAL_DE_LA_LISTE: EtatDeLaListeObligatoire = {
  listeAnnoncee: false,
  commandesSansListe: 0,
  refus: 0,
  lache: false,
};

export interface AppelSousListe {
  /** Le nom de l'outil tel que le moteur le donne au crochet. */
  outil: string;
  /** L'appel vient d'un sous-agent (champ `agent_id` de l'entrée du crochet). */
  sousAgent?: boolean;
}

export type GesteDeLaListe = 'passer' | 'refuser' | 'lacher';

export interface DecisionDeLaListe {
  geste: GesteDeLaListe;
  /** Le texte rendu à l'agent quand on refuse. */
  texte: string;
  /** L'état du tour APRÈS cet appel. */
  etat: EtatDeLaListeObligatoire;
}

/** Le texte du refus : il porte toutes les issues, chacune à la main de l'agent. */
export const REFUS_SANS_LISTE =
  "Refusé par Beluga Build : annonce d'abord ta liste de tâches avec l'outil « TaskCreate » " +
  '(une ligne par action prévue, puis « TaskUpdate » pour passer la première « en cours »), ' +
  'puis relance exactement cette action. Si TaskCreate n’est pas encore chargé, charge-le avec ' +
  'ToolSearch « select:TaskCreate,TaskUpdate », qui reste permis. Lire (Read, Grep, Glob, outil « memoire ») ' +
  "reste libre. Ce refus est une étape de méthode, pas une panne : n'en parle pas dans ta réponse.";

/**
 * L'agent de ce tour est-il tenu de lister ? L'agent de TÂCHE et l'assistant
 * Beluga (un agent ordinaire en accès complet depuis le 18/10/2026) reçoivent
 * le déroulé visible dans leur consigne : un dépannage de publication est prié
 * de NE PAS lister, les assistants de service (Studio, Marketing, surveillance,
 * sauvegardes) ont leur propre consigne, le cadrage ne modifie rien.
 */
export function listeObligatoirePourLeTour(contexte: {
  role: string;
  motif?: string | null;
  assistantGlobal?: boolean;
}): boolean {
  if (contexte.assistantGlobal) return true;
  if (contexte.role !== 'task') return false;
  return !contexte.motif;
}

/** Juge UN appel d'outil retenu par le crochet, et rend l'état du tour après lui. */
export function jugerLaListeObligatoire(
  etat: EtatDeLaListeObligatoire,
  appel: AppelSousListe,
): DecisionDeLaListe {
  const passer = (suite: EtatDeLaListeObligatoire = etat): DecisionDeLaListe => ({
    geste: 'passer',
    texte: '',
    etat: suite,
  });
  if (etat.listeAnnoncee || etat.lache || appel.sousAgent) return passer();
  if (!(OUTILS_SOUS_LISTE as readonly string[]).includes(appel.outil)) return passer();

  const modification = (OUTILS_DE_MODIFICATION as readonly string[]).includes(appel.outil);
  if (!modification && etat.commandesSansListe < COMMANDES_TOLEREES_SANS_LISTE) {
    return passer({ ...etat, commandesSansListe: etat.commandesSansListe + 1 });
  }
  if (etat.refus >= REFUS_AVANT_DE_LACHER) {
    return { geste: 'lacher', texte: '', etat: { ...etat, lache: true } };
  }
  return { geste: 'refuser', texte: REFUS_SANS_LISTE, etat: { ...etat, refus: etat.refus + 1 } };
}

/**
 * Le crochet du moteur Claude : posé devant les commandes et les modifications,
 * il demande au démon, À L'APPEL, si la liste est annoncée.
 */
export function hooksDuVerrouDeListe(cheminDuVerrou: string): { PreToolUse: unknown[] } {
  return {
    PreToolUse: [
      {
        matcher: OUTILS_SOUS_LISTE.join('|'),
        hooks: [{ type: 'command', command: `node ${cheminDuVerrou}` }],
      },
    ],
  };
}
