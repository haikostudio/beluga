import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileText,
  GitBranch,
  Loader2,
  MessageSquare,
  Paperclip,
  Play,
  Rocket,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  COLUMN_LABELS,
  ONGLETS_CARTE_TECHNIQUES,
  ongletTechnique,
  Attachment,
  Card,
  CardComment,
  DecisionGeste,
  DeployRun,
  EtatDeFichier,
  GesteCarte,
  carteSeReprend,
  etapesAMontrer,
  libelleCibleDeploiement,
  libelleEtapeDeploiement,
  phraseDesFichiers,
  resumeDeBranche,
  resumeDesFichiers,
  totalDesLignes,
  colonneDeReprise,
  libelleDeLancement,
  libelleDeReprise,
  decisionsParCarte,
  etatVisuelCarte,
  gesteCarte,
  mentionArchivage,
  mentionDeReprise,
  motAnalyse,
  phaseAnalyse,
} from '@haikodev/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  EmptyState,
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
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { Chat } from '@/components/chat';
import { MenuCarte } from '@/components/card-menu';
import { RepereAttention } from '@/components/repere-attention';
import { SilhouetteConversation } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { FournisseurDeChargement, useChargementOnglet, useOngletsQuiChargent } from '@/lib/chargement-onglet';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { useEstSimplifie } from '@/lib/mode-simplifie';
import { cn, duration, money, relativeTime } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';

