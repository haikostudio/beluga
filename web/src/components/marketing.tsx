import * as React from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  FileText,
  Info,
  Link2,
  Loader2,
  Megaphone,
  MessageCircleQuestion,
  PenLine,
  Plus,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  type ActionMarketing,
  type Agent,
  type ContenuMarketing,
  type EspaceMarketing,
  type EtapeContenu,
  type EtatBoutonMarketing,
  type FicheMarketing,
  type GesteAgentMarketing,
  type GuideMarketing,
  type JalonDuGuide,
  type ResultatsMarketing,
  CANAUX_CONTENU,
  LIBELLE_ETAPE,
  agentTientSonTour,
  canalDuCatalogue,
  canauxDansLOrdre,
  decisionsQuiAlertent,
  etatDuBoutonMarketing,
  indicateursDe,
  jourValide,
} from '@beluga/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
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
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { usePointerDrag, type DropTarget } from '@/lib/dnd';

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
 *    `etatDuBoutonMarketing`) est le pied pleine largeur de ce Guide :
 *    « Initialiser », l'avancement n/N, la question, puis « Rapport », qui
 *    ouvre le dernier rapport enregistré en lecture ;
 *  - Canaux montre TOUT le catalogue avec l'avis de l'agent, le Calendrier
 *    porte son plan d'action daté à côté des contenus, et Statistiques trace
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
  avancement: number;
  prochaineAction: string | null;
  aUnAgent: boolean;
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

function libelleSuivi(cle: string): string {
  const libelles: Record<string, string> = {
    absent: t('Mesure non installée'),
    pose: t('Mesure en attente de la première visite'),
    verifie: t('Mesure en place'),
  };
  return libelles[cle] ?? cle;
}

function libelleCanal(cle: string): string {
  const canal = canalDuCatalogue(cle);
  if (canal) return t(canal.libelle);
  return cle === 'autre' ? t('Autre') : cle;
}

