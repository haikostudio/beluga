import * as React from 'react';
import { X } from 'lucide-react';
import { bandeauDeMiseAJour, type EtatDesNouveautes } from '@beluga/shared';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { installationEnDirect, useNouveautes } from '@/lib/travail-installation';
import { t } from '@/lib/langue';

/*
 * LE BANDEAU « METTRE À JOUR » — en haut, au centre, quand le dépôt public de
 * Beluga Build porte du nouveau.
 *
 * Il ne paraît que sur une installation qui SUIT ce dépôt (`etat.suivi`) : sur
 * un dépôt de travail privé, le démon répond qu'il ne suit rien et l'écran ne
 * montre rien. Il ne lance RIEN : son bouton ouvre la page « Mise à jour » des
 * réglages, d'où l'on lance la mise à jour (`page-mise-a-jour.tsx`). La croix
 * l'écarte jusqu'à la nouveauté SUIVANTE — c'est le sommet du dépôt public qui
 * est retenu, pas une date.
 */

const CLE = 'beluga-nouveautes-ecartees';

function sommetEcarte(): string | null {
  try {
    return localStorage.getItem(CLE);
  } catch {
    return null;
  }
}

export function BandeauMiseAJour({ onOuvrirLaPage }: { onOuvrirLaPage: () => void }) {
  const nouveautes = useNouveautes();
  const [ecarte, setEcarte] = React.useState<string | null>(sommetEcarte);

  // Ce que le démon sait déjà : il regarde le dépôt public toutes les heures.
  React.useEffect(() => {
    client
      .call<{ etat: EtatDesNouveautes }>({ type: 'installation.nouveautes' })
      .then((rendu) => installationEnDirect.recevoirLesNouveautes(rendu.etat))
      .catch(() => undefined);
  }, []);

  if (!bandeauDeMiseAJour(nouveautes, ecarte)) return null;

  const ecarter = () => {
    const sommet = nouveautes?.sommet ?? '';
    try {
      localStorage.setItem(CLE, sommet);
    } catch {
      /* stockage indisponible : le bandeau reviendra au prochain chargement */
    }
    setEcarte(sommet);
  };

  return (
    <div
      /* AU-DESSUS de l'écran qui barre la route faute de moteur (`z-[45]`), SOUS
         les fenêtres (`z-50`) : une mise à jour se récupère même sans moteur
         prêt, et un bandeau visible mais recouvert ne se cliquerait pas. */
      className="pointer-events-none fixed inset-x-0 z-[46] flex justify-center px-3"
      style={{ top: 'max(0.5rem, var(--zone-sure-haut, 0px))' }}
    >
      <div
        data-bandeau-mise-a-jour
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-raised py-1.5 pl-4 pr-1.5 shadow-lg"
      >
        <span className="min-w-0 truncate text-[13.5px] text-text">
          {t('Une nouvelle mise à jour de Beluga est disponible.')}
        </span>
        <Button variant="default" size="sm" data-mettre-a-jour onClick={onOuvrirLaPage}>
          {t('Mettre à jour')}
        </Button>
        <Button variant="ghost" size="icon-sm" data-ecarter-la-mise-a-jour title={t('Plus tard')} onClick={ecarter}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
