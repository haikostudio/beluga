import { UploadCloud } from 'lucide-react';
import { agentTientSonTour, type Agent, type EtatDeLInitialisation, type Project } from '@beluga/shared';
import { BandeauTravail } from '@/components/bandeau-travail';
import { PastilleProjet } from '@/components/pastille-projet';
import { Dot } from '@/components/ui';
import { ouvrirAgentDeConfiguration } from '@/lib/ouvrir-config-projet';
import { CLASSE_CADRE_SYSTEME } from '@/lib/gabarit-tableau';
import { t } from '@/lib/langue';
import { cn, relativeTime } from '@/lib/utils';

/**
 * LA VIGNETTE SPÉCIALE DE L'INITIALISATION DE LA MISE EN PRODUCTION.
 *
 * L'agent de configuration n'a ni carte ni branche (DEC-256) : ce n'est donc
 * PAS une carte, mais une vignette au style à part — bord et nuage BLEUS de la
 * mise en ligne, là où le dépannage est orange —, posée en tête de « En cours »
 * du tableau et parmi les agents sans carte des « Tableaux de bord », tant que
 * l'agent travaille ou attend une réponse. Une fois qu'il a fini, elle quitte
 * le tableau et passe 24 heures dans « Archiver » des Tableaux de bord, sans
 * point bleu ni aucun signal (`etatDeLaVignetteDInitialisation`, 06/10/2026).
 * Elle ne compte ni dans le compteur de la colonne, ni dans son avancement.
 *
 * Le clic ouvre le TIROIR de l'agent (`ouvrirAgentDeConfiguration`), d'où
 * qu'on vienne, sans passer par la fenêtre de réglages (30/09/2026). Elle
 * sert aux DEUX agents de configuration : déploiement et mise en production. Même règle que les autres
 * vignettes : l'ouverture est portée par le cadre, jamais par un `button` qui
 * contiendrait un texte replié.
 */
export function VignetteInitialisationProduction({
  agent,
  etat,
  projet,
  reconfiguration = false,
  avecProjet = false,
  formatCarte = false,
  cible = 'production',
}: {
  /** L'étape que l'agent configure. */
  cible?: 'dev' | 'production';
  agent: Agent;
  etat: EtatDeLInitialisation;
  projet?: Project;
  /** La procédure existe déjà : l'agent la reconfigure. */
  reconfiguration?: boolean;
  /** Le nom du projet en tête — utile hors du tableau d'un projet. */
  avecProjet?: boolean;
  /** Sur « Tableaux de bord » : cadre de carte Système, description et ancienneté, hauteur au contenu. */
  formatCarte?: boolean;
}) {
  const auTravail = agentTientSonTour(agent);
  /* Le tiroir de l'agent s'ouvre sur ce qu'il a rendu. */
  const ouvrir = () => ouvrirAgentDeConfiguration(agent.projectId, cible);
  const titreEtDescription = (
    <>
      <h3 className="line-clamp-2 min-w-0 break-words text-[14px] font-medium leading-snug text-text">
        <UploadCloud className="relative -top-px mr-1 inline h-[13px] w-[13px] align-middle text-publie" />
        {cible === 'dev'
          ? t('Configuration du déploiement')
          : reconfiguration
            ? t('Configuration de la mise en production')
            : t('Initialisation de la mise en production')}
      </h3>
      {formatCarte ? (
        <p data-description-carte className="mt-1 line-clamp-1 break-words text-[12.5px] leading-snug text-muted">
          {cible === 'dev'
            ? t('Prépare comment le projet se déploie sur ce serveur.')
            : t('Prépare comment le projet se met en production.')}
        </p>
      ) : null}
    </>
  );
  return (
    <div
      className="relative flex min-w-0 flex-col"
      data-vignette-initialisation-production={agent.projectId}
      data-vignette-etape={cible}
    >
      <div
        role="button"
        tabIndex={0}
        data-ouvrir-initialisation-production={agent.projectId}
        onClick={ouvrir}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          ouvrir();
        }}
        className={cn(
          formatCarte
            ? CLASSE_CADRE_SYSTEME
            : 'relative z-10 cursor-pointer rounded-md border border-publie/60 bg-raised px-2.5 py-2 transition-colors hover:border-publie',
          auTravail && 'rounded-b-none',
        )}
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
            <span className="min-w-0 truncate text-publie">{cible === 'dev' ? t('Déploiement') : t('Mise en production')}</span>
          </div>
          <span className="flex shrink-0 items-center gap-1" data-etat-vignette-initialisation={etat}>
            {etat === 'question' ? (
              <span className="text-warning">{t('attend votre réponse')}</span>
            ) : etat === 'fini' ? (
              <span className="text-faint">{agent.status === 'failed' ? t('échec') : t('terminé')}</span>
            ) : (
              <>
                <Dot tone="running" pulse />
                <span className={etat === 'demarre' ? 'text-faint' : 'text-en-cours'}>
                  {etat === 'demarre' ? t('démarre…') : t('Au travail')}
                </span>
              </>
            )}
          </span>
        </div>
        {formatCarte ? (
          <>
            <div className="min-w-0" data-corps-systeme>
              {titreEtDescription}
            </div>
            <div
              className={cn('mt-auto flex shrink-0 items-center text-[12px] text-faint', !auTravail && 'pb-1.5 pt-1')}
              data-anciennete-systeme={agent.projectId}
            >
              <span className="shrink-0">{relativeTime(auTravail ? agent.updatedAt : (agent.endedAt ?? agent.updatedAt))}</span>
            </div>
          </>
        ) : (
          titreEtDescription
        )}
      </div>
      {auTravail ? (
        <BandeauTravail agent={agent} onClick={ouvrir} data-barre-initialisation-production={agent.projectId} />
      ) : null}
    </div>
  );
}
