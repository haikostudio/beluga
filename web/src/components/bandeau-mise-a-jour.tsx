import * as React from 'react';
import { Loader2, X } from 'lucide-react';
import { bandeauDeMiseAJour, type EtatDesNouveautes } from '@beluga/shared';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { recupererLesNouveautes } from '@/lib/nouveautes';
import { installationEnDirect, useNouveautes } from '@/lib/travail-installation';
import { t } from '@/lib/langue';

/*
 * LE BANDEAU « METTRE À JOUR » — en haut, au centre, quand le dépôt public de
 * Beluga Build porte du nouveau.
 *
 * Il ne paraît que sur une installation qui SUIT ce dépôt (`etat.suivi`) : sur
 * un dépôt de travail privé, le démon répond qu'il ne suit rien et l'écran ne
 * montre rien. Il ne s'applique jamais seul : « Mettre à jour » est un geste,
 * et la croix l'écarte jusqu'à la nouveauté SUIVANTE — c'est le sommet du dépôt
 * public qui est retenu, pas une date.
 */

const CLE = 'beluga-nouveautes-ecartees';

function sommetEcarte(): string | null {
  try {
    return localStorage.getItem(CLE);
  } catch {
    return null;
  }
}

export function BandeauMiseAJour({ onOuvrirLInstallation }: { onOuvrirLInstallation: () => void }) {
  const nouveautes = useNouveautes();
  const [ecarte, setEcarte] = React.useState<string | null>(sommetEcarte);
  const [envoi, setEnvoi] = React.useState(false);

  // Ce que le démon sait déjà : il regarde le dépôt public une fois par jour.
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

  const mettreAJour = async () => {
    setEnvoi(true);
    const mode = await recupererLesNouveautes();
    setEnvoi(false);
    if (!mode) return;
    // La suite se passe ailleurs — une tâche à lancer, ou le travail affiché
    // dans les réglages : le bandeau a fait son office.
    ecarter();
    if (mode === 'simple') onOuvrirLInstallation();
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
          {nouveautes?.nombre
            ? t('{n} nouveauté(s) de Beluga Build sont disponibles.', { n: String(nouveautes.nombre) })
            : t('Des nouveautés de Beluga Build sont disponibles.')}
        </span>
        <Button variant="default" size="sm" data-mettre-a-jour disabled={envoi} onClick={() => void mettreAJour()}>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('Mettre à jour')}
        </Button>
        <Button variant="ghost" size="icon-sm" data-ecarter-la-mise-a-jour title={t('Plus tard')} onClick={ecarter}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
