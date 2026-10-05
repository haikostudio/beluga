import { Rocket } from 'lucide-react';
import {
  descriptionDeLEtape,
  miseEnProductionNonLue,
  suiviDeLaPublication,
  type DeployRun,
  type Project,
} from '@beluga/shared';
import { BarreProgression } from '@/components/barre-progression';
import { PastilleProjet } from '@/components/pastille-projet';
import { PointNonLu } from '@/components/point-non-lu';
import { Dot } from '@/components/ui';
import { client } from '@/lib/client';
import { CLASSE_CADRE_SYSTEME, CLASSE_HAUTEUR_CARTE_EN_ROUTE, CLASSE_HAUTEUR_CORPS_EN_ROUTE } from '@/lib/gabarit-tableau';
import { t } from '@/lib/langue';
import { cn, relativeTime } from '@/lib/utils';

/**
 * LA CARTE SYSTÈME D'UNE MISE EN PRODUCTION (05/10/2026).
 *
 * Deux mises en production tournaient ensemble sans qu'aucune carte ne le
 * dise : seul le bandeau du bas du tableau de CHAQUE projet les montrait. Une
 * mise en production pose désormais sa carte à cadre VIOLET en tête de « En
 * cours » du tableau (une par projet du groupe sur le tableau d'un groupe) et
 * en tête de « Actifs » des « Tableaux de bord ». Elle dit le projet, l'étape
 * et l'avancement, puis RESTE une fois terminée — réussie, tombée ou arrêtée —,
 * point bleu allumé, jusqu'à ce qu'on l'ouvre ou qu'on clique sur le point
 * (`miseEnProductionAffichee`, `shared/src/cartes-systeme.ts`).
 *
 * Ce n'est PAS une carte : elle ne compte ni dans le compteur de sa colonne ni
 * dans son avancement. Un déploiement sur ce serveur n'en a pas — il a déjà sa
 * barre en tête de « À déployer ». L'ouverture est portée par le CADRE, jamais
 * par un `button` qui contiendrait un texte replié ; elle mène au suivi du
 * bandeau du bas (`onOpen`), et vaut lecture.
 */
export function VignetteMiseEnProduction({
  run,
  projet,
  onOpen,
  avecProjet = false,
  formatCarte = false,
}: {
  run: DeployRun;
  projet?: Project;
  /** Ouvre le suivi de cette mise en production. */
  onOpen: () => void;
  /** Le nom du projet en tête — utile hors du tableau d'un projet. */
  avecProjet?: boolean;
  /** Sur « Tableaux de bord » : hauteur fixe, description et ancienneté, comme une carte. */
  formatCarte?: boolean;
}) {
  const suivi = suiviDeLaPublication(run);
  const enCours = suivi.etat === 'en-cours';
  const tombee = suivi.etat === 'en-echec';
  const nonLue = miseEnProductionNonLue(run);
  const lire = () => client.send({ type: 'deploy.read', runId: run.id });
  const ouvrir = () => {
    if (nonLue) lire();
    onOpen();
  };
  const etape = suivi.etape ? t(descriptionDeLEtape(suivi.etape, 'production').libelle) : null;
  const titre = enCours
    ? t('Mise en production en cours')
    : suivi.etat === 'reussie'
      ? t('Mise en production terminée')
      : tombee
        ? t('Mise en production en échec')
        : t('Mise en production arrêtée');
  const description = enCours
    ? (etape ?? t('La version déjà déployée part chez le client.'))
    : suivi.etat === 'reussie'
      ? t('La version est partie chez le client.')
      : etape
        ? t('Arrêtée à l’étape « {etape} » : ouvrez le suivi pour voir pourquoi.', { etape })
        : t('Ouvrez le suivi pour voir ce qui s’est passé.');
  const titreEtDescription = (
    <>
      <h3 className="line-clamp-2 min-w-0 break-words text-[14px] font-medium leading-snug text-text">
        <Rocket className="relative -top-px mr-1 inline h-[13px] w-[13px] align-middle text-publie" />
        {titre}
      </h3>
      <p
        data-description-carte
        className={cn('mt-1 break-words text-[12.5px] leading-snug text-muted', formatCarte ? 'line-clamp-2' : 'line-clamp-1')}
      >
        {description}
      </p>
    </>
  );
  return (
    <div
      className={cn('relative flex min-w-0 flex-col', formatCarte && CLASSE_HAUTEUR_CARTE_EN_ROUTE)}
      data-vignette-mise-en-production={run.projectId}
      data-etat-vignette-production={suivi.etat}
    >
      {nonLue ? <PointNonLu onLire={lire} data-systeme-non-lu={run.id} /> : null}
      <div
        role="button"
        tabIndex={0}
        data-ouvrir-mise-en-production={run.projectId}
        onClick={ouvrir}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          ouvrir();
        }}
        className={
          formatCarte
            ? CLASSE_CADRE_SYSTEME
            : 'relative z-10 cursor-pointer overflow-hidden rounded-md border border-publie/60 bg-raised px-2.5 py-2 transition-colors hover:border-publie'
        }
      >
        <div className="mb-1 flex h-[18px] min-w-0 items-center gap-1.5 text-[12px]" data-tete-carte-en-route>
          <div className="flex min-w-0 flex-1 items-center gap-1.5" data-tete-gauche>
            {avecProjet ? (
              <>
                {projet ? <PastilleProjet project={projet} /> : null}
                <span className="min-w-0 truncate text-muted">{projet?.name ?? t('Projet inconnu')}</span>
                <span className="shrink-0 text-faint">·</span>
              </>
            ) : null}
            <span className="min-w-0 truncate text-publie">{t('Mise en production')}</span>
          </div>
          <span className="flex shrink-0 items-center gap-1" data-temoin-production={suivi.etat}>
            {enCours ? (
              <>
                <Dot tone="running" pulse />
                <span className="font-semibold tabular-nums text-en-cours" data-avancement-production={suivi.pourcent}>
                  {suivi.pourcent} %
                </span>
              </>
            ) : tombee ? (
              <span className="text-danger">{t('échec')}</span>
            ) : (
              <span className="text-faint">{suivi.etat === 'reussie' ? t('terminé') : t('arrêtée')}</span>
            )}
          </span>
        </div>
        {formatCarte ? (
          <>
            <div className={cn('shrink-0 overflow-hidden', CLASSE_HAUTEUR_CORPS_EN_ROUTE)}>{titreEtDescription}</div>
            <div className="mt-auto flex shrink-0 items-center pb-1.5 pt-1 text-[12px] text-faint" data-anciennete-systeme={run.projectId}>
              <span className="shrink-0">{relativeTime(run.endedAt ?? run.startedAt)}</span>
            </div>
          </>
        ) : (
          titreEtDescription
        )}
        {enCours || tombee ? (
          <BarreProgression
            className="absolute inset-x-0 bottom-0"
            pourcent={suivi.pourcent}
            erreur={tombee}
            teinte="en-cours"
            data-barre-vignette-production={run.projectId}
          />
        ) : null}
      </div>
    </div>
  );
}
