/*
 * LES BRIQUES D'UNE PUBLICATION : ses pastilles, son avancement, son lot, et
 * le compte rendu qui porte les gestes.
 *
 * Ce fichier ne dessine plus d'écran. Le SUIVI d'une mise en ligne — le
 * parcours à gauche, le détail de l'étape choisie à droite — vit dans
 * `volet-publication.tsx`, monté une fois par étape (déploiement, mise en
 * production) ; ce qui reste ici, ce sont les pièces que ce volet assemble :
 *
 *  - LES PASTILLES D'ÉTAT (`IconeEtape`, `IconeMoment`) et leurs couleurs de
 *    bordure, qui suivent la convention de toute l'application — orange pour ce
 *    qui est en cours, bleu pour ce qui est terminé, la clé orange du secours
 *    pour ce qui n'est passé qu'après une reprise ;
 *  - L'AVANCEMENT CHIFFRÉ en tête du volet, et le LOT de cartes embarquées ;
 *  - LE COMPTE RENDU (`DeployControls`) : l'issue, l'adresse contrôlée, et les
 *    deux seuls gestes qui agissent — « Arrêter », « Relancer » —, plus le
 *    retour à la version précédente.
 *
 * Rien ici ne publie ni ne relance de soi-même : ces pièces MONTRENT, elles ne
 * décident pas.
 */
