import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, ExternalLink, Image as ImageIcon, Plus, RotateCcw, Trash2 } from '@/components/ui/icones';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { BoutonTroisPoints, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui';
import { SilhouetteMarketing } from '@/components/silhouettes';
import { PageV2 as PageEnPlace } from './page-v2';
import { Apercu, Badge2, EcranVide, PastilleReseau, TableauDeCommunication, TitreDeLigne, dateCourteLocale, nombreLisible, type ColonneDeTableau } from '@/components/communication-v2/socle/pieces';
import { t } from '@/lib/langue';
import { ApercuAuSurvol, BasculeTableauCartes, CorpsDApercu, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { BasculeDePage, RechercheDuService, useDansUnePageDeService } from '@/components/fenetre-de-service';
import { cn } from '@/lib/utils';
import { useV2 } from './contexte';
import { PiedDAvance } from './pieces';
import { useCampagnes, type CampagneALaCorbeille, type LigneDeCampagneV2 } from './donnees';
import { ConfirmationDeSuppression, NouvelleCampagneEnConversation, PageDeCampagneV2, restaurerCampagne } from './conversation-de-campagne';

export const statutDeCampagne = (s: string): string => ({ preparation: t('En préparation'), prete: t('Prête'), en_cours: t('En cours'), terminee: t('Terminée') } as Record<string, string>)[s] ?? s;
const mesureLisible = (m: string): string => ({ visites: t('visites'), clics: t('clics'), vues: t('vues'), abonnes: t('abonnés gagnés') } as Record<string, string>)[m] ?? m;

/**
 * ÉTAPE 2 — LES CAMPAGNES. L'adresse choisit l'écran :
 *  - `campagnes` : la liste (mêmes colonnes que l'espace actuel, aérées), la CORBEILLE repliée sous elle, et en pied UN
 *    SEUL bouton pleine largeur, « Créer une nouvelle campagne » ; un clic droit (un appui long au doigt) sur une ligne propose « Supprimer » ;
 *  - `campagnes/nouvelle` : LA CONVERSATION DE CRÉATION (10/11/2026) — le champ des agents ; le premier message fait
 *    naître la campagne et son agent ;
 *  - `campagnes/<id>[/pub/<publication>]` : la page de la campagne, sa conversation et le volet de son plan ;
 *    `campagnes/<id>/programme` (ancienne adresse de l'assistant) l'ouvre, volet ouvert.
 */
export function PageCampagnes({ element }: { element: string[] }) {
  const [premier, second, troisieme] = element;
  if (premier === 'nouvelle') return <NouvelleCampagneEnConversation />;
  if (premier) return <PageDeCampagneV2 key={premier} id={premier} selection={second === 'pub' ? (troisieme ?? null) : null} versLeProgramme={second === 'programme'} />;
  return <ListeDesCampagnesV2 />;
}

function ListeDesCampagnesV2() {
  const { aller } = useV2();
  const { donnees } = useCampagnes();
  const [aSupprimer, setASupprimer] = React.useState<LigneDeCampagneV2 | null>(null);
  const colonnes: ColonneDeTableau<LigneDeCampagneV2>[] = [
    { cle: 'apercu', titre: t('Aperçu'), largeur: 61, rendu: (c) => <Apercu piece={c.image ?? c.apercu} genre="image" /> },
    { cle: 'campagne', titre: t('Campagne'), valeur: (c) => c.titre, rendu: (c) => <TitreDeLigne titre={c.titre} sous={c.objectif ?? c.message ?? '—'} /> },
    {
      cle: 'periode',
      titre: t('Période'),
      largeur: 172,
      secondaire: true,
      valeur: (c) => c.debut ?? '',
      rendu: (c) => <span className="whitespace-nowrap text-[12.5px] text-muted">{c.debut || c.fin ? `${dateCourteLocale(c.debut)} → ${dateCourteLocale(c.fin)}` : '—'}</span>,
    },
    {
      cle: 'reseaux',
      titre: t('Sur'),
      largeur: 76,
      secondaire: true,
      rendu: (c) => (
        <span className="inline-flex gap-1">
          {c.reseaux.slice(0, 3).map((r) => (
            <PastilleReseau key={r} canal={r} />
          ))}
        </span>
      ),
    },
    {
      cle: 'objectif',
      titre: t('Objectif'),
      largeur: 132,
      rendu: (c) => (c.objectifChiffre ? <span className="text-[12.5px] text-muted">{`${nombreLisible(c.atteint)} / ${nombreLisible(c.objectifChiffre)} ${mesureLisible(c.mesure)}`}</span> : '—'),
    },
    { cle: 'publications', titre: t('Publications'), largeur: 150, droite: true, secondaire: true, rendu: (c) => (c.publiees !== undefined ? t('{a} prévues · {b} parties', { a: c.publications - (c.publiees ?? 0), b: c.publiees ?? 0 }) : c.publications) },
    {
      cle: 'etat',
      titre: t('État'),
      largeur: 118,
      filtre: 'choix',
      lireFiltre: (c) => c.statut,
      libelleDuChoix: statutDeCampagne,
      rendu: (c) => <EtatDeLaCampagne campagne={c} />,
    },
    { cle: 'avancement', titre: t('Visuels faits'), valeur: (c) => (c.visuels?.prevus ? c.visuels.faits / c.visuels.prevus : 0), rendu: () => null },
    /* LES TROIS POINTS DU SURVOL ouvrent le menu du clic droit, posé sous eux (`ouvrirLeMenuDeLaLigne`). */
    { cle: 'menu', titre: '', largeur: 44, droite: true, rendu: () => <BoutonTroisPoints className="-my-1 ml-auto" onClick={ouvrirLeMenuDeLaLigne} data-v2-trois-points="" /> },
  ];
  /* UN SEUL BOUTON EN BAS, « CRÉER UNE NOUVELLE CAMPAGNE » (demande du 10/11/2026, carte « Volet des campagnes comme un
     plan ») : plus de champ du chef, plus de « Suivant : Connexion », plus de bouton en haut — ordinateur comme
     téléphone. Une campagne se crée en conversation avec son agent ; la connexion reste joignable par la colonne. */
  const pied = (
    <PiedDAvance
      principal={
        <Button type="button" variant="default" onClick={() => aller('campagnes', 'nouvelle')} data-v2-nouvelle-campagne>
          <Plus className="h-4 w-4" />
          {t('Créer une nouvelle campagne')}
        </Button>
      }
    />
  );
  const corbeille = donnees?.corbeille ?? [];
  /* TABLEAU OU CARTES (14/11/2026, façon Claude Desktop) : le tableau par défaut, les cartes d'avant gardées ; le choix
     est retenu. La bascule se pose à droite de la rangée de la page de service. */
  const [vue, setVue] = useVueDeLaListe('communication.vueDesCampagnes');
  /* LA PAGE D'UN PROJET, SANS ENCOMBREMENT (décision du 20/11/2026, capture #958e) : plus de « 1 campagne(s) », plus
     de bascule seule sur sa ligne puis de recherche sur la suivante. Dans une page de service, la recherche et la
     bascule montent à droite du titre ; ailleurs (la page ouverte dans un projet), elles tiennent UNE rangée, avec le
     filtre du tableau, à la hauteur commune. */
  const [recherche, setRecherche] = React.useState('');
  const dansUnePage = useDansUnePageDeService();
  const [cibleDesOutils, setCibleDesOutils] = React.useState<HTMLElement | null>(null);
  const outils = (
    <>
      <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher une campagne')} data-v2-recherche-campagnes />
      <BasculeDePage>
        <BasculeTableauCartes repere="vue-des-campagnes" valeur={vue} onChange={setVue} />
      </BasculeDePage>
    </>
  );
  return (
    <PageEnPlace barre={false} titre={t('Campagnes')} invite={null} pied={pied} colonneDuService data-v2-campagnes={donnees?.campagnes.length ?? ''}>
      {!donnees ? (
        <SilhouetteMarketing />
      ) : donnees.campagnes.length ? (
        <>
        {dansUnePage ? (
          outils
        ) : (
          <div className="flex shrink-0 items-center gap-2 pb-3" data-v2-rangee-des-campagnes>
            {outils}
            <span ref={setCibleDesOutils} className="flex items-center gap-2 empty:hidden" />
          </div>
        )}
        <ApercuAuSurvol lire={(id) => donnees.campagnes.find((c) => c.id === id)} rendu={(c) => <ApercuDeCampagne campagne={c} />} actif={vue === 'tableau'}>
        <MenuAuClicDroit
          lire={(id) => donnees.campagnes.find((c) => c.id === id) ?? null}
          entrees={(c) => [
            { libelle: t('Ouvrir la campagne'), icone: <ExternalLink className="text-muted" />, raison: null, faire: () => aller('campagnes', c.id), repere: 'data-v2-menu-ouvrir' },
            {
              libelle: t('Supprimer'),
              icone: <Trash2 />,
              danger: true,
              raison: c.agentAuTravail ? t('L’agent de cette campagne travaille : attendez qu’il ait fini pour la supprimer.') : null,
              faire: () => setASupprimer(c),
              repere: 'data-v2-menu-supprimer',
            },
          ]}
          repere="campagnes"
        >
          {/* LES CAMPAGNES EN CARTES (12/11/2026, capture #aacc : les rangées serrées étaient illisibles). Le concept de
              tableau reste — recherche, filtre d'état, tri par un menu —, chaque campagne devient une carte. */}
          <TableauDeCommunication
            repere="campagnes-v2"
            rechercheExterne={recherche}
            {...(!dansUnePage && cibleDesOutils ? { cibleDesOutils } : {})}
            colonnes={colonnes}
            lignes={donnees.campagnes}
            cleDe={(c) => c.id}
            onLigne={(c) => aller('campagnes', c.id)}
            {...(vue === 'cartes' ? { grille: (c: LigneDeCampagneV2) => <CarteDeCampagne campagne={c} /> } : {})}
          />
        </MenuAuClicDroit>
        </ApercuAuSurvol>
        </>
      ) : (
        <EcranVide titre={t('Aucune campagne pour l’instant')} texte={t('Une campagne réunit des publications autour d’un but : faire connaître une nouveauté, amener du monde sur le site… Décrivez votre idée, l’agent de la campagne vous pose ses questions.')} data-v2-campagnes-vide />
      )}
      {corbeille.length ? <CorbeilleDesCampagnes campagnes={corbeille} /> : null}
      {aSupprimer ? (
        <ConfirmationDeSuppression campagne={{ id: aSupprimer.id, titre: aSupprimer.titre, aAnnuler: aSupprimer.aAnnuler ?? 0, medias: aSupprimer.medias ?? 0 }} onFermer={() => setASupprimer(null)} />
      ) : null}
    </PageEnPlace>
  );
}

/**
 * L'APERÇU D'UNE CAMPAGNE AU SURVOL (14/11/2026, maquette 5) : son image, ses réseaux, son titre, sa description,
 * l'avancement de ses visuels. Le mécanisme (souris seule, 300 ms, portail) est commun : `ApercuAuSurvol`.
 */
export function ApercuDeCampagne({ campagne }: { campagne: LigneDeCampagneV2 }) {
  return (
    <CorpsDApercu
      image={campagne.image ?? campagne.apercu ? <img src={adresseDePiece((campagne.image ?? campagne.apercu)!, false, 480)} alt="" className="h-full w-full object-cover object-top" /> : <span />}
      sous={
        <span className="flex items-center gap-1.5">
          {campagne.reseaux.slice(0, 3).map((r) => (
            <PastilleReseau key={r} canal={r} />
          ))}
        </span>
      }
      titre={campagne.titre}
      texte={campagne.objectif ?? campagne.message ?? undefined}
    >
      <p className="flex items-center justify-between pt-1 text-[12px] text-faint">
        <span>{campagne.debut || campagne.fin ? `${dateCourteLocale(campagne.debut)} → ${dateCourteLocale(campagne.fin)}` : '—'}</span>
        {campagne.visuels?.prevus ? <span>{t('{a} / {b} visuels', { a: campagne.visuels.faits, b: campagne.visuels.prevus })}</span> : null}
      </p>
    </CorpsDApercu>
  );
}

/** L'ÉTAT D'UNE CAMPAGNE : ce qui attend la personne (jaune), « Prête » (vert), sinon son état en gris. */
export function EtatDeLaCampagne({ campagne: c }: { campagne: Pick<LigneDeCampagneV2, 'aAccepter' | 'statut'> }) {
  if (c.aAccepter) return <Badge2 ton="attente">{t('{n} à valider', { n: c.aAccepter })}</Badge2>;
  return (
    <Badge2 ton={c.statut === 'prete' ? 'vert' : c.statut === 'en_cours' ? 'neutre' : 'gris'} data-v2-etat-campagne={c.statut}>
      {statutDeCampagne(c.statut)}
    </Badge2>
  );
}

/**
 * UNE CAMPAGNE EN CARTE (12/11/2026) : l'aperçu de son premier visuel en haut, le titre ENTIER (deux lignes), la
 * description (trois lignes), la période, les réseaux, l'avancement « n / N visuels faits » et l'état. Le cadre
 * cliquable est posé par le tableau (jamais un `button` autour d'un texte replié).
 */
function CarteDeCampagne({ campagne: c }: { campagne: LigneDeCampagneV2 }) {
  const piece = c.image ?? c.apercu;
  const [casse, setCasse] = React.useState(false);
  const visuels = c.visuels;
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-v2-carte-campagne={c.id}>
      <div className="aspect-[16/9] w-full overflow-hidden bg-raised">
        {piece && !casse ? (
          <img src={adresseDePiece(piece, false, 480)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" onError={() => setCasse(true)} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-faint">
            <ImageIcon className="h-6 w-6" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex min-w-0 items-start gap-2">
          <h3 className="line-clamp-2 min-w-0 flex-1 text-[14px] font-semibold leading-snug text-text" title={c.titre}>
            {c.titre}
          </h3>
          <span className="shrink-0">
            <EtatDeLaCampagne campagne={c} />
          </span>
        </div>
        {c.objectif || c.message ? <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted">{c.objectif ?? c.message}</p> : null}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-[12px] text-muted">
          {c.debut || c.fin ? <span className="whitespace-nowrap">{`${dateCourteLocale(c.debut)} → ${dateCourteLocale(c.fin)}`}</span> : null}
          {c.reseaux.length ? (
            <span className="inline-flex gap-1">
              {c.reseaux.slice(0, 5).map((r) => (
                <PastilleReseau key={r} canal={r} />
              ))}
            </span>
          ) : null}
          {visuels?.prevus ? (
            <span className={cn('ml-auto whitespace-nowrap tabular-nums', visuels.faits >= visuels.prevus && 'text-success')} data-v2-visuels-campagne={`${visuels.faits}/${visuels.prevus}`}>
              {t('{a} / {b} visuels faits', { a: visuels.faits, b: visuels.prevus })}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * LA CORBEILLE DES CAMPAGNES, REPLIÉE EN BAS DE LA LISTE (10/11/2026) : présente seulement quand elle n'est pas vide.
 * Chaque campagne dit quand elle s'effacera ; « Restaurer » la rend avec ses visuels et sa conversation — par le
 * bouton de sa ligne, ou par le même menu au clic droit.
 */
function CorbeilleDesCampagnes({ campagnes }: { campagnes: CampagneALaCorbeille[] }) {
  const [ouverte, setOuverte] = React.useState(false);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const restaurer = async (id: string) => {
    setEnCours(id);
    await restaurerCampagne(id);
    setEnCours(null);
  };
  return (
    <section className="flex min-w-0 flex-col gap-2" data-v2-corbeille={ouverte ? 'ouverte' : 'repliee'} data-v2-corbeille-nombre={campagnes.length}>
      <button type="button" onClick={() => setOuverte((o) => !o)} aria-expanded={ouverte} className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-muted hover:text-text" data-v2-ouvrir-corbeille>
        {ouverte ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {t('Corbeille ({n})', { n: campagnes.length })}
      </button>
      {ouverte ? (
        <MenuAuClicDroit
          lire={(id) => campagnes.find((c) => c.id === id) ?? null}
          entrees={(c) => [{ libelle: t('Restaurer'), icone: <RotateCcw className="text-muted" />, raison: null, faire: () => void restaurer(c.id), repere: 'data-v2-menu-restaurer' }]}
          repere="corbeille"
        >
          <ul className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-surface" data-v2-liste-corbeille>
            {campagnes.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-2.5 px-3 py-2.5" data-communication-ligne={c.id} data-v2-campagne-corbeille={c.id}>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px] font-semibold text-muted">{c.titre}</b>
                  <span className="block truncate text-[12px] text-faint">{t('Effacée pour de bon le {date}', { date: dateCourteLocale(new Date(c.effaceLe).toISOString().slice(0, 10)) })}</span>
                </span>
                <Button size="sm" variant="subtle" disabled={enCours === c.id} onClick={() => void restaurer(c.id)} data-v2-restaurer={c.id}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('Restaurer')}
                </Button>
              </li>
            ))}
          </ul>
        </MenuAuClicDroit>
      ) : null}
    </section>
  );
}

interface EntreeDuMenu {
  libelle: string;
  icone: React.ReactNode;
  danger?: boolean;
  /** Une raison : l'entrée est éteinte et la dit au survol. */
  raison: string | null;
  faire: () => void;
  repere: string;
}

const APPUI_LONG_MS = 500;

/**
 * LES TROIS POINTS D'UNE LIGNE OUVRENT LE MENU DU CLIC DROIT, sous eux : ils rejouent un clic droit à leur coin bas
 * gauche, que la zone (`MenuAuClicDroit`) reçoit comme les autres — un seul chemin, un seul menu.
 */
function ouvrirLeMenuDeLaLigne(event: React.MouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
  const boite = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: boite.right - 190, clientY: boite.bottom + 4, button: 2 }));
}

/**
 * LE MENU AU CLIC DROIT D'UNE LIGNE DE CAMPAGNE, sur le modèle du menu des médias (`MenuDesMedias`) : un seul écouteur
 * pour la zone, qui lit l'identifiant sur `[data-communication-ligne]` ; le menu se pose au point du clic sur une ancre
 * invisible portée dans `body` ; au doigt, un appui long de 500 ms l'ouvre et le doigt levé n'ouvre pas la campagne ;
 * le relâché du clic droit est avalé (compétence « clic-droit-radix-qui-choisit-une-ligne »). Le clic simple garde son
 * rôle : il ouvre la campagne.
 */
function MenuAuClicDroit<L>({ lire, entrees, repere, children }: { lire: (id: string) => L | null; entrees: (ligne: L) => EntreeDuMenu[]; repere: string; children: React.ReactNode }) {
  const [menu, setMenu] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const ouvertA = React.useRef(0);
  const appui = React.useRef<{ x: number; y: number; minuterie: number } | null>(null);
  const ouvrir = (cible: EventTarget | null, x: number, y: number): boolean => {
    const el = cible instanceof Element ? cible.closest('[data-communication-ligne]') : null;
    const id = el?.getAttribute('data-communication-ligne') ?? null;
    if (!id || !lire(id)) return false;
    ouvertA.current = Date.now();
    setMenu({ id, x, y });
    return true;
  };
  const lacher = () => {
    if (appui.current) window.clearTimeout(appui.current.minuterie);
    appui.current = null;
  };
  /* Le relâché qui suit l'ouverture tombe sur l'entrée posée sous le pointeur : il ne la choisit pas. */
  const garde = (e: React.PointerEvent) => {
    if (Date.now() - ouvertA.current < 500) e.preventDefault();
  };
  const ligne = menu ? lire(menu.id) : null;
  const liste = ligne ? entrees(ligne) : null;
  return (
    <div
      className="contents"
      data-v2-zone-menu={repere}
      onContextMenu={(ev) => {
        if (!ouvrir(ev.target, ev.clientX, ev.clientY)) return;
        ev.preventDefault();
        const avaler = (relache: PointerEvent) => {
          if (relache.button === 2) relache.stopPropagation();
        };
        document.addEventListener('pointerup', avaler, { capture: true, once: true });
      }}
      onPointerDown={(ev) => {
        if (ev.pointerType === 'mouse') return;
        lacher();
        const { clientX: x, clientY: y, target } = ev;
        appui.current = {
          x,
          y,
          minuterie: window.setTimeout(() => {
            appui.current = null;
            if (!ouvrir(target, x, y)) return;
            navigator.vibrate?.(8);
            /* Le doigt qui se lève après l'appui long n'ouvre pas la campagne. */
            const avaler = (clic: MouseEvent) => {
              clic.preventDefault();
              clic.stopPropagation();
            };
            document.addEventListener('click', avaler, { capture: true, once: true });
            window.setTimeout(() => document.removeEventListener('click', avaler, { capture: true }), 800);
          }, APPUI_LONG_MS),
        };
      }}
      onPointerMove={(ev) => {
        const depart = appui.current;
        if (depart && Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) > 8) lacher();
      }}
      onPointerUp={lacher}
      onPointerCancel={lacher}
    >
      {children}
      {menu && liste
        ? createPortal(
            <DropdownMenu open onOpenChange={(o) => !o && setMenu(null)} modal={false}>
              <DropdownMenuTrigger asChild>
                <span aria-hidden className="pointer-events-none fixed h-0 w-0" style={{ left: menu.x, top: menu.y }} />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                data-v2-menu-ligne={menu.id}
                onInteractOutside={(event) => {
                  const source = (event.detail as { originalEvent?: Event }).originalEvent;
                  const boutonDroit = (source && 'button' in source && (source as MouseEvent).button === 2) || source?.type === 'contextmenu';
                  if (boutonDroit || Date.now() - ouvertA.current < 600) event.preventDefault();
                }}
              >
                {liste.map((e, rang) => (
                  <React.Fragment key={e.repere}>
                    {/* Le geste qui détruit vient en dernier, après un trait (le modèle commun des menus). */}
                    {e.danger && rang > 0 ? <DropdownMenuSeparator /> : null}
                    <span className="block" {...(e.raison ? { title: e.raison, 'data-v2-raison-eteint': e.raison } : {})}>
                      <DropdownMenuItem
                        disabled={!!e.raison}
                        danger={e.danger}
                        onPointerUp={garde}
                        onSelect={() => {
                          setMenu(null);
                          e.faire();
                        }}
                        {...{ [e.repere]: e.raison ? 'eteint' : 'pret' }}
                      >
                        {e.icone}
                        {e.libelle}
                      </DropdownMenuItem>
                    </span>
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>,
            document.body,
          )
        : null}
    </div>
  );
}
