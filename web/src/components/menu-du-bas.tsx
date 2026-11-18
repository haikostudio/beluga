import * as React from 'react';
import { ChevronUp, Gauge, Globe, LayoutGrid, Plus, Rocket, SquareKanban } from '@/components/ui/icones';
import type { GesteDuMenuDuBas, MenuDuBas, NiveauDeclare, VueCentrale } from '@beluga/shared';
import { DialogTitle, Drawer } from '@/components/ui';
import { useSignalDePublication } from '@/lib/signal-publication';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE BAS DE L'ÉCRAN DU TÉLÉPHONE, ÉCRAN PAR ÉCRAN (décision de l'utilisateur du 03/11/2026, maquettes 0 à 6 de la
 * carte « Refonte de la navigation mobile ») : la règle `menuDuBas` (`shared/src/menu-du-bas.ts`) dit la forme —
 * AUCUN bas, UN bouton pleine largeur, ou des boutons RÉPARTIS sur toute la largeur, l'action principale au centre
 * (rond violet) ou le chevron des lieux secondaires (rond gris, qui ouvre une petite feuille).
 *
 * Le bas reste dans le flux (il réserve sa place, le contenu ne passe jamais derrière), sans trait au-dessus, sur le
 * fond de la zone qu'il prolonge (`data-zone="centre"`).
 *
 * Repères : `nav[data-menu-bas="<forme>"][data-ecran-du-bas="<écran>"]`, `data-bouton-du-bas="<geste>"`
 * (+ `aria-current` sur la page en cours), `data-centre-du-bas="action|chevron"`, `data-bouton-pleine-largeur`,
 * `data-feuille-du-chevron`, `data-geste-du-chevron`.
 */
export interface GesteDuBas {
  libelle: string;
  /** Le libellé du bouton du bas, quand le nom entier n'y tient pas (« Tableaux »). */
  court?: string;
  icone: React.ReactNode;
  onClick: () => void;
  /** La page affichée : le libellé s'éclaire et un point violet le souligne. */
  actif?: boolean;
  /** Ce qui attend (décisions, messages, tâches à déployer). */
  compte?: number;
  desactive?: boolean;
  /** Le geste lance le travail d'un agent : son bouton pleine largeur est teinté de violet. */
  agent?: boolean;
  /** UN APLAT VIOLET PLEIN : « Publier », le seul geste du bas d'un projet (13/11/2026). */
  plein?: boolean;
  /** Le geste est en cours (la page le dit) : son icône tourne. */
  enCours?: boolean;
}
export type GestesDuBas = Partial<Record<GesteDuMenuDuBas, GesteDuBas>>;

/* LES GESTES QU'UNE PAGE DÉCLARE (Communication : ses lieux, qui dépendent de la marque ouverte). */
const DeclarerLesGestes = React.createContext<((gestes: GestesDuBas | null) => void) | null>(null);
export const FournirLaDeclarationDesGestesDuBas = DeclarerLesGestes.Provider;
export function useDeclarerLesGestesDuBas(gestes: GestesDuBas | null) {
  const declarer = React.useContext(DeclarerLesGestes);
  React.useEffect(() => {
    if (!declarer) return;
    declarer(gestes);
    return () => declarer(null);
  }, [declarer, gestes]);
}

/* LE NIVEAU OÙ LA PAGE EST DESCENDUE (une marque, une création, un projet du Marketing) : il choisit le bas. */
const DeclarerLeNiveau = React.createContext<((niveau: NiveauDeclare | null) => void) | null>(null);
export const FournirLaDeclarationDuNiveauDuBas = DeclarerLeNiveau.Provider;
export function useDeclarerLeNiveauDuBas(niveau: NiveauDeclare | null) {
  const declarer = React.useContext(DeclarerLeNiveau);
  React.useEffect(() => {
    if (!declarer) return;
    declarer(niveau);
    return () => declarer(null);
  }, [declarer, niveau]);
}

