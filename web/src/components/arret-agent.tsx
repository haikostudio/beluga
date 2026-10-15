import * as React from 'react';
import { Agent, arretDeCarteAutorise, brouillonApresSuspension } from '@beluga/shared';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { writePref } from '@/lib/prefs';

/**
 * LE GESTE « SUSPENDRE », ÉCRIT UNE SEULE FOIS.
 *
 * Il part de DEUX endroits — la bande « en cours » en haut du fil et la barre
 * d'écriture en bas — et ce doit être exactement le même geste : même contrôle
 * (`arretDeCarteAutorise`), même commande (`agent.suspend` avec le numéro de la
 * carte d'où part le clic), même refus dit à l'écran. Deux copies auraient
 * dérivé.
 *
 * Suspendre n'est plus arrêter : l'agent garde son contexte, la carte reste en
 * « En cours », et le prochain message le relance. Rien n'est donc perdu au
 * clic — la confirmation demandée après cinq minutes de travail n'a plus lieu
 * d'être. Les messages qui attendaient en file reviennent dans le champ
 * d'écriture, à la suite de ce qui y était déjà, sans rien envoyer.
 *
 * Le bouton lui-même n'est pas ici : chaque endroit garde sa taille et sa
 * place. Ce crochet ne rend que la décision et l'action.
 */

/** L'événement par lequel la file rendue rejoint un champ d'écriture À L'ÉCRAN. */
export const EVENEMENT_FILE_RENDUE = 'beluga:file-rendue';
export interface DetailFileRendue {
  agentId: string;
  textes: string[];
}

/**
 * Les champs d'écriture montés, par agent. Un champ à l'écran reçoit la file
 * par l'événement (sa frappe des 600 dernières millisecondes n'est pas encore
 * dans le brouillon : l'écrire là l'écraserait) ; sans champ monté, c'est le
 * brouillon retenu qui la reçoit (compétence « champ d'écriture, brouillon et
 * curseur », § 5).
 */
const champsMontes = new Map<string, number>();
export function useChampMonte(agentId: string | undefined): void {
  React.useEffect(() => {
    if (!agentId) return;
    champsMontes.set(agentId, (champsMontes.get(agentId) ?? 0) + 1);
    return () => {
      const reste = (champsMontes.get(agentId) ?? 1) - 1;
      if (reste > 0) champsMontes.set(agentId, reste);
      else champsMontes.delete(agentId);
    };
  }, [agentId]);
}

function rendreLaFileAuChamp(agentId: string, textes: string[]): void {
  if (!textes.length) return;
  if (champsMontes.has(agentId)) {
    window.dispatchEvent(
      new CustomEvent<DetailFileRendue>(EVENEMENT_FILE_RENDUE, { detail: { agentId, textes } }),
    );
    return;
  }
  const cle = `draft.${agentId}`;
  const ancien = client.lireEtat().prefs?.[cle];
  writePref(cle, brouillonApresSuspension(typeof ancien === 'string' ? ancien : '', textes));
}

/**
 * « 12 s », « 7 min 3 s » — ou rien si l'agent n'a pas d'heure de départ.
 * Exportée : la barre de travail du tableau (`board.tsx`) en a besoin pour
 * afficher le même temps écoulé que ce crochet, sans le geste d'arrêt.
 */
export function dureeLisible(secondes: number | null): string | null {
  if (secondes === null) return null;
  return secondes < 60 ? `${secondes} s` : `${Math.floor(secondes / 60)} min ${secondes % 60} s`;
}

export function useArretAgent({ agent, cardId }: { agent: Agent | null; cardId?: string }) {
  /*
   * L'agent affiché est-il bien celui de la carte ouverte ? Le tiroir choisit
   * son agent par replis successifs et peut retomber sur celui d'une autre
   * tâche : dans ce cas, pas de bouton du tout — mieux vaut rien qu'un faux.
   * Le démon rejoue le même contrôle.
   */
  const verdict = arretDeCarteAutorise({ carte: cardId, agent: agent ?? undefined });

  const debut = agent?.startedAt;
  // Affichage courant, pour la bande « en cours » qui compte les secondes.
  const temps = dureeLisible(debut ? Math.round((Date.now() - debut) / 1000) : null);

  const demander = React.useCallback(() => {
    if (!agent) return;
    const agentId = agent.id;
    client
      .call<{ suspendu?: boolean; geste?: string; message?: string; fileRendue?: string[] }>({
        type: 'agent.suspend',
        agentId,
        cardId,
      })
      // Ce que le démon a fait est DIT par le démon lui-même ; l'écran, lui,
      // remet dans le champ ce qui attendait en file.
      .then((reponse) => rendreLaFileAuChamp(agentId, reponse?.fileRendue ?? []))
      .catch((err: any) => client.pushToast('error', err?.message ?? t('suspension refusée'), cardId));
  }, [agent, cardId]);

  return { possible: verdict.possible, raison: verdict.raison, temps, demander };
}
