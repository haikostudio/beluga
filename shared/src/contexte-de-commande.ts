/**
 * Nommer la CARTE et le PROJET d'une commande refusée.
 *
 * Un refus de `card.start` était journalisé seul, sans dire de quelle carte ni
 * de quel projet il venait : impossible, en relisant le journal, de savoir quel
 * dépôt posait problème. Ce mot se colle au message du refus.
 */
export function motDeContexteDeCommande(contexte: {
  carte?: string | null;
  projet?: string | null;
}): string {
  const carte = (contexte.carte ?? '').trim();
  const projet = (contexte.projet ?? '').trim();
  const morceaux: string[] = [];
  if (carte) morceaux.push(`carte « ${carte} »`);
  if (projet) morceaux.push(`projet « ${projet} »`);
  return morceaux.length ? ` (${morceaux.join(', ')})` : '';
}
