/**
 * ARRÊTER DEPUIS UNE CARTE N'ARRÊTE QUE SA TÂCHE.
 *
 * Le bouton « Arrêter l'action en cours » vit dans la bande du fil, y compris
 * dans le tiroir d'une carte. L'agent qu'il vise y était choisi par une cascade
 * de replis (l'agent de la carte, sinon l'agent actif de la conversation, sinon
 * le dernier agent connu) : quand le premier maillon manquait, le bouton
 * pointait un agent qui ne travaillait PLUS pour cette carte, et c'est une
 * autre tâche qui s'arrêtait — sans que rien ne le dise.
 *
 * La règle vit ici, sans base ni réseau : le navigateur s'en sert pour ne pas
 * MONTRER un faux bouton, le démon pour REFUSER un arrêt qui ne lui appartient
 * pas. Un seul texte, donc la même réponse aux deux bouts.
 */

/** Ce que le navigateur sait de l'agent visé. */
export interface AgentVise {
  id: string;
  /** La carte à laquelle cet agent appartient, s'il en a une. */
  cardId?: string;
}

export interface VerdictArret {
  /** L'arrêt peut-il partir ? Faux : pas de bouton, et refus côté démon. */
  possible: boolean;
  /** Pourquoi il ne part pas, dit à l'utilisateur. */
  raison?: string;
}

export const RAISON_ARRET_SANS_AGENT = "Aucun agent ne travaille pour cette carte : il n'y a rien à arrêter.";

export const RAISON_ARRET_ETRANGER =
  "Cet agent ne travaille pas pour cette carte : l'arrêter couperait une autre tâche.";

/**
 * Peut-on arrêter `agent` depuis le tiroir de la carte `carte` ?
 *
 * Sans carte annoncée (conversation du chef, par exemple), la question ne se
 * pose pas : le geste vaut pour l'agent qu'on regarde.
 */
export function arretDeCarteAutorise(entree: { carte?: string | null; agent?: AgentVise | null }): VerdictArret {
  const { carte, agent } = entree;
  if (!agent) return { possible: false, raison: RAISON_ARRET_SANS_AGENT };
  if (!carte) return { possible: true };
  if (agent.cardId !== carte) return { possible: false, raison: RAISON_ARRET_ETRANGER };
  return { possible: true };
}

/** Ce que la barre d'écriture montre au coin bas-droit, à un instant donné. */
export interface BoutonsBarre {
  /** Le carré rouge d'arrêt, à côté ou à la place de la flèche. */
  arret: boolean;
  /** La flèche d'envoi (ou la coche, en cours de modification). */
  envoi: boolean;
}

/**
 * QUE MONTRE LA BARRE D'ÉCRITURE PENDANT QU'UN AGENT TRAVAILLE ?
 *
 * L'arrêt ne vivait que sur la bande « en cours », tout en haut du fil : dans
 * une longue conversation, il fallait remonter hors de l'écran pour couper.
 * Le bouton d'envoi devient donc un bouton d'ARRÊT tant que l'agent écrit.
 *
 * Trois règles, et rien d'autre :
 *   - en cours de MODIFICATION d'un message en attente, le bouton enregistre
 *     la modification : l'arrêt ne lui vole pas sa place ;
 *   - l'arrêt ne s'affiche que s'il est PERMIS (`arretDeCarteAutorise`) —
 *     pas de bouton plutôt qu'un faux ;
 *   - du texte en cours de saisie garde l'envoi : l'arrêt se pose À CÔTÉ,
 *     jamais par-dessus une phrase qu'on vient d'écrire.
 */
export function boutonsBarreEcriture(entree: {
  /** Un agent travaille-t-il en ce moment ? */
  occupe: boolean;
  /** Le verdict de `arretDeCarteAutorise` pour l'agent affiché. */
  arretPossible: boolean;
  /** Du texte, ou des évolutions cochées, prêts à partir. */
  aDuTexte: boolean;
  /** Un message en attente est ouvert en modification. */
  enEdition: boolean;
}): BoutonsBarre {
  const { occupe, arretPossible, aDuTexte, enEdition } = entree;
  if (enEdition) return { arret: false, envoi: true };
  const arret = occupe && arretPossible;
  return { arret, envoi: !arret || aDuTexte };
}

/**
 * La phrase portée par la carte dont on vient d'arrêter l'agent. Elle dit les
 * deux choses qu'on veut savoir en la relisant : le tour a été coupé, et rien
 * ne repartira tout seul derrière — ni un message resté en file, ni
 * l'ordonnanceur.
 */
export const RAISON_ARRETE_A_LA_MAIN =
  'Agent arrêté à la main : la file est vidée, la carte ne repartira que sur votre geste.';

/**
 * OÙ VA LA CARTE DONT ON VIENT D'ARRÊTER L'AGENT ?
 *
 * Le bouton d'arrêt ne changeait que la PHRASE de la carte : elle restait dans
 * « En cours », sans agent au travail et sans rien qui viendrait la ranger — le
 * balayage de l'ordonnanceur (`issueDeCarteOubliee`) s'interdit justement d'y
 * toucher quand le dernier tour s'est arrêté. Le tableau montrait donc une
 * tâche « en cours » que plus rien ne faisait avancer.
 *
 * Or le MÊME geste existait déjà ailleurs, et lui rangeait la carte : sortir
 * une carte de « En cours » vers « Planifié » à la souris (`effetDuDepot`,
 * effet « suspendre »). Deux chemins pour un seul geste, deux résultats
 * différents. Le bouton suit maintenant la souris : la carte retombe en
 * « Planifié », suspendue, et n'en repartira que sur un geste.
 *
 * Une carte qui n'était pas en « En cours » ne bouge pas : il n'y a rien à
 * ramener en arrière.
 */
export function colonneApresArretALaMain(colonne: string): 'planned' | null {
  return colonne === 'running' ? 'planned' : null;
}
