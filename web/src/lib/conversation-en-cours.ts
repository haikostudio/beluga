/**
 * UNE CONVERSATION VOCALE EST-ELLE EN COURS ? (carte « Ménage de la mémoire de la voix », 18/11/2026). Un tout petit
 * module, sans dépendance : le rechargement automatique de la page (`lib/rechargement.ts`, chargé au démarrage) le lit
 * sans tirer le module de voix dans le premier envoi. `lib/etat-vocal.ts` le tient à jour.
 *
 * Pourquoi : recharger la page coupe la ligne vocale en pleine phrase — l'appel du 18/11 au matin s'est fermé et
 * rouvert trois fois juste après une mise à jour du serveur. Le rechargement attend donc la fin de la conversation.
 */
let enCours = false;
const enAttente = new Set<() => void>();

export function poserLaConversationEnCours(valeur: boolean): void {
  enCours = valeur;
  if (valeur) return;
  const suites = [...enAttente];
  enAttente.clear();
  for (const suite of suites) suite();
}

export function conversationEnCours(): boolean {
  return enCours;
}

/** Appelle `fin` une fois, quand la conversation en cours s'arrête (tout de suite s'il n'y en a pas). */
export function apresLaConversation(fin: () => void): void {
  if (!enCours) return fin();
  enAttente.add(fin);
}
