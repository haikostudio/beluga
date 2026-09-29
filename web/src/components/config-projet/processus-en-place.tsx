import * as React from 'react';
import {
  AlertTriangle,
  Box,
  CircleCheck,
  GitBranch,
  GitMerge,
  Github,
  Globe,
  Hammer,
  PackageCheck,
  RotateCw,
  Server,
  SquareTerminal,
  UploadCloud,
} from 'lucide-react';
import {
  adresseVisee,
  brancheImposee,
  etapesDuDerouleCommun,
  explicationDuProcessus,
  genreDeLEtape,
  processusDeLEtape,
  reglagesChangesDepuisLeProcessus,
  type CiblePublication,
  type GenreDEtapeDuProcessus,
  type Project,
  type ReglageChange,
} from '@beluga/shared';
import { BulleInfo } from '@/components/ui';
import { MESURES_DU_FLUX } from '@/components/mesures-du-flux';
import { useTelephone } from '@/lib/telephone';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { EtudeRepliee } from './etude-repliee';

/** L'icône du rond, selon ce que fait l'étape (`genreDeLEtape`). */
const ICONE_DU_GENRE: Record<GenreDEtapeDuProcessus, React.ComponentType<{ className?: string }>> = {
  fusion: GitMerge,
  envoi: UploadCloud,
  github: Github,
  construction: Hammer,
  installation: PackageCheck,
  service: RotateCw,
  controle: CircleCheck,
  distant: Server,
  conteneur: Box,
  commande: SquareTerminal,
};

/** Un point du flux : son titre, sa phrase, sa commande exacte. */
type PointDuProcessus = {
  genre: GenreDEtapeDuProcessus;
  titre: string;
  description?: string;
  commande?: string;
};

/**
 * LE PROCESSUS EN FLUX, DESSINÉ COMME LE FIL D'UN AGENT (demande du
 * 29/09/2026) : un GRAND ROND à icône par étape, une ligne verticale continue
 * centrée sur les ronds, le titre puis sa description à droite. Mesures et
 * écart repris de `mesures-du-flux.ts`, les mêmes que le fil d'une carte et le
 * suivi d'une mise en ligne. Les ronds sont neutres : rien n'a encore tourné,
 * c'est un processus à lire, pas un déroulé.
 */
