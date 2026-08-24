/**
 * Service worker HaikoDev.
 * L'habillage est mis en cache pour un démarrage instantané ; les données
 * passent toujours par le réseau (le démon est la source de vérité).
 */
/*
 * Le NUMÉRO change à chaque mise en ligne d'une version d'habillage : à
 * l'activation, tous les caches portant un autre numéro sont effacés. Sans ce
 * changement, les fichiers au nom haché restaient en cache indéfiniment et
 * l'application continuait d'afficher l'ancienne version (rencontré le
 * 03/08/2026 : ancienne barre du haut alors que la nouvelle était en ligne).
 *
 * IL NE S'ÉCRIT PLUS À LA MAIN. Le jeton est remplacé à la construction par
 * l'EMPREINTE du paquet (`web/empreinte-paquet.ts`) : un paquet neuf change
 * donc forcément ce fichier, le navigateur y voit une version neuve, et toute
 * la chaîne — installation, effacement des anciens caches, relève, rechargement
 * — se déclenche d'elle-même. Tant que ce numéro dépendait d'un geste humain,
 * une mise en ligne ordinaire laissait `sw.js` identique octet pour octet et un
 * téléphone pouvait rester sur l'écran d'avant.
 */
const CACHE = 'haikodev-__EMPREINTE_DU_PAQUET__';
const SHELL = ['/', '/icon.svg', '/icon-192.png', '/manifest.json'];

/**
 * L'image de l'alerte suit le GENRE de nouvelle, pas la famille de réglage :
 * une publication en échec porte l'image d'erreur. La table est recopiée ici
 * parce qu'un service worker ne partage rien avec l'application ; elle ne fait
 * que traduire le motif, la règle qui décide vit dans
 * `shared/src/notification-tri.ts`. Un motif inconnu retombe sur l'icône de
 * l'application : jamais d'alerte sans image.
 */
const ICONES = {
  'tache-terminee': 'termine',
  'travail-sans-carte': 'termine',
  'tache-echec': 'erreur',
  'decision-attendue': 'attention',
  'publication-terminee': 'publication',
  'publication-echec': 'erreur',
  // Une étape qui traîne prévient AU CONSTAT, sans attendre qu'un dépanneur
  // parte : c'est un blocage, donc l'image d'un blocage.
  'publication-en-retard': 'erreur',
  // Les deux BLOCAGES : une limite atteinte, un identifiant qui ne répond plus.
  // Le redémarrage du serveur et les paliers 70 % / 90 % du quota n'alertent
  // plus — ils n'ont donc plus rien à traduire ici.
  'compte-sature': 'quota',
  'amorcage-impossible': 'quota',
  'jeton-claude-bloque': 'quota',
};

function imageDeLAlerte(motif) {
  const nom = ICONES[motif];
  return nom ? `/notif/${nom}.png` : '/icon-192.png';
}

/**
 * La COLONNE dont l'alerte parle : son personnage sert alors d'avatar, en rond.
 * Table recopiée de `shared/src/personnages-colonnes.ts`, pour la même raison
 * que celle des icônes — un service worker ne partage rien avec l'application.
 * Un motif qui ne se passe dans aucune colonne (quota, redémarrage) n'y figure
 * pas : il garde l'image de son genre plutôt qu'un visage pris au hasard.
 */
const PERSONNAGES = {
  'tache-terminee': 'done',
  'travail-sans-carte': 'done',
  'liste-taches': 'done',
  'tache-echec': 'running',
  'decision-attendue': 'running',
  'publication-terminee': 'in_production',
  'publication-echec': 'to_deploy',
  // « publication-en-retard » n'y figure PAS à dessein : un retard peut tomber
  // sur un déploiement comme sur une mise en production, donc sur deux colonnes
  // différentes. Il garde l'image de son genre plutôt qu'un visage pris au
  // hasard — exactement la règle de cette table.
};

function avatarDeLAlerte(motif) {
  const colonne = PERSONNAGES[motif];
  return colonne ? `/personnages/${colonne}-rond.png` : imageDeLAlerte(motif);
}

self.addEventListener('install', (event) => {
  // On ne fait pas la queue derrière l'ancienne version : elle sert du périmé.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Notifications reçues même quand l'application est fermée.
self.addEventListener('push', (event) => {
  let payload = { title: 'HaikoDev', body: '' };
  try {
    payload = event.data ? event.data.json() : payload;
  } catch {
    payload.body = event.data ? event.data.text() : '';
  }
  /*
   * Le chiffre sur l'icône de l'application, même fermée : c'est le compte des
   * réponses rendues qu'on n'a pas encore lues. À zéro, on retire la pastille
   * au lieu de laisser un « 0 ».
   */
  if (typeof payload.nonLues === 'number' && self.navigator && self.navigator.setAppBadge) {
    try {
      if (payload.nonLues > 0) self.navigator.setAppBadge(payload.nonLues);
      else self.navigator.clearAppBadge?.();
    } catch {
      /* pastille d'icône refusée : le reste de la notification part quand même */
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // Même étiquette = une seule notification affichée, pas une avalanche.
      tag: payload.tag || 'haikodev',
      renotify: true,
      icon: avatarDeLAlerte(payload.motif),
      // La pastille est minuscule et monochrome : l'icône de l'application y
      // reste plus lisible qu'un dessin de plus.
      badge: '/icon-192.png',
      data: { cardId: payload.cardId, projectId: payload.projectId, agentId: payload.agentId },
    }),
  );
});

/**
 * L'adresse qui retrouve la décision quand AUCUN onglet n'est ouvert
 * (application fermée) : le même format « #projet/<id>/tache/<id> » que
 * l'application lit elle-même au démarrage (`lireFragment`,
 * `shared/src/adresse-navigateur.ts`). Sans carte, on pose le projet seul —
 * la conversation du chef d'orchestre y est déjà visible par défaut.
 */
function cibleDeNotification(data) {
  if (!data.projectId) return '/';
  const base = `/#projet/${encodeURIComponent(data.projectId)}`;
  return data.cardId ? `${base}/tache/${encodeURIComponent(data.cardId)}` : base;
}

// Un appui emmène directement à la décision concernée.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = cibleDeNotification(data);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'OPEN_CARD', cardId: data.cardId, projectId: data.projectId, agentId: data.agentId });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  // Jamais de cache sur les données ni sur l'authentification.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/ws')) return;

  // Ressources au nom haché : cache d'abord.
  if (/\/assets\/.*-[A-Za-z0-9_]{8,}\.(js|css|woff2)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Navigation : réseau d'abord, cache en repli (hors-ligne lisible).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Une réponse redirigée (mur d'accès) ne doit jamais être mise en cache.
          if (!response.redirected && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached ?? new Response('Hors ligne', { status: 503 }))),
    );
  }
});
