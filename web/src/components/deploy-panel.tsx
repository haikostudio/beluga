import * as React from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  Rocket,
  RotateCcw,
  Square,
  X,
  MinusCircle,
  AlertTriangle,
} from 'lucide-react';
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
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, elapsed } from '@/lib/utils';

/** L'ordre des sept étapes de la mise en ligne — le même que côté serveur. */
const ORDRE_ETAPES: DeployStepKey[] = ['merge', 'commit', 'push', 'verify', 'build', 'publish', 'restart'];

const STEP_LABELS: Record<DeployStepKey, string> = {
  merge: 'Fusion des branches',
  commit: 'Enregistrement',
  push: 'Envoi sur le dépôt',
  verify: 'Vérification du code',
  build: 'Construction',
  publish: 'Mise en ligne',
  restart: 'Redémarrage du serveur',
};

/**
 * Une phrase courte qui rappelle à quoi sert chaque étape. Masquée par défaut,
 * révélée au « ? » : elle explique le déroulé sans qu'on ait à le connaître.
 */
const STEP_DESCRIPTIONS: Record<DeployStepKey, string> = {
  merge: 'Les branches des cartes du lot sont réunies dans la branche principale.',
  commit: "Le résultat de la fusion est inscrit dans l'historique du dépôt.",
  push: 'Le code réuni est envoyé sur le dépôt distant.',
  verify: 'Les contrôles du projet sont rejoués ; le moindre échec arrête la mise en ligne.',
  build: 'Le projet est recompilé à partir du code réuni.',
  publish: "L'instance de dev de ce serveur est rafraîchie avec la nouvelle version.",
  restart: 'Le service est relancé pour servir la version fraîche.',
};

type EtatEtape = DeployRun['steps'][number]['state'];

/** L'état d'une étape, dit en français simple. */
const ETAT_LABELS: Record<EtatEtape, string> = {
  todo: 'à venir',
  running: 'en cours',
  done: 'fait',
  failed: 'échoué',
  skipped: 'sauté',
};

/** La pastille d'état posée devant une étape, la même partout. */
function IconeEtape({ etat }: { etat: EtatEtape }) {
  if (etat === 'running') return <Loader2 className="h-2.5 w-2.5 animate-spin text-muted" />;
  if (etat === 'done') return <Check className="h-2.5 w-2.5 text-success" />;
  if (etat === 'failed') return <X className="h-2.5 w-2.5 text-danger" />;
  if (etat === 'skipped') return <MinusCircle className="h-2.5 w-2.5 text-faint" />;
  return <span className="block h-2.5 w-2.5 rounded-full border border-border" />;
}

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
/**
 * Les textes INFORMATIFS de la publication, réunis pour le bouton « ! » de la
 * tête de colonne : comment l'instance sera rafraîchie, ce qui attend sans
 * carte, et l'éventuelle publication déjà en cours ailleurs. Rien d'alarmant —
 * les alertes orange (agent au travail, conflits) restent sous le bouton.
 */
export type InfosPublication = {
  /** Comment l'instance de dev sera rafraîchie (« HaikoDev se construit… »). */
  moyen?: string;
  /** Du travail enregistré sans carte, embarqué dans le lot. */
  enAttente?: { nombre: number; titres: string[] };
  /** Une autre publication de ce projet tourne déjà. */
  autrePublication?: boolean;
  /** Une mise en production sans prompt réglé : elle ne peut pas partir. */
  productionBloquee?: string;
};

