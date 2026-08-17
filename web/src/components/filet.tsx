import * as React from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { ZoneDefilement } from '@/components/ui';
import { detailErreur, signalerErreur } from '@/lib/erreurs';
import { t } from '@/lib/langue';

/**
 * Le filet de sécurité.
 *
 * Une erreur d'affichage non rattrapée vide TOUTE la page : il ne reste que le
 * fond, presque noir, sans un mot pour dire ce qui s'est passé. Ce filet
 * l'attrape et affiche à la place un message lisible, avec le détail de
 * l'erreur repliable et un bouton pour repartir.
 *
 * Il s'utilise à deux endroits : autour de l'application entière (dernier
 * recours), et autour de chaque panneau — ainsi un panneau qui plante ne
 * emporte plus le tableau avec lui.
 *
 * `muet` est pour ce qui FLOTTE au-dessus de l'écran (le module de voix) :
 * un encadré d'erreur y prendrait la place d'un accessoire et gênerait la
 * lecture. Le filet retient alors la panne sans rien afficher — la console la
 * garde en clair, et l'application entière reste debout.
 */
export class Filet extends React.Component<
  { children: React.ReactNode; zone?: string; onReprendre?: () => void; muet?: boolean },
  { erreur: Error | null }
> {
  state: { erreur: Error | null } = { erreur: null };

  static getDerivedStateFromError(erreur: Error) {
    return { erreur };
  }

  componentDidCatch(erreur: Error, infos: React.ErrorInfo) {
    // Laissé en clair dans la console : c'est ce qu'on relira pour corriger.
    console.error(`[HaikoDev] ${this.props.zone ?? 'application'} :`, erreur, infos.componentStack);
    /*
     * Et remontée au serveur : sur un téléphone, la console ne s'ouvre pas —
     * sans cet envoi, une page blanche ne laisse aucune trace. La pile des
     * composants part avec, c'est elle qui nomme le panneau fautif.
     */
    const detail = detailErreur(erreur);
    signalerErreur({
      source: 'affichage',
      message: detail.message,
      pile: [detail.pile, infos.componentStack].filter(Boolean).join('\n'),
      zone: this.props.zone ?? 'application',
    });
  }

  private reprendre = () => {
    this.setState({ erreur: null });
    this.props.onReprendre?.();
  };

  render() {
    const { erreur } = this.state;
    if (!erreur) return this.props.children;
    // Une zone flottante tombée disparaît, sans encadré posé en travers.
    if (this.props.muet) return null;

    return (
      <div className="grid min-h-[240px] place-items-center p-6 text-center">
        <div className="max-w-[440px]">
          <TriangleAlert className="mx-auto h-6 w-6 text-warning" />
          <p className="mt-2 text-[15px] font-medium text-text">
            {this.props.zone ? t('« {v0} » n\'a pas pu s\'afficher', { v0: this.props.zone }) : t('L\'affichage s\'est interrompu')}
          </p>
          <p className="mt-1.5 text-[13.5px] leading-snug text-muted">
            {t('Rien n\'est perdu : le travail en cours continue sur le serveur. Vous pouvez réessayer tout de suite.')}</p>

          <details className="mt-3 text-left">
            <summary className="cursor-pointer text-[12.5px] text-faint">{t('Détail technique')}</summary>
            <ZoneDefilement
              fond="hsl(var(--surface))"
              classeEnveloppe="mt-1.5 max-h-40 flex-none rounded-md border border-border bg-surface"
              className="p-2"
            >
              <pre className="whitespace-pre-wrap break-words text-[11.5px] text-muted">
                {erreur.message || String(erreur)}
              </pre>
            </ZoneDefilement>
          </details>

          <button
            onClick={this.reprendre}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-raised px-3 py-1.5 text-[13.5px] text-text hover:bg-surface"
          >
            <RotateCw className="h-3.5 w-3.5" />  {t('Réessayer')}
</button>
        </div>
      </div>
    );
  }
}
