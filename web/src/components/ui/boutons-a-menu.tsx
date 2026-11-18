import * as React from 'react';
import { Check, ChevronDown, MoreHorizontal, SlidersHorizontal } from '@/components/ui/icones';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/*
 * LES BOUTONS À MENU DE TOUTE L'APPLICATION (retours du 04/11/2026, deuxième passe : « vire-moi ces barres ; les filtres
 * dans un bouton avec un menu, la vue dans un menu, partout où il y a des rangées de boutons »). Trois pièces, de la
 * hauteur commune des boutons (`size="sm"`) :
 *   - « Filtres » : tous les filtres d'une liste, par groupe, avec le nombre de filtres actifs ;
 *   - « Vue » : le choix EXCLUSIF de ce qu'on regarde (vue verticale / mensuelle, grille / liste, une section) ;
 *   - « … » : les gestes rares d'une page.
 * Une barre d'onglets ne sert plus à choisir une vue ni à filtrer.
 */

export interface GroupeDeFiltre {
  cle: string;
  titre: string;
  valeur: string;
  /** La valeur « tout » : un filtre qui la porte n'est pas actif. */
  tout?: string;
  options: { valeur: string; libelle: string; icone?: React.ReactNode; nombre?: number }[];
  onChoisir: (v: string) => void;
}

/**
 * LE BOUTON « FILTRES » (retours du 04/11/2026 : « les filtres dans un seul bouton avec un menu ») : remplace toute
 * rangée de listes ou de pastilles. Il compte les filtres actifs, et son menu les range par groupe.
 */