function FluxDuProcessus({ points }: { points: PointDuProcessus[] }) {
  const telephone = useTelephone();
  const mesures = telephone ? MESURES_DU_FLUX.telephone : MESURES_DU_FLUX.ordinateur;
  const centre = 12 + (telephone ? 32 : 40) / 2;
  return (
    <ol className="flex flex-col" data-flux-processus={points.length}>
      {points.map((point, rang) => {
        const Icone = ICONE_DU_GENRE[point.genre];
        const premier = rang === 0;
        const dernier = rang === points.length - 1;
        return (
          <li key={rang} className={cn('relative py-3', mesures.decalage)} data-point-processus={point.genre}>
            {premier && dernier ? null : (
              <span
                className={cn('absolute w-px bg-faint/40', mesures.ligne)}
                style={premier ? { top: centre, bottom: 0 } : dernier ? { top: 0, height: centre } : { top: 0, bottom: 0 }}
                aria-hidden
                data-trait-processus
              />
            )}
            <span
              className={cn(
                'fond-de-zone absolute left-0 top-3 flex items-center justify-center rounded-full border-2 border-faint/60',
                mesures.rond,
              )}
              aria-hidden
              data-rond-processus
            >
              <Icone className={cn(mesures.icone, 'text-muted')} />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[14px] font-semibold leading-snug text-text" data-titre-point-processus>
                {point.titre}
              </p>
              {point.description ? (
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{point.description}</p>
              ) : null}
              {point.commande ? (
                <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11.5px] text-faint">
                  {point.commande}
                </code>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Le nom affichable d'un réglage changé depuis l'écriture du processus. */
function nomDuReglage(reglage: ReglageChange): string {
  if (reglage === 'adresse') return t('adresse');
  if (reglage === 'port') return t('port');
  if (reglage === 'branche') return t('branche');
  if (reglage === 'commande') return t('commande de mise à jour');
  return t('services à relancer');
}

/**
 * LE PROCESSUS EN PLACE, LISIBLE D'UN COUP D'ŒIL — dans la rubrique de son
 * étape (demande du 29/09/2026).
 *
 * Il vivait replié dans l'onglet « Configuration » du tiroir, sans adresse ni
 * date : impossible de juger s'il était bon et toujours à jour. Il se lit
 * désormais DÉPLIÉ, en tête : l'adresse visée (déclarée par l'agent, sinon
 * celle des réglages), la branche, l'explication de l'agent, chaque étape avec
 * sa commande exacte, la date d'écriture — et « à revérifier » quand un réglage
 * qui le décide a changé depuis (`reglagesChangesDepuisLeProcessus`).
 *
 * Déploiement sans processus : le DÉROULÉ COMMUN est montré, étape par étape,
 * puisque c'est lui qui s'applique. Production sans processus : rien ne peut
 * partir, et le bloc le dit.
 *
 * Les valeurs affichées sont celles du projet ENREGISTRÉ : un champ en cours
 * de saisie ne compte qu'une fois enregistré, comme pour le déploiement.
 */
export function ProcessusEnPlace({
  projet,
  cible,
  branche,
}: {
  projet: Project;
  cible: CiblePublication;
  /** La branche réglée (vide = la branche imposée de l'étape). */
  branche?: string;
}) {
  const processus = processusDeLEtape(projet, cible);
  const brancheEffective = branche?.trim() || brancheImposee(cible);
  const { adresse, declaree } = adresseVisee(processus, projet, cible);
  const changes = processus ? reglagesChangesDepuisLeProcessus(processus, projet, cible) : [];

  if (!processus && cible === 'production') {
    return (
      <section className="rounded-lg bg-raised/35 px-3 py-2.5" data-processus-en-place="production" data-processus-absent>
        <p className="text-[13px] leading-snug text-muted" data-procedure-absente="production">
          {t('Ce projet n’a pas encore de processus de mise en production : rien ne peut partir tant qu’il n’est pas configuré.')}
        </p>
      </section>
    );
  }

  const ecritLe = processus?.ecritLe
    ? new Date(processus.ecritLe).toLocaleString(formatRegional(), { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const { texte: explication } = explicationDuProcessus(processus);
  const points: PointDuProcessus[] = processus
    ? processus.etapes.map((etape) => ({
        genre: genreDeLEtape(etape),
        titre: etape.libelle,
        description: t('{n} s au plus', { n: String(etape.delaiS) }),
        commande: etape.commande,
      }))
    : etapesDuDerouleCommun(projet, brancheEffective).map((etape) => ({
        genre: etape.genre,
        titre: t(etape.libelle, etape.valeurs),
        description: t(etape.description, etape.valeurs),
        commande: etape.commande,
      }));

  return (
    <section
      className="space-y-2.5"
      /* Le rond perce la ligne avec le fond de la ZONE : ici, la surface de la
         fenêtre de réglages. */
      style={{ ['--fond-zone' as string]: 'var(--surface)' }}
      data-processus-en-place={cible}
      data-processus-origine={processus ? 'agent' : 'commun'}
      data-processus-a-revoir={changes.length ? changes.join(' ') : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="text-[13.5px] font-medium text-text">
          {processus ? t('Processus en place') : t('Déroulé commun en service')}
        </h4>
        {ecritLe ? (
          <span className="text-[12px] text-faint" data-processus-ecrit-le>
            {t('écrit le {date}', { date: ecritLe })}
          </span>
        ) : null}
        {!processus ? (
          <BulleInfo cote="start">
            {t('Aucun processus propre à ce projet n’est encore écrit : chaque déploiement suit le déroulé commun ci-dessous, réglé par les champs de cette rubrique. L’agent de configuration peut en écrire un propre à ce projet.')}
          </BulleInfo>
        ) : null}
      </div>

      {changes.length ? (
        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-warning" data-avertissement-processus>
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {t('À revérifier : réglage modifié depuis l’écriture du processus ({reglages}). Demandez à l’agent de le relire.', {
              reglages: changes.map(nomDuReglage).join(', '),
            })}
          </span>
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-2.5 gap-y-1 text-[12.5px]">
        <dt className="flex items-center gap-1 text-muted">
          <Globe className="h-3 w-3" />
          {t('Adresse visée')}
        </dt>
        <dd className="min-w-0 break-words text-text" data-processus-adresse={declaree ? 'agent' : 'reglages'}>
          {adresse ?? <span className="text-faint">{t('aucune')}</span>}
          {adresse && !declaree ? <span className="ml-1 text-faint">{t('(celle des réglages)')}</span> : null}
        </dd>
        <dt className="flex items-center gap-1 text-muted">
          <GitBranch className="h-3 w-3" />
          {t('Branche')}
        </dt>
        <dd className="min-w-0 break-words font-mono text-[12px] text-text" data-processus-branche>
          {brancheEffective}
        </dd>
      </dl>

      {processus && explication ? <EtudeRepliee texte={explication} /> : null}

      {processus && cible === 'dev' && projet.isSelf ? (
        <p className="text-[12.5px] leading-snug text-faint" data-processus-beluga>
          {t('Beluga Build garde son déroulé propre, avec ses gardes : jamais de redémarrage tant qu’une tâche ou une publication tourne. Ce processus se lit ici pour contrôle, il n’est pas joué à sa place.')}
        </p>
      ) : null}

      <div data-etapes-processus={points.length}>
        <FluxDuProcessus points={points} />
      </div>
    </section>
  );
}
