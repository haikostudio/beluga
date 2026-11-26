/**
 * L'ESPACE QUI N'ARRIVE PAS À SE RELIER — ce que le client voit, et le signal
 * qui part vers l'équipe.
 *
 * Carte « Accès client FishFlow bloqué » (26/11/2026) : un client restait sur
 * « Connexion à votre espace… » sans fin ni bouton. Après 30 s sans liaison
 * (`DELAI_AVANT_CONNEXION_BLOQUEE`, compté par le canal et suspendu pendant la
 * veille), l'écran le DIT, propose « Réessayer » et « Me déconnecter », et
 * prévient l'équipe une fois — par HTTP, puisque le canal est justement mort.
 */
import * as React from 'react';
import { Button } from '@/components/ui';
import { LogOut, RefreshCw } from '@/components/ui/icones';
import { t } from '@/lib/langue';
import {
  DELAI_OUVERTURE_DU_CANAL,
  ROUTE_SIGNALEMENT_DE_BLOCAGE,
  resteAvantConnexionBloquee,
  type EtapeDuBlocage,
} from '@beluga/shared';
import { canalEspace } from './canal-espace';

/** Vrai dès que l'espace attend sa liaison depuis plus de 30 s. */
export function useConnexionBloquee(): boolean {
  const [, relire] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => canalEspace.surChangementDeLiaison(relire), []);
  const depuis = canalEspace.sansLiaisonDepuis();
  const reste = resteAvantConnexionBloquee(depuis, Date.now());
  React.useEffect(() => {
    if (reste == null || reste <= 0) return;
    const minuteur = window.setTimeout(relire, reste + 50);
    return () => window.clearTimeout(minuteur);
  }, [depuis, reste]);
  return reste === 0;
}

/**
 * LE SIGNAL VERS L'ÉQUIPE : une seule fois par affichage de l'écran bloqué.
 * `keepalive` : il part même si le client recharge ou se déconnecte aussitôt.
 * Un échec ne se réessaie pas — le serveur ne répond peut-être pas non plus.
 */
export function useSignalementDeBlocage(bloquee: boolean, etape: EtapeDuBlocage): void {
  const parti = React.useRef(false);
  React.useEffect(() => {
    if (!bloquee) {
      parti.current = false;
      return;
    }
    if (parti.current) return;
    parti.current = true;
    const depuis = canalEspace.sansLiaisonDepuis();
    const corps = JSON.stringify({
      etape,
      dureeMs: depuis == null ? 0 : Date.now() - depuis,
      userAgent: navigator.userAgent,
    });
    try {
      void fetch(ROUTE_SIGNALEMENT_DE_BLOCAGE, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: corps,
      }).catch(() => undefined);
    } catch {
      /* rien à faire : l'écran reste juste */
    }
  }, [bloquee, etape]);
}

/** « Réessayer » tourne jusqu'au retour de la liaison, au plus le temps d'une tentative. */
function reessayer(): Promise<void> {
  return new Promise((fini) => {
    let arreter = () => {};
    const minuteur = window.setTimeout(() => {
      arreter();
      fini();
    }, DELAI_OUVERTURE_DU_CANAL);
    arreter = canalEspace.surChangementDeLiaison(() => {
      if (canalEspace.sansLiaisonDepuis() !== null) return;
      window.clearTimeout(minuteur);
      arreter();
      fini();
    });
    canalEspace.reessayer();
  });
}

/** Une navigation simple : le serveur efface la session sans avoir besoin du canal. */
function seDeconnecter(): void {
  window.location.href = '/auth/logout';
}

/** L'écran plein, quand l'espace n'a JAMAIS pu s'afficher. */
export function EcranConnexionBloquee() {
  return (
    <div
      className="flex h-dvh flex-col bg-bg text-text sm:items-center sm:justify-center"
      style={{ paddingTop: 'var(--zone-sure-haut, 0px)' }}
      data-porte-client="bloquee"
    >
      <div className="flex min-h-0 flex-1 flex-col sm:w-full sm:max-w-md sm:flex-none">
        <div className="flex flex-1 flex-col justify-center gap-2 px-4 text-center sm:flex-none sm:px-0">
          <h1 className="text-[17px] font-semibold text-text">{t('La connexion à votre espace n’aboutit pas')}</h1>
          <p className="text-sm text-muted">
            {t('Fermez les autres onglets ouverts sur votre espace et vérifiez votre connexion internet, puis réessayez.')}
          </p>
          <p className="text-xs text-faint">{t('L’équipe a été prévenue et regarde de son côté.')}</p>
        </div>
        <div
          className="flex flex-col gap-2 px-4 pt-4 sm:mt-5 sm:flex-row sm:justify-center sm:px-0 sm:pt-0"
          style={{ paddingBottom: 'calc(16px + var(--zone-sure-bas, env(safe-area-inset-bottom, 0px)))' }}
        >
          <Button variant="default" size="pied" className="sm:w-auto" onClick={reessayer} data-reessayer-connexion>
            <RefreshCw className="h-4 w-4" />
            {t('Réessayer')}
          </Button>
          <Button variant="subtle" size="pied" className="sm:w-auto" onClick={seDeconnecter} data-deconnexion-bloquee>
            <LogOut className="h-4 w-4" />
            {t('Me déconnecter')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Le bandeau, quand l'espace était affiché et que la liaison ne revient pas. */
export function BandeauConnexionBloquee() {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-warning/15 px-3 py-1.5 text-center text-xs text-warning"
      data-bandeau-canal="bloque"
    >
      <span>{t('La connexion à votre espace n’aboutit pas')}</span>
      <div className="flex gap-2">
        <Button variant="subtle" size="sm" onClick={reessayer} data-reessayer-connexion>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('Réessayer')}
        </Button>
        <Button variant="subtle" size="sm" onClick={seDeconnecter} data-deconnexion-bloquee>
          <LogOut className="h-3.5 w-3.5" />
          {t('Me déconnecter')}
        </Button>
      </div>
    </div>
  );
}
