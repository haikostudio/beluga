import {
  deplacementVersProjetPossible,
  phraseDeDeplacement,
  type Card,
  type CarteCandidateAuDeplacement,
  type Project,
} from '@beluga/shared';
import { bus } from './bus.js';
import { getDb } from './db.js';
import { ajouterAuJournal, phaseDeLaCarte } from './journal-carte.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * RATTACHER UNE CARTE À UN AUTRE PROJET.
 *
 * Se tromper de projet à la création coûtait la carte entière : il fallait la
 * recréer ailleurs et reperdre tout le cadrage déjà écrit. Le geste existe
 * désormais — mais il ne vaut QUE tant que rien n'a été exécuté, parce que la
 * branche `tache/…` et la copie de travail d'une carte lancée appartiennent au
 * dépôt de son projet d'origine et ne peuvent pas la suivre (la règle et ses
 * motifs : `shared/src/deplacement-de-projet.ts`).
 *
 * TOUT PART ENSEMBLE, OU RIEN NE BOUGE. Une carte à moitié déplacée — la carte
 * ici, sa conversation là — serait pire que pas de déplacement du tout : une
 * seule transaction porte la carte, ses agents, ses commentaires et ses pièces
 * jointes. Le journal et les étiquettes, eux, ne portent pas de projet : ils
 * pendent à la carte et la suivent sans être touchés.
 *
 * CE QUI NE SUIT PAS, ET C'EST VOULU : la DÉPENSE déjà engagée (`usage`,
 * `telemetrie_tache`) reste comptée au projet d'origine — elle a bien eu lieu
 * là-bas, et la déplacer fausserait les deux bilans.
 */

export interface ResultatDeplacement {
  ok: boolean;
  error?: string;
  card?: Card;
  /** Le projet quitté, pour que l'écran puisse le nommer. */
  depuis?: Project;
  vers?: Project;
}

/**
 * CE QUE LA BASE SAIT DE LA CARTE, traduit dans les termes de la règle. Un seul
 * endroit lit la base ; la règle, elle, reste pure et testable seule.
 */
export function etatDeplacementDeLaCarte(
  card: Card,
  /**
   * L'AGENT DE CADRAGE QUI DEMANDE LE DÉPLACEMENT LUI-MÊME. Son propre tour
   * tourne pendant l'appel : lui seul ne compte pas comme « agent au travail ».
   * Tout autre agent actif — et tout agent de tâche, actif ou non — bloque
   * toujours (DEC-236).
   */
  agentAppelantId?: string,
): CarteCandidateAuDeplacement {
  const db = getDb();
  const agents = store
    .listAgents()
    .filter((agent) => agent.cardId === card.id || agent.id === card.agentId);
  const agentActif = agents.some(
    (agent) =>
      (agent.status === 'running' || agent.status === 'starting') &&
      !(agentAppelantId && agent.id === agentAppelantId && agent.role === 'cadrage'),
  );
  const agentDeTache = agents.some((agent) => agent.role === 'task');
  const demande = db.prepare('SELECT 1 AS n FROM demandes WHERE carte_id = ? LIMIT 1').get(card.id) as
    | { n: number }
    | undefined;

  return {
    colonne: card.column,
    projetId: card.projectId,
    agentActif,
    agentDeTache,
    branche: card.github?.branch,
    codeDejaEnregistre: card.codeDejaEnregistre,
    doneAt: card.doneAt,
    deployedAt: card.deployedAt,
    archivedAt: card.archivedAt,
    neeDUneDemandeClient: !!demande || !!card.demandeClientId,
  };
}

/**
 * LE DÉPLACEMENT LUI-MÊME. Rend un refus MOTIVÉ plutôt qu'une exception : les
 * deux mains qui l'appellent (le menu, le glissement) affichent ce motif tel
 * quel.
 */