export function BoutonFiltres({ groupes, repere, icone = false }: { groupes: GroupeDeFiltre[]; repere: string; /** L'icône seule, sans libellé ; le compte des filtres actifs en pastille. */ icone?: boolean }) {
  const actifs = groupes.filter((g) => g.valeur !== (g.tout ?? ''));
  if (!groupes.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {icone ? (
          /* EN ICÔNE SEULE (carte du 04/11/2026 : « sans label, et à droite ») : le nombre de filtres actifs se pose en
             pastille au coin, le nom se lit au survol. */
          <Button
            size="icon-barre"
            variant={actifs.length ? 'subtle' : 'ghost'}
            className={cn('relative shrink-0', actifs.length ? 'text-text' : 'text-muted')}
            aria-label="Filtres"
            title={t('Filtres')}
            data-bouton-filtres={repere}
            data-actifs={actifs.length}
            data-en-icone=""
          >
            <SlidersHorizontal className="h-4 w-4" />
            {actifs.length ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-text px-1 text-[10px] font-semibold tabular-nums leading-none text-bg">{actifs.length}</span> : null}
          </Button>
        ) : (
          <Button size="sm" variant={actifs.length ? 'subtle' : 'ghost'} className={cn('shrink-0', actifs.length ? 'text-text' : 'text-muted')} data-bouton-filtres={repere} data-actifs={actifs.length}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t('Filtres')}
            {actifs.length ? <span className="rounded-full bg-raised px-1.5 text-[11px] tabular-nums text-text">{actifs.length}</span> : null}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" titre={t('Filtres')} className="min-w-[230px]">
        {groupes.map((g, i) => (
          <React.Fragment key={g.cle}>
            {i ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{g.titre}</DropdownMenuLabel>
            {g.options.map((o) => (
              <DropdownMenuItem key={o.valeur || 'tout'} onSelect={(e) => { e.preventDefault(); g.onChoisir(o.valeur); }} data-filtre={`${g.cle}:${o.valeur}`} aria-checked={g.valeur === o.valeur}>
                <span className="flex w-4 shrink-0 justify-center">{g.valeur === o.valeur ? <Check className="h-3.5 w-3.5 text-text" /> : null}</span>
                {o.icone}
                <span className="min-w-0 flex-1 truncate">{o.libelle}</span>
                {typeof o.nombre === 'number' ? <span className="tabular-nums text-faint">{o.nombre}</span> : null}
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
        {actifs.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actifs.forEach((g) => g.onChoisir(g.tout ?? ''))} data-filtres-effacer>
              <span className="w-4" />
              {t('Effacer les filtres')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** LE BOUTON « VUE » : le choix de la vue dans un menu, jamais une barre d'onglets. Il dit la vue en cours. */
export function BoutonVue<C extends string>({
  valeur,
  choix,
  onChoisir,
  repere,
  className,
  attributs,
  icone = false,
}: {
  valeur: C;
  /** `attributs` d'un choix : posés sur sa ligne du menu (repères des contrôles). */
  choix: readonly { cle: C; libelle: string; icone?: React.ReactNode; nombre?: number | null; attributs?: Record<string, string> }[];
  onChoisir: (c: C) => void;
  repere: string;
  className?: string;
  /** Posés sur le bouton lui-même. */
  attributs?: Record<string, string>;
  /** L'icône du choix courant seule, sans libellé ni chevron ; le nom de la vue se lit au survol. */
  icone?: boolean;
}) {
  const courant = choix.find((c) => c.cle === valeur) ?? choix[0];
  if (choix.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {icone && courant?.icone ? (
          <Button size="icon-barre" variant="ghost" className={cn('shrink-0 text-muted [&_svg]:h-4 [&_svg]:w-4', className)} aria-label="Vue" title={courant.libelle} data-bouton-vue={repere} data-valeur={valeur} data-en-icone="" {...attributs}>
            {courant.icone}
          </Button>
        ) : (
        <Button size="sm" variant="ghost" className={cn('shrink-0 text-muted', className)} data-bouton-vue={repere} data-valeur={valeur} {...attributs}>
          {courant?.icone}
          {courant?.libelle}
          {typeof courant?.nombre === 'number' ? <span className="tabular-nums text-faint">{courant.nombre}</span> : null}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" titre={t('Vue')}>
        {choix.map((c) => (
          <DropdownMenuItem key={c.cle} onSelect={() => onChoisir(c.cle)} data-choix={c.cle} aria-checked={c.cle === valeur} {...c.attributs}>
            <span className="flex w-4 shrink-0 justify-center">{c.cle === valeur ? <Check className="h-3.5 w-3.5 text-text" /> : null}</span>
            {c.icone}
            <span className="min-w-0 flex-1">{c.libelle}</span>
            {typeof c.nombre === 'number' ? <span className="tabular-nums text-faint">{c.nombre}</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * LE MENU « … » : les gestes rares d'une page (réglages avancés, réserve d'idées). Il peut aussi porter des CHOIX
 * (`groupes`, rangés sous leur titre, une coche sur la valeur retenue) quand une page n'a de place que pour lui :
 * le calendrier éditorial y réunit « Aujourd'hui », la vue, les filtres et la réserve (carte du 04/11/2026, « coupe
 * ces boutons dans un trois points »). Un groupe `garderOuvert` (les filtres) laisse le menu ouvert après un choix.
 * Un point sur le bouton dit qu'un groupe s'écarte de sa valeur « tout » (`data-actifs`).
 */
export function MenuPlus({
  gestes,
  groupes = [],
  repere,
}: {
  gestes: { libelle: string; icone?: React.ReactNode; faire: () => void; repere?: string }[];
  groupes?: (GroupeDeFiltre & { garderOuvert?: boolean; compte?: boolean })[];
  repere: string;
}) {
  if (!gestes.length && !groupes.length) return null;
  /* Seuls les groupes qui FILTRENT comptent pour le point (`compte`, vrai d'office) : la vue retenue n'est pas un filtre. */
  const actifs = groupes.filter((g) => g.compte !== false && g.valeur !== (g.tout ?? ''));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-barre" variant="ghost" className="relative shrink-0 text-muted" aria-label="Plus d’actions" title={t('Plus d’actions')} data-menu-plus={repere} data-actifs={actifs.length}>
          <MoreHorizontal className="h-4 w-4" />
          {actifs.length ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-teinte" data-menu-plus-point /> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={groupes.length ? 'min-w-[230px]' : undefined}>
        {gestes.map((g) => (
          <DropdownMenuItem key={g.libelle} onSelect={g.faire} {...(g.repere ? { [g.repere]: '' } : {})}>
            {g.icone}
            {g.libelle}
          </DropdownMenuItem>
        ))}
        {groupes.map((g, i) => (
          <React.Fragment key={g.cle}>
            {i || gestes.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{g.titre}</DropdownMenuLabel>
            {g.options.map((o) => (
              <DropdownMenuItem
                key={o.valeur || 'tout'}
                onSelect={(e) => {
                  if (g.garderOuvert) e.preventDefault();
                  g.onChoisir(o.valeur);
                }}
                data-filtre={`${g.cle}:${o.valeur}`}
                aria-checked={g.valeur === o.valeur}
              >
                <span className="flex w-4 shrink-0 justify-center">{g.valeur === o.valeur ? <Check className="h-3.5 w-3.5 text-text" /> : null}</span>
                {o.icone}
                <span className="min-w-0 flex-1 truncate">{o.libelle}</span>
                {typeof o.nombre === 'number' ? <span className="tabular-nums text-faint">{o.nombre}</span> : null}
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
        {actifs.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actifs.forEach((g) => g.onChoisir(g.tout ?? ''))} data-filtres-effacer>
              <span className="w-4" />
              {t('Effacer les filtres')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
