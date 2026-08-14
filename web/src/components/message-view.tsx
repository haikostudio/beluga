import * as React from 'react';
import {
  AlertCircle,
  BatteryLow,
  Braces,
  Check,
  ChevronRight,
  Circle,
  Copy,
  Download,
  GitMerge,
  HelpCircle,
  History,
  LayoutGrid,
  Loader2,
  Paperclip,
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
  SentContextSnapshot,
  TYPE_JOINTES_COLLABLES,
  choixPossible,
  chronologieContexteEnvoye,
  comptesDeReprise,
  EtatDuPlan,
  differencesDeTexte,
  heureExacte,
  numeroDeVersion,
  propositionsDuFil,
  reponsePrete,
  emballerJointes,
  estTitreDesSuggestions,
  jointesDuMessage,
  texteAEcouter,
  tempsRestant,
  texteDeReponse,
  triImages,
  versionSuivante,
  versionsPrecedentes,
} from '@haikodev/shared';
import { direVoix, taireVoix, useVoix } from '@/lib/voix';
import { Badge, Button, DialogTitle, Drawer, Textarea, ZoneDefilement } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { Steps } from '@/components/steps';
import { MemoryNote } from '@/components/todos';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { LecteurPrompt, texteDunTourEnvoye } from '@/components/lecteur-prompt';
import { RunChoix, RunSelectors, resoudreRun } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, relativeTime } from '@/lib/utils';

/**
 * La ligne de repères sous un message : l'ancienneté, ce qui est propre à ce
 * message (durée de travail), puis le bouton « Copier ».
 *
 * Une SEULE règle pour les deux côtés du fil : toujours visible, mise au second
 * plan par la couleur et la taille, jamais par la transparence. L'ancienneté
 * est ce qu'on lit ; l'heure exacte se donne en infobulle, au survol.
 */
function LigneReperes({
  at,
  montrerHeure,
  complements = [],
  texte,
  cle,
  aDroite = false,
  jointes = [],
}: {
  at: number;
  /** Faux pour un message d'une suite écrite dans la même minute (l'heure se pose sous le dernier). */
  montrerHeure: boolean;
  complements?: (string | null)[];
  texte: string;
  /** L'identifiant du message : sert au bouton d'écoute à savoir si c'est LUI qui parle. */
  cle: string;
  aDroite?: boolean;
  /** Les fichiers joints à ce message : la copie les emporte avec le texte. */
  jointes?: Attachment[];
}) {
  const visibles = complements.filter(Boolean) as string[];
  return (
    <div
      className={cn(
        'mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint',
        aDroite && 'justify-end',
      )}
    >
      {montrerHeure ? <span title={heureExacte(at)}>{relativeTime(at)}</span> : null}
      {visibles.map((item, index) => (
        <span key={index}>{item}</span>
      ))}
      <BoutonEcoute texte={texte} cle={cle} />
      <BoutonCopier texte={texte} jointes={jointes} />
    </div>
  );
}

