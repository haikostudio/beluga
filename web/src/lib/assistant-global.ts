import * as React from 'react';
import {
  CHAT_ASSISTANT_DEFAUT,
  CLE_ASSISTANT_GLOBAL,
  agentTientSonTour,
  chatAssistantRetenu,
  decisionsQuiAlertent,
  type ChatAssistant,
} from '@beluga/shared';
import { usePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';

/**
 * L'ÉTAT PARTAGÉ DE L'ASSISTANT GLOBAL : ouvert ou fermé, son agent, s'il
 * travaille, combien de questions l'attendent. Deux boutons l'ouvrent — le
 * robot flottant sur ordinateur (`AssistantGlobal`), le bouton de l'entête sur
 * téléphone (`BoutonAssistantEntete`) — et lisent ici la MÊME chose.
 *
 * L'ouverture vit dans la préférence du compte (`CLE_ASSISTANT_GLOBAL`), déjà
 * commune à tout l'écran. L'identifiant de l'agent n'est connu qu'après le
 * premier chargement de la fenêtre : il se range dans ce petit magasin.
 */
let agentIdCourant: string | null = null;
const abonnes = new Set<() => void>();

export function poserAgentDeLAssistant(id: string | null): void {
  if (agentIdCourant === id) return;
  agentIdCourant = id;
  for (const abonne of abonnes) abonne();
}

function abonner(abonne: () => void): () => void {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

export function useAgentDeLAssistant(): string | null {
  return React.useSyncExternalStore(abonner, () => agentIdCourant, () => null);
}

export function useEtatAssistant() {
  const state = useApp();
  const [brut, setBrut] = usePref<unknown>(CLE_ASSISTANT_GLOBAL, CHAT_ASSISTANT_DEFAUT);
  const retenu = chatAssistantRetenu(brut);
  const agentId = useAgentDeLAssistant();
  const agent = agentId ? (state.agents[agentId] ?? null) : null;
  const travaille = agent ? agentTientSonTour(agent) : false;
  const questions = agentId ? decisionsQuiAlertent(state.decisions).filter((d) => d.agentId === agentId).length : 0;
  const retenir = setBrut as (valeur: ChatAssistant) => void;
  return {
    retenu,
    retenir,
    agentId,
    agent,
    travaille,
    questions,
    basculer: () => retenir({ ...retenu, ouvert: !retenu.ouvert }),
  };
}
