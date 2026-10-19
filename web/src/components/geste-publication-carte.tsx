import * as React from 'react';
import { CloudUpload, Loader2, Play } from 'lucide-react';
import {
  descriptionDeLEtape,
  etapeDeLaColonne,
  runDeLEtape,
  suiviDeLaPublication,
  type SuiviDePublication,
} from '@beluga/shared';
import { Button } from '@/components/ui';
import { BarreProgression } from '@/components/barre-progression';
import { client } from '@/lib/client';
import { useSeconde } from '@/lib/horloge';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { aLeNiveauSurLeProjet } from '@/lib/mes-droits';
import { cn } from '@/lib/utils';

/*
 * LES DEUX GESTES DE PUBLICATION DANS L'EN-TÊTE DE LA PAGE D'UNE CARTE.
 *
 * Ils ouvrent les MÊMES pages que le tableau (`client.demanderDeploiement`,
 * `client.demanderProduction`) et, pendant une publication, ils MONTRENT le
 * suivi comme le bouton du tableau (MEM-1198) : roue, pourcentage, étape
 * actuelle et barre au ras du bas. Le suivi se lit sur la MÊME source et la
 * MÊME règle que `DeployPanel` (`state.deploys`, `suiviDeLaPublication`) :
 * le signal de `signal-publication.ts` n'est publié que sur téléphone, et la
 * page d'une carte peut être ouverte sans le tableau dessous.
 */

type Geste = 'deploiement' | 'production';

interface SuiviDuGeste {
  suivi: SuiviDePublication;
  enRoute: boolean;
  tombee: boolean;
  libelle: string;
}

/** Le suivi du geste, ou `null` au repos (aucune publication de cette étape, ou réussie). */
function useSuiviDuGeste(projectId: string, geste: Geste): SuiviDuGeste | null {
  const run = useApp().deploys[projectId];
  const etape = etapeDeLaColonne(geste === 'deploiement' ? 'to_deploy' : 'archived');
  const mienne = !!run && !!etape && runDeLEtape(run.cible, etape);
  const suivi = mienne && run ? suiviDeLaPublication(run) : null;
  const enRoute = suivi?.etat === 'en-cours';
  const tombee = suivi?.etat === 'en-echec' || suivi?.etat === 'arretee';
  useSeconde(enRoute);
  if (!suivi || !etape || !(enRoute || tombee)) return null;
  const libelle = t(descriptionDeLEtape(run?.currentStep ?? 'merge', etape.cible).libelle);
  return { suivi, enRoute, tombee, libelle };
}

/** La barre fine au ras du bas, rognée par son propre calque (l'enveloppe ne rogne rien). */
function BarreDuGeste({ suivi, tombee, projectId }: { suivi: SuiviDePublication; tombee: boolean; projectId: string }) {
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg" aria-hidden>
      <BarreProgression
        className="absolute inset-x-0 bottom-0"
        pourcent={suivi.pourcent}
        erreur={tombee}
        teinte="en-cours"
        data-barre-geste-carte={projectId}
      />
    </span>
  );
}

export function GestesDePublicationDeCarte({ projectId }: { projectId: string }) {
  const state = useApp();
  const deploiement = useSuiviDuGeste(projectId, 'deploiement');
  const production = useSuiviDuGeste(projectId, 'production');
  // Sans le droit « Déployer » sur ce projet (accès tiers), aucun geste de mise en ligne.
  if (!aLeNiveauSurLeProjet(state, projectId, 'deployer')) return null;
  return (
    <>
      <Button
        variant="outline"
        size="md"
        className="relative h-9 min-w-0 max-w-[18rem] gap-2 rounded-lg px-3.5 disabled:opacity-100"
        data-geste-deploiement
        data-suivi-en-route={deploiement?.enRoute ? 'oui' : undefined}
        data-suivi-tombe={deploiement?.tombee ? 'oui' : undefined}
        title={deploiement ? `${deploiement.libelle} — ${deploiement.suivi.pourcent} %` : undefined}
        onClick={() => client.demanderDeploiement({ projectId })}
      >
        {deploiement?.enRoute ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{deploiement ? deploiement.libelle : t('Déploiement')}</span>
        {deploiement ? (
          <span
            className={cn('shrink-0 text-[12px] font-semibold tabular-nums', deploiement.tombee ? 'text-danger' : 'text-en-cours')}
            data-pourcent-geste-carte={deploiement.suivi.pourcent}
          >
            {deploiement.suivi.pourcent} %
          </span>
        ) : null}
        {deploiement ? <BarreDuGeste suivi={deploiement.suivi} tombee={deploiement.tombee} projectId={projectId} /> : null}
      </Button>
      {/* ICÔNE SEULE (demande du 15/10/2026) : le nom — et l'étape en cours — sont dits au survol. */}
      <Button
        variant="default"
        size="icon-barre"
        className="relative shrink-0 rounded-lg"
        aria-label="Mise en production"
        title={production ? `${production.libelle} — ${production.suivi.pourcent} %` : t('Mise en production')}
        data-geste-production
        data-suivi-en-route={production?.enRoute ? 'oui' : undefined}
        onClick={() => client.demanderProduction({ projectId })}
      >
        {production?.enRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
        {production ? <BarreDuGeste suivi={production.suivi} tombee={production.tombee} projectId={projectId} /> : null}
      </Button>
    </>
  );
}
