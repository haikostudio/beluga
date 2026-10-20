/**
 * LE FIL D'UN AGENT SANS CARTE, DESSINÉ COMME CELUI D'UNE CARTE (demande de
 * l'utilisateur du 19/10/2026 : « tous les agents, partout, comme les agents de
 * tâche »). Règle PURE.
 *
 * Un agent sans carte (configuration du déploiement, Studio, surveillance,
 * assistant…) n'écrit pas de journal de carte : ses tours vivent dans ses
 * MESSAGES, chacun avec ses étapes (`RunStep`) et sa liste de tâches
 * (`TodoItem`). Le fil d'une carte, lui, se dessine à partir d'entrées de
 * journal (`EntreeJournal`). Plutôt que de garder deux dessins du même travail,
 * on relit le tour d'un message comme le journal que le démon aurait écrit pour
 * une carte (`journaliserDansLeTour`, `server/src/runtime.ts`) :
 *  - une étape TERMINÉE devient une REQUÊTE (outil brut, paramètres, résultat,
 *    durée) — la question posée par « ask_user » comprise, avec sa réponse ;
 *  - chaque ligne de la liste de tâches devient un POINT, une entrée par état
 *    franchi, posée à l'heure où elle l'a franchi ; c'est ce qui range chaque
 *    action sous la tâche en cours (`travailEnSousPoints`).
 *
 * Les champs qui n'ont pas de sens ici sont NEUTRES, jamais inventés : aucune
 * carte (`cardId` vide), et le rang suit l'ordre du temps.
 */

import type { EntreeJournal } from './journal-carte.js';
import type { RunStep, TodoItem } from './models.js';

export interface TourDUnMessage {
  id: string;
  agentId?: string;
  createdAt: number;
  steps: readonly RunStep[];
  todos?: readonly TodoItem[];
}

/** Les étapes que le fil ne montre pas (la mémoire relue se lit ailleurs). */
export type FiltreDesEtapes = (step: RunStep) => boolean;

export function entreesDuTourSansCarte(message: TourDUnMessage, garder: FiltreDesEtapes = () => true): EntreeJournal[] {
  const brutes: Array<Omit<EntreeJournal, 'rang'> & { ordre: number }> = [];
  let ordre = 0;
  const commun = {
    cardId: '',
    phase: 'execution' as const,
    ...(message.agentId ? { agentId: message.agentId } : {}),
    tourId: message.id,
  };

  const todos = message.todos ?? [];
  /* La liste se dit ANNONCÉE quand sa première ligne démarre : ce que l'agent a
     fait avant tombe sous « Réflexion », comme sur une carte. */
  const departs = todos.map((todo) => todo.startedAt).filter((at): at is number => typeof at === 'number');
  const annoncee = departs.length ? Math.min(...departs) : message.createdAt;
  todos.forEach((todo, index) => {
    const donnees = () =>
      JSON.stringify({ rang: index + 1, sur: todos.length, debutLe: todo.startedAt, finLe: todo.endedAt });
    /* La ligne ANNONCÉE, puis chaque état franchi à son heure. */
    brutes.push({ ...commun, id: `${message.id}:todo:${index}:todo`, nature: 'point', at: annoncee, libelle: todo.label, etat: 'todo', donnees: donnees(), ordre: ordre++ });
    if (todo.state !== 'todo' && todo.startedAt) {
      brutes.push({ ...commun, id: `${message.id}:todo:${index}:running`, nature: 'point', at: todo.startedAt, libelle: todo.label, etat: 'running', donnees: donnees(), ordre: ordre++ });
    }
    if (todo.state === 'done' || todo.state === 'unfinished') {
      brutes.push({
        ...commun,
        id: `${message.id}:todo:${index}:${todo.state}`,
        nature: 'point',
        at: todo.endedAt ?? todo.startedAt ?? annoncee,
        libelle: todo.label,
        etat: todo.state,
        donnees: donnees(),
        ordre: ordre++,
      });
    }
  });

  for (const step of message.steps) {
    /* Comme le démon : seule une étape REFERMÉE entre au journal. */
    if (step.state === 'running' || step.state === 'todo' || !garder(step)) continue;
    brutes.push({
      ...commun,
      id: `${message.id}:step:${step.id}`,
      nature: 'requete',
      at: step.startedAt ?? step.endedAt ?? message.createdAt,
      libelle: step.label,
      outil: step.outil ?? step.label,
      ...(step.entree ? { params: step.entree } : {}),
      resultat: step.detail ?? '',
      reussie: step.state !== 'failed',
      ...(step.startedAt && step.endedAt ? { dureeMs: Math.max(0, step.endedAt - step.startedAt) } : {}),
      ordre: ordre++,
    });
  }

  /* L'ORDRE DU TEMPS, et à heure égale celui de l'écriture : une tâche qui
     démarre à l'instant d'une action passe devant elle. */
  return brutes
    .sort((a, b) => a.at - b.at || a.ordre - b.ordre)
    .map(({ ordre: _ordre, ...entree }, rang) => ({ ...entree, rang }));
}
