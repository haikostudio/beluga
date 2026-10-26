import * as React from 'react';
import { ChevronDown, Loader2, Settings } from 'lucide-react';
import {
  catalogueVisible,
  reponseDeBranchement,
  servicesPourLesCapacites,
  type CapaciteDeGeneration,
  type ServiceConseille,
} from '@beluga/shared';
import { Button } from '@/components/ui';
import { LigneDeService, useServicesDeCreation, type ServiceAffiche } from '@/components/reglages/page-services-creation';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** Ouvre les paramètres de l'application sur la rubrique « Services de création ». */
function ouvrirLesServicesDeCreation() {
  window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'services-creation' } }));
}

/**
 * L'ENCADRÉ DE BRANCHEMENT, DANS LA CONVERSATION (studio créatif, décision de
 * l'utilisateur du 24/10/2026). Quand l'agent constate qu'aucun service branché
 * ne sait fabriquer ce qu'il faut, il pose une question (« realiser » action
 * « brancher ») ; la bulle de cette question porte cet encadré :
 *
 *  - fal.ai en tête, « recommandé » (un seul compte, prix publiés) ; Higgsfield
 *    ensuite pour la vidéo, « moins cher » ; les autres services qui savent
 *    faire, repliés sous « Autres services » ;
 *  - chaque ligne est CELLE DES RÉGLAGES (`LigneDeService`) : même champ, même
 *    test gratuit, même fiche du coffre — la clé ne passe jamais par le texte
 *    de la conversation et ne revient jamais à l'écran ;
 *  - dès qu'un service vient d'être branché et que sa clé est acceptée, la
 *    question se répond SEULE (« Service branché : fal.ai ») : l'agent reprend.
 *  - « Ouvrir les paramètres » reste là, pour tout gérer au même endroit.
 */
export function BranchementDeService({
  capacites,
  onBranche,
  desactive,
}: {
  capacites: readonly string[];
  /** Le service vient d'être branché : la réponse à envoyer à la question. */
  onBranche: (reponse: string) => Promise<void>;
  /** La question est déjà répondue : on montre l'état, sans répondre deux fois. */
  desactive?: boolean;
}) {
  const { services, setServices } = useServicesDeCreation(true);
  const [autresOuverts, setAutresOuverts] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const conseilles = React.useMemo(
    () => servicesPourLesCapacites(capacites as CapaciteDeGeneration[], catalogueVisible()),
    [capacites.join(',')],
  );
  /* Les services déjà branchés à l'ouverture : seul un NOUVEAU branchement répond à la question. */
  const brancheesAuDepart = React.useRef<Set<string> | null>(null);
  if (services && !brancheesAuDepart.current) brancheesAuDepart.current = new Set(services.filter((s) => s.branche).map((s) => s.id));

  const surChangement = (liste: ServiceAffiche[]) => {
    setServices(liste);
    if (desactive || envoi) return;
    const nouveau = liste.find(
      (s) => s.branche && s.test?.ok !== false && conseilles.some((c) => c.id === s.id) && !brancheesAuDepart.current?.has(s.id),
    );
    if (!nouveau) return;
    setEnvoi(true);
    void onBranche(reponseDeBranchement(nouveau.nom)).finally(() => setEnvoi(false));
  };

  const ligne = (c: ServiceConseille) => {
    const service = services?.find((s) => s.id === c.id);
    if (!service) return null;
    return (
      <div key={c.id} className="flex flex-col gap-1" data-branchement-service={c.id} data-branchement-rang={c.rang}>
        {c.rang !== 'autre' ? (
          <span className="text-[12px] text-faint">
            {c.rang === 'recommande' ? t('Recommandé : un seul compte, des devis exacts') : t('Moins cher pour la vidéo')}
          </span>
        ) : null}
        <ul>
          <LigneDeService service={service} onChange={surChangement} />
        </ul>
      </div>
    );
  };
  const enTete = conseilles.filter((c) => c.rang !== 'autre');
  const autres = conseilles.filter((c) => c.rang === 'autre');

  return (
    <section className="mt-2 flex flex-col gap-2" data-branchement-de-service={capacites.join(',')}>
      {services === null ? (
        <p className="flex items-center gap-2 text-[12.5px] text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('Chargement…')}
        </p>
      ) : (
        <>
          {enTete.map(ligne)}
          {autres.length ? (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                className="flex items-center gap-1 self-start rounded-md px-1.5 sm:px-1 py-1 sm:py-0.5 text-[12.5px] text-muted hover:text-text"
                onClick={() => setAutresOuverts((o) => !o)}
                aria-expanded={autresOuverts}
                data-branchement-autres=""
              >
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !autresOuverts && '-rotate-90')} />
                {t('Autres services ({n})', { n: autres.length })}
              </button>
              {autresOuverts ? autres.map(ligne) : null}
            </div>
          ) : null}
        </>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={ouvrirLesServicesDeCreation} data-branchement-parametres="">
          <Settings className="h-3.5 w-3.5" />
          {t('Ouvrir les paramètres')}
        </Button>
        {envoi ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('L’agent reprend…')}
          </span>
        ) : null}
      </div>
    </section>
  );
}
