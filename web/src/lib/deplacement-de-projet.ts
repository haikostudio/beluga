import * as React from 'react';
import {
  candidatDepuisLaCarte,
  deplacementVersProjetPossible,
  membresActifsDuRegroupement,
  projetsEnArbre,
  type Card,
  type Project,
  type ProjectGroup,
  type VerdictDeplacementProjet,
} from '@beluga/shared';
import type { AppState } from '@/lib/client';

/**
 * CHANGER UNE CARTE DE PROJET, CÔTÉ ÉCRAN.
 *
 * Les deux gestes — l'entrée du menu et le dépôt sur une ligne de la colonne de
 * gauche — lisent d'ici : même liste de destinations, même verdict, mêmes
 * motifs. La RÈGLE, elle, n'est pas réécrite : c'est celle du serveur
 * (`shared/src/deplacement-de-projet.ts`).
 */

export interface DestinationDeCarte {
  projet: Project;
  /** Le groupe de la colonne de gauche où ce projet est rangé, s'il en a un. */
  groupe?: ProjectGroup;
  verdict: VerdictDeplacementProjet;
  /** Le projet réuni sous lequel cette destination est rangée, s'il y en a un. */
  parentId?: string;
  /** Premier, dernier membre affiché sous son projet réuni : de quoi dessiner la branche. */
  premier: boolean;
  dernier: boolean;
}

/** Un agent d'EXÉCUTION a-t-il déjà existé pour cette carte ? */
function aUnAgentDeTache(state: AppState, card: Card): boolean {
  return Object.values(state.agents).some((agent) => agent.cardId === card.id && agent.role === 'task');
}

/**
 * CETTE CARTE PEUT-ELLE PARTIR, TOUT COURT ? C'est ce que lit le menu pour
 * éteindre son entrée avant même de dérouler les destinations, et le tableau
 * pour savoir s'il vaut la peine d'éclairer une ligne de projet.
 */
export function verdictDeDepart(
  state: AppState,
  card: Card,
  contexte: { agentActif?: boolean } = {},
): VerdictDeplacementProjet {
  return deplacementVersProjetPossible(
    candidatDepuisLaCarte(card, { agentActif: contexte.agentActif, agentDeTache: aUnAgentDeTache(state, card) }),
  );
}

/** Le verdict pour UNE destination nommée. */
export function verdictVersProjet(
  state: AppState,
  card: Card,
  projet: Project | undefined | null,
  contexte: { agentActif?: boolean } = {},
): VerdictDeplacementProjet {
  return deplacementVersProjetPossible(
    candidatDepuisLaCarte(card, { agentActif: contexte.agentActif, agentDeTache: aUnAgentDeTache(state, card) }),
    projet ?? null,
  );
}

/**
 * LES DESTINATIONS, RANGÉES COMME LA COLONNE DE GAUCHE : les projets hors
 * groupe et les groupes mêlés par rang, les membres d'un groupe à la suite du
 * leur, et les membres actifs d'un PROJET RÉUNI juste sous lui — ils ne se
 * rangent plus eux-mêmes (`projetsEnArbre` dit ensuite qui est sous qui). Le
 * projet COURANT en fait partie — il s'affiche éteint, avec son motif,
 * plutôt que de disparaître : une liste dont un élément manque se lit moins
 * bien qu'une liste complète dont une ligne est grisée.
 */
