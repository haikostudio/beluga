/**
 * LA CARTE D'UN AGENT DE VOLET, VUE DE L'ÉCRAN.
 *
 * Un clic sur la carte d'un agent de volet (Studio, Marketing, Surveillance,
 * Sauvegardes) ramène dans le service, sur la conversation de l'agent, au lieu
 * d'ouvrir le volet de la carte. La règle qui reconnaît ces cartes est partagée
 * avec le démon (`serviceDeLaCarte`) ; le lien « agent → élément » (quelle
 * création, quel site) n'existe que côté démon, qui le rend à la demande.
 *
 * Tout ce qui ne mène nulle part — élément disparu, démon injoignable, carte
 * pas encore connue de l'écran — rend `null` : l'appelant rouvre alors la carte,
 * comme avant. Un clic ne tombe jamais dans le vide.
 */
import { serviceDeLaCarte, type Card, type LieuDeService, type ServiceDeCarte } from '@beluga/shared';
import { client } from '@/lib/client';

/** Le service de cette carte, d'après l'agent que l'écran connaît d'elle. */
export function serviceDeLaCarteALEcran(card: Pick<Card, 'agentId' | 'labels'> | null | undefined): ServiceDeCarte | null {
  if (!card?.agentId) return null;
  return serviceDeLaCarte(client.lireEtat().agents[card.agentId], card);
}

/** Où mène la carte : la vue du service et l'élément ouvert, ou `null` pour la rouvrir telle quelle. */
export async function lieuDuServiceDeLaCarte(cardId: string): Promise<LieuDeService | null> {
  const carte = client.lireEtat().cards[cardId];
  if (!serviceDeLaCarteALEcran(carte)) return null;
  try {
    const reponse = await client.call<{ lieu: LieuDeService | null }>({ type: 'carte.lieu-de-service', cardId });
    return reponse?.lieu ?? null;
  } catch {
    return null;
  }
}
