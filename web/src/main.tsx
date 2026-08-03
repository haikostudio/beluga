import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { Filet } from './components/filet';
import './styles.css';

// Le filet de dernier recours : plutôt un message lisible qu'une page vide.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Filet onReprendre={() => location.reload()}>
      <App />
    </Filet>
  </React.StrictMode>,
);

// Application installable : mise à jour silencieuse, annoncée par un bandeau
// discret, jamais en cassant une conversation en cours (PLAN §20).
if ('serviceWorker' in navigator) {
  /*
   * Quand la nouvelle version prend la main, la page se recharge UNE fois,
   * toute seule. Sans cela, l'application continuait d'afficher l'habillage
   * déjà chargé et on croyait la mise en ligne ratée.
   */
  let rechargement = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (rechargement) return;
    rechargement = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      // `updateViaCache: 'none'` : le fichier du service est TOUJOURS
      // redemandé au serveur, jamais relu dans le cache du navigateur.
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        // Une version en attente sert encore l'ancien habillage : on la presse.
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        void registration.update();

        /*
         * Filet de sécurité : une version ANCIENNE du service (installée avant
         * qu'il sache s'effacer) ignore la demande de cession et garde la main
         * indéfiniment — l'ordinateur restait alors sur l'habillage d'avant
         * pendant que le téléphone, lui, était à jour (03/08/2026 : barre du
         * haut sans son bouton de menu). Si la relève n'a pas eu lieu au bout
         * de six secondes, on désinscrit tout, on vide les caches, et on
         * recharge UNE fois : la page repart alors du serveur.
         */
        window.setTimeout(() => {
          if (!registration.waiting || rechargement) return;
          rechargement = true;
          void Promise.all([
            registration.unregister().catch(() => undefined),
            'caches' in window
              ? caches.keys().then((cles) => Promise.all(cles.map((cle) => caches.delete(cle)))).catch(() => undefined)
              : Promise.resolve(),
          ]).then(() => location.reload());
        }, 6000);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              const banner = document.createElement('button');
              banner.textContent = 'Nouvelle version disponible — appuyez pour l\'appliquer';
              banner.style.cssText =
                'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:60;padding:8px 14px;border-radius:8px;border:1px solid hsl(var(--border));background:hsl(var(--surface));color:hsl(var(--text));font-size:12.5px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.4)';
              banner.onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
              document.body.appendChild(banner);
              // Le bandeau n'est qu'un repère : la bascule se fait toute seule.
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(() => undefined);
  });
}
