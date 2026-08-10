import * as React from 'react';
import {
  AlertCircle,
  Braces,
  Check,
  ChevronRight,
  Circle,
  Copy,
  Download,
  HelpCircle,
  LayoutGrid,
  Loader2,
  Paperclip,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import {
  Attachment,
  CoucheDeTokens,
  MEMORY_STEP_ID,
  Message,
  SentContextSnapshot,
  TourMesureAgent,
  coucheDAnalyse,
  coucheDExecution,
  coutEnClair,
  ecartProjete,
  heureExacte,
  montantEnFrancs,
  projectionDeLExecution,
  propositionsDuFil,
  reponsePrete,
  texteAEcouter,
  texteDeReponse,
  triImages,
} from '@haikodev/shared';
import { direVoix, taireVoix, useVoix } from '@/lib/voix';
import { Badge, Button, DialogTitle, Drawer, Textarea, ZoneDefilement } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { Steps } from '@/components/steps';
import { MemoryNote } from '@/components/todos';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { RunChoix, RunSelectors, resoudreRun } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, relativeTime } from '@/lib/utils';

/**
 * La ligne de repères sous un message : l'ancienneté, ce qui est propre à ce
 * message (durée de travail, tokens), puis le bouton « Copier ».
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
}: {
  at: number;
  /** Faux pour un message d'une suite écrite dans la même minute (l'heure se pose sous le dernier). */
  montrerHeure: boolean;
  complements?: (string | null)[];
  texte: string;
  /** L'identifiant du message : sert au bouton d'écoute à savoir si c'est LUI qui parle. */
  cle: string;
  aDroite?: boolean;
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
      <BoutonCopier texte={texte} />
    </div>
  );
}

