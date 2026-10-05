import * as React from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  FileText,
  Filter,
  Info,
  Link2,
  Loader2,
  Megaphone,
  MessageCircleQuestion,
  MoreVertical,
  PenLine,
  Plus,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  type ActionMarketing,
  type Agent,
  type Card,
  type ContenuMarketing,
  type EspaceMarketing,
  type EtapeContenu,
  type EtatBoutonMarketing,
  type FicheMarketing,
  type GesteAgentMarketing,
  type GuideMarketing,
  type JalonDuGuide,
  type ResultatsMarketing,
  type ColonneTableauMarketing,
  type DiagnosticSuivi,
  LIBELLE_DIAGNOSTIC_SUIVI,
  diagnosticACorriger,
  type EtapeLigneMarketing,
  type FiltresTableauMarketing,
  type LigneTableauMarketing,
  type ReglageTableauMarketing,
  type TrancheAvancement,
  REGLAGE_TABLEAU_VIDE,
  TRANCHES_AVANCEMENT,
  filtreActif,
  lignesDuTableauMarketing,
  reglageTableauValide,
  sansFiltre,
  separerProjetsActifs,
  triSuivant,
  CANAUX_CONTENU,
  FAMILLES_CANAL,
  LIBELLE_ETAPE,
  LIBELLE_FAMILLE_CANAL,
  agentTientSonTour,
  canalDuCatalogue,
  canauxDansLOrdre,
  decisionsQuiAlertent,
  etatDuBoutonMarketing,
  jourValide,
  parcoursDuCanal,
  CHAT_FLOTTANT_DEFAUT,
  COLONNES_CONTENU,
  ROND_CHAT,
  chatDeplace,
  chatRedimensionne,
  chatRetenu,
  chatVisible,
  cleChatMarketing,
  colonneDeContenu,
  depotContenu,
  type ColonneContenu,
  estTelephoneBas,
  estTelephoneChat,
  type ChatFlottant,
  type FenetreChat,
} from '@beluga/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ZoneDefilement,
} from '@/components/ui';
import { SilhouetteConversation, SilhouetteMarketing } from '@/components/silhouettes';
import { RepereAttention } from '@/components/repere-attention';
import { Chat } from '@/components/chat';
import { Markdown } from '@/lib/markdown';
import { InterrupteurDeSuivi } from '@/components/interrupteur-suivi';
import { PastilleProjet } from '@/components/pastille-projet';
import { SelecteurDeProjet } from '@/components/selecteur-de-projet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { createPortal } from 'react-dom';
import { usePref } from '@/lib/prefs';
import { useTelephone } from '@/lib/telephone';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { usePointerDrag, type DropTarget } from '@/lib/dnd';
import { CourbeParJour, MiniCourbe, Repartition, copier, dateCourte } from '@/components/graphiques-statistiques';

/**
 * L'ATELIER MARKETING — la liste des projets, puis l'espace d'UN projet.
 *
 * Tout ce qui se montre vient du serveur à l'ouverture (`marketing.lister`,
 * `marketing.espace`), et se relit quand l'événement `marketing` de ce projet
 * passe : l'agent qui écrit un contenu le fait apparaître sans rien recharger.
 *
 * REFONTE DU 26/09/2026 — un écran d'application professionnelle, pensé
 * d'abord pour le téléphone :
 *  - LE GUIDE EST LA CONVERSATION DE L'AGENT (refonte du 26/09, seconde
 *    passe) : le `Chat` commun y tient toute la hauteur, sa liste de tâches
 *    au-dessus du champ d'écriture, son rapport rendu dans le fil — on le
 *    corrige en lui répondant. Le BOUTON UNIQUE (`BoutonAgent`, état de
 *    `etatDuBoutonMarketing`) est le pied pleine largeur du chat flottant :
 *    « Initialiser », l'avancement n/N, la question, puis « Rapport », qui
 *    ouvre le dernier rapport enregistré en lecture ;
 *  - Canaux montre TOUT le catalogue avec l'avis de l'agent, le Calendrier
 *    porte son plan d'action daté à côté des contenus, et le service Statistiques (écran à part) trace
 *    les courbes et les répartitions ;
 *  - AUCUNE EXPLICATION AFFICHÉE EN PERMANENCE : chacune vit derrière un point
 *    « i » (`PointInfo`) qui ouvre un volet — jamais une bulle au survol, qui ne
 *    marche pas au doigt ;
 *  - UNE ACTION PRINCIPALE PAR ONGLET, dans un pied pleine largeur
 *    (`CorpsOnglet`) ; le reste en icônes nommées ;
 *  - listes et fiches s'ouvrent en tiroirs empilés ; le calendrier se lit en
 *    semaine sur téléphone, en quatre semaines sur ordinateur.
 */

interface LigneProjetMarketing {
  projectId: string;
  nom: string;
  nature: string | null;
  etatSuivi: string;
  /** Ce que porte la page en production (`DiagnosticSuivi`), `null` sans adresse connue. */
  diagnosticSuivi?: DiagnosticSuivi | null;
  avancement: number;
  prochaineAction: string | null;
  aUnAgent: boolean;
  agentId: string | null;
  /** L'état à la lecture ; l'écran le suit ensuite en direct sur l'agent. */
  travaille: boolean;
  attendReponse: boolean;
  brouillons: number;
  aValider: number;
  programmes: number;
  publies: number;
  /** Les visites des quatre dernières semaines, jour par jour (`jours`). */
  visites: number[];
  /** Suivi marketing voulu ? Coupé, le projet passe dans « Projets inactifs ». */
  actif?: boolean;
  /** Les cartes de l'atelier en cours (colonne « En cours » du tableau de bord). */
  enCours?: TravailMarketingEnCours[];
}

interface TravailMarketingEnCours {
  cardId: string;
  agentId: string | null;
  titre: string;
  colonne: string;
  depuis: number;
}

interface EspaceComplet {
  projectId: string;
  nom: string;
  espace: EspaceMarketing | null;
  contenus: ContenuMarketing[];
  actions: ActionMarketing[];
  guide: GuideMarketing;
  resultats: (ResultatsMarketing & { tronque: boolean }) | null;
  extrait: string | null;
  confidentialite: string;
  adresseLiens: string;
  /** Les cartes de l'agent marketing du projet : elles ne paraissent plus au tableau. */
  cartes?: Card[];
  /** Ce que porte la page servie (`DiagnosticSuivi`), `null` sans adresse connue. */
  diagnosticSuivi?: DiagnosticSuivi | null;
  /** LA carte d'installation du suivi, si elle existe : posée, elle ne vaut pas code posé. */
  carteSuivi?: Card | null;
}

function libelleNature(cle: string): string {
  const libelles: Record<string, string> = {
    site: t('Site'),
    boutique: t('Boutique'),
    app: t('Application'),
    saas: t('Service en ligne'),
  };
  return libelles[cle] ?? cle;
}

function libelleHebergement(cle: string): string {
  const libelles: Record<string, string> = {
    beluga: t('Sur ce serveur'),
    'serveur-distant': t('Sur un autre serveur'),
    hebergeur: t('Chez un hébergeur'),
    plateforme: t('Sur une plateforme'),
  };
  return libelles[cle] ?? cle;
}

function libelleCanal(cle: string): string {
  const canal = canalDuCatalogue(cle);
  if (canal) return t(canal.libelle);
  return cle === 'autre' ? t('Autre') : cle;
}

function jourLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function lundiLocal(date: Date): Date {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/* ------------------------------------------------------------------ */
/* Les briques communes                                                 */
/* ------------------------------------------------------------------ */

/**
 * LE VOLET D'EXPLICATION. Toutes les explications de l'écran s'y lisent : un
 * tiroir empilé, au doigt comme à la souris, qu'on referme en le tirant.
 */
function VoletInfo({ ouvert, titre, onClose, children }: { ouvert: boolean; titre: string; onClose: () => void; children: React.ReactNode }) {
  if (!ouvert) return null;
  return (
    <Drawer open onClose={onClose} empile>
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2">
        <Info className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{titre}</DialogTitle>
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-5">
        <div className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-text" data-marketing-volet-info>
          {children}
        </div>
      </ZoneDefilement>
    </Drawer>
  );
}

/** LE POINT « i » : une petite icône qui ouvre le volet d'explication. */
function PointInfo({ titre, children }: { titre: string; children: React.ReactNode }) {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Explications"
        title={t('Explications')}
        data-marketing-info
        onClick={() => setOuvert(true)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-bloc hover:text-text"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <VoletInfo ouvert={ouvert} titre={titre} onClose={() => setOuvert(false)}>
        {children}
      </VoletInfo>
    </>
  );
}

/** Une action d'entête : une icône nommée sur ordinateur, une ligne du volet sur téléphone. */
interface ActionDEntete {
  cle: string;
  libelle: string;
  icone: React.ReactNode;
  onClick: () => void;
  /** Le repère de contrôle posé sur le bouton (ex. `data-marketing-copier-texte`). */
  repere?: string;
}

/**
 * LES ACTIONS DE L'ENTÊTE, DANS TOUT L'OUTIL MARKETING (demande du 26/09/2026) :
 * sur ordinateur, les petites icônes restent visibles ; sur téléphone, elles
 * passent derrière UN bouton à trois points verticaux, qui ouvre un volet
 * listant chaque action par son nom — le point « i » compris. Une rangée
 * d'icônes serrées ne tenait pas à côté d'un titre sur 390 px.
 */
function ActionsEntete({ actions = [], info }: { actions?: ActionDEntete[]; info?: { titre: string; contenu: React.ReactNode } }) {
  const telephone = useTelephone();
  const [menu, setMenu] = React.useState(false);
  const [explications, setExplications] = React.useState(false);
  if (!telephone) {
    return (
      <>
        {actions.map((a) => (
          <Button key={a.cle} size="icon" variant="ghost" aria-label={a.libelle} title={a.libelle} onClick={a.onClick} {...(a.repere ? { [a.repere]: '' } : {})}>
            {a.icone}
          </Button>
        ))}
        {info ? <PointInfo titre={info.titre}>{info.contenu}</PointInfo> : null}
      </>
    );
  }
  if (!actions.length && !info) return null;
  return (
    <>
      <Button size="icon" variant="ghost" aria-label="Plus d’actions" title={t('Plus d’actions')} onClick={() => setMenu(true)} data-marketing-menu-actions>
        <MoreVertical className="h-4 w-4" />
      </Button>
      {menu ? (
        <Drawer open onClose={() => setMenu(false)} empile>
          <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-[max(env(safe-area-inset-bottom),12px)]">
            <div className="flex flex-col gap-0.5 pt-1" data-marketing-volet-actions={actions.length + (info ? 1 : 0)}>
              {actions.map((a) => (
                <button
                  key={a.cle}
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    a.onClick();
                  }}
                  className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[13.5px] text-text hover:bg-bloc"
                  {...(a.repere ? { [a.repere]: '' } : {})}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">{a.icone}</span>
                  {a.libelle}
                </button>
              ))}
              {info ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    setExplications(true);
                  }}
                  className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[13.5px] text-text hover:bg-bloc"
                  data-marketing-info
                >
                  <Info className="h-4 w-4 shrink-0 text-muted" />
                  {t('Explications')}
                </button>
              ) : null}
            </div>
          </ZoneDefilement>
        </Drawer>
      ) : null}
      {info ? (
        <VoletInfo ouvert={explications} titre={info.titre} onClose={() => setExplications(false)}>
          {info.contenu}
        </VoletInfo>
      ) : null}
    </>
  );
}

/**
 * LE CORPS D'UN ONGLET : ce qui défile, puis le PIED qui garde l'action
 * principale sous le pouce, en pleine largeur sur téléphone.
 */
function CorpsOnglet({
  children,
  pied,
  refDefilement,
  plein,
}: {
  children: React.ReactNode;
  pied?: React.ReactNode;
  /** Le contenu remplit au moins la hauteur visible (il peut s'y étirer en `flex-1`). */
  plein?: boolean;
  /** Ce qui défile, pour qu'un onglet à deux vues retrouve sa position au retour. */
  refDefilement?: React.Ref<HTMLDivElement>;
}) {
  return (
    <>
      <ZoneDefilement ref={refDefilement} fond="hsl(var(--surface))" className={cn('px-3 pb-4', plein && 'flex flex-col')}>
        {children}
      </ZoneDefilement>
      {pied ? (
        <div className="flex shrink-0 items-center gap-1.5 px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 sm:justify-end" data-marketing-pied>
          {pied}
        </div>
      ) : null}
    </>
  );
}

/** Une rangée de choix qui défile de côté au lieu d'être coupée au bord. */
function RangeeDeChoix({ children }: { children: React.ReactNode }) {
  return (
    <ZoneDefilement axe="horizontal" classeEnveloppe="flex-none min-w-0 flex-1" className="py-0.5">
      <div className="flex w-max items-center gap-1">{children}</div>
    </ZoneDefilement>
  );
}

/* ------------------------------------------------------------------ */
/* L'écran                                                              */
/* ------------------------------------------------------------------ */

export function Marketing({
  open,
  onClose,
  enPage,
  vise,
  onVise,
  onOuvrirCarte,
}: {
  open: boolean;
  onClose: () => void;
  enPage?: boolean;
  /** LE PROJET DÉSIGNÉ PAR L'ADRESSE : « #marketing/<projet> ». */
  vise?: string | null;
  onVise?: (projectId: string | null) => void;
  /** Ouvre une carte de l'agent marketing dans le tiroir des cartes. */
  onOuvrirCarte?: (card: Card) => void;
}) {
  const state = useApp();
  const [vue, setVue] = React.useState<{ projets: LigneProjetMarketing[]; jours: string[] } | null>(null);
  const projectId = vise ?? null;
  /** L'onglet voulu par le dernier clic : « Contenus » depuis la colonne « En cours », sinon le défaut. */
  const [ongletVoulu, setOngletVoulu] = React.useState<Onglet | undefined>(undefined);
  React.useEffect(() => {
    if (!projectId) setOngletVoulu(undefined);
  }, [projectId]);

  /* LE TABLEAU DE BORD SE RELIT EN DIRECT : à chaque événement `marketing`, et
     quand un agent commence ou finit son tour — c'est ainsi qu'une carte de
     l'atelier entre dans la colonne « En cours », puis en sort. Les cartes
     marketing ne partent pas dans les paquets du tableau : seule cette
     lecture les apporte. La vue précédente reste affichée pendant la relecture. */
  const versionMarketing = Object.values(state.marketingVersions).reduce((a, b) => a + b, 0);
  const agentsAuTravail = Object.values(state.agents)
    .filter((a) => agentTientSonTour(a) || a.attendReponse)
    .map((a) => a.id)
    .sort()
    .join(',');
  React.useEffect(() => {
    if (!open || projectId) return;
    let vivant = true;
    client
      .call<{ projets: LigneProjetMarketing[]; jours?: string[] }>({ type: 'marketing.lister' })
      .then((r) => vivant && setVue({ projets: r.projets, jours: r.jours ?? [] }))
      .catch(() => vivant && setVue((v) => v ?? { projets: [], jours: [] }));
    return () => {
      vivant = false;
    };
  }, [open, projectId, versionMarketing, agentsAuTravail]);

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      {projectId ? (
        <EspaceDuProjet key={projectId} projectId={projectId} ongletInitial={ongletVoulu} onRetour={() => onVise?.(null)}
          onChangerProjet={(id, onglet) => {
            setOngletVoulu(onglet);
            onVise?.(id);
          }}
          onOuvrirCarte={onOuvrirCarte}
        />
      ) : (
        <>
          <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
            <Megaphone className="h-3.5 w-3.5 shrink-0 text-accent" />
            <DialogTitle className="min-w-0 flex-1 truncate">{t('Marketing')}</DialogTitle>
            <ActionsEntete
              info={{
                titre: t('Marketing'),
                contenu: (
                  <>
                    <p>
                      {t(
                        'Chaque projet a son agent marketing. Il comprend le produit, rédige ce qui sert à le vendre, et mesure ce que chaque publication rapporte. Rien ne part sans votre accord.',
                      )}
                    </p>
                    <p>{t('Le tableau de bord réunit tous les projets : les visites des quatre dernières semaines, ce qui attend votre validation, et l’avancement de chacun.')}</p>
                  </>
                ),
              }}
            />
          </header>
          <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
            {vue === null ? (
              <SilhouetteMarketing />
            ) : !vue.projets.length ? (
              <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucun projet actif.')}</p>
            ) : (
              <TableauDeBordMarketing
                projets={vue.projets}
                jours={vue.jours}
                onOuvrir={(id, onglet) => {
                  setOngletVoulu(onglet);
                  onVise?.(id);
                }}
              />
            )}
          </ZoneDefilement>
        </>
      )}
    </Drawer>
  );
}

