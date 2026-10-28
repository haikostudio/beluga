import React from 'react';
import { ZoneDefilement } from './ui';

/*
 * ÉCRAN CACHÉ DES MESURES (19/10/2026, carte « Marge du haut des applications
 * iPhone »). La marge de 20 px posée sous le flou d'iOS 27 n'a rien réglé : on
 * ne corrige plus à l'aveugle. Cet écran affiche, EN DIRECT, ce que l'iPhone
 * annonce vraiment — fenêtre, encarts de sécurité, mode installé, position du
 * premier élément de la page — pour qu'une capture suffise à trancher (piste :
 * bogue WebKit #317153, fenêtre de la PWA décalée de 62 pt).
 *
 * OÙ ON L'OUVRE : adresse `/?mesures=1`, ou, dans l'application installée qui
 * n'a pas de barre d'adresse, six appuis rapprochés dans le coin haut gauche
 * (`lib/ouverture-des-mesures.ts`). Il ne se lie à aucun menu.
 */

type Mesures = Array<[string, string]>;

const px = (n: number) => `${Math.round(n * 100) / 100} px`;

/** Un encart de sécurité se mesure par une sonde : `env()` n'est lisible que posé dans une règle CSS. */
function lireEncart(cote: 'top' | 'right' | 'bottom' | 'left'): number {
  const sonde = document.createElement('div');
  sonde.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;padding-${cote}:env(safe-area-inset-${cote},0px)`;
  document.body.appendChild(sonde);
  const valeur = parseFloat(getComputedStyle(sonde)[`padding${cote[0]!.toUpperCase()}${cote.slice(1)}` as 'paddingTop']) || 0;
  sonde.remove();
  return valeur;
}

/** Une sonde `position: fixed; bottom: 0` : où tombe vraiment le bord bas auquel s'ancrent le menu et le champ d'écriture. */
function lireBasFixe(): DOMRect | null {
  const sonde = document.createElement('div');
  sonde.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;visibility:hidden;pointer-events:none';
  document.body.appendChild(sonde);
  const rect = sonde.getBoundingClientRect();
  sonde.remove();
  return rect;
}

function relever(): Mesures {
  const vv = window.visualViewport;
  const racine = getComputedStyle(document.documentElement);
  const mode = ['standalone', 'fullscreen', 'minimal-ui', 'browser'].find((m) => window.matchMedia(`(display-mode: ${m})`).matches);
  const premier = document.querySelector('#root')?.firstElementChild?.getBoundingClientRect();
  const html = document.documentElement.getBoundingClientRect();
  const corps = document.body.getBoundingClientRect();
  const racineDom = document.getElementById('root')?.getBoundingClientRect();
  const basDeRoot = racineDom ? racineDom.bottom : null;
  const fond = lireBasFixe();
  const meta = (nom: string) => document.querySelector(`meta[name="${nom}"]`)?.getAttribute('content') ?? '(absent)';
  const nav = navigator as Navigator & { standalone?: boolean };
  return [
    ['MODE', ''],
    ['display-mode', mode ?? '?'],
    ['navigator.standalone', String(nav.standalone ?? 'non défini')],
    ['orientation', window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'paysage'],
    ['FENÊTRE', ''],
    ['innerWidth × innerHeight', `${window.innerWidth} × ${window.innerHeight}`],
    ['outerWidth × outerHeight', `${window.outerWidth} × ${window.outerHeight}`],
    ['screen.width × screen.height', `${screen.width} × ${screen.height}`],
    ['screen.availHeight', String(screen.availHeight)],
    ['clientHeight (html)', String(document.documentElement.clientHeight)],
    ['visualViewport L × H', vv ? `${px(vv.width)} × ${px(vv.height)}` : 'absent'],
    ['visualViewport décalage haut / gauche', vv ? `${px(vv.offsetTop)} / ${px(vv.offsetLeft)}` : 'absent'],
    ['visualViewport échelle', vv ? String(vv.scale) : 'absent'],
    ['pixels par point (devicePixelRatio)', String(window.devicePixelRatio)],
    ['scrollY', px(window.scrollY)],
    ['ENCARTS DE SÉCURITÉ', ''],
    ['safe-area-inset-top', px(lireEncart('top'))],
    ['safe-area-inset-bottom', px(lireEncart('bottom'))],
    ['safe-area-inset-left', px(lireEncart('left'))],
    ['safe-area-inset-right', px(lireEncart('right'))],
    ['--zone-sure-haut', racine.getPropertyValue('--zone-sure-haut').trim() || '(non défini)'],
    ['--zone-sure-haut-systeme', racine.getPropertyValue('--zone-sure-haut-systeme').trim() || '(non défini)'],
    ['--marge-flou-ios', racine.getPropertyValue('--marge-flou-ios').trim() || '(non défini)'],
    ['POSITION DE LA PAGE', ''],
    ['html : haut / hauteur', `${px(html.top)} / ${px(html.height)}`],
    ['body : haut / hauteur', `${px(corps.top)} / ${px(corps.height)}`],
    ['#root : haut / hauteur', racineDom ? `${px(racineDom.top)} / ${px(racineDom.height)}` : 'absent'],
    ['premier élément : haut / hauteur', premier ? `${px(premier.top)} / ${px(premier.height)}` : 'absent'],
    ['BAS DE L\'ÉCRAN', ''],
    ['innerHeight', String(window.innerHeight)],
    ['#root : bas', basDeRoot === null ? 'absent' : px(basDeRoot)],
    ['sonde fixed bottom:0 : bas', fond ? px(fond.bottom) : 'absent'],
    ['sonde fixed bottom:0 : bas − innerHeight', fond ? px(fond.bottom - window.innerHeight) : 'absent'],
    ['PAGE', ''],
    ['status-bar-style', meta('apple-mobile-web-app-status-bar-style')],
    ['viewport', meta('viewport')],
    ['theme-color', meta('theme-color')],
    ['adresse', location.href],
    ['navigateur', navigator.userAgent],
  ];
}

export function MesuresEcran() {
  const [mesures, setMesures] = React.useState<Mesures>(() => relever());
  const [copie, setCopie] = React.useState(false);

  React.useEffect(() => {
    const actualiser = () => setMesures(relever());
    const vv = window.visualViewport;
    window.addEventListener('resize', actualiser);
    window.addEventListener('orientationchange', actualiser);
    window.addEventListener('scroll', actualiser, { passive: true });
    vv?.addEventListener('resize', actualiser);
    vv?.addEventListener('scroll', actualiser);
    /* Une dernière lecture après le premier affichage : iOS annonce parfois ses encarts un instant plus tard. */
    const retard = window.setTimeout(actualiser, 600);
    return () => {
      window.clearTimeout(retard);
      window.removeEventListener('resize', actualiser);
      window.removeEventListener('orientationchange', actualiser);
      window.removeEventListener('scroll', actualiser);
      vv?.removeEventListener('resize', actualiser);
      vv?.removeEventListener('scroll', actualiser);
    };
  }, []);

  const texte = mesures.map(([k, v]) => (v === '' ? `\n${k}` : `${k} : ${v}`)).join('\n');

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 1800);
    } catch {
      /* presse-papiers refusé : la capture d'écran reste le recours */
    }
  };

  return (
    /* Corps et #root sont en `overflow: hidden` : la page défile dans sa propre zone, sinon son bas reste hors d'atteinte.
       Le haut et le bas réservent la zone sûre (`--zone-sure-haut` comprend la marge sous le flou d'iOS), une seule fois. */
    <ZoneDefilement
      className="h-full bg-bg px-4 text-text"
      classeEnveloppe="h-full"
      style={{ paddingTop: 'var(--zone-sure-haut, 0px)', paddingBottom: 'var(--zone-sure-bas, 0px)' }}
      data-mesures-ecran
    >
      {/* Un repère rouge collé au bord haut RÉEL de la page : on voit d'un coup d'œil où elle commence. */}
      <div className="fixed inset-x-0 top-0 z-10 h-[3px] bg-danger" aria-hidden />
      <div className="mx-auto max-w-xl pb-10 pt-6">
        <h1 className="text-base font-semibold">Mesures de l'écran</h1>
        <p className="mt-1 text-xs text-faint">
          Une capture d'écran de cette page suffit. Les valeurs se mettent à jour toutes seules.
        </p>
        <dl className="mt-4 text-xs">
          {mesures.map(([k, v]) =>
            v === '' ? (
              <dt key={k} className="mt-4 border-b border-faint/40 pb-1 text-[11px] font-semibold tracking-wide text-faint">
                {k}
              </dt>
            ) : (
              <div key={k} className="flex justify-between gap-4 py-1">
                <dt className="text-faint">{k}</dt>
                <dd className="max-w-[60%] break-words text-right font-mono">{v}</dd>
              </div>
            ),
          )}
        </dl>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={copier} className="rounded-md bg-text px-3 py-2 text-xs text-bg">
            {copie ? 'Copié' : 'Copier les mesures'}
          </button>
          <button
            type="button"
            onClick={() => location.assign(location.pathname)}
            className="rounded-md bg-surface px-3 py-2 text-xs"
          >
            Retour à l'application
          </button>
        </div>
      </div>
    </ZoneDefilement>
  );
}