function Compte({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cn('flex h-4 min-w-4 items-center justify-center rounded-full bg-teinte-plein px-1 text-[10px] font-semibold leading-none text-sur-couleur', className)}
      data-compte-du-bas={n}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

function BoutonDuBas({ cle, geste }: { cle: GesteDuMenuDuBas; geste: GesteDuBas }) {
  return (
    <button
      type="button"
      onClick={geste.onClick}
      disabled={geste.desactive}
      aria-current={geste.actif ? 'page' : undefined}
      className={cn(
        'relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-[11px] font-medium leading-tight transition-colors active:bg-raised disabled:opacity-40',
        geste.actif ? 'text-text' : 'text-muted',
      )}
      data-bouton-du-bas={cle}
    >
      <span className="relative flex h-[21px] w-[21px] items-center justify-center [&>svg]:h-[21px] [&>svg]:w-[21px]">
        {geste.icone}
        {geste.compte ? <Compte n={geste.compte} className="absolute -right-2.5 -top-1.5" /> : null}
      </span>
      <span className="max-w-full truncate">{geste.court ?? geste.libelle}</span>
      {/* La page affichée : un point violet sous son nom. */}
      <span className={cn('h-1 w-1 rounded-full', geste.actif ? 'bg-teinte' : 'bg-transparent')} aria-hidden />
    </button>
  );
}

/** Le style du bouton pleine largeur du bas : gris, ou teinté de violet s'il lance un agent. */
export const CLASSE_BOUTON_PLEINE_LARGEUR =
  'flex h-12 w-full items-center justify-center gap-2 rounded-[13px] text-[15px] font-semibold transition-colors disabled:opacity-40 [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0';

export function MenuDuBasDuTelephone({
  menu,
  gestes,
  onCibleDuPrincipal,
}: {
  menu: MenuDuBas;
  gestes: GestesDuBas;
  /** L'emplacement où la page affichée pose SON geste principal (`GestePrincipal`), quand le bas est `page`. */
  onCibleDuPrincipal: (cible: HTMLElement | null) => void;
}) {
  const [chevronOuvert, setChevronOuvert] = React.useState(false);
  React.useEffect(() => setChevronOuvert(false), [menu.ecran]);
  if (menu.forme === 'aucun') return null;
  const enveloppe = (contenu: React.ReactNode, classe?: string) => (
    <nav
      data-menu-bas={menu.forme}
      data-ecran-du-bas={menu.ecran}
      data-zone="centre"
      /* UN BOUTON PLEINE LARGEUR TOMBE SUR LA MARGE DES PAGES (16 px, `CLASSE_MARGES_DE_PAGE`), comme les blocs au-dessus
         (règle du téléphone, 03/11/2026) ; les icônes réparties gardent leur bande. */
      className={cn('shrink-0 pt-2 sm:hidden', menu.forme === 'pleine-largeur' ? 'px-[var(--marge-de-page,1rem)]' : 'px-3', classe)}
      style={{ paddingBottom: `var(--pied-natif, calc(env(safe-area-inset-bottom) + 0.5rem + var(--marche-du-bas, 0px)))` }}
    >
      {contenu}
    </nav>
  );
  if (menu.forme === 'pleine-largeur') {
    if (menu.geste === 'page') {
      /* Vide tant que la page n'a pas posé son geste : le bas ne prend alors aucune place. */
      return enveloppe(
        <div ref={onCibleDuPrincipal} className="flex flex-col gap-2" data-cible-du-principal />,
        '[&:has([data-cible-du-principal]:empty)]:hidden',
      );
    }
    const geste = gestes[menu.geste];
    if (!geste) return null;
    return enveloppe(
      <button
        type="button"
        onClick={geste.onClick}
        disabled={geste.desactive}
        className={cn(
          CLASSE_BOUTON_PLEINE_LARGEUR,
          geste.plein
            ? 'bg-teinte-plein text-sur-couleur active:opacity-90'
            : geste.agent
              ? 'bg-teinte/15 text-teinte active:bg-teinte/25'
              : 'bg-raised text-text active:bg-fond-survol',
        )}
        data-bouton-pleine-largeur={menu.geste}
        data-bouton-du-bas={menu.geste}
      >
        {geste.icone}
        <span className="min-w-0 truncate">{geste.libelle}</span>
        {geste.compte ? (
          geste.plein ? (
            <span className="rounded-full bg-sur-couleur/20 px-2 text-[12.5px] leading-5 tabular-nums" data-compte-du-bas={geste.compte}>
              {geste.compte}
            </span>
          ) : (
            <Compte n={geste.compte} />
          )
        ) : null}
      </button>,
    );
  }
  const visibles = (liste: readonly GesteDuMenuDuBas[]) => liste.filter((cle) => !!gestes[cle]);
  const gauche = visibles(menu.gauche);
  const droite = visibles(menu.droite);
  const centre = menu.centre;
  const actionDuCentre = centre?.genre === 'action' ? gestes[centre.geste] : undefined;
  const secondaires = centre?.genre === 'chevron' ? visibles(centre.gestes) : [];
  const aUnCentre = !!actionDuCentre || secondaires.length > 0;
  const colonnes = gauche.length + droite.length + (aUnCentre ? 1 : 0);
  if (!colonnes) return null;
  const secondaireActif = secondaires.some((cle) => gestes[cle]?.actif);
  return (
    <>
      {enveloppe(
        <div className="grid items-center" style={{ gridTemplateColumns: `repeat(${colonnes}, minmax(0, 1fr))` }}>
          {gauche.map((cle) => <BoutonDuBas key={cle} cle={cle} geste={gestes[cle]!} />)}
          {actionDuCentre && centre?.genre === 'action' ? (
            <div className="flex justify-center">
              <button
                type="button"
                aria-label={actionDuCentre.libelle}
                title={actionDuCentre.libelle}
                disabled={actionDuCentre.desactive}
                onClick={actionDuCentre.onClick}
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-teinte-plein text-sur-couleur transition-transform active:scale-95 disabled:opacity-40"
                data-centre-du-bas="action"
                data-bouton-du-bas={centre.geste}
                {...(centre.geste === 'nouvel-agent' ? { 'data-bouton-nouvel-agent': '', 'data-nouvelle-carte': 'planned' } : {})}
              >
                {centre.geste === 'nouvel-agent' ? (
                  <Plus className={cn('h-6 w-6', actionDuCentre.enCours && 'animate-spin')} />
                ) : (
                  /* Le rond d'une autre page porte SON icône (la « Construction » du Studio). */
                  <span className={cn('flex [&>svg]:h-6 [&>svg]:w-6', actionDuCentre.enCours && 'animate-pulse')}>{actionDuCentre.icone}</span>
                )}
              </button>
            </div>
          ) : secondaires.length ? (
            <div className="flex justify-center">
              <button
                type="button"
                aria-label="Plus"
                title={t('Plus')}
                aria-haspopup="dialog"
                aria-expanded={chevronOuvert}
                onClick={() => setChevronOuvert((o) => !o)}
                className={cn(
                  'flex h-[52px] w-[52px] items-center justify-center rounded-full bg-raised transition-transform active:scale-95',
                  secondaireActif ? 'text-teinte' : 'text-text',
                )}
                data-centre-du-bas="chevron"
              >
                <ChevronUp className="h-6 w-6" />
              </button>
            </div>
          ) : null}
          {droite.map((cle) => <BoutonDuBas key={cle} cle={cle} geste={gestes[cle]!} />)}
        </div>,
      )}
      {secondaires.length ? (
        <Drawer feuille open={chevronOuvert} onClose={() => setChevronOuvert(false)}>
          <DialogTitle className="px-4 pb-2 text-[17px] font-semibold text-text">{t('Plus')}</DialogTitle>
          <div className="flex flex-col gap-1.5 px-3 pb-[var(--pied-natif,calc(12px+env(safe-area-inset-bottom)))]" data-feuille-du-chevron>
            {secondaires.map((cle) => {
              const geste = gestes[cle]!;
              return (
                <button
                  key={cle}
                  type="button"
                  disabled={geste.desactive}
                  aria-current={geste.actif ? 'page' : undefined}
                  onClick={() => {
                    setChevronOuvert(false);
                    geste.onClick();
                  }}
                  className={cn(
                    'flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium transition-colors disabled:opacity-40',
                    geste.actif ? 'bg-teinte/15 text-teinte' : 'bg-raised text-text active:bg-fond-survol',
                  )}
                  data-geste-du-chevron={cle}
                >
                  <span className={cn('flex h-5 w-5 items-center justify-center [&>svg]:h-5 [&>svg]:w-5', !geste.actif && 'text-muted')}>{geste.icone}</span>
                  <span className="min-w-0 flex-1 truncate">{geste.libelle}</span>
                  {geste.compte ? <Compte n={geste.compte} /> : null}
                </button>
              );
            })}
          </div>
        </Drawer>
      ) : null}
    </>
  );
}

/**
 * LES GESTES QUE L'APPLICATION CONNAÎT D'ELLE-MÊME (un projet, les tableaux de bord). Une page en déclare d'autres,
 * ou les précise (`useDeclarerLesGestesDuBas`) : les siens l'emportent.
 */
export function useGestesDeLApplication({
  vue,
  projectId,
  surTableauxDeBord,
  ouvrirVue,
  onNouvelAgent,
  nouvelAgentEnCours,
  onPublier,
  onOutils,
  compteAPublier,
}: {
  /** « Publier » (les deux listes) et « Outils » (les outils du projet), refonte du 13/11/2026. */
  onPublier?: () => void;
  onOutils?: () => void;
  compteAPublier?: number;
  vue: VueCentrale;
  projectId: string | null;
  surTableauxDeBord: boolean;
  ouvrirVue: (vue: VueCentrale) => void;
  /** Le + du centre : un agent dans le projet ouvert, sinon le choix du projet. */
  onNouvelAgent: () => void;
  nouvelAgentEnCours?: boolean;
}): GestesDuBas {
  const deploiement = useSignalDePublication(projectId, 'deploiement');
  const production = useSignalDePublication(projectId, 'production');
  const gestes: GestesDuBas = {
    'nouvel-agent': { libelle: t('Nouvel artefact'), icone: <Plus />, onClick: onNouvelAgent, enCours: nouvelAgentEnCours, desactive: nouvelAgentEnCours },
    /* DEUX ICÔNES QUI NE SE CONFONDENT PLUS (15/11/2026, capture #7ef7) : des colonnes pour les tableaux, une jauge
       pour le résumé chiffré — la grille reste aux « Outils ». */
    'tableaux-de-bord': { libelle: t('Tableaux de bord'), court: t('Tableaux'), icone: <SquareKanban />, actif: surTableauxDeBord, onClick: () => ouvrirVue('en-route') },
    resume: { libelle: t('Résumé'), icone: <Gauge />, actif: vue === 'tableau-de-bord', onClick: () => ouvrirVue('tableau-de-bord') },
  };
  if (projectId) {
    /* LES DEUX GESTES DE PUBLICATION RESTENT VISIBLES : sans procédure, leur feuille le dit et propose de l'écrire. */
    gestes.deployer = onPublier
      ? { libelle: t('Publier'), icone: <Rocket />, compte: compteAPublier || undefined, onClick: onPublier, plein: true }
      : { libelle: t('Déployer'), icone: <Rocket />, compte: deploiement?.compte, desactive: !deploiement, onClick: () => deploiement?.ouvrir() };
    if (onOutils) gestes.outils = { libelle: t('Outils'), icone: <LayoutGrid />, onClick: onOutils };
    gestes.production = { libelle: t('Mise en production'), court: t('Production'), icone: <Globe />, compte: production?.compte, desactive: !production, onClick: () => production?.ouvrir() };
  }
  return gestes;
}
