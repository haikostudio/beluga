import * as React from 'react';
import { Check, Loader2, MessageCircleQuestion, Rocket, Sparkles } from 'lucide-react';
import {
  type Project,
  agentDeConfiguration,
  agentTientSonTour,
  etatDuBoutonDeConfiguration,
  leClicLanceLAgent,
  processusDeLEtape,
  procedureEnPlace,
  suiviDeLaPublication,
} from '@beluga/shared';
import { PastilleProjet } from '@/components/pastille-projet';
import { BarreProgression } from '@/components/barre-progression';
import { Button, CLASSE_RANGEE_DE_BOUTONS, CaseACocher, Drawer, EnteteDeFeuille, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useSignalerLaPublication } from '@/lib/signal-publication';
import { ouvrirAgentDeConfiguration } from '@/lib/ouvrir-config-projet';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE « DÉPLOYER » D'UN REGROUPEMENT (demande du 27/10/2026).
 *
 * Un regroupement n'a ni dépôt ni procédure : son bouton « Déployer » menait à
 * l'agent de configuration DU GROUPE, qui n'avait rien à configurer. Il ouvre
 * désormais une feuille qui liste ses projets membres, chacun avec sa case :
 * cochés d'office ceux qui savent se déployer, et « Déployer la sélection »
 * lance le déploiement de CHACUN, en même temps (`deploy.start` par membre,
 * comme la mise en production du groupe, `bandeau-production-groupe.tsx`).
 * Chaque membre emporte tout son lot « À déployer ». Un refus s'écrit sur la
 * ligne de son projet sans retenir les autres ; un membre sans procédure garde
 * le bouton qui ouvre SON agent de configuration.
 */
