import * as React from 'react';
import { client } from '@/lib/client';
import { fermerLeDocument } from '@/lib/document-de-carte';
import { t } from '@/lib/langue';
import { Silhouette } from '@/components/silhouettes';
import { useMediasLivres } from '@/components/medias-livres';
import { Editeur } from './studio';

/**
 * LE GRAND VOLET DE MONTAGE D'UNE CARTE (chantier « Beluga Creative Studio »,
 * carte 3, 24/10/2026). Ouvert à côté de la conversation de la carte, il
 * embarque l'éditeur du Studio sur la création LIÉE à la carte
 * (`studio.carte.montage`) : créée au premier passage, en vertical, carré et
 * horizontal, puis nourrie des plans que la carte a fabriqués — image muette et
 * son séparé, posés à la suite. Un plan livré pendant que le volet est ouvert
 * y entre aussi : la liste des médias livrés relance l'appel.
 *
 * Chargé à part (`React.lazy` depuis la page de la carte) : une carte qu'on
 * n'a pas montée ne télécharge pas le Studio.
 */
/*
 * L'ÉDITEUR NE SE REDESSINE QU'À SES PROPRES CHANGEMENTS : la liste des médias
 * livrés lit tout le magasin (un tic d'export, un message d'ailleurs) ; ses
 * accessoires stables et `React.memo` l'en tiennent à l'écart.
 */
const EditeurDuMontage = React.memo(Editeur);
const RIEN = () => undefined;
const EN_CARTE = { onFermer: fermerLeDocument };

export default function MontageDeCarte({ cardId }: { cardId: string }) {
  const [creationId, setCreationId] = React.useState<string | null>(null);
  const livres = useMediasLivres({ cardId }).length;

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ creationId: string; aVerser: number }>({ type: 'studio.carte.montage', cardId })
      .then((r) => {
        if (!vivant) return;
        setCreationId(r.creationId);
        if (r.aVerser) client.pushToast('info', t('{n} plan(s) de la carte entrent dans le montage.', { n: r.aVerser }));
      })
      .catch((err: any) => {
        if (!vivant) return;
        client.pushToast('error', err?.message ?? t('Montage illisible'));
        fermerLeDocument();
      });
    return () => {
      vivant = false;
    };
  }, [cardId, livres]);

  if (!creationId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3" data-montage-chargement="">
        <Silhouette className="h-6 w-40" />
        <Silhouette className="min-h-0 flex-1" />
        <Silhouette className="h-40" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-montage-de-carte={cardId}>
      <EditeurDuMontage creationId={creationId} onRetour={fermerLeDocument} onOuvrir={RIEN} enCarte={EN_CARTE} />
    </div>
  );
}
