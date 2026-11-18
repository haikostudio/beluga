/*
 * LA BANDE EN TÊTE DE LA ZONE CENTRALE (décisions du 13/11/2026). Plus aucun bouton en haut à gauche, et plus AUCUNE
 * LISTE en haut des services (« je ne veux plus de ce menu en haut des services, le service est relatif au projet dans
 * lequel on est ») : un service ouvert depuis un projet ne montre que ce projet, et garde sa navigation DANS SA PAGE
 * (`colonne-de-service.tsx`, `absente`). « Tous les projets » ne s'atteint que par le menu ⋮ de la colonne de gauche.
 *
 * La bande ne garde que le COIN HAUT DROIT : les gestes que la page pose elle-même (`GestesDePage`), puis le BOUTON À
 * CHEVRON de ses options (`OptionsDePage`). Le geste PRINCIPAL d'une page (`GestePrincipal`) descend en bas, pleine
 * largeur du contenu (`entete-de-zone`). Sans rien au coin, la bande ne prend aucune hauteur.
 *
 * `ChevronDesOptions` et `useMenuDuService` servent aussi aux fenêtres Mémoire et Coffre-fort, dont le menu de gauche
 * est celui du service : ses gestes (« Nouveau dossier ») en sont retirés et rejoignent le chevron.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2 } from '@/components/ui/icones';
import { EnLignesDeMenu, useContenuDuMenuDuHaut, type RegistreDuMenuDuHaut } from '@/components/entete-de-zone';
import type { VueCentrale } from '@beluga/shared';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** Un élément du menu du service, lu dans le panneau. */
export interface ElementDeListe {
  noeud: HTMLElement;
  libelle: string;
  icone: string;
  desactive: boolean;
}

/** Les mots d'un repère (`data-…`) qui disent un GESTE, pas un lieu. */
const MOTS_DE_GESTE = /(ajouter|nouve|gerer|creer|installer|importer|parametr|reglage|tout-sauvegarder)/;

/** Un bouton du menu d'un service est-il un geste (créer, ajouter, gérer) plutôt qu'un lieu ? */
function estUnGeste(noeud: HTMLElement): boolean {
  if (noeud.querySelector(':scope > svg.lucide-plus, :scope > span > svg.lucide-plus')) return true;
  return [...noeud.attributes].some((a) => a.name.startsWith('data-') && MOTS_DE_GESTE.test(a.name));
}

/** Le nom lisible d'un élément : son premier texte (un client « Camille », pas « Camille ProjetB »). */
function libelleDe(noeud: HTMLElement): string {
  const premier = [...noeud.querySelectorAll<HTMLElement>('span, p')].find(
    (el) => el.children.length === 0 && (el.textContent ?? '').trim(),
  );
  return ((premier ?? noeud).textContent ?? '').trim();
}

export function BandeDeZone({
  vue,
  onCibleDesGestes,
  registre,
  cibleDuBas,
}: {
  vue: VueCentrale;
  /** L'emplacement du geste principal, en bas de la zone. */
  cibleDuBas: HTMLElement | null;
  /** Les options que la page déclare (`OptionsDePage`) : elles rejoignent le chevron du coin. */
  registre: RegistreDuMenuDuHaut;
  onCibleDesGestes: (noeud: HTMLElement | null) => void;
}) {
  return (
    <div className="bande-de-zone relative shrink-0" data-bande-de-zone={vue}>
      {/* LE COIN HAUT DROIT : les gestes que la page pose elle-même, puis le chevron de ses options. */}
      <div className="absolute right-5 top-3 z-10 flex items-center gap-1.5" data-coin-de-zone>
        <div ref={onCibleDesGestes} data-gestes-de-page="barre" data-rangee-de-boutons className="flex shrink-0 items-center gap-1.5 empty:hidden" />
        <ChevronDesOptions registre={registre} gestes={AUCUN_GESTE} cibleDuBas={cibleDuBas} />
      </div>
    </div>
  );
}

const AUCUN_GESTE: ElementDeListe[] = [];