async function copier(texte: string, quoi: string) {
  try {
    await navigator.clipboard.writeText(texte);
    client.pushToast('success', t('{quoi} copié', { quoi }));
  } catch {
    client.pushToast('error', t('Copie impossible'));
  }
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

function dateCourte(jour: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Date(`${jour}T12:00:00`).toLocaleDateString(formatRegional(), options);
}

function montant(centimes: number | null | undefined): string {
  if (typeof centimes !== 'number') return '—';
  return (centimes / 100).toLocaleString(formatRegional(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/**
 * LE CORPS D'UN ONGLET : ce qui défile, puis le PIED qui garde l'action
 * principale sous le pouce, en pleine largeur sur téléphone.
 */
function CorpsOnglet({ children, pied }: { children: React.ReactNode; pied?: React.ReactNode }) {
  return (
    <>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-4">
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
}: {
  open: boolean;
  onClose: () => void;
  enPage?: boolean;
  /** LE PROJET DÉSIGNÉ PAR L'ADRESSE : « #marketing/<projet> ». */
  vise?: string | null;
  onVise?: (projectId: string | null) => void;
}) {
  const [projets, setProjets] = React.useState<LigneProjetMarketing[] | null>(null);
  const projectId = vise ?? null;

  React.useEffect(() => {
    if (!open || projectId) return;
    let vivant = true;
    client
      .call<{ projets: LigneProjetMarketing[] }>({ type: 'marketing.lister' })
      .then((r) => vivant && setProjets(r.projets))
      .catch(() => vivant && setProjets([]));
    return () => {
      vivant = false;
    };
  }, [open, projectId]);

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      {projectId ? (
        <EspaceDuProjet projectId={projectId} onRetour={() => onVise?.(null)} />
      ) : (
        <>
          <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
            <Megaphone className="h-3.5 w-3.5 shrink-0 text-accent" />
            <DialogTitle className="min-w-0 flex-1 truncate">{t('Marketing')}</DialogTitle>
            <PointInfo titre={t('Marketing')}>
              <p>
                {t(
                  'Chaque projet a son agent marketing. Il comprend le produit, rédige ce qui sert à le vendre, et mesure ce que chaque publication rapporte. Rien ne part sans votre accord.',
                )}
              </p>
            </PointInfo>
          </header>
          <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
            {projets === null ? (
              <SilhouetteMarketing />
            ) : !projets.length ? (
              <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucun projet actif.')}</p>
            ) : (
              <div className="flex flex-col gap-1" data-marketing-liste={projets.length}>
                {projets.map((p) => (
                  <LigneProjet key={p.projectId} ligne={p} onOuvrir={() => onVise?.(p.projectId)} />
                ))}
              </div>
            )}
          </ZoneDefilement>
        </>
      )}
    </Drawer>
  );
}

function LigneProjet({ ligne, onOuvrir }: { ligne: LigneProjetMarketing; onOuvrir: () => void }) {
  return (
    <button
      type="button"
      data-marketing-projet={ligne.projectId}
      onClick={onOuvrir}
      className="flex w-full items-center gap-2 rounded-md bg-bloc px-3 py-2.5 text-left hover:bg-raised"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{ligne.nom}</span>
          <Badge tone={ligne.avancement >= 100 ? 'success' : 'neutral'}>
            {ligne.nature ? libelleNature(ligne.nature) : t('À découvrir')}
          </Badge>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-[12px] text-faint">
          <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-faint/20">
            <span
              className={cn('block h-full rounded-full', ligne.avancement >= 100 ? 'bg-termine' : 'bg-en-cours')}
              style={{ width: `${ligne.avancement}%` }}
            />
          </span>
          <span className="shrink-0">{ligne.avancement} %</span>
          {ligne.prochaineAction ? <span className="min-w-0 truncate">{t(ligne.prochaineAction)}</span> : null}
        </span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* L'espace d'un projet                                                 */
/* ------------------------------------------------------------------ */

type Onglet = 'guide' | 'positionnement' | 'contenus' | 'calendrier' | 'canaux' | 'statistiques';

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

  // Réclamé à chaque changement d'agent : `chargerAgent` rend celui qu'on
  // connaît déjà, et réclame son fil s'il n'a jamais été demandé.
  React.useEffect(() => {
    if (agentId) void client.chargerAgent(agentId);
  }, [agentId]);

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

  return { agentId, agent, etat, travaille, questions, envoi, lancer };
}

function EspaceDuProjet({ projectId, onRetour }: { projectId: string; onRetour: () => void }) {
  const state = useApp();
  const version = state.marketingVersions[projectId] ?? 0;
  const [donnees, setDonnees] = React.useState<EspaceComplet | null>(null);
  const [jours, setJours] = React.useState(30);
  const [onglet, setOnglet] = React.useState<Onglet>('guide');
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

  const agent = useAgentMarketing(projectId, donnees?.espace);
  const contenu = donnees?.contenus.find((c) => c.id === contenuOuvert) ?? null;

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Button variant="ghost" size="icon" aria-label="Tous les projets" title={t('Tous les projets')} onClick={onRetour} data-marketing-retour>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <DialogTitle className="min-w-0 flex-1 truncate">{donnees?.nom ?? t('Marketing')}</DialogTitle>
        <PointInfo titre={t('L’atelier marketing')}>
          <p>{t('L’agent marketing étudie le projet, puis rédige ce qui sert à le vendre. Vous relisez et validez : rien ne part sans vous.')}</p>
          <p>{t('Le Guide est sa conversation : il y analyse chaque point, y rend son rapport, et vous lui répondez juste dessous pour le corriger.')}</p>
        </PointInfo>
      </header>

      {!donnees ? (
        <div className="px-2">
          <SilhouetteMarketing lignes={3} />
        </div>
      ) : (
        <Tabs value={onglet} onValueChange={(v) => setOnglet(v as Onglet)} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-3 pb-2">
            <TabsList defilable>
              <TabsTrigger value="guide" data-marketing-onglet="guide" className="gap-1">
                {t('Guide')}
                <RepereAttention compte={agent.questions} />
              </TabsTrigger>
              <TabsTrigger value="positionnement" data-marketing-onglet="positionnement">{t('Positionnement')}</TabsTrigger>
              <TabsTrigger value="contenus" data-marketing-onglet="contenus">{t('Contenus')}</TabsTrigger>
              <TabsTrigger value="calendrier" data-marketing-onglet="calendrier">{t('Calendrier')}</TabsTrigger>
              <TabsTrigger value="canaux" data-marketing-onglet="canaux">{t('Canaux')}</TabsTrigger>
              <TabsTrigger value="statistiques" data-marketing-onglet="statistiques">{t('Statistiques')}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="guide" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletGuide donnees={donnees} projectId={projectId} suivi={agent} />
          </TabsContent>
          <TabsContent value="positionnement" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletPositionnement projectId={projectId} fiche={donnees.espace?.fiche ?? {}} />
          </TabsContent>
          <TabsContent value="contenus" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletContenus
              contenus={donnees.contenus}
              onOuvrir={setContenuOuvert}
              aUnAgent={agent.etat !== 'initialiser'}
              onAgent={() => setOnglet('guide')}
              onEcrire={() => setCreation(true)}
            />
          </TabsContent>
          <TabsContent value="calendrier" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletCalendrier projectId={projectId} contenus={donnees.contenus} actions={donnees.actions ?? []} onOuvrir={setContenuOuvert} onAgent={() => setOnglet('guide')} />
          </TabsContent>
          <TabsContent value="canaux" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletCanaux projectId={projectId} donnees={donnees} onAgent={() => setOnglet('guide')} />
          </TabsContent>
          <TabsContent value="statistiques" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <OngletStatistiques donnees={donnees} jours={jours} onJours={setJours} />
          </TabsContent>
        </Tabs>
      )}

      <TiroirContenu contenu={contenu} adresseLiens={donnees?.adresseLiens ?? ''} onClose={() => setContenuOuvert(null)} />
      <TiroirNouveauContenu ouvert={creation} projectId={projectId} onClose={() => setCreation(false)} />
    </>
  );
}

/**
 * LE BOUTON UNIQUE DE L'AGENT, pied pleine largeur du Guide. Il part en
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
/* Guide                                                                */
/* ------------------------------------------------------------------ */

/**
 * LE GUIDE : l'agent lui-même. Une fine barre d'avancement en tête (touchée,
 * elle détaille les points), la conversation de l'agent sur toute la hauteur —
 * sa liste de tâches collée au champ d'écriture, son rapport dans le fil — et
 * le bouton unique en pied.
 */
function OngletGuide({ donnees, projectId, suivi }: { donnees: EspaceComplet; projectId: string; suivi: ReturnType<typeof useAgentMarketing> }) {
  const { guide } = donnees;
  const espace = donnees.espace;
  const config = espace?.configuration;
  const [points, setPoints] = React.useState(false);
  const [rapport, setRapport] = React.useState(false);
  const [confirmer, setConfirmer] = React.useState(false);
  const { agent, agentId, etat } = suivi;

  const surBouton = () => {
    if (etat === 'initialiser') void suivi.lancer('initialiser');
    else if (etat === 'conversation') void suivi.lancer(espace?.rapport ? 'reanalyser' : 'initialiser');
    else if (etat === 'rapport') setRapport(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-marketing-guide={guide.avancement} data-marketing-agent={agentId ?? 'nouveau'}>
      <button
        type="button"
        onClick={() => setPoints(true)}
        data-marketing-avancement
        className="mx-3 mb-2 flex shrink-0 flex-col gap-1 rounded-md px-1 py-1 text-left hover:bg-bloc"
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

      <div className="flex min-h-0 flex-1 flex-col" data-marketing-conversation={agent ? 'oui' : agentId ? 'chargement' : 'aucune'}>
        {agent ? (
          <Chat agent={agent} projectId={projectId} creuxReserveAilleurs />
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

      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2" data-marketing-pied>
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
    </div>
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
          <p className="pt-2 text-[12.5px] text-faint">{t('Pour le faire corriger, répondez à l’agent dans le Guide.')}</p>
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
  const [enCours, setEnCours] = React.useState(false);
  React.useEffect(() => setBrouillon(versTexte(fiche)), [JSON.stringify(fiche)]);
  const modifie = JSON.stringify(brouillon) !== JSON.stringify(versTexte(fiche));

  const enregistrer = async () => {
    setEnCours(true);
    try {
      const envoi: Record<string, unknown> = {};
      for (const c of champsFiche()) {
        const v = brouillon[c.cle] ?? '';
        envoi[c.cle] = c.liste ? v.split('\n').map((l) => l.trim()).filter(Boolean) : v;
      }
      await client.call({ type: 'marketing.fiche', projectId, fiche: envoi });
      client.pushToast('success', t('Positionnement enregistré'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Positionnement non enregistré'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <CorpsOnglet
      pied={
        <Button size="pied" className="sm:w-auto" disabled={!modifie || enCours} onClick={() => void enregistrer()} data-marketing-fiche-enregistrer>
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t('Enregistrer')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-marketing-fiche>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[13px] font-medium text-text">{t('La carte d’identité commerciale')}</span>
          <PointInfo titre={t('Le positionnement')}>
            <p>{t('La carte d’identité commerciale du projet. L’agent la rédige ; vous la corrigez ici comme un texte.')}</p>
            {champsFiche().map((c) => (
              <p key={c.cle}>
                <span className="font-medium">{c.libelle}</span> — {c.aide}
              </p>
            ))}
          </PointInfo>
        </div>
        {champsFiche().map((c) => (
          <label key={c.cle} className="flex flex-col gap-1">
            <span className="text-[12.5px] text-muted">{c.libelle}</span>
            <Textarea
              rows={c.liste ? 3 : 2}
              value={brouillon[c.cle] ?? ''}
              placeholder={c.aide}
              onChange={(e) => setBrouillon((b) => ({ ...b, [c.cle]: e.target.value }))}
              className="text-[13px]"
              data-marketing-champ={c.cle}
            />
          </label>
        ))}
      </div>
    </CorpsOnglet>
  );
}

/* ------------------------------------------------------------------ */
/* Contenus                                                             */
/* ------------------------------------------------------------------ */

type Filtre = 'tous' | 'attente' | 'nouveautes' | 'programmes' | 'publies';

function filtres(): { cle: Filtre; libelle: string; garde: (c: ContenuMarketing) => boolean }[] {
  return [
    { cle: 'tous', libelle: t('Tous'), garde: (c) => c.etape !== 'abandonne' },
    { cle: 'attente', libelle: t('À valider'), garde: (c) => c.etape === 'a_valider' || c.etape === 'brouillon' },
    { cle: 'nouveautes', libelle: t('Nouveautés'), garde: (c) => c.origine === 'nouveaute' && c.etape !== 'abandonne' },
    { cle: 'programmes', libelle: t('Programmés'), garde: (c) => c.etape === 'pret' || c.etape === 'programme' },
    { cle: 'publies', libelle: t('Publiés'), garde: (c) => c.etape === 'publie' },
  ];
}

function toneEtape(etape: EtapeContenu): 'neutral' | 'warning' | 'success' | 'danger' {
  if (etape === 'a_valider') return 'warning';
  if (etape === 'publie') return 'success';
  if (etape === 'echec') return 'danger';
  return 'neutral';
}

function OngletContenus({
  contenus,
  onOuvrir,
  aUnAgent,
  onAgent,
  onEcrire,
}: {
  contenus: ContenuMarketing[];
  onOuvrir: (id: string) => void;
  aUnAgent: boolean;
  onAgent: () => void;
  onEcrire: () => void;
}) {
  const [filtre, setFiltre] = React.useState<Filtre>('tous');
  const garde = filtres().find((f) => f.cle === filtre)!.garde;
  const visibles = contenus.filter(garde);
  return (
    <CorpsOnglet
      pied={
        aUnAgent ? (
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
        )
      }
    >
      <div className="flex flex-col gap-2" data-marketing-contenus={contenus.length}>
        <div className="flex items-center gap-1">
          <RangeeDeChoix>
            {filtres().map((f) => (
              <Button key={f.cle} size="sm" variant={filtre === f.cle ? 'subtle' : 'ghost'} onClick={() => setFiltre(f.cle)} data-marketing-filtre={f.cle}>
                {f.libelle}
                <span className="text-faint">{contenus.filter(f.garde).length}</span>
              </Button>
            ))}
          </RangeeDeChoix>
          <PointInfo titre={t('Les contenus')}>
            <p>{t('Les posts, courriels et annonces du projet. L’agent les dépose « À valider » ; vous les relisez, les validez, les programmez puis les marquez comme publiés.')}</p>
            <p>{t('Touchez un contenu pour le relire et le faire avancer.')}</p>
          </PointInfo>
        </div>
        {!visibles.length ? (
          <p className="py-3 text-[12.5px] text-faint" data-marketing-contenus-vide>
            {contenus.length
              ? t('Aucun contenu dans ce filtre.')
              : aUnAgent
                ? t('Aucun contenu pour l’instant. Demandez-en à l’agent dans le Guide : il les rédige pour vous, prêts à relire.')
                : t('L’agent rédige vos premiers contenus pendant son analyse : lancez-la depuis le Guide.')}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {visibles.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOuvrir(c.id)}
                data-marketing-contenu={c.id}
                data-etape={c.etape}
                className="flex w-full items-center gap-2 rounded-md bg-bloc px-3 py-2.5 text-left hover:bg-raised"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{c.titre}</span>
                    <Badge tone={toneEtape(c.etape)}>{t(LIBELLE_ETAPE[c.etape])}</Badge>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
                    <span className="shrink-0">{libelleCanal(c.canal)}</span>
                    {c.datePrevue ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">{dateCourte(c.datePrevue)}</span>
                      </>
                    ) : null}
                    {c.varianteDe ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">{t('Version B')}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </CorpsOnglet>
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

/**
 * LE CALENDRIER : une SEMAINE en liste sur téléphone (une ligne par jour,
 * lisible au doigt), QUATRE semaines en grille sur ordinateur. Un contenu se
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
  const semaines = telephone ? 1 : 4;
  const [decalage, setDecalage] = React.useState(0);
  const lundi = lundiLocal(new Date());
  lundi.setDate(lundi.getDate() + decalage * 7);
  const jours = Array.from({ length: semaines * 7 }, (_, i) => {
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
  const sansDate = contenus.filter((c) => !c.datePrevue && (c.etape === 'a_valider' || c.etape === 'pret' || c.etape === 'brouillon'));

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

  return (
    <CorpsOnglet>
      <div className="flex flex-col gap-2" data-marketing-calendrier={telephone ? 'semaine' : 'mois'} data-marketing-plan={actions.length}>
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
            <p className="text-[12.5px] text-termine">{t('Tout le plan est fait. Demandez la suite à l’agent dans le Guide.')}</p>
          ) : (
            <button type="button" onClick={onAgent} className="text-left text-[12.5px] text-faint hover:text-text">
              {t('Aucun plan pour l’instant : l’agent le pose pendant son analyse, depuis le Guide.')}
            </button>
          )}
        </div>
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

        {telephone ? (
          <div className="flex flex-col gap-1">
            {jours.map((jour) => {
              const du = parJour.get(jour) ?? [];
              return (
                <div
                  key={jour}
                  data-marketing-jour={jour}
                  className={cn('flex min-h-[52px] items-start gap-3 rounded-md bg-bloc px-3 py-2', target?.id === jour && 'ring-1 ring-accent')}
                >
                  <span className={cn('flex w-10 shrink-0 flex-col leading-tight', jour === aujourdhui ? 'text-accent' : 'text-faint')}>
                    <span className="text-[11.5px] uppercase">{dateCourte(jour, { weekday: 'short' })}</span>
                    <span className="text-[16px] font-medium">{Number(jour.slice(8))}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    {(actionsParJour.get(jour) ?? []).map((a) => pastilleAction(a, true))}
                    {du.map((c) => pastille(c, true))}
                    {!du.length && !actionsParJour.get(jour)?.length ? <span className="py-1 text-[12.5px] text-faint">—</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1 text-[11.5px]">
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
                  'flex min-h-[84px] min-w-0 flex-col gap-0.5 rounded-md bg-bloc p-1.5',
                  target?.id === jour && 'ring-1 ring-accent',
                  jour < aujourdhui && 'opacity-60',
                )}
              >
                <span className={cn('text-faint', jour === aujourdhui && 'font-medium text-accent')}>{Number(jour.slice(8))}</span>
                {(actionsParJour.get(jour) ?? []).map((a) => pastilleAction(a, false))}
                {(parJour.get(jour) ?? []).map((c) => pastille(c, false))}
              </div>
            ))}
          </div>
        )}

        {sansDate.length ? (
          <div className="flex flex-col gap-1 pt-1" data-marketing-sans-date={sansDate.length}>
            <span className="text-[12px] text-faint">{t('Sans date')}</span>
            <div className="flex flex-col gap-1">{sansDate.map((c) => pastille(c, true))}</div>
          </div>
        ) : null}
      </div>
      <VoletAction action={action} onClose={() => setActionOuverte(null)} />
    </CorpsOnglet>
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
 * LES CANAUX : TOUT le catalogue, jamais une liste courte à deviner. Les
 * canaux choisis en tête, puis ceux que l'agent recommande ; chacun dit à quoi
 * il sert, et — une fois l'analyse faite — pourquoi il convient ou non à CE
 * produit, et par quoi commencer. Un toucher le choisit ou le retire.
 */
function OngletCanaux({ projectId, donnees, onAgent }: { projectId: string; donnees: EspaceComplet; onAgent: () => void }) {
  const config = donnees.espace?.configuration;
  const lignes = canauxDansLOrdre({ canaux: config?.canaux ?? [], recommandations: config?.recommandations ?? [] });
  const choisis = lignes.filter((l) => l.choisi);
  const autres = lignes.filter((l) => !l.choisi);
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const aDesAvis = (config?.recommandations ?? []).length > 0;

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

  const ligne = (l: (typeof lignes)[number]) => (
    <li key={l.canal.cle} className="flex items-start gap-2 rounded-md bg-bloc px-3 py-2.5" data-marketing-canal={l.canal.cle} data-choisi={l.choisi ? 'oui' : 'non'} data-pertinence={l.recommandation?.pertinence ?? ''}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[13.5px] text-text">{t(l.canal.libelle)}</span>
          {l.recommandation ? (
            <Badge tone={l.recommandation.pertinence === 'haute' ? 'success' : l.recommandation.pertinence === 'moyenne' ? 'neutral' : 'warning'}>
              {libellePertinence(l.recommandation.pertinence)}
            </Badge>
          ) : null}
        </span>
        <span className="text-[12.5px] text-faint">{t(l.canal.description)}</span>
        {l.recommandation ? <span className="text-[12.5px] text-muted">{l.recommandation.raison}</span> : null}
        {l.recommandation?.premierPas ? (
          <span className="text-[12.5px] text-text">
            <span className="text-faint">{t('Pour commencer :')}</span> {l.recommandation.premierPas}
          </span>
        ) : null}
      </span>
      <Button
        size="sm"
        variant={l.choisi ? 'subtle' : 'ghost'}
        className="shrink-0"
        disabled={envoi === l.canal.cle}
        onClick={() => void basculer(l.canal.cle)}
        data-marketing-canal-choix={l.canal.cle}
      >
        {envoi === l.canal.cle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : l.choisi ? <CheckCircle2 className="h-3.5 w-3.5 text-termine" /> : <Plus className="h-3.5 w-3.5" />}
        {l.choisi ? t('Choisi') : t('Choisir')}
      </Button>
    </li>
  );

  return (
    <CorpsOnglet>
      <div className="flex flex-col gap-3" data-marketing-canaux={choisis.length} data-marketing-catalogue={lignes.length}>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[13px] text-muted">
            {aDesAvis ? t('L’avis de l’agent sur chaque canal, pour ce produit.') : t('Tous les canaux qui peuvent amener des clients.')}
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
            {t('L’agent n’a pas encore donné son avis. Lancez son analyse depuis le Guide : il vous dira lesquels choisir.')}
          </button>
        ) : null}
        {choisis.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-text">{t('Vos canaux')}</span>
            <ul className="flex flex-col gap-1">{choisis.map(ligne)}</ul>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium text-text">{choisis.length ? t('Les autres canaux') : t('Tous les canaux')}</span>
          <ul className="flex flex-col gap-1">{autres.map(ligne)}</ul>
        </div>
      </div>
    </CorpsOnglet>
  );
}

/* ------------------------------------------------------------------ */
/* Statistiques                                                         */
/* ------------------------------------------------------------------ */

function valeurIndicateur(cle: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (cle === 'duree') return v < 60_000 ? `${Math.round(v / 1000)} s` : `${Math.round(v / 60_000)} min`;
  if (cle === 'rebond' || cle === 'fidelite' || cle === 'conversion') return `${v} %`;
  if (cle === 'chiffreAffaires' || cle === 'panierMoyen') return montant(v);
  return v.toLocaleString(formatRegional());
}

/** Une graduation lisible au-dessus du maximum : 1, 2, 5, 10, 20, 50… */
function plafondRond(max: number): number {
  // Jamais une demi-visite sur l'échelle : deux au moins, pour que le milieu soit un entier.
  if (max <= 2) return 2;
  const puissance = 10 ** Math.floor(Math.log10(max));
  for (const pas of [1, 2, 5, 10]) if (pas * puissance >= max) return pas * puissance;
  return 10 * puissance;
}

/**
 * UNE COURBE PAR JOUR : une série, une aire légère sous un trait de 2 px, une
 * graduation discrète, et au survol (ou au doigt) un repère vertical avec la
 * valeur du jour. La couleur suit le jeton d'accent de la palette : lisible
 * dans les douze palettes, sans couleur en dur.
 */
function CourbeParJour({
  titre,
  points,
  format = (v: number) => v.toLocaleString(formatRegional()),
  barres,
  cle,
}: {
  titre: string;
  points: { jour: string; valeur: number }[];
  format?: (v: number) => string;
  /** Des barres plutôt qu'une courbe : pour des comptes rares (ventes, objectifs). */
  barres?: boolean;
  cle: string;
}) {
  const [survol, setSurvol] = React.useState<number | null>(null);
  const zone = React.useRef<HTMLDivElement>(null);
  const n = points.length;
  const max = plafondRond(Math.max(0, ...points.map((p) => p.valeur)));
  const total = points.reduce((s, p) => s + p.valeur, 0);
  const L = 100;
  const H = 40;
  const x = (i: number) => (n <= 1 ? L / 2 : (i / (n - 1)) * L);
  const y = (v: number) => H - (v / max) * H;
  const trace = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(p.valeur).toFixed(2)}`).join(' ');
  const aire = n ? `${trace} L${x(n - 1).toFixed(2)},${H} L${x(0).toFixed(2)},${H} Z` : '';

  const suivre = (clientX: number) => {
    const r = zone.current?.getBoundingClientRect();
    if (!r || !n) return;
    const part = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setSurvol(barres ? Math.min(n - 1, Math.floor(part * n)) : Math.round(part * (n - 1)));
  };
  const point = survol !== null ? points[survol] : null;
  const gauche = survol === null ? 0 : barres ? ((survol + 0.5) / n) * 100 : (x(survol) / L) * 100;

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" data-marketing-graphique={cle} data-total={total}>
      <div className="flex items-baseline gap-2">
        <span className="flex-1 text-[12.5px] text-text">{titre}</span>
        <span className="text-[12px] text-faint">{point ? `${dateCourte(point.jour)} · ${format(point.valeur)}` : t('Total : {v0}', { v0: format(total) })}</span>
      </div>
      <div className="flex gap-1.5">
        <div className="flex h-28 shrink-0 flex-col justify-between text-right text-[10.5px] leading-none text-faint">
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>0</span>
        </div>
        <div
          ref={zone}
          className="relative h-28 min-w-0 flex-1 touch-pan-y"
          onPointerMove={(e) => suivre(e.clientX)}
          onPointerDown={(e) => suivre(e.clientX)}
          onPointerLeave={() => setSurvol(null)}
          role="img"
          aria-label={titre}
        >
          <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-faint/25" />
          <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-faint/25" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-faint/40" />
          {barres ? (
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {points.map((p, i) => (
                <div
                  key={p.jour}
                  className={cn('min-w-0 flex-1 rounded-t-[3px]', survol === i ? 'bg-accent' : 'bg-accent/70')}
                  style={{ height: `${(p.valeur / max) * 100}%`, minHeight: p.valeur ? 2 : 0 }}
                />
              ))}
            </div>
          ) : (
            <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
              <path d={aire} fill="hsl(var(--accent) / 0.14)" />
              <path d={trace} fill="none" stroke="hsl(var(--accent))" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}
          {point ? (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-faint/60" style={{ left: `${gauche}%` }} />
              {!barres ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-[hsl(var(--bloc))]"
                  style={{ left: `${gauche}%`, top: `${(y(point.valeur) / H) * 100}%` }}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {n ? (
        <div className="flex justify-between pl-8 text-[10.5px] text-faint">
          <span>{dateCourte(points[0].jour, { day: 'numeric', month: 'short' })}</span>
          <span>{dateCourte(points[n - 1].jour, { day: 'numeric', month: 'short' })}</span>
        </div>
      ) : null}
    </div>
  );
}

/** UNE RÉPARTITION : une barre horizontale par ligne, sa valeur et sa part du total. */
function Repartition({ titre, lignes, cle }: { titre: string; lignes: [string, number][]; cle: string }) {
  const total = lignes.reduce((s, [, n]) => s + n, 0);
  const max = Math.max(1, ...lignes.map(([, n]) => n));
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" data-marketing-repartition={cle}>
      <span className="text-[12.5px] text-text">{titre}</span>
      {lignes.length ? (
        <ul className="flex flex-col gap-1.5">
          {lignes.map(([nom, n]) => (
            <li key={nom} className="flex flex-col gap-0.5">
              <span className="flex gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-muted">{nom}</span>
                <span className="shrink-0 text-text">{n.toLocaleString(formatRegional())}</span>
                <span className="w-11 shrink-0 whitespace-nowrap text-right text-faint">{total ? Math.round((n / total) * 100) : 0} %</span>
              </span>
              <span className="block h-1.5 overflow-hidden rounded-full bg-faint/15">
                <span className="block h-full rounded-full bg-accent/80" style={{ width: `${(n / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[12px] text-faint">{t('Aucune donnée sur cette période.')}</span>
      )}
    </div>
  );
}

function OngletStatistiques({ donnees, jours, onJours }: { donnees: EspaceComplet; jours: number; onJours: (n: number) => void }) {
  const r = donnees.resultats;
  const config = donnees.espace?.configuration;
  const indicateurs = indicateursDe(config?.nature);
  const titres = new Map(donnees.contenus.map((c) => [c.id, c.titre]));
  const parJour = r?.parJour ?? [];
  const avecVentes = parJour.some((j) => (j.ventes ?? 0) > 0);
  const avecObjectifs = parJour.some((j) => (j.objectifs ?? 0) > 0);
  const aucuneVisite = !r || !(r.totaux.visites ?? 0);
  return (
    <CorpsOnglet>
      <div className="flex flex-col gap-3" data-marketing-statistiques={r ? r.totaux.visites ?? 0 : 'vide'}>
        <div className="flex items-center gap-1">
          <div className="flex flex-1 items-center gap-1">
            {[7, 30, 90].map((n) => (
              <Button key={n} size="sm" variant={jours === n ? 'subtle' : 'ghost'} onClick={() => onJours(n)} data-marketing-periode={n}>
                {t('{n} jours', { n })}
              </Button>
            ))}
          </div>
          <PointInfo titre={t('Les statistiques')}>
            {indicateurs.map((i) => (
              <p key={i.cle}>
                <span className="font-medium">{t(i.libelle)}</span> — {t(i.explication)}
              </p>
            ))}
            <p className="text-muted">{t('Touchez ou survolez une courbe pour lire la valeur d’un jour.')}</p>
            {r ? <p className="text-muted">{t('Les listes montrent les {n} premiers.', { n: r.plafondListes })}</p> : null}
          </PointInfo>
        </div>

        {aucuneVisite ? (
          <p className="rounded-md bg-bloc px-3 py-2.5 text-[12.5px] text-muted" data-marketing-statistiques-vide>
            {config?.etatSuivi === 'verifie'
              ? t('Aucune visite mesurée sur cette période.')
              : t('Les chiffres arrivent dès que la mesure des visites est posée sur le site : l’agent la prépare pendant son analyse.')}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {indicateurs.map((i) => (
            <div key={i.cle} className="flex min-w-0 flex-col gap-0.5 rounded-md bg-bloc px-3 py-2" data-marketing-indicateur={i.cle}>
              <span className="truncate text-[12px] text-faint">{t(i.libelle)}</span>
              <span className="text-[18px] font-medium text-text">{valeurIndicateur(i.cle, r?.totaux[i.cle])}</span>
            </div>
          ))}
        </div>

        {parJour.length ? (
          <>
            <CourbeParJour cle="visites" titre={t('Visites par jour')} points={parJour.map((j) => ({ jour: j.jour, valeur: j.visites }))} />
            <CourbeParJour cle="visiteurs" titre={t('Visiteurs par jour')} points={parJour.map((j) => ({ jour: j.jour, valeur: j.visiteurs }))} />
            {avecObjectifs ? (
              <CourbeParJour cle="objectifs" barres titre={t('Objectifs atteints par jour')} points={parJour.map((j) => ({ jour: j.jour, valeur: j.objectifs ?? 0 }))} />
            ) : null}
            {avecVentes ? (
              <CourbeParJour cle="ventes" barres titre={t('Chiffre d’affaires par jour')} format={(v) => montant(Math.round(v))} points={parJour.map((j) => ({ jour: j.jour, valeur: j.montantCentimes ?? 0 }))} />
            ) : null}
          </>
        ) : null}

        <div className="grid gap-1.5 sm:grid-cols-3">
          <Repartition cle="sources" titre={t('Provenance')} lignes={(r?.sources ?? []).map((x) => [x.source === 'direct' ? t('Direct') : x.source === 'recherche' ? t('Moteurs de recherche') : x.source, x.visites])} />
          <Repartition cle="appareils" titre={t('Appareils')} lignes={(r?.appareils ?? []).map((a) => [t(a.appareil === 'mobile' ? 'Téléphone' : a.appareil === 'tablette' ? 'Tablette' : 'Ordinateur'), a.visites])} />
          <Repartition cle="pages" titre={t('Pages les plus vues')} lignes={(r?.pages ?? []).map((x) => [x.chemin, x.vues])} />
        </div>

        <div className="flex flex-col gap-1 rounded-md bg-bloc px-3 py-2.5" data-marketing-par-contenu={r?.parContenu.length ?? 0}>
          <span className="text-[12.5px] text-text">{t('Ce que chaque contenu a rapporté')}</span>
          {r?.parContenu.length ? (
            <ul className="flex flex-col gap-0.5 text-[12.5px]">
              {r.parContenu.map((l) => (
                <li key={l.contenuId} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate text-text">{titres.get(l.contenuId) ?? l.contenuId}</span>
                  <span className="shrink-0 text-faint">{t('{n} clics', { n: l.visites })}</span>
                  <span className="hidden shrink-0 text-faint sm:inline">{t('{n} objectifs', { n: l.objectifs })}</span>
                  <span className="shrink-0 text-text">{montant(l.montantCentimes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">{t('Aucune donnée sur cette période.')}</p>
          )}
        </div>
        {r?.tronque ? <p className="text-[12px] text-warning">{t('Période très chargée : seuls les passages les plus récents sont comptés.')}</p> : null}

        <SuiviEtConfidentialite donnees={donnees} />
      </div>
    </CorpsOnglet>
  );
}

/** Le script de suivi et la phrase de confidentialité, toujours à portée de main. */
function SuiviEtConfidentialite({ donnees }: { donnees: EspaceComplet }) {
  const config = donnees.espace?.configuration;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-bloc px-3 py-2.5" data-marketing-suivi-bloc={config?.etatSuivi ?? 'absent'}>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px] font-medium text-text">{t('La mesure des visites')}</span>
        <PointInfo titre={t('La mesure des visites')}>
          <p>{t('Un petit script anonyme, sans cookie et sans service extérieur. Il n’est jamais installé en cachette : l’agent passe par une carte que vous lancez, ou vous annonce le geste.')}</p>
          <p>{t('La phrase de confidentialité est à ajouter à la page « confidentialité » du site.')}</p>
        </PointInfo>
      </div>
      <span className={cn('text-[12.5px]', config?.etatSuivi === 'verifie' ? 'text-termine' : config?.etatSuivi === 'pose' ? 'text-en-cours' : 'text-faint')}>
        {libelleSuivi(config?.etatSuivi ?? 'absent')}
      </span>
      {donnees.extrait ? (
        <div className="flex items-start gap-1.5">
          <code className="min-w-0 flex-1 break-all rounded-sm bg-surface px-1.5 py-1 text-[11.5px] text-muted">{donnees.extrait}</code>
          <Button size="icon" variant="ghost" aria-label="Copier le script" title={t('Copier le script')} onClick={() => void copier(donnees.extrait!, t('Script'))}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1 text-[12px] text-muted" data-marketing-confidentialite>
          {donnees.confidentialite}
        </p>
        <Button size="icon" variant="ghost" aria-label="Copier la phrase de confidentialité" title={t('Copier la phrase de confidentialité')} onClick={() => void copier(donnees.confidentialite, t('Phrase'))}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
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
          <Button size="icon" variant="ghost" aria-label="Copier le texte" title={t('Copier le texte')} onClick={() => void copier(texte, t('Texte'))} data-marketing-copier-texte>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {lien ? (
            <Button size="icon" variant="ghost" aria-label="Copier le lien de suivi" title={t('Copier le lien de suivi')} onClick={() => void copier(lien, t('Lien de suivi'))} data-marketing-copier-lien>
              <Link2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {!publie ? (
            <Button size="icon" variant="ghost" aria-label="Supprimer" title={t('Supprimer')} onClick={() => setASupprimer(true)} data-marketing-supprimer>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <PointInfo titre={t('Un contenu')}>
            <p>{t('Relisez et corrigez le texte, donnez-lui une date, puis faites-le avancer : valider, programmer, marquer comme publié.')}</p>
            <p>{t('Mettez ce lien dans le post à la place de l’adresse du site : chaque visite et chaque vente qu’il amène sont comptées pour ce contenu.')}</p>
            <p>{t('Programmé : il vous sera rappelé dans le calendrier. Publiez-le à la date prévue, puis marquez-le comme publié.')}</p>
          </PointInfo>
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
            <div className="grid grid-cols-2 gap-2 text-[12.5px]">
              <label className="flex min-w-0 flex-col gap-1 text-muted">
                {t('Date prévue')}
                <Input type="date" value={date} disabled={publie} onChange={(e) => setDate(e.target.value)} className="text-[13px]" data-marketing-tiroir-date />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-muted">
                {t('Heure')}
                <Input type="time" value={heure} disabled={publie} onChange={(e) => setHeure(e.target.value)} className="text-[13px]" />
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
