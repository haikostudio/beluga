import * as React from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { filtrerLesSites } from '@beluga/shared';
import {
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmplacementDuTitreDePage,
  Input,
} from '@/components/ui';
import { IndicateursDeProjet } from '@/components/indicateurs-de-projet';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export interface ChoixDeProjet {
  id: string;
  nom: string;
  adresse?: string | null;
  icone: React.ReactNode;
  /**
   * L'identifiant du PROJET que ce choix désigne, quand c'en est un : la ligne
   * montre alors à droite ce qui y travaille et ce qui y attend
   * (`IndicateursDeProjet`). Absent — un site autonome, qui n'est pas un
   * projet —, la ligne reste nue.
   */
  projetId?: string;
}

/**
 * LE NOM D'UN PROJET, EN TÊTE DE SA FICHE, ouvre le menu qui passe d'un projet
 * à l'autre — même geste dans les Statistiques et dans l'atelier Marketing.
 * Chaque nom porte son icône, et un champ de filtre coiffe la liste (règle de
 * la recherche des sites, `filtrerLesSites` : nom et adresse, sans casse ni
 * accents). Entrée ouvre le premier projet retenu ; le filtre s'oublie à la
 * fermeture. L'appelant ne donne que les projets ACTIFS ; le projet ouvert
 * garde son icône et son nom en tête, qu'il figure dans la liste ou non.
 *
 * Le champ arrête la propagation des touches (sauf Échap, qui ferme) : sinon
 * la recherche par lettre du menu lui vole la frappe. Il ne prend le curseur
 * d'office que sur ordinateur — sur téléphone, le clavier couvrirait la liste.
 * `repere` fixe le préfixe des marqueurs `data-<repere>-selecteur`, `-choix`,
 * `-choix-filtre`, `-choix-vide` que lisent les scripts de vérification.
 *
 * `dansLeFil` : le sélecteur EST un cran du fil d'Ariane (`SuiteDuFil`) — même
 * taille que les autres crans, un fond au survol. C'est par lui qu'on passe
 * d'un projet à l'autre depuis la barre d'en-tête.
 */
export function SelecteurDeProjet({
  id,
  nom,
  icone,
  choix,
  onChoisir,
  repere,
  libelleFiltre,
  libelleVide,
  dansLeFil = false,
}: {
  dansLeFil?: boolean;
  id: string;
  nom: string;
  icone: React.ReactNode;
  choix: ChoixDeProjet[];
  onChoisir: (id: string) => void;
  repere: string;
  libelleFiltre: string;
  libelleVide: string;
}) {
  const telephone = useTelephone();
  const [filtre, setFiltre] = React.useState('');
  // Le menu donne d'abord le curseur à son panneau (au montage, après les
  // enfants) : on le reprend à l'image suivante.
  const prendreLeCurseur = React.useCallback(
    (el: HTMLInputElement | null) => {
      if (el && !telephone) requestAnimationFrame(() => el.focus());
    },
    [telephone],
  );
  const retenus = filtrerLesSites(choix, filtre);
  const marque = (suffixe: string, valeur = '') => ({ [`data-${repere}-${suffixe}`]: valeur });
  return (
    <DropdownMenu onOpenChange={(ouvert) => !ouvert && setFiltre('')}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={
            dansLeFil
              ? '-mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-raised data-[state=open]:bg-raised'
              : 'flex min-w-0 flex-1 items-center gap-1.5 text-left'
          }
          {...marque('selecteur')}
        >
          {icone}
          {/* Ce nom reste DANS son bouton : il ne monte pas, seul, dans le fil
              d'Ariane d'une page qui l'entourerait. */}
          <EmplacementDuTitreDePage.Provider value={null}>
            <DialogTitle className={dansLeFil ? 'min-w-0 truncate text-[14.5px] font-medium' : 'min-w-0 truncate'}>{nom}</DialogTitle>
          </EmplacementDuTitreDePage.Provider>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] sm:w-64">
        <div className="sticky top-0 z-10 bg-surface pb-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              ref={prendreLeCurseur}
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') return;
                e.stopPropagation();
                if (e.key === 'Enter' && retenus[0]) onChoisir(retenus[0].id);
              }}
              placeholder={libelleFiltre}
              aria-label={libelleFiltre}
              className="h-8 pl-7"
              {...marque('choix-filtre')}
            />
          </div>
        </div>
        {retenus.length ? (
          retenus.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => onChoisir(c.id)} {...marque('choix', c.id)}>
              {c.icone}
              <span className={cn('min-w-0 flex-1 truncate', c.id === id && 'font-medium')}>{c.nom}</span>
              {c.projetId ? <IndicateursDeProjet projectId={c.projetId} /> : null}
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-1.5 text-[12.5px] text-faint" {...marque('choix-vide')}>
            {libelleVide}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
