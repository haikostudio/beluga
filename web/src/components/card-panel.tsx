import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  Cpu,
  ExternalLink,
  FileText,
  GitBranch,
  GitMerge,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  COLUMN_LABELS,
  Card,
  DecisionGeste,
  EngineInfo,
  GesteCarte,
  ReglagesCarte,
  colonneDeReprise,
  libelleDeReprise,
  decisionsParCarte,
  etatVisuelCarte,
  gesteCarte,
  lireDateDeDepart,
  mentionArchivage,
  mentionDepartProgramme,
  motAnalyse,
  phaseAnalyse,
  projectionDeLExecution,
  reglagesDeLaCarte,
  totalMesureEnClair,
  valeurMesuree,
} from '@haikodev/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { Chat } from '@/components/chat';
import { MenuCarte } from '@/components/card-menu';
import { RepereAttention } from '@/components/repere-attention';
import { RunChoix, RunSelectors, resoudreRun } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useMinute } from '@/lib/horloge';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn, duration, money, relativeTime } from '@/lib/utils';

export function CardPanel({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  const state = useApp();
  const card = cardId ? state.cards[cardId] : null;

  if (!card) return null;

  return (
    <Drawer open={!!cardId} onClose={onClose}>
      <CardPanelBody card={card} onClose={onClose} />
    </Drawer>
  );
}

function CardPanelBody({ card, onClose }: { card: Card; onClose: () => void }) {
  const state = useApp();
  /*
   * L'agent de la conversation n'est PAS seulement celui de l'exécution : une
   * carte n'en reçoit un qu'au lancement, alors que son analyse a déjà parlé
   * bien avant. On prend donc le dernier agent connu de la carte — analyse
   * comprise — sinon son compte rendu ne s'affichait qu'au démarrage du travail.
   */
  const conversation = state.cardMessages[card.id];
  const dernierAgent = React.useMemo(
    () =>
      Object.values(state.agents)
        .filter((item) => item.cardId === card.id)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    [state.agents, card.id],
  );
  const agent =
    (card.agentId ? state.agents[card.agentId] : null) ??
    (conversation?.activeAgentId ? state.agents[conversation.activeAgentId] : null) ??
    dernierAgent;
  const project = state.projects.find((p) => p.id === card.projectId);

  const phase = phaseAnalyse({
    column: card.column,
    aEstimation: !!card.estimate && !card.estimate.failed,
    estimationEchouee: !!card.estimate?.failed,
    analyseEnCours: agent?.role === 'analysis' && agent.status === 'running',
    analyseDemandee: card.analyseDemandee,
  });

  /*
   * L'onglet montré. Une carte ouverte AVANT sa validation resterait sur les
   * détails pendant que son analyse écrit à côté : dès qu'il y a quelque chose
   * à lire, on bascule sur la conversation — une seule fois, pour ne jamais
   * ramener quelqu'un qui a choisi un autre onglet.
   */
  // Une carte de travail hors tâche n'a pas d'agent à elle : c'est la
  // conversation empruntée qui dit qu'il y a quelque chose à lire.
  const aLire = !!agent || !!card.conversationAgentId || phase !== 'aucune';
  /* Ce que cette carte attend de vous — le même compte que son triangle sur le
     tableau, posé ici sur l'onglet où la décision se prend. */
  const decisions = decisionsParCarte(state.decisions)[card.id] ?? 0;
  /*
   * Une décision qui attend l'emporte sur tout le reste : le bouton
   * « Répondre » du tableau doit tomber DIRECTEMENT sur la question, jamais sur
   * l'onglet des détails qu'il faudrait ensuite quitter à la main.
   */
  const [onglet, setOnglet] = React.useState(decisions > 0 || aLire ? 'chat' : 'details');

  /*
   * Les gestes du pied suivent une règle partagée : un bouton ne s'allume que
   * lorsqu'il a du sens. « Terminer la tâche » apparaissait dès l'entrée dans
   * « En cours », donc pendant que l'agent travaillait encore — on pouvait
   * clôturer une carte dont personne n'avait lu la réponse.
   */
  const etat = etatVisuelCarte({
    agentStatut: agent?.status,
    analyseEnCours: agent?.role === 'analysis' && agent.status === 'running',
    chiffrageEnCours: !!card.analyseDemandee && !card.estimate,
    enAttente: !!card.scheduling?.waitingReason,
    estimationEchouee: !!card.estimate?.failed,
    enLigne: !!card.deployedAt,
  });
  const contexteGeste = { colonne: card.column, etat, agentLance: !!agent };
  const peut = (geste: GesteCarte) => gesteCarte(geste, contexteGeste);

  /*
   * Le pied ne s'affiche que s'il porte vraiment une décision à prendre : les
   * gestes rares sont partis dans le menu du haut, et un bandeau vide n'a plus
   * lieu d'être. Ce sont les mêmes règles que les boutons eux-mêmes, sinon la
   * barre pourrait apparaître pour n'y rien montrer.
   */
  const aDecision =
    peut('valider').affiche ||
    card.column === 'planned' ||
    peut('terminer').affiche ||
    peut('publier').affiche ||
    peut('reprendre').affiche ||
    !!card.estimate?.failed ||
    !!card.closureDoc;

  /*
   * L'INSTANT où « Terminer la tâche » s'allume mérite un signe : un halo qui
   * respire trois fois, puis plus rien. Une carte déjà ouverte sur un bouton
   * allumé ne clignote pas — il ne vient pas de changer d'état.
   */
  const terminerActif = peut('terminer').possible;
  const [vientDeSallumer, setVientDeSallumer] = React.useState(false);
  const etatPrecedent = React.useRef(terminerActif);
  React.useEffect(() => {
    if (terminerActif && !etatPrecedent.current) {
      setVientDeSallumer(true);
      const timer = window.setTimeout(() => setVientDeSallumer(false), 5600);
      etatPrecedent.current = terminerActif;
      return () => window.clearTimeout(timer);
    }
    etatPrecedent.current = terminerActif;
  }, [terminerActif]);
  const bascule = React.useRef(aLire);
  React.useEffect(() => {
    if (bascule.current || !aLire) return;
    bascule.current = true;
    setOnglet('chat');
  }, [aLire]);

  /*
   * Sur téléphone, le haut du tiroir s'épure. Les tags (état, étiquettes,
   * « modifiée à l'instant », mention d'archivage) sont repliés derrière un
   * chevron : ils tiennent souvent deux lignes et poussent la lecture vers le
   * bas. Sur ordinateur, ce même bloc reste toujours ouvert et le chevron
   * n'existe pas.
   */
  const telephone = useTelephone();
  const [tagsOuverts, setTagsOuverts] = React.useState(false);
  const tagsVisibles = !telephone || tagsOuverts;

  /*
   * La barre d'onglets se retire quand on descend dans le contenu et revient
   * quand on remonte, pour libérer de la hauteur de lecture — téléphone
   * seulement. `onScrollCapture` sur le conteneur des onglets attrape le
   * défilement de n'importe quel onglet (le chat a son propre défilement, les
   * autres passent par ZoneDefilement) : scroll ne remonte pas en bulle, mais
   * il descend bien en phase de capture. On change de sens à partir d'un petit
   * seuil pour ne pas battre sur un micro-tremblement.
   */
  const [barreVisible, setBarreVisible] = React.useState(true);
  const dernierScroll = React.useRef(0);
  // Un changement d'onglet remet tout à plat : chaque onglet a son propre
  // défilement, comparer leurs positions n'aurait aucun sens.
  React.useEffect(() => {
    dernierScroll.current = 0;
    setBarreVisible(true);
  }, [onglet]);
  const surDefilement = (event: React.UIEvent) => {
    if (!telephone) return;
    const y = (event.target as HTMLElement).scrollTop;
    const precedent = dernierScroll.current;
    if (y > precedent + 6 && y > 48) setBarreVisible(false);
    else if (y < precedent - 6) setBarreVisible(true);
    dernierScroll.current = y;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Aucun filet sous le titre : c'est l'ESPACE qui sépare le titre de la
          barre d'onglets. Le trait de 1 px se lisait comme un défaut
          d'affichage, juste au-dessus des onglets et de la bande « en cours ».
          Le retrait de la bordure remonte le contenu d'un pixel : on rend ce
          pixel au bas de l'en-tête pour que rien ne bouge à l'écran. */}
      <header className="shrink-0 px-4 pb-[13px]">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="leading-snug">{card.title}</DialogTitle>
            {tagsVisibles ? (
            <div data-tags-carte className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
              <Badge>{COLUMN_LABELS[card.column]}</Badge>
              {card.deployedAt ? (
                <Badge tone="success">
                  <Rocket className="h-2.5 w-2.5" /> en ligne
                </Badge>
              ) : null}
              {/* Une carte ressortie garde sa trace : on doit voir qu'elle
                  était passée par « Archivé », et quand. */}
              {mentionArchivage(card) ? (
                <Tooltip label={`Archivée le ${new Date(card.archivedAt!).toLocaleString('fr-CH')}`}>
                  <Badge>
                    <Archive className="h-2.5 w-2.5" /> {mentionArchivage(card)}
                  </Badge>
                </Tooltip>
              ) : null}
              {card.labels.map((label) => (
                <Badge key={label}>{label}</Badge>
              ))}
              <span>modifiée {relativeTime(card.updatedAt)}</span>
            </div>
            ) : null}
          </div>

          {/* Sur téléphone, un chevron déplie les tags repliés — placé juste
              avant le menu, à droite du titre. Absent sur ordinateur, où les
              tags sont toujours visibles. */}
          {telephone ? (
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 px-2"
              aria-label={tagsOuverts ? 'Masquer les étiquettes' : 'Afficher les étiquettes'}
              aria-expanded={tagsOuverts}
              onClick={() => setTagsOuverts((v) => !v)}
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', tagsOuverts && 'rotate-180')} />
            </Button>
          ) : null}

          {/* Les gestes rares vivent ici : ils prenaient une ligne entière en
              bas du tiroir. Menu déroulant sur ordinateur, tiroir pleine
              largeur sur téléphone — le composant s'en charge tout seul. */}
          <MenuCarte card={card} apresSuppression={onClose} />
        </div>
      </header>

      {/* La conversation a son propre onglet : les détails de l'agent ne la
          compriment plus en haut de l'écran. Elle s'ouvre dès qu'il y a quelque
          chose à y lire — une analyse en cours ou finie compte autant qu'un
          agent d'exécution. */}
      <Tabs
        key={card.id}
        value={onglet}
        onValueChange={setOnglet}
        onScrollCapture={surDefilement}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Les onglets collent au bord : la marge de la barre s'ajoutait à
            celle de la liste, et deux respirations superposées mangeaient une
            bonne part de la largeur sur téléphone.

            Sur téléphone, cette barre se replie quand on descend dans le
            contenu et revient quand on remonte — l'enveloppe se ferme en
            hauteur, l'onglet actif reste choisi. Sur ordinateur, rien ne bouge. */}
        <div
          data-barre-onglets
          data-cachee={telephone && !barreVisible ? '' : undefined}
          className={cn(
            'flex-none overflow-hidden transition-all duration-200',
            telephone && !barreVisible && 'max-h-0 opacity-0',
          )}
        >
        <ZoneDefilement axe="horizontal" classeEnveloppe="flex-none" className="px-1.5 py-1">
          <TabsList className="w-full justify-start">
            {/* La décision se prend DANS ce fil : l'onglet porte le même
                triangle que la carte du tableau, sinon le tiroir ouvert
                n'apprendrait plus rien. */}
            <TabsTrigger value="chat" className="gap-1">
              Conversation
              <RepereAttention compte={decisions} data-attention-carte={card.id} />
            </TabsTrigger>
            <TabsTrigger value="details">Détails</TabsTrigger>
            <TabsTrigger value="billing">Facturation</TabsTrigger>
            <TabsTrigger value="github">GitHub</TabsTrigger>
          </TabsList>
        </ZoneDefilement>
        </div>

        <TabsContent value="chat" className="min-h-0 flex-1 data-[state=inactive]:hidden">
          <Chat agent={agent} projectId={card.projectId} cardId={card.id} vide={motAnalyse(phase)} />
        </TabsContent>

        <TabsContent value="details" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ZoneDefilement><CardSummary card={card} /></ZoneDefilement>
        </TabsContent>

        <TabsContent value="billing" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ZoneDefilement><BillingTab card={card} rate={project?.billing?.hourlyRate ?? 130} project={project} /></ZoneDefilement>
        </TabsContent>

        <TabsContent value="github" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ZoneDefilement><GithubTab card={card} /></ZoneDefilement>
        </TabsContent>
      </Tabs>

      {/* Les gestes de décision restent en bas, toujours à portée de pouce ;
          les gestes rares sont partis dans le menu du haut. Sans décision à
          prendre, la barre disparaît au lieu de laisser un bandeau vide. */}
      {aDecision ? (
        <footer className="shrink-0 bg-bg px-4 py-2.5">
          {/* Les boutons se PARTAGENT la largeur : seul, un bouton la prend
              entière ; à plusieurs, ils se divisent la ligne et passent à la
              suivante en dessous de 150 px, toujours sans laisser de vide. */}
          <div className="grid items-center gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] [&>*]:w-full">
            {peut('valider').affiche ? (
              <Button size="sm" variant="default" onClick={() => client.validerCarte(card)}>
                <Check className="h-3 w-3" /> Valider (autorise la dépense)
              </Button>
            ) : null}
            {card.column === 'planned' ? (
              <>
                <Geste decision={peut('lancer')}>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!peut('lancer').possible}
                    onClick={() => client.call({ type: 'card.start', id: card.id })}
                  >
                    <Play className="h-3 w-3" /> Lancer maintenant
                  </Button>
                </Geste>
                <Button
                  size="sm"
                  variant={card.scheduling?.asap ? 'subtle' : 'outline'}
                  onClick={() => client.call({ type: 'card.asap', id: card.id, value: !card.scheduling?.asap })}
                >
                  <Zap className="h-3 w-3" /> Dès que possible
                </Button>
              </>
            ) : null}
            {peut('terminer').affiche ? (
              <Geste decision={peut('terminer')}>
                <Button
                  size="sm"
                  variant="default"
                  className={cn(vientDeSallumer && 'animate-appel')}
                  disabled={!peut('terminer').possible}
                  onClick={() => client.call({ type: 'card.finish', id: card.id })}
                >
                  <Check className="h-3 w-3" /> Terminer la tâche
                </Button>
              </Geste>
            ) : null}
            {peut('publier').affiche ? (
              <Button size="sm" variant="default" onClick={() => client.moveCard(card, 'to_deploy')}>
                <Rocket className="h-3 w-3" /> Mettre en file de publication
              </Button>
            ) : null}
            {/*
                Le seul chemin volontaire pour ressortir une carte d'une fin de
                parcours. Rien ne la ressort tout seul : ni un agent, ni une
                question posée dans sa conversation.
             */}
            {peut('reprendre').affiche && colonneDeReprise(card.column) ? (
              <Button
                size="sm"
                variant="outline"
                data-geste="reprendre"
                onClick={() => client.moveCard(card, colonneDeReprise(card.column)!)}
              >
                <ArchiveRestore className="h-3 w-3" />
                {libelleDeReprise(card.column)}
                {' → '}
                {COLUMN_LABELS[colonneDeReprise(card.column)!]}
              </Button>
            ) : null}
            {card.estimate?.failed ? (
              <Button size="sm" variant="outline" onClick={() => client.call({ type: 'card.reanalyze', id: card.id })}>
                <RefreshCw className="h-3 w-3" /> Relancer l'analyse
              </Button>
            ) : null}
            {card.closureDoc ? (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/document?card=${card.id}&download=1`}>
                  <FileText className="h-3 w-3" /> Document de clôture
                </a>
              </Button>
            ) : null}
          </div>

          {/* Plus de phrase d'explication sous les boutons : la bande « en
              cours », posée en haut du fil, dit déjà que l'agent travaille. La
              répéter ici prenait une ligne pour rien. */}
        </footer>
      ) : null}
    </div>
  );
}

/**
 * Un geste éteint garde sa place et sa raison. L'enveloppe porte l'infobulle :
 * un bouton désactivé ne reçoit aucun survol, il ne pourrait pas la montrer.
 */
function Geste({ decision, children }: { decision: DecisionGeste; children: React.ReactNode }) {
  if (decision.possible || !decision.raison) return <>{children}</>;
  return (
    /* L'enveloppe occupe la CASE entière de la grille, sinon le bouton qu'elle
       entoure serait le seul à ne pas s'étirer. */
    <span title={decision.raison} className="flex w-full [&>*]:w-full">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Les réglages de l'agent de la carte                                 */
/* ------------------------------------------------------------------ */

/**
 * Un identifiant technique n'apprend rien : on cherche son libellé dans le
 * catalogue des moteurs, et on retombe sur l'identifiant seulement s'il n'y
 * figure plus (modèle retiré depuis, moteur désinstallé).
 */
function libellesDuRun(
  engines: EngineInfo[],
  vu: Pick<ReglagesCarte, 'engine' | 'model' | 'thinking'>,
) {
  const moteur = engines.find((e) => e.id === vu.engine);
  const modele = moteur?.models.find((m) => m.id === vu.model);
  const niveau = modele?.thinking?.find((t) => t.id === vu.thinking);
  return {
    moteur: moteur?.label ?? vu.engine ?? '—',
    modele: modele?.label ?? vu.model ?? '—',
    reflexion: niveau?.label ?? vu.thinking ?? '—',
  };
}

/**
 * Ce qui était déjà prêt lorsque la proposition du chef d'orchestre est
 * devenue une carte. On ne fabrique aucun historique : le bloc ne lit que les
 * champs conservés sur la carte et distingue le chiffrage, produit ensuite
 * par l'analyse mais toujours avant l'exécution.
 */
function PreparationChef({ card }: { card: Card }) {
  const state = useApp();
  if (card.origin !== 'agent') return null;

  const reglages = libellesDuRun(state.engines, card.run);
  const estimation = card.estimate?.machineSeconds
    ? duration(card.estimate.machineSeconds)
    : card.estimate?.failed
      ? 'Chiffrage indisponible'
      : 'Chiffrage en attente';
  const pieces = card.attachments.length;
  const etiquettes = card.labels.length;

  return (
    <div
      className="rounded-md border border-accent/25 bg-accent/5 px-3 py-3"
      data-preparation-chef
    >
      <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-text">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        Préparé depuis la proposition du chef d’orchestre
      </div>
      <p className="mt-0.5 text-[12.5px] text-faint">
        Ces éléments étaient déjà dans la carte avant son exécution.
      </p>

      <div className="mt-2 space-y-1.5 text-[13px]">
        <div>
          <span className="text-faint">Réglages repris </span>
          <span className="text-text">
            {reglages.moteur} · {reglages.modele} · {reglages.reflexion}
          </span>
        </div>
        <div>
          <span className="text-faint">Contenu transmis </span>
          <span className="text-text">
            consigne de la carte · {etiquettes} {etiquettes === 1 ? 'étiquette' : 'étiquettes'} · {pieces}{' '}
            {pieces === 1 ? 'image' : 'images'}
          </span>
        </div>
        <div>
          <span className="text-faint">Préparation avant exécution </span>
          <span className="text-text">{estimation} · analyse et exécution dans la même conversation</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Avec quoi cette carte va tourner — ou a tourné. Quatre étiquettes courtes sur
 * UNE ligne qui se replie : moteur, modèle, réflexion, compte. Jamais un
 * tableau, il deviendrait illisible sur téléphone.
 *
 * Tant que rien n'a démarré, les trois premières sont des menus : c'est le
 * dernier moment où l'on peut changer d'avis. Dès que le travail est parti,
 * elles se lisent telles qu'elles ont servi — c'est ce qui permet de comprendre
 * après coup pourquoi une carte s'est bien ou mal passée.
 */
function ReglagesAgent({ card }: { card: Card }) {
  const state = useApp();

  /*
   * Ce qui a SERVI, c'est l'agent d'EXÉCUTION, pas l'analyse : celle-ci tourne
   * souvent sur un autre modèle, et l'afficher ferait croire que la carte a été
   * traitée avec lui.
   */
  const execution = React.useMemo(
    () =>
      Object.values(state.agents)
        .filter((item) => item.cardId === card.id && item.role === 'task')
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    [state.agents, card.id],
  );

  const vu = reglagesDeLaCarte({
    colonne: card.column,
    carte: card.run,
    agent: execution
      ? { engine: execution.run.engine, model: execution.run.model, thinking: execution.run.thinking, compte: execution.account }
      : undefined,
    compteMesure: card.consumption?.account,
  });

  const libelles = libellesDuRun(state.engines, vu);

  /*
   * La part de quota réellement consommée par cette carte, somme de ses lignes
   * de consommation. Elle vit dans la table `usage`, pas sur la carte : on la
   * demande au serveur à l'ouverture du détail. Une carte sans relevé rend deux
   * zéros — on n'affiche alors rien, pas un zéro trompeur.
   */
  const [quota, setQuota] = React.useState<{ quota5h: number; quotaSemaine: number } | null>(null);
  React.useEffect(() => {
    let vivant = true;
    setQuota(null);
    client
      .call({ type: 'card.quota', cardId: card.id })
      .then((data) => {
        if (vivant) setQuota({ quota5h: data.quota5h ?? 0, quotaSemaine: data.quotaSemaine ?? 0 });
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [card.id]);
  const quotaVu = quota && (quota.quota5h > 0 || quota.quotaSemaine > 0) ? quota : null;

  // Changer de moteur remet modèle et réflexion à zéro : un modèle n'appartient
  // qu'à son moteur. On enregistre le trio RÉSOLU, jamais un choix à trous.
  const choisir = (patch: RunChoix) => {
    const souhait = patch.engine ? { engine: patch.engine } : { ...card.run, ...patch };
    const retenu = resoudreRun(state.engines, souhait);
    if (!retenu.engine) return;
    client.call({
      type: 'card.update',
      id: card.id,
      patch: {
        run: {
          ...card.run,
          engine: retenu.engine.id,
          model: retenu.model?.id,
          thinking: retenu.thinking?.id ?? 'none',
        },
      },
    });
  };

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-faint">
        <Cpu className="h-3 w-3" />
        {vu.modifiable ? "Réglages de l'agent" : 'Réglages qui ont servi'}
        {vu.modifiable ? null : <Lock className="h-2.5 w-2.5" title={vu.raison} />}
      </div>

      {vu.modifiable ? (
        /* Les mêmes menus que la barre d'écriture : sur téléphone, ils
           s'ouvrent en tiroir pleine largeur. */
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-0.5 sm:gap-x-1">
          <RunSelectors engines={state.engines} choix={card.run} onSelect={choisir} />
          <span className="px-1 text-[12.5px] text-faint">compte choisi au lancement</span>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
            <Etiquette nom="Moteur" valeur={libelles.moteur} />
            <Etiquette nom="Modèle" valeur={libelles.modele} />
            {/* « Niveau », pas « Réflexion » : le libellé du niveau porte déjà le
                mot, et « Réflexion — Réflexion poussée » se lisait deux fois. */}
            <Etiquette nom="Niveau" valeur={libelles.reflexion} />
            <Etiquette nom="Compte" valeur={vu.compte ?? '—'} />
          </div>

          {/* La part de quota dépensée par cette carte, une seule ligne, en
              clair. Rien quand aucun relevé n'existe : un zéro ferait croire à
              une mesure. */}
          {quotaVu ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
              <Etiquette nom="Quota 5 h consommé" valeur={partQuota(quotaVu.quota5h)} />
              <Etiquette nom="Quota semaine consommé" valeur={partQuota(quotaVu.quotaSemaine)} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Une part de quota, en clair : « 2,4 % » de la fenêtre. Sous un dixième de
 * pour-cent, on ne prétend pas à la décimale — « moins de 0,1 % » dit le vrai.
 */
function partQuota(part: number): string {
  if (part > 0 && part < 0.1) return 'moins de 0,1 %';
  return `${part.toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %`;
}

/** Une étiquette courte : le nom en gris pâle, la valeur juste après. */
function Etiquette({ nom, valeur }: { nom: string; valeur: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-[12px] text-faint">{nom}</span>
      <span className="truncate font-medium text-text">{valeur}</span>
    </span>
  );
}

/**
 * Pour chaque agent qui a touché la carte (analyse, exécution, publication),
 * ses deux totaux cumulés sur toute la vie de la carte — venus d'une vraie
 * mesure moteur, jamais d'une estimation. Une carte sans aucun tour mesuré
 * (lignes anciennes, sans séparation) ne montre rien : pas de zéro trompeur.
 */
function TokensParAgent({ card }: { card: Card }) {
  const state = useApp();
  const [totaux, setTotaux] = React.useState<{ agentId: string; tokensIn: number; tokensOut: number }[] | null>(
    null,
  );
  React.useEffect(() => {
    let vivant = true;
    setTotaux(null);
    client
      .call({ type: 'card.tokens', cardId: card.id })
      .then((data) => {
        if (vivant) setTotaux(data.agents ?? []);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [card.id]);

  if (!totaux || !totaux.length) return null;

  const lignes = totaux
    .map((ligne) => ({ ...ligne, agent: state.agents[ligne.agentId] }))
    .sort((a, b) => (a.agent?.createdAt ?? 0) - (b.agent?.createdAt ?? 0));

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2">
      <div className="text-[11.5px] uppercase tracking-wide text-faint">Jetons envoyés / reçus, par agent</div>
      <div className="mt-1 space-y-1">
        {lignes.map((ligne) => (
          <div key={ligne.agentId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13.5px]">
            <span className="min-w-[110px] shrink-0 text-faint">{libelleRoleAgent(ligne.agent?.role)}</span>
            <Etiquette nom="Envoyés" valeur={ligne.tokensIn.toLocaleString('fr-CH')} />
            <Etiquette nom="Reçus" valeur={ligne.tokensOut.toLocaleString('fr-CH')} />
          </div>
        ))}
      </div>
    </div>
  );
}

function libelleRoleAgent(role?: string): string {
  switch (role) {
    case 'analysis':
      return 'Analyse';
    case 'task':
      return 'Exécution';
    case 'deploy':
      return 'Publication';
    case 'orchestrator':
      return "Chef d'orchestre";
    default:
      return 'Agent';
  }
}

/**
 * L'HEURE DITE : la carte attend dans « Planifié » et part toute seule au
 * moment choisi, sans qu'on ait à cliquer. Le champ ne s'affiche que là où la
 * date a encore un sens — avant le départ du travail ; une fois la carte
 * lancée, l'heure est passée et il n'y a plus rien à programmer.
 *
 * La phrase affichée se RECALCULE (`mentionDepartProgramme`, horloge partagée) :
 * une phrase figée en base dirait encore « demain » trois jours plus tard.
 */
function DepartProgramme({ card }: { card: Card }) {
  const maintenant = useMinute();
  if (card.column !== 'todo' && card.column !== 'planned') return null;

  const depart = card.scheduling?.departPrevu;
  const mention = mentionDepartProgramme(card, maintenant);

  const poser = (valeur: string) => {
    const date = lireDateDeDepart(valeur);
    client.call({ type: 'card.schedule', id: card.id, at: date });
  };

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-faint">
        <CalendarClock className="h-3 w-3" />
        Départ programmé
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Input
          type="datetime-local"
          aria-label="Date et heure de départ"
          value={versChampDate(depart)}
          onChange={(event) => poser(event.target.value)}
          className="w-auto min-w-[200px] text-[13.5px]"
        />
        {depart ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => client.call({ type: 'card.schedule', id: card.id, at: null })}
          >
            Retirer la date
          </Button>
        ) : null}
      </div>

      <p className="mt-1.5 text-[13px] text-faint">
        {mention ?? 'Sans date, la carte attend votre lancement : rien ne démarre tout seul.'}
      </p>
    </div>
  );
}

/**
 * Un instant vers ce qu'attend un champ « datetime-local » : la date LOCALE,
 * sans secondes ni fuseau. Passer par `toISOString` afficherait l'heure de
 * Greenwich, donc 6 h posées le soir d'été deviendraient 4 h.
 */
function versChampDate(instant?: number): string {
  if (!instant) return '';
  const date = new Date(instant);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}T${deux(date.getHours())}:${deux(
    date.getMinutes(),
  )}`;
}

function CardSummary({ card }: { card: Card }) {
  const [description, setDescription] = React.useState(card.description);
  React.useEffect(() => setDescription(card.description), [card.id]);

  /*
   * La description est le CŒUR de la carte : le champ suit la hauteur du texte
   * au lieu de le laisser défiler dans une fenêtre de trois lignes. Il garde un
   * plancher confortable et un plafond, pour que les chiffres restent visibles
   * sur une longue consigne.
   */
  const zone = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    const champ = zone.current;
    if (!champ) return;
    champ.style.height = 'auto';
    champ.style.height = `${champ.scrollHeight + 2}px`;
  }, [description, card.id]);

  return (
    <div className="space-y-4 px-4 py-3">
      {/* En PREMIER : avec quoi la carte va tourner. C'est ce qu'on vient
          chercher avant de valider, et ce qu'on relit après coup quand le
          résultat surprend. */}
      <ReglagesAgent card={card} />
      {/* Juste après « avec quoi » : QUAND. Les deux se règlent avant le
          départ, au même endroit et de la même façon. */}
      <DepartProgramme card={card} />
      <PreparationChef card={card} />
      <TokensParAgent card={card} />

      <div>
        <Label htmlFor="carte-description">Description</Label>
        <Textarea
          id="carte-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description !== card.description) {
              client.call({ type: 'card.update', id: card.id, patch: { description } });
            }
          }}
          ref={zone}
          rows={8}
          placeholder="Ce qu'il faut faire…"
          className="mt-1.5 max-h-[55vh] min-h-[160px] resize-none text-[14px]"
        />
      </div>

      {card.scheduling?.waitingReason ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-[13.5px] text-warning">
          {card.scheduling.waitingReason}
        </p>
      ) : null}

      <MomentDetail
        numero="1"
        titre="Analyse initiale"
        description="Ce qui a été mesuré et prévu avant le lancement du travail."
        moment="analyse-initiale"
      >
        <div className="grid grid-cols-2 gap-2">
          <Metric
            label="Durée machine prévue"
            value={duration(card.estimate?.machineSeconds)}
            hint="Sert à l'ordonnanceur, jamais à la facture"
          />
          {/* Retiré du pied des cartes : c'est ici qu'on vient le chercher. */}
          <Metric
            label="Heures développeur senior"
            value={card.estimate?.seniorHours ? `${card.estimate.seniorHours} h` : '—'}
            hint="Base de la facture, jamais la durée machine"
          />
        </div>

        {card.estimate ? <DetailCoutAnalyse card={card} /> : null}

        {/* Le compte rendu d'analyse se lit EN ENTIER dans la conversation, mis en
            forme, dès qu'il est terminé. En recopier ici un extrait tronqué
            faisait lire deux fois la même chose, et moins bien. */}
        {card.estimate?.summary ? (
          <p className="text-[13px] text-faint">
            Le compte rendu complet de l’analyse est dans l’onglet « Conversation ».
          </p>
        ) : null}
      </MomentDetail>

      <MomentDetail
        numero="2"
        titre="Exécution réelle"
        description="Ce que le travail a réellement consommé après son lancement."
        moment="execution-reelle"
      >
        <div className="grid grid-cols-2 gap-2">
          <Metric
            label="Durée réelle"
            value={duration(card.consumption?.machineSeconds)}
            tone={
              card.estimate?.machineSeconds && card.consumption?.machineSeconds
                ? card.consumption.machineSeconds > card.estimate.machineSeconds * 1.3
                  ? 'warning'
                  : 'neutral'
                : 'neutral'
            }
          />
          {/* Le compte utilisé n'est plus ici : il vit avec les réglages de
              l'agent, en haut, là où il explique le quota consommé. */}
          <Metric label="Tokens consommés" value={card.consumption?.tokens?.toLocaleString('fr-CH') ?? '—'} />
        </div>
        {!card.consumption ? (
          <p className="text-[13px] text-faint">L’exécution n’a pas encore produit de mesure.</p>
        ) : null}
      </MomentDetail>
    </div>
  );
}