/** Lire le menu d'un service posé dans `corps` : ses lieux et ses gestes (marqués, pour être cachés). */
export function useMenuDuService(corps: HTMLElement | null): { lieux: ElementDeListe[]; gestes: ElementDeListe[] } {
  const [lieux, setLieux] = React.useState<ElementDeListe[]>([]);
  const [gestes, setGestes] = React.useState<ElementDeListe[]>([]);
  /* LIRE LE MENU DU SERVICE à chaque changement : ses lieux, et ses gestes (cachés du menu, rangés au chevron). */
  React.useEffect(() => {
    if (!corps) {
      setLieux([]);
      setGestes([]);
      return;
    }
    const lire = () => {
      const tous = [...corps.querySelectorAll<HTMLElement>('button, a[href]')].filter(
        (el) => !el.closest('[data-radix-popper-content-wrapper]') && !el.parentElement?.closest('button, a[href]'),
      );
      const vusGestes: ElementDeListe[] = [];
      const vusLieux: ElementDeListe[] = [];
      for (const noeud of tous) {
        const element: ElementDeListe = {
          noeud,
          libelle: libelleDe(noeud),
          icone: noeud.querySelector('svg')?.outerHTML ?? '',
          desactive: noeud.hasAttribute('disabled') || noeud.getAttribute('aria-disabled') === 'true',
        };
        if (estUnGeste(noeud)) {
          if (!noeud.hasAttribute('data-geste-de-zone')) noeud.setAttribute('data-geste-de-zone', '');
          if (element.libelle) vusGestes.push(element);
        } else {
          vusLieux.push(element);
        }
      }
      setLieux(vusLieux);
      setGestes(vusGestes);
    };
    lire();
    const observateur = new MutationObserver(lire);
    observateur.observe(corps, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => observateur.disconnect();
  }, [corps]);

  return { lieux, gestes };
}

/**
 * LE CHEVRON DES OPTIONS (coin haut droit d'une zone ou d'une fenêtre de service) : les options que la page déclare
 * (`OptionsDePage`), puis les gestes de son menu ; et le geste de CRÉATION du menu, descendu en bas pleine largeur.
 */
export function ChevronDesOptions({
  registre,
  gestes,
  cibleDuBas,
}: {
  registre: RegistreDuMenuDuHaut;
  gestes: ElementDeListe[];
  cibleDuBas: HTMLElement | null;
}) {
  const declarees = [...useContenuDuMenuDuHaut(registre).entries()].filter(([, e]) => e.genre === 'options');
  const optionsEnCours = declarees.some(([, e]) => e.enCours);
  /* UN GESTE DU MENU QUE LA PAGE DÉCLARE AUSSI EN OPTION (« Gérer les comptes ») ne s'écrit qu'une fois. */
  const [menuOuvert, setMenuOuvert] = React.useState(false);
  const [doublons, setDoublons] = React.useState<ReadonlySet<string>>(new Set());
  const contenuDuMenu = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    if (!menuOuvert) return;
    const options = contenuDuMenu.current?.querySelectorAll('[data-options-de-page-menu] [role="menuitem"]') ?? [];
    const textes = new Set([...options].map((el) => (el.textContent ?? '').trim()));
    setDoublons((avant) => (avant.size === textes.size && [...textes].every((x) => avant.has(x)) ? avant : textes));
  });
  /*
   * LE GESTE DE CRÉATION DU MENU (« Nouvelle création », « Nouveau site ») EST LE GESTE PRINCIPAL DE LA PAGE : il
   * descend en bas, pleine largeur (maquette #50a07) — sauf si la page y a déjà posé le sien, auquel cas il reste au
   * chevron. Le geste d'origine, caché dans la liste, reçoit le clic.
   */
  const creation = gestes.find((g) => g.noeud.hasAttribute('data-geste-de-creation')) ?? null;
  const [basOccupe, setBasOccupe] = React.useState(false);
  React.useEffect(() => {
    if (!cibleDuBas) return;
    const lire = () => setBasOccupe(!!cibleDuBas.querySelector(':scope > :not([data-creation-en-bas])'));
    lire();
    const observateur = new MutationObserver(lire);
    observateur.observe(cibleDuBas, { childList: true });
    return () => observateur.disconnect();
  }, [cibleDuBas]);
  const creationEnBas = creation && cibleDuBas && !basOccupe ? creation : null;
  const gestesVus = gestes.filter((g) => !doublons.has(g.libelle) && g !== creationEnBas);
  return (
    <>
      {creationEnBas && cibleDuBas
        ? createPortal(
            <button
              type="button"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-raised text-[15px] font-semibold text-text transition-colors hover:bg-fond-survol disabled:opacity-50 [&>span>svg]:h-[18px] [&>span>svg]:w-[18px]"
              disabled={creationEnBas.desactive}
              onClick={() => creationEnBas.noeud.click()}
              data-creation-en-bas
              data-bouton-pleine-largeur="page"
            >
              <span className="flex shrink-0" dangerouslySetInnerHTML={{ __html: creationEnBas.icone }} />
              {creationEnBas.libelle}
            </button>,
            cibleDuBas,
          )
        : null}
        {gestesVus.length || declarees.length ? (
          <DropdownMenu open={menuOuvert} onOpenChange={setMenuOuvert}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  /* LA HAUTEUR COMMUNE (14/11/2026, capture #e839) : 38 px au téléphone, 32 px à l'ordinateur — jamais
                     36 px à côté de boutons de 32. */
                  'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-raised text-muted transition-colors hover:bg-fond-survol hover:text-text data-[state=open]:bg-fond-survol data-[state=open]:text-text sm:h-8 sm:w-8',
                )}
                aria-label="Options de la page"
                title={t('Options de la page')}
                data-options-de-zone
                data-options-en-cours={optionsEnCours ? '' : undefined}
              >
                {optionsEnCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="sm:w-[240px]" data-options-de-zone-menu>
              <div ref={contenuDuMenu} className="contents">
              <div data-options-de-page-menu>
                {declarees.map(([cle, entree]) => (
                  <EnLignesDeMenu key={cle}>{entree.noeud}</EnLignesDeMenu>
                ))}
              </div>
              {gestesVus.length && declarees.length ? <DropdownMenuSeparator /> : null}
              {gestesVus.map((geste, rang) => (
                <DropdownMenuItem
                  key={`${rang}-${geste.libelle}`}
                  disabled={geste.desactive}
                  onSelect={() => geste.noeud.click()}
                  className="gap-2.5"
                  data-option-de-zone={geste.libelle}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center text-muted [&>svg]:h-4 [&>svg]:w-4"
                    dangerouslySetInnerHTML={{ __html: geste.icone }}
                  />
                  <span className="min-w-0 flex-1 truncate">{geste.libelle}</span>
                </DropdownMenuItem>
              ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
    </>
  );
}
