import * as React from 'react';
import { Info } from '@/components/ui/icones';
import { bandeDeLOffreHebergee, type EtatDesNouveautes } from '@beluga/shared';
import { BandeDuHaut } from '@/components/bande-du-haut';
import { client } from '@/lib/client';
import { installationEnDirect, useNouveautes } from '@/lib/travail-installation';
import { t } from '@/lib/langue';

/*
 * LA BANDE DE L'OFFRE HÉBERGÉE — tout en haut, sur une installation GRATUITE (carte « Fin de la version gratuite »,
 * 21/11/2026). Beluga devient un service hébergé : une installation qui suivait le dépôt public ne reçoit plus de
 * nouveautés, et cette bande — la même que celle de l'extension, pleine largeur, en noir puisque c'est une
 * information (`bande-du-haut.tsx`) — la mène à la page « Passer à l'offre hébergée » des réglages.
 *
 * Elle ne paraît que sur une installation qui SUIT le dépôt public (`etat.suivi`) : la machine source et l'offre
 * hébergée ne la voient jamais. La croix l'écarte une semaine (`bandeDeLOffreHebergee`, shared).
 *
 * Elle est montée par `BanniereExtension` (`sinon`) : l'orange d'un geste nécessaire passe avant elle.
 */

const CLE = 'beluga-offre-hebergee-ecartee-le';

function ecarteeLe(): number | null {
  try {
    const brut = Number(localStorage.getItem(CLE));
    return Number.isFinite(brut) && brut > 0 ? brut : null;
  } catch {
    return null;
  }
}

export function BandeauMiseAJour({ onOuvrirLaPage }: { onOuvrirLaPage: () => void }) {
  const nouveautes = useNouveautes();
  const [ecartee, setEcartee] = React.useState<number | null>(ecarteeLe);

  // Ce que le démon sait déjà : il regarde le dépôt public toutes les heures.
  React.useEffect(() => {
    client
      .call<{ etat: EtatDesNouveautes }>({ type: 'installation.nouveautes' })
      .then((rendu) => installationEnDirect.recevoirLesNouveautes(rendu.etat))
      .catch(() => undefined);
  }, []);

  if (!bandeDeLOffreHebergee(nouveautes, ecartee, Date.now())) return null;

  const ecarter = () => {
    const maintenant = Date.now();
    try {
      localStorage.setItem(CLE, String(maintenant));
    } catch {
      /* stockage indisponible : la bande reviendra au prochain chargement */
    }
    setEcartee(maintenant);
  };

  return (
    <BandeDuHaut
      genre="information"
      data-bandeau-mise-a-jour
      data-bande-offre-hebergee
      icone={<Info className="size-4" />}
      texte={t('Beluga devient un service hébergé : la version gratuite ne reçoit plus de nouveautés. Transférez votre espace en un clic.')}
      texteCourt={t('Fin de la version gratuite.')}
      bouton={{ libelle: t('Voir l’offre'), onClick: onOuvrirLaPage, reperes: { 'data-voir-l-offre': '' } }}
      onFermer={ecarter}
      libelleFermer={t('Plus tard')}
    />
  );
}