export function CardPanel({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  const state = useApp();
  const card = cardId ? state.cards[cardId] : null;

  if (!cardId) return null;

  /*
   * Une notification peut viser une carte d'un projet qu'on n'a pas encore
   * sous les yeux : `allerVersDecision` change de projet puis demande la
   * carte dans le même geste, avant que ses cartes soient revenues du
   * serveur. Rendre `null` ici faisait le tiroir disparaître aussitôt ouvert
   * — un clic qui « ne fait rien ». On garde le tiroir ouvert avec une
   * silhouette : il se remplit tout seul dès que la carte arrive.
   */
  if (!card) {
    return (
      <Drawer open onClose={onClose}>
        <SilhouetteConversation />
      </Drawer>
    );
  }

  return (
    <Drawer open onClose={onClose}>
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
    analyseEnCours: agent?.status === 'running' || agent?.status === 'starting',
  });

  /* Ce que cette carte attend de vous — le même compte que son triangle sur le
     tableau, posé ici sur l'onglet où la décision se prend. */
  const decisions = decisionsParCarte(state.decisions)[card.id] ?? 0;
  /*
   * L'onglet « Détails » a disparu (réglages de l'agent et parcours vivent
   * maintenant dans la conversation) : la conversation est le seul point
   * d'entrée d'une carte, donc le seul onglet qui vaille au premier affichage.
   */
  const [onglet, setOnglet] = React.useState('chat');
  /* L'onglet « GitHub » — branche, enregistrements, fichiers modifiés — est la
     matière du métier, pas le suivi du travail : le mode simplifié le retire.
     Si c'était l'onglet ouvert, on retombe sur la conversation. */
  const simplifie = useEstSimplifie();
  const ongletActif = simplifie && ongletTechnique(ONGLETS_CARTE_TECHNIQUES, onglet) ? 'chat' : onglet;

  /*
   * Les gestes du pied suivent une règle partagée : un bouton ne s'allume que
   * lorsqu'il a du sens. « Terminer la tâche » apparaissait dès l'entrée dans
   * « En cours », donc pendant que l'agent travaillait encore — on pouvait
   * clôturer une carte dont personne n'avait lu la réponse.
   */
  const etat = etatVisuelCarte({
    agentStatut: agent?.status,
    enAttente: !!card.scheduling?.waitingReason,
    estimationEchouee: !!card.estimate?.failed,
    enLigne: !!card.deployedAt,
  });
  /*
   * « Valider (autorise la dépense) » n'a de sens que sur une carte pas encore
   * chiffrée : la carte naissant désormais dans « Planifié », c'est le chiffrage
   * — présent, ou déjà demandé — qui dit si le geste a encore lieu d'être.
   */
  const contexteGeste = {
    colonne: card.column,
    etat,
    agentLance: !!agent,
    chiffree: !!card.estimate || !!card.analyseDemandee,
  };
  const peut = (geste: GesteCarte) => gesteCarte(geste, contexteGeste);

  /*
   * Le pied ne s'affiche que s'il porte vraiment une décision à prendre : les
   * gestes rares sont partis dans le menu du haut, et un bandeau vide n'a plus
   * lieu d'être. Ce sont les mêmes règles que les boutons eux-mêmes, sinon la
   * barre pourrait apparaître pour n'y rien montrer.
   *
   * L'ONGLET « COMMENTAIRES » NE PORTE JAMAIS CE PIED : ses boutons de
   * lancement tombaient juste sous le champ de saisie d'une note, et se
   * faisaient cliquer par erreur en croyant valider le commentaire. Ils
   * restent atteignables depuis l'onglet « Conversation ».
   */
  /*
   * UNE CARTE-FIL DE CADRAGE PREND SES GESTES DE LANCEMENT DANS SON FIL, PAS
   * AU PIED DU TIROIR. Le couple « Lancer maintenant » / « Dès que possible »
   * s'affichait tout en bas, SOUS la barre d'écriture, pendant que « Lancer la
   * tâche » — la MÊME commande — se tenait juste au-dessus d'elle : deux
   * endroits pour un seul geste, et le plus visible des deux hors de vue au
   * moment de conclure la discussion. Ces gestes vivent désormais dans la
   * rangée posée au-dessus du champ de saisie (`GestesDeLancement`, `chat.tsx`).
   * Les autres cartes de « Planifié » gardent leur pied de tiroir intact.
   */
  const cadrageEnCours = card.column === 'planned' && agent?.role === 'cadrage';

  const aDecision =
    ongletActif !== 'comments' &&
    (peut('valider').affiche ||
    (card.column === 'planned' && !cadrageEnCours) ||
    peut('terminer').affiche ||
    (peut('publier').affiche && ongletActif === 'chat') ||
    peut('reprendre').affiche ||
    !!card.closureDoc);

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
  /* Ce que les onglets vont chercher : « GitHub » le déroulé de ses
     déploiements. Chacun l'annonce depuis son contenu. */
  const [chargement, signalerChargement] = useOngletsQuiChargent();

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
              <Badge>{t(COLUMN_LABELS[card.column])}</Badge>
              {card.deployedAt ? (
                <Badge tone="success">
                  <Rocket className="h-2.5 w-2.5" /> {t('en ligne')}
                </Badge>
              ) : null}
              {/* Une carte ressortie garde sa trace : on doit voir qu'elle
                  était passée par « Archivé », et quand. */}
              {mentionArchivage(card) ? (
                <Tooltip label={t('Archivée le {v0}', { v0: new Date(card.archivedAt!).toLocaleString(formatRegional()) })}>
                  <Badge>
                    <Archive className="h-2.5 w-2.5" /> {mentionArchivage(card)}
                  </Badge>
                </Tooltip>
              ) : null}
              {/* Une carte qui se reprend le dit là où on lit son état : le
                  travail déjà fait est gardé, on ne repart pas de zéro. */}
              {mentionDeReprise(card) ? (
                <Tooltip label={mentionDeReprise(card)!}>
                  <Badge tone="warning">
                    <RotateCcw className="h-2.5 w-2.5" /> {t('reprise')}
                  </Badge>
                </Tooltip>
              ) : null}
              {card.labels.map((label) => (
                <Badge key={label}>{label}</Badge>
              ))}
              <span>{t('modifiée {v0}', { v0: relativeTime(card.updatedAt) })}</span>
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
        value={ongletActif}
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
            'mx-4 mt-1 flex-none overflow-hidden rounded-md bg-raised transition-all duration-200',
            telephone && !barreVisible && 'max-h-0 opacity-0',
          )}
        >
        {/* La barre d'onglets flottait sur le fond du tiroir (`bg-surface`
            des deux côtés) : plus aucune limite visible depuis que la
            bordure des thèmes plats s'efface. Elle pose maintenant son
            propre fond — le même `bg-raised` que le champ de description,
            plus bas — pour se détacher du tiroir comme un bloc à part ; la
            piste de la pilule (`bg-surface`, posée par `TabsList`) et
            l'onglet actif (`bg-raised`) gardent leur écart d'avant. */}
        <ZoneDefilement axe="horizontal" classeEnveloppe="flex-none" className="px-1.5 py-1">
          <TabsList className="w-full border border-border">
            {/* La décision se prend DANS ce fil : l'onglet porte le même
                triangle que la carte du tableau, sinon le tiroir ouvert
                n'apprendrait plus rien. */}
            <TabsTrigger value="chat" className="flex-1 gap-1">
              
