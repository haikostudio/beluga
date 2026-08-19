import * as React from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  Rocket,
  X,
  AlertTriangle,
  FilePlus2,
} from 'lucide-react';
import {
  Card,
  ColumnKey,
  DeployRun,
  DeployStepKey,
  EtapeDePublication,
  PlanDeMiseEnLigne,
  TravailSansCarte,
  alerteTravailSansCarte,
  annonceDeHeurts,
  selectionSansHeurts,
  libelleCartePorteuse,
  etapeDePublication,
  etapeDeLaColonne,
  libelleCompteLot,
  mentionPortee,
  procedureEnPlace,
  raisonLotBloque,
  rapportAGarder,
  runDeLEtape,
} from '@haikodev/shared';
import { BoutonInitierProcedure } from '@/components/procedure-panel';
/* LE DÉROULÉ VIT DANS SON PROPRE TIROIR : les sept étapes, leur fil historique
   et le compte rendu de la publication ne sont plus dessinés ici. Ce fichier
   garde ce qui décide (le bouton, la sélection, les alertes de la colonne). */
import { DeployControls, STEP_LABELS, TiroirDeploiement } from '@/components/tiroir-deploiement';
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
import { t } from '@/lib/langue';

type Conflict = { cardId: string; title: string; branch: string; files: string[] };