export function deplacerLaCarteVersProjet(
  cardId: string,
  projetCibleId: string,
  options: {
    /** L'agent de cadrage qui déplace sa propre carte (`deplacer_vers_projet`). */
    agentAppelantId?: string;
    /** La ligne du journal, quand elle n'est pas la phrase du geste à la main. */
    phrase?: (depuis: string, vers: string) => string;
  } = {},
): ResultatDeplacement {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'Carte introuvable.' };

  const source = store.getProject(card.projectId);
  const cible = store.getProject(projetCibleId);
  const verdict = deplacementVersProjetPossible(etatDeplacementDeLaCarte(card, options.agentAppelantId), cible);
  if (!verdict.possible) return { ok: false, error: verdict.raison ?? 'Déplacement refusé.' };
  if (!cible) return { ok: false, error: 'Ce projet d’accueil est introuvable.' };

  const db = getDb();
  const agents = store.listAgents().filter((agent) => agent.cardId === card.id || agent.id === card.agentId);
  /* La carte arrive en FIN de sa colonne dans le projet d'accueil : elle garde
     son étape, elle ne recommence pas son parcours. */
  const position = store.nextPosition(projetCibleId, card.column);

  let deplacee: Card | null = null;
  try {
    db.transaction(() => {
      deplacee = store.saveCard({ ...card, projectId: projetCibleId, position });

      for (const agent of agents) {
        store.saveAgent({ ...agent, projectId: projetCibleId });
        /*
         * `saveAgent` NE RÉÉCRIT PAS `agents.project_id` : sa clause de conflit
         * ne touche que le statut, la carte, la session et le blob. Le projet
         * d'un agent ne changeait jamais — jusqu'ici. Sans cette ligne, le blob
         * dirait le nouveau projet et la COLONNE l'ancien, et `listAgents` (qui
         * filtre sur la colonne) laisserait l'agent dans le projet de départ.
         */
        db.prepare('UPDATE agents SET project_id = ? WHERE id = ?').run(projetCibleId, agent.id);
        /*
         * LA SESSION DU MOTEUR EST REFERMÉE. Le fil garde tout son contenu, mais
         * le message suivant doit repartir sur l'accueil du NOUVEAU projet — ses
         * règles, sa mémoire, son code. Sans ce geste, le moteur reprendrait la
         * conversation avec le CLAUDE.md et la base de connaissances de
         * l'ancien (même raisonnement que DEC-035 : une session qui ne vaut plus
         * s'efface AVANT le tour suivant).
         */
        store.clearSessions(agent.id);
      }

      db.prepare('UPDATE card_comments SET project_id = ? WHERE card_id = ?').run(projetCibleId, card.id);

      /*
       * Les pièces jointes portent leur projet en colonne ET dans leur blob :
       * les deux se réécrivent, sinon la pièce se lirait dans un projet et se
       * chercherait dans l'autre. Le FICHIER, lui, ne bouge pas : le dossier
       * `data/attachments` est commun à tous les projets.
       */
      db.prepare(
        `UPDATE attachments
            SET project_id = ?,
                data = json_set(data, '$.projectId', ?)
          WHERE json_extract(data, '$.cardId') = ?`,
      ).run(projetCibleId, projetCibleId, card.id);
      if (agents.length) {
        const trous = agents.map(() => '?').join(',');
        db.prepare(
          `UPDATE attachments
              SET project_id = ?,
                  data = json_set(data, '$.projectId', ?)
            WHERE json_extract(data, '$.agentId') IN (${trous})`,
        ).run(projetCibleId, projetCibleId, ...agents.map((a) => a.id));
      }
    })();
  } catch (err: any) {
    log.error('déplacement de carte vers un autre projet impossible', err);
    return { ok: false, error: `Le déplacement a échoué : ${err?.message ?? 'erreur inconnue'}` };
  }

  const carte = deplacee as Card | null;
  if (!carte) return { ok: false, error: 'Le déplacement a échoué.' };

  /* D'OÙ VIENT CETTE CARTE — une ligne dans le journal, pour qu'on retrouve
     l'origine du déplacement en relisant l'historique. */
  const jalon = ajouterAuJournal({
    cardId: carte.id,
    phase: phaseDeLaCarte(carte.id, agents[0]?.role),
    nature: 'jalon',
    libelle: 'Changement de projet',
    resultat: options.phrase
      ? options.phrase(source?.name ?? 'projet inconnu', cible.name)
      : phraseDeDeplacement(source?.name ?? 'projet inconnu'),
    reussie: true,
  });

  diffuserLeDeplacement(carte, card.projectId, jalon);
  return { ok: true, card: carte, depuis: source ?? undefined, vers: cible };
}

/**
 * LES DEUX TABLEAUX SE REMETTENT À JOUR, SANS RECHARGEMENT.
 *
 * UN SEUL ÉVÉNEMENT porte le changement (`card.deplacee`). Un `card.delete`
 * suivi d'un `card.upsert` aurait laissé, entre les deux rendus, une carte qui
 * n'existe dans AUCUN projet — et le tiroir ouvert dessus se serait refermé
 * tout seul. Ici, le magasin corrige les deux compteurs de colonne d'un coup et
 * la carte ne disparaît jamais.
 */
function diffuserLeDeplacement(carte: Card, ancienProjet: string, jalon: unknown): void {
  bus.emit({ type: 'card.deplacee', card: carte, depuisProjectId: ancienProjet });
  for (const agent of store.listAgents(carte.projectId)) {
    if (agent.cardId === carte.id || agent.id === carte.agentId) bus.emit({ type: 'agent.upsert', agent });
  }
  if (jalon) bus.emit({ type: 'journal.entree', entree: jalon as any });
  /* Pastilles et repères des DEUX projets : les comptes sont globaux, une seule
     diffusion les remet d'aplomb des deux côtés. */
  bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
  bus.emit({ type: 'attention', ...store.signalAttention() });
}
