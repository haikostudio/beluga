/*
 * LES ÉQUIPES, LUES AU DÉMON (carte « Beluga piloté par des agents », 26/11/2026).
 *
 *  - `useEquipe(projectId)` : l'équipe d'un projet (et celle de son groupe) avec la discussion, relue à l'ouverture et
 *    à chaque événement `agentsPerso` du projet ou de son groupe (l'événement ne porte que le projet : on relit).
 *  - `useEquipesDeLaColonne()` : toutes les équipes en LÉGER pour la colonne de gauche, une lecture partagée par tous
 *    les écrans, relue au plus une fois toutes les deux secondes. Rien ne part avant que l'état du serveur soit là
 *    (« le premier envoi ne porte que l'utile »).
 *
 * L'état de l'agent de DÉVELOPPEMENT se lit au plus juste côté écran : ses tâches au travail ou en attente d'une
 * réponse viennent du magasin (cartes de la colonne, agents, décisions), qui bouge plus vite que les relectures.
 */
import * as React from 'react';
import { agentAuTravailALEcran, etatDuMembre, rangDeLEtat, type AgentPerso, type EchangeDAgents, type EtatDuMembre, type RoleDEquipier } from '@beluga/shared';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

export type MembreLu = AgentPerso & { etat: EtatDuMembre; activite: string | null };

export interface EquipeLue {
  agents: MembreLu[];
  groupe: { projectId: string; agents: MembreLu[] } | null;
  echanges: EchangeDAgents[];
}

/** Les tâches d'un projet vues par l'écran : combien travaillent, combien attendent, et le titre de la première au travail. */
export function useTachesDuDeveloppement(): (projectId: string) => { auTravail: number; attendent: number; activite: string | null } {
  const state = useApp();
  const parProjet = React.useMemo(() => {
    const sortie = new Map<string, { auTravail: number; attendent: number; activite: string | null }>();
    const attendent = new Set(state.decisions.map((d) => d.cardId).filter(Boolean) as string[]);
    const travaillent = new Set<string>();
    for (const agent of Object.values(state.agents)) if (agent.cardId && agentAuTravailALEcran(agent)) travaillent.add(agent.cardId);
    for (const carte of Object.values(state.tachesDeLaColonne ?? {})) {
      if ((carte.labels ?? []).includes('agent-perso')) continue;
      const s = sortie.get(carte.projectId) ?? { auTravail: 0, attendent: 0, activite: null };
      if (attendent.has(carte.id)) s.attendent++;
      else if (travaillent.has(carte.id)) {
        s.auTravail++;
        s.activite ??= carte.title;
      }
      sortie.set(carte.projectId, s);
    }
    return sortie;
  }, [state.decisions, state.agents, state.tachesDeLaColonne]);
  return React.useCallback((projectId: string) => parProjet.get(projectId) ?? { auTravail: 0, attendent: 0, activite: null }, [parProjet]);
}

/** Un membre relu avec l'état des tâches que l'écran connaît (le développement travaille par ses tâches). */
function avecLesTaches<M extends { role: RoleDEquipier; projectId: string; etat: EtatDuMembre; activite: string | null; attentes?: number }>(
  m: M,
  taches: ReturnType<ReturnType<typeof useTachesDuDeveloppement>>,
): M {
  if (m.role !== 'dev') return m;
  const etat = etatDuMembre({
    attentes: m.attentes ?? (m.etat === 'vous-attend' ? 1 : 0),
    enPassage: m.etat === 'au-travail',
    tachesAuTravail: taches.auTravail,
    tachesQuiAttendent: taches.attendent,
  });
  return { ...m, etat, activite: taches.activite ?? m.activite };
}