{t('Conversation')}
<RepereAttention compte={decisions} data-attention-carte={card.id} />
            </TabsTrigger>
            {/* Cet onglet va CHERCHER ses données : tant qu'elles ne sont pas
                là, une petite roue le dit — sinon on ne sait pas si l'onglet
                est vide ou s'il arrive. */}
            <TabsTrigger value="comments" className="flex-1 gap-1">

{t('Commentaires')}
<RoueDOnglet visible={!!chargement.comments} />
            </TabsTrigger>
            <TabsTrigger value="billing" className="flex-1">{t('Facturation')}</TabsTrigger>
            {simplifie ? null : (
            <TabsTrigger value="github" className="flex-1 gap-1">
              
{t('GitHub')}
<RoueDOnglet visible={!!chargement.github} />
            </TabsTrigger>
            )}
          </TabsList>
        </ZoneDefilement>
        </div>

        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <Chat agent={agent} projectId={card.projectId} cardId={card.id} vide={motAnalyse(phase)} />
        </TabsContent>

        <TabsContent value="comments" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <FournisseurDeChargement signaler={signalerChargement}>
            <CommentsTab card={card} />
          </FournisseurDeChargement>
        </TabsContent>

        <TabsContent value="billing" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ZoneDefilement><BillingTab card={card} rate={project?.billing?.hourlyRate ?? 130} project={project} /></ZoneDefilement>
        </TabsContent>

        {simplifie ? null : (
        <TabsContent value="github" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ZoneDefilement>
            <FournisseurDeChargement signaler={signalerChargement}>
              <GithubTab card={card} />
            </FournisseurDeChargement>
          </ZoneDefilement>
        </TabsContent>
        )}
      </Tabs>

      {/* Les gestes de décision restent en bas, toujours à portée de pouce ;
          les gestes rares sont partis dans le menu du haut. Sans décision à
          prendre, la barre disparaît au lieu de laisser un bandeau vide. */}
      {aDecision ? (
        <footer className="shrink-0 bg-surface px-4 py-2.5">
          {/* Les boutons se PARTAGENT la largeur : seul, un bouton la prend
              entière ; à plusieurs, ils se divisent la ligne et passent à la
              suivante en dessous de 150 px, toujours sans laisser de vide. */}
          <div className="grid items-center gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] [&>*]:w-full">
            {card.column === 'planned' && !cadrageEnCours ? (
              <>
                <Geste decision={peut('lancer')}>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!peut('lancer').possible}
                    onClick={() =>
                      Promise.resolve()
                        .then(() => {
                          if (peut('valider').affiche) {
                            return client.validerCarte(card);
                          }
                        })
                        .then(() =>
                          client
                            .call({ type: 'card.start', id: card.id })
                            // Un lancement ne répond qu'à la FIN du tour : le
                            // délai dépassé n'est pas un refus, et n'allume
                            // donc pas l'alerte de serveur injoignable.
                            .catch((err: any) => {
                              client.signalerRefus(err?.message ?? 'lancement refusé', card.id);
                              // …mais le bouton, lui, doit revenir à son état
                              // initial : avaler l'erreur ici lui ferait
                              // afficher une coche sur un lancement refusé.
                              throw err;
                            })
                        )
                    }
                  >
                    {/*
                     * « Reprendre », et non « Lancer maintenant », dès que la
                     * carte a déjà travaillé : le geste ne repart pas de zéro,
                     * il continue là où le tour s'était arrêté.
                     */}
                    {carteSeReprend(card) ? (
                      <RotateCcw className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}{' '}
                    {libelleDeLancement(card)}
                  </Button>
                </Geste>
                <Button
                  size="sm"
                  variant={card.scheduling?.asap ? 'subtle' : 'outline'}
                  onClick={() => client.call({ type: 'card.asap', id: card.id, value: !card.scheduling?.asap })}
                >
                  <Zap className="h-3 w-3" />  {t('Dès que possible')}
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
                  /* Le clic rend sa requête : le bouton montre la roue tant que
                     le serveur n'a pas répondu, la coche s'il accepte, et
                     revient tel quel si le geste est refusé — refus dit en
                     rouge, puis relancé pour que le bouton le sache. */
                  onClick={() =>
                    client.call({ type: 'card.finish', id: card.id }).catch((err: any) => {
                      client.signalerRefus(err?.message ?? 'clôture refusée', card.id);
                      throw err;
                    })
                  }
                >
                  <Check className="h-3 w-3" />  {t('Terminer la tâche')}
</Button>
              </Geste>
            ) : null}
            {/* Visible uniquement depuis la conversation : dans Facturation ou
                GitHub, ce geste de publication n'a pas sa place. */}
            {peut('publier').affiche && ongletActif === 'chat' ? (
              <Button size="sm" variant="default" onClick={() => client.moveCard(card, 'to_deploy')}>
                <Rocket className="h-3 w-3" />  {t('Mettre en file de publication')}
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
                {t(COLUMN_LABELS[colonneDeReprise(card.column)!])}
              </Button>
            ) : null}
            {card.closureDoc ? (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/document?card=${card.id}&download=1`}>
                  <FileText className="h-3 w-3" />  {t('Document de clôture')}
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
/**
 * La roue d'un onglet qui va chercher ses données. Elle prend la place d'un
 * caractère à côté du nom : l'onglet ne change donc pas de largeur en la
 * posant, et la barre ne se réorganise pas sous le doigt.
 */
function RoueDOnglet({ visible }: { visible: boolean }) {
  return (
    <span data-onglet-charge={visible ? '' : undefined} className="inline-flex h-3 w-3 items-center justify-center">
      {visible ? <Loader2 className="h-3 w-3 animate-spin text-en-cours" /> : null}
    </span>
  );
}

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

/* Les réglages de l'agent de la carte, le parcours et « ce qui était prévu »
   vivaient ici, dans l'onglet « Détails » — retiré, avec cet onglet. Le seul
   bloc repris (`ReglagesAgent`) vit maintenant dans le fil de conversation
   (`web/src/components/chat.tsx`), affiché une fois la configuration figée. */

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

/* ------------------------------------------------------------------ */
/* Onglet Facturation                                                  */
/* ------------------------------------------------------------------ */

function BillingTab({ card, rate, project }: { card: Card; rate: number; project?: { billing?: any; name?: string } }) {
  const [title, setTitle] = React.useState(card.billing?.title ?? card.estimate?.billingTitle ?? card.title);
  const [description, setDescription] = React.useState(card.estimate?.billingDescription ?? card.description);
  const [clientExplanation, setClientExplanation] = React.useState(
    card.billing?.clientExplanation ?? card.estimate?.clientExplanation ?? '',
  );
  const [hours, setHours] = React.useState(String(card.billing?.hours ?? card.estimate?.seniorHours ?? ''));
  const [documents, setDocuments] = React.useState<any[]>([]);
  const defaut = project?.billing?.defaultDocumentId as string | undefined;
  const [documentId, setDocumentId] = React.useState<string>(defaut ?? '');
  const [type, setType] = React.useState<'offer' | 'invoice'>(
    (project?.billing?.defaultDocumentType as 'offer' | 'invoice') ?? 'invoice',
  );
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
    /* Un refus de saisie est un ÉCHEC, pas un geste réussi : on le RELANCE
       après l'avoir dit, sinon le bouton afficherait sa coche sans rien avoir
       envoyé. */
    if (!hours || Number.isNaN(Number(hours))) {
      const raison = t('Indiquez un nombre d\'heures');
      client.pushToast('warning', raison);
      throw new Error(raison);
    }
    // Sans document par défaut sur le projet, on ne devine pas : il faut dire
    // dans quelle facture ou quelle offre la ligne doit atterrir.
    if (!defaut && !documentId && !confirmeNouveau) {
      const raison = t('Choisissez le document, ou cochez « créer un nouveau document ».');
      client.pushToast('warning', raison);
      throw new Error(raison);
    }
    /* Le bouton pose lui-même sa roue : `push` lui REND sa requête, et une
       erreur dite en rouge doit être RELANCÉE pour qu'il n'affiche pas de
       coche sur un ajout raté. */
    try {
      await client.call({
        type: 'billing.push',
        cardId: card.id,
        documentType: type,
        documentId: documentId || undefined,
        title,
        description,
        clientExplanation,
        hours: Number(hours),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'ajout impossible');
      throw err;
    }
  };

  return (
    <div className="space-y-4 px-4 py-3">
      {card.billing ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-2.5 py-2 text-[13.5px] text-success">
          <Check className="h-3.5 w-3.5" />
          
{t('Déjà facturée —')} {card.billing.documentType === 'offer' ? 'offre' : 'facture'}{' '}
          {card.billing.documentNumber ?? card.billing.documentId} · {money(card.billing.amount)}
        </div>
      ) : null}

      <Champ label={t('Titre de la ligne')}>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
      </Champ>

      <Champ label={t('Description')}>
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
      </Champ>

      <Champ
        label={t('Explication client')}
        aide={t('Ce que le client lira sur son devis ou sa facture — simple et ludique, sans jargon ni nom de fichier.')}
      >
        <Textarea
          value={clientExplanation}
          onChange={(event) => setClientExplanation(event.target.value)}
          rows={3}
        />
      </Champ>

      <Champ
        label={t('Heures (développeur senior)')}
        aide={t('Les heures qu\'un développeur senior mettrait à la main — jamais la durée machine de l\'agent ({v0}).', { v0: duration(
          card.consumption?.machineSeconds,
        ) })}
      >
        <Input
          value={hours}
          onChange={(event) => setHours(event.target.value.replace(',', '.'))}
          inputMode="decimal"
          placeholder="ex. 2.5"
        />
      </Champ>

      {/* Le calcul est fait par l'outil de facturation : ici on ne fait que le montrer. */}
      <div className="flex items-center justify-between rounded-md border border-border bg-raised px-3 py-2">
        <span className="text-[13.5px] text-muted">
          {t('{v0} h × {rate} CHF', { v0: hours || '—', rate })}</span>
        <span className="text-[15.5px] font-semibold text-text">{hours ? money(amount) : '—'}</span>
      </div>

      {available ? (
        <>
          <Champ label={t('Type de document')}>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as 'offer' | 'invoice')}
              className="h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
            >
              <option value="invoice">{t('Facture')}</option>
              <option value="offer">{t('Offre')}</option>
            </select>
          </Champ>

          <Champ label={t('Document')}>
            <select
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
            >
              <option value="">{t('Nouveau document')}</option>
              {documents
                .filter((doc) => doc.type === type)
                .map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.number ?? doc.id} — {doc.title ?? t('sans titre')}
                  </option>
                ))}
            </select>
          </Champ>

          {!defaut && !documentId ? (
            <label className="flex items-start gap-2 rounded-md border border-border bg-raised px-2.5 py-2 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={confirmeNouveau}
                onChange={(event) => setConfirmeNouveau(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span>
                {t('Ce projet n\'a pas de document attitré : cochez pour créer une nouvelle{v0} {v1} pour {v2}, ou choisissez un document existant ci-dessus.', { v0: ' ', v1: type === 'offer' ? 'offre' : 'facture', v2: project?.billing?.clientName ?? 'ce client' })}</span>
            </label>
          ) : null}

          <Button variant="default" size="sm" className="w-full" onClick={push}>
            <CircleDollarSign className="h-3 w-3" />
            
{t('Ajouter la ligne')}
</Button>
        </>
      ) : (
        <p className="text-[13.5px] text-faint">{t('L\'outil de facturation n\'est pas joignable depuis ce serveur.')}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Commentaires                                                 */
/* ------------------------------------------------------------------ */

/** Un commentaire tel que le serveur le rend : ses pièces jointes déjà résolues. */
type CommentaireAvecPieces = CardComment & { attachments: Attachment[] };

/**
 * DES NOTES LIBRES SUR LA CARTE, pièces jointes comprises — pour documenter
 * une étape utile, garder un repère personnel, ou expliquer un choix qu'une
 * conversation d'agent ne garderait pas au même endroit. Chaque ouverture de
 * l'onglet relit la liste (comme « GitHub » relit son déroulé) : pas de canal
 * temps réel dédié, un commentaire est écrit par une seule personne à la fois.
 */
function CommentsTab({ card }: { card: Card }) {
  const [comments, setComments] = React.useState<CommentaireAvecPieces[]>([]);
  const [charge, setCharge] = React.useState(true);
  useChargementOnglet('comments', charge);

  const [text, setText] = React.useState('');
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const [zoom, setZoom] = React.useState<Attachment | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const recharger = React.useCallback(() => {
    setCharge(true);
    client
      .call({ type: 'comment.list', cardId: card.id })
      .then((res: any) => setComments(res?.comments ?? []))
      .catch(() => undefined)
      .finally(() => setCharge(false));
  }, [card.id]);

  React.useEffect(() => {
    recharger();
  }, [recharger]);

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const response = await fetch(`/api/upload?project=${encodeURIComponent(card.projectId)}&card=${card.id}`, {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
          body: file,
        });
        const data = await response.json();
        const jointe: Attachment | undefined = data.attachment;
        if (!jointe) continue;
        setAttachments((current) => (current.some((a) => a.id === jointe.id) ? current : [...current, jointe]));
      }
    } catch {
      client.pushToast('error', t('Envoi du fichier impossible'));
    } finally {
      setUploading(false);
    }
  };

  /**
   * COLLER UNE IMAGE L'ATTACHE À LA NOTE : une capture prise au clavier
   * (`Ctrl+V`) arrive dans le presse-papiers comme un fichier sans nom. On lui
   * en donne un, daté, et on la fait passer par le MÊME envoi que le bouton
   * « Joindre un fichier » — aucun second stockage. Un collage de texte suit
   * son chemin normal : on ne l'intercepte pas.
   */
  const collerDepuisPressePapier = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fichiers = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!fichiers.length) return;
    event.preventDefault();
    const horodate = new Date().toISOString().replace(/[:.]/g, '-');
    upload(
      fichiers.map((fichier, index) =>
        fichier.name
          ? fichier
          : new File([fichier], `collage-${horodate}${index ? `-${index + 1}` : ''}.${(fichier.type.split('/')[1] || 'png')}`, {
              type: fichier.type,
            }),
      ),
    );
  };

  const envoyer = async () => {
    const texte = text.trim();
    if (!texte) return;
    setEnvoi(true);
    try {
      await client.call({
        type: 'comment.add',
        cardId: card.id,
        text: texte,
        attachmentIds: attachments.map((a) => a.id),
      });
      setText('');
      setAttachments([]);
      recharger();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Ajout impossible'));
    } finally {
      setEnvoi(false);
    }
  };

  const supprimer = async (id: string) => {
    // Retrait optimiste : une note qu'on vient de retirer ne doit pas rester
    // affichée le temps que le serveur réponde.
    setComments((current) => current.filter((c) => c.id !== id));
    try {
      await client.call({ type: 'comment.delete', id, cardId: card.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Suppression impossible'));
      recharger();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-4 py-3">
        {!charge && !comments.length ? (
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title={t('Aucun commentaire')}
            hint={t('Notez ici tout ce qui aide à documenter, comprendre ou exécuter cette carte.')}
          />
        ) : (
          /* UNE SUITE DE BULLES, TOUTES À GAUCHE : les notes se lisent comme
             une conversation avec soi-même. Aucune bulle à droite — il n'y a
             qu'un seul auteur, aligner en face n'opposerait personne à
             personne. La bulle ne prend au plus que 85 % de la largeur pour
             qu'on voie d'un coup d'œil où elle s'arrête. */
          <ul className="space-y-2.5" data-bulles-commentaires>
            {comments.map((comment) => (
              <li key={comment.id} className="flex justify-start" data-bulle-commentaire>
                <div className="group max-w-[85%] rounded-2xl rounded-bl-sm bg-raised px-3 py-2">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13.5px] text-text texte-copiable">
                      {comment.text}
                    </p>
                    {/* Le geste de retrait s'efface tant qu'on ne survole pas
                        la bulle : il ne doit pas peser dans la lecture. Sur
                        téléphone, où rien ne survole, il reste visible. */}
                    <Tooltip label={t('Retirer')}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        onClick={() => supprimer(comment.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </Tooltip>
                  </div>
                  {comment.attachments.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {comment.attachments.map((item) => (
                        <AttachmentThumb key={item.id} item={item} onOpen={() => setZoom(item)} compact />
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-1.5 text-[12px] text-faint">
                    {dateHeure(new Date(comment.createdAt).toISOString())}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ZoneDefilement>

      <div className="shrink-0 space-y-2 border-t border-border px-4 py-3">
        {/* Une pièce jointe en attente se RETIRE avant l'envoi : une capture
            collée par erreur se dégageait autrement en rechargeant l'onglet. */}
        {attachments.length ? (
          <div className="flex flex-wrap gap-1.5" data-pieces-en-attente>
            {attachments.map((item) => (
              <div key={item.id} className="group relative">
                <AttachmentThumb item={item} onOpen={() => setZoom(item)} compact />
                <button
                  type="button"
                  aria-label="Retirer"
                  className="absolute -right-1 -top-1 rounded-full bg-surface p-0.5 text-faint opacity-100 transition-opacity hover:text-text md:opacity-0 md:group-hover:opacity-100"
                  onClick={() => setAttachments((current) => current.filter((a) => a.id !== item.id))}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={collerDepuisPressePapier}
          placeholder={t('Écrire un commentaire, ou coller une image…')}
          rows={2}
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) upload(event.target.files);
              event.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-3 w-3" />
            {t('Joindre un fichier')}
          </Button>
          <Button size="sm" disabled={envoi || !text.trim()} onClick={envoyer}>
            {t('Ajouter')}
          </Button>
        </div>
      </div>

      <AttachmentPreview item={zoom} onClose={() => setZoom(null)} />
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
  return `${date.toLocaleDateString(formatRegional(), { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' })}`;
}

/** Une durée d'étape de publication : « 12 s », « 3 min ». */
function dureeEtape(debut?: number, fin?: number): string {
  if (!debut || !fin || fin < debut) return '';
  const secondes = Math.round((fin - debut) / 1000);
  if (secondes < 60) return `${secondes} s`;
  return `${Math.round(secondes / 60)} min`;
}

/** « +12 −3 », comme git. Un binaire n'a pas de compte : il rend rien. */
function lignesDuFichier(fichier: { ajoutees?: number; supprimees?: number }): React.ReactNode {
  if (fichier.ajoutees === undefined && fichier.supprimees === undefined) return null;
  return (
    <span className="shrink-0 font-mono text-[12.5px]" data-github-lignes>
      {fichier.ajoutees ? <span className="text-success">+{fichier.ajoutees}</span> : null}
      {fichier.ajoutees && fichier.supprimees ? ' ' : null}
      {fichier.supprimees ? <span className="text-danger">−{fichier.supprimees}</span> : null}
    </span>
  );
}

/**
 * UN NŒUD DE LA LIGNE DE TEMPS : sa pastille, son trait, puis son contenu.
 *
 * Le trait vertical est porté par le NŒUD lui-même (une bordure à gauche du
 * contenu), pas par un trait posé derrière toute la colonne : il s'arrête donc
 * tout seul sur le dernier nœud, quelle que soit sa hauteur.
 */
function NoeudDeTemps({
  ton,
  dernier,
  repere,
  children,
}: {
  ton: string;
  dernier?: boolean;
  repere?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pb-4 pl-5 last:pb-0" data-github-noeud={repere ?? 'branche'}>
      {!dernier ? <span className="absolute bottom-0 left-[3px] top-3 w-px bg-border" aria-hidden /> : null}
      <span className={cn('absolute left-0 top-[5px] h-[7px] w-[7px] rounded-full', ton)} aria-hidden />
      {children}
    </li>
  );
}

/** La couleur d'un fichier touché suit son sort : ajouté, modifié, supprimé. */
const TON_DU_FICHIER: Record<EtatDeFichier, string> = {
  ajoute: 'text-success',
  modifie: 'text-en-cours',
  supprime: 'text-danger',
  renomme: 'text-en-cours',
};

const LETTRE_DU_FICHIER: Record<EtatDeFichier, string> = {
  ajoute: 'A',
  modifie: 'M',
  supprime: 'S',
  renomme: 'R',
};


/**
 * L'ONGLET « GITHUB » : LA VIE DE LA BRANCHE, DE HAUT EN BAS.
 *
 * Il portait tout ce que GitHub sait dire — enregistrements, demande de fusion,
 * contrôles d'intégration, commentaires de revue — et l'essentiel s'y perdait.
 * Il ne garde donc que DEUX choses, dans l'ordre où elles arrivent : les
 * fichiers que la branche a changés, avec leurs lignes ajoutées et supprimées
 * comme le dit git, puis le déroulé de son déploiement.
 *
 * Tout se charge À L'OUVERTURE : le bouton « Actualiser » est retiré, on ne
 * demande plus à l'utilisateur de réclamer ce qu'il vient d'ouvrir.
 */
function GithubTab({ card }: { card: Card }) {
  const [deploiements, setDeploiements] = React.useState<DeployRun[]>([]);
  const tracking = card.github;

  const [charge, setCharge] = React.useState(true);
  useChargementOnglet('github', charge);

  /*
   * LE RELEVÉ DE LA BRANCHE SE FAIT À L'OUVERTURE, UNE FOIS PAR CARTE. Il lit
   * git et GitHub, donc on ne le rejoue pas à chaque rendu : la marque `releve`
   * garde la trace de la carte déjà relevée (elle protège aussi du double
   * montage du mode développement). Quand il rend, `fetchedAt` change et
   * l'effet ci-dessous recharge le déroulé.
   */
  const releve = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (releve.current === card.id) return;
    releve.current = card.id;
    setCharge(true);
    client.call({ type: 'github.refresh', cardId: card.id }).catch(() => undefined);
  }, [card.id]);

  React.useEffect(() => {
    let vivant = true;
    client
      .call({ type: 'github.deploiements', cardId: card.id })
      .then((res: any) => {
        if (vivant) setDeploiements(res?.deploiements ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (vivant) setCharge(false);
      });
    return () => {
      vivant = false;
    };
  }, [card.id, card.column, card.github?.fetchedAt]);

  const fichiers = tracking?.fichiers ?? [];
  const resume = resumeDesFichiers(fichiers);
  const lignes = totalDesLignes(fichiers);
  const etatBranche = resumeDeBranche(tracking ?? {});

  if (!tracking?.branch) {
    return (
      <div className="px-4 py-3">
        <p className="text-[13.5px] text-faint">{t('Cette carte n\'a pas encore de branche : elle n\'a jamais été lancée.')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center gap-2" data-github-branche>
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[14px] text-text texte-copiable">{tracking.branch}</span>
        <Badge tone={etatBranche.etat === 'fusionnee' ? 'success' : 'neutral'}>{etatBranche.phrase}</Badge>
      </div>

      <ul data-github-timeline>
        {/* 1. CE QUE LA BRANCHE A CHANGÉ : les fichiers, avec leurs lignes. */}
        <NoeudDeTemps ton={fichiers.length ? 'bg-termine' : 'bg-border'} dernier={!deploiements.length}>
          <p className="text-[13.5px] text-text" data-github-fichiers>
            {resume.total
              ? t('{v0} fichier{v1} — {v2}', { v0: resume.total, v1: resume.total > 1 ? 's' : '', v2: phraseDesFichiers(resume) })
              : tracking.fetchedAt
                ? t('Aucun fichier touché par cette branche pour l\'instant.')
                : t('Fichiers en cours de lecture…')}
            {lignes.ajoutees || lignes.supprimees ? (
              <span className="ml-1.5 font-mono text-[12.5px]">
                <span className="text-success">+{lignes.ajoutees}</span>{' '}
                <span className="text-danger">−{lignes.supprimees}</span>
              </span>
            ) : null}
          </p>

          {tracking.creeLe ? (
            <p className="mt-0.5 text-[12.5px] text-faint">{t('branche créée le {v0}', { v0: dateHeure(tracking.creeLe) })}</p>
          ) : null}

          {fichiers.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {fichiers.map((fichier) => (
                <li key={fichier.chemin} className="flex items-baseline gap-2 text-[13px]">
                  <span className={cn('w-3 shrink-0 font-mono', TON_DU_FICHIER[fichier.etat])}>
                    {LETTRE_DU_FICHIER[fichier.etat]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted texte-copiable">{fichier.chemin}</span>
                  {lignesDuFichier(fichier)}
                </li>
              ))}
            </ul>
          ) : null}
        </NoeudDeTemps>

        {/* 2. LE DÉROULÉ DU DÉPLOIEMENT, étape par étape. */}
        {deploiements.length
          ? deploiements.map((run, rang) => (
              <NoeudDeTemps
                key={run.id}
                repere="deploiement"
                dernier={rang === deploiements.length - 1}
                ton={
                  run.state === 'success'
                    ? 'bg-termine'
                    : run.state === 'failed'
                      ? 'bg-danger'
                      : run.state === 'running'
                        ? 'bg-en-cours'
                        : 'bg-border'
                }
              >
                <p className="text-[13.5px] text-text">
                  {libelleCibleDeploiement(run.cible)}
                  <span className="ml-1.5 text-[12.5px] text-faint">
                    {dateHeure(new Date(run.startedAt).toISOString())}
                  </span>
                </p>

                <ul className="mt-1 space-y-0.5">
                  {etapesAMontrer(run).map((etape) => (
                    <li key={etape.key} className="flex items-center gap-1.5 text-[13px]">
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          etape.state === 'done'
                            ? 'bg-termine'
                            : etape.state === 'failed'
                              ? 'bg-danger'
                              : etape.state === 'running'
                                ? 'bg-en-cours'
                                : 'bg-border',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-muted">{libelleEtapeDeploiement(etape.key)}</span>
                      <span className="shrink-0 text-faint">
                        {etape.state === 'skipped'
                          ? t('ignorée')
                          : etape.progress || dureeEtape(etape.startedAt, etape.endedAt)}
                      </span>
                    </li>
                  ))}
                </ul>

                {run.error ? <p className="mt-1 text-[13px] text-danger texte-copiable">{run.error}</p> : null}
              </NoeudDeTemps>
            ))
          : null}
      </ul>

      {!deploiements.length ? (
        <p className="text-[13.5px] text-faint">{t('Cette carte n\'a encore été emportée par aucun déploiement.')}</p>
      ) : null}
    </div>
  );
}