export function DeployPanel({
  projectId,
  cards,
  colonne = 'to_deploy',
  onInfos,
}: {
  projectId: string;
  cards: Card[];
  colonne?: ColumnKey;
  /** Remonte à la tête de colonne ce qui va derrière le bouton « ! ». */
  onInfos?: (infos: InfosPublication | null) => void;
}) {
  const state = useApp();
  const run = state.deploys[projectId];
  const [busy, setBusy] = React.useState(false);
  /* Le déroulé des sept étapes, replié par défaut : le chevron l'ouvre. */
  const [processOuvert, setProcessOuvert] = React.useState(false);
  /* La TÊTE (bouton + chevron + déroulé en superposition) : un clic hors d'elle
     referme le déroulé, comme un menu. */
  const teteRef = React.useRef<HTMLDivElement>(null);
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
  /* Une MISE EN PRODUCTION sans prompt réglé ne part pas : le serveur nous le
     dit, avec la phrase à afficher. Vide pour un déploiement, toujours. */
  const [productionBloquee, setProductionBloquee] = React.useState<string | null>(null);
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
          setProductionBloquee(res?.productionBloquee ?? null);
        })
        .catch(() => undefined);
    void controler();
    const timer = window.setInterval(controler, 20000);
    return () => {
      vivant = false;
      window.clearInterval(timer);
    };
  }, [projectId, signature, active, run?.state, colonne]);

  /*
   * Le déroulé suit la publication qui NOUS appartient : ouvert pendant le
   * travail et sur un échec — c'est là qu'on lit ce qui a coincé —, refermé dès
   * qu'elle aboutit. Hors publication, il ne bouge que sur clic du chevron.
   */
  React.useEffect(() => {
    if (!mienne || !run) return;
    setProcessOuvert(derouleOuvert(run.state));
  }, [mienne, run?.id, run?.state]);

  /*
   * Le déroulé s'ouvre EN SUPERPOSITION au-dessus des cartes : un clic à
   * l'extérieur le referme, comme un menu. On ne l'attache pas pendant une
   * publication en cours, où c'est l'état du run qui pilote son ouverture.
   */
  React.useEffect(() => {
    if (!processOuvert || (active && mienne)) return;
    const surClic = (e: MouseEvent) => {
      if (teteRef.current && !teteRef.current.contains(e.target as Node)) setProcessOuvert(false);
    };
    document.addEventListener('mousedown', surClic);
    return () => document.removeEventListener('mousedown', surClic);
  }, [processOuvert, active, mienne]);

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
   * Une publication réussie n'affiche plus son compte rendu : dès qu'elle
   * aboutit, le bloc repart vierge (bouton + chevron). Seuls le travail en
   * cours, un échec ou un arrêt gardent leur rapport (voir `rapportAGarder`).
   */
  const rapport = rapportAGarder(run?.state) && mienne ? run : null;

  /*
   * Ce qui va DERRIÈRE le bouton « ! » de la tête de colonne : les textes
   * informatifs qui, sous le bouton, poussaient les cartes vers le bas. On les
   * réunit ici et on les remonte à la tête de colonne. Pendant MA publication,
   * le déroulé des étapes dit déjà tout — rien à ranger derrière le bouton.
   */
  const infosPublication = React.useMemo<InfosPublication | null>(() => {
    if (active && mienne) return null;
    const infos: InfosPublication = {};
    if (active && !mienne) infos.autrePublication = true;
    if (miseEnLigne && aPublier && etape?.cible === 'dev') infos.moyen = miseEnLigne.raison;
    // Une mise en production sans prompt réglé : on l'explique dès qu'un lot
    // attend et ne peut pas partir. Le déploiement ne connaît jamais ce cas.
    if (productionBloquee && aPublier) infos.productionBloquee = productionBloquee;
    if (enAttente.nombre) infos.enAttente = enAttente;
    return infos.moyen || infos.enAttente || infos.autrePublication || infos.productionBloquee
      ? infos
      : null;
  }, [active, mienne, miseEnLigne, aPublier, etape?.cible, enAttente, productionBloquee]);

  /* On remonte l'objet SANS en faire une dépendance : on suit sa signature,
     sinon la fonction passée en prop, recréée à chaque rendu, bouclerait. */
  const onInfosRef = React.useRef(onInfos);
  onInfosRef.current = onInfos;
  const signatureInfos = JSON.stringify(infosPublication);
  React.useEffect(() => {
    onInfosRef.current?.(infosPublication);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureInfos]);

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

  /* Ma publication tourne : le bouton porte alors l'étape en cours au lieu du
     verbe, et le déroulé reflète les états réels. */
  const publicationEnCours = active && mienne;
  const etapeEnCours: DeployStepKey = run?.currentStep ?? 'merge';

  return (
    /* Plus d'encadré : un simple trait EN BAS sépare le bloc de publication de
       la liste des cartes. Un cadre complet le faisait passer pour une carte. */
    <div className="mb-2 border-b border-border px-2 pt-2 pb-2" data-bloc-publication={colonne}>
      {/* La TÊTE : le bouton d'action à gauche, le chevron du déroulé à droite.
          Pendant une publication, le bouton dit l'étape traitée. */}
      <div className="relative flex items-stretch gap-1" ref={teteRef}>
        <Button
          variant={publicationEnCours ? 'outline' : aPublier ? 'default' : 'outline'}
          size="sm"
          className="min-w-0 flex-1"
          data-bouton-publication
          disabled={
            publicationEnCours || !aPublier || busy || active || busyAgents.length > 0 || !!productionBloquee
          }
          onClick={publicationEnCours ? undefined : start}
        >
          {publicationEnCours ? (
            <>
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              <span className="truncate">{STEP_LABELS[etapeEnCours]}…</span>
            </>
          ) : (
            <>
              {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
              {/* Le compteur embarque TOUT : une branche en conflit n'est plus
                  écartée d'avance, l'agent de publication la reprend en route.
                  Le verbe vient de l'ÉTAPE : « Tout déployer » en tête de « À
                  déployer », « Tout publier » en tête de « En production ». */}
              <span className="truncate">
                Tout {etape.verbe} ({aPublier})
              </span>
            </>
          )}
        </Button>

        {/* Le chevron ouvre le déroulé des sept étapes, publication ou non. */}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 px-2"
          data-chevron-process
          aria-expanded={processOuvert}
          aria-label="Voir le déroulé des sept étapes de la mise en ligne"
          onClick={() => setProcessOuvert((v) => !v)}
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', processOuvert && 'rotate-180')} />
        </Button>

        {/* Le déroulé s'ouvre PAR-DESSUS les cartes, ancré sous le chevron : il
            ne pousse plus la colonne vers le bas. */}
        {processOuvert ? (
          <div className="absolute inset-x-0 top-full z-20">
            <ProcessusEtapes run={mienne ? run : undefined} />
          </div>
        ) : null}
      </div>

      {!publicationEnCours ? (
        <>
          {/* Sous le bouton, un SEUL bandeau étroit : les alertes orange, et rien
              d'autre. Les textes informatifs (rafraîchissement de l'instance,
              travail sans carte, autre publication en cours) sont partis derrière
              le bouton « ! » de la tête de colonne, pour que le bouton touche la
              première carte quand il n'y a rien à signaler. */}
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

      {publicationEnCours || rapport ? <DeployControls run={run!} /> : null}
    </div>
  );
}

/**
 * Le bouton « ! » de la tête de colonne : il range les textes INFORMATIFS de la
 * publication (rafraîchissement de l'instance, travail sans carte, autre
 * publication en cours) qui poussaient les cartes vers le bas. Un clic les ouvre
 * dans un menu par-dessus le contenu ; il ne paraît que s'il y a quelque chose à
 * lire, et dit au survol ce qu'il fait. Les alertes orange, elles, restent sous
 * le bouton de publication.
 */
export function BoutonInfosPublication({
  colonne,
  infos,
}: {
  colonne: ColumnKey;
  infos: InfosPublication | null;
}) {
  if (!infos) return null;
  return (
    <DropdownMenu>
      <Tooltip label="À propos de la mise en ligne">
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-1.5 text-faint"
            aria-label="À propos de la mise en ligne"
            data-infos-publication={colonne}
          >
            <AlertCircle className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="sm:max-w-[280px]">
        <div className="space-y-2 px-1 py-0.5 text-[12px] leading-snug">
          {infos.productionBloquee ? (
            <p className="flex items-start gap-1.5 text-warning" data-production-bloquee>
              <AlertCircle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              <span>{infos.productionBloquee}</span>
            </p>
          ) : null}

          {infos.autrePublication ? (
            <p className="flex items-start gap-1.5 text-muted" data-publication-ailleurs>
              <Loader2 className="mt-[3px] h-2.5 w-2.5 shrink-0 animate-spin" />
              <span>Une autre publication de ce projet est en cours : attendez qu’elle finisse.</span>
            </p>
          ) : null}

          {infos.moyen ? (
            <p className="text-faint" data-moyen-mise-en-ligne>
              {infos.moyen}
            </p>
          ) : null}

          {infos.enAttente ? (
            <p className="text-muted" data-enattente-publication>
              Dont {infos.enAttente.nombre} changement{infos.enAttente.nombre > 1 ? 's' : ''} enregistré
              {infos.enAttente.nombre > 1 ? 's' : ''} sans carte :{' '}
              <span className="text-faint">{infos.enAttente.titres.join(' · ')}</span>
            </p>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Le déroulé des sept étapes, pleine largeur, ouvert par le chevron de la tête.
 *
 * Avec un `run`, chaque étape porte son état RÉEL (fait, en cours, sauté, à
 * venir, échoué) ; sans lui — hors publication — les sept sont « à venir ».
 * Chaque libellé cache une courte description, révélée par le « ? » (au survol
 * à la souris, au clic partout ailleurs).
 */
function ProcessusEtapes({ run }: { run?: DeployRun }) {
  const [montre, setMontre] = React.useState<DeployStepKey | null>(null);

  return (
    <div className="mt-1.5 rounded-md border border-border bg-raised p-2 shadow-lg" data-processus-etapes>
      <ul className="space-y-1">
        {ORDRE_ETAPES.map((key) => {
          const etape = run?.steps.find((step) => step.key === key);
          const etat: EtatEtape = etape?.state ?? 'todo';
          const ouverte = montre === key;
          return (
            <li key={key} className="text-[13px]" data-etape-process={key} data-etat-process={etat}>
              <div className="flex items-start gap-1.5">
                <span className="mt-[3px] shrink-0">
                  <IconeEtape etat={etat} />
                </span>
                <span className={cn('flex-1 truncate', etat === 'failed' ? 'text-danger' : 'text-muted')}>
                  {STEP_LABELS[key]}
                </span>
                <span className="mt-[1px] shrink-0 text-[11px] text-faint">{ETAT_LABELS[etat]}</span>
                {/* Le « ? » révèle la description : au survol à la souris, au
                    clic pour un écran tactile qui n'a pas de survol. */}
                <button
                  type="button"
                  data-aide-etape={key}
                  aria-label={`À quoi sert l'étape « ${STEP_LABELS[key]} »`}
                  aria-expanded={ouverte}
                  className={cn(
                    'mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-[10px] leading-none transition-colors',
                    ouverte ? 'text-text' : 'text-faint hover:text-text',
                  )}
                  onMouseEnter={() => setMontre(key)}
                  onMouseLeave={() => setMontre((v) => (v === key ? null : v))}
                  onClick={() => setMontre((v) => (v === key ? null : key))}
                >
                  ?
                </button>
              </div>

              {ouverte ? (
                <p className="ml-[22px] mt-0.5 text-[12px] text-faint" data-description-etape={key}>
                  {STEP_DESCRIPTIONS[key]}
                </p>
              ) : null}

              {/* Un échec garde son motif sous l'étape tombée. */}
              {etat === 'failed' && etape?.log ? (
                <p className="ml-[22px] mt-0.5 whitespace-pre-wrap text-[12px] text-faint">{motifLisible(etape.log)}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Sous la tête, le compte rendu de la publication et ses commandes : l'issue
 * (réussite / échec), l'attente d'un autre lot, l'adresse contrôlée, et le
 * bouton « Arrêter » ou « Relancer ». Les sept étapes, elles, vivent dans le
 * déroulé du chevron.
 */
function DeployControls({ run }: { run: DeployRun }) {
  const [, force] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => {
    if (run.state !== 'running') return;
    const timer = setInterval(force, 1000);
    return () => clearInterval(timer);
  }, [run.state]);

  return (
    <div className="mt-2" data-etape-run={run.cible ?? 'dev'}>
      {/* Le compte rendu NOMME son étape : un déploiement en cours ne se lit
          pas comme une mise en production. */}
      {run.state === 'running' ? (
        <p className="flex items-center gap-1.5 text-[12px] text-faint">
          <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" /> En cours depuis {elapsed(run.startedAt)}
        </p>
      ) : run.state === 'success' ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted">
          <Check className="h-3 w-3 shrink-0 text-success" /> Publié ({libelleEtape(run.cible)}) : {run.cardIds.length}{' '}
          tâche(s)
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-[13px] text-danger">
          <X className="mt-[3px] h-3 w-3 shrink-0" /> Échec ({libelleEtape(run.cible)}) :{' '}
          {run.error ?? 'étape interrompue'}
        </p>
      )}

      {run.queued ? (
        <p className="mt-1 text-[12px] text-warning">Une publication est en attente : elle partira ensuite.</p>
      ) : null}

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

      {/* Un bouton de décision prend toute la largeur du bloc. */}
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
    </div>
  );
}
