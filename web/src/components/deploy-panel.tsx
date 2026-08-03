import * as React from 'react';
import { AlertTriangle, Check, ChevronRight, Loader2, Rocket, RotateCcw, Square, X, MinusCircle } from 'lucide-react';
import { Card, DeployRun, DeployStepKey, derouleOuvert, rapportAGarder } from '@haikodev/shared';
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
 * Le motif d'un échec, lisible. Le serveur écrit d'abord la raison en clair,
 * puis, s'il en a, les dernières lignes techniques : n'afficher que la fin
 * coupait justement la phrase qui explique — une ligne rouge sans explication.
 */
function motifLisible(log: string): string {
  const texte = log.trim();
  if (texte.length <= 300) return texte;
  const premiere = texte.split('\n')[0].slice(0, 200);
  return `${premiere}\n…\n${texte.slice(-200)}`;
}

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
  /* Du travail enregistré sur la branche principale sans carte : il doit
     pouvoir partir en ligne, sinon il reste bloqué là indéfiniment. */
  const [enAttente, setEnAttente] = React.useState<{ nombre: number; titres: string[] }>({ nombre: 0, titres: [] });
  const signature = embarked.map((card) => card.id).join(',');

  /*
   * Le contrôle se REJOUE toutes les vingt secondes. Il ne partait qu'au
   * changement du lot : un agent qui se mettait au travail après coup laissait
   * le bouton allumé, et la publication n'était refusée qu'au clic — trop tard
   * pour comprendre pourquoi.
   */
  React.useEffect(() => {
    // Le contrôle tourne MÊME sans carte à embarquer : c'est lui qui découvre
    // le travail enregistré sur la principale, et donc qui rallume le bouton.
    if (active) return;
    let vivant = true;
    const controler = () =>
      client
        .call({ type: 'deploy.check', projectId })
        .then((res: any) => {
          if (!vivant) return;
          setConflicts(res?.conflicts ?? []);
          setBusyAgents(res?.busy ?? []);
          setEnAttente(res?.enAttente ?? { nombre: 0, titres: [] });
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

  const aPublier = embarked.length + enAttente.nombre;
  /*
   * Une publication réussie ne garde le bloc que tant que rien de neuf
   * n'attend : dès qu'un lot est prêt, son rapport s'efface et l'on repart
   * d'un bloc propre (voir `rapportAGarder`).
   */
  const rapport = rapportAGarder(run?.state, aPublier) ? run : null;
  if (!active && !aPublier && !rapport) return null;

  return (
    /* Plus d'encadré : un simple trait EN BAS sépare le bloc de publication de
       la liste des cartes. Un cadre complet le faisait passer pour une carte. */
    <div className="mb-2 border-b border-border px-2 pt-2 pb-2">
      {!active ? (
        <>
          <Button
            variant={aPublier ? 'default' : 'outline'}
            size="sm"
            className="w-full"
            disabled={!aPublier || busy || busyAgents.length > 0}
            onClick={start}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
            {/* Le compteur embarque TOUT : une branche en conflit n'est plus
                écartée d'avance, l'agent de publication la reprend en route. */}
            Tout déployer ({aPublier})
          </Button>

          {/* Ce qui attend sans carte : on le NOMME, sinon le compteur monte
              sans qu'on sache pourquoi. */}
          {enAttente.nombre ? (
            <p className="mt-1.5 text-[12px] text-muted">
              Dont {enAttente.nombre} changement{enAttente.nombre > 1 ? 's' : ''} enregistré
              {enAttente.nombre > 1 ? 's' : ''} sans carte :{' '}
              <span className="text-faint">{enAttente.titres.join(' · ')}</span>
            </p>
          ) : null}

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
                    Conflit prévu sur « {conflict.title} »
                    {conflict.files.length ? ` (${conflict.files.slice(0, 3).join(', ')})` : ''} — l'agent de
                    publication le résoudra en route. Sans succès, la carte restera ici pour le prochain coup.
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {rapport ? <DeployProgress run={rapport} /> : null}
    </div>
  );
}

function DeployProgress({ run }: { run: DeployRun }) {
  const [open, setOpen] = React.useState(derouleOuvert(run.state));
  const [, force] = React.useReducer((value: number) => value + 1, 0);

  /*
   * Le déroulé suit la publication : ouvert pendant le travail, refermé dès
   * qu'elle aboutit. Sans ce rappel, les sept étapes cochées restaient
   * dépliées longtemps après la fin, comme si quelque chose tournait encore.
   * Un échec, lui, reste ouvert : c'est là qu'on lit le motif.
   */
  React.useEffect(() => {
    setOpen(derouleOuvert(run.state));
  }, [run.id, run.state]);

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
                      {motifLisible(step.log)}
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

          {/* Un bouton de décision prend toute la largeur de la carte : sous une
              liste d'étapes alignées à gauche, un petit bouton sans contour se
              lisait comme une étape de plus. */}
          <div className="mt-2">
            {run.state === 'running' ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => client.send({ type: 'deploy.stop', runId: run.id })}
              >
                <Square className="h-2.5 w-2.5 fill-current" /> Arrêter
              </Button>
            ) : run.state !== 'success' ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => client.send({ type: 'deploy.retry', runId: run.id })}
              >
                <RotateCcw className="h-2.5 w-2.5" /> Relancer
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
