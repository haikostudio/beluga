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
  avancementDeLaBranche,
  avancementDuFlux,
  ecartDepuisLeDebut,
  etapeDePublication,
  filDeLEtape,
  heureDeLEvenement,
  heureExacte,
  mentionDesReprises,
  natureDeLEtat,
  natureDePublication,
  resumeDuFil,
  resumeDuLot,
  titreDeLaPublication,
  type AvancementDuFlux,
  type EtapePourAvancement,
  type EtatDeTache,
  type GenreDEvenement,
  type TacheDuLot,
} from '@haikodev/shared';
import { Button, DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { Chat } from '@/components/chat';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, elapsed, relativeTime } from '@/lib/utils';
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
 * LA DATE SOUS LE MESSAGE : l'heure du moment, posée SOUS le texte qu'elle
 * date — jamais dans la colonne des ronds, qui est réservée aux TRAITS de la
 * timeline (une date glissée là les coupait). Un moment du fil la donne à la
 * SECONDE, une étape à la minute ; l'ancienneté (« il y a 2 min ») reste en
 * infobulle, et l'écart depuis le début de l'étape suit l'heure.
 */
function DateSousLeMessage({
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
function IconeMoment({ genre }: { genre: GenreDEvenement }) {
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
function bordureRondMoment(genre: GenreDEvenement): string {
  if (genre === 'depannage') return 'border-warning/60';
  if (genre === 'issue') return 'border-success/60';
  return 'border-border';
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
function AvancementDuFluxEnTete({ avancement }: { avancement: AvancementDuFlux }) {
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
 * OÙ EN EST CHAQUE TÂCHE DU LOT — en tête du tiroir, avant les sept étapes.
 *
 * Le déroulé racontait le PARCOURS et le compte de cartes ne disait qu'un
 * NOMBRE : devant un lot de dix, il fallait déplier la fusion et lire son fil
 * ligne à ligne pour savoir laquelle était passée et laquelle venait d'être
 * écartée. C'est désormais la première chose qu'on voit, une ligne par tâche.
 *
 * Rien à déplier, rien à cliquer : cette liste MONTRE, elle ne décide de rien.
 */
function TachesDuLot({
  taches,
  etapes,
}: {
  taches: TacheDuLot[];
  /** Les étapes de la publication : ce qui suit la fusion compte dans le chiffre de chaque branche. */
  etapes: readonly EtapePourAvancement[];
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
            <PourcentDeLaBranche tache={tache} etapes={etapes} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * UNE LIGNE DE LA TIMELINE : son rond sur la ligne centrale, relié au suivant
 * par un trait continu, et à droite ce qu'elle porte.
 *
 * Sert aux ÉTAPES (grand rond) COMME aux MOMENTS de leur fil une fois ouvert
 * (petit rond) : c'est la MÊME ligne verticale qui les traverse tous, du
 * premier au dernier événement de la publication — plus seulement les sept
 * étapes majeures. Un « Enregistrement… » ou une « Branche 1 sur 1… » porte
 * donc, lui aussi, son rond coloré et son icône sur cette ligne.
 */
function LigneTimeline({
  taille,
  bordure,
  icone,
  dernier,
  attrs,
  children,
}: {
  taille: 'grande' | 'petite';
  bordure: string;
  icone: React.ReactNode;
  /** La dernière ligne affichée ne tire plus de trait vers le bas. */
  dernier: boolean;
  attrs?: Record<string, string | undefined>;
  children: React.ReactNode;
}) {
  const grande = taille === 'grande';
  return (
    <li className="relative flex gap-3" {...attrs}>
      <div className="relative flex w-7 shrink-0 flex-col items-center">
        {!dernier ? (
          <span
            className={cn(
              /* Le trait suit `--faint`, PAS `--border` : sur les thèmes plats
                 la bordure vaut un point du fond, donc un fil de 1 px y était
                 purement invisible — or ce trait porte une information (à
                 quelle étape ce moment appartient). Même corollaire que
                 l'ascenseur. */
              'absolute left-1/2 bottom-[-1rem] w-px -translate-x-1/2 bg-faint/30',
              grande ? 'top-7' : 'top-5',
            )}
            aria-hidden="true"
          />
        ) : null}
        <span
          className={cn(
            'relative z-10 flex shrink-0 items-center justify-center rounded-full border-2 bg-surface',
            grande ? 'h-7 w-7' : 'h-5 w-5',
            bordure,
          )}
        >
          {icone}
        </span>
      </div>
      <div className={cn('min-w-0 flex-1 overflow-hidden rounded-md', !dernier && (grande ? 'pb-4' : 'pb-2'))}>
        {children}
      </div>
    </li>
  );
}

/**
 * UN MOMENT DU FIL, une fois l'étape ouverte : son propre rond, petit, sur la
 * ligne verticale de ses semblables. L'HEURE et l'ÉCART depuis le début se
 * lisent SOUS le message, comme la date d'un message du fil — jamais dans la
 * colonne des ronds, qu'ils couperaient ; la COMMANDE se lit à part, dans un
 * encart.
 */
function MomentDuFil({
  moment,
  depuis,
  dernier,
  onOuvrirAgent,
}: {
  moment: { evenement: { at: number } | null; texte: string; genre: GenreDEvenement; agentId?: string };
  depuis?: number;
  dernier: boolean;
  /** Un moment de dépannage porte l'agent qui l'a écrit : cliquer l'ouvre. */
  onOuvrirAgent?: (agentId: string) => void;
}) {
  const ecart = moment.evenement ? ecartDepuisLeDebut(moment.evenement.at, depuis) : null;
  const agentId = moment.genre === 'depannage' ? moment.agentId : undefined;
  const texte = (
    <span
      className={cn(
        'block whitespace-pre-wrap texte-copiable',
        moment.genre === 'commande'
          ? 'rounded bg-raised px-1.5 py-1 font-mono text-[11.5px] text-muted'
          : moment.genre === 'depannage'
            ? cn('text-warning', agentId && 'underline underline-offset-2')
            : 'text-muted',
      )}
    >
      {moment.texte}
    </span>
  );
  return (
    <LigneTimeline
      taille="petite"
      bordure={bordureRondMoment(moment.genre)}
      icone={<IconeMoment genre={moment.genre} />}
      dernier={dernier}
      attrs={{ 'data-moment-fil': moment.genre }}
    >
      <div className="px-1.5 py-0.5 text-[12px] leading-snug">
        {agentId ? (
          <button
            type="button"
            onClick={() => onOuvrirAgent?.(agentId)}
            className="text-left hover:opacity-80"
            data-moment-agent={agentId}
          >
            {texte}
          </button>
        ) : (
          texte
        )}
      </div>
      <DateSousLeMessage at={moment.evenement?.at} ecart={ecart} />
    </LigneTimeline>
  );
}

/**
 * UNE ÉTAPE DU TIROIR : son grand rond sur la ligne centrale, sa ligne de
 * titre, et — une fois ouverte — chacun de ses moments à la suite, sur la
 * MÊME ligne, avec son propre petit rond.
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
  onOuvrirAgent,
}: {
  cle: DeployStepKey;
  etape?: EtapeRun;
  ouverte: boolean;
  onBasculer: () => void;
  /** La dernière étape affichée ne tire plus de trait vers le bas. */
  dernier: boolean;
  onOuvrirAgent?: (agentId: string) => void;
}) {
  const etat: EtatEtape = etape?.state ?? 'todo';
  const duree = dureeEtape(etape);
  const fil = etape ? filDeLEtape(etape) : [];
  const resume = resumeDuFil(etape?.journal);
  /* Une fois ouverte, l'étape traîne ses moments — et, si elle est tombée,
     son motif — comme autant de LIGNES qui continuent la même timeline. La
     dernière de ces lignes hérite du trait de l'étape elle-même. */
  const avecLog = ouverte && etat === 'failed' && !!etape?.log;
  const totalSuite = ouverte ? fil.length + (avecLog ? 1 : 0) : 0;

  return (
    <>
      <LigneTimeline
        taille="grande"
        bordure={bordureRond(etat)}
        icone={<IconeEtape etat={etat} />}
        dernier={totalSuite === 0 ? dernier : false}
        attrs={{ 'data-etape-process': cle, 'data-etat-process': etat }}
      >
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

        {/* DEPUIS QUAND : l'ancienneté de l'étape se lit sous sa ligne de
            titre, du même œil que la date d'un message. */}
        <DateSousLeMessage at={etape?.startedAt} precision="minute" repere="etape" />

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
          <div className="mt-1 rounded-md border border-border bg-raised/40 px-2.5 py-2">
            <p className="text-[12px] text-faint" data-description-etape={cle}>
              {STEP_DESCRIPTIONS[cle]}
            </p>
            {!fil.length ? (
              <p className="mt-1 text-[12px] text-faint" data-fil-vide={cle}>
                {etat === 'todo'
                  ? t('Cette étape n’a pas encore commencé.')
                  : t('Cette étape n’a rien eu à raconter.')}
              </p>
            ) : null}
          </div>
        ) : null}
      </LigneTimeline>

      {/* LE FIL : chaque moment, à son heure, dans l'ordre, avec son propre
          rond sur la même ligne verticale que l'étape — c'est ce qu'on vient
          chercher, le journal du serveur n'a plus à être ouvert. Le repère
          `data-fil-etape` enveloppe le groupe sans occuper de place
          (`display: contents`) : les ronds restent alignés sur la colonne
          commune de toute la timeline. */}
      {/* Les moments d'une étape sont ses SOUS-ACTIONS : un retrait net à
          gauche les distingue d'un coup d'œil des étapes principales, sur
          leur propre ligne verticale — le SECOND niveau, tiré par le rond de
          chaque moment. Le trait du PREMIER niveau, lui, continue derrière
          elles dans l'axe des ronds d'étape : il dit à quelle étape ce bloc
          appartient, et rejoint l'étape suivante quand il y en a une. */}
      {ouverte && (fil.length || avecLog) ? (
        <li className={cn('relative pl-8', !dernier && 'pb-4')} data-sous-actions={cle}>
          <span
            className={cn('absolute left-[13.5px] top-0 w-px bg-faint/30', dernier ? 'bottom-0' : 'bottom-[-1rem]')}
            aria-hidden="true"
          />
          <ul data-fil-etape={cle}>
            {fil.map((moment, i) => (
              <MomentDuFil
                key={i}
                moment={moment}
                depuis={etape?.startedAt}
                dernier={i === fil.length - 1 && !avecLog ? dernier : false}
                onOuvrirAgent={onOuvrirAgent}
              />
            ))}

            {/* Un échec garde son motif, en entier ou presque, comme
                dernière ligne de la timeline de cette étape : c'est là qu'on
                lit ce qui a bloqué. */}
            {avecLog ? (
              <LigneTimeline
                taille="petite"
                bordure="border-danger/60"
                icone={<X className="h-2.5 w-2.5 text-danger" />}
                dernier={dernier}
              >
                <p className="whitespace-pre-wrap rounded-md bg-raised px-1.5 py-1 text-[11.5px] leading-snug text-faint texte-copiable">
                  {motifLisible(etape!.log!)}
                </p>
              </LigneTimeline>
            ) : null}
          </ul>
        </li>
      ) : null}
    </>
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
  const state = useApp();
  const [ouvertes, setOuvertes] = React.useState<Set<DeployStepKey>>(new Set());
  /* L'agent de dépannage OUVERT depuis une ligne « CONFLIT… » : un second
     tiroir, empilé au-dessus de celui-ci, avec sa conversation en direct. */
  const [agentOuvert, setAgentOuvert] = React.useState<string | null>(null);
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
  /* LE CHIFFRE DE TOUT LE FLUX, calculé sur la publication réelle : sans
     publication, il n'y a rien à chiffrer — et on n'invente pas un « 0 % ». */
  const avancement = run ? avancementDuFlux(run) : null;

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
          {/* OÙ EN EST TOUT LE FLUX : posé DANS l'en-tête, donc toujours
              visible — c'est le premier coup d'œil, il ne doit pas partir
              avec le défilement. */}
          {avancement ? <AvancementDuFluxEnTete avancement={avancement} /> : null}
        </div>

        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-2 pb-4">
          {/* CE QU'ON VIENT VOIR EN PREMIER : où en est chaque tâche du lot.
              Une publication d'avant cette liste n'en a pas — on n'en invente
              alors aucune, et le tiroir s'ouvre sur ses étapes comme avant. */}
          {run?.taches?.length ? <TachesDuLot taches={run.taches} etapes={run.steps} /> : null}
          <ul data-processus-etapes>
            {affichees.map((cle, i) => (
              <EtapeDuTiroir
                key={cle}
                cle={cle}
                etape={run?.steps.find((step) => step.key === cle)}
                ouverte={ouvertes.has(cle)}
                onBasculer={() => basculer(cle)}
                dernier={i === affichees.length - 1}
                onOuvrirAgent={setAgentOuvert}
              />
            ))}
          </ul>
          {controls}
        </ZoneDefilement>
      </div>

      {/* LE TIROIR DE L'AGENT DE DÉPANNAGE, empilé au-dessus : sa conversation
          et son avancement, en direct, sans quitter celui de la publication.
          Il n'a pas de `cardId` — cet agent n'est jamais celui d'une carte
          (`docs/regles/publication.md`) — le mécanisme générique `agent.open`
          suffit, le même que pour toute conversation d'agent. */}
      <Drawer open={!!agentOuvert} onClose={() => setAgentOuvert(null)} empile>
        {agentOuvert ? (
          <div className="flex min-h-0 flex-1 flex-col" data-tiroir-depannage>
            <div className="shrink-0 px-4 pb-2">
              <DialogTitle className="text-[15.5px] font-semibold text-text">
                {t('Agent de dépannage')}
              </DialogTitle>
              <p className="mt-0.5 text-[12.5px] text-faint">
                {t('Le conflit de fusion se résout ici, en direct.')}
              </p>
            </div>
            <Chat agent={state.agents[agentOuvert] ?? null} projectId={run?.projectId ?? ''} />
          </div>
        ) : null}
      </Drawer>
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
