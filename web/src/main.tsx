import React from 'react';
import ReactDOM from 'react-dom/client';
import { REPERE_DE_PORTE, REPERE_D_IDENTITE, definirIdentiteDInstallation, porteDeLHote } from '@beluga/shared';
import { Filet } from './components/filet';
import { brancherRemonteeErreurs } from './lib/erreurs';
import { rechargerUneFois } from './lib/rechargement';
import './styles.css';
import { t } from '@/lib/langue';
import { brancherOuvertureDesMesures, mesuresDemandees } from './lib/ouverture-des-mesures';

/*
 * DEUX VISAGES, DEUX MORCEAUX : L'UN NE TÉLÉCHARGE JAMAIS L'AUTRE.
 *
 * L'adresse demandée décide de la racine montée — l'espace client sur son
 * adresse à lui (« my.… »), l'application d'administration ailleurs. Les deux
 * arrivent par un import DYNAMIQUE : le navigateur d'un client ne charge donc
 * pas le tableau, les agents et les quotas, et celui de Haiko ne paie pas le
 * poids d'un écran qu'il ouvre rarement.
 */
/*
 * Le démon dit quelle porte monter quand il le sait mieux que l'adresse : sur
 * une installation à une seule adresse, un compte client est servi au même
 * endroit que l'administration, et c'est son RÔLE qui décide (repère posé dans
 * la page par `pageAuNomDuClient`, `server/src/http.ts`).
 */
/*
 * CE QUE LE DÉMON DIT DE L'INSTALLATION, lu AVANT le premier affichage : le nom
 * de l'entreprise, celui de l'espace client, la zone des projets. Les textes
 * qui les citent n'ont ainsi rien à attendre.
 */
try {
  const brut = document.querySelector(`meta[name="${REPERE_D_IDENTITE}"]`)?.getAttribute('content');
  if (brut) definirIdentiteDInstallation(JSON.parse(brut));
} catch {
  /* une page sans repère (serveur de développement) garde l'identité vierge */
}

const porteAnnoncee = document.querySelector(`meta[name="${REPERE_DE_PORTE}"]`)?.getAttribute('content');

/* L'écran caché des mesures de l'iPhone prend la place des deux visages (`?mesures=1`). */
const Racine = React.lazy(() =>
  mesuresDemandees()
    ? import('./components/mesures-ecran').then((m) => ({ default: m.MesuresEcran }))
    : porteAnnoncee === 'client' || porteDeLHote(location.hostname) === 'client'
    ? import('./espace/porte-client').then((m) => ({ default: m.PorteClient }))
    : import('./app').then((m) => ({ default: m.App })),
);

/* La couche des infobulles vient avec la boîte à outils de l'interface, que les deux visages chargent de toute façon. */
const Infobulles = React.lazy(() => import('./components/ui').then((m) => ({ default: m.InfobullesDeLApplication })));

/*
 * AVANT tout le reste : une erreur survenue pendant le premier affichage doit
 * elle aussi remonter. Sur un téléphone, c'est la seule trace qu'on aura.
 */
brancherRemonteeErreurs();
brancherOuvertureDesMesures();

/*
 * UN MORCEAU DE CODE QUI N'EXISTE PLUS SE RECHARGE, IL NE LAISSE PAS L'ÉCRAN VIDE.
 *
 * Chaque mise en ligne renomme les morceaux de l'application (leur nom porte
 * une empreinte). Une application restée ouverte — ou installée sur le
 * téléphone — réclame ensuite un morceau disparu : le serveur répondait la page
 * d'accueil à la place, le navigateur refusait ce « script » (« Importing a
 * module script failed », « 'text/html' is not a valid JavaScript MIME type »),
 * et la zone restait blanche jusqu'à une relance à la main. 25 cas relevés sur
 * iPhone en cinq jours (12/10/2026).
 *
 * Vite signale l'échec d'un import dynamique par `vite:preloadError`. On
 * recharge UNE fois par morceau manquant, par le compteur commun
 * (`lib/rechargement.ts` : repos entre deux rechargements, plafond, jamais de
 * boucle) ; si le compteur refuse, l'erreur suit son chemin et le filet de
 * composant la dit.
 */
window.addEventListener('vite:preloadError', (event) => {
  const erreur = (event as Event & { payload?: unknown }).payload;
  const nom = erreur instanceof Error ? erreur.message : String(erreur ?? 'morceau');
  if (rechargerUneFois('morceau', nom)) event.preventDefault();
});

/* CE QU'ON VOIT PENDANT QUE L'APPLICATION ARRIVE : la même pause que « Connexion
   au serveur… », posée dès le premier rendu. Sans elle, la page restait vide
   pendant le téléchargement des morceaux — des secondes, sur un téléphone. */
function Demarrage() {
  return (
    <div className="grid h-full place-items-center bg-bg" data-demarrage>
      <div className="flex flex-col items-center gap-2">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-faint border-t-transparent" aria-hidden />
      </div>
    </div>
  );
}

// Le filet de dernier recours : plutôt un message lisible qu'une page vide.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Filet onReprendre={() => location.reload()}>
      <React.Suspense fallback={<Demarrage />}>
        <Racine />
        {/* Chaque `title` des DEUX visages devient l'infobulle maison : rapide, en fondu. */}
        <Infobulles />
      </React.Suspense>
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
   *
   * LE COMPTEUR EST PARTAGÉ avec le rechargement pour décalage de protocole
   * (`lib/rechargement.ts`) : les deux se déclenchent à chaque mise en ligne,
   * et chacun se croyait seul — d'où les rechargements en chaîne. Le repère
   * local `rechargement` reste là pour le cas de plusieurs événements dans la
   * même page, avant que le stockage n'ait pu servir.
   */
  let rechargement = false;
  const recharger = (valeur: string, avant?: () => Promise<unknown>) => {
    if (rechargement) return;
    rechargement = rechargerUneFois('version', valeur, avant);
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    /* La VALEUR sert au compteur de rechargements, elle n'est jamais affichée :
       l'adresse du service qui vient de prendre la main, ou un repère fixe. */
    recharger(navigator.serviceWorker.controller?.scriptURL ?? 'controllerchange');
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
          if (!registration.waiting) return;
          /* Ce filet efface tout et repart du serveur : il ne doit surtout pas
             s'ajouter à un rechargement qui vient d'avoir lieu. */
          recharger('filet-six-secondes', () =>
            Promise.all([
              registration.unregister().catch(() => undefined),
              'caches' in window
                ? caches.keys().then((cles) => Promise.all(cles.map((cle) => caches.delete(cle)))).catch(() => undefined)
                : Promise.resolve(),
            ]),
          );
        }, 6000);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              const banner = document.createElement('button');
              banner.textContent = t('Nouvelle version disponible — appuyez pour l\'appliquer');
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
