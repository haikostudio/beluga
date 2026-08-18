/*
 * LE TIROIR D'UNE PUBLICATION : ce qui s'est vraiment passé, étape par étape.
 *
 * Le déroulé d'avant tenait dans un petit panneau posé sous le bouton, en
 * superposition au-dessus des cartes : sept lignes, un état chacune, et rien de
 * plus. Il fallait ouvrir le journal du serveur pour savoir quelle branche
 * venait d'être fusionnée, quelle commande avait été lancée, ce qu'un agent de
 * dépannage avait tenté.
 *
 * C'est désormais un vrai TIROIR, celui du reste de l'application : il monte du
 * bas, occupe la place qu'il faut, et chaque étape s'y déplie sur son FIL
 * HISTORIQUE — chaque moment horodaté, dans l'ordre où il est arrivé.
 *
 * Le même tiroir sert DEUX moments, et c'est voulu : la publication qui tourne
 * (on la regarde avancer, on peut l'arrêter) et une publication PASSÉE, rouverte
 * depuis le groupe de cartes qu'elle a mises en ligne. Rien n'y est publié ni
 * relancé sans un geste : le tiroir montre, il ne décide pas.
 */

import * as React from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
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
  ecartDepuisLeDebut,
  etapeDePublication,
  filDeLEtape,
  heureDeLEvenement,
  mentionDesReprises,
  natureDeLEtat,
  natureDePublication,
  resumeDuFil,
  resumeDuLot,
  titreDeLaPublication,
  type EtatDeTache,
  type GenreDEvenement,
  type TacheDuLot,
} from '@haikodev/shared';
import { Button, Drawer, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { cn, duration, elapsed } from '@/lib/utils';
import { t } from '@/lib/langue';

/** L'ordre des sept étapes de la mise en ligne — le même que côté serveur. */
export const ORDRE_ETAPES: DeployStepKey[] = ['merge', 'commit', 'push', 'verify', 'build', 'publish', 'restart'];

export const STEP_LABELS: Record<DeployStepKey, string> = {
  merge: t('Fusion des branches'),
  commit: 'Enregistrement',
  push: t('Envoi sur le dépôt'),
  verify: 'Vérification du code',
  build: 'Construction',
  publish: t('Mise en ligne'),
  restart: t('Redémarrage du serveur'),
};

/**
 * Une phrase courte qui rappelle à quoi sert chaque étape. Elle s'affiche
 * maintenant EN CLAIR sous le titre de l'étape ouverte : dans un tiroir, la
 * place ne manque plus, et un « ? » à cliquer pour lire une ligne était un
 * geste de trop.
 */
export const STEP_DESCRIPTIONS: Record<DeployStepKey, string> = {
  merge: t('Les branches des cartes du lot sont réunies dans la branche principale.'),
  commit: t('Le résultat de la fusion est inscrit dans l\'historique du dépôt.'),
  push: t('Le code réuni est envoyé sur le dépôt distant.'),
  verify: t('Les contrôles du projet sont rejoués ; le moindre échec arrête la mise en ligne.'),
  build: t('Le projet est recompilé à partir du code réuni.'),
  publish: t('L\'instance de dev de ce serveur est rafraîchie avec la nouvelle version.'),
  restart: t('Le service est relancé pour servir la version fraîche.'),
};

type EtapeRun = DeployRun['steps'][number];
type EtatEtape = EtapeRun['state'];

/** L'état d'une étape, dit en français simple. */
const ETAT_LABELS: Record<EtatEtape, string> = {
  todo: t('à venir'),
  running: 'en cours',
  done: 'fait',
  failed: t('échoué'),
  skipped: t('sauté'),
};

/**
 * La DURÉE d'une étape terminée, en une poignée de signes. Les étapes rapides
 * (enregistrement, envoi) tiennent sous la seconde : on le dit plutôt que
 * d'afficher un tiret, qui se lirait comme « durée inconnue ».
 */
export function dureeEtape(etape?: EtapeRun): string | null {
  if (!etape?.startedAt || !etape.endedAt) return null;
  const secondes = (etape.endedAt - etape.startedAt) / 1000;
  return secondes < 1 ? '< 1 s' : duration(secondes);
}

/** L'icône posée dans le rond d'une étape, la même partout. */
export function IconeEtape({ etat }: { etat: EtatEtape }) {
  if (etat === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-en-cours" />;
  if (etat === 'done') return <Check className="h-3.5 w-3.5 text-success" />;
  if (etat === 'failed') return <X className="h-3.5 w-3.5 text-danger" />;
  if (etat === 'skipped') return <MinusCircle className="h-3.5 w-3.5 text-faint" />;
  return <span className="block h-1.5 w-1.5 rounded-full bg-faint" />;
}

/**
 * La COULEUR de bordure du rond, selon l'état de l'étape — la même convention
 * que le reste de l'application (orange pour ce qui est en cours, bleu pour ce
 * qui est terminé, rouge pour l'échec).
 */
function bordureRond(etat: EtatEtape): string {
  if (etat === 'running') return 'border-en-cours';
  if (etat === 'done') return 'border-success/60';
  if (etat === 'failed') return 'border-danger/60';
  if (etat === 'skipped') return 'border-border';
  return 'border-border';
}

/**
 * La DATE sous le rond : l'heure à laquelle l'étape a commencé, en quatre
 * chiffres — « 12:58 ». Une étape pas encore commencée n'en porte aucune.
 */
function dateSousLeRond(etape?: EtapeRun): string | null {
  if (!etape?.startedAt) return null;
  return heureDeLEvenement(etape.startedAt).slice(0, 5);
}

/**
 * L'icône d'un moment du fil. Elle ne dit qu'une chose : de quelle NATURE est
 * ce moment — une commande lancée, un dépannage, une issue. Le texte, lui, a
 * été écrit par celui qui a fait le geste et n'est jamais reformulé ici.
 */
function IconeMoment({ genre }: { genre: GenreDEvenement }) {
  if (genre === 'commande') return <Terminal className="h-3 w-3 text-faint" />;
  if (genre === 'depannage') return <Wrench className="h-3 w-3 text-warning" />;
  if (genre === 'issue') return <Check className="h-3 w-3 text-muted" />;
  if (genre === 'debut') return <ChevronRight className="h-3 w-3 text-faint" />;
  return <span className="mt-[5px] block h-1 w-1 rounded-full bg-faint" />;
}

/**
 * Le motif d'un échec, lisible. Le serveur écrit d'abord la raison en clair,
 * puis, s'il en a, les dernières lignes techniques : n'afficher que la fin
 * coupait justement la phrase qui explique.
 */
function motifLisible(log: string): string {
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
 * OÙ EN EST CHAQUE TÂCHE DU LOT — en tête du tiroir, avant les sept étapes.
 *
 * Le déroulé racontait le PARCOURS et le compte de cartes ne disait qu'un
 * NOMBRE : devant un lot de dix, il fallait déplier la fusion et lire son fil
 * ligne à ligne pour savoir laquelle était passée et laquelle venait d'être
 * écartée. C'est désormais la première chose qu'on voit, une ligne par tâche.
 *
 * Rien à déplier, rien à cliquer : cette liste MONTRE, elle ne décide de rien.
 */
function TachesDuLot({ taches }: { taches: TacheDuLot[] }) {
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
          <li
            key={tache.cardId}
            className="flex items-center gap-2 px-0.5 py-[3px]"
            data-tache-du-lot={tache.cardId}
            data-etat-tache={tache.etat}
          >
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
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * UNE ÉTAPE DU TIROIR : son ROND sur la ligne centrale, sa ligne de titre, et
 * dessous son fil quand elle est ouverte.
 *
 * La timeline verticale tient en deux colonnes : à gauche, le rond-icône de
 * l'étape avec sa date dessous, relié au rond suivant par un trait continu ;
 * à droite, le titre, l'état et le temps, puis le fil déplié. Les événements
 * du fil restent DANS cette colonne de droite, indentés sous leur étape — ils
 * ne rejoignent jamais la ligne centrale, réservée aux étapes majeures.
 *
 * Une étape s'ouvre d'un clic sur toute sa ligne — pas sur un « ? » minuscule.
 * Celle qui TRAVAILLE est ouverte d'office : c'est celle qu'on vient regarder.
 */
function EtapeDuTiroir({
  cle,
  etape,
  ouverte,
  onBasculer,
  dernier,
}: {
  cle: DeployStepKey;
  etape?: EtapeRun;
  ouverte: boolean;
  onBasculer: () => void;
  /** La dernière étape affichée ne tire plus de trait vers le bas. */
  dernier: boolean;
}) {
  const etat: EtatEtape = etape?.state ?? 'todo';
  const duree = dureeEtape(etape);
  const fil = etape ? filDeLEtape(etape) : [];
  const resume = resumeDuFil(etape?.journal);
  const date = dateSousLeRond(etape);

  return (
    <li className="relative flex gap-3" data-etape-process={cle} data-etat-process={etat}>
      {/* LA COLONNE DU ROND : l'icône dans son cercle, la date dessous, et le
          trait qui continue vers le rond suivant — la ligne centrale de la
          timeline. */}
      <div className="relative flex w-7 shrink-0 flex-col items-center">
        {!dernier ? (
          <span
            className="absolute left-1/2 top-7 bottom-[-1rem] w-px -translate-x-1/2 bg-border"
            aria-hidden="true"
          />
        ) : null}
        <span
          className={cn(
            'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-surface',
            bordureRond(etat),
          )}
          data-rond-etape={cle}
        >
          <IconeEtape etat={etat} />
        </span>
        {date ? (
          <span className="mt-1 text-[10px] tabular-nums text-faint" data-date-etape={cle}>
            {date}
          </span>
        ) : null}
      </div>

      <div className={cn('min-w-0 flex-1 overflow-hidden rounded-md', !dernier && 'pb-4')}>
        <button
          type="button"
          onClick={onBasculer}
          aria-expanded={ouverte}
          data-ouvrir-etape={cle}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-raised',
            ouverte && 'bg-raised',
          )}
        >
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', ouverte && 'rotate-90')} />
          <span className={cn('flex-1 truncate text-[13.5px] font-medium', etat === 'failed' ? 'text-danger' : 'text-text')}>
            {STEP_LABELS[cle]}
          </span>
          {/* Ce que l'étape a à raconter, avant même de l'ouvrir : sans ce
              compte, rien ne dit qu'il y a quelque chose derrière la ligne. */}
          {resume ? (
            <span className="shrink-0 text-[11px] text-faint" data-fil-compte={cle}>
              {resume}
            </span>
          ) : null}
          {/* LE TEMPS, à droite : l'état, puis la durée une fois l'étape
              passée. */}
          <span className="shrink-0 text-right text-[11px] tabular-nums text-faint" data-etat-etape={etat}>
            {ETAT_LABELS[etat]}
            {duree && (etat === 'done' || etat === 'failed') ? (
              <span data-duree-etape={cle}> · {duree}</span>
            ) : null}
            {mentionDesReprises(etape?.reprises) ? (
              <span data-reprises-etape={cle}> · {mentionDesReprises(etape?.reprises)}</span>
            ) : null}
          </span>
        </button>

        {/* PENDANT qu'une étape tourne, ce qu'elle fait à l'instant reste posé
            sous sa ligne, ouverte ou non : c'est le seul texte qu'on veut voir
            sans rien déplier. Une étape EN RETARD le dit en orange. */}
        {etat === 'running' && etape?.progress ? (
          <p
            className={cn('px-1.5 pb-1 pt-0.5 text-[12px]', etape.enRetard ? 'text-warning' : 'text-muted')}
            data-progress-etape={cle}
            data-etape-en-retard={etape.enRetard ? 'oui' : undefined}
          >
            {etape.progress}
          </p>
        ) : null}

        {ouverte ? (
          <div className="mt-1 rounded-md border border-border bg-raised/40 px-2.5 py-2.5" data-fil-etape={cle}>
            <p className="text-[12px] text-faint" data-description-etape={cle}>
              {STEP_DESCRIPTIONS[cle]}
            </p>

          {/* LE FIL : chaque moment, à son heure, dans l'ordre. C'est ce qu'on
              vient chercher — le journal du serveur n'a plus à être ouvert. Les
              moments sont GROUPÉS avec un trait vertical (l'indentation de
              l'étape) et chaque HEURE est alignée dans une même colonne à
              droite, lisible même en défilant loin de son titre. */}
          {fil.length ? (
            <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-2.5">
              {fil.map((moment, i) => {
                const ecart = moment.evenement ? ecartDepuisLeDebut(moment.evenement.at, etape?.startedAt) : null;
                return (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[12px] leading-snug"
                    data-moment-fil={moment.genre}
                  >
                    <span className="mt-[3px] shrink-0">
                      <IconeMoment genre={moment.genre} />
                    </span>
                    {/* La COMMANDE se lit à part, dans un encart — jamais mêlée
                        au texte courant du résultat ou de la progression. */}
                    <span
                      className={cn(
                        'min-w-0 flex-1 whitespace-pre-wrap texte-copiable',
                        moment.genre === 'commande'
                          ? 'rounded bg-raised px-1.5 py-1 font-mono text-[11.5px] text-muted'
                          : moment.genre === 'depannage'
                            ? 'text-warning'
                            : 'text-muted',
                      )}
                    >
                      {moment.texte}
                    </span>
                    {/* L'HEURE et l'ÉCART depuis le début, dans une colonne de
                        largeur fixe : ils restent alignés d'un moment à
                        l'autre, quelle que soit la longueur du texte. */}
                    {moment.evenement ? (
                      <span className="mt-[1px] flex w-[58px] shrink-0 flex-col items-end tabular-nums text-faint">
                        <span data-heure-moment>{heureDeLEvenement(moment.evenement.at)}</span>
                        {ecart ? <span>{ecart}</span> : null}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-faint" data-fil-vide={cle}>
              {etat === 'todo'
                ? t('Cette étape n’a pas encore commencé.')
                : t('Cette étape n’a rien eu à raconter.')}
            </p>
          )}

          {/* Un échec garde son motif, en entier ou presque : c'est là qu'on
              lit ce qui a bloqué. */}
          {etat === 'failed' && etape?.log ? (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-raised p-2 text-[11.5px] leading-snug text-faint texte-copiable">
              {motifLisible(etape.log)}
            </p>
          ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * LE TIROIR, avec en tête ce que la publication est et ce qu'elle a donné, puis
 * ses étapes.
 *
 * `controls` reçoit les commandes (« Arrêter », « Relancer ») : elles ne
 * paraissent que pour la publication VIVANTE du projet ouvert. Une publication
 * rouverte depuis un groupe de cartes n'en a pas — on la relit, on ne la
 * rejoue pas.
 */
export function TiroirDeploiement({
  open,
  onClose,
  run,
  sousTitre,
  controls,
  empile,
}: {
  open: boolean;
  onClose: () => void;
  /** La publication à raconter. Absente : les sept étapes « à venir ». */
  run?: DeployRun | null;
  /** Une ligne de contexte sous le titre (le lot embarqué, par exemple). */
  sousTitre?: string;
  controls?: React.ReactNode;
  empile?: boolean;
}) {
  const [ouvertes, setOuvertes] = React.useState<Set<DeployStepKey>>(new Set());
  /* L'étape QUI TRAVAILLE s'ouvre d'elle-même : c'est celle qu'on vient
     regarder. Une étape ouverte à la main ne se referme jamais toute seule —
     d'où le suivi de la dernière étape ouverte d'office. */
  const auto = React.useRef<DeployStepKey | null>(null);
  const enCours = run?.state === 'running' ? run.currentStep : undefined;
  /* Une publication TOMBÉE ouvre l'étape qui est tombée : c'est la seule chose
     qu'on veut lire en l'ouvrant. */
  const tombee = run?.steps.find((step) => step.state === 'failed')?.key;
  const aOuvrir = enCours ?? tombee;

  React.useEffect(() => {
    if (!open || !aOuvrir || auto.current === aOuvrir) return;
    auto.current = aOuvrir;
    setOuvertes((v) => new Set(v).add(aOuvrir));
  }, [open, aOuvrir]);

  const basculer = (cle: DeployStepKey) =>
    setOuvertes((v) => {
      const suite = new Set(v);
      if (suite.has(cle)) suite.delete(cle);
      else suite.add(cle);
      return suite;
    });

  /* Une étape SAUTÉE ne s'affiche pas : la liste ne montre que ce qui a
     réellement été fait. Sans publication, les sept restent « à venir ». */
  const affichees = ORDRE_ETAPES.filter(
    (cle) => run?.steps.find((step) => step.key === cle)?.state !== 'skipped',
  );
  const etape = etapeDePublication(run?.cible);

  return (
    <Drawer open={open} onClose={onClose} empile={empile}>
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-deploiement>
        <div className="shrink-0 px-4 pb-2">
          <h2 className="text-[15.5px] font-semibold text-text">
            {run ? titreDeLaPublication(etape.titreCourt, run.startedAt) : etape.libelle}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-faint">
            {sousTitre ??
              (run
                ? t('{v0} tâche(s) embarquée(s)', { v0: run.cardIds.length })
                : t('Le déroulé complet, étape par étape.'))}
          </p>
        </div>

        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-2 pb-4">
          {/* CE QU'ON VIENT VOIR EN PREMIER : où en est chaque tâche du lot.
              Une publication d'avant cette liste n'en a pas — on n'en invente
              alors aucune, et le tiroir s'ouvre sur ses étapes comme avant. */}
          {run?.taches?.length ? <TachesDuLot taches={run.taches} /> : null}
          <ul data-processus-etapes>
            {affichees.map((cle, i) => (
              <EtapeDuTiroir
                key={cle}
                cle={cle}
                etape={run?.steps.find((step) => step.key === cle)}
                ouverte={ouvertes.has(cle)}
                onBasculer={() => basculer(cle)}
                dernier={i === affichees.length - 1}
              />
            ))}
          </ul>
          {controls}
        </ZoneDefilement>
      </div>
    </Drawer>
  );
}

/**
 * Le compte rendu d'une publication et ses commandes : l'issue (réussite /
 * échec), l'attente d'un autre lot, l'adresse contrôlée, et le bouton
 * « Arrêter » ou « Relancer ». Il vit sous les étapes, dans le tiroir.
 */
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
          /* CASSÉE ou seulement INTERROMPUE ? Le rouge d'alerte est réservé au
             code qui ne passe pas ; une coupure (redémarrage, arrêt demandé) se
             dit en orange avec « Interrompue ». La nature se lit sur une étape
             RÉELLEMENT tombée, jamais sur `currentStep`. */
          const etapeTombee = run.steps.find((step) => step.state === 'failed')?.key ?? null;
          const cassee = natureDePublication({ etat: run.state, etapeTombee, motif: run.error }) === 'cassee';
          return (
            <p className={cn('flex items-start gap-1.5 text-[13px]', cassee ? 'text-danger' : 'text-warning')}>
              {cassee ? (
                <X className="mt-[3px] h-3 w-3 shrink-0" />
              ) : (
                <AlertTriangle className="mt-[3px] h-3 w-3 shrink-0" />
              )}{' '}
              {cassee ? t('Échec') : t('Interrompue')} ({libelleEtape}) : {run.error ?? t('étape interrompue')}
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
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => client.send({ type: 'deploy.stop', runId: run.id })}
            >
              <Square className="h-2.5 w-2.5 fill-current" /> {t('Arrêter')}
            </Button>
          ) : run.state !== 'success' ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => client.send({ type: 'deploy.retry', runId: run.id })}
            >
              <RotateCcw className="h-2.5 w-2.5" /> {t('Relancer')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
