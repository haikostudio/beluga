import * as React from 'react';
import { FeuilleDeValidationDeConfiguration } from '@/components/carte-de-configuration';
import {
  AlertCircle,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  MessageSquare,
  RotateCcw,
  Rocket,
  SlidersHorizontal,
  Pause,
  Trash2,
  X,
  Zap,
  FastForward,
} from 'lucide-react';
import {
  Agent,
  BOUTON_DES_QUE_POSSIBLE,
  lancementScinde,
  comprehensionPourLePlan,
  Card,
  DEFINITIONS_NIVEAU,
  DecisionDuParcours,
  EtatDeCartePourLePlan,
  EtatDuGeste,
  GesteCarte,
  GesteDuParcours,
  LIBELLES_GESTE,
  RAISONS_DU_GESTE,
  libelleDeValidation,
  Message,
  NIVEAU_DU_PLAN,
  PlanDeCarte,
  LIBELLE_REPRENDRE,

  agentTientSonTour,
  avanceDEtape,
  barreEnFinDeTache,
  iterationAFermer,
  lotDeployableDepuisLaCarte,
  decisionDePlanOuverte,
  travailDeLaCarteDejaLance,
  decisionsDuParcours,
  differencesDeTexte,
  etatVisuelCarte,
  gesteCarte,
  libelleDeLancement,
  lireDateDeDepart,
  momentDeDepart,
  momentDuCreneau,
  phraseDuCreneau,
  planCourant,
  planEnCoursDEcriture,
  comprehensionValideePourLaVersionCourante,
  type PassageDePlanLu,
  phraseDeLErreurDeTour,
  modeleActuel,
  niveauDeReflexionQuiPart,
  procedureEnPlace,
  raisonDeployerDepuisLaCarte,
  prochaineQuestionDeCarte,
  COLONNES_AVANT_LE_TRAVAIL,
  estVoletDuCahier,
  carteEnPause,
  MESSAGE_DE_REPRISE,
  questionAMontrer,
  boutonDuMedia,
  carteDeMedia,
  horsDuLotDeDeploiement,
  type AgentQuestion,
  type GesteDuMedia,
} from '@beluga/shared';
import { BulleInfo, Button, CLASSE_BLOC_DU_PIED, DialogFooter, DialogTitle, Drawer, Input, Label, Switch, Tooltip, ZoneDefilement, ChoixDateEtHeure } from '@/components/ui';
import { CarouselQuestions, EmplacementDeLaPagination } from '@/components/carousel-questions';
import { BarrePagination } from '@/components/ui/pagination-fleches';
import { BulleQuestion, cleDeBrouillonDeReponse } from '@/components/bulle-question';
import {
  ErreurDeTourCard,
  QuestionCard,
  QuestionEnTexteCard,
  RepriseDeCompteCard,
} from '@/components/message-view';
import { PlanRapport } from '@/components/plan-rapport';
import { useArretAgent } from '@/components/arret-agent';
import { BoutonEtapeSuivante, useAvancerEtapes } from '@/components/etape-suivante';
import { client } from '@/lib/client';
import { EVENEMENT_OUVRIR_DECISIONS, ouvrirLesDecisions } from '@/lib/ouvrir-decisions';
import { useApp } from '@/lib/use-app';
import { cn, dateHeure } from '@/lib/utils';
import { t } from '@/lib/langue';
import { BoutonLireLeCahier, cahierALire } from '@/components/cahier-des-charges';
import { useEtapesDuMedia } from '@/lib/production-de-carte';

/**
 * L'ÉCRAN D'UNE CARTE, DE HAUT EN BAS : LA BARRE, LE FLUX EN POINTS, LA
 * DÉCISION, L'ACTION.
 *
 * Ce fichier porte les pièces qui entourent le parcours d'une carte
 * (`chat.tsx` les assemble ; la barre d'étapes vit dans `barre-etapes.tsx`,
 * le flux en points dans `flux-en-points.tsx`) :
 *
 *  - le BLOC DU PLAN — UNE version, celle du passage qui le porte, avec le diff
 *    vers la suivante ; lu dans `card.parcours.plans`, jamais reconnu au texte ;
 *  - le PANNEAU DE DÉCISION, collé au-dessus du champ — UN seul composant pour
 *    tout ce qui attend l'utilisateur : question d'outil, question en texte,
 *    erreur de tour, reprise de compte, incident du parcours ;
 *  - la BARRE D'ACTION — le geste principal du chapitre, et sa raison EN
 *    INFOBULLE quand il est éteint. Plus jamais un bouton qui disparaît sans un
 *    mot, mais plus de phrase écrite sous lui non plus.
 *
 * Tout ce qui se DÉCIDE ici est décidé par les règles pures de
 * `shared/src/parcours-carte.ts` ; ces composants ne font que dessiner.
 */

/* ------------------------------------------------------------------ */
/* Le bloc du plan                                                     */
/* ------------------------------------------------------------------ */

/**
 * UNE VERSION DU PLAN, LUE SUR LA CARTE. Chaque version a désormais SON POINT
 * dans le flux : le sélecteur « n versions » n'a plus lieu d'être — on remonte
 * le flux pour relire la précédente. Le bloc montre donc UNE version, celle du
 * passage qui le porte, et, quand ce n'est pas la dernière, ce qui a changé
 * vers la suivante. Rien n'est reconnu au texte : `card.parcours.plans` fait foi.
 */
export function BlocDuPlan({
  plans,
  version,
  agentId,
  planValide,
  etatCarte,
  onToggleEvolution,
  onToggleAll,
  carte,
  passage,
  passages,
}: {
  /**
   * LE PASSAGE « PLAN » QUI PORTE CE BLOC, et le flux entier : « en cours
   * d'écriture » ne se dit que pendant le tour qui écrit CE plan
   * (`planEnCoursDEcriture`), plus pendant une compréhension qui suit.
   */
  passage?: PassageDePlanLu;
  passages?: readonly PassageDePlanLu[];
  plans: PlanDeCarte[];
  /** La version que ce point porte ; sans elle, la version courante. */
  version?: number;
  /** L'agent qui a écrit le plan (celui du point). */
  agentId?: string;
  /** La validation déjà écrite sur la carte, avec sa version. */
  planValide?: { version: number; at: number } | null;
  /** La carte, pour savoir si son travail a déjà été lancé : un plan DÉJÀ
   *  EXÉCUTÉ ne porte plus de décision (`decisionDePlanOuverte`). */
  etatCarte?: EtatDeCartePourLePlan;
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
  /**
   * LA CARTE ENTIÈRE : le volet lit sur elle l'avis du juge et l'état de son
   * tour. IL NE PORTE PLUS AUCUNE DÉCISION — le plan est devenu facultatif, et
   * la décision se prend UNE SEULE FOIS, sur le bouton unique « Valider et
   * lancer » collé au champ d'écriture. Absente hors du flux d'une carte.
   */
  carte?: Card;
}) {
  const courant = planCourant(plans);
  /*
   * L'AGENT DE CETTE CARTE TIENT-IL ENCORE SON TOUR ? Le plan est déposé par
   * l'outil `rendre_plan` EN PLEIN TOUR : tant que l'agent écrit, le texte se
   * lit mais rien ne se décide (`decisionDePlanOuverte`). Le témoin est lu sur
   * l'agent lui-même (`agentTientSonTour`), pas déduit d'une prop portée à
   * travers tout le flux.
   */
  const etatGeneral = useApp();
  const agentDeLaCarte = agentId ? etatGeneral.agents[agentId] : undefined;
  const tourEnCours = agentDeLaCarte ? agentTientSonTour(agentDeLaCarte) : false;
  const enEcriture = planEnCoursDEcriture({
    tourEnCours,
    passage,
    passages,
    planDemande: !!carte?.parcours?.planDemandeA,
  });

  if (!courant) return null;
  const vue = plans.find((plan) => plan.numero === version) ?? courant;
  const estCourant = vue.numero === courant.numero;
  /* LA VERSION AFFICHÉE EST-ELLE VALIDÉE ? Écrit sur la carte, jamais deviné. */
  const valide = planValide?.version === vue.numero;
  /*
   * ET LA DÉCISION DEMANDE UNE CHOSE DE PLUS : que le travail n'ait pas déjà
   * été lancé. Le bandeau gardait « Valider » au-dessus d'un travail rendu, et
   * un clic aurait relancé la carte entière.
   */
  const decision = decisionDePlanOuverte({
    estCourant,
    ...(etatCarte ?? {}),
    agentDuPlan: agentId,
    planRenduA: vue.at,
    planValide: valide,
    tourEnCours,
  });
  const dejaLance = travailDeLaCarteDejaLance({ ...(etatCarte ?? {}), agentDuPlan: agentId, planRenduA: vue.at });
  const suivante = estCourant ? undefined : plans.find((plan) => plan.numero === vue.numero + 1);
  const diff = suivante ? differencesDeTexte(vue.texte, suivante.texte) : null;

  /*
   * UN PLAN SE LIT COMME UNE RÉPONSE (demande du 12/10/2026) : du texte, sur le
   * fond de la page, sous la compréhension — plus un bloc gris replié, plus de
   * bandeau, plus de volet plein écran sur téléphone. L'enveloppe (largeur d'un
   * message, alignement) est posée par `MomentDePlan`, dans le flux. Tout reste
   * à l'écran : une version précédente se lit en entier, comme un message.
   *
   * La DÉCISION, elle, se prend UNE SEULE FOIS, sous le champ d'écriture
   * (`BarreDAction`) : ce bloc ne porte aucun bouton.
   */
  return (
    <div data-bloc-du-plan={vue.numero} data-bloc-du-plan-repli="ouvert" data-plan-en-texte-detache className="scroll-mt-12">
      {/* L'AGENT ÉCRIT ENCORE : le texte du plan se lit déjà — c'est voulu —
          mais rien ne se décide dessus. On le DIT, sinon l'absence de bouton
          se cherche. */}
      {estCourant && !valide && !dejaLance && enEcriture ? (
        <p data-plan-en-ecriture className="mb-2 flex items-center gap-1.5 text-[12.5px] text-muted">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          {t('Plan en cours d’écriture : la décision s’ouvrira à la fin du tour.')}
        </p>
      ) : null}

      {/* LE CORPS RESTE MONTÉ : les idées cochées dans « Améliorations
          apportées » survivent à tout rendu du plan. */}
      <div data-bloc-du-plan-corps>
        <CorpsDuPlan
          texte={vue.texte}
          estCourant={estCourant}
          diff={diff}
          onToggleEvolution={onToggleEvolution}
          onToggleAll={onToggleAll}
        />
      </div>

      {/* LE TRAVAIL EST DÉJÀ PARTI DE CE PLAN : plus rien à décider, et on le
          DIT — un bouton retiré sans un mot se cherche. */}
      {estCourant && !decision && dejaLance ? (
        <p data-plan-deja-lance className="mt-2 text-[12.5px] text-muted">
          {t('Le travail a déjà été lancé à partir de ce plan.')}
        </p>
      ) : null}

      {/* QUAND CETTE VERSION A ÉTÉ RENDUE, sous le texte, comme l'heure d'un
          message : un plan refait trois fois se lit sans deviner lequel est le
          dernier. */}
      <span data-plan-rendu-le={vue.numero} className="mt-1 block pl-1 text-[12px] text-faint">
        {t('Plan · version {numero}', { numero: vue.numero })} · {dateHeure(vue.at)}
      </span>
    </div>
  );
}

