import * as React from 'react';
import { Agent, arretDeCarteAutorise } from '@haikodev/shared';
import { ConfirmDialog } from '@/components/ui';
import { client } from '@/lib/client';

/**
 * LE GESTE D'ARRÊT, ÉCRIT UNE SEULE FOIS.
 *
 * Il part aujourd'hui de DEUX endroits — la bande « en cours » en haut du fil
 * et la barre d'écriture en bas — et ce doit être exactement le même geste :
 * même contrôle (`arretDeCarteAutorise`), même commande (`agent.stop` avec le
 * numéro de la carte d'où part le clic), même confirmation au-delà de cinq
 * minutes de travail, même refus dit à l'écran. Deux copies auraient dérivé.
 *
 * Le bouton lui-même n'est pas ici : chaque endroit garde sa taille et sa
 * place. Ce crochet ne rend que la décision, l'action et la fenêtre de
 * confirmation à poser dans l'arbre.
 */

/** Au-delà de cinq minutes, un clic malheureux jetterait un vrai travail. */
export const ARRET_SANS_CONFIRMATION_SECONDES = 300;

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
  /** La durée retenue AU CLIC : la fenêtre de confirmation ne ment pas. */
  const [aConfirmer, setAConfirmer] = React.useState<string | null>(null);

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

  const arreter = React.useCallback(() => {
    if (!agent) return;
    client
      .call({ type: 'agent.stop', agentId: agent.id, cardId })
      .catch((err: any) => client.pushToast('error', err?.message ?? 'arrêt refusé', cardId));
  }, [agent, cardId]);

  /*
   * Le clic : direct si le tour est jeune, confirmé s'il dure depuis longtemps.
   * La durée est relue AU MOMENT DU CLIC — la barre d'écriture ne se redessine
   * pas chaque seconde, et une durée figée au dernier rendu ferait passer un
   * long travail pour un tour tout neuf.
   */
  const demander = React.useCallback(() => {
    const secondes = debut ? Math.round((Date.now() - debut) / 1000) : null;
    if (secondes !== null && secondes >= ARRET_SANS_CONFIRMATION_SECONDES) {
      setAConfirmer(dureeLisible(secondes));
      return;
    }
    arreter();
  }, [debut, arreter]);

  const dialogue = (
    <ConfirmDialog
      open={aConfirmer !== null}
      danger
      title="Arrêter cet agent ?"
      description={`Il travaille depuis ${aConfirmer ?? 'un moment'}. Tout ce qu'il n'a pas encore enregistré sera perdu.`}
      confirmLabel="Arrêter quand même"
      onConfirm={arreter}
      onClose={() => setAConfirmer(null)}
    />
  );

  return { possible: verdict.possible, temps, demander, dialogue };
}