export function MessageView({
  message,
  allMessages,
  projectId,
  montrerHeure = true,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  etatPlan = 'courant',
  onEcrireDansLeChamp,
}: {
  message: Message;
  /** La conversation entière : sert au cadre du plan à numéroter ses versions. */
  allMessages: Message[];
  /** Pour déplier la mémoire du projet sous l'étape de lecture. */
  projectId?: string;
  /** Faux quand le message suivant a été écrit dans la même minute : une heure suffit pour le groupe. */
  montrerHeure?: boolean;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
  /** Pour un message écrit en mode plan : est-ce le plan encore en jeu, ou une
   *  itération passée ? Une itération passée se replie et perd ses boutons
   *  (`indexDuPlanCourant`, `shared/src/plan-conversation.ts`). */
  etatPlan?: EtatDuPlan;
  /** Déposer un texte dans la barre d'écriture, SANS rien envoyer : c'est ainsi
   *  qu'un refus et une suggestion d'optimisation reviennent à l'utilisateur,
   *  qui les complète puis décide d'envoyer (`shared/src/suggestions-de-plan.ts`). */
  onEcrireDansLeChamp?: (texte: string) => void;
}) {
  const isUser = message.role === 'user';
  const state = useApp();

  if (isUser) {
    /* TOUS les fichiers joints voyagent avec la copie du message
       (`BoutonCopier`), pas seulement les images : coller la demande dans la
       barre d'écriture repose les mêmes pièces jointes au-dessus du champ. */
    const connues = projectId ? (state.attachments[projectId] ?? []) : [];
    const jointes = jointesDuMessage(message.attachments, connues);

    // Vos demandes : à droite, sur une largeur réduite.
    return (
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
            montrerHeure={montrerHeure}
            complements={[]}
            texte={message.content}
            cle={message.id}
            aDroite
            jointes={jointes}
          />
          {message.sentContext ? (
            <ContexteEnvoye contexte={message.sentContext} messageId={message.id} allMessages={allMessages} />
          ) : null}
        </div>
      </div>
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
    <div className="group w-[min(92%,860px)] min-w-0 max-w-full">
      {memoire ? <MemoryNote step={memoire} projectId={projectId} /> : null}
      <Steps steps={etapes} streaming={message.streaming} />

      {message.content ? (
        message.plan && !message.repriseCompte && !message.error ? (
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
        <p className="text-[14px] text-faint">L'agent réfléchit…</p>
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

      {message.error ? (
        <div className="mt-2 flex gap-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-[13.5px] text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">{message.error}</span>
        </div>
      ) : null}

      {/* L'heure se montre TOUJOURS, ordinateur comme téléphone, et des deux
          côtés du fil : la mettre au second plan se fait par la COULEUR et la
          taille, jamais par la transparence — effacée, elle disparaît.
          La durée du tour ne se dit que sous les RÉPONSES : une demande ne
          « dure » pas. C'est du temps machine, sans rapport avec les heures
          facturées, d'où la formulation « de travail ». */}
      <LigneReperes
        at={message.createdAt}
        montrerHeure={montrerHeure}
        complements={[
          message.durationMs && message.durationMs >= 1000
            ? `${duration(message.durationMs / 1000)} de travail`
            : null,
        ]}
        texte={message.content}
        cle={message.id}
      />
    </div>
  );
}

/**
 * Le texte envoyé par « Valider » : le chef le lit comme un accord clair
 * (`TRI_MODE_PLAN`, `server/src/runtime.ts`) et propose alors la carte, plan
 * recopié dans son contexte. Le niveau choisi voyage dans le même message :
 * le chef le reprend dans le champ « niveau » de la carte qu'il propose.
 */
const TEXTE_VALIDATION_PLAN = 'Vas-y, lance ce plan.';
function texteValidationPlan(niveau: NiveauAgent): string {
  return `${TEXTE_VALIDATION_PLAN} Niveau retenu pour la carte : « ${DEFINITIONS_NIVEAU[niveau].label} ».`;
}
/**
 * « REFUSER » NE LANCE RIEN. Il DÉPOSE ce refus dans la barre d'écriture, où il
 * se complète (« …, je préfère qu'on garde l'existant ») avant d'être envoyé.
 *
 * Le bouton envoyait ce texte tout seul : le chef repartait aussitôt pour un
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
 * relancer le chef à l'aveugle coûtait un tour entier pour rien.
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
      client.pushToast('error', err?.message ?? 'envoi impossible');
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
      client.pushToast('error', err?.message ?? 'envoi impossible');
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
        <span className="truncate">{courant ? 'Plan proposé' : 'Version précédente'}</span>
        {numero ? (
          <span className="shrink-0 whitespace-nowrap normal-case tracking-normal text-faint">· version {numero}</span>
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
          <span className="truncate">{courant ? 'Plan proposé' : 'Version précédente'}</span>
          {numero ? (
          <span className="shrink-0 whitespace-nowrap normal-case tracking-normal text-faint">· version {numero}</span>
        ) : null}
        </div>
        {courant && precedentes.length ? (
          <button
            type="button"
            data-versions-plan
            title={`${precedentes.length} version${precedentes.length > 1 ? 's' : ''} précédente${precedentes.length > 1 ? 's' : ''}`}
            onClick={() => setVersionsOuvertes((v) => !v)}
            className="flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] text-faint transition-colors hover:bg-surface hover:text-text"
          >
            <History className="h-3 w-3 shrink-0" />
            {precedentes.length} version{precedentes.length > 1 ? 's' : ''}
            <span className="hidden sm:inline">
              précédente{precedentes.length > 1 ? 's' : ''}
            </span>
            <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', versionsOuvertes && 'rotate-90')} />
          </button>
        ) : null}
        {courant ? null : (
          <button
            type="button"
            onClick={() => setReplie(true)}
            className="shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:text-text"
          >
            Replier
          </button>
        )}
      </div>

      {courant && versionsOuvertes ? (
        <ul data-liste-versions-plan className="mb-3 space-y-1 rounded-md border border-border bg-raised px-2 py-1.5">
          {precedentes.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
              <span>Version {numeroDeVersion(allMessages, v.id)}</span>
              <span className="text-faint" title={heureExacte(v.createdAt)}>
                {relativeTime(v.createdAt)}
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
            Différences avec la version suivante
          </p>
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
              Niveau de la carte :
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
                Valider
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!enCours}
                onClick={refuser}
                className="w-full justify-center gap-1.5 text-muted hover:text-danger sm:w-auto"
              >
                <X className="h-3.5 w-3.5" />
                Refuser
              </Button>
              {/* Le refus est ÉCRIT, pas parti : on le dit là où l'on vient de
                  cliquer, sinon rien ne se passe à l'écran et l'on reclique. */}
              {refusPrepare ? (
                <span data-refus-prepare className="text-[12.5px] text-warning sm:ml-1">
                  Refus écrit dans la barre — complétez-le, puis envoyez.
                </span>
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
            Repartir de cette version
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
      title={enCours ? 'Arrêter la lecture' : 'Écouter le message'}
      aria-label={enCours ? 'Arrêter la lecture' : 'Écouter le message'}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {enCours ? (
        <Square className="h-2.5 w-2.5 text-success" />
      ) : (
        <Volume2 className="h-2.5 w-2.5" />
      )}
      {enCours ? 'Arrêter' : 'Écouter'}
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
  texte,
  libelle = 'Copier',
  titre = 'Copier le message',
  jointes = [],
}: {
  texte: string;
  libelle?: string;
  titre?: string;
  /** Copiées EN PLUS du texte : coller le message ré-attache ses fichiers. */
  jointes?: Attachment[];
}) {
  const [copie, setCopie] = React.useState(false);
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
      {copie ? 'Copié' : libelle}
    </button>
  );
}

/**
 * LE TIROIR « CONTEXTE ENVOYÉ », EN CHRONOLOGIE. Chaque tour parti de cette
 * conversation (`message.sentContext`) porte son propre instantané : le
 * tiroir les rassemble en une pile verticale ordonnée dans le temps
 * (`chronologieContexteEnvoye`, `shared/src/couches-tokens.ts`), lue par le
 * lecteur de prompts partagé (`LecteurPrompt`) — la même lecture que le volet
 * « Détail » d'une carte. Le bouton qui ouvre le tiroir reste sous CHAQUE
 * demande réellement partie ; la pile montre tous les tours de la
 * conversation, avec le tour d'origine déplié en entrant.
 */
function ContexteEnvoye({
  contexte,
  messageId,
  allMessages,
}: {
  contexte: SentContextSnapshot;
  messageId: string;
  allMessages: Message[];
}) {
  const [open, setOpen] = React.useState(false);

  const tours = React.useMemo(() => chronologieContexteEnvoye(allMessages), [allMessages]);
  const tourInitial = tours.find((tour) => tour.messageId === messageId)?.numero ?? tours.at(-1)?.numero;
  const texteCopiable = tours.map(texteDunTourEnvoye).join('\n\n===\n\n');

  return (
    <>
      <button
        type="button"
        data-contexte-envoye
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-left transition-colors hover:bg-raised"
      >
        <Braces className="h-3 w-3 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted">Contexte envoyé</span>
        <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
      </button>

      <Drawer open={open} onClose={() => setOpen(false)}>
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <Braces className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">Contexte envoyé</DialogTitle>
          <BoutonCopier
            texte={texteCopiable}
            libelle="Tout copier"
            titre="Copier tout le contexte envoyé"
          />
        </header>

        <ZoneDefilement data-contexte-envoye-contenu className="px-3 py-3">
          <div className="text-[13.5px] leading-relaxed text-muted">
            <LecteurPrompt tours={tours} tourInitial={tourInitial} />
          </div>
        </ZoneDefilement>
      </Drawer>
    </>
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
                <Paperclip className="h-2.5 w-2.5" /> pièce jointe
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
  const [busy, setBusy] = React.useState(false);
  /** Les images jointes à la réponse, avant l'envoi. */
  const [images, setImages] = React.useState<Attachment[]>([]);
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const [envoiFichier, setEnvoiFichier] = React.useState(false);
  const [annulation, setAnnulation] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  if (question.cancelled) {
    return (
      <div className="rounded-md border border-border bg-surface/60 px-2.5 py-2">
        <p className="text-[13px] text-faint">{question.question}</p>
        <p className="mt-1 flex min-w-0 items-start gap-1.5 text-[14px] text-faint">
          <X className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
          Question annulée
        </p>
      </div>
    );
  }

  if (question.answer) {
    return (
      <div className="rounded-md border border-border bg-surface/60 px-2.5 py-2">
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
      client.pushToast('warning', 'Seules les images peuvent être jointes à une réponse.');
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
      client.pushToast('error', "Envoi de l'image impossible");
    } finally {
      setEnvoiFichier(false);
    }
  };

  const envoyer = async () => {
    const libelles = question.options.filter((o) => choisis.includes(o.id)).map((o) => o.label);
    const reponse = texteDeReponse(libelles, complement, images.length);
    if (!reponse) return;
    setBusy(true);
    try {
      await client.call({
        type: 'question.answer',
        messageId,
        questionId: question.id,
        answer: reponse,
        attachments: images.map((a) => a.id),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'réponse impossible');
    } finally {
      setBusy(false);
    }
  };

  const annuler = async () => {
    setAnnulation(true);
    try {
      await client.call({ type: 'question.cancel', messageId, questionId: question.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'annulation impossible');
    } finally {
      setAnnulation(false);
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
      /* Une image lâchée n'importe où sur le bloc de la question se joint à la
         réponse : viser le champ au pixel près serait une contrainte inutile. */
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const fichiers = Array.from(event.dataTransfer.files);
        if (!fichiers.length) return;
        event.preventDefault();
        void joindre(fichiers);
      }}
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
            <p className="px-1 text-[12px] text-faint">Plusieurs réponses possibles.</p>
          ) : null}
        </div>
      ) : null}

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
        placeholder={question.options.length ? 'Précision (facultative)…' : 'Votre réponse…'}
        className="mt-2"
      />

      {/* Les images jointes en attente : la croix retire celle qu'on ne veut
          plus, et rien ne part avant le clic sur « Répondre ». */}
      {images.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-images-reponse>
          {images.map((image) => (
            <div key={image.id} className="relative">
              <AttachmentThumb item={image} compact onOpen={() => setApercu(image)} />
              <button
                type="button"
                title="Retirer cette image"
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

      <div className="mt-2 flex items-center gap-1.5">
        <Button variant="default" size="sm" disabled={!pret || busy} onClick={envoyer}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Répondre
        </Button>
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
          title="Joindre une image"
          aria-label="Joindre une image à la réponse"
          disabled={envoiFichier}
          onClick={() => fileRef.current?.click()}
        >
          {envoiFichier ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Paperclip className="h-3 w-3" />
          )}
          Image
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title="Fermer la question sans répondre"
          disabled={annulation}
          onClick={annuler}
          className="text-faint hover:text-danger"
        >
          {annulation ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          Annuler
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
            Le compte « {reprise.compteEpuiseLabel} » avait atteint sa limite : le travail a repris sur
            « {reprise.choisiLabel ?? reprise.choisi} ».
          </span>
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

  return (
    <div
      className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2"
      data-reprise-compte="attente"
    >
      <p className="flex items-start gap-1.5 text-[14px] font-medium text-text">
        <BatteryLow className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        Avec quel compte poursuivre ?
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Le compte « {reprise.compteEpuiseLabel} » a atteint sa limite en plein travail
        {tempsRestant(reprise.resetsAt) ? ` (${tempsRestant(reprise.resetsAt)})` : ''}. Le travail
        n’est pas perdu : il repart où il s’est arrêté, avec le même agent et la même branche.
      </p>

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
                    {Math.round(compte.consommePct)} % consommés
                  </span>
                ) : null}
              </button>
            ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-warning" data-reprise-attente>
          Aucun autre compte n’est libre pour l’instant. Ce choix reste ouvert et s’actualise tout
          seul : dès qu’un compte retrouve du quota, il apparaît ici.
        </p>
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
                <span className="shrink-0">{tempsRestant(compte.resetsAt) ?? 'à sec'}</span>
              </li>
            ))}
        </ul>
      ) : null}
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
  if (proposal.decision === 'accepted') {
    return (
      <button
        onClick={() => proposal.cardId && client.openCard(proposal.cardId)}
        className="w-full rounded-md border border-success/40 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-raised"
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-success">
          <Check className="h-3 w-3" />
          Carte créée dans « Planifié »
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
      </button>
    );
  }

  if (proposal.decision === 'merged') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-surface/60 px-3 py-2 text-[13.5px] text-muted">
        <GitMerge className="h-3 w-3 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">{proposal.title}</span>
        <span className="text-[12px]">réunie dans une autre proposition</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-3 py-2 text-[13.5px] text-faint">
      <X className="h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate line-through">{proposal.title}</span>
      <span className="text-[12px]">carte refusée</span>
    </div>
  );
}