export function useEquipe(projectId: string | null): { equipe: EquipeLue | null; erreur: string | null; relire: () => void } {
  const versions = useApp().agentsPersoVersions;
  const [etat, setEtat] = React.useState<{ equipe: EquipeLue | null; erreur: string | null; pour: string | null }>({ equipe: null, erreur: null, pour: null });
  const groupe = etat.equipe?.groupe?.projectId ?? null;
  const version = (projectId ? (versions[projectId] ?? 0) : 0) + (groupe ? (versions[groupe] ?? 0) : 0);
  const [tour, setTour] = React.useState(0);
  React.useEffect(() => {
    if (!projectId) return;
    let vivant = true;
    client
      .call<EquipeLue>({ type: 'equipe.lire', projectId }, 30000)
      .then((r) => vivant && setEtat({ equipe: r, erreur: null, pour: projectId }))
      .catch((err: any) => vivant && setEtat((e) => ({ ...e, erreur: err?.message ?? t('L’équipe n’a pas pu se lire') })));
    return () => {
      vivant = false;
    };
  }, [projectId, version, tour]);
  const taches = useTachesDuDeveloppement();
  const equipe = React.useMemo(() => {
    if (!etat.equipe || etat.pour !== projectId) return null;
    return {
      ...etat.equipe,
      agents: etat.equipe.agents.map((a) => avecLesTaches(a, taches(a.projectId))),
    };
  }, [etat.equipe, etat.pour, projectId, taches]);
  return { equipe, erreur: etat.erreur, relire: React.useCallback(() => setTour((t) => t + 1), []) };
}

/* ------------------------------------------------------------------ */
/* La colonne : toutes les équipes, en léger                           */
/* ------------------------------------------------------------------ */

export interface MembreEnLeger {
  id: string;
  projectId: string;
  role: RoleDEquipier;
  portrait: string | null;
  couleur: string;
  etat: EtatDuMembre;
  activite: string | null;
  agentId: string | null;
  nom: string;
}

let membresEnCache: MembreEnLeger[] | null = null;
let lectureEnCours: Promise<void> | null = null;
let derniereLecture = 0;
let versionLue = -1;
const abonnes = new Set<() => void>();

function relireLesEquipes(version: number): void {
  if (lectureEnCours) return;
  const attente = Math.max(0, 2000 - (Date.now() - derniereLecture));
  lectureEnCours = new Promise<void>((fin) => setTimeout(fin, attente))
    .then(() => client.call<{ membres: MembreEnLeger[] }>({ type: 'equipe.toutes' }, 30000))
    .then((r) => {
      membresEnCache = r.membres ?? [];
      versionLue = version;
      for (const abonne of abonnes) abonne();
    })
    .catch(() => undefined)
    .finally(() => {
      derniereLecture = Date.now();
      lectureEnCours = null;
    });
}

export function useEquipesDeLaColonne(): MembreEnLeger[] | null {
  const state = useApp();
  const version = React.useMemo(() => Object.values(state.agentsPersoVersions).reduce((s, v) => s + v, 0), [state.agentsPersoVersions]);
  const [, setTour] = React.useState(0);
  React.useEffect(() => {
    const abonne = () => setTour((t) => t + 1);
    abonnes.add(abonne);
    return () => {
      abonnes.delete(abonne);
    };
  }, []);
  React.useEffect(() => {
    if (!state.pret) return;
    if (membresEnCache && versionLue === version) return;
    relireLesEquipes(version);
  }, [state.pret, version]);
  const taches = useTachesDuDeveloppement();
  return React.useMemo(
    () => (membresEnCache ? membresEnCache.map((m) => avecLesTaches(m, taches(m.projectId))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [membresEnCache, taches],
  );
}

/** Les membres d'un projet, rangés : qui attend, qui travaille, puis le repos ; à égalité, l'ordre de l'équipe. */
export function membresRanges<M extends { etat: EtatDuMembre }>(membres: readonly M[]): M[] {
  return membres
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rangDeLEtat(a.m.etat) - rangDeLEtat(b.m.etat) || a.i - b.i)
    .map((x) => x.m);
}
