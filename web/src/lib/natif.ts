/**
 * LA PAGE DANS L'APPLICATION IPHONE OU MAC (carte « Assistant vocal rapide et apps Beluga », 16/11/2026).
 *
 * L'application (`natif/`) ouvre Beluga publié dans une vue web et pose `window.__belugaNatif` avant tout
 * script. Ici, et seulement là, la page :
 *  - dit « prête » au natif, qui lui rend alors ce qu'il gardait (jeton, raccourci, notification touchée) ;
 *  - inscrit le JETON APNs de l'iPhone comme un abonnement ordinaire, au nom du compte connecté
 *    (`/api/push/subscribe`, `shared/src/notifications-iphone.ts`) ;
 *  - va à l'écran d'une notification touchée ;
 *  - déplie le module vocal sur le raccourci « Parler à Beluga » (`beluga:ouvrir-voix`) — SANS ouvrir le micro ;
 *  - ouvre la conversation avec Jarvis sur le double toucher au dos (`beluga:jarvis-conversation`) ;
 *  - sur Mac, relaie au système les alertes que le démon lui pousse (mêmes genres, mêmes textes).
 * Hors application, rien de tout cela ne s'exécute : le navigateur garde son chemin.
 */
import { parlerAJarvis } from './etat-vocal';
import { construireFragment } from '@beluga/shared';
import { client } from '@/lib/client';

interface BelugaNatif {
  plateforme: 'ios' | 'mac';
  version: string;
  envoyer: (message: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    __belugaNatif?: BelugaNatif;
  }
}

/** La plateforme de l'application qui porte la page, ou `null` dans un navigateur. */
export function plateformeNative(): 'ios' | 'mac' | null {
  const natif = typeof window !== 'undefined' ? window.__belugaNatif : undefined;
  return natif?.plateforme === 'ios' || natif?.plateforme === 'mac' ? natif.plateforme : null;
}

/** Le numéro de version de l'application iPhone ou Mac qui porte la page (« 1.0.12 »), ou `null` dans un navigateur. */
export function versionNative(): string | null {
  const natif = typeof window !== 'undefined' ? window.__belugaNatif : undefined;
  return plateformeNative() && typeof natif?.version === 'string' && natif.version ? natif.version : null;
}

/** Envoie un message au natif ; sans application, ne fait rien. */
export function direAuNatif(message: Record<string, unknown>): void {
  window.__belugaNatif?.envoyer(message);
}

/** L'abonnement APNs de CET iPhone, gardé pour que les réglages le reconnaissent. */
export const CLE_ABONNEMENT_IPHONE = 'beluga-abonnement-iphone';

/** L'écran d'une ancre « /#projet/… » ou « #… ». */
function allerA(ancre: string) {
  const i = ancre.indexOf('#');
  const fragment = i >= 0 ? ancre.slice(i) : `#${ancre.replace(/^\/+/, '')}`;
  if (fragment.length > 1 && window.location.hash !== fragment) window.location.hash = fragment;
}

let branche = false;

/** À appeler une fois, au démarrage de l'application de l'administration. */
export function brancherLeNatif(): () => void {
  const plateforme = plateformeNative();
  if (!plateforme || branche) return () => {};
  branche = true;

  const recevoir = (event: Event) => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
    if (detail.type === 'jeton-push' && typeof detail.jeton === 'string') {
      const environnement = detail.environnement === 'sandbox' ? 'sandbox' : 'production';
      void fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apns: { jeton: detail.jeton, environnement } }),
      })
        .then((r) => r.json())
        .then((r: { ok?: boolean }) => {
          if (r?.ok) window.localStorage.setItem(CLE_ABONNEMENT_IPHONE, `apns:${environnement}:${String(detail.jeton).toLowerCase()}`);
        })
        .catch(() => {
          /* hors ligne : le natif redonne le jeton au prochain lancement */
        });
    } else if (detail.type === 'ouvrir' && typeof detail.ancre === 'string') {
      allerA(detail.ancre);
    } else if (detail.type === 'ouvrir-voix') {
      window.dispatchEvent(new CustomEvent('beluga:ouvrir-voix'));
    } else if (detail.type === 'parler-a-jarvis') {
      /* CMD+ESPACE SUR LE MAC (`natif/Mac/RaccourciJarvis.swift`, 16/11/2026) : le volet s'ouvre et Jarvis écoute. */
      parlerAJarvis();
    } else if (detail.type === 'jarvis-conversation') {
      /* Le double toucher au dos (intention « Parler à Jarvis ») : la conversation s'ouvre tout de suite. */
      window.dispatchEvent(new CustomEvent('beluga:jarvis-conversation'));
    }
  };
  window.addEventListener('beluga:natif', recevoir);

  /* Sur Mac, les alertes du démon deviennent des notifications du système (l'application les montre fenêtre cachée). */
  const arreterNotifications =
    plateforme === 'mac'
      ? client.onNotify((event) => {
          const fragment = event.url
            ? event.url
            : event.projectId
              ? `#${construireFragment({ vue: 'projet', projectId: event.projectId, ...(event.cardId ? { cardId: event.cardId } : {}) })}`
              : undefined;
          direAuNatif({ type: 'notification', titre: event.title, texte: event.body, ...(event.tag ? { id: event.tag } : {}), ...(fragment ? { ancre: fragment } : {}) });
        })
      : () => {};

  direAuNatif({ type: 'pret' });
  return () => {
    window.removeEventListener('beluga:natif', recevoir);
    arreterNotifications();
    branche = false;
  };
}

/** L'interrupteur « Toucher deux fois le dos lance Jarvis » (Réglages › Voix), retenu dans le compte. */
export const CLE_JARVIS_DOS = 'voix.jarvis-dos';
