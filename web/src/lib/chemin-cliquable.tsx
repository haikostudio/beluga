/**
 * LE LIEN D'UN FICHIER CITÉ — séparé de sa fenêtre (`components/fichiers-cites.tsx`)
 * pour que le rendu Markdown puisse s'en servir sans importer la visionneuse,
 * qui importe elle-même le rendu Markdown.
 */
import * as React from 'react';
import { cheminDeFichierCite } from '@beluga/shared';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export const ContexteDesFichiersCites = React.createContext<{
  adresse: (chemin: string) => string;
  ouvrir: (chemin: string) => void;
} | null>(null);

/**
 * UN CHEMIN QUI S'OUVRE AU CLIC — ou le texte tel quel, quand ce n'est pas un
 * chemin de fichier ou qu'aucun fil ne l'entoure.
 */
export function CheminCliquable({
  chemin,
  children,
  className,
}: {
  /** Le texte cité ; il n'est cliquable que s'il a toute la forme d'un chemin. */
  chemin: string;
  children: React.ReactNode;
  className?: string;
}) {
  const fichiers = React.useContext(ContexteDesFichiersCites);
  const reconnu = cheminDeFichierCite(chemin);
  if (!fichiers || !reconnu) return <>{children}</>;
  return (
    <a
      href={fichiers.adresse(reconnu)}
      onClick={(event) => {
        // Un clic modifié garde le geste du navigateur (nouvel onglet).
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        fichiers.ouvrir(reconnu);
      }}
      title={t('Ouvrir le fichier')}
      data-fichier-cite={reconnu}
      className={cn('cursor-pointer underline decoration-faint decoration-dotted underline-offset-2 hover:decoration-current', className)}
    >
      {children}
    </a>
  );
}