/** L'étape d'une publication, nommée comme dans la règle pure. */
function libelleEtape(cible: DeployRun['cible']): string {
  return t(etapeDePublication(cible).libelle);
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
 * tête de colonne : comment l'instance sera rafraîchie et l'éventuelle
 * publication déjà en cours ailleurs. Rien d'alarmant — les alertes orange
 * (agent au travail, conflits) restent sous le bouton.
 *
 * LE TRAVAIL SANS CARTE N'EST PLUS ICI : rangé derrière ce bouton, il fallait
 * savoir qu'il existait pour aller le lire. Il s'affiche désormais en clair
 * DANS la colonne (`AlerteTravailSansCarte`), là où on cherche ce qui va
 * partir.
 */
export type InfosPublication = {
  /** Comment l'instance de dev sera rafraîchie (« HaikoDev se construit… »). */
  moyen?: string;
  /** Une autre publication de ce projet tourne déjà. */
  autrePublication?: boolean;
  /** Une mise en production sans prompt réglé : elle ne peut pas partir. */
  productionBloquee?: string;
  /** Pourquoi le bouton d'action est éteint (lot vide, agents occupés, lien
   *  coupé…) — la même phrase qu'avant, désormais lue depuis ce bouton plutôt
   *  qu'affichée en permanence sous la colonne. */
  raison?: string;
  /** La raison ci-dessus vient d'agents encore au travail : une roue plutôt
   *  qu'un triangle. */
  raisonEnCours?: boolean;
  /** Des conflits prévus sur le lot, que l'agent de publication résoudra en
   *  route — informatif, pas une alerte à traiter. */
  conflicts?: Conflict[];
};

export function DeployPanel({
  projectId,
  cards,
  colonne = 'to_deploy',
  onInfos,
  onSansCarte,
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
  /** Remonte à la COLONNE le travail enregistré sans carte pour le porter, afin
   *  qu'elle l'affiche en clair au-dessus des cartes. Il ne compte JAMAIS dans
   *  le chiffre de la tête : celui-ci compte les cartes affichées, et rien
   *  d'autre (voir `shared/src/colonne-a-deployer.ts`). */
  onSansCarte?: (travail: TravailSansCarte | null) => void;
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
          setErreurControle(err?.message ?? t('contrôle impossible'));
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
   * PLUS DE FERMETURE AU CLIC EXTÉRIEUR : le déroulé n'est plus un panneau posé
   * sur les cartes mais un TIROIR, avec son propre voile et sa poignée. Guetter
   * les clics du document le refermerait à la première ligne cliquée DEDANS —
   * le tiroir vivant dans un portail, il n'est contenu par aucune tête.
   */

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
  /*
   * POURQUOI le bouton ne part pas — lu depuis le bouton « ! » plutôt qu'écrit
   * en permanence sous la colonne. La règle est PURE et vit dans `shared` ;
   * ici on ne fait que lui passer ce qu'on sait. `publicationEnCours` vaut
   * `active && mienne` — le déroulé des étapes dit alors déjà tout.
   */
  const raisonBloquee =
    etape && !(active && mienne)
      ? raisonLotBloque({
          verbe: etape.verbe,
          aPublier,
          cartesDansLaColonne: cards.length,
          autrePublication: active && !mienne,
          agentsOccupes: busyAgents.map((agent) => agent.title),
          productionBloquee: productionBloquee ?? undefined,
          horsLigne: !state.connected,
        })
      : null;

  const infosPublication = React.useMemo<InfosPublication | null>(() => {
    if (active && mienne) return null;
    const infos: InfosPublication = {};
    if (active && !mienne) infos.autrePublication = true;
    if (miseEnLigne && aPublier && etape?.cible === 'dev') infos.moyen = miseEnLigne.raison;
    // Une mise en production sans prompt réglé : on l'explique dès qu'un lot
    // attend et ne peut pas partir. Le déploiement ne connaît jamais ce cas.
    if (productionBloquee && aPublier) infos.productionBloquee = productionBloquee;
    // La raison du bouton éteint ne se répète pas : quand elle recouvre déjà
    // une mise en production bloquée ou une autre publication en cours, ces
    // deux champs dédiés suffisent — le texte serait identique deux fois.
    if (raisonBloquee && !infos.productionBloquee && !infos.autrePublication) {
      infos.raison = raisonBloquee;
      infos.raisonEnCours = busyAgents.length > 0;
    }
    if (conflicts.length) infos.conflicts = conflicts;
    return infos.moyen ||
      infos.autrePublication ||
      infos.productionBloquee ||
      infos.raison ||
      infos.conflicts
      ? infos
      : null;
  }, [active, mienne, miseEnLigne, aPublier, etape?.cible, enAttente, productionBloquee, raisonBloquee, busyAgents, conflicts]);

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
   * LE TRAVAIL SANS CARTE REMONTE À LA COLONNE, pour y être VU.
   *
   * Il gonflait le compteur de la tête sans pouvoir s'afficher nulle part : la
   * tête annonçait « À DÉPLOYER 1 » et la colonne, dessous, « Rien à mettre en
   * ligne pour l'instant ». Le compteur est rendu à la liste (board.tsx compte
   * ses cartes, un point c'est tout) et ce qui n'a pas de carte s'écrit en
   * clair DANS la colonne, avec ce qui a été trouvé.
   */
  const onSansCarteRef = React.useRef(onSansCarte);
  onSansCarteRef.current = onSansCarte;
  const signatureSansCarte = `${enAttente.nombre}|${enAttente.titres.join('|')}`;
  React.useEffect(() => {
    onSansCarteRef.current?.(enAttente.nombre ? enAttente : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureSansCarte]);

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
          {t('Aucune procédure n’est définie pour cette étape : rien ne peut partir tant qu’elle n’existe pas.')}</p>
        {/* POURQUOI elle n'a pas de défaut : c'est la seule étape qui sort de
            ce serveur, et rien n'en sort sans décision explicite. */}
        <p className="mt-1 text-[12px] text-faint" data-portee-etape={colonne}>
          {t(mentionPortee(etape.cible))}</p>
      </div>
    );
  }

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
      <div className="relative flex items-stretch gap-1">
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
                {t('Tout {v0} ({v1})', { v0: etape.verbe, v1: libelleCompteLot(embarked.length, enAttente.nombre) })}</span>
            </>
          )}
        </Button>

        {/* Le chevron n'ouvre plus un panneau posé sur les cartes : il ouvre le
            TIROIR de la publication, où chaque étape porte son fil. */}
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
      </div>

      {/* LE TIROIR : les sept étapes, leur fil historique, et sous elles le
          compte rendu de la publication (« En cours depuis… », adresse,
          « Arrêter »). Il ne montre le déroulé de MA publication que si elle est
          mienne — celle d'un autre projet n'a rien à raconter ici. */}
      <TiroirDeploiement
        open={processOuvert}
        onClose={() => setProcessOuvert(false)}
        run={mienne ? run : undefined}
        controls={(publicationEnCours || rapport) && run ? <DeployControls run={run} /> : null}
      />

      {!publicationEnCours ? (
        <>
          {/* Plus aucun bandeau jaune en permanence sous le bouton : pourquoi
              il est éteint (lot vide, agents occupés, conflits prévus…) se lit
              désormais depuis le bouton « ! » de la tête de colonne
              (`infosPublication.raison` / `.conflicts`), à la demande. Seul un
              VRAI échec — le contrôle d'avant-clic lui-même tombé — reste ici,
              en rouge : ce n'est pas une explication de routine. */}
          {erreurControle ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-danger" data-erreur-controle-publication>
              <X className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              <span>{t('Le contrôle d’avant-clic a échoué : {erreurControle}', { erreurControle })}</span>
            </p>
          ) : null}
        </>
      ) : null}

      {/* La confirmation de la MISE EN PRODUCTION : elle nomme l'étape, rappelle
          le lot qui part (le même compte que le bouton, travail sans carte
          compris) et prévient que ces cartes seront closes puis archivées.
          « Publier » lance seul la publication ; « Annuler » ne touche à rien. */}
      <ConfirmDialog
        open={confirmation}
        title={t('Mise en production')}
        description={
          aPublier > 1 ? (
            <>
              {aPublier}  {t('tâches vont partir chez le client. Une fois publiées, elles seront closes puis archivées.')}
</>
          ) : (
            <>{t('Une tâche va partir chez le client. Une fois publiée, elle sera close puis archivée.')}</>
          )
        }
        confirmLabel={t('Publier')}
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
        conflicts={conflicts}
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
 *
 * ET IL DIT CE QUI VA SE HEURTER AVANT LE CLIC. La prévision existait déjà
 * (`deploy.check` rend `conflicts`, lus par `git merge-tree` en mémoire) mais
 * ne servait qu'à une ligne informative derrière le bouton « ! ». L'audit du
 * 18/08/2026 a chiffré ce que coûte un gros lot — 0,11 conflit en moyenne
 * pour une branche, 2,00 pour dix, et 370 s par fusion en conflit contre
 * 2,1 s sans : entrer dans ce cas sans le savoir est le vrai défaut. L'écran
 * l'annonce donc, et propose de PUBLIER EN DEUX FOIS — les tâches propres
 * maintenant, les conflictuelles au coup suivant, seules et sans le cumul du
 * lot.
 */
