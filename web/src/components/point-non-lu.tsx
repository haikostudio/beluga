import { Tooltip } from '@/components/ui';
import { t } from '@/lib/langue';

/**
 * LE POINT BLEU « RENDU NON CONSULTÉ », posé sur le coin haut droit d'une
 * carte — une SEULE pièce pour les cartes du tableau et les cartes Système
 * (agent sans carte, dépannage, configuration, mise en production).
 *
 * Il s'éteint en ouvrant la carte, ou d'un clic sur lui sans l'ouvrir. La zone
 * de clic (24 px) dépasse le point, qui grossit nettement au survol : le clic
 * tombe à coup sûr, au doigt comme à la souris. Il est SŒUR du cadre de la
 * carte, jamais son enfant : le cadre rogne son contenu (`overflow-hidden`), et
 * ni le clic ni l'appui sur le point n'ouvrent la carte ni ne lancent le
 * glisser. Son parent doit donc être `relative`.
 */
export function PointNonLu({
  onLire,
  ...attributs
}: { onLire: () => void } & Record<`data-${string}`, string | undefined>) {
  return (
    <Tooltip label={t('Rendu non consulté — cliquer pour le marquer comme consulté')}>
      <button
        type="button"
        aria-label="Rendu non consulte - cliquer pour le marquer comme consulte"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onLire();
        }}
        className="group absolute -right-3 -top-3 z-20 flex h-6 w-6 items-center justify-center rounded-full"
        {...attributs}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-termine shadow-sm transition-transform duration-150 group-hover:scale-[1.8] group-focus-visible:scale-[1.8]" />
      </button>
    </Tooltip>
  );
}