export function DeploiementDeGroupe({
  groupe,
  membres,
  enTete = false,
  enMenu = false,
}: {
  groupe: Pick<Project, 'id' | 'name'>;
  membres: Project[];
  /** Dans la barre d'en-tête de la page : le bouton « Déployer ». */
  enTete?: boolean;
  /** Sur téléphone : aucun bouton, la ligne du menu à trois points ouvre la feuille. */
  enMenu?: boolean;
}) {
  const state = useApp();
  const [ouvert, setOuvert] = React.useState(false);
  const [coches, setCoches] = React.useState<ReadonlySet<string>>(new Set());
  const [envoi, setEnvoi] = React.useState<ReadonlySet<string>>(new Set());
  const [erreurs, setErreurs] = React.useState<Record<string, string>>({});

  const lignes = membres.map((membre) => {
    const run = state.deploys[membre.id];
    const deploiement = run && run.cible !== 'production' ? run : undefined;
    const enCours = run?.state === 'running';
    const enPlace = procedureEnPlace(membre, 'dev');
    const lot = state.cartesChargees[membre.id]
      ? Object.values(state.cards).filter((card) => card.projectId === membre.id && card.column === 'to_deploy').length
      : null;
    return {
      membre,
      enPlace,
      enCours,
      lot,
      suivi: deploiement ? suiviDeLaPublication(deploiement) : null,
      cochable: enPlace && !enCours && state.connected,
    };
  });
  const enRoute = lignes.some((ligne) => ligne.enCours);
  const selection = lignes.filter((ligne) => ligne.cochable && coches.has(ligne.membre.id) && !envoi.has(ligne.membre.id));

  /* À CHAQUE OUVERTURE, la sélection repart de ce qui peut partir. */
  const ouvrir = () => {
    setCoches(new Set(lignes.filter((ligne) => ligne.cochable).map((ligne) => ligne.membre.id)));
    setErreurs({});
    setOuvert(true);
  };

  /* Sur téléphone, la ligne « Déployer » du menu à trois points ouvre la feuille. */
  useSignalerLaPublication(
    groupe.id,
    'deploiement',
    enMenu
      ? {
          compte: lignes.reduce((total, ligne) => total + (ligne.enPlace ? ligne.lot ?? 0 : 0), 0),
          enRetard: false,
          pourcent: null,
          enRoute,
          tombee: false,
          agent: null,
        }
      : null,
    ouvrir,
  );

  const basculer = (id: string) =>
    setCoches((prev) => {
      const suite = new Set(prev);
      if (suite.has(id)) suite.delete(id);
      else suite.add(id);
      return suite;
    });

  /* LES DEMANDES PARTENT ENSEMBLE, et chacune rend son propre verdict. */
  const lancer = async () => {
    const cibles = selection.map((ligne) => ligne.membre.id);
    if (!cibles.length) return;
    setEnvoi((prev) => new Set([...prev, ...cibles]));
    setErreurs((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !cibles.includes(id))));
    const issues = await Promise.allSettled(cibles.map((id) => client.call({ type: 'deploy.start', projectId: id, cible: 'dev' })));
    const refus: Record<string, string> = {};
    issues.forEach((issue, rang) => {
      if (issue.status === 'rejected') refus[cibles[rang]] = issue.reason?.message ?? t('Déploiement impossible');
    });
    setErreurs((prev) => ({ ...prev, ...refus }));
    setEnvoi((prev) => new Set([...prev].filter((id) => !cibles.includes(id))));
    setCoches((prev) => new Set([...prev].filter((id) => !cibles.includes(id) || refus[id])));
  };

  const boutonDeConfiguration = (membre: Project) => {
    const agentId = agentDeConfiguration(membre, 'dev');
    const agent = agentId ? state.agents[agentId] : undefined;
    const etat = etatDuBoutonDeConfiguration({
      processus: !!processusDeLEtape(membre, 'dev'),
      auTravail: !!state.procedures[`${membre.id}:dev`]?.enCours || (!!agent && agentTientSonTour(agent)),
      question: !!state.procedures[`${membre.id}:dev`]?.question || agent?.attendReponse === true,
    });
    return (
      <Button
        variant="outline"
        size="pied"
        className="shrink-0 gap-1.5"
        onClick={() => {
          setOuvert(false);
          ouvrirAgentDeConfiguration(membre.id, 'dev', { lancer: leClicLanceLAgent(etat) });
        }}
        data-configurer-deploiement-membre={membre.id}
      >
        {etat === 'travail' ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : etat === 'question' ? (
          <MessageCircleQuestion className="h-3 w-3 shrink-0" />
        ) : (
          <Sparkles className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">
          {etat === 'travail' ? t('Agent au travail…') : etat === 'question' ? t('Répondre à l’agent') : t('Configurer le déploiement')}
        </span>
      </Button>
    );
  };

  return (
    <>
      {enMenu ? null : (
        <div
          className={enTete ? cn('order-1 min-w-0', CLASSE_RANGEE_DE_BOUTONS) : 'flex w-full min-w-0 flex-1 items-center gap-1'}
          data-bloc-publication="to_deploy"
          data-deploiement-de-groupe={groupe.id}
          data-publication-en-tete={enTete ? '' : undefined}
        >
          <Button
            variant="default"
            size="sm"
            className={cn('min-w-0 gap-1.5 overflow-hidden', !enTete && 'flex-1')}
            onClick={ouvrir}
            data-bouton-deploiement-groupe
          >
            {enRoute ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
            <span className="truncate">{t('Déployer')}</span>
          </Button>
        </div>
      )}
      <Drawer open={ouvert} onClose={() => setOuvert(false)} feuille>
        <EnteteDeFeuille titre={t('Déployer les projets du groupe')} />
        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-3 pb-2">
          <p className="mb-2 text-[13px] leading-snug text-muted">
            {t('Cochez les projets à déployer : chacun part avec tout son lot « À déployer », en même temps.')}
          </p>
          <ul className="flex flex-col gap-1.5" data-membres-deploiement={membres.length}>
            {lignes.map((ligne) => {
              const id = ligne.membre.id;
              const erreur = erreurs[id];
              const reussi = ligne.suivi?.etat === 'reussie' && !ligne.enCours;
              return (
                <li
                  key={id}
                  className="relative overflow-hidden rounded-md bg-raised/45"
                  data-membre-deploiement={id}
                  data-etat-membre={ligne.enCours ? 'en-cours' : ligne.enPlace ? 'pret' : 'sans-procedure'}
                >
                  <label className={cn('flex items-start gap-2 px-2.5 py-2', ligne.cochable ? 'cursor-pointer' : 'cursor-default')}>
                    <CaseACocher
                      checked={ligne.cochable && coches.has(id)}
                      disabled={!ligne.cochable}
                      onCheckedChange={() => basculer(id)}
                      className="mt-0.5"
                      data-case-deploiement-membre={id}
                    />
                    <span className="mt-[3px] shrink-0">
                      <PastilleProjet project={ligne.membre} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="min-w-0 truncate text-[14px] font-medium text-text">{ligne.membre.name}</span>
                      {ligne.enCours && ligne.suivi ? (
                        <span className="truncate text-[12.5px] text-en-cours" data-avancement-deploiement-membre={ligne.suivi.pourcent}>
                          {t('Déploiement en cours')} · <span className="font-semibold tabular-nums">{ligne.suivi.pourcent} %</span>
                        </span>
                      ) : !ligne.enPlace ? (
                        <span className="truncate text-[12.5px] text-faint">{t('Aucune procédure de déploiement')}</span>
                      ) : reussi ? (
                        <span className="flex items-center gap-1 truncate text-[12.5px] text-termine">
                          <Check className="h-3 w-3 shrink-0" />
                          {t('Dernier déploiement réussi')}
                        </span>
                      ) : ligne.lot ? (
                        <span className="truncate text-[12.5px] text-muted">
                          {ligne.lot === 1 ? t('1 tâche à déployer') : t('{n} tâches à déployer', { n: ligne.lot })}
                        </span>
                      ) : null}
                    </span>
                  </label>
                  {!ligne.enPlace ? <div className="px-2.5 pb-2">{boutonDeConfiguration(ligne.membre)}</div> : null}
                  {erreur ? (
                    <p className="px-2.5 pb-2 text-[12px] leading-snug text-danger" data-erreur-deploiement-membre>
                      {erreur}
                    </p>
                  ) : null}
                  {ligne.suivi && ligne.enCours ? (
                    <BarreProgression className="absolute inset-x-0 bottom-0" pourcent={ligne.suivi.pourcent} teinte="en-cours" />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ZoneDefilement>
        <div className="shrink-0 px-3 pb-3 pt-2">
          <Button
            variant="default"
            size="pied"
            className="w-full gap-1.5"
            disabled={!selection.length || envoi.size > 0}
            onClick={() => void lancer()}
            data-bouton-deployer-selection={selection.length}
          >
            {envoi.size ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
            <span className="truncate">{t('Déployer la sélection ({n})', { n: selection.length })}</span>
          </Button>
        </div>
      </Drawer>
    </>
  );
}
