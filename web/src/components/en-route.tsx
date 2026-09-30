/*
 * LA PAGE « EN ROUTE » — tout ce qui est entre la demande et le déploiement,
 * tous projets confondus (`shared/src/en-route.ts`).
 *
 * Ouverte par le bouton des agents, sous la navigation de la colonne de
 * gauche, et montrée d'office quand aucun projet n'est ouvert. Elle remplace
 * la pile flottante qui listait les agents au pied de la colonne : ce qui
 * travaille sur une carte se lit SUR la carte (témoin orange, barre de
 * travail), ce qui travaille sans carte — mise en ligne, analyse, chef — dans
 * la bande en tête, avec son bouton d'arrêt.
 *
 * DEUX COLONNES CÔTE À CÔTE, comme au tableau (demande du 25.09.2026, qui
 * remplace les deux onglets) : « Actifs » (Demande, Travail, À déployer) et
 * « Terminés » (ce qui est déjà en ligne, avec son badge) — c'est là qu'on voit
 * ce que le déploiement automatique a publié. Chaque colonne (`OngletEnRoute`
 * reste la clé de sa liste) a sa réserve, ses paquets de vingt, son titre et
 * son nombre, et défile seule. Sur téléphone, chacune tient l'écran et l'on
 * passe de l'une à l'autre en faisant glisser la page de côté.
 *
 * Un morceau à part, chargé au premier affichage (DEC-050) : un écran qu'on
 * n'a pas ouvert ne se télécharge pas.
 *
 * DANS CHAQUE COLONNE, tous projets mélangés, la DERNIÈRE ACTION en haut :
 * une liste, pas une grille. Toutes les cartes ont la hauteur fixe du tableau,
 * et portent DEDANS leur projet (haut gauche), leur état (haut droit), le
 * début de leur description et leur ancienneté (bas gauche) — `CardTile` en
 * forme `enRoute`. Le rail et les colonnes viennent du gabarit partagé avec la
 * silhouette (`lib/gabarit-tableau.ts`).
 */
import * as React from 'react';
import { Bot, CheckCircle2, Layers, Microscope, Rocket, Square, UploadCloud, Waypoints, Wrench } from 'lucide-react';
import {
  agentCompteCommeTravail,
  agentTientSonTour,
  agentsDeLaBande,
  colonneAffichee,
  depannagesDeLaBande,
  depanneurVivant,
  etatDeLInitialisation,
  etapeDeLAgentDeConfiguration,
  procedureEnPlace,
  activiteDeLaMere,
  etapeCouranteDeSuivi,
  LIBELLE_ETAPE_DE_SUIVI,
  estDeployee,
  estEnRoute,
  nombreEnCoursEnRoute,
  pilesEnRoute,
  type PileEnRoute,
  CARTES_EN_ROUTE_PAR_PAQUET,
  ONGLETS_EN_ROUTE,
  type Agent,
  type Card,
  type Project,
  type OngletEnRoute,
  estCarteMarketing,
  estUnRegroupement,
  membresActifsDuRegroupement,
} from '@beluga/shared';
import { client } from '@/lib/client';
import { carteDeSuivi } from '@/lib/carte-de-suivi';
import { useApp } from '@/lib/use-app';
import { useMinute } from '@/lib/horloge';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn, dateHeure, relativeTime } from '@/lib/utils';
import { Badge, Button, Dot, EmptyState, Tooltip, ZoneDefilement } from '@/components/ui';
import { BulleTexteCoupe, useTexteCoupe } from '@/components/texte-coupe';
import { CardTile, avalerLeRelachement } from '@/components/board';
import { BandeauTravail } from '@/components/bandeau-travail';
import { VignetteInitialisationProduction } from '@/components/vignette-initialisation-production';
import { PastilleProjet, PastillesEmpilees } from '@/components/pastille-projet';
import { usePointerDrag } from '@/lib/dnd';
import { GRILLE_EN_ROUTE, SilhouetteListeEnRoute } from '@/components/silhouettes';
import {
  CLASSES_LISTE_COLONNE_EN_ROUTE,
  CLASSES_TETE_COLONNE_EN_ROUTE,
  classesColonneEnRoute,
  classesRailEnRoute,
} from '@/lib/gabarit-tableau';

/** La liste des cartes : la même que celle de sa silhouette. */
const GRILLE = GRILLE_EN_ROUTE;

/** Rien ne se dépose sur cette page : le glisser partagé n'y sert qu'à l'appui long. */
const aucuneCible = () => null;
const rienADeposer = () => {};

