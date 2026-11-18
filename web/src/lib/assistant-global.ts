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
 * OÙ EST LE BOUTON DU BORD (carte « Jarvis : volet, voix et rapidité », 16/11/2026) : son bord et le milieu de sa
 * place le long de ce bord, posés par le bouton (`jarvis-natif.tsx`) et lus par le volet, qui s'ouvre de son côté.
 */
export interface BoutonDuBordVu {
  bord: 'gauche' | 'droite' | 'haut' | 'bas';
  centre: number;
}

let bouton: BoutonDuBordVu = { bord: 'gauche', centre: 0 };
const abonnesDuBouton = new Set<() => void>();

export function poserLeBoutonDuBord(suite: BoutonDuBordVu): void {
  if (bouton.bord === suite.bord && bouton.centre === suite.centre) return;
  bouton = suite;
  for (const abonne of abonnesDuBouton) abonne();
}

export function useBoutonDuBord(): BoutonDuBordVu {
  return React.useSyncExternalStore(
    (abonne) => {
      abonnesDuBouton.add(abonne);
      return () => abonnesDuBouton.delete(abonne);
    },
    () => bouton,
    () => bouton,
  );
}