/**
 * LE TABLEAU DE BORD GLOBAL, à l'ouverture de l'outil : l'état de santé de
 * tous les projets d'un coup d'œil — les chiffres clés, la courbe des visites
 * de tous les projets, la répartition des contenus par étape —, puis une ligne
 * par projet. Tout vient de `marketing.lister` : UNE lecture pour tous les
 * projets, jamais les statistiques complètes de chacun.
 *
 * DEMANDE DU 27/09/2026 : les chiffres en haut sur toute la largeur ; dessous,
 * sur ordinateur, les tableaux Actifs et Inactifs à gauche et les travaux de
 * l'atelier en cours à DROITE, chaque colonne avec son propre défilement ; sur
 * téléphone, une bande qui défile de côté au-dessus des « Projets actifs » ; un clic ouvre le projet sur « Contenus ».
 * Un projet dont le suivi est coupé (`actif === false`) passe dans « Projets
 * inactifs », en bas, et sort des chiffres, de la courbe et de la répartition.
 */
function TableauDeBordMarketing({
  projets: tous,
  jours,
  onOuvrir,
}: {
  projets: LigneProjetMarketing[];
  jours: string[];
  onOuvrir: (projectId: string, onglet?: Onglet) => void;
}) {
  const state = useApp();
  const { actifs: projets, inactifs } = separerProjetsActifs(tous);
  const somme = (f: (p: LigneProjetMarketing) => number) => projets.reduce((s, p) => s + f(p), 0);
  const visitesParJour = jours.map((jour, i) => ({ jour, valeur: somme((p) => p.visites[i] ?? 0) }));
  const visites = somme((p) => p.visites.reduce((a, b) => a + b, 0));
  const brouillons = somme((p) => p.brouillons);
  const aValider = somme((p) => p.aValider);
  const programmes = somme((p) => p.programmes);
  const publies = somme((p) => p.publies);
  const suivis = projets.filter((p) => p.aUnAgent).length;
  const auTravail = projets.filter((p) => projetAuTravail(p, state)).length;
  const travaux = projets.flatMap((p) => (p.enCours ?? []).map((x) => ({ ...x, projectId: p.projectId, nomProjet: p.nom })));
  const tuiles: { cle: string; libelle: string; valeur: string; detail?: string }[] = [
    { cle: 'projets', libelle: t('Projets suivis'), valeur: `${suivis}/${projets.length}`, detail: auTravail ? t('{n} au travail', { n: auTravail }) : undefined },
    { cle: 'visites', libelle: t('Visites, 4 semaines'), valeur: visites.toLocaleString(formatRegional()) },
    { cle: 'brouillons', libelle: t('Brouillons'), valeur: brouillons.toLocaleString(formatRegional()) },
    { cle: 'a-valider', libelle: t('À valider'), valeur: aValider.toLocaleString(formatRegional()) },
    { cle: 'publies', libelle: t('Publiés'), valeur: publies.toLocaleString(formatRegional()) },
  ];
  const ouvrirTravail = (projectId: string) => onOuvrir(projectId, 'contenus');
  return (
    <div className="flex min-w-0 flex-col gap-3 md:h-full md:min-h-[480px]" data-marketing-tableau-de-bord={tous.length}>
      <div className="flex min-w-0 shrink-0 flex-col gap-3" data-marketing-chiffres>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {tuiles.map((x) => (
            <div key={x.cle} className="flex min-w-0 flex-col gap-0.5 rounded-md bg-bloc px-3 py-2" data-marketing-chiffre={x.cle}>
              <span className="truncate text-[12px] text-faint">{x.libelle}</span>
              <span className="text-[18px] font-medium text-text">{x.valeur}</span>
              {x.detail ? <span className="truncate text-[11.5px] text-en-cours">{x.detail}</span> : null}
            </div>
          ))}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-[2fr_1fr]">
          {visitesParJour.length ? <CourbeParJour cle="visites-globales" titre={t('Visites par jour, tous projets')} points={visitesParJour} /> : null}
          <Repartition
            cle="etapes"
            titre={t('Contenus par étape')}
            lignes={([[t('Brouillons'), brouillons], [t('À valider'), aValider], [t('Programmés'), programmes], [t('Publiés'), publies]] as [string, number][]).filter(([, n]) => n > 0)}
          />
        </div>
      </div>
      {/* SOUS LES CHIFFRES, DEUX COLONNES dès `md` (demande du 27/09/2026) :
          les tableaux à gauche, les cartes « En cours » à droite, chacune avec
          son propre défilement. Sur téléphone, une seule colonne, et la bande
          « En cours » au-dessus des « Projets actifs ». */}
      <div className="flex min-w-0 flex-col gap-3 md:grid md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_260px]" data-marketing-colonnes>
        <ZoneDefilement fond="hsl(var(--surface))" classeEnveloppe="min-w-0" data-marketing-colonne-projets>
          <div className="flex min-w-0 flex-col gap-3">
            <BandeEnCours travaux={travaux} onOuvrir={ouvrirTravail} />
            <TableauDesProjets
              groupe="actifs"
              titre={t('Projets actifs')}
              vide={t('Aucun projet suivi : rallumez le suivi marketing depuis la page d’un projet.')}
              cleReglage={CLE_REGLAGE_TABLEAU}
              projets={projets}
              onOuvrir={onOuvrir}
            />
            {inactifs.length ? (
              <TableauDesProjets
                groupe="inactifs"
                titre={t('Projets inactifs')}
                cleReglage={CLE_REGLAGE_TABLEAU_INACTIFS}
                projets={inactifs}
                onOuvrir={onOuvrir}
              />
            ) : null}
          </div>
        </ZoneDefilement>
        <ColonneEnCours travaux={travaux} onOuvrir={ouvrirTravail} />
      </div>
    </div>
  );
}

type TravailAffiche = TravailMarketingEnCours & { projectId: string; nomProjet: string };

/** L'état d'un travail en cours, suivi EN DIRECT sur son agent (même lecture que les cartes de l'onglet Contenus). */
function etatDuTravail(travail: TravailAffiche, state: ReturnType<typeof useApp>) {
  const agent = travail.agentId ? state.agents[travail.agentId] : undefined;
  return etatDeCarte({ column: travail.colonne } as Card, agent);
}