/** Ce que chaque carte reçoit pour ouvrir son menu (`gesteDuMenu`). */
interface GesteDuMenu {
  menuOuvert: boolean;
  onMenuChange: (ouvert: boolean) => void;
  onPointerDown: (event: React.PointerEvent) => void;
}


export function EnRoute({
  onOpenCard,
  onOpenAgent,
}: {
  onOpenCard: (card: Card) => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const state = useApp();
  // L'heure « rendue il y a… » se refait à chaque minute, pour toute la page.
  useMinute();
  const telephone = useTelephone();
  /*
   * LE MENU D'UNE CARTE, COMME AU TABLEAU : clic droit à la souris, appui long
   * au doigt (le MÊME `usePointerDrag`, sans glissement — rien ne se dépose
   * ici). L'appui maintenu (`holdMs`) dure plus que l'appui long : bouger
   * avant fait défiler la page, jamais tirer la carte.
   */
  const [menuCarte, setMenuCarte] = React.useState<string | null>(null);
  const ouvrirMenu = React.useCallback((item: { id: string }) => {
    setMenuCarte(item.id);
    avalerLeRelachement();
  }, []);
  const { start: appuyer } = usePointerDrag({
    resolve: aucuneCible,
    onDrop: rienADeposer,
    holdMs: 700,
    onLongPress: ouvrirMenu,
  });
  const gesteDuMenu = (card: Card): GesteDuMenu => ({
    menuOuvert: menuCarte === card.id,
    onMenuChange: (ouvert: boolean) => setMenuCarte(ouvert ? card.id : null),
    // La souris a le clic droit : seul le doigt passe par l'appui long.
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType !== 'mouse') appuyer(event, { id: card.id, kind: 'card', label: card.title });
    },
  });
  // Les deux listes se demandent à l'ouverture de la page : ce qu'on avait
  // gardé reste affiché pendant ce temps. Chaque colonne a son curseur.
  React.useEffect(() => {
    for (const onglet of ONGLETS_EN_ROUTE) void client.chargerEnRoute(onglet);
  }, []);

  /* Un projet mis de côté entre-temps sort de la page, comme il sort de la
     colonne de gauche. */
  const enService = React.useMemo(
    () => new Set(state.projects.filter((p) => !p.archived).map((p) => p.id)),
    [state.projects],
  );
  /* PAR PILES : une demande commune (mère + filles) est UNE entrée, rangée
     d'un bloc dans sa colonne (`pilesEnRoute`) ; une carte seule est une
     pile d'une carte. */
  const cartesActives = React.useMemo(
    () =>
      pilesEnRoute(
        Object.values(state.enRoute?.cartes ?? {}).filter((card) => enService.has(card.projectId) && !estCarteMarketing(card)),
        'actif',
      ),
    [state.enRoute?.cartes, enService],
  );
  const cartesTerminees = React.useMemo(
    () =>
      pilesEnRoute(
        Object.values(state.enRouteTermine?.cartes ?? {}).filter((card) => enService.has(card.projectId) && !estCarteMarketing(card)),
        'termine',
      ),
    [state.enRouteTermine?.cartes, enService],
  );

  /* Les agents qui tiennent leur tour, rangés par carte — une seule fois par
     rendu, comme au tableau. */
  const travailParCarte = React.useMemo(() => {
    const index = new Map<string, Agent>();
    for (const agent of Object.values(state.agents)) {
      if (agent.cardId && agentTientSonTour(agent) && !index.has(agent.cardId)) index.set(agent.cardId, agent);
    }
    return index;
  }, [state.agents]);

  const bande = agentsDeLaBande(Object.values(state.agents), Date.now());
  /* LES DÉPANNAGES DE PUBLICATION (« Résoudre le problème ») : leur carte
     spéciale, en tête de la colonne « Actifs », tant que l'agent travaille. */
  const depannages = depannagesDeLaBande(Object.values(state.agents), Date.now());

  /* LE NOMBRE D'ENTRÉES DE CHAQUE COLONNE, en tête de la colonne : ce qui est
     reçu, plus ce qui reste à demander (les paquets de vingt) — une pile compte
     pour une. Rien tant que la liste n'est pas chargée : pas de « 0 » trompeur. */
  const nombreActif = state.enRoute?.charge ? cartesActives.length + state.enRoute.restant : undefined;
  const nombreTermine = state.enRouteTermine?.charge
    ? cartesTerminees.length + state.enRouteTermine.restant
    : undefined;

  /* LES CARTES AU TRAVAIL parmi les actives — le « 3 » de « 3/19 ». Même
     prédicat que le témoin orange des cartes, compté sur les agents : une carte
     au travail pas encore chargée compte aussi. Une carte qu'on sait hors de la
     colonne (déjà en ligne, rangée) est écartée ; le total borne le reste. */
  const nombreEnCours = React.useMemo(() => {
    if (nombreActif === undefined) return undefined;
    const horsDeLaListe = (cardId: string) => {
      if (state.enRoute?.cartes[cardId]) return false;
      if (state.enRouteTermine?.cartes[cardId]) return true;
      const connue = state.cards[cardId];
      // Une carte de l'agent marketing ne se montre que dans l'outil Marketing.
      return !!connue && (!estEnRoute(connue) || estCarteMarketing(connue));
    };
    return Math.min(nombreActif, nombreEnCoursEnRoute(Object.values(state.agents), enService, horsDeLaListe));
  }, [nombreActif, state.agents, enService, state.enRoute, state.enRouteTermine, state.cards]);

  const ouvrirAgent = (agent: Agent) => {
    const carte = agent.cardId
      ? (state.enRoute?.cartes[agent.cardId] ?? state.enRouteTermine?.cartes[agent.cardId] ?? state.cards[agent.cardId])
      : undefined;
    if (carte) onOpenCard(carte);
    else onOpenAgent(agent.id);
  };

  /* Ce qui suit les cartes d'une colonne : le paquet suivant, sur demande. */
  const suite = (onglet: OngletEnRoute) => {
    const etat = onglet === 'termine' ? state.enRouteTermine : state.enRoute;
    return etat?.charge && etat.restant > 0 ? (
      <div className="mt-4 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          data-suite-en-route={onglet}
          onClick={() => void client.chargerLaSuiteEnRoute(onglet)}
        >
          {t('Afficher les {n} suivantes', { n: Math.min(etat.restant, CARTES_EN_ROUTE_PAR_PAQUET) })}
        </Button>
      </div>
    ) : null;
  };

  const actifs = state.enRoute;
  const termines = state.enRouteTermine;

  /* LE RAIL DES DEUX COLONNES. Sur téléphone il défile de côté (aimanté,
     colonne par colonne) ; sur ordinateur les deux colonnes se partagent la
     largeur et le rail ne bouge pas. */
  const colonnes = (
    <>
      <ColonneEnRoute
        onglet="actif"
        titre={t('Actifs')}
        telephone={telephone}
        compte={
          nombreActif !== undefined ? (
            <>
              {nombreEnCours !== undefined ? (
                <>
                  <span className={cn(nombreEnCours > 0 && 'text-en-cours')} data-compte-en-cours>
                    {nombreEnCours}
                  </span>
                  /
                </>
              ) : null}
              {nombreActif}
            </>
          ) : undefined
        }
      >
        {depannages.length ? (
          <section className="mb-1" data-bande-depannages>
            <h2 className="text-[12px] uppercase tracking-wide text-faint">{t('Dépannages')}</h2>
            <div className={GRILLE}>
              {depannages.map((agent) => (
                <VignetteDepannage key={agent.id} agent={agent} onOpen={() => onOpenAgent(agent.id)} />
              ))}
            </div>
          </section>
        ) : null}

        {bande.length ? (
          // Les agents sans carte sont posés dans la MÊME grille que les
          // cartes (même largeur, même bord gauche, même écart) : `mb-1` +
          // le `pt-3` de la grille des cartes redonnent l'écart `gap-4`.
          <section className="mb-1" data-bande-agents>
            <h2 className="text-[12px] uppercase tracking-wide text-faint">{t('Agents sans carte')}</h2>
            <div className={GRILLE}>
              {bande.map((agent) => {
                /* L'agent de configuration de la production garde sa vignette
                   à part, la même qu'en tête de « En cours » du tableau. */
                const projet = state.projects.find((p) => p.id === agent.projectId);
                const etapeConfiguree = etapeDeLAgentDeConfiguration(projet, agent.id) ?? 'production';
                const initialisation = etatDeLInitialisation(projet, agent, Date.now(), etapeConfiguree);
                return initialisation ? (
                  <VignetteInitialisationProduction
                    key={agent.id}
                    agent={agent}
                    etat={initialisation}
                    projet={projet}
                    cible={etapeConfiguree}
                    reconfiguration={procedureEnPlace(projet, 'production')}
                    avecProjet
                  />
                ) : (
                  <VignetteAgent key={agent.id} agent={agent} onOpen={() => ouvrirAgent(agent)} />
                );
              })}
            </div>
          </section>
        ) : null}

        {!actifs?.charge ? (
          <SilhouetteListeEnRoute />
        ) : actifs.erreur && !cartesActives.length ? (
          <EmptyState
            icon={<Waypoints className="h-5 w-5" />}
            title={t('La liste n’a pas pu être chargée')}
            hint={actifs.erreur}
          />
        ) : !cartesActives.length ? (
          <EmptyState
            icon={<Waypoints className="h-5 w-5" />}
            title={t('Rien en route')}
            hint={t('Aucune carte entre la demande et le déploiement, dans aucun projet.')}
          />
        ) : (
          <div className={GRILLE} data-liste-en-route>
            {cartesActives.map((pile) => (
              <PileDeCartes
                key={pile.cle}
                pile={pile}
                menu={gesteDuMenu}
                rendre={(card) =>
                  // Dans une pile encore active, une fille déjà en ligne garde son badge.
                  estDeployee(card) ? (
                    <CarteTerminee
                      key={card.id}
                      card={card}
                      demande={actifs.demandes[card.id]}
                      onOpen={() => onOpenCard(card)}
                      menu={gesteDuMenu(card)}
                    />
                  ) : (
                    <CarteEnRoute
                      key={card.id}
                      card={card}
                      agent={travailParCarte.get(card.id)}
                      demande={actifs.demandes[card.id]}
                      onOpen={() => onOpenCard(card)}
                      menu={gesteDuMenu(card)}
                    />
                  )
                }
              />
            ))}
          </div>
        )}
        {suite('actif')}
      </ColonneEnRoute>

      <ColonneEnRoute onglet="termine" titre={t('Terminés')} telephone={telephone} compte={nombreTermine}>
        {!termines?.charge ? (
          <SilhouetteListeEnRoute nombre={4} />
        ) : termines.erreur && !cartesTerminees.length ? (
          <EmptyState
            icon={<Waypoints className="h-5 w-5" />}
            title={t('La liste n’a pas pu être chargée')}
            hint={termines.erreur}
          />
        ) : !cartesTerminees.length ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title={t('Rien en ligne pour l’instant')}
            hint={t('Les cartes mises en ligne s’afficheront ici, la dernière en haut.')}
          />
        ) : (
          <div className={GRILLE} data-liste-terminee>
            {cartesTerminees.map((pile) => (
              <PileDeCartes
                key={pile.cle}
                pile={pile}
                menu={gesteDuMenu}
                rendre={(card) => (
                  <CarteTerminee
                    key={card.id}
                    card={card}
                    // La mère n'a pas de date de mise en ligne (DEC-258) : la
                    // sienne est celle de sa dernière fille publiée.
                    enLigneDepuis={card.deployedAt ?? Math.max(0, ...pile.cartes.map((c) => c.deployedAt ?? 0))}
                    demande={termines.demandes[card.id]}
                    onOpen={() => onOpenCard(card)}
                    menu={gesteDuMenu(card)}
                  />
                )}
              />
            ))}
          </div>
        )}
        {suite('termine')}
      </ColonneEnRoute>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-page-en-route>
      {telephone ? (
        <ZoneDefilement
          axe="horizontal"
          classeEnveloppe="min-h-0 flex-1"
          className={classesRailEnRoute(true)}
          data-rail-en-route
        >
          {colonnes}
        </ZoneDefilement>
      ) : (
        <div className={cn(classesRailEnRoute(false), 'min-h-0 flex-1')} data-rail-en-route>
          {colonnes}
        </div>
      )}
    </div>
  );
}

