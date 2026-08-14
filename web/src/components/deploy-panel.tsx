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
  etapeDePublication,
  etapeDeLaColonne,
  libelleCompteLot,
  natureDePublication,
  procedureEnPlace,
  raisonLotBloque,
  rapportAGarder,
  runDeLEtape,
} from '@haikodev/shared';
import { BoutonInitierProcedure } from '@/components/procedure-panel';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, elapsed } from '@/lib/utils';

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

type EtapeRun = DeployRun['steps'][number];
type EtatEtape = EtapeRun['state'];

/**
 * La DURÉE d'une étape terminée, en une poignée de signes. Les étapes rapides
 * (enregistrement, envoi) tiennent sous la seconde : on le dit plutôt que
 * d'afficher un tiret, qui se lirait comme « durée inconnue ».
 */
function dureeEtape(etape?: EtapeRun): string | null {
  if (!etape?.startedAt || !etape.endedAt) return null;
  const secondes = (etape.endedAt - etape.startedAt) / 1000;
  return secondes < 1 ? '< 1 s' : duration(secondes);
}

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
  onCount,
  onInitier,
}: {
  projectId: string;
  cards: Card[];
  colonne?: ColumnKey;
  /** Ouvre le tiroir de procédure, tenu par le tableau (l'icône de réglages de
   *  la tête de colonne ouvre exactement le même). */
  onInitier?: () => void;
  /** Remonte à la tête de colonne ce qui va derrière le bouton « ! ». */
  onInfos?: (infos: InfosPublication | null) => void;
  /** Remonte à la tête de colonne le compte EXACT du bouton « Tout <verbe> (n) »,
   *  pour que le chiffre de l'en-tête ne raconte plus autre chose que le lot qui
   *  partira vraiment (cartes ET travail enregistré sans carte). */
  onCount?: (n: number) => void;
}) {
  const state = useApp();
  const run = state.deploys[projectId];
  const [busy, setBusy] = React.useState(false);
  /* La mise en production met le code chez le client, clôt les cartes et les
     archive : ce geste demande une confirmation. Le déploiement sur l'instance
     de dev, lui, part toujours d'un seul clic. */
  const [confirmation, setConfirmation] = React.useState(false);
  /* L'ÉCRAN DE SÉLECTION des tâches à déployer : ouvert par le clic sur « Tout
     déployer », uniquement à la première étape (« À déployer »). Les cartes
     sont toutes cochées d'avance ; décocher en laisse dans la colonne. */
  const [selectionOuverte, setSelectionOuverte] = React.useState(false);
  const [selection, setSelection] = React.useState<Set<string>>(new Set());
  const [avertissements, setAvertissements] = React.useState<{ cardId: string; message: string }[]>([]);
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
   * LA PROCÉDURE DE CETTE ÉTAPE EST-ELLE DÉFINIE ?
   *
   * Un projet neuf n'arrive plus avec une mise en ligne toute faite : tant que
   * la procédure est vide, il n'y a pas de bouton d'action à montrer — seulement
   * de quoi l'INITIER. La réponse se lit sur le projet déjà connu de l'écran :
   * aucun aller-retour, et elle se met à jour toute seule dès que l'agent du
   * tiroir a écrit la procédure (`project.upsert`).
   */
  const projet = state.projects.find((p) => p.id === projectId);
  const enPlace = !!etape && procedureEnPlace(projet, etape.cible);

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
  /* Le contrôle d'avant-clic peut lui-même tomber (serveur qui refuse, dépôt
     illisible) : son échec était avalé, et le bloc affichait alors un état
     d'avant, muet. On le garde pour le DIRE sous le bouton. */
  const [erreurControle, setErreurControle] = React.useState<string | null>(null);
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
    // Sans procédure définie, en revanche, il n'y a rien à préparer : le bloc
    // ne montre que le bouton « Initier… », et on n'interroge pas le serveur.
    if (active || !enPlace) return;
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
          setErreurControle(null);
        })
        .catch((err: any) => {
          if (!vivant) return;
          setErreurControle(err?.message ?? 'contrôle impossible');
        });
    void controler();
    const timer = window.setInterval(controler, 20000);
    return () => {
      vivant = false;
      window.clearInterval(timer);
    };
  }, [projectId, signature, active, run?.state, colonne, enPlace]);

  /*
   * Le déroulé reste FERMÉ par défaut, même pendant MA publication : il ne
   * s'ouvre plus tout seul. C'est le chevron qui l'ouvre, et le texte d'état
   * (« En cours depuis… », adresse, étapes) vit désormais À L'INTÉRIEUR — la
   * colonne ne le déroule plus sous le bouton. Un indicateur qui tourne, posé
   * dans l'en-tête de la colonne (board.tsx), signale la publication en cours.
   */

  /*
   * Le déroulé s'ouvre EN SUPERPOSITION au-dessus des cartes : un clic à
   * l'extérieur le referme, comme un menu — publication en cours ou non.
   */
  React.useEffect(() => {
    if (!processOuvert) return;
    const surClic = (e: MouseEvent) => {
      if (teteRef.current && !teteRef.current.contains(e.target as Node)) setProcessOuvert(false);
    };
    document.addEventListener('mousedown', surClic);
    return () => document.removeEventListener('mousedown', surClic);
  }, [processOuvert]);

  const start = async (selectedCardIds?: string[]) => {
    setBusy(true);
    try {
      // L'étape part AVEC la demande : le serveur ne doit pas retomber sur la
      // première quand c'est la mise en production qu'on a cliquée.
      await client.call({ type: 'deploy.start', projectId, cible: etape?.cible, selectedCardIds });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'publication impossible');
    } finally {
      setBusy(false);
    }
  };

  /*
   * Le clic sur le bouton d'action. Pour la MISE EN PRODUCTION, il n'envoie
   * plus rien tout de suite : il ouvre la modale de confirmation, et
   * `deploy.start` n'est appelé qu'après « Publier ». Pour le DÉPLOIEMENT
   * (« À déployer »), il ouvre d'abord l'écran de sélection des tâches —
   * toutes cochées d'avance — et `deploy.start` n'est appelé qu'après avoir
   * confirmé la sélection.
   */
  const demarrer = () => {
    if (etape?.cible === 'production') {
      setConfirmation(true);
      return;
    }
    /* Aucune carte à choisir — seul du travail enregistré sans carte attend :
       un écran de sélection vide ne demanderait rien. On part directement. */
    if (!embarked.length) {
      void start();
      return;
    }
    setSelection(new Set(embarked.map((card) => card.id)));
    setAvertissements([]);
    setSelectionOuverte(true);
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

  /* Même règle pour le compte : la tête de colonne affichait le nombre de
     cartes PHYSIQUEMENT posées dans la colonne, quand le bouton affichait en
     plus le travail enregistré sans carte (`enAttente`) — deux chiffres pour
     une seule réalité. On remonte ici le total EXACT que le bouton annonce. */
  const onCountRef = React.useRef(onCount);
  onCountRef.current = onCount;
  React.useEffect(() => {
    onCountRef.current?.(aPublier);
  }, [aPublier]);

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

  /*
   * AUCUNE PROCÉDURE : rien à déployer d'un clic, mais tout à définir.
   *
   * Le bloc garde sa place en tête de colonne, avec un SEUL bouton qui ouvre le
   * tiroir où un agent demande comment cette étape doit se passer. Ni compteur,
   * ni chevron, ni déroulé : il n'y a pas encore de déroulé à montrer.
   */
  if (!enPlace) {
    return (
      <div className="mb-2 border-b border-border px-2 pt-2 pb-2" data-bloc-publication={colonne}>
        <BoutonInitierProcedure cible={etape.cible} onOuvrir={() => onInitier?.()} />
        <p className="mt-1.5 text-[12px] text-faint" data-procedure-absente={colonne}>
          Aucune procédure n’est définie pour cette étape : rien ne peut partir tant qu’elle n’existe pas.
        </p>
      </div>
    );
  }

  /* Ma publication tourne : le bouton porte alors l'étape en cours au lieu du
     verbe, et le déroulé reflète les états réels. */
  const publicationEnCours = active && mienne;
  const etapeEnCours: DeployStepKey = run?.currentStep ?? 'merge';

  /*
   * POURQUOI le bouton ne part pas — écrit sous lui, en toutes lettres.
   *
   * Le bouton s'éteignait sans un mot : lot vide, agent au travail, publication
   * ailleurs, mise en production sans prompt. Le cas le plus traître était une
   * colonne PLEINE dont aucune carte n'entrait dans le lot (une date de mise en
   * ligne périmée les écartait toutes) : le clic ne partait nulle part et rien
   * ne le disait. La règle est PURE et vit dans `shared` ; ici on ne fait que
   * lui passer ce qu'on sait.
   */
  const raisonBloquee = publicationEnCours
    ? null
    : raisonLotBloque({
        verbe: etape.verbe,
        aPublier,
        cartesDansLaColonne: cards.length,
        autrePublication: active && !mienne,
        agentsOccupes: busyAgents.map((agent) => agent.title),
        productionBloquee: productionBloquee ?? undefined,
        horsLigne: !state.connected,
      });

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
          onClick={publicationEnCours ? undefined : demarrer}
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
                  déployer », « Tout publier » en tête de « En production ».
                  Les deux parts (cartes, travail sans carte) sont NOMMÉES dès
                  qu'elles coexistent : un chiffre seul ne s'explique pas. */}
              <span className="truncate">
                Tout {etape.verbe} ({libelleCompteLot(embarked.length, enAttente.nombre)})
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
            ne pousse plus la colonne vers le bas. Le texte d'état de la
            publication (« En cours depuis… », adresse, « Arrêter ») vit ICI,
            sous les sept étapes — plus jamais étalé dans la colonne. */}
        {processOuvert ? (
          <div className="absolute inset-x-0 top-full z-20">
            {mienne && run?.state === 'success' ? (
              /* Une réussite tient en une ligne (`derouleOuvert`) : rouvrir le
                 chevron À LA MAIN ne doit pas refaire apparaître les sept
                 étapes cochées comme si la publication tournait encore —
                 seul ce résumé dit qu'elle est TERMINÉE. */
              <div
                className="mt-1.5 flex items-center gap-1.5 rounded-md border border-border bg-raised p-2 text-[13px] text-muted shadow-lg"
                data-publication-terminee
              >
                <Check className="h-3 w-3 shrink-0 text-success" />
                Publié ({libelleEtape(run.cible)}) : {run.cardIds.length} tâche(s)
              </div>
            ) : (
              <ProcessusEtapes
                run={mienne ? run : undefined}
                controls={(publicationEnCours || rapport) && run ? <DeployControls run={run} /> : null}
              />
            )}
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
          {/* Le bouton est éteint : il DIT pourquoi. Un bouton qui ne fait
              rien est pire qu'un bouton qui explique. */}
          {raisonBloquee ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-warning" data-raison-publication>
              {busyAgents.length ? (
                <Loader2 className="mt-[3px] h-2.5 w-2.5 shrink-0 animate-spin" />
              ) : (
                <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              )}
              <span>{raisonBloquee}</span>
            </p>
          ) : null}

          {/* Le contrôle d'avant-clic lui-même est tombé : on le dit plutôt que
              d'afficher un état d'avant sans prévenir. */}
          {erreurControle ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-danger" data-erreur-controle-publication>
              <X className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              <span>Le contrôle d’avant-clic a échoué : {erreurControle}</span>
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

      {/* La confirmation de la MISE EN PRODUCTION : elle nomme l'étape, rappelle
          le lot qui part (le même compte que le bouton, travail sans carte
          compris) et prévient que ces cartes seront closes puis archivées.
          « Publier » lance seul la publication ; « Annuler » ne touche à rien. */}
      <ConfirmDialog
        open={confirmation}
        title="Mise en production"
        description={
          aPublier > 1 ? (
            <>
              {aPublier} tâches vont partir chez le client. Une fois publiées, elles seront closes puis archivées.
            </>
          ) : (
            <>Une tâche va partir chez le client. Une fois publiée, elle sera close puis archivée.</>
          )
        }
        confirmLabel="Publier"
        danger
        onConfirm={() => void start()}
        onClose={() => setConfirmation(false)}
      />

      {/* L'ÉCRAN DE SÉLECTION des tâches à déployer, ouvert par « Tout
          déployer » : la liste du lot de « À déployer », cochée d'avance.
          Décocher une carte la laisse dans la colonne, pour le prochain coup. */}
      <SelectionDeploiementDialog
        open={selectionOuverte}
        projectId={projectId}
        cards={embarked}
        enAttente={enAttente}
        selection={selection}
        onChangeSelection={setSelection}
        avertissements={avertissements}
        onChangeAvertissements={setAvertissements}
        busy={busy}
        onClose={() => setSelectionOuverte(false)}
        onConfirm={() => {
          setSelectionOuverte(false);
          void start(Array.from(selection));
        }}
      />
    </div>
  );
}

