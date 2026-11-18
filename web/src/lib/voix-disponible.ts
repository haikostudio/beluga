import * as React from 'react';
import { usePref } from './prefs';
import { useApp } from './use-app';

/**
 * L'ASSISTANT VOCAL EST-IL DISPONIBLE ? (décision de l'utilisateur, 17/11/2026) — la SEULE règle, lue par le champ
 * d'écriture, le raccourci, « Dis Jarvis » et le module de voix. Il faut les deux :
 *   - l'interrupteur « Activer l'assistant vocal » (préférence `voix.active`, la même que Réglages › Voix et que la
 *     page « Votre assistant » de l'installation), allumé par défaut ;
 *   - un compte ChatGPT relié au moteur Codex : c'est lui qui écoute, réfléchit et parle.
 * Tant que les comptes ne sont pas arrivés à l'écran, on garde l'état d'avant (la voix) : aucun clignotement micro ⇄
 * voix au chargement.
 */
export const CLE_VOIX_ACTIVE = 'voix.active';

export function compteChatGPTRelie(state: {
  quotasRecus: boolean;
  quotas: readonly { engine: string; disabled?: boolean }[];
  engines: readonly { id: string; installed: boolean }[];
}): boolean | null {
  // Un compte Codex déclaré dans les quotas, ou l'outil Codex posé sur ce serveur (il porte sa propre session ChatGPT,
  // celle de l'installation) : la voix peut partir. Ni l'un ni l'autre, une fois les deux listes arrivées : pas de voix.
  if (state.quotas.some((q) => q.engine === 'codex' && !q.disabled)) return true;
  if (state.engines.some((e) => e.id === 'codex' && e.installed)) return true;
  if (!state.quotasRecus || !state.engines.length) return null;
  return false;
}

export function useVoixDisponible(): { disponible: boolean; voixActive: boolean; compteRelie: boolean | null } {
  const state = useApp();
  const [voixActive] = usePref<boolean>(CLE_VOIX_ACTIVE, true);
  const compteRelie = compteChatGPTRelie(state);
  return { disponible: voixActive && compteRelie !== false, voixActive, compteRelie };
}

/* LA DICTÉE DU SERVEUR : installée ou non (`/api/dictee`), lue une fois par page, relue sur demande (après installation). */
let dicteeConnue: boolean | null = null;
let lecture: Promise<boolean> | null = null;
const abonnes = new Set<(v: boolean) => void>();

export function relireLaDictee(): Promise<boolean> {
  lecture = fetch('/api/dictee', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { disponible: false }))
    .then((d: { disponible?: boolean }) => !!d.disponible)
    .catch(() => false)
    .then((v) => {
      dicteeConnue = v;
      for (const abonne of abonnes) abonne(v);
      return v;
    });
  return lecture;
}

/** `null` tant que la réponse n'est pas venue. */
export function useDicteeInstallee(actif = true): boolean | null {
  const [installee, setInstallee] = React.useState<boolean | null>(dicteeConnue);
  React.useEffect(() => {
    if (!actif) return;
    abonnes.add(setInstallee);
    if (dicteeConnue === null && !lecture) void relireLaDictee();
    else if (dicteeConnue !== null) setInstallee(dicteeConnue);
    return () => {
      abonnes.delete(setInstallee);
    };
  }, [actif]);
  return installee;
}
