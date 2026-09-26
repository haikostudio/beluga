/**
 * Service worker Beluga Build.
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
const CACHE = 'beluga-__EMPREINTE_DU_PAQUET__';
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
  // L'Espace client, des deux côtés : quelqu'un attend une réponse.
  'espace-message': 'attention',
  'espace-demande': 'attention',
  'espace-modification': 'attention',
  // Ce qui avance sur une demande : prise en charge, rangée, carte démarrée ou
  // terminée — et la carte EN LIGNE, avec l'image d'une publication.
  'espace-prise-en-charge': 'termine',
  'espace-archivage': 'termine',
  'espace-avancement': 'termine',
  'espace-en-ligne': 'publication',
  'publication-terminee': 'publication',
  'publication-echec': 'erreur',
  // Une étape qui traîne prévient AU CONSTAT, sans attendre qu'un dépanneur
  // parte : c'est un blocage, donc l'image d'un blocage.
  'publication-en-retard': 'erreur',
  // Les deux BLOCAGES : une limite atteinte, un identifiant qui ne répond plus.
  // Le redémarrage du serveur et les paliers 70 % / 90 % du quota n'alertent
  // plus — ils n'ont donc plus rien à traduire ici.
  // Un site surveillé qui tombe : une panne, donc l'image d'une erreur.
  'site-indisponible': 'erreur',
  'compte-sature': 'quota',
  'amorcage-impossible': 'quota',
  'jeton-claude-bloque': 'quota',
};

function imageDeLAlerte(motif) {
  const nom = ICONES[motif];
  return nom ? `/notif/${nom}.png` : '/icon-192.png';
}

/*
 * LE VISAGE CLIENT (« Haiko Chat », servi sur `my.…`, même règle que
 * `porteDeLHote` de `shared/src/porte-client.ts`) montre la BALEINE sur ses
 * alertes : ni icône de l'administration, ni rien d'autre — un client ne
 * connaît pas le tableau.
 */
const VISAGE_CLIENT = /^my\./.test(self.location.hostname);

/*
 * L'AVATAR D'UNE ALERTE EST L'ICÔNE NEUTRE DE SON MOTIF, et rien d'autre.
 *
 * Une table recopiée ici faisait correspondre un motif à une COLONNE, pour
 * afficher le portrait rond de son personnage. Les personnages ont été retirés
 * de toute l'application : le détour disparaît avec eux, et le jeu d'icônes
 * par motif — qui existait déjà et servait de repli — prend le relais partout.
 * Il n'y avait donc aucune icône à dessiner.
 */
function avatarDeLAlerte(motif) {
  if (VISAGE_CLIENT) return '/icon-192.png';
  return imageDeLAlerte(motif);
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
  let payload = { title: 'Beluga Build', body: '' };
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
      tag: payload.tag || 'beluga',
      renotify: true,
      icon: avatarDeLAlerte(payload.motif),
      // La pastille est minuscule et monochrome : l'icône de l'application y
      // reste plus lisible qu'un dessin de plus.
      badge: '/icon-192.png',
      data: { cardId: payload.cardId, projectId: payload.projectId, agentId: payload.agentId, url: payload.url },
    }),
  );
});

/**
 * L'adresse qui retrouve la décision quand AUCUN onglet n'est ouvert
 * (application fermée).
 *
 * CE FICHIER NE CONSTRUIT PLUS AUCUNE ADRESSE. Il recopiait le format
 * « #projet/<id>/tache/<id> » des règles partagées
 * (`shared/src/adresse-navigateur.ts`), qu'il ne peut pas importer : deux
 * écritures du même format, condamnées à diverger dès qu'une adresse
 * s'enrichit. L'adresse arrive maintenant toute faite dans la notification,
 * construite par le démon avec ces règles-là (`server/src/push.ts`), comme le
 * faisait déjà l'espace client. Sans adresse, on ouvre l'accueil.
 */
function cibleDeNotification(data) {
  return data.url || '/';
}

// Un appui emmène directement à la décision concernée.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = cibleDeNotification(data);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      /*
       * L'APPLICATION DÉJÀ OUVERTE SUIT L'ADRESSE, SANS RECHARGER. On vise la
       * fenêtre visible d'abord (plusieurs onglets : celle qu'on regarde), puis
       * n'importe laquelle. Fermée, l'application s'ouvre DIRECTEMENT sur
       * l'adresse : elle est dans la portée `/` de la fiche d'installation, donc
       * dans l'application installée, pas dans le navigateur. Une alerte qui en
       * regroupe plusieurs n'a plus d'adresse précise : elle ouvre l'accueil.
       */
      const fenetres = clientList.filter((client) => 'focus' in client);
      const client = fenetres.find((f) => f.visibilityState === 'visible') ?? fenetres[0];
      if (client) {
        if (data.url) client.postMessage({ type: 'OPEN_URL', url: data.url });
        else client.postMessage({ type: 'OPEN_CARD', cardId: data.cardId, projectId: data.projectId, agentId: data.agentId });
        return client.focus();
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
