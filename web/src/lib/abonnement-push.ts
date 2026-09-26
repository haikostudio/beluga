/**
 * L'ABONNEMENT AUX NOTIFICATIONS POUSSÉES, ÉCRIT UNE SEULE FOIS.
 *
 * Les DEUX visages de l'application s'abonnent maintenant : l'administration
 * (`web/src/app.tsx`) le faisait déjà, l'espace client ne le faisait JAMAIS —
 * un client installait l'application et n'était prévenu de rien.
 *
 * L'abonnement est RANGÉ AU NOM du compte connecté, côté serveur, derrière le
 * cookie de session : le navigateur ne dit pas qui il est, il ne pourrait que
 * mentir. On renvoie donc l'abonnement au serveur MÊME s'il existe déjà, ce qui
 * remet le bon propriétaire quand deux personnes se succèdent sur le même
 * navigateur — sans cela, l'ancien continuerait de recevoir les alertes du
 * nouveau.
 */

/** La clé publique VAPID arrive en base64url : le navigateur veut des octets. */
function enOctets(base64: string): ArrayBuffer {
  const complement = '='.repeat((4 - (base64.length % 4)) % 4);
  const propre = (base64 + complement).replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(propre);
  const sortie = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i += 1) sortie[i] = brut.charCodeAt(i);
  return sortie.buffer;
}

/**
 * S'abonner, si le navigateur et la personne le veulent bien. Ne lève jamais :
 * un navigateur qui refuse les notifications ne doit pas casser l'écran.
 *
 * `delaiAvantDemande` retarde la demande d'autorisation : la poser à la
 * première seconde, avant d'avoir rien montré, c'est se la faire refuser.
 */
export async function abonnerAuxNotifications(delaiAvantDemande = 8000): Promise<boolean> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  try {
    if (Notification.permission === 'default') {
      await new Promise((resolve) => setTimeout(resolve, delaiAvantDemande));
      await Notification.requestPermission().catch(() => undefined);
    }
    if (Notification.permission !== 'granted') return false;

    const me = await fetch('/api/me').then((r) => r.json());
    if (!me?.pushKey) return false;

    const registration = await navigator.serviceWorker.ready;
    const existant = await registration.pushManager.getSubscription();
    const abonnement =
      existant ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: enOctets(me.pushKey),
      }));

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(abonnement),
    });
    return true;
  } catch {
    /* le navigateur refuse les notifications poussées : on s'en passe */
    return false;
  }
}
