import * as React from 'react';
import { FileText, X } from '@/components/ui/icones';
import { ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';

/**
 * LE VOLET DU PLAN, EN PIÈCES COMMUNES (carte « Volet des campagnes comme un plan », 10/11/2026 : « le volet à droite
 * doit s'ouvrir comme le volet d'un plan — même taille, même redimensionnement, même composition »). Le volet du
 * document d'une carte (`card-panel.tsx`) et celui du plan d'une campagne (Communication) se dessinent avec ces
 * pièces, pour ne plus jamais diverger :
 *   - le CONTENEUR collé au bord droit, fond `fond-plan` et marge de 8 px (`CLASSE_VOLET_DU_PLAN`) ;
 *   - la FENÊTRE arrondie au fond `bg` qui porte le contenu (`CLASSE_FENETRE_DU_VOLET`) ;
 *   - l'ENTÊTE : icône, titre, croix qui replie (`PanneauDuVolet`) ;
 *   - la LARGEUR : même mémoire (`width.document-de-carte`), mêmes bornes (`bornesDuVoletDuPlan`) — tirer la poignée
 *     d'une campagne règle aussi le plan des cartes, et inversement.
 */
export const CLASSE_VOLET_DU_PLAN = 'flex shrink-0 flex-col bg-fond-plan p-2';
export const CLASSE_FENETRE_DU_VOLET = 'overflow-hidden rounded-xl bg-bg shadow-sm ring-1 ring-faint/25';
export const CLE_DE_LARGEUR_DU_PLAN = 'document-de-carte';

/** 520 px au départ, 360 au moins ; le plafond laisse toujours 360 px à la conversation de la rangée mesurée. */
export function bornesDuVoletDuPlan(placeDeLaRangee: number): { initial: number; min: number; max: number } {
  return { initial: 520, min: 360, max: placeDeLaRangee ? Math.max(360, Math.min(960, placeDeLaRangee - 360)) : 960 };
}

/** La largeur RÉELLE d'une rangée (pas la fenêtre : la colonne de gauche peut être repliée), suivie au redimensionnement. */
export function usePlaceDeLaRangee(): [number, (el: HTMLDivElement | null) => void] {
  const [rangee, setRangee] = React.useState<HTMLDivElement | null>(null);
  const [place, setPlace] = React.useState(0);
  React.useEffect(() => {
    if (!rangee) return;
    const mesurer = () => setPlace(rangee.clientWidth);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(rangee);
    return () => observateur.disconnect();
  }, [rangee]);
  return [place, setRangee];
}

/** L'intérieur de la fenêtre : l'entête (icône, titre, croix — cachée sur téléphone) puis le contenu qui défile. */
export function PanneauDuVolet({
  titre,
  onFermer,
  libelleFermer,
  reperesCroix,
  children,
  pied,
  ...reste
}: {
  titre: string;
  onFermer: () => void;
  libelleFermer?: string;
  reperesCroix?: Record<`data-${string}`, string>;
  children: React.ReactNode;
  /** CE QUI RESTE COLLÉ EN BAS DU VOLET, hors de la zone qui défile (le rapport d'un dossier Marketing, 15/11/2026). */
  pied?: React.ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div className="flex h-full min-h-0 flex-col" {...reste}>
      <div className="flex shrink-0 items-center gap-2 px-5 pb-2 pt-3">
        <FileText className="h-4 w-4 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">{titre}</span>
        <button
          type="button"
          onClick={onFermer}
          title={libelleFermer ?? t('Fermer le plan')}
          {...(reperesCroix ?? {})}
          className="flex h-[38px] sm:h-8 w-[38px] sm:w-8 max-sm:hidden items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ZoneDefilement className="px-5 pb-6">{children}</ZoneDefilement>
      {pied ? (
        <div className="shrink-0 px-5 pb-4 pt-2" data-pied-du-volet>
          {pied}
        </div>
      ) : null}
    </div>
  );
}
