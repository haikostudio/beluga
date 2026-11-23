import * as React from 'react';
import { RefreshCw } from '@/components/ui/icones';
import { bandeauDeMiseAJour, type EtatDesNouveautes } from '@beluga/shared';
import { BandeDuHaut } from '@/components/bande-du-haut';
import { client } from '@/lib/client';
import { installationEnDirect, useNouveautes } from '@/lib/travail-installation';
import { t } from '@/lib/langue';

/*
 * LE BANDEAU « UNE NOUVELLE MISE À JOUR EST DISPONIBLE » — tout en haut, quand le dépôt public de Beluga Build porte
 * du nouveau. LOGICIEL LIBRE (23/11/2026) : la version gratuite EST le dépôt public et reçoit toutes ses nouveautés ;
 * la bande « fin de la version gratuite » du 21/11/2026 est retirée.
 *
 * Il ne paraît que sur une installation qui SUIT ce dépôt (`etat.suivi`) : la machine source et l'offre Cloud ne le
 * voient jamais. Il ne lance RIEN : son bouton ouvre la page « Mise à jour » des réglages, d'où l'on lance la mise à
 * jour (`page-mise-a-jour.tsx`). La croix l'écarte jusqu'à la nouveauté SUIVANTE — c'est le sommet du dépôt public qui
 * est retenu, pas une date.
 *
 * Il passe par `BandeDuHaut` (genre « information ») et est monté par `BanniereExtension` (`sinon`) : l'orange d'un
 * geste nécessaire passe avant lui.
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
    <BandeDuHaut
      genre="information"
      data-bandeau-mise-a-jour
      icone={<RefreshCw className="size-4" />}
      texte={t('Une nouvelle mise à jour de Beluga est disponible.')}
      texteCourt={t('Nouvelle mise à jour disponible.')}
      bouton={{ libelle: t('Mettre à jour'), onClick: onOuvrirLaPage, reperes: { 'data-mettre-a-jour': '' } }}
      onFermer={ecarter}
      libelleFermer={t('Plus tard')}
    />
  );
}