export function MessageView({
  message,
  projectId,
  montrerHeure = true,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
}: {
  message: Message;
  /** Pour déplier la mémoire du projet sous l'étape de lecture. */
  projectId?: string;
  /** Faux quand le message suivant a été écrit dans la même minute : une heure suffit pour le groupe. */
  montrerHeure?: boolean;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
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
          />
          {message.sentContext ? (
            <ContexteEnvoye contexte={message.sentContext} agentId={message.agentId} />
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
        <Markdown
          content={message.content}
          pickedEvolutions={pickedEvolutions}
          onToggleEvolution={onToggleEvolution}
          onToggleAll={onToggleAll}
          streaming={message.streaming}
        />
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

/**
 * Copier un message en entier. Le bouton reste discret et confirme d'un mot :
 * sans retour visible, on ne sait pas si le clic a pris.
 */
function BoutonCopier({
  texte,
  libelle = 'Copier',
  titre = 'Copier le message',
}: {
  texte: string;
  libelle?: string;
  titre?: string;
}) {
  const [copie, setCopie] = React.useState(false);
  if (!texte?.trim()) return null;

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte);
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

function nombre(value: number): string {
  return value.toLocaleString('fr-CH');
}

/**
 * Les tours déjà mesurés de l'agent, demandés au démon à l'ouverture du tiroir.
 * Ils servent DEUX affichages : la couche « exécution » (leur somme) et la
 * liste tour par tour — d'où la lecture faite une seule fois, ici.
 */
function useToursDeLAgent(agentId: string | undefined, actif: boolean) {
  const [tours, setTours] = React.useState<TourMesureAgent[] | null>(null);
  const [panne, setPanne] = React.useState(false);

  React.useEffect(() => {
    if (!agentId || !actif) return;
    let vivant = true;
    client
      .call({ type: 'agent.usage', agentId })
      .then((res: any) => {
        if (vivant) setTours(res?.turns ?? []);
      })
      .catch(() => {
        if (vivant) setPanne(true);
      });
    return () => {
      vivant = false;
    };
  }, [agentId, actif]);

  return { tours, panne };
}

/**
 * L'HISTORIQUE DES TOURS DE L'AGENT : une ligne par tour réellement parti, du
 * plus ancien au plus récent. Chaque chiffre vient de la mesure rangée à la fin
 * du tour — un tour d'avant cette mesure montre un tiret, jamais une estimation.
 */
function HistoriqueDesTours({
  tours,
  panne,
}: {
  tours: TourMesureAgent[] | null;
  panne: boolean;
}) {
  if (panne) {
    return <p className="rounded-md bg-surface px-2.5 py-2 text-faint">Historique indisponible.</p>;
  }
  if (!tours) {
    return <p className="rounded-md bg-surface px-2.5 py-2 text-faint">Lecture des tours…</p>;
  }
  if (!tours.length) {
    return (
      <p className="rounded-md bg-surface px-2.5 py-2 text-faint">
        Aucun tour mesuré pour cet agent pour l’instant.
      </p>
    );
  }

  return (
    <ZoneDefilement
      data-historique-tours
      fond="hsl(var(--surface))"
      hauteur={24}
      classeEnveloppe="max-h-72 overflow-hidden rounded-md bg-surface"
    >
      <ul className="divide-y divide-border px-2.5">
        {tours.map((tour, index) => {
          const detail = tour.inputTokens + tour.cachedTokens + tour.outputTokens > 0;
          const cout = coutEnClair({
            inputTokens: tour.inputTokens,
            cachedTokens: tour.cachedTokens,
            outputTokens: tour.outputTokens,
            model: tour.model,
          });
          return (
            <li key={`${tour.at}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
              <span className="shrink-0 tabular-nums text-text">
                {new Date(tour.at).toLocaleString('fr-CH')}
              </span>
              <span className="min-w-0 flex-1 tabular-nums text-muted">
                {detail
                  ? `${nombre(tour.inputTokens + tour.cachedTokens)} envoyés · ${nombre(tour.outputTokens)} reçus`
                  : 'détail non mesuré'}
              </span>
              <span className="shrink-0 tabular-nums text-faint">{cout}</span>
            </li>
          );
        })}
      </ul>
    </ZoneDefilement>
  );
}

/** Le nom d'une couche d'exécution suit le RÔLE de l'agent qui l'a portée. */
const NOM_DE_COUCHE: Record<string, string> = {
  task: 'Exécution de la tâche',
  orchestrator: 'Échange avec le chef d’orchestre',
  analysis: 'Analyse de la carte',
  deploy: 'Publication',
};

/** Une ligne de chiffres d'une couche : le libellé au-dessus, la valeur dessous. */
function Chiffre({ nom, valeur }: { nom: string; valeur: string }) {
  return (
    <div className="min-w-0 rounded-md bg-raised px-2.5 py-1.5">
      <div className="text-[11.5px] text-faint">{nom}</div>
      <div className="break-words tabular-nums text-text">{valeur}</div>
    </div>
  );
}

/**
 * UNE COUCHE DE TOKENS RÉELLEMENT MESURÉS : ce qu'elle a envoyé (dont la part
 * relue depuis le cache) et ce qu'elle a reçu. Ce que le moteur n'a pas rendu
 * se dit « indisponible » — jamais un zéro qui rassure à tort.
 */
function CoucheMesuree({ couche }: { couche: CoucheDeTokens }) {
  const chiffre = (valeur?: number) =>
    valeur === undefined ? 'indisponible' : nombre(valeur);
  return (
    <div className="rounded-md bg-surface px-2.5 py-2" data-couche-tokens={couche.cle}>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[13px] font-medium text-text">{couche.nom}</span>
        <span className="text-[11.5px] text-faint">
          {couche.tours === undefined
            ? couche.origine
            : `${couche.tours} tour${couche.tours > 1 ? 's' : ''} mesuré${couche.tours > 1 ? 's' : ''}`}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Chiffre nom="Entrée hors cache" valeur={chiffre(couche.entree)} />
        <Chiffre nom="Relu du cache" valeur={chiffre(couche.cache)} />
        <Chiffre nom="Sortie" valeur={chiffre(couche.sortie)} />
        <Chiffre nom="Coût" valeur={montantEnFrancs(couche.cout)} />
      </div>
      <p className="mt-1 text-[12px] tabular-nums text-faint">
        Total : {chiffre(couche.total)} tokens
      </p>
    </div>
  );
}

/** Le détail exact du nouveau contenu transmis pendant ce tour. */
function ContexteEnvoye({ contexte, agentId }: { contexte: SentContextSnapshot; agentId?: string }) {
  const [open, setOpen] = React.useState(false);
  /* Le détail brut (composition, consigne, prompt) est REPLIÉ par défaut : on
     l'ouvre quand on cherche pourquoi un chiffre est ce qu'il est. */
  const [detail, setDetail] = React.useState(false);
  const state = useApp();
  const agent = agentId ? state.agents[agentId] : undefined;
  const carte = agent?.cardId ? state.cards[agent.cardId] : undefined;

  const { tours, panne } = useToursDeLAgent(agentId, open);
  const projection = projectionDeLExecution(carte?.estimate);
  const analyse = coucheDAnalyse(carte?.estimate?.analysisMeasurement);
  const execution = coucheDExecution(
    tours ?? [],
    NOM_DE_COUCHE[agent?.role ?? 'task'] ?? 'Exécution de la tâche',
  );
  const ecart = ecartProjete(projection?.tokens, execution?.total);

  const usage = contexte.usage;
  const totalEntree = usage ? usage.inputTokens + (usage.cachedInputTokens ?? 0) : undefined;
  const moteur = contexte.engine === 'claude' ? 'Claude Code' : 'Codex';
  const session = contexte.session === 'new' ? 'Nouvelle session' : 'Reprise de session';
  const instruction =
    contexte.systemInstruction.kind === 'full' ? 'Consigne système complète' : 'Rappel de méthode';
  const texteCopiable = [
    `${moteur}${contexte.model ? ` — ${contexte.model}` : ''}`,
    session,
    usage
      ? `Entrée nouvelle : ${nombre(usage.inputTokens)} tokens\nCache relu : ${
          usage.cachedInputTokens === undefined ? 'non communiqué' : `${nombre(usage.cachedInputTokens)} tokens`
        }`
      : 'Mesure des tokens en attente',
    `${instruction}\n\n${contexte.systemInstruction.content}`,
    `Prompt HaikoDev\n\n${contexte.prompt}`,
  ].join('\n\n---\n\n');

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
        <span className="shrink-0 text-[12px] tabular-nums text-faint">
          {totalEntree === undefined ? 'mesure en cours' : `${nombre(totalEntree)} tokens`}
        </span>
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
          <div className="space-y-4 text-[13.5px] leading-relaxed text-muted">
            {/* L'identité du tour tient en une ligne : quatre encadrés pour
                quatre mots occupaient le premier écran du tiroir pour rien. */}
            <p className="text-[12.5px] text-faint" data-identite-tour>
              {moteur}
              {contexte.model ? ` · ${contexte.model}` : ''} · {session} ·{' '}
              {new Date(contexte.sentAt).toLocaleString('fr-CH')}
            </p>

            {/* 1. CE QUI ÉTAIT ESTIMÉ. Toujours en premier quand un chiffrage
                existe : c'est la promesse à laquelle le réel se compare. */}
            {projection ? (
              <section data-tokens-estimes>
                <h3 className="mb-1.5 text-[13px] font-medium text-text">Estimé avant le travail</h3>
                <div className="rounded-md bg-surface px-2.5 py-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    <Chiffre
                      nom="Tokens projetés"
                      valeur={projection.tokens === undefined ? 'indisponible' : nombre(projection.tokens)}
                    />
                    <Chiffre
                      nom="Part de quota projetée"
                      valeur={
                        projection.quotaShare === undefined
                          ? 'indisponible'
                          : `${(projection.quotaShare * 100).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %`
                      }
                    />
                  </div>
                  <p className="mt-1 text-[12px] text-faint">
                    Projection rédigée par l’analyse du chef d’orchestre — ce n’est pas une mesure.
                  </p>
                </div>
              </section>
            ) : null}

            {/* 2. CE QUI A ÉTÉ RÉELLEMENT MESURÉ, couche par couche : la
                réflexion du chef d'abord, l'exécution ensuite. */}
            <section data-tokens-reels>
              <h3 className="mb-1.5 text-[13px] font-medium text-text">Réellement mesuré</h3>
              <div className="space-y-2">
                {analyse ? <CoucheMesuree couche={analyse} /> : null}
                {execution ? (
                  <CoucheMesuree couche={execution} />
                ) : (
                  <p className="rounded-md bg-surface px-2.5 py-2 text-faint">
                    {panne
                      ? 'Mesure des tours indisponible.'
                      : tours
                        ? 'Aucun tour mesuré pour cet agent pour l’instant.'
                        : 'Lecture des tours…'}
                  </p>
                )}
              </div>
              {ecart !== undefined ? (
                <p className="mt-1.5 text-[12px] text-faint" data-ecart-projection>
                  {ecart >= 0
                    ? `Soit ${(ecart * 100).toLocaleString('fr-CH', { maximumFractionDigits: 0 })} % de plus que projeté.`
                    : `Soit ${(-ecart * 100).toLocaleString('fr-CH', { maximumFractionDigits: 0 })} % de moins que projeté.`}
                </p>
              ) : null}
              <p className="mt-1.5 text-[12px] text-faint">
                Ce tour-ci :{' '}
                {usage
                  ? `${nombre(usage.inputTokens)} tokens nouveaux · ${
                      usage.cachedInputTokens === undefined
                        ? 'détail du cache non communiqué'
                        : `${nombre(usage.cachedInputTokens)} tokens relus depuis le cache`
                    }`
                  : 'la mesure arrivera à la fin du tour moteur.'}
              </p>
            </section>

            {open && agentId ? (
              <section>
                <h3 className="mb-1.5 text-[13px] font-medium text-text">Tours de cet agent</h3>
                <p className="mb-1.5 text-[12px] text-faint">
                  Un tour par ligne, du plus ancien au plus récent. Le coût n’est donné que si le
                  tarif du modèle est connu.
                </p>
                <HistoriqueDesTours tours={tours} panne={panne} />
              </section>
            ) : null}

            {contexte.history === 'retained_by_engine' ? (
              <p className="rounded-md border border-border bg-surface px-2.5 py-2 text-faint">
                L’historique précédent est déjà porté par la session du moteur. Il n’est pas renvoyé par
                HaikoDev et le moteur ne permet pas de le relire ici.
              </p>
            ) : null}

            {/* 3. LE DÉTAIL BRUT, REPLIÉ. Composition, consigne et prompt entier
                ne servent qu'à comprendre un chiffre surprenant : les afficher
                d'office noyait les deux sections qui précèdent. */}
            <section>
              <button
                type="button"
                data-voir-detail-brut
                aria-expanded={detail}
                onClick={() => setDetail((ouvert) => !ouvert)}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-raised"
              >
                <ChevronRight
                  className={cn('h-3 w-3 shrink-0 text-faint transition-transform', detail && 'rotate-90')}
                />
                <span className="min-w-0 flex-1">
                  {detail ? 'Masquer le détail' : 'Voir le détail'}
                </span>
                <span className="shrink-0 text-[11.5px] text-faint">
                  composition, consigne, prompt exact
                </span>
              </button>

              {detail ? (
                <div className="mt-2 space-y-4" data-detail-brut>
                  <div>
                    <h3 className="mb-1.5 text-[13px] font-medium text-text">
                      Composition du nouveau contenu
                    </h3>
                    <ul className="divide-y divide-border rounded-md bg-surface px-2.5">
                      {contexte.blocks.map((bloc, index) => (
                        <li
                          key={`${bloc.kind}-${index}`}
                          className="flex items-center justify-between gap-3 py-1.5"
                        >
                          <span>{bloc.label}</span>
                          <span className="shrink-0 tabular-nums text-faint">
                            {nombre(bloc.characters)} caractères
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="mb-1.5 text-[13px] font-medium text-text">{instruction}</h3>
                    <p className="mb-1.5 text-[12px] text-faint">
                      {contexte.systemInstruction.transport === 'separate'
                        ? 'Transmise séparément du prompt.'
                        : 'Ajoutée par l’adaptateur devant le prompt.'}
                    </p>
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-surface px-2.5 py-2 text-[12.5px] text-muted [overflow-wrap:anywhere]">
                      {contexte.systemInstruction.content}
                    </pre>
                  </div>

                  <div>
                    <h3 className="mb-1.5 text-[13px] font-medium text-text">
                      Prompt exact remis à l’adaptateur
                    </h3>
                    <pre
                      data-prompt-envoye
                      className="whitespace-pre-wrap break-words rounded-md bg-surface px-2.5 py-2 text-[12.5px] text-muted [overflow-wrap:anywhere]"
                    >
                      {contexte.prompt}
                    </pre>
                  </div>
                </div>
              ) : null}
            </section>
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
  const fileRef = React.useRef<HTMLInputElement>(null);

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

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-3 py-2 text-[13.5px] text-faint">
      <X className="h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate line-through">{proposal.title}</span>
      <span className="text-[12px]">carte refusée</span>
    </div>
  );
}
