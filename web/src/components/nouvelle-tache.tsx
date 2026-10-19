import * as React from 'react';
import { aLeNiveauSurLeProjet } from '@/lib/mes-droits';
import { Loader2, Plus } from 'lucide-react';
import { Card, RAISON_CANAL_COUPE, TITRE_CARTE_DE_CADRAGE, gestesGeles } from '@beluga/shared';
import { CLASSE_LIBELLE_EN_BANDE } from '@/components/colonne-de-service';
import { CLASSE_GESTE_DE_CREATION_DE_COLONNE } from '@/components/rubriques-de-colonne';
import { client } from '@/lib/client';
import { useApp, useCanal } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE GESTE « NOUVELLE TÂCHE », UNE SEULE FOIS ÉCRIT. Le bouton de la colonne
 * de gauche (un projet, la page d'une tâche) s'en sert ; tout autre dessin qui
 * crée une carte de cadrage passe par lui aussi. Un seul geste — un second
 * appel `card.create` recopié aurait fini par diverger.
 */
export function useNouvelleTache(projectId: string) {
  const [busy, setBusy] = React.useState(false);
  const ouvrir = async () => {
    if (busy) return;
    if (gestesGeles(client.lireEtat().canal)) {
      client.pushToast('warning', t(RAISON_CANAL_COUPE));
      return;
    }
    setBusy(true);
    try {
      const data = await client.call<{ card: Card }>({
        type: 'card.create',
        projectId,
        title: TITRE_CARTE_DE_CADRAGE,
        cadrage: true,
      });
      if (data?.card) client.openCard(data.card.id);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('création impossible'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, ouvrir };
}

/**
 * LE BOUTON « NOUVELLE TÂCHE », TOUT EN HAUT DE LA COLONNE DE GAUCHE.
 *
 * Il quittait le haut de la rangée « Demande » du tableau : la colonne de
 * gauche suit le lieu où l'on est, et ce geste — le seul chemin vers une
 * nouvelle carte — vaut dans un projet comme sur la page d'une tâche. Il n'est
 * PAS une carte enregistrée : le clic fait naître la VRAIE carte de cadrage et
 * ouvre son fil.
 *
 * Même ligne que les autres entrées de la colonne ; réduite à sa bande
 * d'icônes, il garde le « + » seul. Le repère `data-nouvelle-carte` est celui
 * que visent les scripts de vérification, comme avant.
 */
export function BoutonNouvelleTache({ projectId }: { projectId: string }) {
  const { busy, ouvrir } = useNouvelleTache(projectId);
  const canal = useCanal();
  // Qui ne fait que VOIR ce projet ne crée rien : le geste ne lui est pas montré (le serveur le refuse aussi).
  if (!aLeNiveauSurLeProjet(useApp(), projectId, 'travailler')) return null;
  return (
    <button
      type="button"
      data-nouvelle-carte="planned"
      data-option-du-projet="nouvelle-tache"
      aria-label="Nouvelle tâche"
      aria-busy={busy}
      title={canal.gele ? canal.raison : t(TITRE_CARTE_DE_CADRAGE)}
      disabled={busy || canal.gele}
      onClick={() => void ouvrir()}
      /* NOIR, ÉCRITURE BLANCHE, DÉTACHÉ des options qui le suivent : le dessin
         est celui de tous les gestes qui créent en tête d'une colonne
         (`rubriques-de-colonne.tsx`, demande du 12/10/2026). */
      className={CLASSE_GESTE_DE_CREATION_DE_COLONNE}
    >
      <span className="shrink-0">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', CLASSE_LIBELLE_EN_BANDE)}>{t(TITRE_CARTE_DE_CADRAGE)}</span>
    </button>
  );
}
