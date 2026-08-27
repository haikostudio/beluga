import * as React from 'react';
import {
  AlertCircle,
  BatteryLow,
  Check,
  ChevronRight,
  Circle,
  Copy,
  CornerDownRight,
  Download,
  FileText,
  GitMerge,
  HelpCircle,
  History,
  LayoutGrid,
  Loader2,
  Paperclip,
  Play,
  RotateCcw,
  Route,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import {
  Attachment,
  DEFINITIONS_NIVEAU,
  MEMORY_STEP_ID,
  Message,
  NIVEAUX_AGENT,
  NIVEAU_PAR_DEFAUT,
  NiveauAgent,
  REFUS_A_COMPLETER,
  TYPE_JOINTES_COLLABLES,
  allegerMessageTechnique,
  choixPossible,
  comptesDeReprise,
  EtatDuPlan,
  cadreDePlanVisible,
  differencesDeTexte,
  heureExacte,
  numeroDeVersion,
  propositionsDuFil,
  reponsePrete,
  emballerJointes,
  estTitreDesSuggestions,
  jointesDuMessage,
  texteAvecTagsDesJointes,
  texteAEcouter,
  tempsRestant,
  texteDeReponse,
  triImages,
  versionSuivante,
  versionsPrecedentes,
  TITRE_SYNTHESE,
  estLeMessageDeSynthese,
} from '@haikodev/shared';
import { direVoix, taireVoix, useVoix } from '@/lib/voix';
import { Badge, Button, DialogTitle, Drawer, Textarea, ZoneDefilement } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { Steps } from '@/components/steps';
import { MemoryNote } from '@/components/todos';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { BullesDuPromptEnvoye } from '@/components/prompt-envoye';
import { RunChoix, RunSelectors, resoudreRun } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, heureDuMessage, jetons } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useEstSimplifie } from '@/lib/mode-simplifie';

/**
 * La ligne de repères sous un message : l'heure d'envoi, les jetons, ce qui est
 * propre à ce message (durée de travail), puis les boutons « Écouter » et
 * « Copier ».
 *
 * Une SEULE règle pour les deux côtés du fil : toujours visible, mise au second
 * plan par la couleur et la taille, jamais par la transparence. L'heure COURTE
 * est ce qu'on lit (`heureDuMessage`) ; l'heure exacte se donne en infobulle,
 * au survol. Elle est là sous CHAQUE bulle : le regroupement à la minute la
 * faisait disparaître dès qu'une réponse suivait dans la même minute.
 */
function LigneReperes({
  at,
  tokens,
  complements = [],
  texte,
  cle,
  aDroite = false,
  jointes = [],
}: {
  at: number;
  /** Les jetons de ce message : poids estimé de la demande sous une demande, total du tour sous une réponse. */
  tokens?: number;
  complements?: (string | null)[];
  texte: string;
  /** L'identifiant du message : sert au bouton d'écoute à savoir si c'est LUI qui parle. */
  cle: string;
  aDroite?: boolean;
  /** Les fichiers joints à ce message : la copie les emporte avec le texte. */
  jointes?: Attachment[];
}) {
  const visibles = complements.filter(Boolean) as string[];
  /* LE MODE SIMPLIFIÉ EFFACE LE COMPTE DE JETONS, jamais l'heure ni les
     boutons : ce chiffre n'a de sens que pour qui règle une consommation. */
  const simplifie = useEstSimplifie();
  const compteJetons = simplifie ? null : jetons(tokens);
  return (
    <div
      className={cn(
        'mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint',
        aDroite && 'justify-end',
      )}
      data-ligne-reperes=""
    >
      <span data-heure-message="" title={heureExacte(at)}>
        {heureDuMessage(at)}
      </span>
      {/* LES JETONS DE CE MESSAGE, remis à la demande de l'utilisateur : ce que
          la demande a coûté en entrée, ce que le tour a coûté en tout. Absents
          d'un message qui n'a rien mesuré (un tour d'avant cette règle, une
          bulle de service) : on n'écrit jamais un faux « 0 ». */}
      {compteJetons ? <span data-jetons-message="">{compteJetons}</span> : null}
      {visibles.map((item, index) => (
        <span key={index}>{item}</span>
      ))}
      <BoutonEcoute texte={texte} cle={cle} />
      <BoutonCopier texte={texte} jointes={jointes} />
    </div>
  );
}

/**
 * L'ERREUR SOUS UNE RÉPONSE. En mode ordinaire elle s'affiche telle quelle :
 * c'est ce dont on a besoin pour comprendre une panne.
 *
 * En MODE SIMPLIFIÉ, les traces d'appel et les chemins du serveur sont retirés
 * (`allegerMessageTechnique`) — l'erreur reste ANNONCÉE, en rouge, à sa place.
 * On ne cache jamais qu'il s'est passé quelque chose : quand il ne restait que
 * de la technique, une phrase simple prend le relais.
 */
function ErreurDeMessage({ texte }: { texte: string }) {
  const simplifie = useEstSimplifie();
  const affiche = simplifie
    ? (allegerMessageTechnique(texte) ?? t('Une erreur technique est survenue. Le détail est masqué par le mode simplifié.'))
    : texte;
  return (
    <div
      data-erreur-message
      className="mt-2 flex gap-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-[13.5px] text-danger"
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="leading-relaxed">{affiche}</span>
    </div>
  );
}

