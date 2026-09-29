import { UploadCloud } from 'lucide-react';
import { agentTientSonTour, type Agent, type EtatDeLInitialisation, type Project } from '@beluga/shared';
import { BandeauTravail } from '@/components/bandeau-travail';
import { PastilleProjet } from '@/components/pastille-projet';
import { Dot } from '@/components/ui';
import { ouvrirRubriqueDeLEtape } from '@/lib/ouvrir-config-projet';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LA VIGNETTE SPÉCIALE DE L'INITIALISATION DE LA MISE EN PRODUCTION.
 *
 * L'agent de configuration n'a ni carte ni branche (DEC-256) : ce n'est donc
 * PAS une carte, mais une vignette au style à part — bord et nuage BLEUS de la
 * mise en ligne, là où le dépannage est orange —, posée en tête de « En cours »
 * du tableau et parmi les agents sans carte des « Tableaux de bord », tant que
 * l'agent travaille ou attend une réponse (`vignetteDInitialisationVisible`).
 * Elle ne compte ni dans le compteur de la colonne, ni dans son avancement.
 *
 * Le clic ouvre la RUBRIQUE de son étape dans les réglages du projet, où
 * vit sa conversation (`ouvrirRubriqueDeLEtape`), d'où qu'on vienne. Elle
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
}) {
  const auTravail = agentTientSonTour(agent);
  const ouvrir = () => ouvrirRubriqueDeLEtape(agent.projectId, cible);
  return (
    <div className="flex min-w-0 flex-col" data-vignette-initialisation-production={agent.projectId} data-vignette-etape={cible}>
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
          'relative z-10 cursor-pointer rounded-md border border-publie/60 bg-raised px-2.5 py-2 transition-colors hover:border-publie',
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
              <span className="text-faint">{t('terminé')}</span>
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
        <h3 className="line-clamp-2 min-w-0 break-words text-[14px] font-medium leading-snug text-text">
          <UploadCloud className="relative -top-px mr-1 inline h-[13px] w-[13px] align-middle text-publie" />
          {cible === 'dev'
            ? t('Configuration du déploiement')
            : reconfiguration
              ? t('Configuration de la mise en production')
              : t('Initialisation de la mise en production')}
        </h3>
      </div>
      {auTravail ? (
        <BandeauTravail agent={agent} onClick={ouvrir} data-barre-initialisation-production={agent.projectId} />
      ) : null}
    </div>
  );
}
