/**
 * LES DEUX PASTILLES DE LA MESSAGERIE, ÉCRITES UNE SEULE FOIS.
 *
 * Même écriture que celle de la surveillance — liseré, fond et texte d'un même
 * jeton d'état, lisibles dans les douze palettes : le non-lu en bleu
 * d'information, le à-traiter en orange.
 *
 * Elles se posent à DEUX endroits : la ligne « Messagerie » de la colonne de
 * gauche (le total de l'administrateur) et chaque ligne du tiroir « Clients »
 * (le même calcul, restreint à un client). D'où ce module à part : la colonne
 * ne doit pas être tirée dans l'écran de la Messagerie, qui se charge à la
 * demande.
 *
 * `colleADroite` pose le `ml-auto` dont la ligne de la colonne a besoin ; dans
 * un tiroir, l'alignement est déjà tenu par le conteneur qui les reçoit.
 */
import * as React from 'react';
import { Inbox, MessageSquare } from 'lucide-react';
import { Pastille, Tooltip } from '@/components/ui';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export function PastillesMessagerie({
  compteurs,
  colleADroite,
}: {
  compteurs: { nonLu: number; aTraiter: number };
  /** Coller le bloc au bord droit de la ligne (colonne de gauche). */
  colleADroite?: boolean;
}) {
  /* LA PASTILLE COMMUNE, EN LIGNE ET TEINTÉE : bleu à lire, orange à traiter. */
  return (
    <>
      {compteurs.nonLu ? (
        <Tooltip label={t('{n} non lus : demandes jamais ouvertes, commentaires et messages', { n: compteurs.nonLu })}>
          <Pastille
            nombre={compteurs.nonLu}
            ton="lire"
            teintee
            icone={<MessageSquare className="h-2.5 w-2.5" aria-hidden />}
            data-messagerie-non-lu={compteurs.nonLu}
            aria-label={`non-lu ${compteurs.nonLu}`}
            className={cn(colleADroite && 'ml-auto')}
          />
        </Tooltip>
      ) : null}
      {compteurs.aTraiter ? (
        <Tooltip label={t('{n} demandes à traiter', { n: compteurs.aTraiter })}>
          <Pastille
            nombre={compteurs.aTraiter}
            ton="repondre"
            teintee
            icone={<Inbox className="h-2.5 w-2.5" aria-hidden />}
            data-messagerie-a-traiter={compteurs.aTraiter}
            aria-label={`a-traiter ${compteurs.aTraiter}`}
            className={cn(colleADroite && !compteurs.nonLu && 'ml-auto')}
          />
        </Tooltip>
      ) : null}
    </>
  );
}