/** UN TRAVAIL EN COURS, en petite carte : le projet, le titre, l'état. Un clic ouvre le projet sur « Contenus ». */
function TuileEnCours({ travail, onOuvrir, className }: { travail: TravailAffiche; onOuvrir: () => void; className?: string }) {
  const state = useApp();
  const etat = etatDuTravail(travail, state);
  return (
    <button
      type="button"
      onClick={onOuvrir}
      className={cn('flex min-w-0 flex-col gap-1 rounded-md bg-bloc px-3 py-2 text-left hover:bg-raised focus-visible:bg-raised focus-visible:outline-none', className)}
      data-marketing-en-cours-carte={travail.cardId}
      data-marketing-en-cours-projet={travail.projectId}
    >
      <span className="truncate text-[11.5px] text-faint">{travail.nomProjet}</span>
      <span className="truncate text-[13px] text-text">{travail.titre}</span>
      <span className={cn('flex min-w-0 items-center gap-1 text-[11.5px]', etat.classe)}>
        {etat.tourne ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
        <span className="truncate">{etat.libelle}</span>
      </span>
    </button>
  );
}

/** LA COLONNE « EN COURS », à droite des tableaux et sous les chiffres, sur ordinateur seulement ; elle défile seule. */
function ColonneEnCours({ travaux, onOuvrir }: { travaux: TravailAffiche[]; onOuvrir: (projectId: string) => void }) {
  return (
    <aside className="hidden min-h-0 min-w-0 flex-col gap-1 md:flex" data-marketing-en-cours={travaux.length}>
      <span className="flex min-h-6 shrink-0 items-center gap-2 px-1 text-[12.5px] font-medium text-text">
        {t('En cours')}
        {travaux.length ? <span className="font-normal text-faint">{travaux.length}</span> : null}
      </span>
      <ZoneDefilement fond="hsl(var(--surface))">
        {travaux.length ? (
          <div className="flex flex-col gap-1">
            {travaux.map((x) => (
              <TuileEnCours key={x.cardId} travail={x} onOuvrir={() => onOuvrir(x.projectId)} />
            ))}
          </div>
        ) : (
          <p className="px-1 text-[12px] text-faint" data-marketing-en-cours-vide>
            {t('Aucun travail en cours.')}
          </p>
        )}
      </ZoneDefilement>
    </aside>
  );
}

/**
 * LA MÊME LISTE SUR TÉLÉPHONE : une bande de petites cartes qui défile de
 * côté, juste au-dessus des « Projets actifs ». Rien quand rien ne tourne —
 * sur un petit écran, la place compte.
 */
function BandeEnCours({ travaux, onOuvrir }: { travaux: TravailAffiche[]; onOuvrir: (projectId: string) => void }) {
  if (!travaux.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1 md:hidden" data-marketing-en-cours-bande={travaux.length}>
      <span className="px-1 text-[12.5px] font-medium text-text">{t('En cours')}</span>
      <ZoneDefilement axe="horizontal" className="snap-x">
        <div className="flex gap-1.5 pb-1">
          {travaux.map((x) => (
            <TuileEnCours key={x.cardId} travail={x} onOuvrir={() => onOuvrir(x.projectId)} className="w-[200px] shrink-0 snap-start" />
          ))}
        </div>
      </ZoneDefilement>
    </div>
  );
}

/** Quelque chose travaille-t-il dans ce projet ? Son agent attitré, ou l'agent d'une de ses cartes en cours. */
function projetAuTravail(p: LigneProjetMarketing, state: ReturnType<typeof useApp>): boolean {
  if (etatDeLAgent(p, state) === 'travail') return true;
  return (p.enCours ?? []).some((x) => {
    const agent = x.agentId ? state.agents[x.agentId] : undefined;
    return !!agent && agentTientSonTour(agent);
  });
}

type EtatLigneAgent = 'travail' | 'question' | 'repos' | 'aucun';

/**
 * OÙ EN EST L'AGENT D'UN PROJET, VU DE LA LISTE : suivi EN DIRECT sur l'agent
 * quand l'écran le connaît (son tour vivant, sa question), sinon l'état lu par
 * le démon à l'ouverture. Même prédicat que partout (`agentTientSonTour`).
 */
function etatDeLAgent(ligne: LigneProjetMarketing, state: ReturnType<typeof useApp>): EtatLigneAgent {
  if (!ligne.agentId) return 'aucun';
  const agent = state.agents[ligne.agentId];
  const questions = decisionsQuiAlertent(state.decisions).some((d) => d.agentId === ligne.agentId);
  if (questions || (agent ? !!agent.attendReponse : ligne.attendReponse)) return 'question';
  if (agent ? agentTientSonTour(agent) : ligne.travaille) return 'travail';
  return 'repos';
}

/** Le stockage local qui garde le tri et les filtres du tableau d'une visite à l'autre. */
const CLE_REGLAGE_TABLEAU = 'beluga.marketing.tableau-projets';
/** Le second tableau, « Projets inactifs », garde son propre tri et ses propres filtres. */
const CLE_REGLAGE_TABLEAU_INACTIFS = 'beluga.marketing.tableau-projets-inactifs';

function lireReglageTableau(cle: string): ReglageTableauMarketing {
  try {
    const brut = window.localStorage.getItem(cle);
    return brut ? reglageTableauValide(JSON.parse(brut)) : REGLAGE_TABLEAU_VIDE;
  } catch {
    return REGLAGE_TABLEAU_VIDE;
  }
}

/** Le texte de la colonne « Prochaine étape », tel qu'affiché. */
function texteDeLEtape(etat: EtatLigneAgent, ligne: LigneProjetMarketing): string {
  if (etat === 'travail') return t('L’agent travaille');
  if (etat === 'question') return t('Une question vous attend');
  return ligne.prochaineAction ? t(ligne.prochaineAction) : '';
}

function etapeDeLaLigne(etat: EtatLigneAgent, ligne: LigneProjetMarketing): EtapeLigneMarketing {
  if (etat === 'question' || etat === 'travail') return etat;
  return ligne.prochaineAction ? 'action' : 'rien';
}

type LigneAffichee = LigneTableauMarketing & { source: LigneProjetMarketing; etat: EtatLigneAgent; auTravail: boolean };

/**
 * LES PROJETS EN VRAI TABLEAU : une colonne par information, alignée d'une
 * ligne à l'autre. Un clic sur l'entête trie (puis inverse, puis rend l'ordre
 * par défaut), l'entonnoir de chaque entête ouvre son filtre. Tri et filtres
 * sont gardés d'une visite à l'autre ; la règle est partagée et testée
 * (`shared/src/tableau-marketing.ts`). Sur téléphone, le tableau défile de
 * gauche à droite, le nom du projet restant collé au bord.
 */
function TableauDesProjets({
  groupe,
  titre,
  vide,
  cleReglage,
  projets,
  onOuvrir,
}: {
  groupe: 'actifs' | 'inactifs';
  titre: string;
  /** Ce que dit le tableau quand il n'a aucun projet (pas de filtre en cause). */
  vide?: string;
  cleReglage: string;
  projets: LigneProjetMarketing[];
  onOuvrir: (projectId: string) => void;
}) {
  const state = useApp();
  const [reglage, setReglage] = React.useState<ReglageTableauMarketing>(() => lireReglageTableau(cleReglage));
  React.useEffect(() => {
    try {
      window.localStorage.setItem(cleReglage, JSON.stringify(reglage));
    } catch {
      /* stockage plein ou fermé : le réglage vaut pour cette visite seulement */
    }
  }, [reglage, cleReglage]);

  const lignes: LigneAffichee[] = projets.map((p) => {
    const etat = etatDeLAgent(p, state);
    return {
      projectId: p.projectId,
      nom: p.nom,
      avancement: p.avancement,
      etape: etapeDeLaLigne(etat, p),
      texteEtape: texteDeLEtape(etat, p),
      aValider: p.aValider,
      nature: p.nature,
      visites: p.visites.reduce((a, b) => a + b, 0),
      source: p,
      etat,
      auTravail: projetAuTravail(p, state),
    };
  });
  const affichees = lignesDuTableauMarketing(lignes, reglage);
  const natures = [...new Set(projets.map((p) => p.nature ?? 'aucune'))];
  const filtrer = (filtres: FiltresTableauMarketing) => setReglage((r) => ({ ...r, filtres }));
  const unFiltre = Object.keys(reglage.filtres).length > 0;

  // LE NOM À GAUCHE, TOUT LE RESTE SERRÉ À DROITE CONTRE LE CHEVRON : le
  // projet prend la place libre, chaque autre colonne a sa largeur fixe
  // (`table-fixed`) et s'aligne à droite, dans l'ordre voulu par l'utilisateur.
  // La somme des largeurs (+ 150 px de nom) fixe le `min-w` de la table.
  const colonnes: { cle: ColonneTableauMarketing; libelle: string; classe: string }[] = [
    { cle: 'projet', libelle: t('Projet'), classe: 'sticky left-0 z-10 bg-bloc' },
    { cle: 'etape', libelle: t('Prochaine étape'), classe: 'w-[240px]' },
    { cle: 'type', libelle: t('Type'), classe: 'w-[150px]' },
    { cle: 'aValider', libelle: t('À valider'), classe: 'w-[120px]' },
    { cle: 'avancement', libelle: t('Avancement'), classe: 'w-[140px]' },
    { cle: 'visites', libelle: t('Visites'), classe: 'w-[150px]' },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-1" data-marketing-groupe={groupe}>
      <div className="flex min-h-6 items-center gap-2 px-1">
        <span className="text-[12.5px] font-medium text-text">{titre}</span>
        {unFiltre ? (
          <>
            <span className="text-[12px] text-faint" data-marketing-lignes-visibles={affichees.length}>
              {t('{n} sur {total}', { n: affichees.length, total: projets.length })}
            </span>
            <button
              type="button"
              className="ml-auto flex items-center gap-1 text-[12px] text-muted hover:text-text"
              onClick={() => filtrer({})}
              data-marketing-effacer-filtres
            >
              <X className="h-3 w-3" />
              {t('Effacer les filtres')}
            </button>
          </>
        ) : null}
      </div>
      <ZoneDefilement axe="horizontal" fond="hsl(var(--bloc))" className="rounded-md bg-bloc">
        <table className="w-full min-w-[1000px] table-fixed border-collapse text-left" data-marketing-liste={projets.length} data-marketing-tableau>
          <thead>
            <tr className="text-[12px] text-faint">
              {colonnes.map((c) => (
                <EnteteDeColonne
                  key={c.cle}
                  colonne={c.cle}
                  libelle={c.libelle}
                  className={c.classe}
                  aDroite={c.cle !== 'projet'}
                  tri={reglage.tri?.colonne === c.cle ? reglage.tri.sens : null}
                  onTrier={() => setReglage((r) => ({ ...r, tri: triSuivant(r.tri, c.cle) }))}
                  actif={filtreActif(reglage.filtres, c.cle)}
                  onEffacer={() => filtrer(sansFiltre(reglage.filtres, c.cle))}
                >
                  <FiltreDeColonne colonne={c.cle} filtres={reglage.filtres} natures={natures} onChange={filtrer} />
                </EnteteDeColonne>
              ))}
              <th aria-hidden className="w-9" />
            </tr>
          </thead>
          <tbody>
            {affichees.map((l) => (
              <LigneProjet key={l.projectId} ligne={l} onOuvrir={() => onOuvrir(l.projectId)} />
            ))}
            {!affichees.length ? (
              <tr>
                <td colSpan={colonnes.length + 1} className="px-3 py-4 text-[12.5px] text-faint" data-marketing-aucune-ligne>
                  {!projets.length && vide ? vide : t('Aucun projet ne correspond à ces filtres.')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </ZoneDefilement>
    </div>
  );
}

function EnteteDeColonne({
  colonne,
  libelle,
  className,
  aDroite,
  tri,
  onTrier,
  actif,
  onEffacer,
  children,
}: {
  colonne: ColonneTableauMarketing;
  libelle: string;
  className?: string;
  aDroite?: boolean;
  tri: 'asc' | 'desc' | null;
  onTrier: () => void;
  actif: boolean;
  onEffacer: () => void;
  children: React.ReactNode;
}) {
  const Fleche = tri === 'asc' ? ArrowUp : tri === 'desc' ? ArrowDown : null;
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap px-3 pb-1.5 pt-2 font-medium', className)}
      data-marketing-colonne={colonne}
      data-marketing-tri={tri ?? undefined}
      aria-sort={tri === 'asc' ? 'ascending' : tri === 'desc' ? 'descending' : 'none'}
    >
      <span className={cn('flex items-center gap-1', aDroite && 'justify-end')}>
        <button
          type="button"
          onClick={onTrier}
          className={cn('flex min-w-0 items-center gap-1 hover:text-text', tri && 'text-text')}
          data-marketing-trier={colonne}
          title={t('Trier par cette colonne')}
        >
          <span className="truncate">{libelle}</span>
          {Fleche ? <Fleche className="h-3 w-3 shrink-0" /> : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-raised hover:text-text', actif ? 'text-accent' : 'text-faint')}
              data-marketing-filtrer={colonne}
              data-marketing-filtre-actif={actif ? colonne : undefined}
              aria-label="Filtrer cette colonne"
              title={t('Filtrer cette colonne')}
            >
              <Filter className={cn('h-3 w-3', actif && 'fill-current')} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={aDroite ? 'end' : 'start'} className="min-w-[220px]" data-marketing-menu-filtre={colonne}>
            {children}
            {actif ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onEffacer} data-marketing-effacer-filtre={colonne}>
                  <X className="h-3.5 w-3.5" />
                  {t('Effacer ce filtre')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </th>
  );
}

/** Une case à cocher du menu de filtre : le menu reste ouvert pour en cocher plusieurs. */
function ChoixDeFiltre({ coche, onBascule, children, ...rest }: { coche: boolean; onBascule: () => void; children: React.ReactNode } & Record<`data-${string}`, string>) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onBascule();
      }}
      {...rest}
    >
      <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border', coche ? 'border-accent bg-accent text-accent-fg' : 'border-faint')}>
        {coche ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 truncate text-[13px]">{children}</span>
    </DropdownMenuItem>
  );
}

function basculerDans<T>(liste: T[] | undefined, valeur: T): T[] | undefined {
  const l = liste ?? [];
  const suivante = l.includes(valeur) ? l.filter((x) => x !== valeur) : [...l, valeur];
  return suivante.length ? suivante : undefined;
}

function FiltreDeColonne({
  colonne,
  filtres,
  natures,
  onChange,
}: {
  colonne: ColonneTableauMarketing;
  filtres: FiltresTableauMarketing;
  natures: string[];
  onChange: (filtres: FiltresTableauMarketing) => void;
}) {
  const poser = <K extends keyof FiltresTableauMarketing>(cle: K, valeur: FiltresTableauMarketing[K] | undefined) => {
    const copie = { ...filtres };
    if (valeur === undefined || valeur === false || valeur === '') delete copie[cle];
    else copie[cle] = valeur;
    onChange(copie);
  };
  if (colonne === 'projet') {
    return (
      <div className="p-1">
        <Input
          autoFocus
          value={filtres.nom ?? ''}
          placeholder={t('Chercher un projet…')}
          // Le menu lit les lettres pour sauter d'une entrée à l'autre : ici,
          // elles appartiennent au champ.
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => poser('nom', event.target.value || undefined)}
          data-marketing-filtre-nom
        />
      </div>
    );
  }
  if (colonne === 'avancement') {
    const libelles: Record<TrancheAvancement, string> = { debut: t('Moins de 50 %'), milieu: t('De 50 à 99 %'), fini: t('Terminé') };
    return (
      <>
        {TRANCHES_AVANCEMENT.map((tranche) => (
          <ChoixDeFiltre key={tranche} coche={!!filtres.avancement?.includes(tranche)} onBascule={() => poser('avancement', basculerDans(filtres.avancement, tranche))} data-marketing-choix-filtre={tranche}>
            {libelles[tranche]}
          </ChoixDeFiltre>
        ))}
      </>
    );
  }
  if (colonne === 'etape') {
    const choix: [EtapeLigneMarketing, string][] = [
      ['question', t('Une question vous attend')],
      ['travail', t('L’agent travaille')],
      ['action', t('Une prochaine étape')],
      ['rien', t('Rien à faire')],
    ];
    return (
      <>
        {choix.map(([cle, libelle]) => (
          <ChoixDeFiltre key={cle} coche={!!filtres.etape?.includes(cle)} onBascule={() => poser('etape', basculerDans(filtres.etape, cle))} data-marketing-choix-filtre={cle}>
            {libelle}
          </ChoixDeFiltre>
        ))}
      </>
    );
  }
  if (colonne === 'aValider') {
    return (
      <ChoixDeFiltre coche={!!filtres.aValider} onBascule={() => poser('aValider', !filtres.aValider)} data-marketing-choix-filtre="a-valider">
        {t('Seulement ce qui attend votre validation')}
      </ChoixDeFiltre>
    );
  }
  if (colonne === 'type') {
    return (
      <>
        {natures.map((n) => (
          <ChoixDeFiltre key={n} coche={!!filtres.types?.includes(n)} onBascule={() => poser('types', basculerDans(filtres.types, n))} data-marketing-choix-filtre={n}>
            {n === 'aucune' ? t('À découvrir') : libelleNature(n)}
          </ChoixDeFiltre>
        ))}
      </>
    );
  }
  return (
    <ChoixDeFiltre coche={!!filtres.visites} onBascule={() => poser('visites', !filtres.visites)} data-marketing-choix-filtre="visites">
      {t('Seulement les projets visités')}
    </ChoixDeFiltre>
  );
}

/**
 * UNE LIGNE DU TABLEAU : toute la ligne ouvre l'espace marketing du projet.
 * Ce n'est pas un `button` — une ligne de tableau n'en est pas un —, mais elle
 * en a le rôle, le focus et les touches.
 */
function LigneProjet({ ligne, onOuvrir }: { ligne: LigneAffichee; onOuvrir: () => void }) {
  const { source, etat } = ligne;
  const projet = useApp().projects.find((p) => p.id === ligne.projectId);
  return (
    <tr
      role="button"
      tabIndex={0}
      data-marketing-projet={ligne.projectId}
      data-marketing-agent-etat={etat}
      onClick={onOuvrir}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOuvrir();
      }}
      className="group cursor-pointer border-t border-border/60 text-[12.5px] hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
    >
      <td className="sticky left-0 z-10 bg-bloc px-3 py-2.5 group-hover:bg-raised group-focus-visible:bg-raised" data-marketing-cellule="projet">
        <span className="flex min-w-0 items-center gap-1.5">
          <PastilleProjet project={projet ?? { name: ligne.nom, favicon: undefined }} />
          <span className="truncate text-[13.5px] text-text">{ligne.nom}</span>
          {ligne.auTravail ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-en-cours" aria-label="Agent au travail" data-marketing-ligne-travaille />
          ) : null}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right" data-marketing-cellule="etape" title={ligne.texteEtape || undefined}>
        {etat === 'travail' ? (
          <span className="flex min-w-0 items-center justify-end gap-1 text-en-cours" data-marketing-agent-travaille>
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            <span className="truncate">{ligne.texteEtape}</span>
          </span>
        ) : etat === 'question' ? (
          <span className="flex min-w-0 items-center justify-end gap-1 text-warning">
            <MessageCircleQuestion className="h-3 w-3 shrink-0" />
            <span className="truncate">{ligne.texteEtape}</span>
          </span>
        ) : (
          <span className="block truncate text-faint">{ligne.texteEtape || '—'}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right" data-marketing-cellule="type">
        <span className="flex min-w-0 justify-end">
          <Badge tone={ligne.avancement >= 100 ? 'success' : 'neutral'} className="min-w-0 max-w-full">
            <span className="truncate">{source.nature ? libelleNature(source.nature) : t('À découvrir')}</span>
          </Badge>
        </span>
      </td>
      <td className="px-3 py-2.5 text-right" data-marketing-cellule="a-valider">
        {ligne.aValider ? <Badge tone="warning">{ligne.aValider}</Badge> : <span className="text-faint">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right" data-marketing-cellule="avancement">
        <span className="flex items-center justify-end gap-2 text-faint">
          <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-faint/20">
            <span
              className={cn('block h-full rounded-full', ligne.avancement >= 100 ? 'bg-termine' : 'bg-en-cours')}
              style={{ width: `${ligne.avancement}%` }}
            />
          </span>
          <span className="w-9 shrink-0 text-right tabular-nums">{ligne.avancement} %</span>
        </span>
      </td>
      <td className="px-3 py-2.5 text-right" data-marketing-cellule="visites" title={t('Visites des quatre dernières semaines')}>
        <span className="flex items-center justify-end gap-2">
          <MiniCourbe valeurs={source.visites} />
          <span className="shrink-0 tabular-nums text-faint">{ligne.visites.toLocaleString(formatRegional())}</span>
          {/* UN SITE DONT LE CODE MANQUE OU EST FAUX LE DIT, dans la colonne
              même où ses visites devraient se compter — par une icône seule,
              son libellé au survol. La place de l'icône est gardée sur chaque
              ligne pour que les nombres restent alignés d'une ligne à l'autre. */}
          {diagnosticACorriger(source.diagnosticSuivi) || source.diagnosticSuivi === 'injoignable' ? (
            <span
              className="flex w-3 shrink-0 items-center text-warning"
              data-marketing-diagnostic-suivi={source.diagnosticSuivi ?? undefined}
              title={t(LIBELLE_DIAGNOSTIC_SUIVI[source.diagnosticSuivi!])}
              aria-label={`Diagnostic du suivi : ${source.diagnosticSuivi}`}
              role="img"
            >
              <TriangleAlert className="h-3 w-3 shrink-0" />
            </span>
          ) : (
            <span aria-hidden className="w-3 shrink-0" />
          )}
        </span>
      </td>
      <td className="py-2.5 pr-3" aria-hidden>
        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-faint" />
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* L'espace d'un projet                                                 */
/* ------------------------------------------------------------------ */

/* L'onglet « Statistiques » est devenu un service à part (27/09/2026) : un
   onglet mémorisé ou demandé qui porterait encore ce nom retombe sur le défaut. */
type Onglet = 'positionnement' | 'contenus' | 'calendrier' | 'canaux';
const ONGLETS: readonly Onglet[] = ['positionnement', 'contenus', 'calendrier', 'canaux'];

/**
 * L'AGENT ATTITRÉ, VU DE L'ÉCRAN : son état (pour le bouton unique) et le
 * geste qui le lance. L'état se lit sur l'agent lui-même — tour vivant,
 * question posée, liste de tâches —, jamais deviné.
 */
function useAgentMarketing(projectId: string, espace: EspaceMarketing | null | undefined) {
  const state = useApp();
  const [depart, setDepart] = React.useState<string | null>(null);
  const [envoi, setEnvoi] = React.useState(false);
  const agentId = espace?.agentId ?? depart;
  const agent: Agent | null = agentId ? (state.agents[agentId] ?? null) : null;

  /*
   * L'AGENT EST REDEMANDÉ TANT QU'IL MANQUE. Un agent connu par son identifiant
   * mais absent de l'état (canal coupé puis rouvert au retour de l'appli au
   * premier plan, agents déchargés d'un projet qu'on ne consultait plus) ne
   * revenait jamais : le chat restait sur sa silhouette, sans fil ni champ
   * d'écriture. `chargerAgent` rend celui qu'on connaît déjà (et réclame son fil
   * s'il n'a jamais été demandé) ; sinon on retente trois fois, puis on le DIT
   * (`introuvable`) au lieu de laisser une silhouette éternelle. Le retour au
   * premier plan, la reconnexion et le bouton « Réessayer » relancent le tout.
   */
  const [introuvable, setIntrouvable] = React.useState(false);
  const [relance, setRelance] = React.useState(0);
  const dejaLa = !!agent;
  React.useEffect(() => {
    if (!agentId) return;
    let vivant = true;
    let minuteur: number | undefined;
    setIntrouvable(false);
    const essayer = async (n: number) => {
      const trouve = await client.chargerAgent(agentId);
      if (!vivant || trouve) return;
      if (n >= 2) setIntrouvable(true);
      else minuteur = window.setTimeout(() => void essayer(n + 1), 2000 * (n + 1));
    };
    void essayer(0);
    return () => {
      vivant = false;
      window.clearTimeout(minuteur);
    };
  }, [agentId, dejaLa, relance]);
  React.useEffect(() => {
    if (!agentId || dejaLa) return;
    const reprendre = () => {
      if (document.visibilityState === 'visible') setRelance((n) => n + 1);
    };
    document.addEventListener('visibilitychange', reprendre);
    window.addEventListener('online', reprendre);
    return () => {
      document.removeEventListener('visibilitychange', reprendre);
      window.removeEventListener('online', reprendre);
    };
  }, [agentId, dejaLa]);

  const questions = agentId ? decisionsQuiAlertent(state.decisions).filter((d) => d.agentId === agentId).length : 0;
  const travaille = envoi || (agent ? agentTientSonTour(agent) : false);
  const etat = etatDuBoutonMarketing({
    aUnAgent: !!agentId,
    travaille,
    attendReponse: !!agent?.attendReponse || questions > 0,
    aUnRapport: !!espace?.rapport,
  });

  const lancer = React.useCallback(
    async (geste: GesteAgentMarketing) => {
      setEnvoi(true);
      try {
        const r = await client.call<{ agentId: string }>({ type: 'marketing.assistant', projectId, geste });
        setDepart(r.agentId);
        void client.chargerAgent(r.agentId);
        return true;
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('L’agent n’a pas pu démarrer'));
        return false;
      } finally {
        setEnvoi(false);
      }
    },
    [projectId],
  );

  const recharger = React.useCallback(() => setRelance((n) => n + 1), []);

  return { agentId, agent, etat, travaille, questions, envoi, lancer, introuvable, recharger };
}

function EspaceDuProjet({
  projectId,
  ongletInitial,
  onRetour,
  onChangerProjet,
  onOuvrirCarte,
}: {
  projectId: string;
  /** L'onglet d'arrivée : « Calendrier » par défaut, « Contenus » depuis la colonne « En cours ». */
  ongletInitial?: Onglet;
  onRetour: () => void;
  /** Passe à un autre projet actif en gardant l'onglet ouvert. */
  onChangerProjet: (projectId: string, onglet: Onglet) => void;
  onOuvrirCarte?: (card: Card) => void;
}) {
  const state = useApp();
  const version = state.marketingVersions[projectId] ?? 0;
  const [donnees, setDonnees] = React.useState<EspaceComplet | null>(null);
  // Les chiffres complets vivent dans le service Statistiques : l'espace n'en lit que 30 jours.
  const jours = 30;
  const [onglet, setOnglet] = React.useState<Onglet>(ongletInitial && ONGLETS.includes(ongletInitial) ? ongletInitial : 'calendrier');
  const [contenuOuvert, setContenuOuvert] = React.useState<string | null>(null);
  const [creation, setCreation] = React.useState(false);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<EspaceComplet>({ type: 'marketing.espace', projectId, jours })
      .then((r) => vivant && setDonnees(r))
      .catch((err: any) => {
        if (!vivant) return;
        client.pushToast('error', err?.message ?? t('Espace marketing illisible'));
        onRetour();
      });
    return () => {
      vivant = false;
    };
  }, [projectId, version, jours]);

  /* LES PROJETS ACTIFS du sélecteur du titre : lus une fois à l'ouverture de
     l'espace (le tableau de bord, lui, ne se charge que hors d'un projet). */
  const [voisins, setVoisins] = React.useState<LigneProjetMarketing[]>([]);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ projets: LigneProjetMarketing[] }>({ type: 'marketing.lister' })
      .then((r) => vivant && setVoisins(separerProjetsActifs(r.projets).actifs))
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [version]);
  const projetsDeLApp = state.projects;
  const iconeDe = (id: string, nom: string) => <PastilleProjet project={projetsDeLApp.find((p) => p.id === id) ?? { name: nom, favicon: undefined }} />;
  const nomDuProjet = donnees?.nom ?? voisins.find((v) => v.projectId === projectId)?.nom ?? t('Marketing');

  const agent = useAgentMarketing(projectId, donnees?.espace);
  const [chatBrut, setChatBrut] = usePref<unknown>(cleChatMarketing(projectId), CHAT_FLOTTANT_DEFAUT);
  const chat = chatRetenu(chatBrut);
  const ouvrirChat = () => setChatBrut({ ...chat, ouvert: true });
  const contenu = donnees?.contenus.find((c) => c.id === contenuOuvert) ?? null;
  // Le voile n'attend que les DONNÉES de l'espace : avant elles, on ne sait pas
  // si le projet a déjà son agent, et un voile éphémère clignoterait.
  const voile = !!donnees && agent.etat === 'initialiser';

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Button variant="ghost" size="icon" aria-label="Tous les projets" title={t('Tous les projets')} onClick={onRetour} data-marketing-retour>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <SelecteurDeProjet
          id={projectId}
          nom={nomDuProjet}
          icone={iconeDe(projectId, nomDuProjet)}
          choix={voisins.map((v) => ({ id: v.projectId, nom: v.nom, icone: iconeDe(v.projectId, v.nom) }))}
          onChoisir={(id) => (id === projectId ? undefined : onChangerProjet(id, onglet))}
          repere="marketing"
          libelleFiltre={t('Filtrer les projets')}
          libelleVide={t('Aucun projet ne correspond.')}
        />
        {donnees ? <InterrupteurDeSuivi projectId={projectId} actif={donnees.espace?.actif !== false} /> : null}
        <ActionsEntete
          info={{
            titre: t('L’atelier marketing'),
            contenu: (
              <>
                <p>{t('L’agent marketing étudie le projet, puis rédige ce qui sert à le vendre. Vous relisez et validez : rien ne part sans vous.')}</p>
                <p>{t('L’agent est dans la bulle ronde en bas à droite : il y analyse chaque point, y rend son rapport, modifie le calendrier à votre demande, et vous lui répondez juste dessous pour le corriger.')}</p>
              </>
            ),
          }}
        />
      </header>

      {!donnees ? (
        <div className="px-2">
          <SilhouetteMarketing lignes={3} />
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col" data-marketing-zone-contenu>
        <Tabs
          value={onglet}
          onValueChange={(v) => setOnglet(v as Onglet)}
          className="flex min-h-0 flex-1 flex-col"
          aria-hidden={voile || undefined}
          {...(voile ? { inert: '' } : {})}
        >
          <div className="shrink-0 px-3 pb-2">
            <TabsList defilable>
              <TabsTrigger value="calendrier" data-marketing-onglet="calendrier">{t('Calendrier')}</TabsTrigger>
              <TabsTrigger value="contenus" data-marketing-onglet="contenus">{t('Contenus')}</TabsTrigger>
              <TabsTrigger value="canaux" data-marketing-onglet="canaux">{t('Canaux')}</TabsTrigger>
              <TabsTrigger value="positionnement" data-marketing-onglet="positionnement">{t('Positionnement')}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="calendrier" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletCalendrier projectId={projectId} contenus={donnees.contenus} actions={donnees.actions ?? []} onOuvrir={setContenuOuvert} onAgent={ouvrirChat} />
          </TabsContent>
          <TabsContent value="contenus" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletContenus
              contenus={donnees.contenus}
              cartes={donnees.cartes ?? []}
              onOuvrirCarte={onOuvrirCarte}
              onOuvrir={setContenuOuvert}
              aUnAgent={agent.etat !== 'initialiser'}
              auTravail={agent.etat === 'travail' || agent.etat === 'question'}
              suiteEnvoyee={agent.envoi}
              onAgent={ouvrirChat}
              onSuite={() => void agent.lancer('suite')}
              onEcrire={() => setCreation(true)}
            />
          </TabsContent>
          <TabsContent value="canaux" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletCanaux projectId={projectId} donnees={donnees} onAgent={ouvrirChat} />
          </TabsContent>
          <TabsContent value="positionnement" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletPositionnement projectId={projectId} fiche={donnees.espace?.fiche ?? {}} />
          </TabsContent>
        </Tabs>
        {voile ? (
          <div
            data-marketing-voile
            className="absolute inset-0 z-10 flex items-center justify-center bg-bg/40 px-6 backdrop-blur-md"
          >
            <div className="flex max-w-[340px] flex-col items-center gap-3 text-center">
              <Sparkles className="h-5 w-5 text-accent" />
              <p className="text-[15px] font-medium leading-snug text-text">{t('Ce projet n’est pas encore initialisé')}</p>
              <p className="text-[13px] leading-relaxed text-muted">
                {t('L’agent marketing va vous poser quelques questions, puis établir la liste de tâches à suivre pour ce projet.')}
              </p>
              <Button onClick={ouvrirChat} data-marketing-voile-bouton>
                <Bot className="h-3.5 w-3.5" />
                {t('Ouvrir l’agent')}
              </Button>
            </div>
          </div>
        ) : null}
        </div>
      )}

      {donnees ? <ChatFlottantMarketing donnees={donnees} projectId={projectId} suivi={agent} chat={chat} onChat={setChatBrut} /> : null}
      <TiroirContenu contenu={contenu} adresseLiens={donnees?.adresseLiens ?? ''} onClose={() => setContenuOuvert(null)} />
      <TiroirNouveauContenu ouvert={creation} projectId={projectId} onClose={() => setCreation(false)} />
    </>
  );
}

