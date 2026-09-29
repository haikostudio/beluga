import * as React from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { filtrerLesSites } from '@beluga/shared';
import { DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input } from '@/components/ui';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export interface ChoixDeProjet {
  id: string;
  nom: string;
  adresse?: string | null;
  icone: React.ReactNode;
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
}: {
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
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" {...marque('selecteur')}>
          {icone}
          <DialogTitle className="min-w-0 truncate">{nom}</DialogTitle>
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
              <span className={cn('truncate', c.id === id && 'font-medium')}>{c.nom}</span>
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
