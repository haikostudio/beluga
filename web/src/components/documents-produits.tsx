/**
 * LES DOCUMENTS PRODUITS PAR UN TOUR, SOUS SA RÉPONSE (25/10/2026).
 *
 * Demande de l'utilisateur : « quand il joint un document, il faut qu'il me
 * mette en dessous un bouton qui me permet d'ouvrir ce document directement
 * dans l'application » — et pour les anciennes réponses aussi. Chaque document
 * écrit ou joint pendant le tour (`documentsDuTour`, règle partagée) porte un
 * bouton à son nom, qui l'ouvre dans LA visionneuse des fichiers cités
 * (`FichiersCites`) : on l'y lit mis en forme, on le copie, on le télécharge.
 *
 * Sans fil autour (aucun fournisseur), rien ne s'affiche : il n'y aurait rien
 * pour l'ouvrir.
 */
import * as React from 'react';
import { FileText } from 'lucide-react';
import { nomDuChemin } from '@beluga/shared';
import { Button } from '@/components/ui';
import { ContexteDesFichiersCites } from '@/lib/chemin-cliquable';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export function DocumentsProduits({ chemins, className }: { chemins: readonly string[]; className?: string }) {
  const fichiers = React.useContext(ContexteDesFichiersCites);
  if (!fichiers || !chemins.length) return null;
  return (
    <div className={cn('mt-2.5 flex flex-wrap gap-1.5', className)} data-documents-produits={chemins.length}>
      {chemins.map((chemin) => (
        <Button
          key={chemin}
          type="button"
          variant="subtle"
          size="sm"
          className="max-w-full"
          title={t('Ouvrir le document {v0}', { v0: chemin })}
          onClick={() => fichiers.ouvrir(chemin)}
          data-document-produit={chemin}
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{nomDuChemin(chemin)}</span>
        </Button>
      ))}
    </div>
  );
}