/**
 * UNE COLONNE DE LA PAGE, façon tableau : son titre et son nombre en tête, puis
 * sa liste, qui défile seule à la verticale.
 */
function ColonneEnRoute({
  onglet,
  titre,
  compte,
  telephone,
  children,
}: {
  onglet: OngletEnRoute;
  titre: string;
  /** Le nombre en tête ; absent tant que la liste n'est pas chargée (jamais un « 0 » trompeur). */
  compte?: React.ReactNode;
  telephone: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={classesColonneEnRoute(telephone)} data-colonne-en-route={onglet}>
      <header className={CLASSES_TETE_COLONNE_EN_ROUTE}>
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-faint">{titre}</h2>
        {compte !== undefined ? (
          <span className="text-[11.5px] tabular-nums text-faint" data-compte-en-route={onglet}>
            {compte}
          </span>
        ) : null}
      </header>
      <ZoneDefilement
        classeEnveloppe="min-h-0 flex-1"
        className={CLASSES_LISTE_COLONNE_EN_ROUTE}
        data-fil={onglet === 'termine' ? 'en-route-termine' : 'en-route'}
      >
        {children}
      </ZoneDefilement>
    </section>
  );
}

/**
 * UNE CARTE DE LA COLONNE « TERMINÉS » : la carte du tableau, à sa hauteur fixe,
 * son PROJET en haut à gauche et le badge « en ligne » dans le coin haut droit
 * — la date et l'heure exactes de la mise en ligne s'y lisent au survol.
 */