/**
 * L'ÉCRAN DE SÉLECTION des tâches à déployer.
 *
 * Une case par carte, toutes cochées d'avance ; décocher en laisse dans « À
 * déployer ». Le serveur est interrogé à chaque case cochée ou décochée pour
 * dire ce qui coincerait avec CETTE sélection (fichiers communs avec une
 * carte laissée de côté) — un signal, pas un refus : on peut publier quand
 * même.
 */
function SelectionDeploiementDialog({
  open,
  projectId,
  cards,
  enAttente,
  selection,
  onChangeSelection,
  avertissements,
  onChangeAvertissements,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  projectId: string;
  cards: Card[];
  enAttente: { nombre: number; titres: string[] };
  selection: Set<string>;
  onChangeSelection: (selection: Set<string>) => void;
  avertissements: { cardId: string; message: string }[];
  onChangeAvertissements: (avertissements: { cardId: string; message: string }[]) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call({ type: 'deploy.selection', projectId, source: 'to_deploy', selectedCardIds: Array.from(selection) })
      .then((res: any) => {
        if (vivant) onChangeAvertissements(res?.avertissements ?? []);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, Array.from(selection).sort().join(',')]);

  const basculer = (cardId: string) => {
    const suite = new Set(selection);
    if (suite.has(cardId)) suite.delete(cardId);
    else suite.add(cardId);
    onChangeSelection(suite);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-selection-deploiement>
        <DialogTitle>Tâches à déployer</DialogTitle>
        <DialogDescription>
          Décochez les tâches à laisser de côté : elles resteront dans « À déployer » pour la prochaine fois.
        </DialogDescription>

        <ul className="mt-3 space-y-1.5">
          {cards.map((card) => {
            const alertes = avertissements.filter((a) => a.cardId === card.id);
            return (
              <li key={card.id} data-carte-selection={card.id}>
                <label className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={selection.has(card.id)}
                    onChange={() => basculer(card.id)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    data-case-selection={card.id}
                  />
                  <span className="flex-1 truncate text-text">{card.title}</span>
                </label>
                {alertes.length ? (
                  <ul className="mt-1 space-y-1 pl-2">
                    {alertes.map((alerte, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12px] text-warning" data-avertissement-selection>
                        <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
                        <span>{alerte.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>

        {enAttente.nombre ? (
          <p className="mt-2 text-[12px] text-faint">
            + {enAttente.nombre} changement{enAttente.nombre > 1 ? 's' : ''} enregistré
            {enAttente.nombre > 1 ? 's' : ''} sans carte, toujours embarqué{enAttente.nombre > 1 ? 's' : ''}.
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          {/* Tout décocher n'est pas forcément une impasse : le travail
              enregistré sans carte part quand même. Le bouton ne s'éteint donc
              que si RIEN ne partirait — et il le dit alors juste au-dessus. */}
          {selection.size === 0 && !enAttente.nombre ? (
            <p className="flex-1 self-center text-[12px] text-warning" data-raison-selection-vide>
              Aucune tâche cochée : il n’y aurait rien à déployer.
            </p>
          ) : null}
          <Button
            size="sm"
            disabled={selection.size + enAttente.nombre === 0 || busy}
            onClick={onConfirm}
            data-bouton-deployer-selection
          >
            {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
            Déployer ({libelleCompteLot(selection.size, enAttente.nombre)})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
 * Il AVANCE À VUE : le serveur réémet l'état à chaque pas, si bien qu'une étape
 * en cours porte sa PROGRESSION (la branche en cours de fusion, le contrôle
 * lancé, la commande de construction) et une étape terminée sa DURÉE. La liste
 * n'annonce QUE ce qui va réellement se faire : une étape SAUTÉE n'y figure pas
 * — le redémarrage du serveur, souvent inutile, disparaît ainsi dès qu'on sait
 * qu'il ne sera pas fait.
 *
 * Sans `run` — chevron ouvert hors publication —, les sept sont « à venir » :
 * c'est l'aperçu du déroulé complet, aucune étape n'étant encore décidée.
 * Chaque libellé cache une courte description, révélée par le « ? » (au survol
 * à la souris, au clic partout ailleurs).
 *
 * `controls` (le texte d'état — « En cours depuis… », adresse, « Arrêter » /
 * « Relancer ») vit DANS le même cadre que les sept étapes, sous la liste :
 * un seul bloc visuel pour tout le suivi du déploiement, jamais deux cadres
 * empilés.
 */
function ProcessusEtapes({ run, controls }: { run?: DeployRun; controls?: React.ReactNode }) {
  const [montre, setMontre] = React.useState<DeployStepKey | null>(null);

  // Une étape sautée ne s'affiche pas : la liste ne montre que ce qui va
  // réellement être fait. Hors publication (aucun run), rien n'est sauté.
  const affichees = ORDRE_ETAPES.filter((key) => run?.steps.find((step) => step.key === key)?.state !== 'skipped');

  return (
    <div className="mt-1.5 rounded-md border border-border bg-raised p-2 shadow-lg" data-processus-etapes>
      <ul className="space-y-1">
        {affichees.map((key) => {
          const etape = run?.steps.find((step) => step.key === key);
          const etat: EtatEtape = etape?.state ?? 'todo';
          const ouverte = montre === key;
          const duree = dureeEtape(etape);
          return (
            <li key={key} className="text-[13px]" data-etape-process={key} data-etat-process={etat}>
              <div className="flex items-start gap-1.5">
                <span className="mt-[3px] shrink-0">
                  <IconeEtape etat={etat} />
                </span>
                <span className={cn('flex-1 truncate', etat === 'failed' ? 'text-danger' : 'text-muted')}>
                  {STEP_LABELS[key]}
                </span>
                {/* L'état, et la DURÉE quand l'étape est terminée : « fait · 4 s ». */}
                <span className="mt-[1px] shrink-0 text-[11px] text-faint" data-etat-etape={etat}>
                  {ETAT_LABELS[etat]}
                  {duree && (etat === 'done' || etat === 'failed') ? (
                    <span data-duree-etape={key}> · {duree}</span>
                  ) : null}
                </span>
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

              {/* PENDANT qu'une étape tourne, ce qu'elle est en train de faire :
                  la branche en cours de fusion, le contrôle lancé, la commande. */}
              {etat === 'running' && etape?.progress ? (
                <p className="ml-[22px] mt-0.5 text-[12px] text-muted" data-progress-etape={key}>
                  {etape.progress}
                </p>
              ) : null}

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
      {controls}
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
        (() => {
          /* CASSÉE ou seulement INTERROMPUE ? Le rouge d'alerte est réservé au
             code qui ne passe pas ; une coupure (redémarrage, arrêt demandé) se
             dit en orange avec « Interrompue ». La nature se lit sur une étape
             RÉELLEMENT tombée, jamais sur `currentStep`. */
          const etapeTombee = run.steps.find((step) => step.state === 'failed')?.key ?? null;
          const cassee = natureDePublication({ etat: run.state, etapeTombee, motif: run.error }) === 'cassee';
          return (
            <p className={cn('flex items-start gap-1.5 text-[13px]', cassee ? 'text-danger' : 'text-warning')}>
              {cassee ? (
                <X className="mt-[3px] h-3 w-3 shrink-0" />
              ) : (
                <AlertTriangle className="mt-[3px] h-3 w-3 shrink-0" />
              )}{' '}
              {cassee ? 'Échec' : 'Interrompue'} ({libelleEtape(run.cible)}) : {run.error ?? 'étape interrompue'}
            </p>
          );
        })()
      )}

      {run.repriseApresCoupure ? (
        <p className="mt-1 text-[12px] text-faint" data-reprise-coupure>
          Reprise après une coupure du serveur.
        </p>
      ) : null}

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
