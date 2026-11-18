/**
 * LE JOURNAL D'UN AGENT EN FONDU, AU-DESSUS D'UN CHAMP (carte « Communication 2 : finitions et chats », demande de
 * l'utilisateur) : pendant qu'un agent travaille, une phrase par action — au plus SIX —, la plus récente en bas, les
 * plus anciennes de plus en plus transparentes vers le haut (la sixième à 10 %, la cinquième à 30 %…), pour qu'elles
 * disparaissent à mesure qu'elles défilent. À la fin du travail, les phrases laissent place au mot de fin.
 *
 * Règles pures : l'écran (`web/src/components/journal-de-l-agent.tsx`) ne fait que les dessiner. Il sert à
 * Communication 2 (chef en coulisses, agent qui crée un compte) ET aux agents de Déploiement / Mise en production.
 */
import { nomAfficheDOutil } from './noms-outils.js';

export const LIGNES_DU_JOURNAL = 6;

/** L'opacité de chaque ligne, de la plus RÉCENTE (en bas, rang 0) à la plus ancienne (en haut, rang 5). */
export const OPACITES_DU_JOURNAL = [1, 0.85, 0.65, 0.45, 0.3, 0.1] as const;

export function opaciteDuJournal(rangDepuisLeBas: number): number {
  return OPACITES_DU_JOURNAL[Math.max(0, Math.min(OPACITES_DU_JOURNAL.length - 1, Math.floor(rangDepuisLeBas)))]!;
}

export interface PhraseDuJournal {
  id: string;
  texte: string;
  at: number;
}

interface EtapeLue {
  id: string;
  label?: string;
  outil?: string;
  state?: string;
  startedAt?: number;
}

interface MessageLu {
  id: string;
  role: string;
  createdAt?: number;
  steps?: readonly EtapeLue[];
}

/** Les outils qui ne disent rien de ce que l'agent FAIT (chargement d'outils, liste de tâches, mémoire de travail). */
const OUTILS_MUETS = /^(toolsearch|tool_search|taskcreate|taskupdate|tasklist|taskget|todowrite|todo_write|update_plan)$/i;

/**
 * LES PHRASES D'UN AGENT : une par étape de ses tours (depuis `depuis`), dans l'ordre, les répétitions collées
 * fondues en une seule, les outils muets écartés, et seulement les SIX dernières.
 */
export function phrasesDuJournal(messages: readonly MessageLu[], depuis = 0, max = LIGNES_DU_JOURNAL): PhraseDuJournal[] {
  const phrases: PhraseDuJournal[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.steps?.length) continue;
    if ((m.createdAt ?? 0) < depuis) continue;
    for (const e of m.steps) {
      const nu = (e.outil ?? '').replace(/^mcp__[a-z0-9_]+__/i, '');
      if (nu && OUTILS_MUETS.test(nu)) continue;
      if (e.state === 'skipped') continue;
      const texte = (e.label?.trim() || (e.outil ? nomAfficheDOutil(e.outil) : '')).replace(/\s+/g, ' ').slice(0, 140);
      if (!texte) continue;
      if (phrases.at(-1)?.texte === texte) continue;
      phrases.push({ id: `${m.id}:${e.id}`, texte, at: e.startedAt ?? m.createdAt ?? 0 });
    }
  }
  return phrases.slice(-max);
}