function CarteTerminee({
  card,
  enLigneDepuis = card.deployedAt,
  demande,
  onOpen,
  menu,
}: {
  card: Card;
  /** La date du badge, quand ce n'est pas celle de la carte (la mère d'une pile). */
  enLigneDepuis?: number;
  demande?: string;
  onOpen: () => void;
  menu: GesteDuMenu;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === card.projectId);
  return (
    <div className="flex min-w-0 flex-col" data-carte-terminee={card.id} data-deployee-a={enLigneDepuis}>
      <CardTile
        card={card}
        onOpen={onOpen}
        {...menu}
        enRoute={{
          demande,
          gauche: <NomDuProjet projet={projet} />,
          droite: (
            <Tooltip label={t('En ligne depuis le {v0}', { v0: dateHeure(enLigneDepuis ?? 0) })}>
              <span data-date-mise-en-ligne={enLigneDepuis}>
                <Badge tone="success">
                  <Rocket className="h-2.5 w-2.5" /> {t('en ligne')}
                </Badge>
              </span>
            </Tooltip>
          ),
        }}
      />
    </div>
  );
}

/** La durée du dépliage et du rempilage d'une pile. */
const DUREE_PILE_MS = 260;

/**
 * UNE PILE : les cartes d'une demande commune, la mère au-dessus (demande de
 * l'utilisateur, 25.09.2026). Une pile d'UNE carte est rendue telle quelle.
 *
 * REPLIÉE, seule la carte du dessus se voit, deux bords décalés derrière elle
 * et le nombre de cartes en pied. Un VOILE transparent la couvre : le premier
 * clic (ou Entrée) DÉPLIE la pile au lieu d'ouvrir la tâche du dessus. Le clic
 * droit et l'appui long passent au travers vers le menu de la carte du dessus.
 *
 * DÉPLIÉE, les cartes se posent l'une sous l'autre (hauteur et glissement
 * animés, coupés quand le système demande moins d'animations) et chacune ouvre
 * sa tâche. Un appui HORS de la pile, ou Échap, la rempile. L'état vit dans le
 * composant : un rechargement repart toujours replié.
 */