export function MessageView({
  message,
  allMessages,
  projectId,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  etatPlan = 'courant',
  onEcrireDansLeChamp,
  agentAuTravail = false,
  questionEnTexte = false,
}: {
  message: Message;
  /** La conversation entière : sert au cadre du plan à numéroter ses versions. */
  allMessages: Message[];
  /** Pour déplier la mémoire du projet sous l'étape de lecture. */
  projectId?: string;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
  /** Pour un message écrit en mode plan : est-ce le plan encore en jeu, ou une
   *  itération passée ? Une itération passée se replie et perd ses boutons
   *  (`indexDuPlanCourant`, `shared/src/plan-conversation.ts`). */
  etatPlan?: EtatDuPlan;
  /** L'agent est-il encore au travail sur CE message ? Une étape « en cours »
   *  ne s'anime que là : partout ailleurs, c'est le reliquat d'un tour coupé. */
  agentAuTravail?: boolean;
  /** Déposer un texte dans la barre d'écriture, SANS rien envoyer : c'est ainsi
   *  qu'un refus et une suggestion d'optimisation reviennent à l'utilisateur,
   *  qui les complète puis décide d'envoyer (`shared/src/suggestions-de-plan.ts`). */
  onEcrireDansLeChamp?: (texte: string) => void;
  /** Ce message finit sur une question écrite en TEXTE ORDINAIRE, encore
   *  ouverte (`questionEnTexteLibre`, jugé par le fil qui connaît la carte). */
  questionEnTexte?: boolean;
}) {
  const isUser = message.role === 'user';
  const state = useApp();

  /*
   * LA SYNTHÈSE DU BESOIN OUVRE LE FIL, ET ELLE NE SE LIT PAS COMME UNE
   * DEMANDE. C'est un texte long, écrit avant même que
   * la carte existe : le serrer dans une bulle étroite à droite, en texte brut,
   * le rendrait illisible (`shared/src/synthese-du-besoin.ts`). Il prend donc
   * toute la largeur, sous son titre, et se lit en Markdown comme une réponse.
   */
  if (isUser && estLeMessageDeSynthese(message.id)) {
    return (
      <div className="w-[min(92%,860px)] min-w-0 max-w-full">
        <div className="rounded-lg border border-faint bg-raised px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <FileText className="h-3.5 w-3.5" />
            <span>{t(TITRE_SYNTHESE)}</span>
          </div>
          <Markdown content={message.content} />
        </div>
        <LigneReperes at={message.createdAt} complements={[]} texte={message.content} cle={message.id} />
      </div>
    );
  }

  if (isUser) {
    /* TOUS les fichiers joints voyagent avec la copie du message
       (`BoutonCopier`), pas seulement les images : coller la demande dans la
       barre d'écriture repose les mêmes pièces jointes au-dessus du champ. */
    const connues = projectId ? (state.attachments[projectId] ?? []) : [];
    const jointes = jointesDuMessage(message.attachments, connues);

    /*
     * Vos demandes : à droite, sur une largeur réduite — suivies, dès que le
     * prompt est réellement parti, du FIL qui résume les recherches de l'agent
     * (`BullesDuPromptEnvoye`). Il est rendu à gauche, sous cette demande.
     */
    return (
      <>
        <div className="flex justify-end">
          <div className="w-[min(78%,520px)] min-w-0 max-w-full">
            <div className="overflow-hidden rounded-lg rounded-br-sm border border-border bg-raised px-3 py-2">
              {/*
               * Une adresse ou un chemin sans espace ne doit JAMAIS élargir la
               * bulle : elle pousserait la conversation vers la droite, et la
               * moindre sélection ferait glisser tout le fil de côté.
               */}
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[14.5px] leading-relaxed text-text">
                {message.content}
              </p>
              {message.attachments.length ? (
                <PiecesJointes ids={message.attachments} projectId={projectId} />
              ) : null}
            </div>
            <LigneReperes
              at={message.createdAt}
              tokens={message.tokens}
              complements={[]}
              texte={message.content}
              cle={message.id}
              aDroite
              jointes={jointes}
            />
          </div>
        </div>
        {message.sentContext ? (
          <BullesDuPromptEnvoye contexte={message.sentContext} demandeDejaAffichee />
        ) : null}
      </>
    );
  }

  /*
   * L'ordre de lecture est toujours le même (PLAN §26) : d'abord la mémoire du
   * projet relue, puis le déroulé réel qui se coche au fur et à mesure. La
   * liste des tâches, elle, ne défile PLUS avec les messages : elle vit dans
   * son volet fixe, au bas de la conversation.
   */
  const memoire = message.steps.find((step) => step.id === MEMORY_STEP_ID);
  const etapes = message.steps.filter((step) => step.id !== MEMORY_STEP_ID);

  /* Les cartes proposées ENCORE EN ATTENTE ne vivent plus ici : elles sont
     dans le bandeau fixe, au-dessus de la barre d'écriture. Le fil garde
     celles qui ont déjà été validées ou refusées. */
  const decidees = propositionsDuFil(message.proposals);

  // Les réponses de l'agent occupent l'essentiel de la largeur.
  return (
    <>
      {/* UN TOUR LANCÉ PAR UN BOUTON N'A PAS DE BULLE DE DEMANDE : son contexte
          est porté par cette réponse. Son fil de recherche se pose donc ici,
          au-dessus de la réponse et du déroulé. */}
      {message.sentContext ? <BullesDuPromptEnvoye contexte={message.sentContext} /> : null}
      <div className="group w-[min(92%,860px)] min-w-0 max-w-full">
        {memoire ? <MemoryNote step={memoire} projectId={projectId} /> : null}
        <Steps steps={etapes} streaming={message.streaming} agentAuTravail={agentAuTravail} />

        {message.content ? (
          cadreDePlanVisible(message) ? (
            <PlanBlock
              message={message}
              allMessages={allMessages}
              etat={etatPlan}
              pickedEvolutions={pickedEvolutions}
              onToggleEvolution={onToggleEvolution}
              onToggleAll={onToggleAll}
              onEcrireDansLeChamp={onEcrireDansLeChamp}
            />
          ) : (
            <Markdown
              content={message.content}
              pickedEvolutions={pickedEvolutions}
              onToggleEvolution={onToggleEvolution}
              onToggleAll={onToggleAll}
              streaming={message.streaming}
            />
          )
        ) : message.streaming && !etapes.length ? (
          <p className="text-[14px] text-faint">{t('L\'agent réfléchit…')}</p>
        ) : null}

        {/* Seules les propositions DÉCIDÉES restent ici : celles qui attendent
            encore un clic sont sorties du fil et se posent dans le bandeau fixe
            au-dessus de la barre d'écriture (`propositionsDuFil`). */}
        {decidees.length ? (
          <div className="mt-2 space-y-1.5">
            {decidees.map((proposal) => (
              <ProposalChip key={proposal.id} proposal={proposal} />
            ))}
          </div>
        ) : null}

        {message.repriseCompte ? <RepriseDeCompteCard message={message} /> : null}

        {message.erreurDeTour ? <ErreurDeTourCard message={message} /> : null}

        {/* La question écrite en TOUTES LETTRES, pas par l'outil : elle n'avait
            aucune trace dans la bulle, et sa seule sortie vivait dans une bande
            posée au-dessus du champ d'écriture. Toute bulle qui attend un geste
            porte désormais sa sortie CHEZ ELLE. */}
        {questionEnTexte ? <QuestionEnTexteCard messageId={message.id} /> : null}

        {message.questions.length ? (
          <div className="mt-2 space-y-2">
            {message.questions.map((question) => (
              <QuestionCard
                key={question.id}
                messageId={message.id}
                agentId={message.agentId}
                projectId={projectId}
                question={question}
              />
            ))}
          </div>
        ) : null}

        {message.downloads.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.downloads.map((offer) => (
              <a
                key={offer.id}
                href={`/api/download?token=${encodeURIComponent(offer.id)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-raised px-2 py-1 text-[13.5px] text-text hover:bg-border"
              >
                <Download className="h-3 w-3" />
                {offer.label}
              </a>
            ))}
          </div>
        ) : null}

        {message.error ? <ErreurDeMessage texte={message.error} /> : null}

        {/* L'heure se montre TOUJOURS, ordinateur comme téléphone, et des deux
            côtés du fil : la mettre au second plan se fait par la COULEUR et la
            taille, jamais par la transparence — effacée, elle disparaît.
            La durée du tour ne se dit que sous les RÉPONSES : une demande ne
            « dure » pas. C'est du temps machine, sans rapport avec les heures
            facturées, d'où la formulation « de travail ». */}
        <LigneReperes
          at={message.createdAt}
          tokens={message.tokens}
          complements={[
            message.durationMs && message.durationMs >= 1000
              ? `${duration(message.durationMs / 1000)} de travail`
              : null,
            /* LE RANGEMENT D'APRÈS-RÉPONSE, quand il a duré. La réponse est là,
               mais l'agent tient encore son tour : constat du dépôt, dossier de
               la carte refermé, branche fusionnée. Ce temps n'était visible
               nulle part, et c'est lui qui explique un agent « occupé » sur une
               conversation qui paraît finie (`Message.rangementMs`). */
            message.rangementMs && message.rangementMs >= 1000
              ? `puis ${duration(message.rangementMs / 1000)} de rangement`
              : null,
          ]}
          texte={message.content}
          cle={message.id}
        />
      </div>
    </>
  );
}

/**
 * Le texte envoyé par « Valider » : l'agent le lit comme un accord clair
 * (`CONSIGNE_MODE_PLAN`, `server/src/runtime.ts`) et propose alors la carte, plan
 * recopié dans son contexte. Le niveau choisi voyage dans le même message :
 * l'agent le reprend dans le champ « niveau » de la carte qu'il propose.
 */
const TEXTE_VALIDATION_PLAN = 'Vas-y, lance ce plan.';
function texteValidationPlan(niveau: NiveauAgent): string {
  return `${TEXTE_VALIDATION_PLAN} Niveau retenu pour la carte : « ${DEFINITIONS_NIVEAU[niveau].label} ».`;
}
/**
 * « REFUSER » NE LANCE RIEN. Il DÉPOSE ce refus dans la barre d'écriture, où il
 * se complète (« …, je préfère qu'on garde l'existant ») avant d'être envoyé.
 *
 * Le bouton envoyait ce texte tout seul : l'agent repartait aussitôt pour un
 * tour entier, à deviner ce qui n'allait pas dans un plan qu'on venait à peine
 * de refuser — de la dépense sur un malentendu. Le refus reste donc une phrase
 * à relire, et le geste qui lance appartient à l'utilisateur
 * (`REFUS_A_COMPLETER`, `shared/src/suggestions-de-plan.ts`).
 */
const TEXTE_REFUS_PLAN = REFUS_A_COMPLETER;
/** Le texte envoyé par « Repartir de cette version » : cite la version choisie en entier, pour ne rien perdre même si le fil a été résumé depuis. */
function texteRepriseVersion(numero: number, contenu: string): string {
  return `Abandonne les versions écrites après la version ${numero} de ce plan et repars de celle-ci, telle qu'elle était ci-dessous. Réponds avec un nouveau plan complet qui la reprend et l'affine.\n\n---\n\n${contenu}`;
}

/**
 * Le cadre d'un plan écrit en mode plan. Le plan s'affine par itérations : seul
 * le DERNIER est encore en jeu (`etat === 'courant'`). Une itération passée se
 * replie toute seule sur un bandeau — elle se rouvre d'un clic, rien n'est
 * perdu — et ne porte AUCUN bouton : décider sur une version périmée lancerait
 * un travail que personne n'a relu.
 *
 * Le plan courant porte son numéro de version et, s'il en existe, une liste
 * dépliable de ses versions précédentes. Les boutons du bas ne créent rien
 * eux-mêmes : ils envoient un message ordinaire dans la conversation,
 * exactement ce que taperait quelqu'un qui valide, refuse ou reprend une
 * version à la main (§PLAN mode plan). « Valider » repasse en plus la
 * conversation en mode direct, avec le niveau choisi ; « Repartir de cette
 * version » repasse en mode plan à partir du texte cité.
 *
 * « REFUSER », LUI, N'ENVOIE RIEN : il écrit dans la barre d'écriture et
 * s'arrête là. Un plan se refuse rarement sans avoir quelque chose à dire, et
 * relancer l'agent à l'aveugle coûtait un tour entier pour rien.
 *
 * LES SUGGESTIONS VIENNENT DU PLAN, pas d'un catalogue : sa partie
 * « Améliorations apportées » s'affiche cliquable (`estTitreDesSuggestions`,
 * `shared/src/suggestions-de-plan.ts`), et un clic retient l'idée dans la
 * barre d'écriture. Les pastilles d'axes de réflexion posées sous le cadre ont
 * été retirées : elles proposaient des angles écrits d'avance que personne ne
 * comprenait.
 */
function PlanBlock({
  message,
  allMessages,
  etat,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  onEcrireDansLeChamp,
}: {
  message: Message;
  allMessages: Message[];
  etat: EtatDuPlan;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
  onEcrireDansLeChamp?: (texte: string) => void;
}) {
  const courant = etat === 'courant';
  const [replie, setReplie] = React.useState(() => !courant);
  const etaitCourant = React.useRef(courant);
  React.useEffect(() => {
    if (etaitCourant.current && !courant) setReplie(true);
    etaitCourant.current = courant;
  }, [courant]);

  const [enCours, setEnCours] = React.useState<'valider' | 'repartir' | null>(null);
  const [niveau, setNiveau] = React.useState<NiveauAgent>(NIVEAU_PAR_DEFAUT);
  const [versionsOuvertes, setVersionsOuvertes] = React.useState(false);
  /** Le refus vient d'être déposé dans le champ : on le dit, sans rien lancer. */
  const [refusPrepare, setRefusPrepare] = React.useState(false);

  const numero = numeroDeVersion(allMessages, message.id);
  const precedentes = versionsPrecedentes(allMessages, message.id);
  const suivante = versionSuivante(allMessages, message.id);
  const diff = suivante ? differencesDeTexte(message.content, suivante.content) : null;

  const valider = async () => {
    setEnCours('valider');
    try {
      await client.call({ type: 'agent.config', agentId: message.agentId, run: { mode: 'direct' } });
      await client.call({
        type: 'agent.prompt',
        agentId: message.agentId,
        text: texteValidationPlan(niveau),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('envoi impossible'));
    } finally {
      setEnCours(null);
    }
  };

  /* REFUSER N'ENVOIE RIEN : la phrase de refus part dans la barre d'écriture,
     où elle se complète. Le tour ne démarre qu'à l'envoi. */
  const refuser = () => {
    setRefusPrepare(true);
    onEcrireDansLeChamp?.(TEXTE_REFUS_PLAN);
  };

  const repartir = async () => {
    setEnCours('repartir');
    try {
      await client.call({ type: 'agent.config', agentId: message.agentId, run: { mode: 'plan' } });
      await client.call({
        type: 'agent.prompt',
        agentId: message.agentId,
        text: texteRepriseVersion(numero, message.content),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('envoi impossible'));
    } finally {
      setEnCours(null);
    }
  };

  if (replie) {
    return (
      <button
        type="button"
        data-mode-plan-reponse="replie"
        data-mode-plan-etat={etat}
        onClick={() => setReplie(false)}
        className="flex w-full flex-nowrap items-center gap-1.5 overflow-hidden rounded-lg border border-border bg-fond-plan px-3 py-2 text-left text-[12px] font-medium uppercase tracking-wide text-muted transition-colors hover:text-text"
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <Route className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{courant ? t('Plan proposé') : t('Version précédente')}</span>
        {numero ? (
          <span className="shrink-0 whitespace-nowrap normal-case tracking-normal text-faint">{t('· version {numero}', { numero })}</span>
        ) : null}
      </button>
    );
  }

  return (
    /* UN PLAN POSE SON PROPRE FOND GRIS. C'est le seul bloc du fil sur lequel
       il y a une décision à prendre : il doit se repérer avant même d'être lu,
       sans emprunter une couleur d'état. Le gris vient d'un jeton à lui
       (`--fond-plan`, `web/src/styles.css`), décliné pour les deux thèmes —
       une opacité posée sur `surface` aurait donné un gris différent selon ce
       qu'il y a derrière, et presque rien en thème clair. */
    <div
      data-mode-plan-reponse="ouvert"
      data-mode-plan-etat={etat}
      className={cn(
        'rounded-lg border-2 bg-fond-plan px-3 py-3',
        courant ? 'border-border' : 'border-border/60',
      )}
    >
      {/* L'ENTÊTE TIENT SUR UNE SEULE LIGNE, même sur un téléphone : le titre,
          le numéro de version et le rappel des versions précédentes étaient
          empilés en colonnes dès que la largeur manquait. Rien ne revient donc
          à la ligne (« flex-nowrap », « whitespace-nowrap ») ; c'est le TITRE
          qui se laisse tronquer, jamais les chiffres, et les mots qui ne
          servent qu'au confort disparaissent sur écran étroit. */}
      <div data-entete-plan className="mb-2 flex flex-nowrap items-center justify-between gap-2 overflow-hidden">
        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">
          <Route className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{courant ? t('Plan proposé') : t('Version précédente')}</span>
          {numero ? (
          <span className="shrink-0 whitespace-nowrap normal-case tracking-normal text-faint">{t('· version {numero}', { numero })}</span>
        ) : null}
        </div>
        {courant && precedentes.length ? (
          <button
            type="button"
            data-versions-plan
            title={
              precedentes.length === 1
                ? t('{v0} version précédente', { v0: precedentes.length })
                : t('{v0} versions précédentes', { v0: precedentes.length })
            }
            onClick={() => setVersionsOuvertes((v) => !v)}
            className="flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] text-faint transition-colors hover:bg-surface hover:text-text"
          >
            <History className="h-3 w-3 shrink-0" />
            {precedentes.length === 1
              ? t('{v0} version précédente', { v0: precedentes.length })
              : t('{v0} versions précédentes', { v0: precedentes.length })}
            <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', versionsOuvertes && 'rotate-90')} />
          </button>
        ) : null}
        {courant ? null : (
          <button
            type="button"
            onClick={() => setReplie(true)}
            className="shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:text-text"
          >
            {t('Replier')}</button>
        )}
      </div>

      {courant && versionsOuvertes ? (
        <ul data-liste-versions-plan className="mb-3 space-y-1 rounded-md border border-border bg-raised px-2 py-1.5">
          {precedentes.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
              <span>{t('Version {v0}', { v0: numeroDeVersion(allMessages, v.id) })}</span>
              <span className="text-faint" title={heureExacte(v.createdAt)}>
                {heureDuMessage(v.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* « AMÉLIORATIONS APPORTÉES » EST UNE LISTE CLIQUABLE, comme les
          « Évolutions possibles » d'une réponse d'agent : un clic dépose
          l'idée dans la barre d'écriture, où elle se complète. Rien ne part
          tant que l'utilisateur n'envoie pas. Une version périmée, elle, se
          relit sans rien à cocher. */}
      <Markdown
        content={message.content}
        pickedEvolutions={pickedEvolutions}
        onToggleEvolution={courant ? onToggleEvolution : undefined}
        onToggleAll={courant ? onToggleAll : undefined}
        autreTitreCliquable={estTitreDesSuggestions}
        streaming={message.streaming}
      />

      {/* Les boutons de DÉCISION n'appartiennent qu'au plan ENCORE EN JEU : une
          version précédente se relit et se reprend, elle ne se décide plus. */}
      {!courant && diff ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">
            {t('Différences avec la version suivante')}</p>
          <DiffPlan lignes={diff} />
        </div>
      ) : null}

      {/* PLUS DE PASTILLES « POUR ALLER PLUS LOIN » SOUS LE PLAN. Elles
          proposaient des axes de réflexion écrits d'avance (« Plus simple »,
          « Une autre approche »…), sans rapport avec ce qu'on venait de lire :
          personne ne les comprenait. Les suggestions viennent désormais du
          PLAN lui-même, dans sa partie « Améliorations apportées » — et qui
          veut un autre angle le dit dans son message. */}

      {/* SUR UN TÉLÉPHONE, LE PIED DU PLAN S'EMPILE. Le choix du niveau et les
          deux boutons tenaient sur une ligne : « Approfondi » et « Refuser »
          sortaient du cadre ou s'écrasaient à quelques pixels. En dessous de
          640 px, chaque bloc prend donc toute la largeur, l'un sous l'autre. */}
      <div
        data-pied-plan
        className="mt-3 flex flex-col items-stretch gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap sm:items-center"
      >
        {courant ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              
{t('Niveau de la carte :')}
<div className="flex flex-1 gap-1">
                {NIVEAUX_AGENT.map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-niveau-plan={id}
                    aria-pressed={niveau === id}
                    title={DEFINITIONS_NIVEAU[id].quand}
                    onClick={() => setNiveau(id)}
                    className={cn(
                      'rounded-md border px-2 py-0.5 transition-colors',
                      niveau === id
                        ? 'border-accent/50 bg-raised text-text'
                        : 'border-border text-muted hover:bg-raised',
                    )}
                  >
                    {DEFINITIONS_NIVEAU[id].label}
                  </button>
                ))}
              </div>
            </div>
            <div
              data-boutons-plan
              className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center"
            >
              <Button
                variant="default"
                size="sm"
                disabled={!!enCours}
                onClick={valider}
                className="w-full justify-center gap-1.5 sm:w-auto"
              >
                {enCours === 'valider' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                
{t('Valider')}
</Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!enCours}
                onClick={refuser}
                className="w-full justify-center gap-1.5 text-muted hover:text-danger sm:w-auto"
              >
                <X className="h-3.5 w-3.5" />
                
{t('Refuser')}
</Button>
              {/* Le refus est ÉCRIT, pas parti : on le dit là où l'on vient de
                  cliquer, sinon rien ne se passe à l'écran et l'on reclique. */}
              {refusPrepare ? (
                <span data-refus-prepare className="text-[12.5px] text-warning sm:ml-1">
                  {t('Refus écrit dans la barre — complétez-le, puis envoyez.')}</span>
              ) : null}
            </div>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={!!enCours}
            onClick={repartir}
            className="gap-1.5"
          >
            {enCours === 'repartir' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            
{t('Repartir de cette version')}
</Button>
        )}
      </div>
    </div>
  );
}

/** Le texte qui a changé d'une version de plan à l'autre, ligne à ligne. */
function DiffPlan({ lignes }: { lignes: ReturnType<typeof differencesDeTexte> }) {
  return (
    <div className="space-y-0.5 rounded-md bg-raised px-2.5 py-2 font-mono text-[12px] leading-relaxed">
      {lignes.map((ligne, index) => (
        <div
          key={index}
          className={cn(
            'whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
            ligne.type === 'ajoute' && 'bg-success/10 text-success',
            ligne.type === 'retire' && 'text-danger line-through',
            ligne.type === 'egal' && 'text-faint',
          )}
        >
          {ligne.type === 'ajoute' ? '+ ' : ligne.type === 'retire' ? '- ' : '  '}
          {ligne.texte || ' '}
        </div>
      ))}
    </div>
  );
}

/**
 * Écouter un message à voix haute, avec la voix de l'assistant. Un appui lit,
 * un second appui arrête ; écouter un autre message coupe celui-ci — une parole
 * chasse l'autre (la voix est partagée avec le module d'annonces). La lecture
 * passe outre le bouton « Muet », comme la réécoute d'une annonce.
 *
 * Un message long est ramené à ses premières phrases complètes (`texteAEcouter`),
 * jamais coupé au milieu d'un mot ; sans rien à lire, aucun bouton.
 */
function BoutonEcoute({ texte, cle }: { texte: string; cle: string }) {
  const { parle, cle: actif } = useVoix();
  const aLire = texteAEcouter(texte);
  if (!aLire) return null;

  const enCours = parle && actif === cle;
  return (
    <button
      type="button"
      onClick={() => (enCours ? taireVoix() : direVoix(aLire, cle))}
      title={enCours ? t('Arrêter la lecture') : t('Écouter le message')}
      aria-label={enCours ? 'Arrêter la lecture' : 'Écouter le message'}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {enCours ? (
        <Square className="h-2.5 w-2.5 text-success" />
      ) : (
        <Volume2 className="h-2.5 w-2.5" />
      )}
      {enCours ? t('Arrêter') : t('Écouter')}
    </button>
  );
}

/** Au-delà de ce poids, les images ne sont plus recopiées en clair dans le
 *  presse-papiers : le collage HORS de l'application perdra l'aperçu, jamais
 *  les fichiers eux-mêmes (qui voyagent par leur identifiant, sans poids). */
const POIDS_IMAGES_COPIEES = 4 * 1024 * 1024;

/** Le texte d'un message, échappé pour tenir dans la version HTML de la copie. */
function echapperHtml(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * La version HTML de la copie : le texte, puis les images en clair. Elle ne
 * sert QU'AU DEHORS (un courriel, un traitement de texte) ; dans HaikoDev, ce
 * sont les pièces jointes d'origine qui sont recréées. Trop lourde, elle est
 * abandonnée : le texte et les fichiers, eux, passent toujours.
 */
async function htmlDeLaCopie(texte: string, images: Attachment[]): Promise<string | null> {
  if (!images.length) return null;
  const poids = images.reduce((total, item) => total + (item.size || 0), 0);
  if (poids > POIDS_IMAGES_COPIEES) return null;
  try {
    const morceaux = await Promise.all(
      images.map(async (item) => {
        const reponse = await fetch(`/api/attachment?id=${item.id}`);
        if (!reponse.ok) return null;
        const blob = await reponse.blob();
        if (!blob.type.startsWith('image/')) return null;
        const donnee = await new Promise<string | null>((resoudre) => {
          const lecteur = new FileReader();
          lecteur.onload = () => resoudre(typeof lecteur.result === 'string' ? lecteur.result : null);
          lecteur.onerror = () => resoudre(null);
          lecteur.readAsDataURL(blob);
        });
        return donnee ? `<img src="${donnee}" alt="${echapperHtml(item.name)}">` : null;
      }),
    );
    const balises = morceaux.filter(Boolean).join('');
    if (!balises) return null;
    return `${texte?.trim() ? `<pre>${echapperHtml(texte)}</pre>` : ''}${balises}`;
  } catch {
    return null;
  }
}

/**
 * Copier un message en entier. Le bouton reste discret et confirme d'un mot :
 * sans retour visible, on ne sait pas si le clic a pris.
 *
 * LES PIÈCES JOINTES VOYAGENT AVEC LE TEXTE, toutes, images comprises mais pas
 * seulement (`TYPE_JOINTES_COLLABLES`, `shared/src/presse-papiers-jointes.ts`) :
 * coller dans la barre d'écriture repose les fichiers D'ORIGINE au-dessus du
 * champ, comme si on venait de les ajouter. Elles partent par leur identifiant,
 * pas par leur contenu — rien n'est renvoyé au serveur.
 */
function BoutonCopier({
  texte: texteBrut,
  libelle = 'Copier',
  titre = t('Copier le message'),
  jointes = [],
}: {
  texte: string;
  libelle?: string;
  titre?: string;
  /** Copiées EN PLUS du texte : coller le message ré-attache ses fichiers. */
  jointes?: Attachment[];
}) {
  const [copie, setCopie] = React.useState(false);
  /* LE TEXTE COPIÉ NOMME SES FICHIERS. Un type de presse-papiers à nous ne
     survit pas au presse-papiers du SYSTÈME (téléphone) : les tags
     « [fichier: …] » sont alors le seul fil qui reste pour retrouver les
     fichiers d'origine au collage (`jointesDesTags`). */
  const texte = texteAvecTagsDesJointes(texteBrut ?? '', jointes);
  if (!texte?.trim() && !jointes.length) return null;

  const copierTexteSeul = () => {
    try {
      void navigator.clipboard.writeText(texte);
    } catch {
      // Presse-papiers refusé (page non sécurisée, vieux navigateur) : on passe
      // par un champ caché, la copie reste possible.
      const zone = document.createElement('textarea');
      zone.value = texte;
      zone.style.position = 'fixed';
      zone.style.opacity = '0';
      document.body.appendChild(zone);
      zone.select();
      document.execCommand('copy');
      zone.remove();
    }
  };

  /**
   * Une copie à PLUSIEURS TYPES : seul l'événement « copy » du navigateur
   * permet d'y glisser un type à nous. On passe donc par un champ caché
   * sélectionné, le temps d'un `execCommand` — la même mécanique que la copie
   * d'un tag « [fichier: …] » depuis la barre d'écriture.
   */
  const copierAvecJointes = (html: string | null): boolean => {
    const poser = (event: ClipboardEvent) => {
      event.preventDefault();
      event.clipboardData?.setData('text/plain', texte ?? '');
      event.clipboardData?.setData(TYPE_JOINTES_COLLABLES, emballerJointes(jointes));
      if (html) event.clipboardData?.setData('text/html', html);
    };
    const zone = document.createElement('textarea');
    zone.value = texte ?? ' ';
    zone.style.position = 'fixed';
    zone.style.opacity = '0';
    document.body.appendChild(zone);
    zone.select();
    document.addEventListener('copy', poser, { once: true, capture: true });
    let pris = false;
    try {
      pris = document.execCommand('copy');
    } catch {
      pris = false;
    }
    document.removeEventListener('copy', poser, { capture: true } as EventListenerOptions);
    zone.remove();
    return pris;
  };

  const copier = async () => {
    if (jointes.length) {
      const images = jointes.filter((item) => item.mime.startsWith('image/'));
      const html = await htmlDeLaCopie(texte, images);
      if (copierAvecJointes(html)) {
        setCopie(true);
        window.setTimeout(() => setCopie(false), 1800);
        return;
      }
      // Le navigateur refuse la copie à plusieurs types : le texte, au moins,
      // ne doit pas se perdre.
    }
    copierTexteSeul();
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={copier}
      title={titre}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {copie ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
      {copie ? t('Copié') : libelle}
    </button>
  );
}

/**
 * Les pièces jointes d'un message : les images se voient tout de suite, les
 * autres fichiers se reconnaissent à leur nom. Un clic ouvre l'aperçu en grand.
 */
function PiecesJointes({ ids, projectId }: { ids: string[]; projectId?: string }) {
  const state = useApp();
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const connues = projectId ? (state.attachments[projectId] ?? []) : [];

  // La liste du projet peut ne pas être encore chargée : on la demande.
  React.useEffect(() => {
    if (projectId && !state.attachments[projectId]) {
      client.send({ type: 'attachments.list', projectId });
    }
  }, [projectId]);

  const items = ids.map((id) => connues.find((item) => item.id === id)).filter(Boolean) as Attachment[];

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {items.length
          ? items.map((item) => <AttachmentThumb key={item.id} item={item} onOpen={() => setApercu(item)} />)
          : ids.map((id) => (
              <Badge key={id}>
                <Paperclip className="h-2.5 w-2.5" />  {t('pièce jointe')}
</Badge>
            ))}
      </div>
      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} />
    </>
  );
}

/**
 * Une question de l'agent : il attend votre réponse pour reprendre. Choix
 * unique, choix multiple ou texte libre — et toujours la possibilité d'ajouter
 * une précision.
 */
function QuestionCard({
  messageId,
  agentId,
  projectId,
  question,
}: {
  messageId: string;
  /** L'agent qui a posé la question : les images lui sont rattachées. */
  agentId?: string;
  projectId?: string;
  question: Message['questions'][number];
}) {
  const [choisis, setChoisis] = React.useState<string[]>([]);
  const [complement, setComplement] = React.useState('');
  /** Les images jointes à la réponse, avant l'envoi. */
  const [images, setImages] = React.useState<Attachment[]>([]);
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const [envoiFichier, setEnvoiFichier] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  // Une question sans choix ni réponse libre n'offre aucune façon de répondre.
  // Elle doit alors donner une sortie nette, plutôt que laisser une zone vide
  // qui ressemble à un blocage.
  const reponsePossible = question.options.length > 0 || question.allowFreeText;

  if (question.cancelled) {
    return (
      <div
        className="rounded-md border border-border bg-surface/60 px-2.5 py-2"
        data-question-agent={question.id}
      >
        <p className="text-[13px] text-faint">{question.question}</p>
        <p className="mt-1 flex min-w-0 items-start gap-1.5 text-[14px] text-faint">
          <X className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
          
{t('Question annulée')}
</p>
      </div>
    );
  }

  if (question.answer) {
    return (
      <div
        className="rounded-md border border-border bg-surface/60 px-2.5 py-2"
        data-question-agent={question.id}
      >
        <p className="text-[13px] text-faint">{question.question}</p>
        <p className="mt-1 flex min-w-0 items-start gap-1.5 text-[14px] text-text">
          <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
          <span className="min-w-0 flex-1 truncate" data-reponse-question>
            {question.answer}
          </span>
        </p>
        {/* La réponse déjà donnée montre ses images, à côté de son texte. */}
        {question.answerAttachments?.length ? (
          <PiecesJointes ids={question.answerAttachments} projectId={projectId} />
        ) : null}
      </div>
    );
  }

  /**
   * Joindre des images à la réponse. On réutilise le dépôt de fichiers de la
   * barre d'écriture, à l'identique — seul le tri change : ici, des images et
   * rien d'autre, et un fichier refusé le dit au lieu de disparaître.
   */
  const joindre = async (fichiers: FileList | File[]) => {
    const { gardees, refusees } = triImages(
      Array.from(fichiers).map((file) => ({ file, name: file.name, mime: file.type })),
    );
    if (refusees.length) {
      client.pushToast('warning', t('Seules les images peuvent être jointes à une réponse.'));
    }
    if (!gardees.length) return;
    setEnvoiFichier(true);
    try {
      for (const { file } of gardees) {
        const response = await fetch(
          `/api/upload?project=${encodeURIComponent(projectId ?? '')}${agentId ? `&agent=${agentId}` : ''}`,
          {
            method: 'POST',
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'x-file-name': encodeURIComponent(file.name),
            },
            body: file,
          },
        );
        const data = await response.json();
        const jointe: Attachment | undefined = data.attachment;
        if (!jointe) continue;
        // La même image envoyée deux fois ne s'ajoute qu'une fois.
        setImages((current) => (current.some((a) => a.id === jointe.id) ? current : [...current, jointe]));
      }
    } catch {
      client.pushToast('error', t('Envoi de l\'image impossible'));
    } finally {
      setEnvoiFichier(false);
    }
  };

  /*
   * Ces deux gestes RENDENT leur requête : c'est le bouton qui pose sa roue,
   * sa coche et son retour à l'état initial. Le refus est dit en rouge PUIS
   * relancé — sans quoi le bouton croirait avoir réussi.
   */
  const envoyer = async () => {
    const libelles = question.options.filter((o) => choisis.includes(o.id)).map((o) => o.label);
    const reponse = texteDeReponse(libelles, complement, images.length);
    if (!reponse) return;
    try {
      await client.call({
        type: 'question.answer',
        messageId,
        questionId: question.id,
        answer: reponse,
        attachments: images.map((a) => a.id),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réponse impossible'));
      throw err;
    }
  };

  const annuler = async () => {
    try {
      await client.call({ type: 'question.cancel', messageId, questionId: question.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'annulation impossible');
      throw err;
    }
  };

  const basculer = (id: string) =>
    setChoisis((current) =>
      question.kind === 'multiple'
        ? current.includes(id)
          ? current.filter((c) => c !== id)
          : [...current, id]
        : current.includes(id)
          ? []
          : [id],
    );

  const libellesChoisis = question.options.filter((o) => choisis.includes(o.id)).map((o) => o.label);
  const pret = reponsePrete(libellesChoisis, complement, images.length);

  return (
    <div
      className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2"
      data-question-agent={question.id}
      /* Une image lâchée n'importe où sur le bloc de la question se joint à la
         réponse : viser le champ au pixel près serait une contrainte inutile. */
      onDragOver={reponsePossible ? (event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      } : undefined}
      onDrop={reponsePossible ? (event) => {
        const fichiers = Array.from(event.dataTransfer.files);
        if (!fichiers.length) return;
        event.preventDefault();
        void joindre(fichiers);
      } : undefined}
    >
      <p className="flex items-start gap-1.5 text-[14px] font-medium text-text">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        {question.question}
      </p>

      {question.options.length ? (
        <div className="mt-2 space-y-1">
          {question.options.map((option) => {
            const actif = choisis.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => basculer(option.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                  actif ? 'border-accent/50 bg-raised text-text' : 'border-border bg-transparent text-muted hover:bg-raised',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {actif ? <Check className="h-3 w-3 text-success" /> : <Circle className="h-3 w-3 text-faint" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] leading-snug">{option.label}</span>
                  {option.description ? (
                    <span className="block text-[12.5px] text-faint">{option.description}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
          {question.kind === 'multiple' ? (
            <p className="px-1 text-[12px] text-faint">{t('Plusieurs réponses possibles.')}</p>
          ) : null}
        </div>
      ) : null}

      {question.allowFreeText ? (
        <Textarea
          value={complement}
          onChange={(event) => setComplement(event.target.value)}
          onPaste={(event) => {
            // Une image collée depuis le presse-papiers se joint sans passer par
            // un fichier : c'est le geste le plus courant après une capture.
            const fichiers = Array.from(event.clipboardData.files);
            if (!fichiers.length) return;
            event.preventDefault();
            void joindre(fichiers);
          }}
          rows={2}
          placeholder={question.options.length ? t('Précision (facultative)…') : t('Votre réponse…')}
          className="mt-2"
        />
      ) : null}

      {/* Les images jointes en attente : la croix retire celle qu'on ne veut
          plus, et rien ne part avant le clic sur « Répondre ». */}
      {images.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-images-reponse>
          {images.map((image) => (
            <div key={image.id} className="relative">
              <AttachmentThumb item={image} compact onOpen={() => setApercu(image)} />
              <button
                type="button"
                title={t('Retirer cette image')}
                aria-label={`Retirer l'image ${image.name}`}
                onClick={() => setImages((liste) => liste.filter((a) => a.id !== image.id))}
                className="absolute -right-1 -top-1 rounded-full border border-border bg-surface p-0.5 text-faint hover:border-danger/40 hover:text-danger"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} />

      {/* Une question peut porter assez d'options pour dépasser l'écran. Les
          deux issues restent donc collées au bas du fil pendant sa lecture :
          répondre ou quitter ne doit jamais demander de deviner qu'un bouton
          se cache plus bas. */}
      <div
        className="sticky bottom-0 z-10 -mx-2.5 -mb-2 mt-2 flex flex-wrap items-center gap-1.5 border-t border-warning/20 bg-surface/95 px-2.5 py-2 backdrop-blur-sm"
        data-actions-question
        data-question-sans-reponse={reponsePossible ? undefined : ''}
      >
        {reponsePossible ? (
          <>
            <Button variant="default" size="sm" disabled={!pret} onClick={envoyer}>
              {t('Répondre')}</Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              data-champ-image
              onChange={(event) => {
                if (event.target.files?.length) void joindre(event.target.files);
                event.target.value = '';
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              title={t('Joindre une image')}
              aria-label="Joindre une image à la réponse"
              disabled={envoiFichier}
              onClick={() => fileRef.current?.click()}
            >
              {envoiFichier ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
{t('Image')}
</Button>
          </>
        ) : null}
        {/* Sans aucune façon de répondre, « Annuler » est la SEULE issue : il
            prend toute la largeur de la bulle, avec sa bordure, au lieu de se
            faire passer pour un lien discret posé dans un coin. */}
        <Button
          variant={reponsePossible ? 'ghost' : 'outline'}
          size="sm"
          title={t('Fermer la question sans répondre')}
          onClick={annuler}
          data-annuler-question
          className={cn(
            reponsePossible
              ? 'text-faint hover:text-danger'
              : 'w-full justify-center border-danger/40 text-danger hover:bg-danger/10 hover:text-danger',
          )}
        >
          <X className="h-3 w-3" />

{t('Annuler')}
</Button>
      </div>
    </div>
  );
}

/**
 * LA QUESTION ÉCRITE EN TOUTES LETTRES, dans sa bulle.
 *
 * L'agent a fini son tour sur une question posée en texte ordinaire : rien ne
 * la distinguait du reste de sa réponse, et sa seule sortie était un « Annuler »
 * relégué dans une bande au-dessus du champ d'écriture — invisible dès qu'on
 * lisait la conversation ailleurs qu'en bas, et introuvable sur téléphone. Le
 * bloc dit ce qui est attendu et porte sa sortie, comme une vraie question
 * d'outil. La réponse, elle, s'écrit toujours dans la barre : rien de neuf à
 * apprendre.
 */
function QuestionEnTexteCard({ messageId }: { messageId: string }) {
  const [busy, setBusy] = React.useState(false);

  const annuler = async () => {
    setBusy(true);
    try {
      await client.call({ type: 'question.cancelTexte', messageId });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'annulation impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2"
      data-question-en-texte={messageId}
    >
      <p className="flex items-start gap-1.5 text-[13.5px] text-text">
        <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span className="min-w-0">{t('L\'agent attend votre réponse — écrivez-la ci-dessous.')}</span>
      </p>
      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          title={t('Fermer la question sans répondre')}
          onClick={() => void annuler()}
          data-annuler-question-texte
          className="text-faint hover:text-danger"
        >
          <X className="h-3 w-3" />
          {t('Annuler')}
        </Button>
      </div>
    </div>
  );
}

/**
 * « AVEC QUEL COMPTE POURSUIVRE ? »
 *
 * Le tour a été coupé net par la limite d'un compte. Le travail n'est pas
 * cassé : il lui manque du quota. Ce bloc propose les AUTRES comptes du même
 * moteur — jamais un autre moteur, jamais le compte tombé — et le clic relance
 * le même agent, avec son fil, sa branche et ses étapes restantes.
 *
 * La liste n'est pas figée dans le message : elle se calcule à chaque rendu
 * depuis le relevé de quota reçu par l'application. Un compte qui se libère
 * apparaît donc TOUT SEUL, sans recharger la page — c'est ce qui fait tenir le
 * cas « aucun compte libre pour l'instant ».
 */
function RepriseDeCompteCard({ message }: { message: Message }) {
  const { quotas } = useApp();
  const [busy, setBusy] = React.useState(false);
  const reprise = message.repriseCompte!;

  const choix = React.useMemo(
    () =>
      comptesDeReprise(
        reprise.engine,
        reprise.compteEpuise,
        quotas.map((quota) => ({
          id: quota.id,
          label: quota.label,
          engine: quota.engine,
          disponible: quota.available !== false && !quota.disabled,
          coupe: quota.disabled,
          consommePct: Math.max(quota.session?.usedPct ?? 0, quota.weekly?.usedPct ?? 0),
          resetsAt: [quota.session?.resetsAt, quota.weekly?.resetsAt]
            .filter((v): v is number => typeof v === 'number' && v > 0)
            .sort((a, b) => a - b)[0],
        })),
      ),
    [quotas, reprise.engine, reprise.compteEpuise],
  );
  const possible = choixPossible(choix);

  // Décision déjà prise : le bloc reste dans le fil, refermé, et dit sur quel
  // compte le travail est reparti. Aucun bouton — on ne repart pas deux fois.
  if (reprise.choisi) {
    return (
      <div
        className="mt-2 rounded-md border border-border bg-surface/60 px-2.5 py-2"
        data-reprise-compte="reprise"
      >
        <p className="flex min-w-0 items-start gap-1.5 text-[13.5px] text-muted">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span className="min-w-0">
            {reprise.automatique
              ? t('Le compte « {v0} » avait atteint sa limite : HaikoDev a poursuivi automatiquement sur « {v1} ».', { v0: reprise.compteEpuiseLabel, v1: reprise.choisiLabel ?? reprise.choisi })
              : t('Le compte « {v0} » avait atteint sa limite : le travail a repris sur « {v1} ».', { v0: reprise.compteEpuiseLabel, v1: reprise.choisiLabel ?? reprise.choisi })}</span>
        </p>
      </div>
    );
  }

  /*
   * DÉCISION ABANDONNÉE : la carte a été rangée, ou l'on a cliqué « Annuler ».
   * Même forme refermée que le choix fait — le bloc reste dans le fil parce
   * qu'il raconte pourquoi le travail s'est arrêté là, mais il ne réclame plus
   * rien et n'est plus jaune.
   */
  if (reprise.abandonnee) {
    return (
      <div
        className="mt-2 rounded-md border border-border bg-surface/60 px-2.5 py-2"
        data-reprise-compte="abandonnee"
      >
        <p className="flex min-w-0 items-start gap-1.5 text-[13.5px] text-muted">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
          <span className="min-w-0">
            {t('Le compte « {v0} » avait atteint sa limite : le travail n’a pas été repris.', { v0: reprise.compteEpuiseLabel })}</span>
        </p>
      </div>
    );
  }

  const reprendre = async (accountId: string) => {
    setBusy(true);
    try {
      await client.call({ type: 'reprise.compte', messageId: message.id, accountId });
    } catch (err: any) {
      client.pushToast('warning', err?.message ?? 'reprise impossible');
    } finally {
      setBusy(false);
    }
  };

  const abandonner = async () => {
    setBusy(true);
    try {
      await client.call({ type: 'reprise.abandon', messageId: message.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'annulation impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2"
      data-reprise-compte="attente"
    >
      <p className="flex items-start gap-1.5 text-[14px] font-medium text-text">
        <BatteryLow className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        
{t('Avec quel compte poursuivre ?')}
</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        {t('Le compte « {v0} » a atteint sa limite en plein travail {v1}. Le travail n’est pas perdu : il repart où il s’est arrêté, avec le même agent et la même branche.', { v0: reprise.compteEpuiseLabel, v1: tempsRestant(reprise.resetsAt) ? ` (${tempsRestant(reprise.resetsAt)})` : '' })}</p>

      {possible ? (
        <div className="mt-2 space-y-1">
          {choix
            .filter((compte) => compte.disponible)
            .map((compte) => (
              <button
                key={compte.id}
                type="button"
                disabled={busy}
                data-compte-reprise={compte.id}
                onClick={() => void reprendre(compte.id)}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-transparent px-2 py-1.5 text-left text-muted transition-colors hover:bg-raised disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                ) : (
                  <Circle className="h-3 w-3 shrink-0 text-faint" />
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] text-text">{compte.label}</span>
                {typeof compte.consommePct === 'number' ? (
                  <span className="shrink-0 text-[12px] text-faint">
                    {t('{v0} % consommés', { v0: Math.round(compte.consommePct) })}</span>
                ) : null}
              </button>
            ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-warning" data-reprise-attente>
          {t('Aucun autre compte n’est libre pour l’instant. Ce choix reste ouvert et s’actualise tout seul : dès qu’un compte retrouve du quota, il apparaît ici.')}</p>
      )}

      {/* Les comptes du même moteur encore à sec : les nommer vaut mieux qu'un
          vide, on sait ce qu'on attend et pour combien de temps. */}
      {choix.some((compte) => !compte.disponible) ? (
        <ul className="mt-2 space-y-0.5">
          {choix
            .filter((compte) => !compte.disponible)
            .map((compte) => (
              <li key={compte.id} className="flex items-center gap-2 px-2 text-[12.5px] text-faint">
                <span className="min-w-0 flex-1 truncate">{compte.label}</span>
                <span className="shrink-0">{tempsRestant(compte.resetsAt) ?? t('à sec')}</span>
              </li>
            ))}
        </ul>
      ) : null}

      {/*
       * LA SORTIE, DANS LA BULLE. C'était la seule bulle jaune du fil à n'en
       * avoir aucune : quand plus aucun compte ne devait revenir, elle restait
       * allumée à vie et gardait « Répondre » sur sa carte. Comme sur une
       * question d'outil, le bouton prend TOUTE LA LARGEUR quand il est la
       * seule issue, et se fait discret dès qu'un compte est proposé à côté.
       */}
      <div className="mt-2 flex justify-end">
        <Button
          variant={possible ? 'ghost' : 'outline'}
          size="sm"
          disabled={busy}
          title={t('Fermer sans reprendre le travail')}
          onClick={() => void abandonner()}
          data-annuler-reprise
          className={cn(
            possible
              ? 'text-faint hover:text-danger'
              : 'w-full justify-center border-danger/40 text-danger hover:bg-danger/10 hover:text-danger',
          )}
        >
          <X className="h-3 w-3" />
          {t('Annuler')}
        </Button>
      </div>
    </div>
  );
}

/**
 * « UNE ERREUR A ARRÊTÉ LE TRAVAIL » — ni une panne passagère (elle s'est déjà
 * retentée toute seule), ni une limite de compte (sa propre bulle jaune) :
 * une erreur qui a coupé le tour net et qui reste sans réponse tant que
 * personne n'a choisi. Trois issues, jamais de choix par défaut : relancer le
 * même agent, ignorer (le travail déjà fait suffit), ou arrêter (la carte
 * revient en « Planifié »).
 */
function ErreurDeTourCard({ message }: { message: Message }) {
  const [busy, setBusy] = React.useState<'relancer' | 'ignorer' | 'arreter' | null>(null);
  const erreur = message.erreurDeTour!;

  if (erreur.choix) {
    const libelle =
      erreur.choix === 'relancer'
        ? t('Le travail a été relancé.')
        : erreur.choix === 'ignorer'
          ? t('L’erreur a été ignorée : la carte est rangée telle quelle.')
          : t('Le travail a été arrêté : la carte est revenue en « Planifié ».');
    return (
      <div className="mt-2 rounded-md border border-border bg-surface/60 px-2.5 py-2" data-erreur-de-tour="decidee">
        <p className="flex min-w-0 items-start gap-1.5 text-[13.5px] text-muted">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span className="min-w-0">{libelle}</span>
        </p>
      </div>
    );
  }

  const repondre = async (choix: 'relancer' | 'ignorer' | 'arreter') => {
    setBusy(choix);
    try {
      await client.call({ type: 'erreur.repondre', messageId: message.id, choix });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'réponse impossible');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-danger/40 bg-danger/5 px-2.5 py-2" data-erreur-de-tour="attente">
      <p className="flex items-start gap-1.5 text-[14px] font-medium text-text">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
        {t('Une erreur a arrêté le travail')}
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{erreur.cause}</p>

      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void repondre('arreter')}
          data-erreur-arreter
        >
          {busy === 'arreter' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
          {t('Arrêter')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void repondre('ignorer')}
          data-erreur-ignorer
        >
          {busy === 'ignorer' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {t('Ignorer')}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy !== null}
          onClick={() => void repondre('relancer')}
          data-erreur-relancer
        >
          {busy === 'relancer' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {t('Relancer')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Une carte proposée DÉJÀ DÉCIDÉE, laissée à sa place dans le fil : elle
 * appartient à l'histoire de l'échange. Celles qui attendent encore un clic ne
 * passent plus par ici — elles vivent dans le bandeau fixe au-dessus de la
 * barre d'écriture (`BandeauPropositions`), où le défilement ne les emporte
 * pas.
 */
function ProposalChip({ proposal }: { proposal: Message['proposals'][number] }) {
  const state = useApp();
  const [lancement, setLancement] = React.useState(false);

  if (proposal.decision === 'accepted') {
    const card = proposal.cardId ? state.cards[proposal.cardId] : undefined;
    const peutLancer = card && card.column === 'planned';

    const lancer = (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!card || lancement) return;
      const chiffree = !!card.estimate || !!card.analyseDemandee;
      setLancement(true);
      Promise.resolve()
        .then(() => (chiffree ? undefined : client.validerCarte(card)))
        .then(() =>
          client.call({ type: 'card.start', id: card.id }).catch((err: any) => {
            client.signalerRefus(err?.message ?? t('lancement refusé'), card.id);
            throw err;
          }),
        )
        .catch(() => {})
        .finally(() => setLancement(false));
    };

    return (
      /* CE N'EST PAS UN `button`, ET C'EST VOULU : sous WebKit (Safari, donc
         tous les navigateurs de l'iPhone), la boîte de contenu d'un `button`
         réclame à la mise en page la hauteur du texte ENTIER d'un paragraphe
         replié — la pastille se dessinait bien sur deux lignes, mais son
         parent en réservait vingt, d'où le grand vide sous une carte validée.
         Un bloc ordinaire muni du rôle « bouton » se mesure honnêtement, et
         garde le clic, le clavier et l'annonce aux lecteurs d'écran. */
      <div
        data-carte-proposee="validee"
        role="button"
        tabIndex={0}
        onClick={() => proposal.cardId && client.openCard(proposal.cardId)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (proposal.cardId) client.openCard(proposal.cardId);
        }}
        className="w-full cursor-pointer rounded-md border border-success/40 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-raised"
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-success">
          <Check className="h-3 w-3" />
          
{t('Carte créée dans « Planifié »')}
</div>
        <p className="text-[14.5px] font-medium leading-snug text-text">{proposal.title}</p>
        {proposal.description ? (
          <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-muted">{proposal.description}</p>
        ) : null}
        {proposal.labels.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {proposal.labels.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </div>
        ) : null}
        {peutLancer ? (
          <Button size="sm" variant="outline" className="mt-2" disabled={lancement} onClick={lancer}>
            <Play className="h-3 w-3" /> {lancement ? t('Lancement…') : t('Lancer')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (proposal.decision === 'merged') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-surface/60 px-3 py-2 text-[13.5px] text-muted">
        <GitMerge className="h-3 w-3 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">{proposal.title}</span>
        <span className="text-[12px]">{t('réunie dans une autre proposition')}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-3 py-2 text-[13.5px] text-faint">
      <X className="h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate line-through">{proposal.title}</span>
      <span className="text-[12px]">{t('carte refusée')}</span>
    </div>
  );
}