function SelectionDeploiementDialog({
  open,
  projectId,
  cards,
  enAttente,
  conflicts,
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
  /** Ce qui se heurte déjà à la branche d'accueil, prévu avant le clic. */
  conflicts: Conflict[];
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

  /*
   * L'ANNONCE DES HEURTS ne porte que sur les cartes AFFICHÉES : une prévision
   * gardée d'un lot précédent annoncerait des tâches qui ne sont plus là. La
   * phrase et le second lot sont des règles PURES (`shared/src/fusion-du-lot.ts`).
   */
  const idsAffiches = new Set(cards.map((card) => card.id));
  const heurtent = conflicts.map((c) => c.cardId).filter((id) => idsAffiches.has(id));
  const annonce = annonceDeHeurts(heurtent.length, cards.length);
  const propres = selectionSansHeurts(cards, heurtent);
  /* « Publier en deux fois » n'a de sens que s'il reste quelque chose au
     premier lot, et si la sélection n'est pas DÉJÀ ce premier lot. */
  const deuxFoisPossible =
    !!annonce &&
    propres.size > 0 &&
    !(selection.size === propres.size && [...propres].every((id) => selection.has(id)));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-selection-deploiement>
        <DialogTitle>{t('Tâches à déployer')}</DialogTitle>
        <DialogDescription>
          {t('Décochez les tâches à laisser de côté : elles resteront dans « À déployer » pour la prochaine fois.')}</DialogDescription>

        {annonce ? (
          <div
            className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[12px] text-warning"
            data-annonce-heurts
          >
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              <span>{annonce}</span>
            </p>
            {deuxFoisPossible ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => onChangeSelection(propres)}
                data-publier-en-deux-fois
              >
                {t('Publier en deux fois ({v0} sans heurt maintenant)', { v0: propres.size })}</Button>
            ) : null}
          </div>
        ) : null}

        <ul className="mt-3 space-y-1.5">
          {cards.map((card) => {
            const alertes = avertissements.filter((a) => a.cardId === card.id);
            /* La tâche qui se heurte est NOMMÉE dans la liste : l'annonce
               d'en-tête dit combien, la ligne dit lesquelles. */
            const heurte = heurtent.includes(card.id);
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
                  {heurte ? (
                    <span className="shrink-0 text-[11px] text-warning" data-carte-heurte={card.id}>
                      {t('se heurte')}</span>
                  ) : null}
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
            {t('+ {v0} changement{v1} enregistré {v2} sans carte, toujours embarqué{v3}.', { v0: enAttente.nombre, v1: enAttente.nombre > 1 ? 's' : '', v2: enAttente.nombre > 1 ? 's' : '', v3: enAttente.nombre > 1 ? 's' : '' })}</p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('Annuler')}</Button>
          {/* Tout décocher n'est pas forcément une impasse : le travail
              enregistré sans carte part quand même. Le bouton ne s'éteint donc
              que si RIEN ne partirait — et il le dit alors juste au-dessus. */}
          {selection.size === 0 && !enAttente.nombre ? (
            <p className="flex-1 self-center text-[12px] text-warning" data-raison-selection-vide>
              {t('Aucune tâche cochée : il n’y aurait rien à déployer.')}</p>
          ) : null}
          <Button
            size="sm"
            disabled={selection.size + enAttente.nombre === 0 || busy}
            onClick={onConfirm}
            data-bouton-deployer-selection
          >
            {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
            
{t('Déployer (')}{libelleCompteLot(selection.size, enAttente.nombre)})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * L'AVERTISSEMENT « du travail attend sans carte », posé DANS la colonne, juste
 * au-dessus des cartes.
 *
 * C'est le second volet de la règle : le compteur ne compte plus que ce que la
 * liste montre, donc ce qui n'a pas de carte doit se voir quelque part — sinon
 * on l'a simplement rendu invisible au lieu de le rendre honnête. Il NOMME ce
 * qui a été trouvé (les titres réels des enregistrements) et où c'est (la
 * branche principale), et il ne propose rien : mettre en ligne reste un geste
 * de l'utilisateur.
 *
 * Le texte entier vient de la règle pure (`alerteTravailSansCarte`) : cet
 * écran ne fait que le dessiner.
 */
export function AlerteTravailSansCarte({
  colonne,
  projectId,
  travail,
  verbe,
  onFiche,
}: {
  colonne: ColumnKey;
  projectId: string;
  travail: TravailSansCarte | null;
  verbe: string;
  /** La carte a été créée : la colonne oublie son avertissement, le contrôle
   *  suivant confirmera qu'il n'y a plus rien d'anonyme. */
  onFiche?: () => void;
}) {
  const alerte = alerteTravailSansCarte(travail, verbe);
  if (!alerte) return null;
  /*
   * DONNER UNE FICHE À CE TRAVAIL, d'un clic. Le bouton part en requête et le
   * dit tout seul (roue, puis coche) — c'est le socle `Button` qui s'en charge,
   * à condition qu'on lui RENDE la promesse et qu'on RELANCE l'erreur, sinon il
   * croirait avoir réussi. Rien n'est publié : la carte est simplement posée
   * dans la colonne, où elle devient visible et comptée comme les autres.
   */
  const ficher = () =>
    client
      .call({ type: 'deploy.ficherSansCarte', projectId })
      .then(() => {
        onFiche?.();
      })
      .catch((err: any) => {
        client.pushToast('error', err?.message ?? t('Carte impossible à créer'));
        throw err;
      });
  return (
    <div
      data-travail-sans-carte={colonne}
      data-sans-carte-nombre={travail?.nombre ?? 0}
      className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[12px] leading-snug"
    >
      <p className="flex items-start gap-1.5 font-medium text-warning">
        <AlertTriangle className="mt-[3px] h-3 w-3 shrink-0" />
        <span>{alerte.titre}</span>
      </p>
      <p className="mt-1 text-muted">{alerte.phrase}</p>
      {alerte.titres.length ? (
        <ul className="mt-1 space-y-0.5 text-faint">
          {alerte.titres.map((titre, i) => (
            <li key={`${i}-${titre}`} className="truncate" title={titre}>
              • {titre}
            </li>
          ))}
          {alerte.tronquee ? <li className="text-faint">• …</li> : null}
        </ul>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 h-7 w-full text-[12px]"
        data-ficher-sans-carte={colonne}
        onClick={ficher}
      >
        <FilePlus2 className="h-3 w-3" /> {libelleCartePorteuse(travail?.nombre ?? 0)}
      </Button>
    </div>
  );
}

/**
 * Le bouton « ! » de la tête de colonne : il range les textes INFORMATIFS de la
 * publication (rafraîchissement de l'instance, autre publication en cours) qui
 * poussaient les cartes vers le bas. Un clic les ouvre
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
      <Tooltip label={t('À propos de la mise en ligne')}>
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
              <span>{t('Une autre publication de ce projet est en cours : attendez qu’elle finisse.')}</span>
            </p>
          ) : null}

          {/* Pourquoi le bouton d'action est éteint (lot vide, agents
              occupés, lien coupé…) — la même phrase qu'avant, lue ici plutôt
              qu'affichée en permanence sous le bouton. */}
          {infos.raison ? (
            <p className="flex items-start gap-1.5 text-warning" data-raison-publication>
              {infos.raisonEnCours ? (
                <Loader2 className="mt-[3px] h-2.5 w-2.5 shrink-0 animate-spin" />
              ) : (
                <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
              )}
              <span>{infos.raison}</span>
            </p>
          ) : null}

          {infos.moyen ? (
            <p className="text-faint" data-moyen-mise-en-ligne>
              {infos.moyen}
            </p>
          ) : null}

          {infos.conflicts?.length ? (
            <ul className="space-y-1.5">
              {infos.conflicts.map((conflict) => (
                <li key={conflict.cardId} className="flex items-start gap-1.5 text-warning" data-conflit-publication>
                  <AlertTriangle className="mt-[3px] h-2.5 w-2.5 shrink-0" />
                  <span>
                    {t('Conflit prévu sur « {v0} » {v1} — l\'agent de publication le résoudra en route. Sans succès, la carte restera ici pour le prochain coup.', { v0: conflict.title, v1: conflict.files.length ? ` (${conflict.files.slice(0, 3).join(', ')})` : '' })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
