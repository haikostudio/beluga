import * as React from 'react';
import type { Message } from '@beluga/shared';

/**
 * LE BLOC « SUGGESTION DE CARTE » D'UNE CARTE : FERMÉ OU NON, ET LA DERNIÈRE
 * DEMANDE « VOIR » VENUE DU FIL (demande du 23/10/2026).
 *
 * L'état vit HORS des composants, rangé par carte et pour la session : la
 * croix du bloc le ferme, la ligne « N cartes suggérées ici » du fil le
 * rouvre, et la page de la carte retire le bloc du pied tant qu'il est fermé
 * (`chat.tsx`). Changer de carte ne fait hériter de rien.
 */
interface DemandeDeVoir {
  /** La première proposition du groupe visé : la rangée défile jusqu'à elle. */
  proposalId?: string;
  /** Les propositions à surligner un instant. */
  ids: string[];
  n: number;
}

const fermees = new Set<string>();
const demandes = new Map<string, DemandeDeVoir>();
let version = 0;
const abonnes = new Set<() => void>();

function prevenir() {
  version += 1;
  for (const abonne of abonnes) abonne();
}

function abonner(abonne: () => void) {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

export function fermerLesSuggestions(cardId: string): void {
  if (fermees.has(cardId)) return;
  fermees.add(cardId);
  prevenir();
}

/** Rouvre le bloc ; avec des propositions, la rangée défile jusqu'à elles. */
export function voirLesSuggestions(cardId: string, ids: string[] = []): void {
  fermees.delete(cardId);
  if (ids.length) demandes.set(cardId, { proposalId: ids[0], ids, n: (demandes.get(cardId)?.n ?? 0) + 1 });
  prevenir();
}

/** La demande a été servie : un retour sur la carte ne la rejoue pas. */
export function consommerLaDemande(cardId: string): void {
  if (demandes.delete(cardId)) prevenir();
}

export function useSuggestionsDeCarte(cardId: string | undefined): { fermee: boolean; demande?: DemandeDeVoir } {
  React.useSyncExternalStore(abonner, () => version, () => 0);
  if (!cardId) return { fermee: false };
  return { fermee: fermees.has(cardId), demande: demandes.get(cardId) };
}

/**
 * UNE PROPOSITION EN ATTENTE JAMAIS VUE appelle `quandNouvelle`. Les
 * propositions présentes au montage comptent comme vues : ouvrir une carte ne
 * rouvre rien.
 */
export function useNouvelleSuggestion(enAttente: string[], quandNouvelle: () => void): void {
  const cle = enAttente.join('|');
  const dejaVues = React.useRef<Set<string>>(new Set(enAttente));
  const rappel = React.useRef(quandNouvelle);
  rappel.current = quandNouvelle;
  React.useEffect(() => {
    const nouvelle = enAttente.some((id) => !dejaVues.current.has(id));
    dejaVues.current = new Set(enAttente);
    if (nouvelle) rappel.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
}

/** Les propositions en attente d'une conversation, pour `useNouvelleSuggestion`. */
export function propositionsEnAttenteDuFil(messages: Message[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    for (const proposal of message.proposals ?? []) {
      if (proposal.decision === 'pending' && !ids.includes(proposal.id)) ids.push(proposal.id);
    }
  }
  return ids;
}
