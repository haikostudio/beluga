import * as React from 'react';
import {
  AlertCircle,
  ArrowUp,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  ListChecks,
  Loader2,
  MessageSquare,
  RotateCcw,
  Rocket,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  Agent,
  BOUTON_DES_QUE_POSSIBLE,
  comprehensionPourLePlan,
  Card,
  DEFINITIONS_NIVEAU,
  DecisionDuParcours,
  EtatDeCartePourLePlan,
  EtatDuGeste,
  GesteCarte,
  GesteDuParcours,
  LIBELLES_GESTE,
  libelleDeValidation,
  Message,
  NIVEAU_DU_PLAN,
  PlanDeCarte,
  LIBELLE_REPRENDRE,

  agentTientSonTour,
  avanceDEtape,
  barreEnFinDeTache,
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
  procedureEnPlace,
  raisonDeployerDepuisLaCarte,
  prochaineQuestionDeCarte,
  COLONNES_AVANT_LE_TRAVAIL,
} from '@beluga/shared';
import { BulleInfo, Button, DialogFooter, DialogTitle, Drawer, Input, Label, Switch, Tooltip, ZoneDefilement } from '@/components/ui';
import { CarouselQuestions } from '@/components/carousel-questions';
import { EncadresDeCompetences } from '@/components/encadre-competence';
import { BulleQuestion } from '@/components/bulle-question';
import {
  ErreurDeTourCard,
  QuestionCard,
  QuestionEnTexteCard,
  RepriseDeCompteCard,
} from '@/components/message-view';
import { PlanRapport } from '@/components/plan-rapport';
import { BandeauPropositions } from '@/components/propositions';
import { useArretAgent } from '@/components/arret-agent';
import { BoutonEtapeSuivante, useAvancerEtapes } from '@/components/etape-suivante';
import { client } from '@/lib/client';
import { EVENEMENT_OUVRIR_DECISIONS, ouvrirLesDecisions } from '@/lib/ouvrir-decisions';
import { useTelephone } from '@/lib/telephone';
import { useApp } from '@/lib/use-app';
import { cn, dateHeure } from '@/lib/utils';
import { t } from '@/lib/langue';

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
  cardId,
  planValide,
  etatCarte,
  ancre,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  carte,
  passage,
  passages,
  nu = false,
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
  /**
   * LA CARTE QUI PORTE LE PLAN : « Valider » est un changement d'état de la
   * carte (`card.plan.validate`), plus un message envoyé à l'agent.
   */
  cardId?: string;
  /** La validation déjà écrite sur la carte, avec sa version. */
  planValide?: { version: number; at: number } | null;
  /** La carte, pour savoir si son travail a déjà été lancé : un plan DÉJÀ
   *  EXÉCUTÉ ne porte plus de décision (`decisionDePlanOuverte`). */
  etatCarte?: EtatDeCartePourLePlan;
  /** L'ancre du point qui porte ce plan : la cible du retour collant. */
  ancre?: string;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
  /**
   * LA CARTE ENTIÈRE : le volet lit sur elle l'avis du juge et l'état de son
   * tour. IL NE PORTE PLUS AUCUNE DÉCISION — le plan est devenu facultatif, et
   * la décision se prend UNE SEULE FOIS, sur le bouton unique « Valider et
   * lancer » collé au champ d'écriture. Absente hors du flux d'une carte.
   */
  carte?: Card;
  /** POSÉ DANS LE POINT « PLAN » DU FLUX : sans marge propre, le point la donne. */
  nu?: boolean;
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
  /*
   * UN PLAN NAÎT REPLIÉ, la version courante comprise. Ouvert d'office, il
   * prenait la moitié de l'écran à chaque itération et poussait le reste du
   * fil hors de vue. La DÉCISION, elle, ne dépend plus de ce repli : elle a
   * quitté ce bandeau pour la rangée collée au champ de saisie
   * (`BarreDAction`), toujours visible, où qu'on en soit dans le flux.
   */
  const [replie, setReplie] = React.useState(true);
  /*
   * SOUS 639 PX, LE DÉPLIANT DEVIENT UN VOLET. Un plan de plusieurs écrans posé
   * dans le fil d'un téléphone s'y lisait en colonne écrasée, et la décision se
   * prenait à l'autre bout de l'écran. La ligne du plan devient donc une
   * ENTRÉE : elle ouvre un volet plein écran qui porte le plan entier et ses
   * trois décisions en pied. Le volet part FERMÉ et ne s'ouvre que sur le clic
   * — aucun événement d'agent ne le fait paraître.
   */
  const telephone = useTelephone();
  const [voletOuvert, setVoletOuvert] = React.useState(false);
  /* UNE FENÊTRE QU'ON ÉLARGIT REFERME LE VOLET : le plan reprend sa place dans
     le fil, et rien ne reste posé par-dessus un écran qui n'en a plus besoin. */
  React.useEffect(() => {
    if (!telephone) setVoletOuvert(false);
  }, [telephone]);
  const cadre = React.useRef<HTMLDivElement>(null);
  const [deborde, setDeborde] = React.useState(false);

  /*
   * LE RETOUR COLLANT NE PARAÎT QUE S'IL SERT : un plan qui tient dans la
   * hauteur visible n'a personne à ramener nulle part. On compare la hauteur
   * du cadre à celle de la zone qui défile, à l'ouverture et à chaque
   * changement de taille de la fenêtre.
   *
   * DANS LE VOLET, IL N'A PLUS DE SENS : le plan y défile seul, il n'y a aucun
   * point à regagner. On ne mesure donc rien sur téléphone.
   */
  React.useEffect(() => {
    if (replie || telephone) {
      setDeborde(false);
      return;
    }
    const mesurer = () => {
      const bloc = cadre.current;
      if (!bloc) return;
      const zone = bloc.closest<HTMLElement>('[data-fil]');
      const hauteurVisible = zone?.clientHeight ?? window.innerHeight;
      setDeborde(bloc.getBoundingClientRect().height > hauteurVisible * 0.9);
    };
    const image = requestAnimationFrame(mesurer);
    window.addEventListener('resize', mesurer);
    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener('resize', mesurer);
    };
  }, [replie, telephone, plans.length]);

  if (!courant) return null;
  const vue = plans.find((plan) => plan.numero === version) ?? courant;
  const estCourant = vue.numero === courant.numero;
  /*
   * ET LA DÉCISION DEMANDE UNE CHOSE DE PLUS : que le travail n'ait pas déjà
   * été lancé. Le bandeau gardait « Valider » au-dessus d'un travail rendu, et
   * un clic aurait relancé la carte entière.
   */
  /* LA VERSION AFFICHÉE EST-ELLE VALIDÉE ? Écrit sur la carte, jamais deviné. */
  const valide = planValide?.version === vue.numero;
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

  /* LE RETOUR VISE L'ENTÊTE DU POINT PORTEUR, comme la barre d'étapes. */
  const revenirAuPoint = () => {
    const cible = ancre
      ? document.querySelector<HTMLElement>(`[data-point-ancre="${ancre}"]`)
      : cadre.current?.closest<HTMLElement>('[data-point-ancre]');
    cible?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /*
   * LE CORPS DU PLAN EST ÉCRIT UNE SEULE FOIS, POUR SES DEUX ENVELOPPES : le
   * dépliant du fil sur grand écran, le VOLET plein écran sur téléphone. Le
   * recopier aurait laissé l'un des deux dériver — c'est exactement ce qui
   * était arrivé au pied du plan, dessiné deux fois.
   */
  const corps = (
    <>
    <CorpsDuPlan
      texte={vue.texte}
      estCourant={estCourant}
      diff={diff}
      pickedEvolutions={pickedEvolutions}
      onToggleEvolution={onToggleEvolution}
      onToggleAll={onToggleAll}
    />
    </>
  );

  /* CE QUE DIT LE PIED DU VOLET : il ne DÉCIDE plus rien. Le plan n'est plus
     une étape validable — il accompagne la compréhension du même tour —, et la
     décision se prend une seule fois, sous le champ d'écriture. Le pied dit
     donc seulement où en est ce plan, et où se trouve le geste. */
  const piedDuVolet =
    decision && carte ? (
      <p data-volet-plan-sans-decision="ailleurs" className="text-[12.5px] text-muted">
        {t('Fermez ce volet : la validation se prend sous le champ d’écriture.')}
      </p>
    ) : enEcriture && estCourant && !valide && !dejaLance ? (
      <p data-volet-plan-sans-decision className="flex items-center gap-1.5 text-[12.5px] text-muted">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        {t('Plan en cours d’écriture : la décision s’ouvrira à la fin du tour.')}
      </p>
    ) : tourEnCours && estCourant && !valide && !dejaLance ? (
      /* UN AUTRE TOUR TRAVAILLE (compréhension, réponse) : le plan est prêt,
         mais on ne décide pas pendant que l'agent travaille — sans loader. */
      <p data-volet-plan-sans-decision="tour" className="text-[12.5px] text-muted">
        {t('L’agent travaille encore : la décision s’ouvrira à la fin du tour.')}
      </p>
    ) : dejaLance && estCourant ? (
      <p data-volet-plan-sans-decision className="text-[12.5px] text-muted">
        {t('Le travail a déjà été lancé à partir de ce plan.')}
      </p>
    ) : null;

  return (
    <div
      data-bloc-du-plan={vue.numero}
      /* SUR TÉLÉPHONE, LE PLAN N'A PLUS D'ÉTAT « DÉPLIÉ » DANS LE FIL : sa
         ligne est une ENTRÉE, et son contenu vit dans le volet. */
      data-bloc-du-plan-repli={telephone ? 'volet' : replie ? 'replie' : 'ouvert'}
      {...(telephone ? { 'data-plan-volet': voletOuvert ? 'ouvert' : 'ferme' } : {})}
      className={nu ? undefined : 'px-4 pb-3'}
    >
      <div
        ref={cadre}
        className={cn('rounded-lg border-2 bg-fond-plan px-3 py-3', estCourant ? 'border-border' : 'border-border/60')}
      >
        {/* LE BANDEAU NE PORTE PLUS AUCUNE DÉCISION : le titre, le numéro de
            version et le repli, rien d'autre. « Valider » et « Refuser »
            vivaient ici, à hauteur d'un plan encore en train de s'écrire ; ils
            sont descendus dans la rangée au-dessus du champ de saisie, où ils
            n'apparaissent qu'une fois le tour refermé. */}
        <div
          data-entete-plan
          className={cn('flex flex-wrap items-center gap-2', replie || telephone ? undefined : 'mb-2')}
        >
          <button
            type="button"
            data-bloc-du-plan-bascule={vue.numero}
            {...(telephone
              ? { 'aria-haspopup': 'dialog', 'aria-expanded': voletOuvert, 'data-plan-ouvrir-volet': vue.numero }
              : { 'aria-expanded': !replie })}
            onClick={() => (telephone ? setVoletOuvert(true) : setReplie((r) => !r))}
            className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden text-left text-[12px] font-medium uppercase tracking-wide text-muted transition-colors hover:text-text"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !replie && !telephone && 'rotate-90')} />
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{estCourant ? t('Plan proposé') : t('Version précédente')}</span>
            <span className="shrink-0 whitespace-nowrap normal-case tracking-normal text-faint">
              {t('· version {numero}', { numero: vue.numero })}
            </span>
          </button>
          {/* QUAND CETTE VERSION A ÉTÉ RENDUE, à droite de l'entête. Un plan
              qui a été refait trois fois se lit sans deviner lequel est le
              dernier : chaque version dit son heure. */}
          <span
            data-plan-rendu-le={vue.numero}
            className="shrink-0 whitespace-nowrap text-[12px] normal-case tracking-normal text-faint"
          >
            {dateHeure(vue.at)}
          </span>
        </div>

        {/* L'AGENT ÉCRIT ENCORE : le texte du plan se lit déjà — c'est voulu —
            mais rien ne se décide dessus. On le DIT, sinon l'absence de bouton
            se cherche. */}
        {estCourant && !valide && !dejaLance && enEcriture ? (
          <p data-plan-en-ecriture className="mb-2 flex items-center gap-1.5 text-[12.5px] text-muted">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            {t('Plan en cours d’écriture : la décision s’ouvrira à la fin du tour.')}
          </p>
        ) : null}

        {/* LE TRAVAIL EST DÉJÀ PARTI DE CE PLAN : plus rien à décider, et on le
            DIT — un bouton retiré sans un mot se cherche. */}
        {estCourant && !decision && dejaLance ? (
          <p data-plan-deja-lance className="mb-2 text-[12.5px] text-muted">
            {t('Le travail a déjà été lancé à partir de ce plan.')}
          </p>
        ) : null}

        {/* LE CORPS RESTE MONTÉ, MÊME REPLIÉ : les idées cochées dans
            « Améliorations apportées » survivent au repli. Sur téléphone il
            n'est pas ici du tout : il est dans le volet. */}
        {telephone ? null : (
          <div hidden={replie} data-bloc-du-plan-corps>
            {/* LE RETOUR AU POINT, COLLÉ EN HAUT DU PLAN OUVERT. Il emprunte le
                fond du plan pour que le texte ne défile pas derrière lui. */}
            {deborde ? (
              <div className="sticky top-0 z-10 -mx-3 mb-2 flex items-center justify-between gap-2 bg-fond-plan px-3 py-1.5">
                <span className="truncate text-[12px] uppercase tracking-wide text-faint">
                  {t('· version {numero}', { numero: vue.numero })}
                </span>
                <button
                  type="button"
                  data-retour-au-point
                  onClick={revenirAuPoint}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:bg-raised hover:text-text"
                >
                  <ArrowUp className="h-3 w-3" />
                  {t('Revenir au début du point')}
                </button>
              </div>
            ) : null}

            {corps}
          </div>
        )}
      </div>

      {/* SUR TÉLÉPHONE, LE PLAN SE LIT DANS UN VOLET PLEIN ÉCRAN, décisions en
          pied fixe. Il n'est monté que sur téléphone : sur grand écran, rien de
          tout cela n'existe dans la page. */}
      {telephone ? (
        <VoletDuPlan
          ouvert={voletOuvert}
          onFermer={() => setVoletOuvert(false)}
          titre={estCourant ? t('Plan proposé') : t('Version précédente')}
          numero={vue.numero}
          pied={piedDuVolet}
        >
          {corps}
        </VoletDuPlan>
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
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
}: {
  texte: string;
  estCourant: boolean;
  /** Les différences vers la version suivante, quand ce n'est pas la dernière. */
  diff: ReturnType<typeof differencesDeTexte> | null;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
}) {
  return (
    <>
      <PlanRapport
        contenu={texte}
        courant={estCourant}
        pickedEvolutions={pickedEvolutions}
        onToggleEvolution={estCourant ? onToggleEvolution : undefined}
        onToggleAll={estCourant ? onToggleAll : undefined}
      />

      {diff ? (
        <div className="mt-3 border-t border-border pt-3" data-diff-du-plan>
          <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">
            {t('Différences avec la version suivante')}
          </p>
          <div className="space-y-0.5 rounded-md bg-raised px-2.5 py-2 font-mono text-[12px] leading-relaxed">
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
        </div>
      ) : null}

    </>
  );
}

/**
 * LE PLAN EN VOLET, SOUS 639 PX.
 *
 * Dans le fil d'un téléphone, un plan de plusieurs écrans se lisait en colonne
 * écrasée : on descendait longtemps dans le flux, et la décision se prenait à
 * l'autre bout de l'écran, sans plus rien voir de ce qu'on venait de lire. La
 * ligne du plan devient donc une ENTRÉE, et le plan s'ouvre dans un volet plein
 * écran : le texte entier défile au milieu, les trois décisions restent COLLÉES
 * en pied, toujours visibles.
 *
 * Le volet ne s'ouvre que sur le clic : aucun événement d'agent ne le fait
 * paraître par-dessus ce qu'on est en train de lire.
 */
function VoletDuPlan({
  ouvert,
  onFermer,
  titre,
  numero,
  pied,
  children,
}: {
  ouvert: boolean;
  onFermer: () => void;
  titre: string;
  numero: number;
  /** Le pied FIXE : les trois décisions, ou la phrase qui dit pourquoi il n'y en a pas. */
  pied?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Drawer open={ouvert} onClose={onFermer} plein>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2" data-volet-plan-entete>
        <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <DialogTitle className="min-w-0 flex-1 truncate text-[13.5px]">
          {titre}
          <span className="ml-1.5 font-normal text-faint">{t('· version {numero}', { numero })}</span>
        </DialogTitle>
        <button
          type="button"
          data-volet-plan-fermer
          aria-label="Fermer"
          onClick={onFermer}
          className="shrink-0 rounded-md px-2 py-1 text-[12.5px] text-muted transition-colors hover:bg-raised hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* LE PLAN DÉFILE SEUL, ENTRE L'ENTÊTE ET LE PIED : c'est la seule zone
          du volet qui bouge (`ZoneDefilement`, règle de l'interface). */}
      <ZoneDefilement className="px-3 pb-3" data-volet-plan-corps>
        {children}
      </ZoneDefilement>

      {/* LE PIED EST FIXE : on décide sans remonter, où qu'on en soit dans la
          lecture. Il emprunte le fond du tiroir, sinon le texte défilerait en
          transparence derrière les boutons. */}
      {pied ? (
        <div data-volet-plan-pied className="shrink-0 border-t border-border bg-surface px-3 pb-2 pt-2.5">
          {pied}
        </div>
      ) : null}
    </Drawer>
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
   * L'AGENT : elles sortent du panneau jaune et de son feuilletage, et prennent
   * leurs lignes violettes, une par compétence, toutes visibles ensemble
   * (`EncadresDeCompetences`). Elles naissent retenues ; TANT QUE LA CARTE EST
   * EN CADRAGE, toutes restent affichées, pour qu'une croix puisse en écarter
   * une jusqu'au lancement. Ensuite, seule la série du DERNIER message reste
   * lisible (et un ancien encadré resté ouvert, jusqu'à sa réponse).
   */
  const estUneCompetence = (d: DecisionDuParcours) =>
    d.sorte === 'question' && !!parId.get(d.messageId)?.questions.find((q) => q.id === d.questionId)?.competence;
  const dernierMessage = messages[messages.length - 1];
  const seriesDeCompetences = messages.filter(
    (message) =>
      message.questions.some((q) => q.competence && !q.answer && !q.cancelled) ||
      ((carte.column === 'planned' || message.id === dernierMessage?.id) && message.questions.some((q) => q.competence)),
  );
  const decisions = toutesLesDecisions.filter((d) => !estUneCompetence(d));
  const questions = decisions.filter((d): d is Extract<DecisionDuParcours, { sorte: 'question' }> => d.sorte === 'question');
  const autres = decisions.filter((d) => d.sorte !== 'question');
  const [replie, setReplie] = React.useState(false);
  // « Reprendre » heurtant cette décision la déplie (`ouvrirLesDecisions`).
  React.useEffect(() => {
    const deplier = () => setReplie(false);
    window.addEventListener(EVENEMENT_OUVRIR_DECISIONS, deplier);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_DECISIONS, deplier);
  }, []);
  const lot = decisions.map((d) => (d.sorte === 'question' ? d.questionId : d.sorte === 'incident' ? 'incident' : d.messageId)).join('|');
  React.useEffect(() => setReplie(false), [lot]);

  const competences = seriesDeCompetences.length ? (
    <div className="shrink-0 px-3 pb-1 pt-2" data-panneau-competences={seriesDeCompetences.length}>
      <ZoneDefilement
        classeEnveloppe="max-h-[45vh] overflow-hidden rounded-xl bg-bloc-fil"
        fond="var(--fond-bloc-fil, hsl(var(--bloc-etapes)))"
        className="px-2.5 pb-2.5"
      >
        {seriesDeCompetences.map((message) => (
          <EncadresDeCompetences key={message.id} messageId={message.id} agentId={message.agentId} questions={message.questions} />
        ))}
      </ZoneDefilement>
    </div>
  ) : null;

  const questionsDeLaCarte = <QuestionsDeLaCarte carte={carte} projectId={projectId} />;

  if (!decisions.length) {
    return (
      <>
        <BandeauPropositions messages={messages} />
        {questionsDeLaCarte}
        {competences}
      </>
    );
  }

  const intitule = titreDeLaDecision(decisions[0], parId);

  return (
    <>
      <BandeauPropositions messages={messages} />
      {questionsDeLaCarte}
      {competences}
      <div className="shrink-0 px-3 pb-1 pt-2" data-panneau-decision={decisions.length}>
        <div
          className={cn(
            'overflow-hidden rounded-xl border bg-bloc-fil',
            decisions.some((d) => d.sorte === 'erreur' || d.sorte === 'incident') ? 'border-danger/50' : 'border-warning/50',
          )}
          data-panneau-etat={replie ? 'replie' : 'deploye'}
        >
          <button
            type="button"
            onClick={() => setReplie((r) => !r)}
            aria-expanded={!replie}
            data-panneau-bascule
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
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
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-faint transition-transform', replie && '-rotate-90')} aria-hidden />
          </button>

          {replie ? null : (
            <ZoneDefilement
              classeEnveloppe="max-h-[45vh]"
              fond="var(--fond-bloc-fil, hsl(var(--bloc-etapes)))"
              className="space-y-2 px-2.5 pb-2.5"
              data-panneau-corps
            >
              {questions.length ? (
                <CarouselQuestions
                  questions={questions}
                  cle={(item) => item.questionId}
                  repondue={() => false}
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
    <div className="shrink-0 px-3 pb-1 pt-2" data-questions-de-carte={toutes.length} data-question-de-carte-rang={rang}>
      <ZoneDefilement
        classeEnveloppe="max-h-[45vh] overflow-hidden rounded-xl border border-warning/50 bg-bloc-fil"
        fond="var(--fond-bloc-fil, hsl(var(--bloc-etapes)))"
        className="px-2.5 pb-2.5"
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
          : Square;
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
  colle,
  libelle,
  onAgir,
}: {
  geste: EtatDuGeste;
  /** Le geste de gauche, celui qui prend la largeur restante. */
  principal: boolean;
  /** Le bouton est SCINDÉ : son sous-bouton est collé à sa droite. */
  colle?: boolean;
  /**
   * LE LIBELLÉ DE LA RÈGLE DE REPRISE, quand la carte n'a encore aucun agent :
   * « Reprendre » sur une carte coupée en vol, « Lancer maintenant » sur une
   * carte neuve (`libelleDeLancement`). Sans lui, le mot du geste.
   */
  libelle?: string;
  onAgir: (geste: EtatDuGeste) => unknown;
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

  const Icone = libelle === t(LIBELLE_REPRENDRE) ? RotateCcw : iconeDuGeste(geste.geste);
  const arretRouge = geste.geste === 'arreter';

  return (
    <div className={cn('flex-1', colle ? 'min-w-0' : principal ? 'min-w-[150px]' : 'min-w-[130px]')}>
      <BoutonPrincipal raison={!geste.possible ? geste.raison : undefined}>
        <Button
          type="button"
          variant={arretRouge || !principal ? 'outline' : 'default'}
          data-geste-principal={geste.geste}
          aria-disabled={!geste.possible}
          /* Éteint parce qu'une décision attend : le clic MÈNE à cette décision. */
          onClick={() => (geste.possible ? onAgir(geste) : geste.raison ? void ouvrirLesDecisions() : undefined)}
          title={!geste.possible && geste.raison ? t(geste.raison) : undefined}
          className={cn(
            CLASSES_BOUTON_DU_FIL,
            colle && 'rounded-r-none',
            vientDeSallumer && 'animate-appel',
            geste.possible
              ? arretRouge
                ? 'border-danger/50 bg-raised text-danger hover:bg-danger/10'
                : principal
                  ? 'bg-accent text-accent-fg hover:opacity-90'
                  : 'border-border bg-raised text-text hover:bg-accent/10'
              : 'cursor-not-allowed border-transparent bg-raised text-faint hover:bg-raised hover:text-faint',
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
export function BarreDAction({
  carte,
  agent,
  gestes,
}: {
  carte: Card;
  agent: Agent | null;
  /** Un ou deux gestes, dans l'ordre (`gestesDuParcours`). */
  gestes: EtatDuGeste[];
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
   * LA FIN DE TÂCHE N'A PLUS QU'UN BOUTON (demande du 02.10.2026). Un rapport
   * rendu, une carte « À déployer » ou « Archivé » alignaient jusqu'à quatre
   * boutons — terminer, reprendre, passer à l'étape suivante, déployer le lot,
   * remettre en demande. Ils vivent désormais dans un TIROIR, ouvert par un
   * seul bouton « Actions de la tâche ». « Remettre en demande » (« Retirer du
   * lot à publier », « Sortir de l'archive ») a disparu : écrire à l'agent
   * ramène déjà la carte en « Demande ». Le « Reprendre » d'une carte
   * INTERROMPUE (chapitre travail) n'est pas une fin de tâche : il reste direct.
   *
   * UNE CARTE RELANCÉE N'EST PLUS EN FIN DE TÂCHE (`barreEnFinDeTache`) : un
   * message sous son rapport a rouvert son cadrage, et la rangée montre le
   * geste du cadrage — « Valider et lancer », éteint pendant la réflexion —,
   * jamais « Actions de la tâche » (capture #35079, 04.10.2026).
   */
  const finDeTache = barreEnFinDeTache({ carte, chapitre: principal?.chapitre });
  const [tiroirFin, setTiroirFin] = React.useState(false);
  /*
   * LE PREMIER DÉPART D'UNE CARTE DONT AUCUN AGENT NE S'EST SAISI. Le pied du
   * tiroir portait ici un second bouton de lancement, à côté de celui du
   * chapitre : le MÊME geste, deux fois, de part et d'autre du champ. Il n'en
   * reste qu'un — celui du chapitre —, mais il prend le LIBELLÉ de la règle de
   * reprise (`libelleDeLancement`), sans quoi une carte coupée en vol
   * repartirait sous le mot « Lancer ».
   */
  const departSansAgent = carte.column === 'planned' && !agent;
  /* LE LOT SE DÉPLOIE AUSSI D'ICI : une carte « À déployer » porte le bouton
     qui ouvre la fenêtre de déploiement de tout le lot — sauf relancée
     (`lotDeployableDepuisLaCarte`). */
  const deployerLeLot = lotDeployableDepuisLaCarte(carte);
  const rangement = avanceUtile || deployerLeLot;

  const duChapitre = principal && principal.geste !== 'aucun' ? gestes : [];
  if (!duChapitre.length && !rangement) return null;

  /*
   * LE CLIC REND SA REQUÊTE AU BOUTON : roue pendant l'attente, coche à la
   * réussite, retour à l'état d'avant sur un refus. Le refus est DIT en rouge
   * puis RELANCÉ — sans quoi le bouton verrait une requête « réussie » et
   * poserait une coche sur un geste qui n'a pas abouti.
   */
  const motDeRefus = t('Geste refusé');
  const refuse = (err: any) => {
    client.signalerRefus(err?.message ?? motDeRefus, carte.id);
    throw err;
  };
  const agir = (geste: EtatDuGeste): unknown => {
    /* UN SEUL CLIC POUR DEUX COMMANDES : la validation s'écrit sur la carte,
       le lancement suit aussitôt (`validerEtLancer`). */
    if (geste.geste === 'valider-et-lancer') return validerEtLancer(carte);
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

  if (finDeTache) {
    /* Un geste du tiroir le referme dès qu'il a abouti : la carte change
       d'état, et le tiroir n'a plus rien à proposer de juste. */
    const agirPuisFermer = async (geste: EtatDuGeste) => {
      await agir(geste);
      setTiroirFin(false);
    };
    return (
      <div
        data-barre-action={principal?.geste ?? 'aucun'}
        data-geste-possible={principal?.possible ? 'oui' : 'non'}
        data-gestes={duChapitre.map((g) => g.geste).join(',')}
        data-fin-de-tache
      >
        <Button
          type="button"
          size="sm"
          variant="default"
          data-bouton-fin-de-tache
          onClick={() => setTiroirFin(true)}
          className={cn(CLASSES_BOUTON_DU_FIL, 'w-full')}
        >
          <ListChecks className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{t('Actions de la tâche')}</span>
        </Button>
        <Drawer open={tiroirFin} onClose={() => setTiroirFin(false)} empile>
          <div className="flex flex-col gap-3 px-4 pb-5" data-tiroir-fin-de-tache={carte.id}>
            <DialogTitle>{t('Actions de la tâche')}</DialogTitle>
            <p className="text-[13px] leading-snug text-muted">
              {t('Pour reprendre le travail, écrivez simplement à l’agent : la carte revient d’elle-même en « Demande ».')}
            </p>
            <div className="flex flex-col gap-1.5 [&>*]:w-full">
              {duChapitre.map((geste, index) => (
                <BoutonDeGeste key={geste.geste} geste={geste} principal={index === 0} onAgir={agirPuisFermer} />
              ))}
              {avanceUtile ? (
                <BoutonEtapeSuivante
                  card={carte}
                  agentActif={agentAuTravail}
                  className={CLASSES_BOUTON_DU_FIL}
                  onAvancer={() => {
                    setTiroirFin(false);
                    avancer([{ card: carte, agentActif: agentAuTravail }]);
                  }}
                />
              ) : null}
              {deployerLeLot ? <BoutonDeployerLeLot carte={carte} /> : null}
            </div>
          </div>
        </Drawer>
        {arret.dialogue}
        {dialogueAvance}
      </div>
    );
  }

  return (
    <div
      data-barre-action={principal?.geste ?? 'aucun'}
      data-geste-possible={principal?.possible ? 'oui' : 'non'}
      data-gestes={duChapitre.map((g) => g.geste).join(',')}
    >
      {/* PLUS AUCUN AVIS ÉCRIT AU-DESSUS DU LANCEMENT : la note du relecteur se
          lit sur l'indicateur à trois barres de la barre d'écriture
          (`web/src/components/indicateur-comprehension.tsx`). */}
      {/* UN BOUTON PAR LIGNE SUR TÉLÉPHONE : deux libellés côte à côte n'y
          tiennent pas, le texte sortait de l'écran. */}
      {(
        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-stretch">
          {duChapitre.map((geste, index) => {
            /* LE LANCEMENT EST UN BOUTON SCINDÉ : le corps part tout de suite,
               le sous-bouton d'horloge ouvre le tiroir de programmation. Il n'y
               a plus de bouton « Dès que possible » à côté — il est devenu un
               interrupteur DANS ce tiroir. « Valider et lancer » EST un
               lancement : il garde donc la même horloge. */
            const scinde =
              index === 0 &&
              (geste.geste === 'lancer' || geste.geste === 'reprendre' || geste.geste === 'valider-et-lancer');
            const libelle =
              geste.geste === 'valider-et-lancer'
                ? /* LE MODÈLE QUI PARTIRA SE LIT SUR LE BOUTON : celui de la carte,
                     modifiable jusqu'à ce clic ; à défaut, le palier du cadrage. */
                  `${t(libelleDeValidation(carte.scheduling))} · ${modeleQuiPart}`
                : geste.geste === 'lancer' && departSansAgent
                  ? t(libelleDeLancement(carte))
                  : undefined;
            return scinde ? (
              <div key={geste.geste} className="flex min-w-[150px] flex-1 items-stretch" data-bouton-scinde={carte.id}>
                <BoutonDeGeste geste={geste} principal colle libelle={libelle} onAgir={agir} />
                {/* L'HORLOGE SUIT SON BOUTON. Programmer un départ, c'est lancer
                    plus tard : quand le lancement est éteint, dater ce lancement
                    n'a pas de sens non plus. */}
                <SousBoutonProgrammation
                  carte={carte}
                  possible={geste.possible}
                  {...(geste.raison ? { raison: geste.raison } : {})}
                />
              </div>
            ) : (
              <BoutonDeGeste key={geste.geste} geste={geste} principal={index === 0} libelle={libelle} onAgir={agir} />
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
          {avanceUtile ? (
            <BoutonEtapeSuivante
              card={carte}
              agentActif={agentAuTravail}
              className={CLASSES_BOUTON_DU_FIL}
              onAvancer={() => avancer([{ card: carte, agentActif: agentAuTravail }])}
            />
          ) : null}
          {deployerLeLot ? <BoutonDeployerLeLot carte={carte} /> : null}
        </div>
      ) : null}

      {arret.dialogue}
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
function BoutonDeployerLeLot({ carte }: { carte: Card }) {
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
      cartesDuLot: colonne.filter((card) => !card.excludedFromDeploy && !card.deployedAt).length,
      cartesDansLaColonne: colonne.length,
      horsLigne: !etat.connected,
    });
  }, [etat.cards, etat.projects, etat.deploys, etat.agents, etat.connected, projectId]);
  return (
    <BoutonPrincipal raison={raison ?? undefined}>
      <Button
        type="button"
        size="sm"
        variant="outline"
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
          raison
            ? 'cursor-not-allowed border-transparent bg-raised text-faint hover:bg-raised hover:text-faint'
            : 'border-border bg-raised text-text hover:bg-accent/10',
        )}
      >
        <Rocket className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('Déployer le lot')}</span>
      </Button>
    </BoutonPrincipal>
  );
}

/**
 * TOUS LES BOUTONS SOUS LE FIL ONT LA MÊME HAUTEUR : celle de « Générer le
 * plan ». « Passer à « À déployer » » gardait la petite taille des boutons
 * ordinaires et s'écrasait sous le geste du chapitre (capture du 14.09.2026).
 * `min-w-0` + libellé `truncate` : un texte trop long se raccourcit, il ne
 * sort plus du bouton ni de l'écran.
 */
export const CLASSES_BOUTON_DU_FIL =
  /* Une hauteur FIXE, bordure comprise : un bouton plein et un bouton à bordure
     gardaient 2 px d'écart avec une hauteur « au contenu ». */
  'h-9 w-full min-w-0 justify-center gap-2 rounded-lg px-3 py-0 text-[13px] font-medium';

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
 * LE SOUS-BOUTON D'HORLOGE, COLLÉ À « LANCER LA TÂCHE ».
 *
 * « Dès que possible » vivait à côté du lancement, en bouton séparé : deux
 * boutons dont la relation n'était pas évidente, et AUCUN chemin pour dire
 * « pars demain à 6 h » depuis que la commande de date avait disparu du
 * protocole. Le lancement est donc UN geste avec deux façons de le dater : le
 * corps part tout de suite, le sous-bouton ouvre le tiroir de programmation.
 *
 * Une carte déjà datée le DIT ici même : l'heure retenue est écrite sur le
 * sous-bouton, et l'infobulle donne la phrase entière.
 */
export function SousBoutonProgrammation({
  carte,
  possible = true,
  raison,
}: {
  carte: Card;
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
        label={
          !possible
            ? raison
              ? t(raison)
              : t('Le lancement n’est pas possible : la programmation non plus.')
            : programmee
              ? t('Départ programmé {v0} — cliquez pour changer', { v0: momentDeDepart(date!, Date.now()) })
              : asap
                ? t('La carte partira d’elle-même dès qu’une place se libère — cliquez pour changer')
                : t('Choisir la date et l’heure du lancement')
        }
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
            'flex shrink-0 items-center justify-center gap-1.5 rounded-lg rounded-l-none border-l px-2.5 py-2 text-[13px] font-medium transition-opacity',
            possible
              ? 'border-accent-fg/25 bg-accent text-accent-fg hover:opacity-90'
              : 'cursor-not-allowed border-transparent bg-raised text-faint',
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
    <Drawer open={open} onClose={onClose} empile className="max-h-[80dvh]">
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
          <Label htmlFor={`heure-${carte.id}`}>{t('Date et heure du lancement')}</Label>
          <Input
            id={`heure-${carte.id}`}
            type="datetime-local"
            value={saisie}
            data-champ-heure
            onChange={(event) => setSaisie(event.target.value)}
          />
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
