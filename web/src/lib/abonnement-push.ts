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
 * CET APPAREIL A ÉTÉ COUPÉ À LA MAIN. L'application s'abonne toute seule à
 * chaque ouverture : sans cette mémoire, un appareil coupé dans les réglages
 * se réabonnerait au prochain démarrage. Elle vit dans l'appareil, car c'est
 * lui qu'elle concerne.
 */
const CLE_COUPEE = 'beluga.notifications-coupees';

function appareilCoupe(): boolean {
  try {
    return window.localStorage.getItem(CLE_COUPEE) === '1';
  } catch {
    return false;
  }
}

function memoriserCoupure(coupe: boolean): void {
  try {
    if (coupe) window.localStorage.setItem(CLE_COUPEE, '1');
    else window.localStorage.removeItem(CLE_COUPEE);
  } catch {
    /* stockage fermé : au pire l'appareil se réabonne */
  }
}

/**
 * S'abonner, si le navigateur et la personne le veulent bien. Ne lève jamais :
 * un navigateur qui refuse les notifications ne doit pas casser l'écran.
 *
 * `delaiAvantDemande` retarde la demande d'autorisation : la poser à la
 * première seconde, avant d'avoir rien montré, c'est se la faire refuser.
 */
export async function abonnerAuxNotifications(delaiAvantDemande = 8000, geste = false): Promise<boolean> {
  /* Un geste des réglages lève la coupure ; l'ouverture de l'application, jamais. */
  if (geste) memoriserCoupure(false);
  else if (appareilCoupe()) return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  try {
    if (Notification.permission === 'default') {
      await new Promise((resolve) => setTimeout(resolve, delaiAvantDemande));
      await Notification.requestPermission().catch(() => undefined);
    }
    if (Notification.permission !== 'granted') return false;

    const me = await fetch('/api/me').then((r) => r.json());
    if (!me?.pushKey) return false;

    const registration = await serviceWorkerPret();
    if (!registration) return false;
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

/**
 * OÙ EN EST CET APPAREIL. Les réglages montrent un interrupteur : il faut donc
 * savoir si le navigateur sait faire, si l'autorisation est refusée (cela ne
 * se règle que dans l'appareil, la page ne peut plus la redemander), et si un
 * abonnement existe déjà.
 *
 *  - `indisponible` : le navigateur ne gère pas les notifications poussées ;
 *  - `iphone-a-installer` : sur iPhone elles n'existent que dans l'application
 *    posée sur l'écran d'accueil ;
 *  - `refusee` : l'autorisation a été refusée dans l'appareil ;
 *  - `active` / `eteinte` : l'abonnement existe, ou non.
 */
/**
 * `serviceWorker.ready` ne se résout JAMAIS tant qu'aucun service worker n'est
 * posé (première visite, navigateur qui le bloque) : la page des réglages
 * resterait muette. On attend un peu, puis on dit que rien n'est prêt.
 */
function serviceWorkerPret(delaiMs = 3000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), delaiMs)),
  ]);
}

export type EtatDeCetAppareil =
  | { etat: 'indisponible' | 'iphone-a-installer' | 'refusee' | 'eteinte' }
  | { etat: 'active'; endpoint: string };

export async function etatDeCetAppareil(): Promise<EtatDeCetAppareil> {
  const surIphone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const installee =
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (surIphone && !installee) return { etat: 'iphone-a-installer' };
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { etat: 'indisponible' };
  }
  if (Notification.permission === 'denied') return { etat: 'refusee' };
  try {
    const registration = await serviceWorkerPret();
    const abonnement = await registration?.pushManager.getSubscription();
    if (abonnement && Notification.permission === 'granted') return { etat: 'active', endpoint: abonnement.endpoint };
  } catch {
    /* pas de service worker prêt : l'appareil n'est pas abonné */
  }
  return { etat: 'eteinte' };
}

/**
 * COUPER CET APPAREIL : le navigateur se désabonne ET le serveur l'oublie,
 * sinon il continuerait d'envoyer vers une adresse qui n'écoute plus (ou, pire,
 * d'être réabonné au prochain démarrage). Rend `true` si c'est fait.
 */
export async function couperCetAppareil(): Promise<boolean> {
  memoriserCoupure(true);
  try {
    const registration = await serviceWorkerPret();
    const abonnement = await registration?.pushManager.getSubscription();
    if (!abonnement) return true;
    const endpoint = abonnement.endpoint;
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    return await abonnement.unsubscribe();
  } catch {
    return false;
  }
}
