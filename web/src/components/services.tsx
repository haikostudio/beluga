import * as React from 'react';
import { niveauDeMonService } from '@/lib/mes-droits';
import {
  Activity,
  BarChart3,
  Clapperboard,
  Film,
  HardDriveDownload,
  Key,
  LayoutDashboard,
  LayoutGrid,
  Library,
  Megaphone,
  NotebookPen,
  Repeat,
  UsersRound,
} from 'lucide-react';
import { compterEnPanne, type VueCentrale } from '@beluga/shared';
import { Button, CLASSE_BOUTON_DE_CREATION, CLASSE_POINT_DE_BOUTON, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui';
import { PastillesMessagerie } from '@/components/pastilles-messagerie';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Une destination de la zone principale qui n'est pas un projet : un service. */
type Service = Exclude<VueCentrale, 'projet' | 'en-route'>;

/**
 * LES SERVICES, UNE SEULE DÉFINITION : leur ordre, leur icône, leur nom (une
 * CLÉ du dictionnaire) et le repère `data-ouvrir-*` que visent les contrôles.
 */
const CLES_DES_SERVICES: { cle: Service; repere: string; Icone: typeof Key; cleLibelle: string }[] = [
  { cle: 'tableau-de-bord', repere: 'tableau-de-bord', Icone: LayoutDashboard, cleLibelle: 'Résumé' },
  { cle: 'statistiques', repere: 'statistiques', Icone: BarChart3, cleLibelle: 'Statistiques' },
  { cle: 'coffre', repere: 'coffre', Icone: Key, cleLibelle: 'Coffre-fort' },
  { cle: 'memoire', repere: 'memoire', Icone: Library, cleLibelle: 'Mémoire' },
  { cle: 'espace-client', repere: 'espace-client', Icone: UsersRound, cleLibelle: 'Messagerie' },
  { cle: 'backups', repere: 'backups', Icone: HardDriveDownload, cleLibelle: 'Backup' },
  { cle: 'surveillance', repere: 'surveillance', Icone: Activity, cleLibelle: 'Surveillance' },
  { cle: 'taches-recurrentes', repere: 'taches-recurrentes', Icone: Repeat, cleLibelle: 'Tâches récurrentes' },
  { cle: 'marketing', repere: 'marketing', Icone: Megaphone, cleLibelle: 'Marketing' },
  { cle: 'medias', repere: 'medias', Icone: Film, cleLibelle: 'Médias' },
  { cle: 'notes', repere: 'notes', Icone: NotebookPen, cleLibelle: 'Notes' },
];

/** Le compte des sites en panne, en chiffre nu : la seule alerte du service Surveillance. */
function PastillePanne({ nombre }: { nombre: number }) {
  return (
    <span
      data-surveillance-pastille={nombre}
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-sur-etat"
    >
      {nombre}
    </span>
  );
}

/**
 * LE BOUTON DES SERVICES — TOUT À GAUCHE DU FIL D'ARIANE, dans la barre
 * d'en-tête (demandes du 11/10/2026 : d'abord « un bouton avec quatre carrés »,
 * puis en tête de la colonne, enfin « dans le fil d'Ariane, tout à gauche,
 * l'icône du service qui permet de changer directement sans aller dans la
 * sidebar »). Il porte l'ICÔNE DU SERVICE OÙ L'ON EST — quatre carrés sur un
 * tableau de projet — et la colonne de gauche ne le porte plus. Sur téléphone,
 * où la gauche de la barre ouvre la colonne, il reste à droite.
 *
 * Il ouvre d'abord une ligne « Tableaux de bord » sur toute la largeur, puis
 * une grille : une tuile par service — Résumé, Statistiques,
 * Coffre-fort, Mémoire, Messagerie, Backup, Surveillance, Tâches récurrentes,
 * Marketing, Studio, Médias,
 * Notes. Choisir une tuile REMPLACE le contenu de la zone principale. Celle du
 * service affiché est marquée. Sur téléphone, la grille s'ouvre au bas de
 * l'écran, comme tout menu.
 *
 * UNE ALERTE NE SE CACHE JAMAIS DERRIÈRE LE BOUTON : un point sur son coin dit
 * qu'un message attend ou qu'un site est tombé ; le compte se lit sur la tuile.
 *
 * Les repères des contrôles ont suivi : `data-navigation-compacte` sur le
 * bouton, `data-navigation-panneau` sur la grille, `data-destination` et
 * `data-ouvrir-*` sur chaque tuile.
 */
export function BoutonDesServices({
  vue,
  onOuvrirVue,
  cote = 'end',
}: {
  vue: VueCentrale;
  onOuvrirVue: (vue: VueCentrale) => void;
  /** Le bord du bouton sur lequel la grille s'aligne : `start` en tête de la colonne de gauche. */
  cote?: 'start' | 'end';
}) {
  const state = useApp();
  const [ouvert, setOuvert] = React.useState(false);
  const sitesEnPanne = compterEnPanne(state.surveillance);
  const messages = state.compteursMessagerie.nonLu + state.compteursMessagerie.aTraiter;
  const alertes = messages + sitesEnPanne;
  /* LES SERVICES SONT À L'ADMINISTRATEUR : un accès tiers n'a que ses projets,
     plus le coffre-fort si sa grille le lui ouvre. */
  /* Les services réservés à un seul compte, que ce compte-ci n'a pas. */
  const reserves = new Set<string>();
  const services = CLES_DES_SERVICES.filter((service) =>
    reserves.has(service.cle)
      ? false
      : state.monRole === 'admin'
        ? true
        : service.cle === 'coffre' && niveauDeMonService(state, 'coffre') !== 'aucun',
  );
  const serviceOuvert = services.find((service) => service.cle === vue);
  const surUnService = !!serviceOuvert;
  /* « Tableaux de bord » : la vue qui les nomme, ou un projet qu'aucun clic n'a encore ouvert. */
  const surLesTableauxDeBord = vue === 'en-route' || (vue === 'projet' && !state.activeProjectId);
  const Icone = serviceOuvert?.Icone ?? LayoutGrid;

  // Ni « Tableaux de bord » (toutes les cartes de tous les projets) pour un accès tiers, et aucun menu s'il n'a aucun service.
  if (state.monRole !== 'admin' && !services.length) return null;

  return (
    <DropdownMenu open={ouvert} onOpenChange={setOuvert}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative h-[38px] sm:h-8 w-[38px] sm:w-8 shrink-0 text-muted', ouvert && 'bg-raised text-text', surUnService && 'text-text')}
          data-service-ouvert={serviceOuvert?.cle}
          aria-label="Services"
          title={t('Services')}
          data-navigation-compacte={ouvert ? 'ouverte' : 'fermee'}
        >
          <Icone className="h-4 w-4" />
          {alertes ? (
            <span className={cn(CLASSE_POINT_DE_BOUTON, 'bg-text')} data-alerte-navigation aria-hidden />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={cote} className="sm:w-[348px]" data-navigation-panneau={ouvert ? 'ouvert' : 'ferme'}>
        <p className="px-2.5 pb-1.5 pt-1 text-[12.5px] text-faint">{t('Services')}</p>
        {/* « TABLEAUX DE BORD », TOUT EN HAUT, SUR TOUTE LA LARGEUR : la page qui
            réunit ce qui est en route dans tous les projets n'est pas un service
            comme les autres tuiles, mais le lieu d'où l'on part — d'où une
            ligne à elle, au-dessus de la grille. */}
        {state.monRole === 'admin' ? (
        <DropdownMenuItem
          data-destination="en-route"
          data-ouvrir-en-route
          aria-current={surLesTableauxDeBord ? 'page' : undefined}
          onSelect={() => onOuvrirVue('en-route')}
          /* UN BOUTON PLEIN, NOIR À ÉCRITURE BLANCHE, CENTRÉ (demande du 12/10/2026) :
             le même dessin que les boutons « Nouveau » (`CLASSE_BOUTON_DE_CREATION`), et
             la même allure qu'on soit ou non sur la page — `aria-current` la dit. */
          className={cn(
            'mb-1 h-11 w-full justify-center gap-2 rounded-lg px-2.5 font-medium',
            CLASSE_BOUTON_DE_CREATION,
            'data-[highlighted]:bg-encre data-[highlighted]:opacity-90',
          )}
        >
          <LayoutGrid className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{t('Tableaux de bord')}</span>
        </DropdownMenuItem>
        ) : null}
        <div className="grid grid-cols-2 gap-1">
          {services.map(({ cle, repere, Icone: IconeDuService, cleLibelle }) => (
            <DropdownMenuItem
              key={cle}
              data-destination={cle}
              {...{ [['data-ouvrir', repere].join('-')]: true }}
              aria-current={vue === cle ? 'page' : undefined}
              onSelect={() => onOuvrirVue(cle)}
              className={cn('h-11 gap-2.5 rounded-lg px-2.5 text-text', vue === cle && 'bg-raised text-teinte')}
            >
              <IconeDuService className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{t(cleLibelle)}</span>
              {cle === 'espace-client' ? <PastillesMessagerie compteurs={state.compteursMessagerie} colleADroite /> : null}
              {cle === 'surveillance' && sitesEnPanne ? <PastillePanne nombre={sitesEnPanne} /> : null}
              {/* Le nombre de veilles qui courent : un chiffre gris, jamais une alerte. */}
              {cle === 'taches-recurrentes' && state.veilles.actives ? (
                <span className="shrink-0 text-[12px] text-faint" data-recurrentes-compte={state.veilles.actives}>
                  {state.veilles.actives}
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