export function destinationsDeCarte(
  state: AppState,
  card: Card,
  contexte: { agentActif?: boolean } = {},
): DestinationDeCarte[] {
  const candidat = candidatDepuisLaCarte(card, {
    agentActif: contexte.agentActif,
    agentDeTache: aUnAgentDeTache(state, card),
  });
  /*
   * TOUS les projets actifs, l'espace de développement de Beluga Build COMPRIS.
   * Il était écarté de la liste avant même qu'on applique la règle : une carte
   * ouverte au mauvais endroit ne pouvait plus y être ramenée, et le menu ne
   * disait même pas pourquoi. Il suit désormais le sort commun — proposé quand
   * le déplacement est permis, grisé avec son motif sinon.
   */
  const actifs = state.projects.filter((projet) => !projet.archived);
  const groupes = state.groups;
  const rang = (valeur: number | undefined) => valeur ?? 1000;

  /*
   * L'ESPACE DE DÉVELOPPEMENT GARDE SA PLACE : la colonne de gauche l'ancre en
   * TÊTE, hors du rangement et hors des groupes. La liste des destinations le
   * pose donc en premier elle aussi, pour qu'on le retrouve où on le voit.
   */
  const espaceDev = actifs.find((projet) => projet.isSelf);

  /*
   * LES MEMBRES D'UN PROJET RÉUNI LE SUIVENT, comme dans la colonne : ils sortent
   * du rangement (leur propre rang et leur propre groupe ne comptent plus) et se
   * posent sous lui, par rang. Un membre dont le projet réuni est mis de côté
   * reste rangeable, en ligne ordinaire.
   */
  const reunis = new Set(actifs.filter((projet) => projet.regroupement).map((projet) => projet.id));
  const rangeables = actifs.filter(
    (projet) => !projet.isSelf && !(projet.regroupementId && reunis.has(projet.regroupementId)),
  );
  const avecMembres = (projet: Project): Project[] => [
    projet,
    ...(reunis.has(projet.id) ? membresActifsDuRegroupement(actifs, projet.id) : []),
  ];

  const groupeDe = new Map<string, ProjectGroup>();
  const entrees: { rang: number; projets: Project[] }[] = [];
  for (const projet of rangeables) {
    if (projet.groupId && groupes.some((groupe) => groupe.id === projet.groupId)) continue;
    entrees.push({ rang: rang(projet.rank), projets: avecMembres(projet) });
  }
  for (const groupe of groupes) {
    const membres = rangeables
      .filter((projet) => projet.groupId === groupe.id)
      .sort((a, b) => rang(a.rank) - rang(b.rank));
    for (const projet of membres) groupeDe.set(projet.id, groupe);
    if (membres.length) entrees.push({ rang: rang(groupe.rank), projets: membres.flatMap(avecMembres) });
  }

  return projetsEnArbre([
    ...(espaceDev ? [espaceDev] : []),
    ...entrees.sort((a, b) => a.rang - b.rang).flatMap((entree) => entree.projets),
  ]).map(({ projet, parentId, premier, dernier }) => ({
    projet,
    groupe: groupeDe.get(projet.id),
    verdict: deplacementVersProjetPossible(candidat, projet),
    parentId,
    premier,
    dernier,
  }));
}

/* ------------------------------------------------------------------ *
 * LE GLISSEMENT D'UNE CARTE VERS LA COLONNE DE GAUCHE
 * ------------------------------------------------------------------ */

/**
 * LE TABLEAU TIENT LA CARTE, LA COLONNE DE GAUCHE DOIT LE SAVOIR.
 *
 * Les deux vivent dans des composants distincts, et il n'est pas question
 * d'ouvrir un SECOND mécanisme de glissement dans la colonne (contrat : un
 * seul `usePointerDrag` dans l'application). Le tableau publie donc ici ce
 * qu'il tient et ce qu'il vise ; la colonne s'abonne et se contente
 * d'ÉCLAIRER la ligne visée.
 *
 * Volontairement hors du magasin général de l'application : cette information
 * change à chaque pixel parcouru, et la frappe au clavier comme le tableau
 * n'ont rien à redessiner pour autant.
 */
export interface GlissementDeCarte {
  cardId: string;
  /** Le projet d'où part la carte : sa propre ligne ne s'éclaire pas. */
  projetSource: string;
  /** La ligne de projet actuellement visée, s'il y en a une. */
  cibleProjetId?: string;
  /** Le dépôt est-il permis sur cette ligne ? Faux : la ligne reste inerte. */
  cibleAcceptee?: boolean;
}

let glissement: GlissementDeCarte | null = null;
const abonnes = new Set<() => void>();

export function poserLeGlissementDeCarte(valeur: GlissementDeCarte | null): void {
  const memeCible =
    glissement?.cardId === valeur?.cardId &&
    glissement?.cibleProjetId === valeur?.cibleProjetId &&
    glissement?.cibleAcceptee === valeur?.cibleAcceptee;
  if (memeCible) return;
  glissement = valeur;
  for (const abonne of abonnes) abonne();
}

function sAbonner(abonne: () => void): () => void {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

const lire = () => glissement;

/** La colonne de gauche lit ici la carte en vol et la ligne qu'elle vise. */
export function useGlissementDeCarte(): GlissementDeCarte | null {
  return React.useSyncExternalStore(sAbonner, lire, lire);
}