import * as React from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Dot,
  Loader2,
  MinusCircle,
  RotateCcw,
  Square,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import {
  DeployRun,
  DeployStepKey,
  LIBELLE_ETAT_TACHE,
  LIBELLE_RATTRAPAGE,
  etatAfficheDuRattrapage,
  reconciliationALaMain,
  tacheReconciliable,
  avancementDeLaBranche,
  avancementDuFlux,
  ecartDepuisLeDebut,
  etapeDePublication,
  filDeLEtape,
  heureDeLEvenement,
  heureExacte,
  natureDeLEtat,
  natureDePublication,
  resumeDuFil,
  resumeDuLot,
  titreDeLaPublication,
  libelleDuChampDuFil,
  parcoursDeLaPublication,
  reponsesToutesFaites,
  type AvancementDuFlux,
  type EtapePourAvancement,
  type EtatDeTache,
  type GenreDEvenement,
  type EtatDuMoment,
  type TacheDuLot,
} from '@beluga/shared';
import { Button, DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { Chat } from '@/components/chat';
import { ReglageEnLecture } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, elapsed, relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';

type EtapeRun = DeployRun['steps'][number];
type EtatEtape = EtapeRun['state'];

/**
 * La DURÉE d'une étape terminée, en une poignée de signes. Les étapes rapides
 * (enregistrement, envoi) tiennent sous la seconde : on le dit plutôt que
 * d'afficher un tiret, qui se lirait comme « durée inconnue ».
 */
function dureeEtape(etape?: EtapeRun): string | null {
  if (!etape?.startedAt || !etape.endedAt) return null;
  const secondes = (etape.endedAt - etape.startedAt) / 1000;
  return secondes < 1 ? '< 1 s' : duration(secondes);
}

/**
 * QUAND L'ÉTAPE A EU LIEU, ET COMBIEN DE TEMPS ELLE A PRIS : « 17:41 (2 s) ».
 *
 * La durée seule ne répondait qu'à la moitié de la question. En la faisant
 * précéder de l'heure de DÉBUT, la liste se lit de haut en bas comme une
 * chronologie : à quel moment chaque étape s'est lancée, et où le temps est
 * parti. L'heure est donnée à la MINUTE — la seconde exacte reste dans les
 * moments dépliés et dans l'infobulle.
 *
 * Rien à dire pour une étape jamais démarrée : un tiret se lirait « durée
 * inconnue ». Une étape ENCORE EN ROUTE n'a pas de fin, donc pas de
 * parenthèses — son heure de départ, et c'est tout.
 */
export function heureEtDureeEtape(etape?: EtapeRun): { libelle: string; infobulle: string } | null {
  if (!etape?.startedAt) return null;
  const heure = heureDeLEvenement(etape.startedAt).slice(0, 5);
  const duree = dureeEtape(etape);
  return {
    libelle: duree ? `${heure} (${duree})` : heure,
    infobulle: `${relativeTime(etape.startedAt)} · ${heureExacte(etape.startedAt)}`,
  };
}

/**
 * L'icône posée dans le rond d'une étape, la même partout.
 *
 * `rattrape` : l'étape a fini par passer, mais elle est TOMBÉE en chemin et a
 * demandé une reprise. Une coche verte pleine effacerait cet incident du
 * tableau — on pose donc la clé orange du secours, la même que les moments de
 * dépannage du fil.
 */
export function IconeEtape({ etat, rattrape }: { etat: EtatEtape; rattrape?: boolean }) {
  if (etat === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-en-cours" />;
  if (etat === 'done' && rattrape) return <Wrench className="h-3.5 w-3.5 text-warning" />;
  if (etat === 'done') return <Check className="h-3.5 w-3.5 text-success" />;
  if (etat === 'failed') return <X className="h-3.5 w-3.5 text-danger" />;
  if (etat === 'skipped') return <MinusCircle className="h-3.5 w-3.5 text-faint" />;
  return <span className="block h-1.5 w-1.5 rounded-full bg-faint" />;
}

/**
 * LA DATE SOUS LE MESSAGE : l'heure du moment, posée SOUS le texte qu'elle
 * date — jamais dans la colonne des ronds, qui est réservée aux TRAITS de la
 * timeline (une date glissée là les coupait). Un moment du fil la donne à la
 * SECONDE, une étape à la minute ; l'ancienneté (« il y a 2 min ») reste en
 * infobulle, et l'écart depuis le début de l'étape suit l'heure.
 */
export function DateSousLeMessage({
  at,
  ecart,
  precision = 'seconde',
  repere = 'moment',
}: {
  at?: number;
  ecart?: string | null;
  precision?: 'seconde' | 'minute';
  repere?: string;
}) {
  if (!at) return null;
  const heure = heureDeLEvenement(at);
  return (
    <p className="px-1.5 pt-0.5 text-[10.5px] tabular-nums text-faint">
      <span data-heure-moment={repere} title={`${relativeTime(at)} · ${heureExacte(at)}`}>
        {precision === 'minute' ? heure.slice(0, 5) : heure}
      </span>
      {ecart ? <span> · {ecart}</span> : null}
    </p>
  );
}

/**
 * L'icône posée dans le (petit) rond d'un moment du fil. Elle ne dit qu'une
 * chose : de quelle NATURE est ce moment — une commande lancée, un dépannage,
 * une issue, une simple avancée. Le texte, lui, a été écrit par celui qui a
 * fait le geste et n'est jamais reformulé ici.
 */
export function IconeMoment({ genre, etat }: { genre: GenreDEvenement; etat?: EtatDuMoment }) {
  /* L'ÉTAT PASSE AVANT LE GENRE. Une sous-étape nommée (« shared », « server »,
     « web ») a un avant et un après : son rond tourne pendant qu'elle compile,
     porte une coche quand elle est passée, une croix quand elle a bloqué —
     exactement ce que `IconeEtape` fait au niveau du dessus. */
  if (etat === 'encours') return <Loader2 className="h-2.5 w-2.5 animate-spin text-en-cours" />;
  if (etat === 'fait') return <Check className="h-2.5 w-2.5 text-success" />;
  if (etat === 'echec') return <X className="h-2.5 w-2.5 text-danger" />;
  /* Sautée : ni coche ni croix — la même barre neutre qu'une étape sautée. */
  if (etat === 'saute') return <MinusCircle className="h-2.5 w-2.5 text-faint" />;
  /* Rattrapée après une coupure : la clé du secours, en orange. */
  if (etat === 'rattrape') return <Wrench className="h-2.5 w-2.5 text-warning" />;
  if (genre === 'commande') return <Terminal className="h-2.5 w-2.5 text-faint" />;
  if (genre === 'depannage') return <Wrench className="h-2.5 w-2.5 text-warning" />;
  if (genre === 'issue') return <Check className="h-2.5 w-2.5 text-success" />;
  if (genre === 'debut') return <ChevronRight className="h-2.5 w-2.5 text-faint" />;
  return <Dot className="h-3 w-3 text-faint" />;
}

/**
 * La COULEUR de bordure du (petit) rond d'un moment — la même logique que
 * celle d'une étape, à son échelle : le dépannage en orange, une issue en
 * bleu (la couleur du terminé), tout le reste en gris neutre.
 */
export function bordureRondMoment(genre: GenreDEvenement, etat?: EtatDuMoment): string {
  if (etat === 'encours') return 'border-en-cours';
  if (etat === 'fait') return 'border-success/60';
  if (etat === 'echec') return 'border-danger/60';
  if (etat === 'saute') return 'border-border';
  if (etat === 'rattrape') return 'border-warning/60';
  if (genre === 'depannage') return 'border-warning/60';
  if (genre === 'issue') return 'border-success/60';
  return 'border-border';
}

/**
 * Le motif d'un échec, lisible. Le serveur écrit d'abord la raison en clair,
 * puis, s'il en a, les dernières lignes techniques : n'afficher que la fin
 * coupait justement la phrase qui explique.
 */
export function motifLisible(log: string): string {
  const texte = log.trim();
  if (texte.length <= 1200) return texte;
  return `${texte.slice(0, 400)}\n…\n${texte.slice(-700)}`;
}

/**
 * LA PASTILLE D'UNE TÂCHE DU LOT. Elle ne dit qu'une chose : ce qui a ABOUTI,
 * ce qui TRAVAILLE, ce qui est resté au bord — la convention de toute
 * l'application (orange pour ce qui est en cours, bleu pour ce qui est
 * terminé), jamais une nuance de plus.
 */
function IconeTache({ etat }: { etat: EtatDeTache }) {
  const nature = natureDeLEtat(etat);
  if (nature === 'encours') return <Loader2 className="h-3 w-3 animate-spin text-en-cours" />;
  if (nature === 'fait') return <Check className="h-3 w-3 text-success" />;
  if (nature === 'ecart') return <MinusCircle className="h-3 w-3 text-warning" />;
  return <span className="block h-3 w-3 rounded-full border border-border" />;
}

/**
 * LE CHIFFRE DE TOUT LE FLUX, EN TÊTE DU TIROIR — la première chose qu'on lit,
 * et la seule qui ne bouge pas quand on fait défiler.
 *
 * Le tiroir racontait tout, sauf ce qu'il RESTE : devant sept étapes et six
 * branches, il fallait compter de tête. Une barre et un pourcentage y
 * répondent d'un coup d'œil, avec la ligne qui dit d'où sort le chiffre — un
 * pourcentage sans son décompte n'est qu'une opinion.
 *
 * La couleur suit la convention de toute l'application : orange tant que ça
 * tourne, bleu une fois terminé — et l'orange d'alerte quand la publication
 * s'est arrêtée en chemin, où le chiffre est FIGÉ.
 */
export function AvancementDuFluxEnTete({ avancement }: { avancement: AvancementDuFlux }) {
  const teinte = avancement.termine ? 'success' : avancement.arrete ? 'warning' : 'en-cours';
  return (
    <div className="mt-2" data-avancement-flux={avancement.pourcent} data-flux-arrete={avancement.arrete ? 'oui' : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-faint" data-resume-flux>
          {t('{v0} étape(s) sur {v1}', { v0: avancement.faites, v1: avancement.etapes })}
          {avancement.arrete ? ` · ${t('arrêté ici')}` : ''}
        </span>
        <span
          className={cn(
            'shrink-0 text-[13px] font-semibold tabular-nums',
            teinte === 'success' ? 'text-success' : teinte === 'warning' ? 'text-warning' : 'text-en-cours',
          )}
          data-pourcent-flux
        >
          {avancement.pourcent} %
        </span>
      </div>
      {/* La piste suit `--faint`, jamais `--border` : sur les thèmes plats une
          bordure vaut un point du fond, et cette piste porte une information. */}
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-faint/25">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            teinte === 'success' ? 'bg-success' : teinte === 'warning' ? 'bg-warning' : 'bg-en-cours',
          )}
          style={{ width: `${avancement.pourcent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * LE CHIFFRE D'UNE BRANCHE, posé au bout de sa ligne : une pastille et une
 * micro-barre. Une branche ÉCARTÉE n'en a pas — elle n'avance plus, et lui
 * donner un chiffre la ferait passer pour en route.
 */
function PourcentDeLaBranche({ tache, etapes }: { tache: TacheDuLot; etapes: readonly EtapePourAvancement[] }) {
  const avancement = avancementDeLaBranche(tache.etat, etapes);
  if (!avancement) return null;
  const teinte = avancement.termine ? 'text-success' : 'text-en-cours';
  return (
    <span className="flex shrink-0 items-center gap-1.5" data-avancement-branche={avancement.pourcent}>
      <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-faint/25 sm:block">
        <span
          className={cn('block h-full rounded-full', avancement.termine ? 'bg-success' : 'bg-en-cours')}
          style={{ width: `${avancement.pourcent}%` }}
        />
      </span>
      <span className={cn('w-[38px] text-right text-[11px] font-medium tabular-nums', teinte)}>
        {avancement.pourcent} %
      </span>
    </span>
  );
}

/**
 * OÙ EN EST CHAQUE TÂCHE DU LOT — en tête du tiroir, avant les six étapes.
 *
 * Le déroulé racontait le PARCOURS et le compte de cartes ne disait qu'un
 * NOMBRE : devant un lot de dix, il fallait déplier la fusion et lire son fil
 * ligne à ligne pour savoir laquelle était passée et laquelle venait d'être
 * écartée. C'est désormais la première chose qu'on voit, une ligne par tâche.
 *
 * Rien à déplier : cette liste MONTRE. Sa seule commande est le secours d'une
 * carte ÉCARTÉE — la phrase qui nomme le heurt, l'état de son rattrapage et
 * le bouton « Réconcilier » (`LigneDEcart`).
 */
export function TachesDuLot({
  taches,
  etapes,
  runId,
}: {
  taches: TacheDuLot[];
  /** Les étapes de la publication : ce qui suit la fusion compte dans le chiffre de chaque branche. */
  etapes: readonly EtapePourAvancement[];
  /** La publication de ce lot : sans elle, aucun bouton « Réconcilier ». */
  runId?: string;
}) {
  const resume = resumeDuLot(taches);

  return (
    <section className="mb-2 rounded-md border border-border bg-raised p-2" data-taches-du-lot>
      <div className="flex items-baseline justify-between gap-2 px-0.5 pb-1">
        <h3 className="text-[12px] font-medium text-muted">{t('Les tâches du lot')}</h3>
        {resume ? (
          <span className="shrink-0 text-[11px] text-faint" data-resume-du-lot>
            {resume}
          </span>
        ) : null}
      </div>
      <ul className="space-y-0.5">
        {taches.map((tache) => (
          <li key={tache.cardId} className="px-0.5 py-[3px]" data-tache-du-lot={tache.cardId} data-etat-tache={tache.etat}>
            <div className="flex items-center gap-2">
              <span className="shrink-0">
                <IconeTache etat={tache.etat} />
              </span>
              <span className="flex-1 truncate text-[12.5px] text-text" title={tache.titre}>
                {tache.titre}
              </span>
              <span
                className={cn(
                  'shrink-0 text-[11px]',
                  natureDeLEtat(tache.etat) === 'ecart' ? 'text-warning' : 'text-faint',
                )}
                data-libelle-tache={tache.etat}
              >
                {t(LIBELLE_ETAT_TACHE[tache.etat])}
              </span>
              <PourcentDeLaBranche tache={tache} etapes={etapes} />
            </div>
            {tacheReconciliable(tache) ? <LigneDEcart tache={tache} runId={runId} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * UNE CARTE ÉCARTÉE DIT CONTRE QUOI, OÙ EN EST SON RATTRAPAGE, ET OFFRE LE
 * SECOURS. La phrase vient de la publication (`mentionDeLEcartement`) ; l'état
 * est corrigé par la colonne réelle de la carte (`etatAfficheDuRattrapage`) ;
 * le bouton appelle la MÊME fonction que le rattrapage automatique, et dit dès
 * le clic qu'il part.
 */
function LigneDEcart({ tache, runId }: { tache: TacheDuLot; runId?: string }) {
  const state = useApp();
  const carte = state.cards[tache.cardId];
  const [envoi, setEnvoi] = React.useState(false);
  const etat = etatAfficheDuRattrapage(tache.rattrapage, carte);
  const bouton = !!runId && reconciliationALaMain(tache, carte?.column);
  const reconcilier = async () => {
    if (!runId) return;
    setEnvoi(true);
    await client.geste({ type: 'deploy.reconcilier', runId, cardId: tache.cardId }, t('Réconcilier'));
    setEnvoi(false);
  };
  const teinte =
    etat === 'revenu' ? 'text-success' : etat === 'lance' ? 'text-en-cours' : etat === 'echec' ? 'text-warning' : 'text-muted';
  return (
    <div className="ml-6 mt-0.5 space-y-1" data-ecart-de-tache={tache.cardId}>
      {tache.detail ? (
        <p className="select-text break-words text-[11.5px] leading-snug text-faint" data-phrase-ecart>
          {tache.detail}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {etat ? (
          <span className={cn('text-[11px]', teinte)} data-rattrapage={etat}>
            {t(LIBELLE_RATTRAPAGE[etat])}
            {tache.rattrapage?.detail && (etat === 'echec' || etat === 'sans-objet') ? ` — ${tache.rattrapage.detail}` : ''}
          </span>
        ) : null}
        {bouton ? (
          <Button size="sm" variant="outline" disabled={envoi} onClick={() => void reconcilier()} data-bouton-reconcilier>
            {envoi ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />}{' '}
            {envoi ? t('Réconciliation en route…') : t('Réconcilier')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function DeployControls({ run, actions = true }: { run: DeployRun; actions?: boolean }) {
  const [, force] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => {
    if (run.state !== 'running') return;
    const timer = setInterval(force, 1000);
    return () => clearInterval(timer);
  }, [run.state]);

  const libelleEtape = etapeDePublication(run.cible).libelle;

  return (
    <div className="mt-3 rounded-md border border-border bg-raised p-2.5" data-etape-run={run.cible ?? 'dev'}>
      {/* Le compte rendu NOMME son étape : un déploiement en cours ne se lit
          pas comme une mise en production. */}
      {run.state === 'running' ? (
        <p className="flex items-center gap-1.5 text-[12px] text-faint">
          <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" /> {t('En cours depuis')} {elapsed(run.startedAt)}
        </p>
      ) : run.state === 'success' ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted" data-publication-terminee>
          <Check className="h-3 w-3 shrink-0 text-success" /> {t('Publié (')}
          {libelleEtape}) : {run.cardIds.length} {t('tâche(s)')}
        </p>
      ) : (
        (() => {
          /* CASSÉE, SATURÉE ou seulement INTERROMPUE ? Le rouge d'alerte est
             réservé au code qui ne passe pas ; une coupure (redémarrage, arrêt
             demandé) se dit en orange avec « Interrompue » ; une machine qui
             n'a rien pu lancer se dit en orange elle aussi, mais avec ses mots
             — le code n'a même pas été jugé. La nature se lit sur une étape
             RÉELLEMENT tombée, jamais sur `currentStep`. */
          const etapeTombee = run.steps.find((step) => step.state === 'failed')?.key ?? null;
          const nature = natureDePublication({ etat: run.state, etapeTombee, motif: run.error });
          const cassee = nature === 'cassee';
          const titre = cassee ? t('Échec') : nature === 'saturee' ? t('Serveur saturé') : t('Interrompue');
          return (
            <p className={cn('flex items-start gap-1.5 text-[13px]', cassee ? 'text-danger' : 'text-warning')}>
              {cassee ? (
                <X className="mt-[3px] h-3 w-3 shrink-0" />
              ) : (
                <AlertTriangle className="mt-[3px] h-3 w-3 shrink-0" />
              )}{' '}
              {titre} ({libelleEtape}) : {run.error ?? t('étape interrompue')}
            </p>
          );
        })()
      )}

      {run.repriseApresCoupure ? (
        <p className="mt-1 text-[12px] text-faint" data-reprise-coupure>
          {t('Reprise après une coupure du serveur.')}
        </p>
      ) : null}

      {/* Ce qui a bronché SANS empêcher la mise en ligne — une carte qu'on n'a
          pas pu ranger après coup. En orange d'attente, jamais en rouge. */}
      {run.avertissement ? (
        <p className="mt-1 text-[12px] text-warning texte-copiable" data-avertissement-publication>
          {run.avertissement}
        </p>
      ) : null}

      {run.queued ? (
        <p className="mt-1 text-[12px] text-warning">{t('Une publication est en attente : elle partira ensuite.')}</p>
      ) : null}

      {run.url ? (
        <a
          href={run.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 block truncate text-[12px] text-muted underline underline-offset-2"
        >
          {run.url}
        </a>
      ) : null}

      {/* Un bouton de décision prend toute la largeur du bloc. Une publication
          rouverte depuis un groupe de cartes n'en porte aucun : on la relit. */}
      {actions ? (
        <div className="mt-2">
          {run.state === 'running' ? (
            <Button
              size="pied"
              variant="outline"
              onClick={() => void client.geste({ type: 'deploy.stop', runId: run.id }, t('Arrêter'))}
            >
              <Square className="h-2.5 w-2.5 fill-current" /> {t('Arrêter')}
            </Button>
          ) : run.state !== 'success' ? (
            <Button
              size="pied"
              variant="outline"
              onClick={() => void client.geste({ type: 'deploy.retry', runId: run.id }, t('Relancer'))}
            >
              <RotateCcw className="h-2.5 w-2.5" /> {t('Relancer')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