/** Une étape bien délimitée du parcours de la carte : analyse, puis exécution. */
function MomentDetail({
  numero,
  titre,
  description,
  moment,
  children,
}: {
  numero: string;
  titre: string;
  description: string;
  moment: 'analyse-initiale' | 'execution-reelle';
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface" data-moment-detail={moment}>
      <div className="flex items-start gap-2.5 border-b border-border bg-raised px-3 py-2.5">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info/15 text-[12px] font-semibold text-info"
          aria-hidden="true"
        >
          {numero}
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-text">{titre}</h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">{description}</p>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">{children}</div>
    </section>
  );
}

/** Mesure passée et projection future restent deux blocs visuellement séparés. */
function DetailCoutAnalyse({ card }: { card: Card }) {
  const mesure = card.estimate?.analysisMeasurement;
  /* La même lecture que le tiroir « Contexte envoyé » : une seule règle, dans
     `shared`, pour retrouver la projection d'un chiffrage ancien ou récent. */
  const projection = projectionDeLExecution(card.estimate);

  const parties = mesure
    ? [
        ['Consignes HaikoDev', mesure.breakdown.haikoDevInstructions],
        ['Description de la carte', mesure.breakdown.cardDescription],
        ['Mémoire et instructions', mesure.breakdown.memoryAndInstructions],
        ["Lectures faites par l’agent", mesure.breakdown.agentReads],
      ] as const
    : [];

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface px-3 py-3" data-detail-cout-analyse>
      <div>
        <p className="text-[13.5px] font-semibold text-text">Analyse mesurée — déjà consommée</p>
        <p className="mt-0.5 text-[12.5px] text-faint">Ces chiffres viennent de l’événement d’usage du moteur.</p>
      </div>

      {mesure ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-total-analyse={mesure.totalTokens ?? ''}>
            <Metric label="Entrée hors cache" value={valeurMesuree(mesure.inputTokens)} />
            <Metric label="Déjà en cache" value={valeurMesuree(mesure.cachedInputTokens)} />
            <Metric label="Sortie" value={valeurMesuree(mesure.outputTokens)} />
            <Metric label="Total exact" value={totalMesureEnClair(mesure)} />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Etiquette
              nom="Quota 5 h mesuré"
              valeur={mesure.quota5h === undefined ? 'indisponible' : partQuota(mesure.quota5h)}
            />
            <Etiquette
              nom="Quota semaine mesuré"
              valeur={mesure.quotaWeekly === undefined ? 'indisponible' : partQuota(mesure.quotaWeekly)}
            />
          </div>

          <div className="space-y-1.5 border-t border-border pt-2" data-ventilation-analyse>
            <p className="text-[12px] font-medium uppercase tracking-wide text-faint">Ventilation mesurable</p>
            {parties.map(([label, part]) => (
              <div key={label} className="flex items-start justify-between gap-3 text-[13px]">
                <span className="text-faint">{label}</span>
                <span className="text-right text-text" title={part.note}>
                  {part.status === 'measured' && part.characters !== undefined
                    ? `${part.characters.toLocaleString('fr-CH')} caractères`
                    : `indisponible — ${part.note}`}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[13px] text-faint">Mesure détaillée indisponible pour cette analyse.</p>
      )}

      <div className="space-y-2 border-t border-border pt-2" data-projection-execution>
        <div>
          <p className="text-[13.5px] font-semibold text-text">Exécution projetée — estimation future</p>
          <p className="mt-0.5 text-[12.5px] text-faint">Ces valeurs ne sont pas une mesure de travail déjà effectué.</p>
        </div>
        {projection ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Tokens projetés" value={valeurMesuree(projection.tokens)} />
              <Metric
                label="Part de quota projetée"
                value={projection.quotaShare === undefined ? 'indisponible' : partQuota(projection.quotaShare * 100)}
              />
            </div>
            <p className="text-[13px] text-text">
              <span className="text-faint">Formule </span>
              {projection.formula ?? 'indisponible'}
            </p>
            {projection.assumptions.length ? (
              <ul className="list-disc space-y-1 pl-5 text-[13px] text-faint">
                {projection.assumptions.map((hypothese) => <li key={hypothese}>{hypothese}</li>)}
              </ul>
            ) : (
              <p className="text-[13px] text-faint">Hypothèses indisponibles.</p>
            )}
          </>
        ) : (
          <p className="text-[13px] text-faint">Projection indisponible.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Un champ de formulaire : l'étiquette au-dessus, le champ en dessous sur
 * toute la largeur, et l'explication en dessous. Jamais côte à côte : sur
 * téléphone, deux champs sur une ligne deviennent illisibles.
 */
export function Champ({
  label,
  aide,
  children,
}: {
  label: string;
  aide?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="block">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {aide ? <p className="mt-1 text-[12.5px] leading-relaxed text-faint">{aide}</p> : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <Tooltip label={hint}>
      <div className="rounded-md border border-border bg-surface px-2 py-1.5">
        <p className="text-[11.5px] uppercase tracking-wide text-faint">{label}</p>
        <p className={cn('mt-0.5 text-[14.5px] font-medium', tone === 'warning' ? 'text-warning' : 'text-text')}>
          {value}
        </p>
      </div>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Facturation                                                  */
/* ------------------------------------------------------------------ */

function BillingTab({ card, rate, project }: { card: Card; rate: number; project?: { billing?: any; name?: string } }) {
  const [title, setTitle] = React.useState(card.billing?.title ?? card.estimate?.billingTitle ?? card.title);
  const [description, setDescription] = React.useState(card.estimate?.billingDescription ?? card.description);
  const [hours, setHours] = React.useState(String(card.billing?.hours ?? card.estimate?.seniorHours ?? ''));
  const [documents, setDocuments] = React.useState<any[]>([]);
  const defaut = project?.billing?.defaultDocumentId as string | undefined;
  const [documentId, setDocumentId] = React.useState<string>(defaut ?? '');
  const [type, setType] = React.useState<'offer' | 'invoice'>(
    (project?.billing?.defaultDocumentType as 'offer' | 'invoice') ?? 'invoice',
  );
  const [busy, setBusy] = React.useState(false);
  const [available, setAvailable] = React.useState(true);
  const [confirmeNouveau, setConfirmeNouveau] = React.useState(false);

  React.useEffect(() => {
    client
      .call({ type: 'billing.documents' })
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => setAvailable(false));
  }, []);

  const amount = Number(hours) * rate;

  const push = async () => {
    if (!hours || Number.isNaN(Number(hours))) {
      client.pushToast('warning', 'Indiquez un nombre d\'heures');
      return;
    }
    // Sans document par défaut sur le projet, on ne devine pas : il faut dire
    // dans quelle facture ou quelle offre la ligne doit atterrir.
    if (!defaut && !documentId && !confirmeNouveau) {
      client.pushToast('warning', 'Choisissez le document, ou cochez « créer un nouveau document ».');
      return;
    }
    setBusy(true);
    try {
      await client.call({
        type: 'billing.push',
        cardId: card.id,
        documentType: type,
        documentId: documentId || undefined,
        title,
        description,
        hours: Number(hours),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'ajout impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 px-4 py-3">
      {card.billing ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-2.5 py-2 text-[13.5px] text-success">
          <Check className="h-3.5 w-3.5" />
          Déjà facturée — {card.billing.documentType === 'offer' ? 'offre' : 'facture'}{' '}
          {card.billing.documentNumber ?? card.billing.documentId} · {money(card.billing.amount)}
        </div>
      ) : null}

      <Champ label="Titre de la ligne">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
      </Champ>

      <Champ label="Description">
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
      </Champ>

      <Champ
        label="Heures (développeur senior)"
        aide={`Les heures qu'un développeur senior mettrait à la main — jamais la durée machine de l'agent (${duration(
          card.consumption?.machineSeconds,
        )}).`}
      >
        <Input
          value={hours}
          onChange={(event) => setHours(event.target.value.replace(',', '.'))}
          inputMode="decimal"
          placeholder="ex. 2.5"
        />
      </Champ>

      {/* Le calcul est fait par l'outil de facturation : ici on ne fait que le montrer. */}
      <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
        <span className="text-[13.5px] text-muted">
          {hours || '—'} h × {rate} CHF
        </span>
        <span className="text-[15.5px] font-semibold text-text">{hours ? money(amount) : '—'}</span>
      </div>

      {available ? (
        <>
          <Champ label="Type de document">
            <select
              value={type}
              onChange={(event) => setType(event.target.value as 'offer' | 'invoice')}
              className="h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
            >
              <option value="invoice">Facture</option>
              <option value="offer">Offre</option>
            </select>
          </Champ>

          <Champ label="Document">
            <select
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
            >
              <option value="">Nouveau document</option>
              {documents
                .filter((doc) => doc.type === type)
                .map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.number ?? doc.id} — {doc.title ?? 'sans titre'}
                  </option>
                ))}
            </select>
          </Champ>

          {!defaut && !documentId ? (
            <label className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={confirmeNouveau}
                onChange={(event) => setConfirmeNouveau(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span>
                Ce projet n'a pas de document attitré : cochez pour créer une nouvelle{' '}
                {type === 'offer' ? 'offre' : 'facture'} pour {project?.billing?.clientName ?? 'ce client'}, ou
                choisissez un document existant ci-dessus.
              </span>
            </label>
          ) : null}

          <Button variant="default" size="sm" className="w-full" disabled={busy} onClick={push}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleDollarSign className="h-3 w-3" />}
            Ajouter la ligne
          </Button>
        </>
      ) : (
        <p className="text-[13.5px] text-faint">L'outil de facturation n'est pas joignable depuis ce serveur.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet GitHub                                                       */
/* ------------------------------------------------------------------ */

/** Une date de dépôt s'affiche avec son heure : « 02.08 à 09:14 ». */
function dateHeure(valeur?: string): string {
  if (!valeur) return '—';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return valeur;
  return `${date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`;
}

function GithubTab({ card }: { card: Card }) {
  const [busy, setBusy] = React.useState(false);
  const tracking = card.github;

  const refresh = async () => {
    setBusy(true);
    try {
      await client.call({ type: 'github.refresh', cardId: card.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'lecture impossible');
    } finally {
      setBusy(false);
    }
  };

  const merge = async (method: 'merge' | 'squash' | 'rebase', auto = false) => {
    setBusy(true);
    try {
      await client.call({ type: 'github.merge', cardId: card.id, method, auto });
      client.pushToast('success', auto ? 'Fusion automatique activée' : 'Fusion demandée');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'fusion impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-faint" />
        <span className="text-[14px] text-text">{tracking?.branch ?? 'aucune branche'}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={refresh} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Actualiser
        </Button>
      </div>

      {tracking?.prNumber ? (
        <div className="rounded-md border border-border bg-surface px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Badge tone={tracking.prState === 'merged' ? 'success' : tracking.prState === 'closed' ? 'neutral' : 'strong'}>
              #{tracking.prNumber} {tracking.prState}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-[14px] text-text">{tracking.prTitle}</span>
            {tracking.prUrl ? (
              <a href={tracking.prUrl} target="_blank" rel="noreferrer" className="text-faint hover:text-text">
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
            {tracking.reviewDecision ? <Badge>revue : {tracking.reviewDecision}</Badge> : null}
            {tracking.mergeable ? <Badge>fusion : {tracking.mergeable}</Badge> : null}
          </div>

          {tracking.checks.length ? (
            <ul className="mt-2 space-y-0.5">
              {tracking.checks.slice(0, 8).map((check, index) => (
                <li key={index} className="flex items-center gap-1.5 text-[13px]">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      check.conclusion === 'SUCCESS'
                        ? 'bg-success'
                        : check.conclusion === 'FAILURE'
                          ? 'bg-danger'
                          : 'bg-warning',
                    )}
                  />
                  <span className="flex-1 truncate text-muted">{check.name}</span>
                  <span className="text-faint">{check.conclusion ?? check.status}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {tracking.prState === 'open' ? (
            <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => merge('squash')}>
                <GitMerge className="h-3 w-3" /> Fusionner (écrasée)
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => merge('merge')}>
                Fusion simple
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => merge('squash', true)}>
                Auto dès que les tests passent
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[13.5px] text-faint">Aucune demande de fusion liée pour l'instant.</p>
      )}

      {tracking?.commits.length ? (
        <div>
          <p className="mb-1 text-[12.5px] uppercase tracking-wide text-faint">Derniers commits</p>
          <ul className="space-y-0.5">
            {tracking.commits.map((commit) => (
              <li key={commit.sha} className="flex gap-2 text-[13px]">
                <code className="text-faint">{commit.sha.slice(0, 7)}</code>
                <span className="min-w-0 flex-1 truncate text-muted">{commit.message}</span>
                <span className="shrink-0 text-faint">{dateHeure(commit.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tracking?.activity.length ? (
        <div>
          <p className="mb-1 text-[12.5px] uppercase tracking-wide text-faint">Activité</p>
          <ul className="space-y-1.5">
            {tracking.activity.slice(0, 10).map((event, index) => (
              <li key={index} className="rounded border border-border bg-surface px-2 py-1.5 text-[13px]">
                <span className="text-text">{event.author}</span>{' '}
                <span className="text-faint">— {event.kind}</span>
                <span className="text-faint"> · {dateHeure(event.date)}</span>
                {event.body ? <p className="mt-0.5 line-clamp-3 text-muted">{event.body}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
