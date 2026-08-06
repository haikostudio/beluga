import * as React from 'react';
import { Check, ChevronRight, Loader2, Rocket, RotateCcw, Square, X, MinusCircle, AlertTriangle } from 'lucide-react';
import {
  Card,
  ColumnKey,
  DeployRun,
  DeployStepKey,
  EtapeDePublication,
  PlanDeMiseEnLigne,
  derouleOuvert,
  etapeDePublication,
  etapeDeLaColonne,
  rapportAGarder,
  runDeLEtape,
} from '@haikodev/shared';
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

/** L'étape d'une publication, nommée comme dans la règle pure. */
function libelleEtape(cible: DeployRun['cible']): string {
  return etapeDePublication(cible).libelle;
}

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
 *
 * Le même bloc sert les DEUX étapes de mise en ligne : posé en tête de « À
 * déployer », il déploie ; posé en tête de « En production », il publie. Il ne
 * sait pas à quelle étape il sert — il sait seulement de quelle COLONNE il est,
 * et c'est le serveur qui lui rend l'étape correspondante, ou rien du tout
 * quand cette colonne ne publie pas sur ce projet.
 */
export function DeployPanel({
  projectId,
  cards,
  colonne = 'to_deploy',
}: {
  projectId: string;
  cards: Card[];
  colonne?: ColumnKey;
}) {
  const state = useApp();
  const run = state.deploys[projectId];
  const [busy, setBusy] = React.useState(false);
  /*
   * Les deux étapes existent pour tout projet : la règle est PURE, le bloc la
   * rejoue lui-même et s'affiche tout de suite, sans attendre le serveur.
   */
  const [etape] = React.useState<EtapeDePublication | null>(() => etapeDeLaColonne(colonne));

  /*
   * Le garde-fou « déjà mise en ligne » ne vaut que pour la première étape :
   * une carte posée « En production » porte forcément une date de mise en ligne
   * — celle du déploiement —, et c'est justement elle qu'on veut passer en
   * production. Même règle que `deployableCards` côté serveur, sinon
   * le compteur annoncerait autre chose que ce qui partira.
   */
  const embarked = cards.filter(
    (card) => !card.excludedFromDeploy && (colonne !== 'to_deploy' || !card.deployedAt),
  );
  const active = run?.state === 'running';
  /* Deux blocs peuvent être à l'écran : chacun ne montre QUE sa publication. */
  const mienne = !!run && !!etape && runDeLEtape(run.cible, etape);

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
  /* COMMENT l'instance de dev sera rafraîchie : on le dit avant le clic, pour
     que le déroulé ne soit pas une surprise. */
  const [miseEnLigne, setMiseEnLigne] = React.useState<PlanDeMiseEnLigne | null>(null);
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
        .call({ type: 'deploy.check', projectId, source: colonne })
        .then((res: any) => {
          if (!vivant) return;
          setConflicts(res?.conflicts ?? []);
          setBusyAgents(res?.busy ?? []);
          setEnAttente(res?.enAttente ?? { nombre: 0, titres: [] });
          setMiseEnLigne(res?.miseEnLigne ?? null);
        })
        .catch(() => undefined);
    void controler();
    const timer = window.setInterval(controler, 20000);
    return () => {
      vivant = false;
      window.clearInterval(timer);
    };
  }, [projectId, signature, active, run?.state, colonne]);

  const start = async () => {
    setBusy(true);
    try {
      // L'étape part AVEC la demande : le serveur ne doit pas retomber sur la
      // première quand c'est la mise en production qu'on a cliquée.
      await client.call({ type: 'deploy.start', projectId, cible: etape?.cible });
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
  const rapport = rapportAGarder(run?.state, aPublier) && mienne ? run : null;
  /*
   * Le bloc reste TOUJOURS en tête de la colonne « À déployer », même sans rien
   * à envoyer : le bouton « Tout déployer » y est visible partout, seulement
   * désactivé quand il n'y a rien à publier (il dit alors pourquoi). Le retirer
   * faisait qu'une colonne vide n'affichait ni bloc ni bouton — d'un projet à
   * l'autre, l'affichage n'était pas le même.
   *
   * Cette colonne ne publie rien : alors AUCUN bloc, pas même un bouton éteint.
   */
  if (!etape) return null;

  return (
    /* Plus d'encadré : un simple trait EN BAS sépare le bloc de publication de
       la liste des cartes. Un cadre complet le faisait passer pour une carte. */
    <div className="mb-2 border-b border-border px-2 pt-2 pb-2" data-bloc-publication={colonne}>
      {!(active && mienne) ? (
        <>
          <Button
            variant={aPublier ? 'default' : 'outline'}
            size="sm"
            className="w-full"
            data-bouton-publication
            disabled={!aPublier || busy || active || busyAgents.length > 0}
            onClick={start}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
            {/* Le compteur embarque TOUT : une branche en conflit n'est plus
                écartée d'avance, l'agent de publication la reprend en route.
                Le verbe vient de l'ÉTAPE : « Tout déployer » en tête de « À
                déployer », « Tout publier » en tête de « En production ». */}
            Tout {etape.verbe} ({aPublier})
          </Button>

          {/* Une publication de l'AUTRE étape tourne déjà : une seule à la fois
              par projet, on le dit plutôt que d'éteindre le bouton sans un mot. */}
          {active && !mienne ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-muted" data-publication-ailleurs>
              <Loader2 className="mt-[3px] h-2.5 w-2.5 shrink-0 animate-spin" />
              <span>Une autre publication de ce projet est en cours : attendez qu’elle finisse.</span>
            </p>
          ) : null}

          {/* CE QUI VA SE PASSER, en une ligne : construction, relance du
              service, ou rien à relancer ici. Plus aucun refus faute de
              réglage — mais on ne laisse pas croire à une mise en ligne qui
              n'aura pas lieu. */}
          {miseEnLigne && aPublier && etape.cible === 'dev' ? (
            <p className="mt-1.5 text-[12px] text-faint" data-moyen-mise-en-ligne>
              {miseEnLigne.raison}
            </p>
          ) : null}

          {/* Rien à envoyer : le bouton est grisé et DIT pourquoi, plutôt qu'un
              bloc qui disparaît. */}
          {!aPublier ? (
            <p className="mt-1.5 text-[12px] text-muted">Rien à {etape.verbe} pour l'instant.</p>
          ) : null}

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
        {/* Le compte rendu NOMME son étape : un déploiement en cours ne se lit
            pas comme une mise en production. */}
        <span className="flex-1 truncate text-[13px] text-muted" data-etape-run={run.cible ?? 'dev'}>
          {run.state === 'running'
            ? `${STEP_LABELS[run.currentStep ?? 'merge']} — ${elapsed(run.startedAt)}`
            : run.state === 'success'
              ? `Publié (${libelleEtape(run.cible)}) : ${run.cardIds.length} tâche(s)`
              : `Échec (${libelleEtape(run.cible)}) : ${run.error ?? 'étape interrompue'}`}
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