/**
 * LES DIFFÉRENCES AVEC LA VERSION SUIVANTE, REPLIÉES D'OFFICE : c'est un détail
 * de comparaison, pas ce qu'on lit en ouvrant le plan. Le libellé reste visible
 * et ouvre la liste des lignes ; le corps du plan, lui, ne se démonte jamais.
 */
function DifferencesDuPlan({ diff }: { diff: NonNullable<ReturnType<typeof differencesDeTexte>> }) {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <div className="mt-4" data-diff-du-plan data-diff-ouvert={ouvert ? 'oui' : 'non'}>
      <button
        type="button"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
        className="flex items-center gap-1 text-[12.5px] text-faint hover:text-text"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !ouvert && '-rotate-90')} />
        {t('Différences avec la version suivante')}
      </button>
      {ouvert ? (
        <div className="mt-1 space-y-0.5 font-mono text-[12px] leading-relaxed">
          {diff.map((ligne, index) => (
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
      ) : null}
    </div>
  );
}

/**
 * LE CORPS DU PLAN, SANS SON ENVELOPPE : le texte du plan et ce qui a changé
 * vers la version suivante. Plus aucun choix de niveau : un plan validé part
 * avec le modèle de la configuration de l'agent. Il ne sait RIEN de l'endroit où
 * il est posé — dépliant du fil ou volet plein écran —, ce qui est justement ce
 * qui permet de le poser aux deux endroits sans le recopier.
 */
function CorpsDuPlan({
  texte,
  estCourant,
  diff,
  onToggleEvolution,
  onToggleAll,
}: {
  texte: string;
  estCourant: boolean;
  /** Les différences vers la version suivante, quand ce n'est pas la dernière. */
  diff: ReturnType<typeof differencesDeTexte> | null;
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
}) {
  return (
    <>
      <PlanRapport
        contenu={texte}
        courant={estCourant}
        onToggleEvolution={estCourant ? onToggleEvolution : undefined}
        onToggleAll={estCourant ? onToggleAll : undefined}
      />

      {diff ? (
        <DifferencesDuPlan diff={diff} />
      ) : null}

    </>
  );
}

/* ------------------------------------------------------------------ */
/* Le panneau de décision                                              */
/* ------------------------------------------------------------------ */

/**
 * UN SEUL PANNEAU POUR TOUT CE QUI ATTEND L'UTILISATEUR, collé au-dessus du
 * champ. Il remplace le bandeau des questions et donne enfin une surface aux
 * erreurs de tour, aux reprises de compte et aux incidents du parcours sur une
 * carte — ils ne vivaient que dans une bulle du fil, souvent hors de vue.
 *
 * Déployé d'office, il se replie à la main sans jamais disparaître : replié,
 * il garde une ligne qui dit ce qui attend. Une décision qui arrive le rouvre.
 */
export function PanneauDeDecision({
  messages,
  carte,
  projectId,
  questionEnTexte,
}: {
  messages: Message[];
  carte: Card;
  projectId?: string;
  questionEnTexte: boolean;
}) {
  const toutesLesDecisions = React.useMemo(
    () =>
      decisionsDuParcours({
        messages,
        parcours: carte.parcours,
        questionEnTexte,
        colonne: carte.column,
        archivee: !!carte.archivedAt,
      }),
    [messages, carte.parcours, questionEnTexte, carte.column, carte.archivedAt],
  );
  const parId = React.useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  /*
   * LES COMPÉTENCES RETENUES PAR BELUGA BUILD NE SONT PAS DES QUESTIONS DE
   * L'AGENT : elles sortent du panneau des décisions. Elles n'ont plus de
   * panneau à elles : chacune est une ligne du flux de réflexion, dans le
   * passage où l'agent l'a récupérée (`CompetenceDuFlux`).
   */
  const estUneCompetence = (d: DecisionDuParcours) =>
    d.sorte === 'question' && !!parId.get(d.messageId)?.questions.find((q) => q.id === d.questionId)?.competence;
  const decisions = toutesLesDecisions.filter((d) => !estUneCompetence(d));
  const questions = decisions.filter((d): d is Extract<DecisionDuParcours, { sorte: 'question' }> => d.sorte === 'question');
  const autres = decisions.filter((d) => d.sorte !== 'question');
  const [replie, setReplie] = React.useState(false);
  /* Le rang de la question montrée vit ICI : ses flèches sont dans l'entête,
     le carrousel du corps ne fait que suivre (`pilotage`). */
  const [questionChoisie, setQuestionChoisie] = React.useState<number | undefined>(undefined);
  /* La place des flèches d'un formulaire du brief, quand le panneau n'a qu'une question. */
  const [emplacementDesFleches, setEmplacementDesFleches] = React.useState<HTMLElement | null>(null);
  const indexQuestion = questionAMontrer({ repondues: questions.map(() => false), choisie: questionChoisie });
  // « Reprendre » heurtant cette décision la déplie (`ouvrirLesDecisions`).
  React.useEffect(() => {
    const deplier = () => setReplie(false);
    window.addEventListener(EVENEMENT_OUVRIR_DECISIONS, deplier);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_DECISIONS, deplier);
  }, []);
  const lot = decisions.map((d) => (d.sorte === 'question' ? d.questionId : d.sorte === 'incident' ? 'incident' : d.messageId)).join('|');
  React.useEffect(() => setReplie(false), [lot]);

  const questionsDeLaCarte = <QuestionsDeLaCarte carte={carte} projectId={projectId} />;

  if (!decisions.length) {
    /* LES CARTES PROPOSÉES PAR L'AGENT DE LA CARTE ne sont plus ici : elles
       se posent DANS LE FIL, sous sa réponse (`CartesProposeesDuFil`,
       `chat.tsx`) — le bandeau du pied mangeait l'écran d'une carte. */
    return questionsDeLaCarte;
  }

  const intitule = titreDeLaDecision(decisions[0], parId);

  return (
    <>
      {questionsDeLaCarte}
      <div className={CLASSE_BLOC_DU_PIED} data-panneau-decision={decisions.length}>
        <div
          className={cn(
            'overflow-hidden rounded-2xl border bg-bloc-fil',
            decisions.some((d) => d.sorte === 'erreur' || d.sorte === 'incident') ? 'border-danger/40' : 'border-transparent',
          )}
          data-panneau-etat={replie ? 'replie' : 'deploye'}
        >
          {/* L'ENTÊTE N'EST PLUS UN SEUL BOUTON : la bascule (titre + chevron) et
              les flèches des questions sont deux boutons VOISINS — un bouton ne
              s'imbrique pas dans un autre, et feuilleter ne replie pas le panneau. */}
          <div className="flex w-full items-center gap-1 pr-2">
            <button
              type="button"
              onClick={() => setReplie((r) => !r)}
              aria-expanded={!replie}
              data-panneau-bascule
              className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left"
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span className="shrink-0 text-[13.5px] font-medium text-text">
                {decisions.length > 1
                  ? t('{v0} décisions attendent', { v0: decisions.length })
                  : t('Une décision attend')}
              </span>
              {replie && intitule ? (
                <span className="min-w-0 flex-1 truncate text-[13px] text-faint" data-panneau-intitule>
                  {intitule}
                </span>
              ) : (
                <span className="min-w-0 flex-1" />
              )}
            </button>
            {!replie && questions.length > 1 ? (
              <BarrePagination
                index={indexQuestion}
                total={questions.length}
                aller={setQuestionChoisie}
                repere="pagination-questions"
                libellePrecedent="question-precedente"
                libelleSuivant="question-suivante"
              />
            ) : !replie && questions.length === 1 ? (
              <div ref={setEmplacementDesFleches} className="contents" data-emplacement-pagination="" />
            ) : null}
            <button
              type="button"
              onClick={() => setReplie((r) => !r)}
              aria-label={replie ? t('Déplier') : t('Replier')}
              tabIndex={-1}
              className="shrink-0 rounded-md p-1.5 sm:p-1"
            >
              <ChevronDown className={cn('h-4 w-4 text-faint transition-transform', replie && '-rotate-90')} aria-hidden />
            </button>
          </div>

          {replie ? null : (
            /* LE DÉFILEMENT RESTE DANS LE PANNEAU (`overscroll-contain`) : arrivé à
               son bout, il ne passe plus au fil derrière lui. */
            <ZoneDefilement
              classeEnveloppe="max-h-[45vh]"
              fond="var(--fond-bloc-fil, hsl(var(--bloc-etapes)))"
              className="space-y-2 overscroll-contain px-2.5 pb-2.5"
              data-panneau-corps
            >
              {questions.length ? (
                <EmplacementDeLaPagination.Provider value={questions.length === 1 ? emplacementDesFleches : null}>
                <CarouselQuestions
                  questions={questions}
                  cle={(item) => item.questionId}
                  repondue={() => false}
                  pilotage={{ choisie: questionChoisie, setChoisie: setQuestionChoisie }}
                  rendu={(item) => {
                    const message = parId.get(item.messageId);
                    const question = message?.questions.find((q) => q.id === item.questionId);
                    if (!message || !question) return null;
                    return (
                      <QuestionCard
                        messageId={message.id}
                        agentId={message.agentId}
                        projectId={projectId}
                        question={question}
                        sansEntete
                      />
                    );
                  }}
                />
                </EmplacementDeLaPagination.Provider>
              ) : null}
              {autres.map((decision) => {
                if (decision.sorte === 'incident') {
                  return <IncidentDuParcours key="incident" carte={carte} texte={decision.texte} etape={decision.etape} />;
                }
                const message = parId.get(decision.messageId);
                if (!message) return null;
                if (decision.sorte === 'question-texte') {
                  return (
                    <QuestionEnTexteCard
                      key={message.id}
                      messageId={message.id}
                      agentId={message.agentId}
                      projectId={projectId}
                      contenu={message.content}
                      sansEntete
                    />
                  );
                }
                if (decision.sorte === 'erreur') return <ErreurDeTourCard key={message.id} message={message} />;
                return <RepriseDeCompteCard key={message.id} message={message} />;
              })}
            </ZoneDefilement>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * LES QUESTIONS QU'UN CADRAGE SANS TÉMOIN A LAISSÉES SUR LA CARTE (la nuit,
 * une carte posée par un agent, un site tombé) — à la place des anciennes
 * suppositions. UNE à la fois (DEC-286) : la première sans réponse, avec la
 * réponse que l'agent conseille ; la suivante paraît dès que celle-ci est
 * tranchée. Après la dernière, le cadrage reprend tout seul et réécrit la
 * compréhension. Le lancement reste éteint, et dit pourquoi, tant qu'une
 * question attend (`RAISON_QUESTIONS_DE_CARTE`).
 */
function QuestionsDeLaCarte({ carte, projectId }: { carte: Card; projectId?: string }) {
  const comprise = carte.parcours?.comprehension;
  const toutes = comprise?.questionsEnAttente ?? [];
  const question = prochaineQuestionDeCarte(comprise);
  if (!question || !COLONNES_AVANT_LE_TRAVAIL.includes(carte.column)) return null;
  const rang = toutes.findIndex((q) => q.id === question.id) + 1;
  return (
    <div className={CLASSE_BLOC_DU_PIED} data-questions-de-carte={toutes.length} data-question-de-carte-rang={rang}>
      <ZoneDefilement
        classeEnveloppe="max-h-[45vh] overflow-hidden rounded-xl border border-transparent bg-bloc-fil"
        fond="var(--fond-bloc-fil, hsl(var(--bloc-etapes)))"
        className="overscroll-contain px-2.5 pb-2.5"
      >
        <p className="flex items-center gap-2 px-0.5 py-2 text-[13.5px] font-medium text-text">
          <MessageSquare className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          {toutes.length > 1
            ? t('L’agent a préparé {v0} questions pour vous · {v1} sur {v0}', { v0: toutes.length, v1: rang })
            : t('L’agent a préparé une question pour vous')}
        </p>
        <BulleQuestion
          /* La clé change avec la question : la bulle repart vide pour la suivante. */
          key={question.id}
          question={{
            question: question.question,
            description: question.description,
            options: question.options,
            kind: question.kind,
            allowFreeText: true,
            recommandee: question.recommandee,
          }}
          projectId={projectId}
          variante="contraste"
          repere={{ 'data-question-agent': question.id, 'data-question-de-carte': '' }}
          cleDeBrouillon={cleDeBrouillonDeReponse.carte(carte.id, question.id)}
          onRepondre={async (reponse) => {
            try {
              await client.call({ type: 'card.comprehension.repondre', cardId: carte.id, questionId: question.id, reponse });
            } catch (err: any) {
              client.pushToast('error', err?.message ?? t('réponse impossible'));
              throw err;
            }
          }}
        />
      </ZoneDefilement>
    </div>
  );
}

/** Ce qui se lit sur la ligne du panneau replié : la décision elle-même. */
function titreDeLaDecision(decision: DecisionDuParcours, parId: Map<string, Message>): string {
  if (decision.sorte === 'incident') return decision.texte;
  const message = parId.get(decision.messageId);
  if (decision.sorte === 'question') {
    return message?.questions.find((q) => q.id === decision.questionId)?.question ?? '';
  }
  if (decision.sorte === 'erreur') return message?.erreurDeTour ? t(phraseDeLErreurDeTour(message.erreurDeTour)) : '';
  if (decision.sorte === 'reprise') return t('Avec quel compte poursuivre ?');
  return message?.content ?? '';
}

/**
 * L'INCIDENT DU PARCOURS : un tour n'a pas rendu le plan qu'on lui demandait,
 * même relancé. Il se lit en clair, avec le bouton pour redemander — et se
 * referme d'un clic quand on préfère préciser d'abord.
 */
function IncidentDuParcours({ carte, texte, etape }: { carte: Card; texte: string; etape: 'comprehension' | 'plan' }) {
  const [busy, setBusy] = React.useState<'redemander' | 'fermer' | null>(null);
  /* Le bouton redemande CE QUE L'INCIDENT NOMME : un incident de compréhension
     ne lance jamais un plan (carte « Application iPhone ProjetA », 30/09/2026),
     et sans compréhension le plan lui-même se redemande par elle. */
  const sansComprehension = etape === 'comprehension' || !comprehensionPourLePlan(carte);
  const agir = async (geste: 'redemander' | 'fermer') => {
    setBusy(geste);
    try {
      await client.call(
        geste === 'redemander'
          ? sansComprehension
            ? { type: 'comprehension.redemander', cardId: carte.id }
            : { type: 'plan.generer', cardId: carte.id }
          : { type: 'plan.fermerIncident', cardId: carte.id },
      );
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Geste refusé'), carte.id);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 px-2.5 py-2" data-incident-parcours>
      <p className="flex items-start gap-1.5 text-[14px] font-medium text-text">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
        {sansComprehension ? t('La compréhension n’est pas venue') : t('Le plan n’est pas venu')}
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(texte)}</p>
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void agir('fermer')} data-incident-fermer>
          {busy === 'fermer' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          {t('Fermer')}
        </Button>
        <Button variant="default" size="sm" disabled={busy !== null} onClick={() => void agir('redemander')} data-incident-redemander>
          {busy === 'redemander' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {sansComprehension ? t('Redemander la compréhension') : t('Redemander le plan')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La barre d'action                                                   */
/* ------------------------------------------------------------------ */

/**
 * LA RAISON D'UN BOUTON ÉTEINT SE LIT AU SURVOL, PLUS SOUS LE BOUTON. La
 * phrase écrite en toutes lettres sous « Valider et lancer » ou « Lancer la
 * tâche » — « Attendez la fin de la réponse en cours. » — poussait le champ
 * d'écriture vers le bas à chaque tour. Elle n'est pas perdue : elle passe
 * dans l'infobulle du bouton, comme le fait déjà le pied du tiroir. Un bouton
 * possible n'a rien à dire : il n'a pas d'enveloppe.
 */
function BoutonPrincipal({ raison, children }: { raison?: string; children: React.ReactNode }) {
  if (!raison) return <>{children}</>;
  return <Tooltip label={t(raison)}>{children}</Tooltip>;
}

/** L'icône de chaque geste : elle ne dépend que du geste, jamais de sa place. */
function iconeDuGeste(geste: GesteDuParcours) {
  return geste === 'valider-et-lancer'
    ? Rocket
    : geste === 'lancer'
      ? Rocket
      : geste === 'reprendre'
        ? RotateCcw
        : geste === 'terminer'
          ? Check
          : Pause;
}

/**
 * UN BOUTON DE LA RANGÉE. Chacun suit SA propre requête (`Button`, `ui/`) :
 * sur une tâche arrêtée, cliquer « Reprendre » ne fait pas tourner la roue de
 * « Terminer la tâche » à côté.
 *
 * LE HALO SUIT LE BOUTON. Quand « Terminer la tâche » s'allume — l'agent vient
 * de rendre —, il respire trois fois puis se tait. Ce signe vivait au pied du
 * tiroir ; il a suivi le geste dans sa nouvelle place au lieu de disparaître
 * avec lui. Une carte déjà ouverte sur un bouton allumé ne clignote pas.
 */
function BoutonDeGeste({
  geste,
  principal,
  libelle,
  onAgir,
  groupe = false,
}: {
  geste: EtatDuGeste;
  /** Le geste de gauche, celui qui prend la largeur restante. */
  principal: boolean;
  /**
   * LE LIBELLÉ DE LA RÈGLE DE REPRISE, quand la carte n'a encore aucun agent :
   * « Reprendre » sur une carte coupée en vol, « Lancer maintenant » sur une
   * carte neuve (`libelleDeLancement`). Sans lui, le mot du geste.
   */
  libelle?: string;
  onAgir: (geste: EtatDuGeste) => unknown;
  /** Les réglages de l'agent sont collés à sa droite : ses coins droits s'effacent. */
  groupe?: boolean;
}) {
  const [vientDeSallumer, setVientDeSallumer] = React.useState(false);
  const etatPrecedent = React.useRef(geste.possible);
  React.useEffect(() => {
    if (geste.geste === 'terminer' && geste.possible && !etatPrecedent.current) {
      setVientDeSallumer(true);
      const timer = window.setTimeout(() => setVientDeSallumer(false), 5600);
      etatPrecedent.current = geste.possible;
      return () => window.clearTimeout(timer);
    }
    etatPrecedent.current = geste.possible;
  }, [geste.geste, geste.possible]);

  const Icone = libelle?.startsWith(t(LIBELLE_REPRENDRE)) ? RotateCcw : iconeDuGeste(geste.geste);
  const arretRouge = geste.geste === 'arreter';

  return (
    <div className={cn('flex-1', principal ? 'min-w-[150px]' : 'min-w-[130px]')}>
      <BoutonPrincipal raison={!geste.possible ? geste.raison : undefined}>
        <Button
          type="button"
          variant={principal || arretRouge ? 'default' : 'outline'}
          data-geste-principal={geste.geste}
          aria-disabled={!geste.possible}
          /* Éteint parce qu'une décision attend : le clic MÈNE à cette décision. */
          onClick={() => (geste.possible ? onAgir(geste) : geste.raison ? void ouvrirLesDecisions() : undefined)}
          title={!geste.possible && geste.raison ? t(geste.raison) : undefined}
          className={cn(
            CLASSES_BOUTON_DU_FIL,
            groupe && 'rounded-r-none',
            vientDeSallumer && 'animate-appel',
            /* AUCUN TRAIT SUR UN BOUTON : son fond le dessine. « Annuler » /
               « Suspendre » est un aplat VIOLET à écriture blanche — la couleur
               du travail de l'agent, plus le rouge d'une erreur. */
            geste.possible
              ? arretRouge
                ? 'bg-teinte-plein text-white hover:bg-teinte-plein hover:opacity-90'
                : principal
                  ? 'bg-accent text-accent-fg hover:opacity-90'
                  : 'bg-raised text-text hover:bg-border'
              : 'cursor-not-allowed bg-raised text-faint hover:bg-raised hover:text-faint',
          )}
        >
          <Icone className="h-3.5 w-3.5" />
          {/* Le geste « aucun » n'a pas de libellé, par construction : on ne
              lui en invente pas un, on n'écrit rien. */}
          <span className="min-w-0 truncate">
            {libelle ?? (geste.geste === 'aucun' ? null : t(LIBELLES_GESTE[geste.geste]))}
          </span>
        </Button>
      </BoutonPrincipal>
    </div>
  );
}

/**
 * LES GESTES DU CHAPITRE, SUR UNE RANGÉE AU-DESSUS DU CHAMP — et leur raison
 * quand ils sont éteints. Un bouton inactif n'est pas « désactivé » au sens du
 * navigateur : la phrase qui dit pourquoi se lit dans son infobulle, toujours.
 *
 * UN GESTE D'ACTION SE PRÉSENTE TOUJOURS AU MÊME ENDROIT : ICI.
 *
 * Le tiroir avait encore un PIED, sous la barre d'écriture, où vivaient les
 * gestes de rangement — « Sortir de l'archive → À planifier », « Passer à … »
 * et un second bouton de lancement. Deux bandes de boutons se
 * partageaient donc les décisions d'une carte, de part et d'autre du champ de
 * saisie, et la plus rare des deux occupait une place permanente en bas de
 * l'écran. Le pied a disparu (`card-panel.tsx`) : cette rangée porte tout.
 *
 * Elle range donc ses boutons en DEUX familles, dans cet ordre :
 *
 *  - les gestes du CHAPITRE (`gestesDuParcours`) — un, ou deux après un arrêt ;
 *  - les gestes de RANGEMENT — la sortie d'une fin de parcours, le cran
 *    suivant du tableau.
 *
 * Elle ne s'efface que si les deux familles sont vides.
 */
export function BarreDAction(props: {
  carte: Card;
  agent: Agent | null;
  /** Un ou deux gestes, dans l'ordre (`gestesDuParcours`). */
  gestes: EtatDuGeste[];
  /**
   * LE MENU DES RÉGLAGES DE L'AGENT, construit par la conversation autour du
   * déclencheur qu'on lui donne : la MOITIÉ COLLÉE À DROITE du bouton
   * principal de la rangée, quel qu'il soit (`IconeDesReglages`, `colle`).
   */
  menuReglages?: (declencheur: React.ReactElement) => React.ReactNode;
  /** Les réglages sont figés (lecture seule) : repère des contrôles. */
  reglagesModifiables?: boolean;
  /**
   * LA MISE EN LIGNE EST FAITE (carte en ligne ou rangée) : sans aucun bouton,
   * la rangée s'efface tout à fait — le résumé de l'agent se lit alors sous le
   * point « Déploiement » du flux (`ResumeDeLAgent`, `chat.tsx`).
   */
  resumeSousLeDeploiement?: boolean;
  /**
   * LA QUESTION D'ACCORD DU DIRECTEUR ENCORE OUVERTE (idée, images clés et
   * prix, film monté), lue dans le fil : le bouton d'une création de média y
   * répond (`RangeeDuMedia`).
   */
  accordEnAttente?: { messageId: string; question: AgentQuestion } | null;
}) {
  /* UNE CRÉATION DE MÉDIA A SON BOUTON À ELLE, DU PREMIER MESSAGE À LA FIN
     (décision du 25/10/2026) : il suit l'étape — « Valider l'idée », « Valider
     et lancer la fabrication · prix », « Suspendre », « Valider le film »,
     « Terminer » — et ne propose JAMAIS « Déployer ». Le lancement reste
     l'accord de l'arrêt 2 : le bouton RÉPOND à la question du directeur. */
  if (carteDeMedia(props.carte)) return <RangeeDuMedia {...props} />;
  if (!estVoletDuCahier(props.carte)) return <GestesDuChapitre {...props} />;
  /* LE CAHIER DES CHARGES D'UN NOUVEAU PROJET n'a aucun geste de chapitre :
     ni « Valider et lancer », ni arrêt, ni bandeau. Sa rangée porte « Lire le
     cahier des charges » dès que le document existe, ses réglages collés à
     droite ; avant, les réglages restent seuls à droite. */
  const aLire = cahierALire(props.carte);
  if (!aLire && !props.menuReglages) return null;
  return (
    <div
      data-barre-cahier
      data-barre-action="aucun"
      data-gestes=""
      data-groupe-reglages={aLire && props.menuReglages ? '' : undefined}
      className={cn('flex items-stretch', !aLire && 'justify-end')}
    >
      {aLire ? <BoutonLireLeCahier carte={props.carte} groupe={!!props.menuReglages} /> : null}
      <IconeDesReglages
        menuReglages={props.menuReglages}
        modifiables={props.reglagesModifiables}
        colle={aLire ? 'neutre' : undefined}
      />
    </div>
  );
}

/** L'icône de chaque geste d'une création de média. */
function iconeDuGesteDuMedia(geste: GesteDuMedia) {
  return geste === 'lancer-fabrication' ? Rocket : geste === 'suspendre' ? Pause : Check;
}

/** Les options cochées d'une question, lues dans son brouillon (celui de la bulle). */
function useChoixCoches(questionId: string | undefined): string[] {
  const brut = React.useSyncExternalStore(
    client.subscribe,
    () => (questionId ? client.lireEtat().prefs[cleDeBrouillonDeReponse.outil(questionId)] : undefined),
    () => undefined,
  ) as { choisis?: unknown } | undefined;
  const choisis = brut?.choisis;
  return React.useMemo(() => (Array.isArray(choisis) ? choisis.filter((c): c is string => typeof c === 'string') : []), [JSON.stringify(choisis ?? null)]);
}

/**
 * LA RANGÉE D'UNE CRÉATION DE MÉDIA : un seul bouton, qui suit l'étape
 * (`boutonDuMedia`), et ses réglages COLLÉS À DROITE sur toute la largeur
 * (MEM-5438). Le clic répond à la question d'accord du directeur par le MÊME
 * chemin que la bulle (`question.answer`) : la question passe répondue dès le
 * premier clic, un second ne trouve plus rien à répondre. « Suspendre » est
 * l'arrêt de l'agent de la carte ; « Terminer » range la carte dans
 * « Archivé » (`card.finish`). Éteint, le bouton DIT pourquoi ; une direction
 * à choisir mène à la question.
 */
function RangeeDuMedia({
  carte,
  agent,
  menuReglages,
  reglagesModifiables,
  accordEnAttente,
}: {
  carte: Card;
  agent: Agent | null;
  menuReglages?: (declencheur: React.ReactElement) => React.ReactNode;
  reglagesModifiables?: boolean;
  accordEnAttente?: { messageId: string; question: AgentQuestion } | null;
}) {
  const media = useEtapesDuMedia(carte);
  const arret = useArretAgent({ agent, cardId: carte.id });
  const question = accordEnAttente?.question;
  const choisis = useChoixCoches(question?.id);
  const brut = media
    ? boutonDuMedia({
        carte,
        etape: media.courante,
        accord: question?.accord ? { etape: question.accord.etape, prix: question.accord.prix, options: question.options } : null,
        choisis,
      })
    : null;
  /* « Suspendre » ne s'allume que pour l'agent de la carte (`arretDeCarteAutorise`). */
  const bouton =
    brut?.geste === 'suspendre' && brut.possible && !arret.possible ? { ...brut, possible: false, raison: arret.raison ?? undefined } : brut;
  if (!bouton) {
    if (!menuReglages) return null;
    return (
      <div data-barre-realisation data-barre-action="aucun" className="flex items-stretch justify-end">
        <IconeDesReglages menuReglages={menuReglages} modifiables={reglagesModifiables} />
      </div>
    );
  }
  const refuse = (err: any) => {
    client.signalerRefus(err?.message ?? t('Geste refusé'), carte.id);
    throw err;
  };
  const agir = (): unknown => {
    if (bouton.reponse && accordEnAttente) {
      return client
        .call({ type: 'question.answer', messageId: accordEnAttente.messageId, questionId: accordEnAttente.question.id, answer: bouton.reponse, attachments: [] })
        .catch(refuse);
    }
    if (bouton.geste === 'suspendre') return arret.demander();
    if (bouton.geste === 'terminer') return client.call({ type: 'card.finish', id: carte.id }).catch(refuse);
    return undefined;
  };
  const Icone = iconeDuGesteDuMedia(bouton.geste);
  const arretRouge = bouton.geste === 'suspendre';
  const libelle = [t(bouton.libelle), typeof bouton.prix === 'number' ? `${bouton.prix.toLocaleString(undefined, { maximumFractionDigits: 2 })} $` : null]
    .filter(Boolean)
    .join(' · ');
  const ton: TonDesReglages = !bouton.possible ? 'neutre' : arretRouge ? 'arret' : 'accent';
  return (
    <div
      data-barre-realisation
      data-barre-action={bouton.geste}
      data-geste-possible={bouton.possible ? 'oui' : 'non'}
      data-groupe-reglages={menuReglages ? '' : undefined}
      className="flex min-w-[150px] flex-1 items-stretch"
    >
      <div className="min-w-0 flex-1">
        <BoutonPrincipal raison={!bouton.possible ? bouton.raison : undefined}>
          <Button
            type="button"
            variant="default"
            data-geste-principal={bouton.geste}
            data-geste-du-media={bouton.geste}
            data-raison={!bouton.possible ? bouton.raison : undefined}
            aria-disabled={!bouton.possible}
            onClick={() => (bouton.possible ? agir() : accordEnAttente ? void ouvrirLesDecisions() : undefined)}
            title={!bouton.possible && bouton.raison ? t(bouton.raison) : undefined}
            className={cn(
              CLASSES_BOUTON_DU_FIL,
              menuReglages && 'rounded-r-none',
              bouton.possible
                ? arretRouge
                  ? 'bg-teinte-plein text-white hover:bg-teinte-plein hover:opacity-90'
                  : 'bg-accent text-accent-fg hover:opacity-90'
                : 'cursor-not-allowed bg-raised text-faint hover:bg-raised hover:text-faint',
            )}
          >
            <Icone className="h-3.5 w-3.5" />
            <span className="min-w-0 truncate">{libelle}</span>
          </Button>
        </BoutonPrincipal>
      </div>
      <IconeDesReglages menuReglages={menuReglages} modifiables={reglagesModifiables} colle={ton} />
    </div>
  );
}

/** LE TON DE LA MOITIÉ « RÉGLAGES » : celui du bouton auquel elle est collée. */
type TonDesReglages = 'accent' | 'arret' | 'neutre';

function tonDuGeste(geste: EtatDuGeste, principal: boolean): TonDesReglages {
  if (!geste.possible) return 'neutre';
  if (geste.geste === 'arreter') return 'arret';
  return principal ? 'accent' : 'neutre';
}

/**
 * LES RÉGLAGES DE L'AGENT, MOITIÉ DROITE DU BOUTON PRINCIPAL (`colle`) : on
 * choisit CE QUI part (modèle, réflexion, compte) au même endroit qu'on le
 * fait partir — « Lancer », « Lancer et valider », « Annuler », « Suspendre »,
 * « Terminer », « Déployer »… Jour d'un pixel, coins arrondis aux seules
 * extrémités, même ton que le bouton ; avant le groupe « Auto » + horloge.
 * JAMAIS détachés en bout de rangée (décision du 21.10.2026). Sans `colle`,
 * l'icône seule d'une rangée sans bouton. Elle reste cliquable quand les
 * gestes sont éteints : consulter les réglages est toujours permis (menu en
 * lecture une fois figés). Rien sans menu.
 */
function IconeDesReglages({
  menuReglages,
  modifiables,
  colle,
}: {
  menuReglages?: (declencheur: React.ReactElement) => React.ReactNode;
  modifiables?: boolean;
  colle?: TonDesReglages;
}) {
  if (!menuReglages) return null;
  return (
    <>
      {menuReglages(
        <Button
          type="button"
          variant="ghost"
          title={t('Configuration de l’agent')}
          aria-label="Configuration de l’agent"
          data-raccourci-reglages={modifiables ? 'modifiable' : 'lecture'}
          data-reglages-du-lancement
          data-reglages-colles={colle ? '' : undefined}
          className={cn(
            HAUTEUR_BOUTON_DU_FIL,
            /* `p-0 sm:px-0` : la taille « md » du bouton pose `sm:px-3.5`, qui ne
               laissait que 8 px à l'icône sur ordinateur (capture #a9f8). */
            'w-[43px] sm:w-9 shrink-0 rounded-lg p-0 sm:px-0',
            colle && 'ml-px rounded-l-none',
            colle === 'arret'
              ? 'bg-teinte-plein text-white hover:bg-teinte-plein hover:text-white hover:opacity-90'
              : colle === 'accent'
                ? 'bg-accent text-accent-fg hover:bg-accent hover:opacity-90'
                : 'bg-raised text-text hover:bg-border',
          )}
        >
          {/* À LA TAILLE DES AUTRES ICÔNES DE LA BARRE (capture #a9f8 : à 14 px, elle se perdait). */}
          <SlidersHorizontal className="h-4 w-4 shrink-0" />
        </Button>,
      )}
    </>
  );
}

function GestesDuChapitre({
  carte,
  agent,
  gestes,
  menuReglages,
  reglagesModifiables,
  resumeSousLeDeploiement,
}: {
  carte: Card;
  agent: Agent | null;
  /** Un ou deux gestes, dans l'ordre (`gestesDuParcours`). */
  gestes: EtatDuGeste[];
  menuReglages?: (declencheur: React.ReactElement) => React.ReactNode;
  reglagesModifiables?: boolean;
  resumeSousLeDeploiement?: boolean;
  /** « Refuser » n'envoie rien : il DÉPOSE sa phrase dans la barre d'écriture. */
}) {
  const arret = useArretAgent({ agent, cardId: carte.id });
  const { avancer, dialogue: dialogueAvance } = useAvancerEtapes();
  /* LE MODÈLE QUI PARTIRA SE LIT SUR LE BOUTON DE VALIDATION : celui de la
     configuration de la carte, modifiable jusqu'à ce clic. Sans modèle posé,
     le palier du cadrage (`NIVEAU_DU_PLAN`). */
  const moteurs = useApp().engines;
  // Un modèle retiré par la mise à jour du moteur part sous sa version
  // actuelle de la même famille (`modeleActuel`) : c'est elle qu'on nomme.
  const moteurDeLaCarte = moteurs.find((m) => m.id === carte.run?.engine);
  const modeleQuiPart =
    (carte.run?.model && moteurDeLaCarte ? modeleActuel(moteurDeLaCarte, carte.run.model)?.label : undefined) ??
    carte.run?.model ??
    DEFINITIONS_NIVEAU[NIVEAU_DU_PLAN].label;
  /* LE NIVEAU DE RÉFLEXION SE LIT À CÔTÉ DU MODÈLE : celui de la configuration
     de l'agent, résolu par la même règle — jamais un autre. Rien sans modèle
     posé (le palier part seul) ni quand le modèle n'offre qu'un niveau. */
  const niveauQuiPart = niveauDeReflexionQuiPart(moteurs, carte.run);
  /*
   * LES GESTES DE RANGEMENT, décidés par les mêmes règles pures qu'au pied du
   * tiroir : `gesteCarte` pour l'autorisation de dépense et la sortie d'une
   * fin de parcours, `avanceDEtape` pour le cran suivant.
   */
  const agentAuTravail = agent?.status === 'running' || agent?.status === 'starting';
  const peut = (geste: GesteCarte) =>
    gesteCarte(geste, {
      colonne: carte.column,
      etat: etatVisuelCarte({
        agentStatut: agent?.status,
        enAttente: !!carte.scheduling?.waitingReason,
        estimationEchouee: !!carte.estimate?.failed,
        enLigne: !!carte.deployedAt,
      }),
      agentLance: !!agent,
      chiffree: !!carte.estimate || !!carte.analyseDemandee,
    });
  const avance = avanceDEtape({ colonne: carte.column, agentActif: agentAuTravail });
  const avanceUtile = !!avance.cible && avance.cible !== 'running' && !peut('terminer').affiche;
  const principal = gestes[0];
  /*
   * LA FIN DE TÂCHE N'A PLUS DE LISTE. Le bouton « Actions de la tâche » (qui
   * ouvrait un tiroir de quatre gestes) est devenu, sur une carte « À déployer »,
   * un seul bouton « Déployer » : un clic ouvre la fenêtre de mise en ligne du
   * lot. Un rapport rendu (« Terminer la tâche », « Reprendre ») montre ses
   * gestes DIRECTEMENT, comme tout chapitre ; l'archivage reste au tableau.
   *
   * UNE CARTE RELANCÉE N'EST PAS EN FIN DE TÂCHE (`barreEnFinDeTache`) : un
   * message sous son rapport a rouvert son cadrage, et la rangée montre le
   * geste du cadrage — « Valider et lancer », éteint pendant la réflexion —,
   * jamais « Déployer » (capture #35079, 04.10.2026).
   */
  const finDeTache = barreEnFinDeTache({ carte, chapitre: principal?.chapitre });
  /*
   * LE PREMIER DÉPART D'UNE CARTE DONT AUCUN AGENT NE S'EST SAISI. Le pied du
   * tiroir portait ici un second bouton de lancement, à côté de celui du
   * chapitre : le MÊME geste, deux fois, de part et d'autre du champ. Il n'en
   * reste qu'un — celui du chapitre —, mais il prend le LIBELLÉ de la règle de
   * reprise (`libelleDeLancement`), sans quoi une carte coupée en vol
   * repartirait sous le mot « Lancer ».
   */
  const departSansAgent = carte.column === 'planned' && !agent;
  /*
   * LA CARTE DE CONSTRUCTION D'UN CAHIER DES CHARGES (`suiteDuCahier`) ne part
   * pas au premier clic : « Lancer » ouvre les réglages de l'agent, et c'est
   * « Valider la configuration et lancer » qui la lance (demande du
   * 22/10/2026). Ni horloge ni « Auto » : la validation est toujours demandée.
   */
  const validerAvantDeLancer = departSansAgent && !!carte.suiteDuCahier;
  const [configurationAValider, setConfigurationAValider] = React.useState(false);
  /* LE LOT SE DÉPLOIE AUSSI D'ICI : une carte « À déployer » porte le bouton
     qui ouvre la fenêtre de déploiement de tout le lot — sauf relancée
     (`lotDeployableDepuisLaCarte`), et sauf quand une simple question a
     laissé son étape « Travail » ouverte : « Terminer la tâche » tient alors
     sa place, et « Déployer » revient après le clic (`iterationAFermer`). */
  const deployerLeLot = lotDeployableDepuisLaCarte(carte) && !iterationAFermer(carte);
  /* En fin de tâche, plus d'étape suivante ici : « Déployer » seul (l'archivage
     se fait au tableau, par la règle `avanceDEtape`). */
  const rangement = (avanceUtile && !finDeTache) || deployerLeLot;

  /*
   * « SUSPENDRE » NE S'ALLUME QUE POUR L'AGENT DE LA CARTE. Le tiroir peut
   * retomber sur l'agent d'une autre tâche : le démon refuserait le clic
   * (`arretDeCarteAutorise`), le bouton s'éteint donc d'avance et dit pourquoi.
   */
  const duChapitre = (principal && principal.geste !== 'aucun' ? gestes : []).map((geste) =>
    geste.geste === 'arreter' && geste.possible && !arret.possible
      ? { ...geste, possible: false, raison: arret.raison }
      : geste,
  );
  /* PLUS AUCUN BOUTON : une carte mise en ligne n'a plus de rangée du tout,
     son résumé d'agent se lit sous « Déploiement ». Ailleurs, l'icône des
     réglages reste seule, à droite. */
  if (!duChapitre.length && !rangement) {
    if (resumeSousLeDeploiement || !menuReglages) return null;
    return (
      <div data-barre-action="aucun" data-gestes="" className="flex justify-end">
        <IconeDesReglages menuReglages={menuReglages} modifiables={reglagesModifiables} />
      </div>
    );
  }

  /*
   * LE CLIC REND SA REQUÊTE AU BOUTON : roue pendant l'attente, coche à la
   * réussite, retour à l'état d'avant sur un refus. Le refus est DIT en rouge
   * puis RELANCÉ — sans quoi le bouton verrait une requête « réussie » et
   * poserait une coche sur un geste qui n'a pas abouti.
   */
  /* Sans geste de chapitre, les réglages vont au premier bouton de rangement. */
  const reglagesAuRangement = !duChapitre.length && !!menuReglages;
  const motDeRefus = t('Geste refusé');
  const refuse = (err: any) => {
    client.signalerRefus(err?.message ?? motDeRefus, carte.id);
    throw err;
  };
  const agir = (geste: EtatDuGeste): unknown => {
    /* UN SEUL CLIC POUR DEUX COMMANDES : la validation s'écrit sur la carte,
       le lancement suit aussitôt (`validerEtLancer`). */
    if (geste.geste === 'valider-et-lancer') return validerEtLancer(carte);
    /* UNE CARTE SUSPENDUE SE REPREND PAR UN MESSAGE à son agent : même session,
       même conversation (`MESSAGE_DE_REPRISE`), jamais un second lancement. */
    const agentEnPause = agent?.id ?? carte.agentId;
    if (geste.geste === 'reprendre' && carteEnPause(carte.scheduling) && agentEnPause) {
      return client.call({ type: 'agent.prompt', agentId: agentEnPause, text: MESSAGE_DE_REPRISE }).catch(refuse);
    }
    if (geste.geste === 'lancer' && validerAvantDeLancer) {
      setConfigurationAValider(true);
      return undefined;
    }
    if (geste.geste === 'lancer' || geste.geste === 'reprendre') {
      /* Le chemin de lancement est UNIQUE (`demanderLeLancement`) : c'est lui
         qui porte l'attente, la phrase d'un délai dépassé et le refus relancé. */
      return client.demanderLeLancement(carte.id);
    }
    if (geste.geste === 'terminer') {
      return client.call({ type: 'card.finish', id: carte.id }).catch(refuse);
    }
    if (geste.geste === 'arreter') arret.demander();
    return undefined;
  };

  return (
    <div
      data-barre-action={principal?.geste ?? 'aucun'}
      data-geste-possible={duChapitre[0]?.possible ? 'oui' : 'non'}
      data-gestes={duChapitre.map((g) => g.geste).join(',')}
      data-fin-de-tache={finDeTache ? '' : undefined}
    >
      {validerAvantDeLancer ? (
        <FeuilleDeValidationDeConfiguration
          carte={carte}
          open={configurationAValider}
          onClose={() => setConfigurationAValider(false)}
        />
      ) : null}
      {/* PLUS AUCUN AVIS ÉCRIT AU-DESSUS DU LANCEMENT : la note du relecteur se
          lit sur l'indicateur à trois barres de la barre d'écriture
          (`web/src/components/indicateur-comprehension.tsx`). */}
      {/* UN BOUTON PAR LIGNE SUR TÉLÉPHONE : deux libellés côte à côte n'y
          tiennent pas, le texte sortait de l'écran. */}
      {(
        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-stretch">
          {duChapitre.map((geste, index) => {
            /* LE LANCEMENT A SON BOUTON, ET SON GROUPE À DROITE : le bouton part
               tout de suite ; l'horloge ouvre le tiroir de programmation. Il n'y
               a plus de bouton « Dès que possible » à côté — il est devenu un
               interrupteur DANS ce tiroir. « Valider et lancer » EST un
               lancement : il a donc la même horloge. */
            /* PENDANT QUE L'AGENT DE CADRAGE TRAVAILLE, le grand bouton est
               « Annuler » (la suspension du carré rouge, retiré du champ) : le
               groupe « Auto » + horloge reste à sa droite, seul son corps
               change. */
            const annulerLeCadrage =
              index === 0 && geste.geste === 'arreter' && (geste.chapitre === 'cadrage' || geste.chapitre === 'plan');
            /* LE LANCEMENT GROUPÉ (« Auto » + horloge à sa droite) suit une
               seule règle (`lancementScinde`). */
            const scinde = index === 0 && lancementScinde(duChapitre) && !validerAvantDeLancer;
            const avecAuto = geste.geste === 'valider-et-lancer' || annulerLeCadrage;
            const libelle = annulerLeCadrage
              ? t('Annuler')
              : geste.geste === 'valider-et-lancer'
                ? /* LE MODÈLE ET SON NIVEAU SE LISENT SUR LE BOUTON : ceux de la
                     carte, modifiables jusqu'à ce clic ; à défaut, le palier du
                     cadrage. */
                  [t(libelleDeValidation(carte.scheduling)), modeleQuiPart, niveauQuiPart].filter(Boolean).join(' · ')
                : geste.geste === 'lancer'
                  ? /* « LANCER » DIT AUSSI CE QUI PART : le modèle posé sur la
                       carte et son niveau, comme « Valider et lancer ». Rien
                       sans modèle posé — le palier du cadrage n'est pas celui
                       du travail déjà validé. */
                    [
                      departSansAgent ? t(libelleDeLancement(carte)) : t(LIBELLES_GESTE.lancer),
                      carte.run?.model ? modeleQuiPart : undefined,
                      niveauQuiPart,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : undefined;
            /* LES RÉGLAGES SONT LA MOITIÉ DROITE DU PREMIER BOUTON, quel qu'il
               soit : sur téléphone (un bouton par ligne), ils restent sur sa
               ligne. */
            const avecReglages = index === 0 && !!menuReglages;
            const bouton = (
              <BoutonDeGeste geste={geste} principal={index === 0} libelle={libelle} onAgir={agir} groupe={avecReglages} />
            );
            const boutonEtReglages = avecReglages ? (
              <div className="flex min-w-[150px] flex-1 items-stretch" data-groupe-reglages>
                {bouton}
                <IconeDesReglages
                  menuReglages={menuReglages}
                  modifiables={reglagesModifiables}
                  colle={annulerLeCadrage ? 'arret' : tonDuGeste(geste, true)}
                />
              </div>
            ) : (
              bouton
            );
            return scinde ? (
              <div key={geste.geste} className="flex min-w-[150px] flex-1 items-stretch gap-1.5" data-bouton-scinde={carte.id}>
                {boutonEtReglages}
                {/* « AUTO » ET L'HORLOGE FORMENT UN GROUPE, à droite du bouton
                    principal : tous deux disent QUAND la carte part (seule, ou à
                    l'heure choisie), le bouton principal dit QUE ça part. Le
                    lancement automatique se règle PENDANT la réflexion, quand le
                    bouton est éteint. L'horloge suit son bouton : quand le
                    lancement est éteint, le dater n'a pas de sens non plus. */}
                <div className="flex shrink-0 items-stretch">
                  {avecAuto ? <InterrupteurLancementAutomatique carte={carte} /> : null}
                  <SousBoutonProgrammation
                    carte={carte}
                    groupe={avecAuto}
                    possible={annulerLeCadrage ? false : geste.possible}
                    {...(annulerLeCadrage
                      ? { raison: RAISONS_DU_GESTE.tourEnCours }
                      : geste.raison
                        ? { raison: geste.raison }
                        : {})}
                  />
                </div>
              </div>
            ) : (
              <React.Fragment key={geste.geste}>{boutonEtReglages}</React.Fragment>
            );
          })}
        </div>
      )}

      {/* LES GESTES DE RANGEMENT, sur leur propre ligne, sous ceux du
          chapitre : ils partagent la largeur, comme au pied d'avant, et
          passent à la ligne en dessous de 150 px. */}
      {rangement ? (
        <div
          data-gestes-rangement
          className={cn(
            'flex flex-col gap-1.5 sm:grid sm:items-stretch sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] [&>*]:w-full',
            duChapitre.length && 'mt-1.5',
          )}
        >
          {/* SANS GESTE DE CHAPITRE, les réglages se collent au PREMIER
              bouton de rangement (« Déployer », l'étape suivante). */}
          {avanceUtile && !finDeTache ? (
            <AvecReglages
              actif={reglagesAuRangement}
              menuReglages={menuReglages}
              modifiables={reglagesModifiables}
              ton="neutre"
            >
              <BoutonEtapeSuivante
                card={carte}
                agentActif={agentAuTravail}
                className={cn(CLASSES_BOUTON_DU_FIL, reglagesAuRangement && 'rounded-r-none')}
                onAvancer={() => avancer([{ card: carte, agentActif: agentAuTravail }])}
              />
            </AvecReglages>
          ) : null}
          {deployerLeLot ? (
            <BoutonDeployerLeLot
              carte={carte}
              seul={finDeTache && !duChapitre.length}
              reglages={
                reglagesAuRangement && !(avanceUtile && !finDeTache)
                  ? { menuReglages, modifiables: reglagesModifiables }
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : null}

      {dialogueAvance}
    </div>
  );
}


/**
 * « DÉPLOYER » AU PIED D'UNE CARTE « À DÉPLOYER ». Il n'envoie rien : il ouvre
 * la MÊME fenêtre de sélection que le bouton de la colonne (toutes les cartes du
 * lot cochées d'avance), en ramenant au tableau du projet — c'est là que le
 * déploiement se confirme et se suit. Éteint, il DIT pourquoi, avec la règle
 * du démon (`raisonDeployerDepuisLaCarte`) : jamais allumé sur un lot que
 * `deploy.start` refuserait, un agent encore au travail en tête.
 */
function BoutonDeployerLeLot({
  carte,
  seul = false,
  reglages,
}: {
  carte: Card;
  seul?: boolean;
  /** Les réglages de l'agent, collés à sa droite (rangée sans geste de chapitre). */
  reglages?: { menuReglages?: (declencheur: React.ReactElement) => React.ReactNode; modifiables?: boolean };
}) {
  const etat = useApp();
  const projectId = carte.projectId;
  const raison = React.useMemo(() => {
    const colonne = Object.values(etat.cards).filter(
      (card) => card.projectId === projectId && card.column === 'to_deploy',
    );
    return raisonDeployerDepuisLaCarte({
      procedureEnPlace: procedureEnPlace(
        etat.projects.find((projet) => projet.id === projectId),
        'dev',
      ),
      publicationEnCours: etat.deploys[projectId]?.state === 'running',
      agents: Object.values(etat.agents).filter((agent) => agent.projectId === projectId),
      cartesDuLot: colonne.filter((card) => !horsDuLotDeDeploiement(card) && !card.deployedAt).length,
      cartesDansLaColonne: colonne.length,
      horsLigne: !etat.connected,
    });
  }, [etat.cards, etat.projects, etat.deploys, etat.agents, etat.connected, projectId]);
  const colle = !!reglages?.menuReglages;
  return (
    <AvecReglages
      actif={colle}
      menuReglages={reglages?.menuReglages}
      modifiables={reglages?.modifiables}
      ton={seul && !raison ? 'accent' : 'neutre'}
    >
    <BoutonPrincipal raison={raison ?? undefined}>
      <Button
        type="button"
        size="sm"
        variant={seul && !raison ? 'default' : 'outline'}
        data-geste="deployer-lot"
        data-raison-eteint={raison ? '' : undefined}
        aria-disabled={!!raison}
        onClick={() =>
          raison
            ? client.pushToast('warning', t(raison), carte.id)
            : client.demanderDeploiement({ projectId, selection: true })
        }
        title={raison ? t(raison) : undefined}
        className={cn(
          CLASSES_BOUTON_DU_FIL,
          colle && 'rounded-r-none',
          raison
            ? 'cursor-not-allowed bg-raised text-faint hover:bg-raised hover:text-faint'
            : seul
              ? 'bg-accent text-accent-fg hover:opacity-90'
              : 'bg-raised text-text hover:bg-border',
        )}
      >
        <Rocket className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('Déployer')}</span>
      </Button>
    </BoutonPrincipal>
    </AvecReglages>
  );
}

/** UN BOUTON ET SES RÉGLAGES COLLÉS À DROITE ; sans `actif`, le bouton seul. */
function AvecReglages({
  actif,
  menuReglages,
  modifiables,
  ton,
  children,
}: {
  actif: boolean;
  menuReglages?: (declencheur: React.ReactElement) => React.ReactNode;
  modifiables?: boolean;
  ton: TonDesReglages;
  children: React.ReactNode;
}) {
  if (!actif || !menuReglages) return <>{children}</>;
  return (
    <div className="flex min-w-0 items-stretch [&>:first-child]:min-w-0 [&>:first-child]:flex-1" data-groupe-reglages>
      {children}
      <IconeDesReglages menuReglages={menuReglages} modifiables={modifiables} colle={ton} />
    </div>
  );
}

/**
 * TOUS LES BOUTONS SOUS LE FIL ONT LA MÊME HAUTEUR : celle de « Générer le
 * plan ». « Passer à « À déployer » » gardait la petite taille des boutons
 * ordinaires et s'écrasait sous le geste du chapitre (capture du 14.09.2026).
 * `min-w-0` + libellé `truncate` : un texte trop long se raccourcit, il ne
 * sort plus du bouton ni de l'écran.
 */
export const HAUTEUR_BOUTON_DU_FIL =
  /* UNE SEULE HAUTEUR POUR TOUTE LA RANGÉE : 43 px sur téléphone (les boutons y
     sont agrandis de 20 %), 36 px dès 640 px. Le bouton principal était resté à
     36 px sur téléphone, collé à des réglages de 43 px : deux marches dans la
     même rangée (capture du 25.10.2026). Tout bouton collé à un autre de la
     rangée prend CETTE hauteur, jamais une valeur recopiée. */
  'h-[43px] sm:h-9';

export const CLASSES_BOUTON_DU_FIL =
  /* Une hauteur FIXE : tous les boutons du fil sont pleins, sans trait, et
     gardent la même hauteur quel que soit leur contenu. */
  `${HAUTEUR_BOUTON_DU_FIL} w-full min-w-0 justify-center gap-2 rounded-lg px-3 py-0 text-[13px] font-medium`;

/* ------------------------------------------------------------------ */
/* Valider, c'est lancer                                                */
/* ------------------------------------------------------------------ */

/**
 * VALIDER, C'EST LANCER — un seul clic pour deux commandes. La validation de
 * la COMPRÉHENSION s'écrit d'abord sur la carte
 * (`card.comprehension.validate`), le lancement suit aussitôt. L'étape « plan
 * validé, lancez quand vous voulez » n'existe plus : elle demandait un second
 * clic pour rien, et le plan lui-même est devenu facultatif.
 *
 * Une panne DIT laquelle des deux a échoué — sans quoi « geste refusé » ne dit
 * pas si la tâche est partie.
 */
export async function validerEtLancer(carte: Card): Promise<unknown> {
  try {
    /* Aucun palier imposé : le réglage visible au clic est celui qui part
       (le démon ne remplit « Approfondi » que sur une carte sans modèle). */
    await client.call({ type: 'card.comprehension.validate', cardId: carte.id });
  } catch (err: any) {
    client.signalerRefus(`${t('Validation refusée')} : ${err?.message ?? t('Geste refusé')}`, carte.id);
    throw err;
  }
  return client.demanderLeLancement(carte.id);
}

/**
 * LA PHRASE QUE PARTAGENT « AUTO » ET L'HORLOGE : chacun garde sa bulle d'état
 * et la termine par elle, pour que le groupe se lise comme UN geste, sans bulle
 * englobante qui contredirait les bulles propres.
 */
const phraseAutoEtHorloge = () => t('Auto et l’horloge servent tous deux à lancer la carte sans que vous soyez là.');

/**
 * L'INTERRUPTEUR « LANCEMENT AUTOMATIQUE » (`shared/src/lancement-automatique.ts`).
 *
 * Sur la carte, éteint à la naissance. Allumé, le démon fait lui-même
 * « Valider et lancer » dès que la compréhension est prête — et plan rendu si
 * le cahier des charges est allumé. Violet quand il est allumé (l'élément
 * choisi) ; un refus du démon s'écrit en rouge, au journal de la carte.
 */
function InterrupteurLancementAutomatique({ carte }: { carte: Card }) {
  const [enVol, setEnVol] = React.useState(false);
  const actif = !!carte.parcours?.lancementAutomatique;
  return (
    <Tooltip
      label={`${
        actif
          ? t('Lancement automatique allumé : la tâche partira seule dès la compréhension prête.')
          : t('Lancement automatique : lancer la tâche seule dès que la compréhension est prête.')
      } ${phraseAutoEtHorloge()}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={actif}
        aria-label="Lancement automatique"
        aria-busy={enVol || undefined}
        disabled={enVol}
        data-lancement-automatique={actif ? 'allume' : 'eteint'}
        onClick={() => {
          setEnVol(true);
          void client
            .call({ type: 'card.lancement.automatique', cardId: carte.id, actif: !actif })
            .catch((err: any) => client.signalerRefus(err?.message ?? t('Geste refusé'), carte.id))
            .finally(() => setEnVol(false));
        }}
        className={cn(
          /* Première moitié du groupe « Auto » + horloge : le coin droit est
             droit, l'horloge qui suit porte l'autre bout arrondi. */
          'flex shrink-0 items-center justify-center gap-1.5 rounded-lg rounded-r-none px-2.5 py-2 text-[13px] font-medium',
          actif ? 'bg-raised text-teinte' : 'bg-raised text-faint hover:text-muted',
          enVol && 'cursor-wait',
        )}
      >
        <FastForward className={cn('h-3.5 w-3.5', enVol && 'animate-pulse')} />
        <span className="whitespace-nowrap">{t('Auto')}</span>
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* La programmation du lancement                                        */
/* ------------------------------------------------------------------ */

/** L'heure seule, à deux chiffres : ce qui tient sur un sous-bouton. */
function heureCourte(date: number): string {
  const quand = new Date(date);
  return `${String(quand.getHours()).padStart(2, '0')}:${String(quand.getMinutes()).padStart(2, '0')}`;
}

/** Une date en millisecondes → ce qu'attend un champ « datetime-local ». */
function pourLeChamp(date: number): string {
  const quand = new Date(date);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${quand.getFullYear()}-${deux(quand.getMonth() + 1)}-${deux(quand.getDate())}T${deux(quand.getHours())}:${deux(quand.getMinutes())}`;
}

/**
 * LE BOUTON D'HORLOGE, À DROITE DU BOUTON DE LANCEMENT.
 *
 * « Dès que possible » vivait à côté du lancement, en bouton séparé : deux
 * boutons dont la relation n'était pas évidente, et AUCUN chemin pour dire
 * « pars demain à 6 h » depuis que la commande de date avait disparu du
 * protocole. Le bouton principal part tout de suite ; l'horloge, en groupe avec
 * « Auto » (qui dit « pars seule »), ouvre le tiroir de programmation.
 *
 * Une carte déjà datée le DIT ici même : l'heure retenue est écrite sur le
 * sous-bouton, et l'infobulle donne la phrase entière.
 */
export function SousBoutonProgrammation({
  carte,
  groupe = false,
  possible = true,
  raison,
}: {
  carte: Card;
  /**
   * L'HORLOGE SUIT « AUTO » dans un groupe de deux boutons : elle en est la
   * seconde moitié (jour d'un pixel, coins arrondis à l'extrémité seulement).
   * Seule, elle garde ses quatre coins.
   */
  groupe?: boolean;
  /**
   * LE GESTE PRINCIPAL EST-IL POSSIBLE ? L'horloge restait cliquable sous un
   * « Lancer la tâche » éteint : on pouvait dater le départ d'une carte qui
   * n'avait pas le droit de partir. Elle suit donc son bouton.
   */
  possible?: boolean;
  /** POURQUOI il est éteint : un bouton éteint sans un mot se cherche. */
  raison?: string;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const date = carte.scheduling?.departPrevu;
  const asap = carte.scheduling?.asap === true;
  const programmee = typeof date === 'number' && date > 0;

  return (
    <>
      <Tooltip
        label={`${
          !possible
            ? raison
              ? t(raison)
              : t('Le lancement n’est pas possible : la programmation non plus.')
            : programmee
              ? t('Départ programmé {v0} — cliquez pour changer', { v0: momentDeDepart(date!, Date.now()) })
              : asap
                ? t('La carte partira d’elle-même dès qu’une place se libère — cliquez pour changer')
                : t('Choisir la date et l’heure du lancement')
        }${groupe ? ` ${phraseAutoEtHorloge()}` : ''}`}
      >
        <button
          type="button"
          data-programmer={carte.id}
          data-programme={programmee ? 'oui' : asap ? 'asap' : 'non'}
          data-programmer-etat={possible ? 'actif' : 'eteint'}
          aria-expanded={ouvert}
          aria-disabled={!possible}
          aria-label="Programmer le lancement"
          onClick={() => (possible ? setOuvert(true) : undefined)}
          className={cn(
            /* Les deux moitiés du groupe « Auto » + horloge se séparent d'un
               JOUR d'un pixel (`ml-px`), plus d'un filet. Gris comme « Auto »,
               violet (l'élément choisi) quand un départ est daté. */
            'flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium',
            groupe && 'ml-px rounded-l-none',
            possible
              ? cn('bg-raised', programmee || asap ? 'text-teinte' : 'text-muted hover:text-text')
              : 'cursor-not-allowed bg-raised text-faint',
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          {programmee ? <span className="whitespace-nowrap">{heureCourte(date!)}</span> : null}
          {!programmee && asap ? <Zap className="h-3 w-3" /> : null}
        </button>
      </Tooltip>
      {/* LE TIROIR NE S'OUVRE PAS NON PLUS : la garde ne tient pas au seul clic. */}
      <TiroirDeProgrammation carte={carte} open={ouvert && possible} onClose={() => setOuvert(false)} />
    </>
  );
}

/**
 * DATER UN DÉPART, C'EST VALIDER. Le geste du cadrage est « Valider et
 * lancer » ; son sous-bouton d'horloge ouvre ce tiroir, où l'on choisit une
 * heure plutôt que « tout de suite ». La validation doit donc s'écrire là
 * aussi : sans elle, l'ordonnanceur partirait à l'heure dite sur une
 * compréhension que personne n'a acceptée.
 */
async function validerSiBesoin(carte: Card): Promise<void> {
  if (!carte.parcours?.comprehension?.texte?.trim()) return;
  if (comprehensionValideePourLaVersionCourante(carte.parcours)) return;
  await client.call({ type: 'card.comprehension.validate', cardId: carte.id });
}

/**
 * LE TIROIR DE PROGRAMMATION : trois façons de dater un lancement, et une
 * seule commande derrière elles (`card.schedule`). L'interrupteur « Dès que
 * possible » garde son ancien geste (`card.asap`) — il ne date rien, il met la
 * carte en file ; la date, elle, la retient jusqu'à l'heure dite.
 */
function TiroirDeProgrammation({ carte, open, onClose }: { carte: Card; open: boolean; onClose: () => void }) {
  const maintenant = Date.now();
  const date = carte.scheduling?.departPrevu;
  const asap = carte.scheduling?.asap === true;
  const [saisie, setSaisie] = React.useState('');
  const [enCours, setEnCours] = React.useState<'poser' | 'retirer' | null>(null);

  /* Le champ repart de la date de la carte à chaque ouverture : on corrige une
     heure existante, on ne la retape pas. */
  React.useEffect(() => {
    if (open) setSaisie(date ? pourLeChamp(date) : '');
  }, [open, date]);

  const creneau = carte.scheduling?.creneauConseille;
  const conseillee = creneau ? momentDuCreneau(creneau, maintenant) : null;

  const programmer = async (quand: number | undefined) => {
    setEnCours(quand === undefined ? 'retirer' : 'poser');
    try {
      if (quand !== undefined) await validerSiBesoin(carte);
      await client.call({ type: 'card.schedule', id: carte.id, date: quand });
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Geste refusé'), carte.id);
    } finally {
      setEnCours(null);
    }
  };

  /* Les deux heures qu'on choisit neuf fois sur dix, sans rien saisir. */
  const ceSoir = () => {
    const quand = new Date(maintenant);
    quand.setHours(20, 0, 0, 0);
    return quand.getTime() <= maintenant ? quand.getTime() + 24 * 3600_000 : quand.getTime();
  };
  const demainMatin = () => {
    const quand = new Date(maintenant);
    quand.setDate(quand.getDate() + 1);
    quand.setHours(9, 0, 0, 0);
    return quand.getTime();
  };

  return (
    <Drawer adresse="programmation" open={open} onClose={onClose} empile className="max-h-[80dvh]">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Programmer le lancement')}</DialogTitle>
      </header>

      <ZoneDefilement fond="hsl(var(--surface))" className="space-y-3 px-3 pb-3" data-tiroir-programmation={carte.id}>
        <p className="text-[13px] leading-relaxed text-muted" data-programmation-etat>
          {date
            ? t('Départ programmé {v0} — la carte part toute seule à l’heure dite.', {
                v0: momentDeDepart(date, maintenant),
              })
            : t('Aucune heure retenue : la carte attend votre bouton.')}
        </p>

        {/* « DÈS QUE POSSIBLE » N'EST PLUS UN BOUTON À CÔTÉ DU LANCEMENT :
            c'est un interrupteur, ici, avec ce qu'il fait écrit à côté. */}
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[13.5px] font-medium text-text">{t(BOUTON_DES_QUE_POSSIBLE)}<BulleInfo cote="start">{t('La carte part d’elle-même dès qu’une place se libère.')}</BulleInfo></p>
          </div>
          <Switch
            checked={asap}
            data-des-que-possible={carte.id}
            onCheckedChange={(valeur) =>
              void (async () => {
                try {
                  /* Mettre la carte en file, c'est accepter son plan : sans
                     cette validation, l'ordonnanceur partirait sur un plan que
                     personne n'a tranché. */
                  if (valeur) await validerSiBesoin(carte);
                  await client.call({ type: 'card.asap', id: carte.id, value: valeur });
                } catch (err: any) {
                  client.pushToast('error', err?.message ?? t('Geste refusé'), carte.id);
                }
              })()
            }
          />
        </div>

        {/* LES RACCOURCIS D'ABORD, LA SAISIE ENSUITE : personne ne tape une
            date quand « ce soir » suffit. Le créneau conseillé de la carte est
            déjà calculé, sans le moindre appel de moteur. */}
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" data-raccourci-heure="ce-soir" onClick={() => void programmer(ceSoir())}>
            {t('Ce soir')}
          </Button>
          <Button variant="outline" size="sm" data-raccourci-heure="demain" onClick={() => void programmer(demainMatin())}>
            {t('Demain matin')}
          </Button>
          {conseillee ? (
            <Button
              variant="outline"
              size="sm"
              data-raccourci-heure="conseille"
              title={phraseDuCreneau(creneau!, maintenant)}
              onClick={() => void programmer(conseillee)}
            >
              <Calendar className="h-3 w-3" />
              {t('Retenir cette heure')} ({momentDeDepart(conseillee, maintenant)})
            </Button>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label>{t('Date et heure du lancement')}</Label>
          <ChoixDateEtHeure valeur={saisie} onChange={setSaisie} data-champ-heure="" />
        </div>

      </ZoneDefilement>

      <DialogFooter className="px-3 pt-2">
          {date ? (
            <Button
              variant="ghost"
              size="sm"
              data-retirer-heure
              disabled={enCours !== null}
              onClick={() => void programmer(undefined)}
              className="text-muted hover:text-danger"
            >
              {enCours === 'retirer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {t('Retirer la date')}
            </Button>
          ) : null}
          <Button
            variant="default"
            size="sm"
            data-enregistrer-heure
            disabled={enCours !== null || !saisie}
            onClick={() => {
              const lue = lireDateDeDepart(saisie);
              if (lue === null) {
                client.pushToast('error', t('Date illisible'), carte.id);
                return;
              }
              void programmer(lue);
            }}
          >
            {enCours === 'poser' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
            {t('Programmer')}
          </Button>
      </DialogFooter>
    </Drawer>
  );
}
