import * as React from 'react';
import {
  CHAT_ASSISTANT_DEFAUT,
  CLE_ASSISTANT_GLOBAL,
  agentTientSonTour,
  chatAssistantRetenu,
  decisionsQuiAlertent,
  type Agent,
  type ChatAssistant,
} from '@beluga/shared';
import { readPref, usePref, writePref } from '@/lib/prefs';
import { client } from '@/lib/client';
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

/**
 * OUVRIR L'ASSISTANT DEPUIS UN ÉCRAN, UNE AMORCE DANS SON CHAMP. Un seul robot
 * dans l'application (demande du 20/10/2026) : l'écran Marketing n'a plus son
 * propre chat, il ouvre celui-ci. L'amorce (« Marketing de « ProjetA » : ») dit à
 * l'assistant quel projet viser ; elle ne se pose QUE dans un champ vide — un
 * texte déjà commencé n'est jamais recouvert. Rien n'est envoyé.
 */
export async function ouvrirLAssistant(amorce?: string): Promise<void> {
  const retenu = chatAssistantRetenu(readPref<unknown>(CLE_ASSISTANT_GLOBAL, CHAT_ASSISTANT_DEFAUT));
  if (!retenu.ouvert) writePref(CLE_ASSISTANT_GLOBAL, { ...retenu, ouvert: true });
  if (!amorce) return;
  try {
    const id = agentIdCourant ?? (await client.call<{ agent: Agent }>({ type: 'assistant.agent' })).agent.id;
    const cle = `draft.${id}`;
    if (!readPref<string>(cle, '').trim()) writePref(cle, amorce);
  } catch {
    /* l'assistant s'ouvre quand même, champ vide */
  }
}
