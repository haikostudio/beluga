import { WifiLow } from 'lucide-react';
import { useConnexionLente } from '@/lib/attente-silhouettes';
import { t } from '@/lib/langue';

/*
 * LE BANDEAU « CONNEXION LENTE » — en haut, au centre, comme celui de la mise à
 * jour, quand une zone attend ses données depuis plus de quatre secondes.
 *
 * Il ne demande rien et ne bloque rien (`pointer-events-none`) : il dit
 * seulement que l'attente n'est pas une panne. Il s'efface seul dès que plus
 * aucune silhouette n'attend. Une seule pastille, même si plusieurs zones
 * attendent. Quand le bandeau de mise à jour est là, il s'empile dessous.
 */
export function BandeauConnexionLente() {
  const { lente, sousUnBandeau } = useConnexionLente();
  if (!lente) return null;
  return (
    <div
      /* Même plan que le bandeau de mise à jour : au-dessus de l'écran de
         démarrage (`z-[45]`), sous les fenêtres (`z-50`). */
      className="pointer-events-none fixed inset-x-0 z-[46] flex justify-center px-3"
      style={{
        top: sousUnBandeau
          ? 'calc(max(0.5rem, env(safe-area-inset-top)) + 3rem)'
          : 'max(0.5rem, env(safe-area-inset-top))',
      }}
    >
      <div
        data-bandeau-connexion-lente
        role="status"
        className="flex max-w-full items-center gap-2 rounded-full bg-raised px-4 py-2 shadow-lg"
      >
        <WifiLow className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        <span className="min-w-0 text-[13.5px] text-text">
          {t('Connexion lente : le chargement prend plus de temps que d’habitude')}
        </span>
      </div>
    </div>
  );
}
