import * as React from 'react';
import { Bell, EllipsisVertical, Loader2 } from '@/components/ui/icones';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Pastille } from '@/components/ui';
import { EnLignesDeMenu, useContenuDuMenuDuHaut, type RegistreDuMenuDuHaut } from '@/components/entete-de-zone';
import { ClocheNotifications, ouvrirLesNotifications, useCompteDeLaCloche } from '@/components/notifications';
import { t } from '@/lib/langue';

/**
 * LES TROIS POINTS DU HAUT DU TÉLÉPHONE (décision de l'utilisateur, 03/11/2026 : « au plus 2 boutons à droite et 1 à
 * gauche, sinon un bouton trois points » ; « agent + trois points, la cloche dans les trois points »). Ils réunissent,
 * de haut en bas : le geste principal de la page quand le bas ne le porte pas, la cloche (avec ce qui attend), puis
 * les options de la page. Le compte de ce qui attend une décision se pose en pastille sur les trois points.
 *
 * `menuDuProjet` : dans un projet, les trois points SONT le menu des options du projet (`MenuGeneral`), qui reçoit ce
 * contenu en tête — jamais deux boutons à trois points.
 */
export function MenuDuHautTelephone({
  registre,
  menuDuProjet,
  assistant = false,
}: {
  registre: RegistreDuMenuDuHaut;
  /** DANS UN PROJET, LE ROBOT EST UNE LIGNE DE CE MENU (13/11/2026), juste sous la cloche. */
  assistant?: boolean;
  menuDuProjet?: (declencheur: React.ReactElement, enTete: React.ReactNode) => React.ReactNode;
}) {
  const contenu = useContenuDuMenuDuHaut(registre);
  const { aRegler, aLire } = useCompteDeLaCloche();
  const entrees = [...contenu.values()];
  const principal = entrees.filter((e) => e.genre === 'principal');
  const options = entrees.filter((e) => e.genre === 'options');
  const gestes = entrees.filter((e) => e.genre === 'gestes');
  const enCours = options.some((e) => e.enCours);

  const declencheur = (
    <Button variant="doux" size="pastille" className="relative shrink-0" aria-label="Plus d’options" title={t('Plus d’options')} data-trois-points-du-haut data-options-de-page="menu">
      {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <EllipsisVertical className="h-4 w-4" />}
      {aRegler > 0 ? <Pastille nombre={aRegler} ton="repondre" position="coin" data-repere-questions="" /> : aLire > 0 ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-info" data-point-notifications /> : null}
    </Button>
  );
  const enTete = (
    <>
      {principal.length ? (
        <div className="flex flex-col gap-1 px-1 pb-1.5 pt-0.5 [&_button]:w-full" data-menu-du-haut-principal>
          {principal.map((e, i) => (
            <React.Fragment key={i}>{e.noeud}</React.Fragment>
          ))}
        </div>
      ) : null}
      {gestes.length ? (
        <div className="flex flex-wrap items-center gap-1 px-1 pb-1.5" data-menu-du-haut-gestes>
          {gestes.map((e, i) => (
            <React.Fragment key={i}>{e.noeud}</React.Fragment>
          ))}
        </div>
      ) : null}
      <DropdownMenuItem onSelect={() => ouvrirLesNotifications()} data-cloche-notifications data-menu-du-haut-cloche>
        <Bell className="h-4 w-4 text-muted" />
        <span className="min-w-0 flex-1 truncate">{t('Notifications')}</span>
        {aRegler > 0 ? <Pastille nombre={aRegler} ton="repondre" /> : null}
      </DropdownMenuItem>
      {options.length ? (
        <>
          <DropdownMenuSeparator />
          <EnLignesDeMenu>
            {options.map((e, i) => (
              <React.Fragment key={i}>{e.noeud}</React.Fragment>
            ))}
          </EnLignesDeMenu>
        </>
      ) : null}
    </>
  );
  return (
    <>
      {/* Le tiroir de la cloche reste monté hors du menu : il s'ouvre par `ouvrirLesNotifications`. */}
      <ClocheNotifications sansBouton />
      {menuDuProjet ? (
        menuDuProjet(declencheur, enTete)
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{declencheur}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[230px]" data-menu-du-haut-telephone>
            {enTete}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