function PileDeCartes({
  pile,
  rendre,
  menu,
}: {
  pile: PileEnRoute<Card>;
  rendre: (card: Card) => React.ReactNode;
  menu: (card: Card) => GesteDuMenu;
}) {
  const [ouverte, setOuverte] = React.useState(false);
  // Les cartes du dessous restent montées le temps du rempilage animé.
  const [montees, setMontees] = React.useState(false);
  const [etalee, setEtalee] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const seule = pile.cartes.length < 2;

  React.useEffect(() => {
    if (ouverte) {
      setMontees(true);
      // Une image plus tard : la hauteur part de zéro, la transition joue.
      const image = requestAnimationFrame(() => requestAnimationFrame(() => setEtalee(true)));
      return () => cancelAnimationFrame(image);
    }
    setEtalee(false);
    const minuteur = window.setTimeout(() => setMontees(false), DUREE_PILE_MS);
    return () => window.clearTimeout(minuteur);
  }, [ouverte]);

  React.useEffect(() => {
    if (!ouverte) return;
    const dehors = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOuverte(false);
    };
    const echap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOuverte(false);
    };
    document.addEventListener('pointerdown', dehors, true);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('pointerdown', dehors, true);
      document.removeEventListener('keydown', echap);
    };
  }, [ouverte]);

  if (seule) return <>{pile.cartes.map(rendre)}</>;

  const [dessus, ...dessous] = pile.cartes;
  const menuDuDessus = menu(dessus);
  return (
    <div
      ref={ref}
      className={cn('relative flex min-w-0 flex-col', !ouverte && 'mb-1.5')}
      data-pile-en-route={pile.cle}
      data-pile-ouverte={ouverte ? 'true' : 'false'}
      data-nombre-pile={pile.cartes.length}
    >
      <div className="relative isolate flex min-w-0 flex-col">
        {/* Les bords des cartes du dessous, décalés derrière celle du dessus. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 -z-10 transition-opacity duration-200 motion-reduce:transition-none',
            ouverte ? 'opacity-0' : 'opacity-100',
          )}
        >
          <div className="absolute inset-x-4 -bottom-2.5 top-3 rounded-md border border-border bg-raised opacity-60" />
          <div className="absolute inset-x-2 -bottom-[5px] top-1.5 rounded-md border border-border bg-raised" />
        </div>
        {rendre(dessus)}
        {/* Le nombre de cartes, en pied de la carte du dessus, sur les bords du dessous. */}
        <span
          className={cn(
            'pointer-events-none absolute -bottom-2.5 right-3 z-40 flex items-center gap-1 rounded-full border border-border bg-raised px-1.5 py-px text-[11px] tabular-nums text-muted transition-opacity duration-200 motion-reduce:transition-none',
            ouverte ? 'opacity-0' : 'opacity-100',
          )}
          data-compte-pile={pile.cle}
        >
          <Layers className="h-3 w-3" />
          {pile.cartes.length}
        </span>
      </div>

      {!ouverte ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Deplier les ${pile.cartes.length} cartes de cette demande`}
          title={t('Déplier les {n} cartes de cette demande', { n: pile.cartes.length })}
          data-masque-pile={pile.cle}
          className="absolute inset-0 z-30 cursor-pointer rounded-md"
          onClick={(event) => {
            event.stopPropagation();
            setOuverte(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            setOuverte(true);
          }}
          // Le menu de la carte du dessus reste à portée : appui long au doigt…
          onPointerDown={menuDuDessus.onPointerDown}
          // … et clic droit à la souris, son relâchement avalé comme sur la carte.
          onContextMenu={(event) => {
            event.preventDefault();
            const avaler = (relache: PointerEvent) => {
              if (relache.button === 2) relache.stopPropagation();
            };
            document.addEventListener('pointerup', avaler, { capture: true, once: true });
            menuDuDessus.onMenuChange(true);
          }}
        />
      ) : null}

      {montees ? (
        <div
          className={cn(
            'grid transition-[grid-template-rows] ease-out motion-reduce:transition-none',
            etalee ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
          style={{ transitionDuration: `${DUREE_PILE_MS}ms` }}
          data-dessous-pile={pile.cle}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-4 pt-4">
              {dessous.map((card, i) => (
                <div
                  key={card.id}
                  className={cn(
                    'flex min-w-0 flex-col transition-[transform,opacity] ease-out motion-reduce:transition-none',
                    etalee ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0',
                  )}
                  style={{ transitionDuration: `${DUREE_PILE_MS}ms`, transitionDelay: etalee ? `${i * 40}ms` : '0ms' }}
                >
                  {rendre(card)}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Le projet d'une carte, en haut à gauche : son avatar (favicon ou initiales,
 * comme dans la colonne de gauche), puis son nom. Un PROJET RÉUNI montre, comme
 * sa ligne de la colonne de gauche, la pile des favicons de ses membres actifs ;
 * sans membre actif, il garde son avatar simple, jamais une pile vide.
 */
function NomDuProjet({ projet }: { projet?: Project }) {
  const state = useApp();
  const membres = projet && estUnRegroupement(projet) ? membresActifsDuRegroupement(state.projects, projet.id) : [];
  return (
    <>
      {projet && (membres.length ? <PastillesEmpilees projects={membres} fond="hsl(var(--raised))" /> : <PastilleProjet project={projet} />)}
      <span className="min-w-0 truncate text-muted" data-projet-carte>
        {projet?.name ?? t('Projet inconnu')}
      </span>
    </>
  );
}

/**
 * UNE CARTE DE LA PAGE : la carte du tableau, à sa hauteur fixe, avec en haut
 * à gauche son PROJET et son ÉTAPE, et dans le coin haut droit si un agent y
 * travaille encore — ou quand elle a rendu son dernier tour.
 */
function CarteEnRoute({
  card,
  agent,
  demande,
  onOpen,
  menu,
}: {
  card: Card;
  agent?: Agent;
  /** Le début du premier message écrit par l'utilisateur, quand il y en a un. */
  demande?: string;
  onOpen: () => void;
  menu: GesteDuMenu;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === card.projectId);
  /* UNE MÈRE TRAVAILLE PAR SES FILLES : son coin dit « Au travail » tant que
     l'une d'elles tourne, jamais « Rendue » sur le seul cadrage fini. */
  const fillesAuTravail =
    !!card.cartesFilles?.length && activiteDeLaMere(card.suiviDesFilles).enTravail > 0;
  // Une carte où un agent de tâche travaille se dit TOUJOURS « Travail »,
  // comme au tableau (`colonneAffichee`) ; un cadrage ne la déplace pas.
  const etape = colonneAffichee({
    column: card.column,
    agentAuTravail: !!agent && agentCompteCommeTravail(agent.role),
  });
  // LE NOM EN TÊTE EST CELUI DE LA FRISE, plus celui de la colonne : une carte
  // dont la compréhension est rendue se dit « Compréhension », pas « Demande ».
  const etapeDeSuivi = etapeCouranteDeSuivi(
    carteDeSuivi(card, { agentActif: !!agent, deploys: state.deploys, colonne: etape }),
  );
  return (
    <div className="flex min-w-0 flex-col" data-carte-en-route={card.id} data-etape={etapeDeSuivi}>
      <CardTile
        card={card}
        onOpen={onOpen}
        {...menu}
        enRoute={{
          demande,
          gauche: (
            <>
              <NomDuProjet projet={projet} />
              <span className="shrink-0 text-faint">·</span>
              <span className="shrink-0 text-muted" data-etape-libelle>
                {t(LIBELLE_ETAPE_DE_SUIVI[etapeDeSuivi])}
              </span>
            </>
          ),
          droite: (
            <span
              className="flex items-center gap-1"
              data-temoin-en-route={agent?.attendReponse ? 'question' : agent || fillesAuTravail ? 'travail' : 'repos'}
            >
              {/* UN AGENT ARRÊTÉ SUR SA QUESTION N'EST EN TRAVAIL POUR
                  PERSONNE : ni point qui bat, ni « en cours » — la carte
                  attend votre réponse (même règle que la vignette de
                  dépannage plus bas). */}
              {agent?.attendReponse ? (
                <span className="text-warning">{t('Attend votre réponse')}</span>
              ) : !agent && fillesAuTravail ? (
                <>
                  <Dot tone="running" pulse />
                  <span className="text-en-cours">{t('Au travail')}</span>
                </>
              ) : agent ? (
                <>
                  <Dot tone="running" pulse />
                  <span className="text-en-cours">
                    {agent.role === 'cadrage' ? t('Cadrage en cours') : t('Au travail')}
                  </span>
                </>
              ) : card.renduA ? (
                <span className="text-faint" title={new Date(card.renduA).toLocaleString()}>
                  {Date.now() - card.renduA < 60_000
                    ? t('Rendue à l’instant')
                    : t('Rendue il y a {v0}', { v0: relativeTime(card.renduA) })}
                </span>
              ) : null}
            </span>
          ),
        }}
      />
    </div>
  );
}

/** Le rôle d'un agent sans carte, dit en clair dans la tête de sa vignette. */
function libelleDuRole(role: Agent['role']): string {
  if (role === 'deploy') return t('Mise en ligne');
  if (role === 'analysis') return t('Analyse');
  if (role === 'cadrage') return t('Cadrage');
  return t('Agent');
}

/**
 * UN AGENT DE LA BANDE, AU FORMAT D'UNE CARTE DE LA LISTE : même cadre, même
 * tête (projet · rôle à gauche, état à droite), le titre, et la barre de
 * travail en pied tant qu'il travaille (`BandeauTravail`, la même que sous une
 * carte). Pas de description, donc pas la hauteur fixe des cartes : la
 * vignette est plus basse.
 *
 * L'ouverture est portée par le CADRE (`data-ouvrir-agent-en-route`), pas par
 * un `button` : le titre revient à la ligne (`line-clamp-2`), et un texte
 * replié ne se pose jamais dans un bouton. Le seul `button` est l'arrêt, qui
 * ne remonte pas jusqu'à l'ouverture.
 */
function VignetteAgent({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === agent.projectId);
  const auTravail = agentTientSonTour(agent);
  const Icone = agent.role === 'deploy' ? UploadCloud : agent.role === 'analysis' ? Microscope : Bot;
  const titreRef = React.useRef<HTMLHeadingElement>(null);
  const titreCoupe = useTexteCoupe([titreRef], [agent.title]);
  return (
    <div className="flex min-w-0 flex-col" data-vignette-agent-en-route={agent.id}>
      <div
        role="button"
        tabIndex={0}
        data-ouvrir-agent-en-route={agent.id}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onOpen();
        }}
        className={cn(
          'relative z-10 cursor-pointer rounded-md border border-border bg-raised px-2.5 py-2 transition-colors hover:border-faint',
          auTravail && 'rounded-b-none',
        )}
      >
        <div className="mb-1 flex h-[18px] min-w-0 items-center gap-1.5 text-[12px]" data-tete-carte-en-route>
          <div className="flex min-w-0 flex-1 items-center gap-1.5" data-tete-gauche>
            <NomDuProjet projet={projet} />
            <span className="shrink-0 text-faint">·</span>
            <span className="shrink-0 text-muted" data-role-agent-en-route>
              {libelleDuRole(agent.role)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1" data-tete-droite>
            <span className="flex items-center gap-1" data-temoin-en-route={auTravail ? 'travail' : 'repos'}>
              {agent.status === 'starting' ? (
                <>
                  <Dot tone="running" pulse />
                  <span className="text-faint">{t('démarre…')}</span>
                </>
              ) : auTravail ? (
                <>
                  <Dot tone="running" pulse />
                  <span className="text-en-cours">{t('Au travail')}</span>
                </>
              ) : (
                <span className="text-faint">{agent.status === 'failed' ? t('échec') : t('terminé')}</span>
              )}
            </span>
            {/* L'ARRÊT, le seul geste d'arrêt de ces agents : il arrête
                vraiment, y compris un agent bloqué que le démon referme alors
                d'autorité. Son clic ne remonte pas jusqu'à l'ouverture. */}
            {auTravail ? (
              <button
                data-arret-agent-en-route
                onClick={(event) => {
                  event.stopPropagation();
                  client
                    .call({ type: 'agent.stop', agentId: agent.id, cardId: agent.cardId })
                    .catch((err: any) => client.pushToast('error', err?.message ?? t('arrêt refusé')));
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="-my-[9px] -mr-[9px] ml-0.5 flex shrink-0 items-center justify-center p-[9px] text-faint hover:text-danger"
                title={t('Arrêter cet agent')}
              >
                <Square className="h-2.5 w-2.5 fill-current" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex items-start gap-1.5">
        <h3 ref={titreRef} className="line-clamp-2 min-w-0 flex-1 break-words text-[14px] font-medium leading-snug text-text">
          <Icone
            className={cn(
              'relative -top-px mr-1 inline h-[13px] w-[13px] align-middle',
              auTravail ? (agent.role === 'deploy' ? 'text-publie' : 'text-en-cours') : 'text-faint',
            )}
          />
          {agent.title}
        </h3>
        {titreCoupe ? <BulleTexteCoupe>{agent.title}</BulleTexteCoupe> : null}
        </div>
      </div>
      {auTravail ? <BandeauTravail agent={agent} onClick={onOpen} data-barre-agent-en-route={agent.id} /> : null}
    </div>
  );
}

/**
 * LA CARTE SPÉCIALE D'UN DÉPANNAGE DE PUBLICATION : l'agent ouvert par
 * « Résoudre le problème » sur un déploiement ou une mise en production tombé.
 * Bord et clé à molette ORANGE d'avertissement — elle se distingue d'un coup
 * d'œil des cartes de travail —, le projet, l'étape dépannée, et son état :
 * au travail, attend votre réponse, ou terminé. Le clic rouvre sa conversation,
 * d'où qu'on vienne. Même règle que `VignetteAgent` : l'ouverture est portée
 * par le cadre, jamais par un `button` qui contiendrait un texte replié.
 */
function VignetteDepannage({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === agent.projectId);
  const vivant = depanneurVivant(agent);
  const auTravail = agentTientSonTour(agent);
  const cible = agent.depannagePublication?.cible;
  return (
    <div className="flex min-w-0 flex-col" data-vignette-depannage={agent.id}>
      <div
        role="button"
        tabIndex={0}
        data-ouvrir-depannage={agent.id}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onOpen();
        }}
        className={cn(
          'relative z-10 cursor-pointer rounded-md border border-warning/60 bg-raised px-2.5 py-2 transition-colors hover:border-warning',
          auTravail && 'rounded-b-none',
        )}
      >
        <div className="mb-1 flex h-[18px] min-w-0 items-center gap-1.5 text-[12px]" data-tete-carte-en-route>
          <div className="flex min-w-0 flex-1 items-center gap-1.5" data-tete-gauche>
            <NomDuProjet projet={projet} />
            <span className="shrink-0 text-faint">·</span>
            <span className="shrink-0 text-warning">{t('Dépannage')}</span>
          </div>
          <span className="flex shrink-0 items-center gap-1" data-etat-depannage={agent.attendReponse ? 'question' : vivant ? 'travail' : 'fini'}>
            {agent.attendReponse ? (
              <span className="text-warning">{t('attend votre réponse')}</span>
            ) : vivant ? (
              <>
                <Dot tone="running" pulse />
                <span className="text-en-cours">{t('Au travail')}</span>
              </>
            ) : (
              <span className="text-faint">{agent.status === 'failed' ? t('échec') : t('terminé')}</span>
            )}
          </span>
        </div>
        <h3 className="line-clamp-2 min-w-0 break-words text-[14px] font-medium leading-snug text-text">
          <Wrench className="relative -top-px mr-1 inline h-[13px] w-[13px] align-middle text-warning" />
          {cible === 'production' ? t('Dépannage de la mise en production') : t('Dépannage du déploiement')}
        </h3>
        <p className="mt-0.5 text-[12px] text-muted">{t('Répare, puis relance l’étape tombée.')}</p>
      </div>
      {auTravail ? <BandeauTravail agent={agent} onClick={onOpen} data-barre-depannage={agent.id} /> : null}
    </div>
  );
}
