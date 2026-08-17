import { ERREURS_MAX_PAR_PAGE, RapportErreur, empreinteErreur } from '@haikodev/shared';
import { t } from './langue';

/**
 * La remontée des erreurs de la page au serveur.
 *
 * Sur un téléphone, `console.error` écrit dans une console qu'on ne peut pas
 * ouvrir : quand l'application blanchit, il ne reste rien. Chaque erreur non
 * rattrapée part donc au serveur, qui la range dans son journal.
 *
 * Deux règles tiennent tout :
 * — un envoi qui échoue ne gêne RIEN et n'est jamais réessayé (le `catch` est
 *   muet, il n'y a pas de file d'attente) ;
 * — une erreur ne part qu'UNE fois, et une page en envoie au plus
 *   `ERREURS_MAX_PAR_PAGE`. Une panne qui se répète à chaque affichage en
 *   produirait autrement des milliers.
 */

const deja = new Set<string>();
let envoyees = 0;

/** Ce que le navigateur dit de lui-même, sans rien du projet. */
function contexte(): Pick<RapportErreur, 'url' | 'appareil'> {
  return {
    url: typeof location !== 'undefined' ? location.href : undefined,
    appareil: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };
}

/**
 * Envoie une erreur au serveur. Ne rend rien et ne lève jamais : appelée depuis
 * un gestionnaire d'erreur, la moindre exception ferait boucle.
 */
export function signalerErreur(rapport: RapportErreur): void {
  try {
    if (envoyees >= ERREURS_MAX_PAR_PAGE) return;
    const empreinte = empreinteErreur(rapport);
    if (deja.has(empreinte)) return;
    deja.add(empreinte);
    envoyees += 1;

    // `keepalive` : l'envoi survit à une page qu'on quitte dans la foulée.
    void fetch('/api/erreur', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...contexte(), ...rapport }),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch {
    /* remonter une erreur ne doit jamais en provoquer une autre */
  }
}

/** Le message et la pile d'une erreur, quelle que soit sa forme. */
export function detailErreur(cause: unknown): { message: string; pile?: string } {
  if (cause instanceof Error) {
    return { message: cause.message || cause.name || t('erreur sans message'), pile: cause.stack };
  }
  if (typeof cause === 'string') return { message: cause };
  try {
    return { message: JSON.stringify(cause) ?? String(cause) };
  } catch {
    return { message: String(cause) };
  }
}

/**
 * Branche les deux chemins que React ne voit pas : une erreur globale de la
 * fenêtre, et une promesse rejetée sans traitement — c'est par là que passent
 * les pannes des effets asynchrones (ouverture du micro, appel réseau…).
 */
export function brancherRemonteeErreurs(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (evenement) => {
    const detail = detailErreur(evenement.error ?? evenement.message);
    signalerErreur({
      source: 'fenetre',
      message: detail.message,
      pile: detail.pile ?? `${evenement.filename ?? ''}:${evenement.lineno ?? 0}`,
    });
  });

  window.addEventListener('unhandledrejection', (evenement) => {
    const detail = detailErreur(evenement.reason);
    signalerErreur({ source: 'promesse', message: detail.message, pile: detail.pile });
  });
}
