import * as React from 'react';
import { PageEnPlace } from '@/components/communication-v2/socle/page-en-place';
import { GestesDesEtapes } from './pieces';

/**
 * LA PAGE D'UNE ÉTAPE DE COMMUNICATION 2 (carte « Communication 2 : finitions et chats ») : la page en place de
 * l'espace Communication, avec des différences qui ne touchent QUE Communication 2 (l'ancien espace garde son rendu,
 * `PageEnPlace` y est inchangé par défaut) :
 *   - l'EN-TÊTE ALIGNÉ sur le contenu (`aligne`) : la ligne du haut s'arrête aux mêmes bords que la colonne de 920 px ;
 *   - PAS DE GRAND TITRE : il faisait doublon avec le dernier cran du fil d'Ariane (capture #077c5) — le sous-titre et
 *     les gestes de droite restent ;
 *   - AUCUNE FLÈCHE DE RETOUR EN HAUT (demande du 08/11/2026, « je ne veux pas de bouton back ») : `retour` est IGNORÉ
 *     ici, même passé par une page — on remonte par le fil d'Ariane, la colonne, ou la flèche ICÔNE du pied
 *     (`PiedDAvance`). Sur téléphone, la flèche de la barre d'en-tête de l'application reste (`[data-retour-du-fil]`) ;
 *   - PLUS DE BARRE D'ÉTAPES EN HAUT (demande du 08/11/2026, « vire la progress bar en haut ») : on change d'étape par
 *     la colonne, par « Précédent » / « Suivant » et, sur téléphone, par le menu du bas ;
 *   - LE PIED : « Précédent » / « Suivant » AU-DESSUS du champ, chacun seulement quand il sert (`GestesDesEtapes`),
 *     puis le champ du chef, présent sur CHAQUE page. `barre={false}` (« Réponses », qui n'est pas une étape) : ni
 *     Précédent ni Suivant.
 */
export function PageV2({
  titre: _titre,
  retour: _retour,
  pied,
  barre = true,
  children,
  ...reste
}: React.ComponentProps<typeof PageEnPlace> & { barre?: boolean }) {
  const piedComplet = barre ? (
    <div className="flex w-full min-w-0 flex-col gap-1.5" data-v2-pied>
      <GestesDesEtapes />
      {pied ?? null}
    </div>
  ) : (
    pied
  );
  return (
    <PageEnPlace aligne {...(piedComplet ? { pied: piedComplet } : {})} {...reste}>
      {children}
    </PageEnPlace>
  );
}