/**
 * LE BOUTON UNIQUE DE L'AGENT, pied pleine largeur du chat flottant. Il part en
 * requête dès le clic (« Initialiser »), puis suit l'agent : orange pendant le
 * travail, avec le compte « n/N » de sa liste de tâches ; une question
 * l'allume (elle se répond dans la conversation, juste au-dessus) ;
 * « Rapport » une fois rendu, qui ouvre le rapport enregistré en lecture.
 */
function BoutonAgent({ etat, agent, envoi, onClick }: { etat: EtatBoutonMarketing; agent: Agent | null; envoi: boolean; onClick: () => void }) {
  const compte = agent?.todos && agent.todos.total > 0 ? `${agent.todos.done}/${agent.todos.total}` : null;
  const commun = 'min-w-0 flex-1';
  if (etat === 'initialiser') {
    return (
      <Button size="pied" className={commun} disabled={envoi} onClick={onClick} data-marketing-bouton-agent="initialiser">
        {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {envoi ? t('Démarrage…') : t('Initialiser le rapport de l’agent')}
      </Button>
    );
  }
  if (etat === 'travail') {
    const part = agent?.todos && agent.todos.total > 0 ? Math.round((agent.todos.done / agent.todos.total) * 100) : null;
    return (
      <Button size="pied" variant="subtle" className={cn(commun, 'relative cursor-default overflow-hidden')} data-marketing-bouton-agent="travail">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-en-cours" />
        {t('Analyse en cours')}
        {compte ? <span className="text-faint">{compte}</span> : null}
        {part !== null ? <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-en-cours" style={{ width: `${part}%` }} /> : null}
      </Button>
    );
  }
  if (etat === 'question') {
    return (
      <Button size="pied" variant="subtle" className={cn(commun, 'cursor-default text-warning')} data-marketing-bouton-agent="question">
        <MessageCircleQuestion className="h-3.5 w-3.5" />
        {t('Une question vous attend, juste au-dessus')}
      </Button>
    );
  }
  if (etat === 'rapport') {
    return (
      <Button size="pied" className={commun} onClick={onClick} data-marketing-bouton-agent="rapport">
        <FileText className="h-3.5 w-3.5" />
        {t('Rapport')}
      </Button>
    );
  }
  return (
    <Button size="pied" className={commun} disabled={envoi} onClick={onClick} data-marketing-bouton-agent="conversation">
      {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
      {t('Reprendre l’analyse')}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Le chat flottant de l'agent                                          */
/* ------------------------------------------------------------------ */

function lireFenetre(): FenetreChat {
  return typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight };
}

/**
 * L'AGENT, EN CHAT FLOTTANT (demande du 28/09/2026) : il remplace l'ancien
 * onglet « Guide ». Un bouton rond en bas à droite l'ouvre et le ferme ; la
 * fenêtre se déplace par sa barre du haut et se redimensionne par son coin
 * haut gauche. Sa place, sa taille et son état ouvert/fermé se retiennent PAR
 * PROJET (préférence serveur, `cleChatMarketing`) — les règles de bornage sont
 * pures, dans `shared/src/chat-flottant.ts`. Sur téléphone, la fenêtre prend
 * presque tout l'écran, au-dessus du bouton rond. Posé sur `document.body` :
 * il reste au-dessus des onglets sans jamais cacher une fenêtre modale.
 */
function ChatFlottantMarketing({
  donnees,
  projectId,
  suivi,
  chat,
  onChat,
}: {
  donnees: EspaceComplet;
  projectId: string;
  suivi: ReturnType<typeof useAgentMarketing>;
  chat: ChatFlottant;
  onChat: (etat: ChatFlottant) => void;
}) {
  const { guide } = donnees;
  const espace = donnees.espace;
  const config = espace?.configuration;
  const [points, setPoints] = React.useState(false);
  const [rapport, setRapport] = React.useState(false);
  const [confirmer, setConfirmer] = React.useState(false);
  const { agent, agentId, etat } = suivi;

  const [fenetre, setFenetre] = React.useState<FenetreChat>(lireFenetre);
  React.useEffect(() => {
    const suivre = () => setFenetre(lireFenetre());
    window.addEventListener('resize', suivre);
    return () => window.removeEventListener('resize', suivre);
  }, []);

  // Pendant un geste, la place vit ici ; elle n'est rangée qu'au relâchement.
  const [geste, setGeste] = React.useState<ChatFlottant | null>(null);
  const telephone = estTelephoneChat(fenetre);
  // Écran bas (clavier ouvert) : le chat prend toute la fenêtre et rend au fil la
  // place de son décor — barre d'avancement et pied. Sans agent, le pied reste :
  // c'est lui qui l'initialise.
  const ecranBas = estTelephoneBas(fenetre);
  const decorMasque = ecranBas && etat !== 'initialiser';
  const vu = chatVisible(geste ?? chat, fenetre);

  const commencer = (mode: 'deplacer' | 'redimensionner') => (event: React.PointerEvent) => {
    if (event.button !== 0 || telephone) return;
    event.preventDefault();
    const depart = vu;
    const x0 = event.clientX;
    const y0 = event.clientY;
    let dernier = depart;
    const bouge = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      dernier = mode === 'deplacer' ? chatDeplace(depart, dx, dy, fenetre) : chatRedimensionne(depart, dx, dy, fenetre);
      setGeste(dernier);
    };
    const fin = () => {
      window.removeEventListener('pointermove', bouge);
      window.removeEventListener('pointerup', fin);
      window.removeEventListener('pointercancel', fin);
      document.body.style.userSelect = '';
      setGeste(null);
      onChat(dernier);
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', bouge);
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
  };

  const surBouton = () => {
    if (etat === 'initialiser') void suivi.lancer('initialiser');
    else if (etat === 'conversation') void suivi.lancer(espace?.rapport ? 'reanalyser' : 'initialiser');
    else if (etat === 'rapport') setRapport(true);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <button
        type="button"
        onClick={() => onChat({ ...vu, ouvert: !chat.ouvert })}
        data-marketing-chat-bouton
        data-ouvert={chat.ouvert ? 'oui' : 'non'}
        aria-expanded={chat.ouvert}
        aria-label={chat.ouvert ? 'Fermer l’agent' : 'Ouvrir l’agent'}
        title={chat.ouvert ? t('Fermer l’agent') : t('Ouvrir l’agent')}
        className={cn(
          'fixed right-4 z-40 grid place-items-center rounded-full bg-accent text-accent-fg shadow-xl transition-transform hover:scale-105',
          // Sur un écran bas, le chat ouvert prend tout : le rond ne le recouvre plus.
          ecranBas && chat.ouvert && 'hidden',
        )}
        style={{ width: ROND_CHAT, height: ROND_CHAT, bottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {chat.ouvert ? <ChevronDown className="h-5 w-5" /> : suivi.travaille ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bot className="h-5 w-5" />}
        {!chat.ouvert && suivi.questions > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-warning text-sur-etat" data-marketing-chat-question>
            <MessageCircleQuestion className="h-2.5 w-2.5" />
          </span>
        ) : null}
      </button>

      {chat.ouvert ? (
        <section
          data-marketing-chat
          data-marketing-guide={guide.avancement}
          data-marketing-agent={agentId ?? 'nouveau'}
          className="fixed z-40 flex flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-faint/30"
          style={{ right: vu.droite, bottom: vu.bas, width: vu.largeur, height: vu.hauteur }}
        >
          <header
            data-marketing-chat-entete
            onPointerDown={commencer('deplacer')}
            className={cn('flex shrink-0 items-center gap-2 bg-raised px-3 py-2 text-[13px] font-medium text-text', !telephone && 'cursor-grab active:cursor-grabbing')}
            style={{ touchAction: 'none' }}
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">{t('L’agent marketing')}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onChat({ ...vu, ouvert: false })}
              aria-label="Fermer l’agent"
              title={t('Fermer l’agent')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </header>
          {!telephone ? (
            <span
              data-marketing-chat-poignee
              onPointerDown={commencer('redimensionner')}
              title={t('Tirer pour redimensionner')}
              className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize"
              style={{ touchAction: 'none' }}
            />
          ) : null}

          {decorMasque ? null : (
          <button
            type="button"
            onClick={() => setPoints(true)}
            data-marketing-avancement
            className="mx-3 my-2 flex shrink-0 flex-col gap-1 rounded-md px-1 py-1 text-left hover:bg-raised"
            title={t('Voir les points étudiés')}
          >
            <span className="flex items-center gap-2 text-[12.5px]">
              <span className="flex-1 text-muted">{t('Où en est le projet')}</span>
              <span className="text-faint">{guide.avancement} %</span>
              <ChevronRight className="h-3.5 w-3.5 text-faint" />
            </span>
            <span className="block h-1 overflow-hidden rounded-full bg-faint/20">
              <span className={cn('block h-full rounded-full', guide.avancement >= 100 ? 'bg-termine' : 'bg-en-cours')} style={{ width: `${guide.avancement}%` }} />
            </span>
          </button>
          )}

          <div className="flex min-h-0 flex-1 flex-col" data-marketing-conversation={agent ? 'oui' : agentId ? (suivi.introuvable ? 'introuvable' : 'chargement') : 'aucune'}>
            {agent ? (
              <Chat agent={agent} projectId={projectId} creuxReserveAilleurs />
            ) : agentId && suivi.introuvable ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-marketing-agent-introuvable>
                <p className="text-[13.5px] leading-relaxed text-muted">{t('La conversation de l’agent n’a pas pu être chargée.')}</p>
                <Button size="sm" variant="subtle" onClick={suivi.recharger}>
                  <RotateCw className="h-3.5 w-3.5" />
                  {t('Réessayer')}
                </Button>
              </div>
            ) : agentId ? (
              <div className="px-4">
                <SilhouetteConversation bulles={3} />
              </div>
            ) : (
          <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-4">
            <div className="flex flex-col gap-2.5 py-2 text-[13.5px] leading-relaxed text-text" data-marketing-accueil>
              <p>{t('L’agent marketing va étudier votre projet point par point : ce que vous vendez et à qui, l’offre et le prix, la mesure des visites, les canaux qui conviennent, puis un plan daté et vos premiers contenus.')}</p>
              <p className="text-muted">{t('Vous suivrez son travail ici même, sa liste de tâches au-dessus du champ d’écriture. Son rapport arrive dans la conversation : répondez-lui dessous pour le faire corriger.')}</p>
            </div>
          </ZoneDefilement>
            )}
          </div>

          {decorMasque ? null : (
          <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2.5 pt-2" data-marketing-pied>
            <BoutonAgent etat={etat} agent={agent} envoi={suivi.envoi} onClick={surBouton} />
            {espace?.rapport && (etat === 'rapport' || etat === 'conversation') ? (
              <Button
                size="icon"
                variant="subtle"
                className="h-9 w-9 shrink-0"
                aria-label="Réanalyser le projet"
                title={t('Réanalyser le projet')}
                onClick={() => setConfirmer(true)}
                data-marketing-reanalyser
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          )}
        </section>
      ) : null}

      <VoletInfo ouvert={points} titre={t('Les points étudiés')} onClose={() => setPoints(false)}>
        <p className="text-muted">{t('Chaque point se coche tout seul quand le travail est vraiment fait. L’agent les passe en revue dans sa liste de tâches.')}</p>
        <ul className="flex flex-col gap-2">
          {guide.jalons.map((j) => (
            <li
              key={j.cle}
              className="flex items-start gap-2.5"
              data-marketing-jalon={j.cle}
              data-fait={j.fait ? 'oui' : 'non'}
              {...(j.cle === 'suivi' ? { 'data-marketing-suivi': config?.etatSuivi ?? 'absent' } : {})}
            >
              {j.fait ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-termine" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-faint" />}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={j.fait ? 'text-text' : 'text-muted'}>{t(j.libelle)}</span>
                <span className="text-[12.5px] text-faint">{j.fait ? t(j.explication) : t(j.action)}</span>
              </span>
            </li>
          ))}
        </ul>
      </VoletInfo>

      <TiroirRapport ouvert={rapport} espace={espace} onClose={() => setRapport(false)} />
      <ConfirmDialog
        open={confirmer}
        title={t('Réanalyser le projet ?')}
        description={t('L’agent relit tout le projet et réécrit son rapport. Ce qui est déjà enregistré est gardé, sauf ce qui a changé.')}
        confirmLabel={t('Réanalyser')}
        onConfirm={() => {
          setConfirmer(false);
          void suivi.lancer('reanalyser');
        }}
        onClose={() => setConfirmer(false)}
      />
    </>,
    document.body,
  );
}

/** LE RAPPORT EN LECTURE : le dernier enregistré par l'agent, en plein écran sur téléphone. */
function TiroirRapport({ ouvert, espace, onClose }: { ouvert: boolean; espace: EspaceMarketing | null; onClose: () => void }) {
  const telephone = useTelephone();
  if (!ouvert || !espace?.rapport) return null;
  return (
    <Drawer open onClose={onClose} empile plein={telephone} hauteurFixe>
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Le rapport de l’agent')}</DialogTitle>
        <Button variant="ghost" size="icon" className="shrink-0 text-muted" onClick={onClose} aria-label="Fermer" title={t('Fermer')}>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-5">
        <div className="flex flex-col gap-2" data-marketing-rapport>
          {espace.rapportLe ? (
            <span className="text-[12px] text-faint">
              {t('Mis à jour le {date}', {
                date: new Date(espace.rapportLe).toLocaleString(formatRegional(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
              })}
            </span>
          ) : null}
          <div className="text-[13.5px] leading-relaxed text-text">
            <Markdown content={espace.rapport} />
          </div>
          <p className="pt-2 text-[12.5px] text-faint">{t('Pour le faire corriger, répondez à l’agent dans sa bulle, en bas à droite.')}</p>
        </div>
      </ZoneDefilement>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Positionnement                                                       */
/* ------------------------------------------------------------------ */

function champsFiche(): { cle: keyof FicheMarketing; libelle: string; aide: string; liste?: boolean }[] {
  return [
    { cle: 'cible', libelle: t('À qui il s’adresse'), aide: t('Les personnes qui ont le plus besoin du produit, décrites précisément.') },
    { cle: 'probleme', libelle: t('Le problème qu’il règle'), aide: t('Ce qui gêne ces personnes aujourd’hui, dit avec leurs mots.') },
    { cle: 'promesse', libelle: t('Sa promesse'), aide: t('Ce que le produit change pour elles, en une phrase.') },
    { cle: 'arguments', libelle: t('Ses arguments'), aide: t('Les raisons de le choisir, une par ligne.'), liste: true },
    { cle: 'ton', libelle: t('Le ton'), aide: t('La façon de parler : sérieux, chaleureux, direct…') },
    { cle: 'offre', libelle: t('L’offre'), aide: t('Ce qu’on achète exactement.') },
    { cle: 'prix', libelle: t('Le prix'), aide: t('Combien ça coûte, et comment on paie.') },
    { cle: 'concurrents', libelle: t('Les concurrents'), aide: t('Les autres solutions que vos clients connaissent, une par ligne.'), liste: true },
  ];
}

function OngletPositionnement({ projectId, fiche }: { projectId: string; fiche: FicheMarketing }) {
  const versTexte = (f: FicheMarketing) =>
    Object.fromEntries(champsFiche().map((c) => [c.cle, c.liste ? ((f[c.cle] as string[] | undefined) ?? []).join('\n') : ((f[c.cle] as string | undefined) ?? '')]));
  const [brouillon, setBrouillon] = React.useState<Record<string, string>>(() => versTexte(fiche));
  // LE TEXTE SE LIT EN ENTIER, ET SE MODIFIE EN PLACE : un clic sur une
  // rubrique la passe en champ de saisie, la sortie du champ l'enregistre
  // (seulement si son texte a changé), Échap l'annule. Une seule rubrique
  // en édition à la fois.
  const [edition, setEdition] = React.useState<string | null>(null);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const editionRef = React.useRef<string | null>(null);
  editionRef.current = edition;
  // Une fiche distante qui arrive pendant la frappe ne réécrit JAMAIS la
  // rubrique en cours d'édition : seules les autres suivent le serveur.
  React.useEffect(() => {
    const distante = versTexte(fiche);
    setBrouillon((b) => (editionRef.current ? { ...distante, [editionRef.current]: b[editionRef.current] ?? '' } : distante));
  }, [JSON.stringify(fiche)]);

  const enregistrer = async (cle: string, valeur: string) => {
    setEnCours(cle);
    try {
      const envoi: Record<string, unknown> = {};
      const texte = { ...versTexte(fiche), [cle]: valeur };
      for (const c of champsFiche()) {
        const v = texte[c.cle] ?? '';
        envoi[c.cle] = c.liste ? v.split('\n').map((l) => l.trim()).filter(Boolean) : v;
      }
      await client.call({ type: 'marketing.fiche', projectId, fiche: envoi });
      client.pushToast('success', t('Positionnement enregistré'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Positionnement non enregistré'));
      setBrouillon((b) => ({ ...b, [cle]: versTexte(fiche)[cle] ?? '' }));
    } finally {
      setEnCours(null);
    }
  };

  // La sortie du champ ferme l'édition UNE fois : le drapeau évite le double
  // envoi (Échap puis perte du focus, ou démontage après la sortie).
  const sortie = React.useRef<{ cle: string; annule: boolean } | null>(null);
  const quitter = (cle: string, annule: boolean) => {
    if (sortie.current?.cle === cle) return;
    sortie.current = { cle, annule };
    setEdition(null);
    const avant = versTexte(fiche)[cle] ?? '';
    if (annule) {
      setBrouillon((b) => ({ ...b, [cle]: avant }));
      return;
    }
    const valeur = brouillon[cle] ?? '';
    if (valeur.trim() !== avant.trim()) void enregistrer(cle, valeur);
  };
  const ouvrir = (cle: string) => {
    if (enCours) return;
    // Un clic dans une zone de texte qui ne change pas la sélection : on
    // laisse copier à la souris sans ouvrir l'édition.
    if (window.getSelection()?.toString()) return;
    sortie.current = null;
    setEdition(cle);
  };

  // Le champ prend la hauteur de son texte : rien n'est jamais tronqué.
  const ajuster = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <CorpsOnglet>
      <div className="flex flex-col gap-3" data-marketing-fiche>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[13px] font-medium text-text">{t('La carte d’identité commerciale')}</span>
          <PointInfo titre={t('Le positionnement')}>
            <p>{t('La carte d’identité commerciale du projet. L’agent la rédige ; touchez une rubrique pour la corriger, elle s’enregistre dès que vous en sortez.')}</p>
            {champsFiche().map((c) => (
              <p key={c.cle}>
                <span className="font-medium">{c.libelle}</span> — {c.aide}
              </p>
            ))}
          </PointInfo>
        </div>
        {champsFiche().map((c) => {
          const valeur = brouillon[c.cle] ?? '';
          const enEdition = edition === c.cle;
          return (
            <div key={c.cle} className="flex flex-col gap-1" data-marketing-rubrique={c.cle}>
              <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                {c.libelle}
                {enCours === c.cle ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </span>
              {enEdition ? (
                <Textarea
                  autoFocus
                  rows={1}
                  value={valeur}
                  placeholder={c.aide}
                  ref={ajuster}
                  onFocus={(e) => {
                    const fin = e.currentTarget.value.length;
                    e.currentTarget.setSelectionRange(fin, fin);
                  }}
                  onChange={(e) => {
                    ajuster(e.currentTarget);
                    setBrouillon((b) => ({ ...b, [c.cle]: e.target.value }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      quitter(c.cle, true);
                    }
                  }}
                  onBlur={() => quitter(c.cle, false)}
                  className="resize-none overflow-hidden text-[13px]"
                  data-marketing-champ={c.cle}
                />
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => ouvrir(c.cle)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      ouvrir(c.cle);
                    }
                  }}
                  className={cn(
                    'cursor-text select-text whitespace-pre-wrap break-words rounded-md border border-border bg-raised px-3 py-2.5 text-[13px] leading-relaxed transition-colors hover:ring-1 hover:ring-faint',
                    valeur.trim() ? 'text-text' : 'text-faint',
                  )}
                  data-marketing-texte={c.cle}
                >
                  {valeur.trim() ? valeur : c.aide}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CorpsOnglet>
  );
}

/* ------------------------------------------------------------------ */
/* Contenus                                                             */
/* ------------------------------------------------------------------ */

/**
 * LES COLONNES DE L'ONGLET CONTENUS (demande du 28/09/2026) : Brouillons,
 * À valider, Programmés, Publiés — DISJOINTES, chacune avec sa phrase qui dit
 * à quoi elle sert et QUI agit. Les contenus s'y déplacent au glisser, mais
 * seulement dans les sens que `depotContenu` permet (règle pure, partagée).
 * « Programmé » n'est qu'un REPÈRE de calendrier : rien ne part tout seul,
 * publier reste un geste humain. Les annonces tirées d'une livraison
 * (`origine === 'nouveaute'`) attendent dans « À valider » avec une étiquette ;
 * « Abandonné » ne se montre plus.
 */
function colonnesContenus(): { cle: ColonneContenu; libelle: string; phrase: string }[] {
  return [
    { cle: 'brouillons', libelle: t('Brouillons'), phrase: t('En cours d’écriture, par l’agent ou par vous.') },
    { cle: 'a_valider', libelle: t('À valider'), phrase: t('Écrits : c’est à vous de les relire.') },
    { cle: 'programmes', libelle: t('Programmés'), phrase: t('Relus et datés. Un simple repère : rien ne part tout seul, vous publiez vous-même.') },
    { cle: 'publies', libelle: t('Publiés'), phrase: t('Publiés par vous. Ils ne bougent plus.') },
  ];
}

function toneEtape(etape: EtapeContenu): 'neutral' | 'warning' | 'success' | 'danger' {
  if (etape === 'a_valider') return 'warning';
  if (etape === 'publie') return 'success';
  if (etape === 'echec') return 'danger';
  return 'neutral';
}

/**
 * UNE TUILE DE COLONNE, qu'on touche pour l'ouvrir. Son titre se replie sur
 * deux lignes : ce n'est donc PAS un `button` (un texte replié n'y tient pas,
 * règle de l'interface), mais une zone qui se comporte comme lui — clavier
 * compris.
 */
function Tuile({
  onOuvrir,
  children,
  glissable,
  onPointerDown,
  attenue,
  ...reperes
}: {
  onOuvrir: () => void;
  children: React.ReactNode;
  glissable?: boolean;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  attenue?: boolean;
} & Record<`data-${string}`, string>) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOuvrir}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOuvrir();
        }
      }}
      className={cn(
        'flex w-full flex-col gap-0.5 rounded-md bg-surface px-2.5 py-2 text-left hover:ring-1 hover:ring-faint',
        glissable ? 'cursor-grab select-none active:cursor-grabbing' : 'cursor-pointer',
        attenue && 'opacity-40',
      )}
      {...reperes}
    >
      {children}
    </div>
  );
}

/**
 * Une colonne de l'onglet : son titre, son compte, sa phrase, puis sa liste qui
 * défile seule. Le fond est contrasté en permanence ; pendant un glissement, elle
 * s'éclaire si on peut y déposer la tuile tenue, s'estompe sinon.
 */
function ColonneDeContenus({
  cle,
  libelle,
  phrase,
  compte,
  depot,
  children,
}: {
  cle: string;
  libelle: string;
  phrase: string;
  compte: number;
  /** Null hors glissement ; sinon ce que la colonne offre à la tuile tenue. */
  depot?: 'possible' | 'survol' | 'refuse' | null;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 w-[78vw] max-w-[300px] shrink-0 snap-start flex-col rounded-md bg-raised transition-opacity sm:w-auto sm:min-w-[200px] sm:max-w-none sm:flex-1',
        depot === 'possible' && 'ring-1 ring-accent/60',
        depot === 'survol' && 'ring-2 ring-accent',
        depot === 'refuse' && 'opacity-50',
      )}
      data-marketing-colonne={cle}
      data-compte={compte}
      data-depot={depot ?? 'aucun'}
    >
      <header className="flex shrink-0 flex-col gap-0.5 px-2.5 pb-1.5 pt-2">
        <span className="flex items-center gap-1.5 text-[12.5px]">
          <span className="min-w-0 flex-1 truncate font-medium text-text">{libelle}</span>
          <span className="shrink-0 text-faint">{compte}</span>
        </span>
        <span className="text-[11.5px] leading-snug text-faint" data-marketing-colonne-phrase>{phrase}</span>
      </header>
      <ZoneDefilement fond="hsl(var(--raised))" className="px-1.5 pb-1.5">
        <div className="flex flex-col gap-1">{children}</div>
      </ZoneDefilement>
    </section>
  );
}

/** Où en est une carte de l'agent marketing : le même témoin que sur le tableau. */
function etatDeCarte(card: Card, agent: Agent | undefined): { libelle: string; classe: string; tourne: boolean } {
  if (agent?.attendReponse) return { libelle: t('Question en attente'), classe: 'text-warning', tourne: false };
  if (agent && agentTientSonTour(agent)) return { libelle: t('L’agent travaille'), classe: 'text-en-cours', tourne: true };
  if (card.column === 'running') return { libelle: t('En cours'), classe: 'text-en-cours', tourne: false };
  if (card.column === 'planned') return { libelle: t('Planifié'), classe: 'text-faint', tourne: false };
  return { libelle: t('Terminé'), classe: 'text-termine', tourne: false };
}

/**
 * L'ONGLET CONTENUS, EN COLONNES (demande du 26/09/2026) : un petit tableau
 * par état — à valider, programmés, publiés — qu'on lit d'un coup
 * d'œil, et une colonne « Travail de l'agent » avec les cartes de l'agent
 * marketing de ce projet. Ces cartes ne paraissent plus sur le tableau du
 * projet (`estCarteMarketing`) : c'est ici qu'on les suit, et un toucher ouvre
 * leur conversation. Sur téléphone, les colonnes défilent de côté.
 */
function OngletContenus({
  contenus,
  cartes,
  onOuvrirCarte,
  onOuvrir,
  aUnAgent,
  auTravail,
  suiteEnvoyee,
  onAgent,
  onSuite,
  onEcrire,
}: {
  contenus: ContenuMarketing[];
  cartes: Card[];
  onOuvrirCarte?: (card: Card) => void;
  onOuvrir: (id: string) => void;
  aUnAgent: boolean;
  /** L'agent tient un tour ou attend une réponse : le bouton « Générer la suite » est éteint. */
  auTravail: boolean;
  suiteEnvoyee: boolean;
  onAgent: () => void;
  /** « Générer la suite » : l'agent attitré analyse l'existant, archive ses propositions périmées et produit la suite. */
  onSuite: () => void;
  onEcrire: () => void;
}) {
  const state = useApp();
  const colonnes = colonnesContenus();
  const visibles = contenus.filter((c) => c.etape !== 'abandonne');
  const agentDe = (card: Card) =>
    (card.agentId ? state.agents[card.agentId] : undefined) ??
    Object.values(state.agents).find((a) => a.cardId === card.id && agentTientSonTour(a));

  // LE GLISSER-DÉPOSER : une tuile ne change de colonne que par un chemin permis
  // (`depotContenu`). Programmer demande d'abord la date, dans une fenêtre.
  const [demande, setDemande] = React.useState<{ contenu: ContenuMarketing; etapes: EtapeContenu[] } | null>(null);
  const [dateChoisie, setDateChoisie] = React.useState('');
  const [heureChoisie, setHeureChoisie] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);

  const appliquer = React.useCallback(async (c: ContenuMarketing, etapes: EtapeContenu[], date?: string, heure?: string) => {
    setEnvoi(true);
    try {
      if (date) await client.call({ type: 'marketing.contenu.modifier', id: c.id, datePrevue: date, heurePrevue: heure ? heure : null });
      for (const etape of etapes) await client.call({ type: 'marketing.contenu.etape', id: c.id, etape });
      return true;
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Déplacement impossible'));
      return false;
    } finally {
      setEnvoi(false);
    }
  }, []);

  const resolve = React.useCallback((element: Element): DropTarget | null => {
    const colonne = element.closest('[data-marketing-colonne]')?.getAttribute('data-marketing-colonne');
    return colonne && colonne !== 'agent' ? { id: colonne, kind: 'colonne', position: 'inside' } : null;
  }, []);
  const deposer = React.useCallback(
    (item: { id: string }, cible: DropTarget | null) => {
      const c = contenus.find((x) => x.id === item.id);
      if (!c || !cible) return;
      const depot = depotContenu(c, cible.id as ColonneContenu);
      if (!depot.ok) {
        client.pushToast('info', t(depot.raison));
        return;
      }
      if (!depot.etapes.length) return;
      if (depot.exigeDate) {
        setDateChoisie(c.datePrevue ?? '');
        setHeureChoisie(c.heurePrevue ?? '');
        setDemande({ contenu: c, etapes: depot.etapes });
        return;
      }
      void appliquer(c, depot.etapes);
    },
    [contenus, appliquer],
  );
  const { dragging, target, pointer, start } = usePointerDrag({ resolve, onDrop: deposer, holdMs: 250 });
  const glisse = React.useRef(false);
  React.useEffect(() => {
    if (dragging) glisse.current = true;
  }, [dragging]);
  const tenu = dragging ? (contenus.find((c) => c.id === dragging.id) ?? null) : null;
  const offreDe = (cle: ColonneContenu): 'possible' | 'survol' | 'refuse' | null => {
    if (!tenu) return null;
    if (colonneDeContenu(tenu.etape) === cle) return target?.id === cle ? 'survol' : null;
    const depot = depotContenu(tenu, cle);
    if (!depot.ok) return 'refuse';
    return target?.id === cle ? 'survol' : 'possible';
  };
  const confirmerDate = async () => {
    if (!demande || !jourValide(dateChoisie)) return;
    const ok = await appliquer(demande.contenu, demande.etapes, dateChoisie, heureChoisie);
    if (ok) setDemande(null);
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col" data-marketing-contenus={contenus.length}>
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <span className="flex-1 text-[12.5px] text-muted">
            {!visibles.length
              ? aUnAgent
                ? t('Aucun contenu pour l’instant. Demandez-en à l’agent, dans sa bulle en bas à droite : il les rédige pour vous, prêts à relire.')
                : t('L’agent rédige vos premiers contenus pendant son analyse : lancez-la depuis sa bulle en bas à droite.')
              : t('{n} contenus', { n: visibles.length })}
          </span>
          <Button
            size="sm"
            variant="subtle"
            className="shrink-0"
            disabled={auTravail || suiteEnvoyee}
            onClick={aUnAgent ? onSuite : onAgent}
            title={
              auTravail
                ? t('L’agent est au travail')
                : aUnAgent
                  ? t('L’agent analyse ce qui existe, archive ses propositions périmées puis prépare la suite, selon votre rythme.')
                  : t('Lancez d’abord l’analyse du projet : l’agent prépare ensuite la suite.')
            }
            data-marketing-generer-suite={auTravail || suiteEnvoyee ? 'travail' : aUnAgent ? 'pret' : 'initialiser'}
          >
            {auTravail || suiteEnvoyee ? <Loader2 className="h-3.5 w-3.5 animate-spin text-en-cours" /> : <Sparkles className="h-3.5 w-3.5" />}
            {auTravail || suiteEnvoyee ? t('L’agent est au travail') : t('Générer la suite')}
          </Button>
          <PointInfo titre={t('Les contenus')}>
            <p>{t('Les posts, courriels et annonces du projet. L’agent les écrit en brouillon puis les dépose « À valider » ; vous les relisez, les programmez puis les marquez comme publiés.')}</p>
            <p>{t('Glissez un contenu d’une colonne à l’autre : seuls les sens qui ont du sens sont permis, et un contenu publié ne bouge plus. Déposé dans « Programmés », il vous demande la date, et l’heure si vous voulez.')}</p>
            <p>{t('« Programmé » est un repère pour le calendrier : rien n’est publié tout seul, c’est vous qui marquez un contenu comme publié.')}</p>
            <p>{t('La dernière colonne montre le travail de l’agent marketing : ses analyses et ses plans ne paraissent plus sur le tableau du projet.')}</p>
            <p>{t('Dès que 10 contenus ou plus attendent votre relecture, l’agent cesse d’en produire tout seul. « Générer la suite » lui demande, quand vous le voulez, d’étudier ce qui existe, d’archiver ce qui est périmé et de préparer la suite à votre rythme. Chaque jour, il replace aussi les dates en retard.')}</p>
          </PointInfo>
        </div>
        <ZoneDefilement axe="horizontal" classeEnveloppe="min-h-0 flex-1" className="snap-x px-3">
          <div className="flex h-full min-h-0 gap-2 pb-2 sm:w-full" data-marketing-colonnes={colonnes.length + 1}>
            {colonnes.map((col) => {
              const liste = visibles.filter((c) => colonneDeContenu(c.etape) === col.cle);
              return (
                <ColonneDeContenus key={col.cle} cle={col.cle} libelle={col.libelle} phrase={col.phrase} compte={liste.length} depot={offreDe(col.cle)}>
                    {liste.length ? (
                      liste.map((c) => (
                        <Tuile
                          key={c.id}
                          onOuvrir={() => {
                            if (!glisse.current) onOuvrir(c.id);
                            glisse.current = false;
                          }}
                          glissable={c.etape !== 'publie'}
                          attenue={dragging?.id === c.id}
                          onPointerDown={(e) => {
                            if (c.etape === 'publie') return;
                            glisse.current = false;
                            start(e, { id: c.id, kind: 'contenu', label: c.titre });
                          }}
                          data-marketing-contenu={c.id}
                          data-etape={c.etape}
                        >
                          <span className="line-clamp-2 break-words text-[13px] text-text">{c.titre}</span>
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-faint">
                            <span className="shrink-0">{libelleCanal(c.canal)}</span>
                            {c.datePrevue ? (
                              <>
                                <span aria-hidden>·</span>
                                <span className="shrink-0">
                                  {dateCourte(c.datePrevue)}
                                  {c.heurePrevue ? ` ${c.heurePrevue}` : ''}
                                </span>
                              </>
                            ) : c.etape === 'pret' ? (
                              <>
                                <span aria-hidden>·</span>
                                <span className="shrink-0">{t('Sans date')}</span>
                              </>
                            ) : null}
                            {c.varianteDe ? (
                              <>
                                <span aria-hidden>·</span>
                                <span className="shrink-0">{t('Version B')}</span>
                              </>
                            ) : null}
                            {c.origine === 'nouveaute' ? <Badge tone="strong">{t('Nouveauté')}</Badge> : null}
                            {c.etape === 'echec' ? <Badge tone={toneEtape(c.etape)}>{t(LIBELLE_ETAPE[c.etape])}</Badge> : null}
                          </span>
                        </Tuile>
                      ))
                    ) : (
                      <p className="px-1 py-2 text-[12px] text-faint">{t('Rien ici pour l’instant.')}</p>
                    )}
                  </ColonneDeContenus>
              );
            })}
            <ColonneDeContenus cle="agent" libelle={t('Travail de l’agent')} phrase={t('Ce que l’agent prépare : ses analyses et ses plans. On ne dépose rien ici.')} compte={cartes.length}>
              {cartes.length ? (
                cartes.map((card) => {
                  const etat = etatDeCarte(card, agentDe(card));
                  return (
                    <Tuile key={card.id} onOuvrir={() => onOuvrirCarte?.(card)} data-marketing-carte={card.id}>
                      <span className="line-clamp-2 break-words text-[13px] text-text">{card.title}</span>
                      <span className={cn('flex min-w-0 items-center gap-1 text-[11.5px]', etat.classe)}>
                        {etat.tourne ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
                        <span className="truncate">{etat.libelle}</span>
                        <span className="shrink-0 text-faint">· {dateCourte(jourLocal(new Date(card.updatedAt)), { day: 'numeric', month: 'short' })}</span>
                      </span>
                    </Tuile>
                  );
                })
              ) : (
                <p className="px-1 py-2 text-[12px] text-faint">{t('L’agent n’a encore rien lancé.')}</p>
              )}
            </ColonneDeContenus>
          </div>
        </ZoneDefilement>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 sm:justify-end" data-marketing-pied>
        {aUnAgent ? (
          <>
            <Button size="pied" className="min-w-0 flex-1 sm:w-auto sm:flex-none" onClick={onAgent} data-marketing-demander-contenu>
              <Sparkles className="h-3.5 w-3.5" />
              {t('Demander un contenu')}
            </Button>
            <Button size="icon" variant="subtle" className="h-9 w-9" aria-label="Écrire moi-même" title={t('Écrire moi-même')} onClick={onEcrire} data-marketing-contenu-nouveau>
              <PenLine className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button size="pied" className="sm:w-auto" onClick={onEcrire} data-marketing-contenu-nouveau>
            <PenLine className="h-3.5 w-3.5" />
            {t('Écrire moi-même')}
          </Button>
        )}
      </div>

      {dragging && pointer ? (
        <div
          data-marketing-apercu
          className="pointer-events-none fixed z-50 max-w-[240px] truncate rounded-md bg-surface px-2.5 py-2 text-[13px] text-text shadow-xl ring-1 ring-faint/40"
          style={{ left: pointer.x + 12, top: pointer.y + 12 }}
        >
          {dragging.label}
        </div>
      ) : null}

      <Dialog open={!!demande} onOpenChange={(ouvert) => !ouvert && !envoi && setDemande(null)}>
        <DialogContent className="sm:w-[min(420px,100%)]" data-marketing-fenetre-date>
          <DialogHeader>
            <DialogTitle>{t('Programmer ce contenu')}</DialogTitle>
          </DialogHeader>
          <DialogDescription className="mt-0">
            {t('Choisissez le jour où il doit paraître. C’est un repère pour le calendrier : rien ne sera publié tout seul.')}
          </DialogDescription>
          <p className="mt-2 truncate text-[13px] font-medium text-text">{demande?.contenu.titre}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="flex min-w-0 flex-col gap-1 text-[12.5px] text-muted">
              {t('Date')}
              <Input type="date" value={dateChoisie} onChange={(e) => setDateChoisie(e.target.value)} className="w-full min-w-0 appearance-none text-[13px]" data-marketing-fenetre-jour />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[12.5px] text-muted">
              {t('Heure (facultative)')}
              <Input type="time" value={heureChoisie} onChange={(e) => setHeureChoisie(e.target.value)} className="w-full min-w-0 appearance-none text-[13px]" data-marketing-fenetre-heure />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" disabled={envoi} onClick={() => setDemande(null)}>
              {t('Annuler')}
            </Button>
            <Button size="sm" disabled={envoi || !jourValide(dateChoisie)} onClick={() => void confirmerDate()} data-marketing-fenetre-valider>
              {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('Programmer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TiroirNouveauContenu({ ouvert, projectId, onClose }: { ouvert: boolean; projectId: string; onClose: () => void }) {
  const [titre, setTitre] = React.useState('');
  const [texte, setTexte] = React.useState('');
  const [canal, setCanal] = React.useState<string>('linkedin');
  const [enCours, setEnCours] = React.useState(false);
  React.useEffect(() => {
    if (!ouvert) return;
    setTitre('');
    setTexte('');
  }, [ouvert]);
  if (!ouvert) return null;
  const creer = async () => {
    setEnCours(true);
    try {
      await client.call({ type: 'marketing.contenu.creer', projectId, genre: 'post', canal, titre, texte });
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Contenu non créé'));
    } finally {
      setEnCours(false);
    }
  };
  return (
    <Drawer open onClose={onClose} empile hauteurFixe>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <PenLine className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Nouveau contenu')}</DialogTitle>
      </header>
      <CorpsOnglet
        pied={
          <Button size="pied" className="sm:w-auto" disabled={!titre.trim() || !texte.trim() || enCours} onClick={() => void creer()} data-marketing-creer>
            {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('Créer le brouillon')}
          </Button>
        }
      >
        <div className="flex flex-col gap-2.5" data-marketing-creation>
          <RangeeDeChoix>
            {CANAUX_CONTENU.map((c) => (
              <Button key={c} size="sm" variant={canal === c ? 'subtle' : 'ghost'} onClick={() => setCanal(c)}>
                {libelleCanal(c)}
              </Button>
            ))}
          </RangeeDeChoix>
          <Input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder={t('Titre')} className="text-[13px]" />
          <Textarea rows={8} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={t('Le texte')} className="text-[13px]" />
        </div>
      </CorpsOnglet>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Calendrier                                                           */
/* ------------------------------------------------------------------ */

function classeDuContenu(c: ContenuMarketing): string {
  if (c.etape === 'publie') return 'bg-termine/15 text-termine';
  if (c.etape === 'programme') return 'bg-en-cours/15 text-en-cours';
  if (c.etape === 'a_valider') return 'bg-warning/15 text-text';
  return 'bg-faint/15 text-text';
}

/** Semaines ajoutées d'un coup quand on approche d'un bout du calendrier continu. */
const SEMAINES_PAR_PAQUET = 4;

/**
 * LE CALENDRIER : sur téléphone, une LISTE CONTINUE de jours (une ligne par
 * jour, lisible au doigt) qui défile à l'infini dans les deux sens et s'ouvre
 * sur aujourd'hui ; QUATRE semaines en grille sur ordinateur. Un contenu se
 * déplace d'un jour à l'autre avec le seul glisser de l'application
 * (`usePointerDrag`), après un court appui pour ne pas gêner le défilement.
 */
function OngletCalendrier({
  projectId,
  contenus,
  actions,
  onOuvrir,
  onAgent,
}: {
  projectId: string;
  contenus: ContenuMarketing[];
  actions: ActionMarketing[];
  onOuvrir: (id: string) => void;
  onAgent: () => void;
}) {
  const telephone = useTelephone();
  const [actionOuverte, setActionOuverte] = React.useState<string | null>(null);
  const action = actions.find((a) => a.id === actionOuverte) ?? null;
  const semaines = 4;
  const [decalage, setDecalage] = React.useState(0);
  // Téléphone : la plage chargée, en semaines comptées depuis celle d'aujourd'hui.
  const [plage, setPlage] = React.useState({ debut: -1, fin: 7 });
  const lundi = lundiLocal(new Date());
  lundi.setDate(lundi.getDate() + (telephone ? plage.debut : decalage) * 7);
  const jours = Array.from({ length: (telephone ? plage.fin - plage.debut : semaines) * 7 }, (_, i) => {
    const d = new Date(lundi);
    d.setDate(lundi.getDate() + i);
    return jourLocal(d);
  });
  const aujourdhui = jourLocal(new Date());
  const parJour = new Map<string, ContenuMarketing[]>();
  for (const c of contenus) {
    if (!c.datePrevue || c.etape === 'abandonne') continue;
    const l = parJour.get(c.datePrevue);
    if (l) l.push(c);
    else parJour.set(c.datePrevue, [c]);
  }
  const actionsParJour = new Map<string, ActionMarketing[]>();
  for (const a of actions) {
    if (!a.datePrevue) continue;
    actionsParJour.set(a.datePrevue, [...(actionsParJour.get(a.datePrevue) ?? []), a]);
  }
  const aFaire = actions.filter((a) => !a.faitLe).slice(0, 3);

  const resolve = React.useCallback((element: Element): DropTarget | null => {
    const cellule = element.closest('[data-marketing-jour]');
    const jour = cellule?.getAttribute('data-marketing-jour');
    return jour ? { id: jour, kind: 'jour', position: 'inside' } : null;
  }, []);
  const deposer = React.useCallback(async (item: { id: string; kind: string }, cible: DropTarget | null) => {
    if (!cible || !jourValide(cible.id)) return;
    try {
      if (item.kind === 'action') await client.call({ type: 'marketing.action.modifier', projectId, id: item.id, datePrevue: cible.id });
      else await client.call({ type: 'marketing.contenu.modifier', id: item.id, datePrevue: cible.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Date non modifiée'));
    }
  }, [projectId]);
  const { dragging, target, start } = usePointerDrag({ resolve, onDrop: deposer, holdMs: 250 });
  const glisse = React.useRef(false);
  React.useEffect(() => {
    if (dragging) glisse.current = true;
  }, [dragging]);

  const pastille = (c: ContenuMarketing, grand: boolean) => (
    <button
      key={c.id}
      type="button"
      data-marketing-calendrier-contenu={c.id}
      onPointerDown={(e) => {
        if (c.etape === 'publie') return;
        glisse.current = false;
        start(e, { id: c.id, kind: 'contenu', label: c.titre });
      }}
      onClick={() => {
        if (!glisse.current) onOuvrir(c.id);
        glisse.current = false;
      }}
      className={cn(
        'min-w-0 truncate rounded-sm text-left',
        grand ? 'px-2 py-1.5 text-[13px]' : 'px-1 py-0.5 text-[11.5px]',
        classeDuContenu(c),
        dragging?.id === c.id && 'opacity-40',
      )}
    >
      {c.titre}
    </button>
  );

  const pastilleAction = (a: ActionMarketing, grand: boolean) => (
    <button
      key={a.id}
      type="button"
      data-marketing-calendrier-action={a.id}
      data-fait={a.faitLe ? 'oui' : 'non'}
      onPointerDown={(e) => {
        glisse.current = false;
        start(e, { id: a.id, kind: 'action', label: a.titre });
      }}
      onClick={() => {
        if (!glisse.current) setActionOuverte(a.id);
        glisse.current = false;
      }}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-sm text-left',
        grand ? 'px-2 py-1.5 text-[13px]' : 'px-1 py-0.5 text-[11.5px]',
        a.faitLe ? 'bg-termine/10 text-muted line-through' : 'bg-accent/10 text-text',
        dragging?.id === a.id && 'opacity-40',
      )}
    >
      {a.faitLe ? <CheckCircle2 className="h-3 w-3 shrink-0 text-termine" /> : <Circle className="h-3 w-3 shrink-0 text-accent" />}
      <span className="min-w-0 truncate">{a.titre}</span>
    </button>
  );

  const debut = jours[0];
  const fin = jours[jours.length - 1];
  const nomsJours = jours.slice(0, 7).map((j) => dateCourte(j, { weekday: 'short' }));

  const blocAFaire = (
    <div className="flex flex-col gap-1 rounded-md bg-bloc px-3 py-2.5" data-marketing-a-faire={aFaire.length}>
      <span className="text-[13px] font-medium text-text">{t('À faire ensuite')}</span>
      {aFaire.length ? (
        aFaire.map((a) => (
          <button key={a.id} type="button" onClick={() => setActionOuverte(a.id)} className="flex min-w-0 items-center gap-2 rounded-sm py-1 text-left text-[13px] hover:bg-raised">
            <Circle className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-text">{a.titre}</span>
            {a.datePrevue ? <span className="shrink-0 text-[12px] text-faint">{dateCourte(a.datePrevue)}</span> : null}
          </button>
        ))
      ) : actions.length ? (
        <p className="text-[12.5px] text-termine">{t('Tout le plan est fait. Demandez la suite à l’agent, dans sa bulle en bas à droite.')}</p>
      ) : (
        <button type="button" onClick={onAgent} className="text-left text-[12.5px] text-faint hover:text-text">
          {t('Aucun plan pour l’instant : l’agent le pose pendant son analyse, lancée depuis sa bulle en bas à droite.')}
        </button>
      )}
    </div>
  );

  if (telephone) {
    return (
      <CalendrierContinu
        jours={jours}
        aujourdhui={aujourdhui}
        cible={target?.id ?? null}
        entete={blocAFaire}
        onPlus={(sens) => setPlage((p) => (sens < 0 ? { ...p, debut: p.debut - SEMAINES_PAR_PAQUET } : { ...p, fin: p.fin + SEMAINES_PAR_PAQUET }))}
        rendreJour={(jour) => {
          const du = parJour.get(jour) ?? [];
          return (
            <>
              {(actionsParJour.get(jour) ?? []).map((a) => pastilleAction(a, true))}
              {du.map((c) => pastille(c, true))}
              {!du.length && !actionsParJour.get(jour)?.length ? <span className="py-1 text-[12.5px] text-faint">—</span> : null}
            </>
          );
        }}
      >
        <VoletAction action={action} onClose={() => setActionOuverte(null)} />
      </CalendrierContinu>
    );
  }

  return (
    <CorpsOnglet plein>
      <div className="flex flex-1 flex-col gap-2" data-marketing-calendrier="mois" data-marketing-plan={actions.length}>
        {blocAFaire}
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Période précédente" title={t('Période précédente')} onClick={() => setDecalage((d) => d - semaines)} data-marketing-calendrier-avant>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={() => setDecalage(0)}
            className="min-w-0 flex-1 truncate rounded-md py-1 text-center text-[13px] text-text hover:bg-bloc"
            title={t('Revenir à aujourd’hui')}
          >
            {dateCourte(debut, { day: 'numeric', month: 'short' })} – {dateCourte(fin, { day: 'numeric', month: 'short' })}
          </button>
          <Button size="icon" variant="ghost" aria-label="Période suivante" title={t('Période suivante')} onClick={() => setDecalage((d) => d + semaines)} data-marketing-calendrier-apres>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <PointInfo titre={t('Le calendrier')}>
            <p>{t('Le plan de l’agent et les contenus datés, jour par jour. Les actions à faire ont un rond ; touchez-en une pour lire comment faire et la cocher.')}</p>
            <p>{t('Appuyez un instant sur un élément puis glissez-le sur un autre jour pour changer sa date.')}</p>
            <p>{t('Touchez la période pour revenir à aujourd’hui. Un contenu publié ne bouge plus.')}</p>
          </PointInfo>
        </div>

        {/* La grille prend la hauteur qui reste, partagée en rangées égales
            (`1fr` garde aussi la hauteur du contenu d'un jour chargé), sans
            passer sous 84 px par jour : sur un petit écran, l'onglet défile. */}
        <div
          className="grid flex-1 grid-cols-7 gap-1 text-[11.5px]"
          style={{ gridTemplateRows: `auto repeat(${Math.ceil(jours.length / 7)}, 1fr)` }}
        >
          {nomsJours.map((n, i) => (
            <span key={i} className="px-1 text-faint">
              {n}
            </span>
          ))}
          {jours.map((jour) => (
            <div
              key={jour}
              data-marketing-jour={jour}
              className={cn(
                'flex min-h-[84px] min-w-0 flex-col gap-0.5 rounded-md border border-transparent bg-bloc p-1.5',
                jour === aujourdhui && 'border-termine',
                target?.id === jour && 'ring-1 ring-accent',
                jour < aujourdhui && 'opacity-60',
              )}
              data-marketing-aujourdhui={jour === aujourdhui ? '' : undefined}
            >
              <span
                className={cn(
                  'text-faint',
                  jour === aujourdhui && 'flex h-5 w-5 shrink-0 items-center justify-center self-start rounded-full bg-termine text-[12px] font-medium text-termine-fg',
                )}
              >
                {Number(jour.slice(8))}
              </span>
              {(actionsParJour.get(jour) ?? []).map((a) => pastilleAction(a, false))}
              {(parJour.get(jour) ?? []).map((c) => pastille(c, false))}
            </div>
          ))}
        </div>
      </div>
      <VoletAction action={action} onClose={() => setActionOuverte(null)} />
    </CorpsOnglet>
  );
}

/**
 * LE CALENDRIER CONTINU DU TÉLÉPHONE : un jour par ligne, sans flèches ni
 * période. Deux repères invisibles, en haut et en bas de la liste, font venir
 * quatre semaines de plus quand ils approchent de l'écran — un paquet par
 * approche : l'observateur n'est créé qu'UNE fois, et chaque paquet repousse
 * son repère loin hors de vue. Un ajout EN HAUT recale le défilement de la
 * hauteur ajoutée : ce qu'on lisait ne bouge pas. L'écran s'ouvre sur
 * aujourd'hui ; le mois lu s'affiche au-dessus de la liste, et le toucher y
 * ramène. Les cellules gardent `data-marketing-jour` : le glisser de
 * l'application (`usePointerDrag`) les trouve comme dans la grille.
 */
function CalendrierContinu({
  jours,
  aujourdhui,
  cible,
  entete,
  onPlus,
  rendreJour,
  children,
}: {
  jours: string[];
  aujourdhui: string;
  cible: string | null;
  entete: React.ReactNode;
  onPlus: (sens: -1 | 1) => void;
  rendreJour: (jour: string) => React.ReactNode;
  children?: React.ReactNode;
}) {
  const zone = React.useRef<HTMLDivElement | null>(null);
  const haut = React.useRef<HTMLDivElement | null>(null);
  const bas = React.useRef<HTMLDivElement | null>(null);
  const [mois, setMois] = React.useState(aujourdhui.slice(0, 7));
  const onPlusRef = React.useRef(onPlus);
  onPlusRef.current = onPlus;
  // La ligne lue juste avant un ajout en haut, et sa position : le recalage
  // la remet au même endroit (le titre de mois du début de liste bouge, une
  // simple différence de hauteur ne suffit pas).
  const avantAjout = React.useRef<{ jour: string; y: number } | null>(null);
  const place = React.useRef(false);

  const allerA = React.useCallback((jour: string, doux: boolean) => {
    const z = zone.current;
    const ligne = z?.querySelector(`[data-marketing-jour="${jour}"]`);
    if (!z || !ligne) return false;
    const top = ligne.getBoundingClientRect().top - z.getBoundingClientRect().top + z.scrollTop - 4;
    z.scrollTo({ top, behavior: doux ? 'smooth' : 'auto' });
    return true;
  }, []);

  // Le mois lu : celui de la première ligne visible en haut de la zone.
  const lireMois = React.useCallback(() => {
    const z = zone.current;
    if (!z) return;
    const hautZone = z.getBoundingClientRect().top;
    for (const ligne of z.querySelectorAll<HTMLElement>('[data-marketing-jour]')) {
      if (ligne.getBoundingClientRect().bottom > hautZone + 8) {
        const jour = ligne.getAttribute('data-marketing-jour') ?? '';
        setMois(jour.slice(0, 7));
        return;
      }
    }
  }, []);

  // Ouverture sur aujourd'hui, dès que la zone a une taille (l'onglet peut
  // être monté caché).
  React.useLayoutEffect(() => {
    const z = zone.current;
    if (!z) return;
    const essayer = () => {
      if (place.current || z.clientHeight === 0) return;
      place.current = allerA(aujourdhui, false);
    };
    essayer();
    const suivi = new ResizeObserver(essayer);
    suivi.observe(z);
    return () => suivi.disconnect();
  }, [aujourdhui, allerA]);

  // Recalage après un ajout en haut, avant que l'écran ne soit peint.
  React.useLayoutEffect(() => {
    const z = zone.current;
    const repere = avantAjout.current;
    if (!z || !repere) return;
    avantAjout.current = null;
    const ligne = z.querySelector(`[data-marketing-jour="${repere.jour}"]`);
    if (ligne) z.scrollTop += ligne.getBoundingClientRect().top - z.getBoundingClientRect().top - repere.y;
  }, [jours[0]]);

  React.useEffect(() => {
    const z = zone.current;
    if (!z || !haut.current || !bas.current) return;
    const observateur = new IntersectionObserver(
      (entrees) => {
        // Rien avant d'être posé sur aujourd'hui : le repère du haut est
        // visible un instant à l'ouverture.
        if (!place.current) return;
        for (const e of entrees) {
          if (!e.isIntersecting) continue;
          if (e.target === haut.current) {
            if (avantAjout.current) continue;
            const premiere = z.querySelector('[data-marketing-jour]');
            if (!premiere) continue;
            avantAjout.current = {
              jour: premiere.getAttribute('data-marketing-jour') ?? '',
              y: premiere.getBoundingClientRect().top - z.getBoundingClientRect().top,
            };
            onPlusRef.current(-1);
          } else onPlusRef.current(1);
        }
      },
      { root: z, rootMargin: '200px 0px' },
    );
    observateur.observe(haut.current);
    observateur.observe(bas.current);
    let image = 0;
    const auDefilement = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(lireMois);
    };
    z.addEventListener('scroll', auDefilement, { passive: true });
    return () => {
      observateur.disconnect();
      cancelAnimationFrame(image);
      z.removeEventListener('scroll', auDefilement);
    };
  }, [lireMois]);

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2" data-marketing-calendrier="continu">
        {entete}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => allerA(aujourdhui, true)}
            className="min-w-0 flex-1 truncate rounded-md py-1 text-left text-[13px] font-medium capitalize text-text hover:bg-bloc"
            title={t('Revenir à aujourd’hui')}
            data-marketing-calendrier-mois={mois}
          >
            {dateCourte(`${mois}-15`, { month: 'long', year: 'numeric' })}
          </button>
          <PointInfo titre={t('Le calendrier')}>
            <p>{t('Le plan de l’agent et les contenus datés, jour par jour. Les actions à faire ont un rond ; touchez-en une pour lire comment faire et la cocher.')}</p>
            <p>{t('Appuyez un instant sur un élément puis glissez-le sur un autre jour pour changer sa date.')}</p>
            <p>{t('Faites défiler pour voir les jours passés ou à venir ; touchez le mois pour revenir à aujourd’hui. Un contenu publié ne bouge plus.')}</p>
          </PointInfo>
        </div>
      </div>
      <ZoneDefilement ref={zone} fond="hsl(var(--surface))" className="px-3 pb-4">
        <div ref={haut} aria-hidden className="h-px" data-marketing-calendrier-haut />
        <div className="flex flex-col gap-1">
          {jours.map((jour, i) => (
            <React.Fragment key={jour}>
              {i === 0 || jour.endsWith('-01') ? (
                <span className="px-1 pb-0.5 pt-2 text-[12px] font-medium capitalize text-faint">{dateCourte(jour, { month: 'long', year: 'numeric' })}</span>
              ) : null}
              <div
                data-marketing-jour={jour}
                className={cn(
                  'flex min-h-[52px] items-start gap-3 rounded-md border border-transparent bg-bloc px-3 py-2',
                  jour === aujourdhui && 'border-termine',
                  cible === jour && 'ring-1 ring-accent',
                  jour < aujourdhui && 'opacity-60',
                )}
                data-marketing-aujourdhui={jour === aujourdhui ? '' : undefined}
              >
                <span className="flex w-10 shrink-0 flex-col items-start leading-tight text-faint">
                  <span className="text-[11.5px] uppercase">{dateCourte(jour, { weekday: 'short' })}</span>
                  <span
                    className={cn(
                      'text-[16px] font-medium',
                      jour === aujourdhui && 'flex h-6 w-6 items-center justify-center rounded-full bg-termine text-[14px] text-termine-fg',
                    )}
                  >
                    {Number(jour.slice(8))}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">{rendreJour(jour)}</span>
              </div>
            </React.Fragment>
          ))}
        </div>
        <div ref={bas} aria-hidden className="h-px" data-marketing-calendrier-bas />
      </ZoneDefilement>
      {children}
    </>
  );
}

/** UNE ACTION DU PLAN, ouverte : quoi faire et comment, et le geste « fait ». */
function VoletAction({ action, onClose }: { action: ActionMarketing | null; onClose: () => void }) {
  const [envoi, setEnvoi] = React.useState(false);
  if (!action) return null;
  const basculer = async () => {
    setEnvoi(true);
    try {
      await client.call({ type: 'marketing.action.faite', id: action.id, fait: !action.faitLe });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Action non modifiée'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <VoletInfo ouvert titre={action.titre} onClose={onClose}>
      <p className="text-[12.5px] text-faint">
        {[action.datePrevue ? dateCourte(action.datePrevue) : null, action.canal ? libelleCanal(action.canal) : null].filter(Boolean).join(' · ')}
      </p>
      {action.detail ? (
        <div data-marketing-action-detail>
          <Markdown content={action.detail} />
        </div>
      ) : null}
      <Button size="pied" variant={action.faitLe ? 'subtle' : 'default'} disabled={envoi} onClick={() => void basculer()} data-marketing-action-faite={action.faitLe ? 'oui' : 'non'}>
        {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        {action.faitLe ? t('Remettre à faire') : t('C’est fait')}
      </Button>
    </VoletInfo>
  );
}

/* ------------------------------------------------------------------ */
/* Canaux                                                               */
/* ------------------------------------------------------------------ */

function libellePertinence(p: string): string {
  return p === 'haute' ? t('Recommandé') : p === 'moyenne' ? t('À envisager') : t('Peu utile ici');
}

/**
 * LES CANAUX, EN DEUX VUES. La LISTE n'est qu'une colonne de boutons courts —
 * le nom, l'avis de l'agent en un mot, une coche si le canal est retenu — :
 * vos canaux en tête, puis les autres rangés par famille. Un toucher ouvre la
 * FICHE du canal : à quoi il sert, l'avis de l'agent pour CE produit, puis le
 * PARCOURS pas à pas (la base du catalogue, complétée par les conseils de
 * l'agent). Choisir ou retirer le canal se fait sur la fiche.
 */
function OngletCanaux({ projectId, donnees, onAgent }: { projectId: string; donnees: EspaceComplet; onAgent: () => void }) {
  const config = donnees.espace?.configuration;
  const lignes = canauxDansLOrdre({ canaux: config?.canaux ?? [], recommandations: config?.recommandations ?? [] });
  const choisis = lignes.filter((l) => l.choisi);
  const autres = lignes.filter((l) => !l.choisi);
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const [ouvert, setOuvert] = React.useState<string | null>(null);
  const defilement = React.useRef<HTMLDivElement | null>(null);
  // La position de la liste, retrouvée au retour d'une fiche.
  const positionListe = React.useRef(0);
  const aDesAvis = (config?.recommandations ?? []).length > 0;

  React.useLayoutEffect(() => {
    if (defilement.current) defilement.current.scrollTop = ouvert ? 0 : positionListe.current;
  }, [ouvert]);

  const ouvrir = (cle: string | null) => {
    if (cle && defilement.current) positionListe.current = defilement.current.scrollTop;
    setOuvert(cle);
  };

  const basculer = async (cle: string) => {
    const actuels = config?.canaux ?? [];
    const suivants = actuels.includes(cle) ? actuels.filter((c) => c !== cle) : [...actuels, cle];
    setEnvoi(cle);
    try {
      await client.call({ type: 'marketing.configurer', projectId, configuration: { canaux: suivants } });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Canal non modifié'));
    } finally {
      setEnvoi(null);
    }
  };

  const ligneOuverte = ouvert ? lignes.find((l) => l.canal.cle === ouvert) : undefined;
  if (ligneOuverte) {
    return (
      <CorpsOnglet refDefilement={defilement}>
        <FicheCanal ligne={ligneOuverte} envoi={envoi === ligneOuverte.canal.cle} onBasculer={() => void basculer(ligneOuverte.canal.cle)} onRetour={() => ouvrir(null)} onAgent={onAgent} />
      </CorpsOnglet>
    );
  }

  const bouton = (l: (typeof lignes)[number]) => (
    <li key={l.canal.cle}>
      <button
        type="button"
        onClick={() => ouvrir(l.canal.cle)}
        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-md bg-bloc px-3 py-2 text-left hover:bg-raised"
        data-marketing-canal={l.canal.cle}
        data-choisi={l.choisi ? 'oui' : 'non'}
        data-pertinence={l.recommandation?.pertinence ?? ''}
      >
        {l.choisi ? <CheckCircle2 className="h-4 w-4 shrink-0 text-termine" /> : <Circle className="h-4 w-4 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{t(l.canal.libelle)}</span>
        {l.recommandation ? <PastillePertinence pertinence={l.recommandation.pertinence} /> : null}
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
      </button>
    </li>
  );

  const groupe = (titre: string, liste: typeof lignes, famille?: string) =>
    liste.length ? (
      <div key={titre} className="flex flex-col gap-1" data-marketing-groupe={famille ?? 'choisis'}>
        <span className="px-0.5 text-[12px] font-medium text-muted">{titre}</span>
        <ul className="flex flex-col gap-1">{liste.map(bouton)}</ul>
      </div>
    ) : null;

  return (
    <CorpsOnglet refDefilement={defilement}>
      <div className="flex flex-col gap-4" data-marketing-canaux={choisis.length} data-marketing-catalogue={lignes.length}>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[13px] text-muted">
            {aDesAvis ? t('Touchez un canal pour voir l’avis de l’agent et le parcours à suivre.') : t('Tous les canaux qui peuvent amener des clients.')}
          </span>
          <PointInfo titre={t('Les canaux')}>
            <p>{t('Un canal, c’est un endroit où vos futurs clients peuvent vous découvrir : un réseau social, Google, une lettre d’information, un salon…')}</p>
            <p>{t('Mieux vaut peu de canaux bien tenus que tous à la fois. L’agent dit lesquels conviennent à votre produit et par quoi commencer ; vous choisissez.')}</p>
            <p>
              {t(
                'La publication directe par le navigateur du serveur arrive dans une prochaine étape. En attendant, copiez le texte d’un contenu prêt, publiez-le, puis marquez-le comme publié : son lien de suivi continue de compter les visites.',
              )}
            </p>
          </PointInfo>
        </div>
        {!aDesAvis ? (
          <button type="button" onClick={onAgent} className="rounded-md bg-bloc px-3 py-2.5 text-left text-[12.5px] text-muted hover:bg-raised" data-marketing-canaux-sans-avis>
            {t('L’agent n’a pas encore donné son avis. Lancez son analyse depuis la bulle de l’agent : il vous dira lesquels choisir.')}
          </button>
        ) : null}
        {groupe(t('Vos canaux'), choisis)}
        {FAMILLES_CANAL.map((famille) =>
          groupe(
            t(LIBELLE_FAMILLE_CANAL[famille]),
            autres.filter((l) => l.canal.famille === famille),
            famille,
          ),
        )}
      </div>
    </CorpsOnglet>
  );
}

function PastillePertinence({ pertinence }: { pertinence: string }) {
  return (
    <Badge tone={pertinence === 'haute' ? 'success' : pertinence === 'moyenne' ? 'neutral' : 'warning'} className="shrink-0">
      {libellePertinence(pertinence)}
    </Badge>
  );
}

/** Un bloc de la fiche : un intitulé discret, puis son contenu sur le fond de bloc. */
function BlocDeFiche({ titre, children, ...props }: { titre: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className="flex flex-col gap-1.5" {...props}>
      <h3 className="px-0.5 text-[12px] font-medium text-muted">{titre}</h3>
      <div className="rounded-md bg-bloc px-3 py-2.5">{children}</div>
    </section>
  );
}

/**
 * LA FICHE D'UN CANAL : ce qu'on y fait, et dans quel ordre. Le parcours se
 * lit comme un flux à points numérotés ; le premier pas conseillé par l'agent,
 * quand il existe, est mis en avant au-dessus, et ses conseils propres au
 * produit ferment la marche.
 */
function FicheCanal({
  ligne,
  envoi,
  onBasculer,
  onRetour,
  onAgent,
}: {
  ligne: ReturnType<typeof canauxDansLOrdre>[number];
  envoi: boolean;
  onBasculer: () => void;
  onRetour: () => void;
  onAgent: () => void;
}) {
  const { canal, choisi, recommandation } = ligne;
  const parcours = parcoursDuCanal(canal.cle);
  const conseils = recommandation?.etapes ?? [];
  /* QUITTER UN CANAL SE CONFIRME : le choisir est un clic, l'abandonner en
     demande deux. « Annuler » ne touche à rien. */
  const [confirmerAbandon, setConfirmerAbandon] = React.useState(false);
  return (
    <div className="flex flex-col gap-4 pt-1" data-marketing-fiche-canal={canal.cle}>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" className="-ml-2 shrink-0" onClick={onRetour} data-marketing-canal-retour>
          <ArrowLeft className="h-4 w-4" />
          {t('Tous les canaux')}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-[17px] font-semibold text-text">
          <span className="min-w-0 truncate">{t(canal.libelle)}</span>
          {/* LE CANAL EST CHOISI : la mention reste près du titre, puisque le
              bouton dit désormais le geste inverse. */}
          {choisi ? (
            <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-termine" data-marketing-canal-choisi={canal.cle}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('Choisi')}
            </span>
          ) : null}
        </h2>
        {choisi ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-danger hover:text-danger"
            disabled={envoi}
            onClick={() => setConfirmerAbandon(true)}
            data-marketing-canal-choix={canal.cle}
            data-marketing-canal-abandon={canal.cle}
          >
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            {t('Abandonner')}
          </Button>
        ) : (
          <Button size="sm" variant="default" className="shrink-0" disabled={envoi} onClick={onBasculer} data-marketing-canal-choix={canal.cle}>
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('Choisir')}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmerAbandon}
        title={t('Abandonner ce canal ?')}
        description={t('« {canal} » quitte vos canaux. Les conseils de l’agent et les contenus déjà prévus restent, et vous pourrez le choisir de nouveau.', { canal: t(canal.libelle) })}
        confirmLabel={t('Abandonner')}
        danger
        onConfirm={onBasculer}
        onClose={() => setConfirmerAbandon(false)}
      />

      <BlocDeFiche titre={t('À quoi ça sert')}>
        <p className="text-[13px] text-text">{t(canal.description)}</p>
      </BlocDeFiche>

      <BlocDeFiche titre={t('L’avis de l’agent')} data-marketing-fiche-avis={recommandation ? 'oui' : 'non'}>
        {recommandation ? (
          <div className="flex flex-col items-start gap-1.5">
            <PastillePertinence pertinence={recommandation.pertinence} />
            <p className="text-[13px] text-text">{recommandation.raison}</p>
          </div>
        ) : (
          <button type="button" onClick={onAgent} className="text-left text-[12.5px] text-muted hover:text-text">
            {t('L’agent n’a pas encore donné son avis sur ce canal. Lancez son analyse depuis la bulle de l’agent.')}
          </button>
        )}
      </BlocDeFiche>

      <section className="flex flex-col gap-1.5" data-marketing-parcours={parcours.length}>
        <h3 className="px-0.5 text-[12px] font-medium text-muted">{t('Le parcours')}</h3>
        {recommandation?.premierPas ? (
          <div className="rounded-md bg-bloc px-3 py-2.5" data-marketing-premier-pas>
            <span className="text-[12px] font-medium text-accent">{t('Pour commencer')}</span>
            <p className="text-[13px] text-text">{recommandation.premierPas}</p>
          </div>
        ) : null}
        <ol className="flex flex-col rounded-md bg-bloc px-3 py-3">
          {parcours.map((etape, i) => (
            <li key={etape.titre + i} className="flex gap-3" data-marketing-etape={i + 1}>
              <span className="flex flex-col items-center">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold text-text">{i + 1}</span>
                {i < parcours.length - 1 ? <span className="w-px flex-1 bg-faint" /> : null}
              </span>
              <span className={cn('flex min-w-0 flex-1 flex-col gap-0.5', i < parcours.length - 1 && 'pb-3')}>
                <span className="pt-0.5 text-[13.5px] font-medium text-text">{t(etape.titre)}</span>
                <span className="text-[12.5px] text-muted">{t(etape.detail)}</span>
              </span>
            </li>
          ))}
        </ol>
        {conseils.length ? (
          <div className="flex flex-col gap-1 rounded-md bg-bloc px-3 py-2.5" data-marketing-conseils={conseils.length}>
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-accent">
              <Sparkles className="h-3.5 w-3.5" />
              {t('Les conseils de l’agent pour votre produit')}
            </span>
            <ul className="flex flex-col gap-1">
              {conseils.map((conseil, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-text">
                  <span className="text-faint">•</span>
                  <span className="min-w-0 flex-1">{conseil}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Le tiroir d'un contenu                                               */
/* ------------------------------------------------------------------ */

function gestes(): { vers: EtapeContenu; libelle: string; depuis: EtapeContenu[] }[] {
  return [
    { vers: 'pret', libelle: t('Valider'), depuis: ['brouillon', 'a_valider', 'echec'] },
    { vers: 'programme', libelle: t('Programmer'), depuis: ['pret', 'echec'] },
    { vers: 'publie', libelle: t('Marquer comme publié'), depuis: ['pret', 'programme'] },
    { vers: 'a_valider', libelle: t('Remettre à valider'), depuis: ['pret'] },
    { vers: 'pret', libelle: t('Déprogrammer'), depuis: ['programme'] },
    { vers: 'abandonne', libelle: t('Abandonner'), depuis: ['brouillon', 'a_valider', 'pret', 'programme', 'echec'] },
    { vers: 'brouillon', libelle: t('Reprendre'), depuis: ['abandonne'] },
  ];
}

/**
 * LA FICHE D'UN CONTENU. Le pied porte UNE action principale : « Enregistrer »
 * tant qu'une modification attend, sinon le prochain pas du contenu. Les
 * autres pas sont en dessous, discrets ; copier et supprimer sont des icônes
 * nommées de l'entête.
 */
function TiroirContenu({ contenu, adresseLiens, onClose }: { contenu: ContenuMarketing | null; adresseLiens: string; onClose: () => void }) {
  const [titre, setTitre] = React.useState('');
  const [texte, setTexte] = React.useState('');
  const [date, setDate] = React.useState('');
  const [heure, setHeure] = React.useState('');
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [aSupprimer, setASupprimer] = React.useState(false);

  React.useEffect(() => {
    setTitre(contenu?.titre ?? '');
    setTexte(contenu?.texte ?? '');
    setDate(contenu?.datePrevue ?? '');
    setHeure(contenu?.heurePrevue ?? '');
  }, [contenu?.id, contenu?.majLe]);

  if (!contenu) return null;
  const modifie = titre !== contenu.titre || texte !== contenu.texte || date !== (contenu.datePrevue ?? '') || heure !== (contenu.heurePrevue ?? '');
  const publie = contenu.etape === 'publie';
  const lien = contenu.lienCode ? `${adresseLiens}${contenu.lienCode}` : null;

  const appeler = async (cle: string, cmd: any) => {
    setEnCours(cle);
    try {
      await client.call(cmd);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Geste refusé'));
    } finally {
      setEnCours(null);
    }
  };
  const enregistrer = () =>
    appeler('enregistrer', { type: 'marketing.contenu.modifier', id: contenu.id, titre, texte, datePrevue: date || null, heurePrevue: heure || null });

  const possibles = gestes().filter((g) => g.depuis.includes(contenu.etape));
  const impossible = (g: { vers: EtapeContenu }) => g.vers === 'programme' && !contenu.datePrevue;
  const principal = possibles.find((g) => g.vers !== 'abandonne' && !impossible(g)) ?? null;
  const secondaires = possibles.filter((g) => g !== principal);
  const boutonGeste = (g: { vers: EtapeContenu; libelle: string }, primaire: boolean) => (
    <Button
      key={`${g.vers}-${g.libelle}`}
      size={primaire ? 'pied' : 'sm'}
      variant={primaire ? 'default' : 'ghost'}
      className={primaire ? 'sm:w-auto' : undefined}
      disabled={!!enCours || modifie || impossible(g)}
      title={impossible(g) ? t('Donnez-lui une date pour pouvoir le programmer.') : undefined}
      onClick={() => void appeler(g.vers, { type: 'marketing.contenu.etape', id: contenu.id, etape: g.vers })}
      data-marketing-geste={g.vers}
    >
      {enCours === g.vers ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {g.libelle}
    </Button>
  );

  return (
    <>
      <Drawer open onClose={onClose} empile hauteurFixe>
        <header className="flex shrink-0 items-center gap-1 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">{contenu.titre}</DialogTitle>
          <Badge tone={toneEtape(contenu.etape)}>{t(LIBELLE_ETAPE[contenu.etape])}</Badge>
          <ActionsEntete
            actions={[
              { cle: 'texte', libelle: t('Copier le texte'), icone: <Copy className="h-3.5 w-3.5" />, onClick: () => void copier(texte, t('Texte')), repere: 'data-marketing-copier-texte' },
              ...(lien
                ? [{ cle: 'lien', libelle: t('Copier le lien de suivi'), icone: <Link2 className="h-3.5 w-3.5" />, onClick: () => void copier(lien, t('Lien de suivi')), repere: 'data-marketing-copier-lien' }]
                : []),
              ...(!publie
                ? [{ cle: 'supprimer', libelle: t('Supprimer'), icone: <Trash2 className="h-3.5 w-3.5" />, onClick: () => setASupprimer(true), repere: 'data-marketing-supprimer' }]
                : []),
            ]}
            info={{
              titre: t('Un contenu'),
              contenu: (
                <>
                  <p>{t('Relisez et corrigez le texte, donnez-lui une date, puis faites-le avancer : valider, programmer, marquer comme publié.')}</p>
                  <p>{t('Mettez ce lien dans le post à la place de l’adresse du site : chaque visite et chaque vente qu’il amène sont comptées pour ce contenu.')}</p>
                  <p>{t('Programmé : il vous sera rappelé dans le calendrier. Publiez-le à la date prévue, puis marquez-le comme publié.')}</p>
                </>
              ),
            }}
          />
        </header>
        <CorpsOnglet
          pied={
            modifie ? (
              <Button size="pied" className="sm:w-auto" disabled={!!enCours} onClick={() => void enregistrer()} data-marketing-tiroir-enregistrer>
                {enCours === 'enregistrer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t('Enregistrer')}
              </Button>
            ) : principal ? (
              boutonGeste(principal, true)
            ) : null
          }
        >
          <div className="flex flex-col gap-2.5" data-marketing-tiroir={contenu.id} data-etape={contenu.etape}>
            <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
              <span>{libelleCanal(contenu.canal)}</span>
              {contenu.origine === 'nouveaute' ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('Tiré d’une livraison')}</span>
                </>
              ) : contenu.origine === 'agent' || contenu.origine === 'hebdo' ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('Rédigé par l’agent')}</span>
                </>
              ) : null}
            </div>
            <Input value={titre} disabled={publie} onChange={(e) => setTitre(e.target.value)} className="text-[13px]" data-marketing-tiroir-titre />
            <Textarea rows={10} value={texte} disabled={publie} onChange={(e) => setTexte(e.target.value)} className="text-[13px]" data-marketing-tiroir-texte />
            {/* LA DATE ET L'HEURE L'UNE SOUS L'AUTRE SUR TÉLÉPHONE : les champs
                natifs de date et d'heure ont une largeur minimale à eux, qui
                débordait de la moitié d'écran et faisait chevaucher les deux.
                `min-w-0` et `appearance-none` les ramènent dans leur case. */}
            <div className="grid grid-cols-1 gap-2 text-[12.5px] sm:grid-cols-2" data-marketing-tiroir-quand>
              <label className="flex min-w-0 flex-col gap-1 text-muted">
                {t('Date prévue')}
                <Input type="date" value={date} disabled={publie} onChange={(e) => setDate(e.target.value)} className="w-full min-w-0 appearance-none text-[13px]" data-marketing-tiroir-date />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-muted">
                {t('Heure')}
                <Input type="time" value={heure} disabled={publie} onChange={(e) => setHeure(e.target.value)} className="w-full min-w-0 appearance-none text-[13px]" data-marketing-tiroir-heure />
              </label>
            </div>
            {secondaires.length ? (
              <div className="flex flex-wrap items-center gap-1" data-marketing-gestes>
                {secondaires.map((g) => boutonGeste(g, false))}
              </div>
            ) : null}
          </div>
        </CorpsOnglet>
      </Drawer>
      <ConfirmDialog
        open={aSupprimer}
        title={t('Supprimer ce contenu ?')}
        description={contenu.titre}
        confirmLabel={t('Supprimer')}
        danger
        onConfirm={() => {
          setASupprimer(false);
          void appeler('supprimer', { type: 'marketing.contenu.supprimer', id: contenu.id }).then(onClose);
        }}
        onClose={() => setASupprimer(false)}
      />
    </>
  );
}
