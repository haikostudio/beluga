/**
 * LES NOTIFICATIONS DE L'APPLICATION IPHONE (APNs), carte « Assistant vocal rapide et apps Beluga », 16/11/2026.
 *
 * La vue web d'une application ne reçoit pas la notification web (VAPID). L'application iPhone inscrit donc le
 * jeton APNs de l'appareil comme un ABONNEMENT ordinaire (`push_subs`, endpoint « apns:<environnement>:<jeton> »),
 * rangé au nom du compte connecté : il est servi par EXACTEMENT les mêmes envois que la notification web —
 * mêmes déclencheurs, mêmes destinataires, mêmes textes (contrat « TROIS GENRES ALERTENT, PAS UN DE PLUS, ET LES
 * DEUX CANAUX SUIVENT LA MÊME RÈGLE ») — et paraît dans la liste des appareils du compte.
 *
 * La règle vit ici, sans réseau : la forme de l'abonnement et le contenu envoyé. L'envoi HTTP/2 signé est dans
 * `server/src/apns.ts`.
 */

/** L'identifiant de l'application iPhone : c'est le « sujet » de chaque envoi APNs. */
export const SUJET_APNS = 'studio.haiko.beluga.app';

export type EnvironnementApns = 'production' | 'sandbox';

export interface AbonnementApns {
  jeton: string;
  environnement: EnvironnementApns;
}

const JETON = /^[0-9a-f]{64,200}$/;

/** L'adresse d'abonnement d'un appareil iPhone, ou `null` si le jeton ou l'environnement est mal formé. */
export function endpointApns(jeton: unknown, environnement: unknown): string | null {
  const j = typeof jeton === 'string' ? jeton.trim().toLowerCase() : '';
  const e = environnement === 'sandbox' ? 'sandbox' : environnement === 'production' ? 'production' : null;
  if (!e || !JETON.test(j)) return null;
  return `apns:${e}:${j}`;
}

/** L'abonnement APNs que porte une adresse d'abonnement, ou `null` pour un abonnement web. */
export function abonnementApnsDe(endpoint: string): AbonnementApns | null {
  const m = /^apns:(production|sandbox):([0-9a-f]{64,200})$/.exec(endpoint ?? '');
  return m ? { environnement: m[1] as EnvironnementApns, jeton: m[2] } : null;
}

/** Le serveur d'APNs : TestFlight et l'App Store parlent à la production. */
export function hoteApns(environnement: EnvironnementApns): string {
  return environnement === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
}

export interface ContenuANotifier {
  title: string;
  body: string;
  tag?: string;
  nonLues?: number;
}

/**
 * Le corps APNs d'une notification : titre et texte de la notification web, regroupés par `tag`, le chiffre de
 * l'icône quand il est connu, et l'ANCRE (« /#projet/… ») que l'application ouvre au toucher.
 */
export function corpsApns(contenu: ContenuANotifier, ancre?: string): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: contenu.title.slice(0, 200), body: contenu.body.slice(0, 1500) },
    sound: 'default',
  };
  if (contenu.tag) aps['thread-id'] = contenu.tag.slice(0, 64);
  if (typeof contenu.nonLues === 'number' && contenu.nonLues >= 0) aps.badge = Math.floor(contenu.nonLues);
  return ancre ? { aps, ancre } : { aps };
}

/** Une réponse d'APNs qui dit que le jeton ne sert plus : l'abonnement est retiré. */
export function jetonMort(statut: number, raison?: string): boolean {
  if (statut === 410) return true;
  return statut === 400 && (raison === 'BadDeviceToken' || raison === 'DeviceTokenNotForTopic');
}
