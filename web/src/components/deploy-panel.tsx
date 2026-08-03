import * as React from 'react';
import { AlertTriangle, Check, ChevronRight, Loader2, Rocket, RotateCcw, Square, X, MinusCircle } from 'lucide-react';
import { Card, DeployRun, DeployStepKey } from '@haikodev/shared';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, elapsed } from '@/lib/utils';

const STEP_LABELS: Record<DeployStepKey, string> = {
  merge: 'Fusion des branches',
  commit: 'Enregistrement',
  push: 'Envoi sur le dépôt',
  verify: 'Vérification du code',
  build: 'Construction',
  publish: 'Mise en ligne',
  restart: 'Redémarrage du serveur',
};

type Conflict = { cardId: string; title: string; branch: string; files: string[] };

/**
 * Le bouton qui devient un tableau de bord (PLAN §11). Le compteur dit la
 * VÉRITÉ : exactement les cartes que le run va embarquer.
 */
export function DeployPanel({ projectId, cards }: { projectId: string; cards: Card[] }) {
  const state = useApp();
  const run = state.deploys[projectId];
  const [busy, setBusy] = React.useState(false);

  const embarked = cards.filter((card) => !card.excludedFromDeploy && !card.deployedAt);
  const active = run?.state === 'running';

  /*
   * Ce qui coincera se sait AVANT de cliquer : on interroge le serveur, qui
   * fusionne en mémoire sans rien toucher. Relancé quand le lot change ou
   * qu'une publication se termine.
   */
  const [conflicts, setConflicts] = React.useState<Conflict[]>([]);
  const [busyAgents, setBusyAgents] = React.useState<{ id: string; title: string }[]>([]);
  const signature = embarked.map((card) => card.id).join(',');

  /*
   * Le contrôle se REJOUE toutes les vingt secondes. Il ne partait qu'au
   * changement du lot : un agent qui se mettait au travail après coup laissait
   * le bouton allumé, et la publication n'était refusée qu'au clic — trop tard
   * pour comprendre pourquoi.
   */
  React.useEffect(() => {
    if (!signature || active) return;
    let vivant = true;
    const controler = () =>
      client
        .call({ type: 'deploy.check', projectId })
        .then((res: any) => {
          if (!vivant) return;
          setConflicts(res?.conflicts ?? []);
          setBusyAgents(res?.busy ?? []);
        })
        .catch(() => undefined);
    void controler();
    const timer = window.setInterval(controler, 20000);
    return () => {
      vivant = false;
      window.clearInterval(timer);
    };
  }, [projectId, signature, active, run?.state]);

  const start = async () => {
    setBusy(true);
    try {
      await client.call({ type: 'deploy.start', projectId });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'publication impossible');
    } finally {
      setBusy(false);
    }
  };

  if (!active && !embarked.length && !run) return null;

  return (
    <div className="mb-2 rounded-md border border-border bg-surface p-2">
      {!active ? (
        <>
          <Button
            variant={embarked.length ? 'default' : 'outline'}
            size="sm"
            className="w-full"
            disabled={!embarked.length || busy || busyAgents.length > 0}
            onClick={start}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
            Tout déployer ({embarked.length - conflicts.length}
            {conflicts.length ? `/${embarked.length}` : ''})
          </Button>

          {busyAgents.length ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-warning">
              <Loader2 className="mt-[3px] h-2.5 w-2.5 shrink-0 animate-spin" />
              <span>
                Publication en attente : {busyAgents.map((agent) => agent.title).join(', ')} travaille encore dans le
                dossier.
              </span>
            </p>
          ) : null}

          {conflicts.length ? (
            <ul className="mt-1.5 space-y-1">
              {conflicts.map((conflict) => (
                <li key={conflict.cardId} className="flex items-start gap-1.5 text-[12px] text-warning">
                  <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
                  <span>
                    Conflit prévu — « {conflict.title} » sera écartée
                    {conflict.files.length ? ` (${conflict.files.slice(0, 3).join(', ')})` : ''}.
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {run ? <DeployProgress run={run} /> : null}
    </div>
  );
}

function DeployProgress({ run }: { run: DeployRun }) {
  const [open, setOpen] = React.useState(run.state === 'running');
  const [, force] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => {
    if (run.state !== 'running') return;
    const timer = setInterval(force, 1000);
    return () => clearInterval(timer);
  }, [run.state]);

  const visible = run.steps.filter((step) => step.state !== 'todo' || run.state === 'running');

  return (
    <div className={cn(run.state === 'running' ? 'mt-0' : 'mt-2')}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {run.state === 'running' ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted" />
        ) : run.state === 'success' ? (
          <Check className="h-3 w-3 shrink-0 text-success" />
        ) : (
          <X className="h-3 w-3 shrink-0 text-danger" />
        )}
        <span className="flex-1 truncate text-[13px] text-muted">
          {run.state === 'running'
            ? `${STEP_LABELS[run.currentStep ?? 'merge']} — ${elapsed(run.startedAt)}`
            : run.state === 'success'
              ? `Publié : ${run.cardIds.length} tâche(s)`
              : `Échec : ${run.error ?? 'étape interrompue'}`}
        </span>
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
      </button>

      {run.queued ? (
        <p className="mt-1 text-[12px] text-warning">Une publication est en attente : elle partira ensuite.</p>
      ) : null}

      {open ? (
        <>
          <ul className="mt-1.5 space-y-0.5">
            {visible.map((step) => (
              <li key={step.key} className="flex items-start gap-1.5 text-[13px]">
                <span className="mt-[3px] shrink-0">
                  {step.state === 'running' ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-muted" />
                  ) : step.state === 'done' ? (
                    <Check className="h-2.5 w-2.5 text-success" />
                  ) : step.state === 'failed' ? (
                    <X className="h-2.5 w-2.5 text-danger" />
                  ) : step.state === 'skipped' ? (
                    <MinusCircle className="h-2.5 w-2.5 text-faint" />
                  ) : (
                    <span className="block h-2.5 w-2.5 rounded-full border border-border" />
                  )}
                </span>
                <span className={cn('flex-1', step.state === 'failed' ? 'text-danger' : 'text-muted')}>
                  {STEP_LABELS[step.key]}
                  {step.log && step.state === 'failed' ? (
                    <span className="mt-0.5 block whitespace-pre-wrap text-[12px] text-faint">
                      {step.log.slice(-300)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

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

          <div className="mt-2 flex gap-1">
            {run.state === 'running' ? (
              <Button size="sm" variant="ghost" onClick={() => client.send({ type: 'deploy.stop', runId: run.id })}>
                <Square className="h-2.5 w-2.5 fill-current" /> Arrêter
              </Button>
            ) : run.state !== 'success' ? (
              <Button size="sm" variant="outline" onClick={() => client.send({ type: 'deploy.retry', runId: run.id })}>
                <RotateCcw className="h-2.5 w-2.5" /> Relancer
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
