/*
 * LE BOUTON « PUBLIER », TOUT À DROITE DE LA BARRE D'UN PROJET (refonte du 13/11/2026 — maquette B #15ca, puis
 * #f997 et #6464).
 *
 * Un seul bouton remplace « Déployer (n) » et la fusée de la mise en production. Il porte le nombre de tâches en
 * attente et ouvre un menu à deux listes, l'une sous l'autre :
 *  - « À déployer » : les tâches terminées, chacune avec sa case cochée d'office, et « Déployer N tâches » ;
 *  - « Déployées, pas encore en production » : les tâches déjà sur le serveur de test, à cocher une par une, et
 *    « Mettre N tâches en production » — seules les cochées partent (`server/src/production-partielle.ts`). Une
 *    tâche cochée qui a besoin d'une tâche décochée est signalée AVANT le départ, avec « Cocher les deux ».
 * Au pied : le déploiement automatique, la procédure, et l'historique (le déroulé des publications).
 *
 * LE MOTEUR RESTE LE MÊME. Les gestes de publication d'avant (`GestesDePublicationDeCarte`) sont montés cachés : ce
 * sont eux qui ouvrent le déroulé du déploiement et le tiroir de la mise en production, avec leurs étapes, leurs
 * réparations et leurs agents. Un regroupement de projets garde ses gestes à lui (`DeploiementDeGroupe`).
 */
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown, GitMerge, History, Loader2, Rocket, Settings2, Sparkles, TriangleAlert } from '@/components/ui/icones';
import {
  agentDeConfiguration,
  construireFragment,
  depanneurVivant,
  motDuBoutonPublier,
  type CiblePublication,
  type DeployRun,
  type EtatProcedure,
  carteMarketingCachee,
  estEtapeDeSuite,
  estUnRegroupement,
  horsDuLotDeDeploiement,
  type Card,
} from '@beluga/shared';
import { GestesDePublicationDeCarte } from '@/components/geste-publication-carte';
import { InterrupteurDeploiementAuto } from '@/components/deploy-panel';
import { CaseACocher, Drawer, EnteteDeFeuille, ZoneDefilement } from '@/components/ui';
import { aLeNiveauSurLeProjet } from '@/lib/mes-droits';
import { ouvrirAgentDeConfiguration, ouvrirRubriqueDeLEtape } from '@/lib/ouvrir-config-projet';
import { BarreProgression } from '@/components/barre-progression';
import {
  EnteteDuSuivi,
  HistoriqueDePublication,
  ListeDEtapes,
  lignesDeLaPublication,
  ouvrirHistoriqueDePublication,
  useSuiviDePublication,
} from '@/components/suivi-de-publication';
import { LienInterne, naviguerVers } from '@/components/ui/lien-interne';
import { BoutonRelancerLaPublication, ouvrirLeDepannage } from '@/components/mises-en-ligne';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { estTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

interface TacheAProduire {
  cardId: string;
  titre: string;
  deployeeLe: number;
  separable: boolean;
}
interface Verdict {
  ok: boolean;
  manques: { cardId: string; besoinDe: string[]; raison: string }[];
}

/** « il y a 2 h », « hier à 14:58 », « le 11 nov. à 19:19 ». */
function quand(date: number): string {
  const ecart = Date.now() - date;
  const minutes = Math.round(ecart / 60000);
  if (minutes < 60) return t('il y a {v0} min', { v0: Math.max(1, minutes) });
  const heure = new Date(date).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  const jour = new Date(date);
  const aujourdhui = new Date();
  const hier = new Date(Date.now() - 86400000);
  if (jour.toDateString() === aujourdhui.toDateString()) return t('il y a {v0} h', { v0: Math.round(minutes / 60) });
  if (jour.toDateString() === hier.toDateString()) return t('hier à {v0}', { v0: heure });
  return t('le {v0} à {v1}', { v0: jour.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' }), v1: heure });
}

const pluriel = (n: number) => (n > 1 ? t('{v0} tâches', { v0: n }) : t('{v0} tâche', { v0: n }));

/** LES TÂCHES À DÉPLOYER : la même règle que la colonne « À déployer » (pas de média, pas d'étape de suite, pas encore en ligne). */
function useADeployer(projectId: string): Card[] {
  const state = useApp();
  return React.useMemo(
    () =>
      Object.values(state.cards)
        .filter(
          (card: Card) =>
            card.projectId === projectId &&
            card.column === 'to_deploy' &&
            !card.deployedAt &&
            !carteMarketingCachee(card) &&
            !estEtapeDeSuite(card) &&
            !horsDuLotDeDeploiement(card),
        )
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [state.cards, projectId],
  );
}

/** CE QUI ATTEND LA PRODUCTION : une lecture en base, refaite à l'ouverture et après chaque publication. */
function useAProduire(projectId: string): TacheAProduire[] | null {
  const state = useApp();
  const run = state.deploys[projectId];
  const [aProduire, setAProduire] = React.useState<TacheAProduire[] | null>(null);
  React.useEffect(() => {
    if (!projectId) return;
    let vivant = true;
    let minuteur = 0;
    /* UNE LECTURE PARTIE AVANT QUE LE CANAL SOIT PRÊT ÉCHOUE (premier affichage, retour de veille) : elle est
       retentée, au lieu d'annoncer « rien en attente » — le compteur de « Publier » disait 2 au lieu de 150. */
    const lire = (essai: number) =>
      void client
        .call<{ taches: TacheAProduire[] }>({ type: 'deploy.aProduire', projectId }, 20000)
        .then((r) => vivant && setAProduire(r.taches ?? []))
        .catch(() => {
          if (!vivant) return;
          if (essai < 3) minuteur = window.setTimeout(() => lire(essai + 1), 1500 * essai);
          else setAProduire([]);
        });
    lire(1);
    return () => {
      vivant = false;
      window.clearTimeout(minuteur);
    };
  }, [projectId, run?.id, run?.state]);
  return aProduire;
}

/** Le droit de publier, et le cas d'un regroupement (qui coche des PROJETS, pas des tâches — DEC-435). */
export function usePublication(projectId: string) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  return {
    projet,
    /* UN PROJET LÉGER (entreprise extérieure, 14/11/2026) n'a rien à publier : pas de bouton. */
    permis: !!projet && !projet.leger && aLeNiveauSurLeProjet(state, projectId, 'deployer'),
    regroupement: !!projet && estUnRegroupement(projet),
  };
}

export function BoutonPublier({ projectId }: { projectId: string }) {
  const { permis, regroupement } = usePublication(projectId);
  const [ouvert, setOuvert] = React.useState(false);
  const aDeployer = useADeployer(projectId);
  const suivi = useSuiviDePublication(projectId);
  const mot = motDuBoutonPublier(suivi.vue);
  const declencheur = React.useRef<HTMLButtonElement>(null);
  /* LA LIGNE DE LA COLONNE (« Déploiement · 45 % ») OUVRE CE MENU, plus le volet (13/11/2026).
     UN SEUL MENU, CELUI DU BOUTON QU'ON VOIT (15/11/2026, capture #b0e2) : les écrans gardés cachés gardent leur
     propre barre, donc leur propre bouton « Publier » ; ouvert sur un bouton caché, le menu se posait en haut à
     gauche de l'écran, en plus de celui de droite. */
  React.useEffect(() => {
    const ouvrir = (event: Event) => {
      const vise = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      const visible = !!declencheur.current && declencheur.current.getClientRects().length > 0;
      if (!estTelephone() && visible && (!vise || vise === projectId)) setOuvert(true);
    };
    window.addEventListener(EVENEMENT_OUVRIR_PUBLIER, ouvrir);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_PUBLIER, ouvrir);
  }, [projectId]);
  if (!permis) return null;
  if (regroupement) return <GestesDePublicationDeCarte projectId={projectId} />;
  /* LE CHIFFRE DE « PUBLIER » COMPTE CE QUI ATTEND D'ÊTRE DÉPLOYÉ, ET RIEN D'AUTRE (décision du 13/11/2026). Il
     additionnait aussi ce qui attend la mise en production : « Publier 153 » pour deux tâches à déployer. */
  const enAttente = aDeployer.length;
  return (
    <>
      {/* LE MOTEUR D'AVANT, CACHÉ : la confirmation de la mise en production part de lui. */}
      <GestesDePublicationDeCarte projectId={projectId} enMenu />
      <PopoverPrimitive.Root open={ouvert} onOpenChange={setOuvert}>
        <PopoverPrimitive.Trigger asChild>
          <button
            ref={declencheur}
            type="button"
            /* LE BOUTON SE VOIT (demande du 13/11/2026, capture #49e5) : un aplat violet plein, le seul de la barre.
               PENDANT UN TRAVAIL (maquette #625e) : roue, « Déploiement · 45 % », et une barre fine au bas du bouton
               entier. BLOQUÉ : un point rouge en haut à droite. */
            className={cn(
              'relative ml-1 flex h-8 shrink-0 items-center gap-2 overflow-hidden rounded-[9px] bg-teinte-plein pl-2.5 pr-2 text-[13.5px] font-medium text-sur-couleur transition-opacity hover:opacity-90',
              ouvert && 'opacity-90',
            )}
            data-bouton-publier
            data-en-attente={enAttente}
            data-vue-publier={suivi.vue.genre}
            data-publication-bloquee={suivi.bloquee ? '' : undefined}
            aria-label="Publier"
          >
            {mot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            <span className="whitespace-nowrap">
              {mot ? (suivi.pourcent !== null ? t('{v0} · {v1} %', { v0: t(mot), v1: suivi.pourcent }) : t(mot)) : t('Publier')}
            </span>
            {enAttente && !mot ? (
              <span className="rounded-full bg-sur-couleur/20 px-1.5 text-[11.5px] leading-[18px] tabular-nums">{enAttente}</span>
            ) : null}
            <ChevronDown className="h-3.5 w-3.5 opacity-80" />
            {mot ? (
              <BarreProgression
                pourcent={suivi.pourcent}
                teinte="sur-violet"
                className="absolute inset-x-0 bottom-0 h-[3px] bg-sur-couleur/25 [&>span]:opacity-60"
                data-barre-du-bouton-publier=""
              />
            ) : null}
            {suivi.bloquee ? (
              <span className="absolute right-0.5 top-0.5 h-[9px] w-[9px] rounded-full bg-danger ring-2 ring-bg" data-point-rouge-publier />
            ) : null}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="z-[60] flex max-h-[calc(100dvh-80px)] w-[440px] flex-col overflow-hidden rounded-[14px] border border-border bg-bg p-1.5 text-text shadow-xl data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
            data-menu-publier
            /* Le focus d'ouverture tombait sur l'interrupteur « Automatique » et ouvrait son infobulle par-dessus le menu. */
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <ContenuPublier projectId={projectId} onFini={() => setOuvert(false)} />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <HistoriqueDePublication projectId={projectId} />
    </>
  );
}

/** Le compte affiché sur le geste « Publier » du haut du téléphone. */
export function useCompteAPublier(projectId: string | null): number {
  const aDeployer = useADeployer(projectId ?? '');
  /* La même règle que le bouton de l'ordinateur : seulement ce qui attend d'être déployé (13/11/2026). */
  return projectId ? aDeployer.length : 0;
}

/** Demander la feuille « Publier » du téléphone, montée par l'application (le bouton du haut la demande). */
export { EVENEMENT_OUVRIR_PUBLIER } from '@/lib/evenements-publier';
import { EVENEMENT_OUVRIR_PUBLIER } from '@/lib/evenements-publier';

/**
 * « PUBLIER », PETIT BOUTON ICÔNE TOUT À DROITE DU HAUT D'UN PROJET SUR TÉLÉPHONE (décision de l'utilisateur du
 * 13/11/2026) : les trois points juste à sa gauche, et plus rien en bas — ni sur l'accueil du projet, ni sur une tâche.
 * Violet plein, le nombre en attente en pastille ; il ouvre la feuille « Publier » (les deux listes), montée par
 * l'application. Le moteur d'avant reste monté caché, comme sur ordinateur : le déroulé du déploiement et le tiroir
 * de la mise en production partent de lui. Un regroupement n'a pas ce bouton (il coche des projets — DEC-435).
 */
export function BoutonPublierDuHaut({ projectId }: { projectId: string }) {
  const state = useApp();
  const { permis, regroupement } = usePublication(projectId);
  const compte = useCompteAPublier(permis && !regroupement ? projectId : null);
  const suivi = useSuiviDePublication(projectId);
  const enCours = suivi.vue.genre === 'suivi' || suivi.vue.genre === 'preparation';
  if (!permis || regroupement) return null;
  return (
    <>
      <GestesDePublicationDeCarte projectId={projectId} enMenu />
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_PUBLIER))}
        className="relative ml-1 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-teinte-plein text-sur-couleur transition-opacity active:opacity-90"
        aria-label="Publier"
        title={t('Publier')}
        data-bouton-publier
        data-publier-du-haut
        data-en-attente={compte}
        data-vue-publier={suivi.vue.genre}
      >
        {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        {compte && !enCours ? (
          <span
            className="absolute -right-1.5 -top-1 min-w-[17px] rounded-full bg-text px-1 text-center text-[10px] font-semibold leading-[17px] text-bg tabular-nums"
            data-compte-du-haut={compte}
          >
            {compte > 99 ? '99+' : compte}
          </span>
        ) : null}
        {suivi.bloquee ? (
          <span className="absolute -right-1 -top-1 h-[11px] w-[11px] rounded-full bg-danger ring-2 ring-bg" data-point-rouge-publier />
        ) : null}
        {enCours ? (
          <BarreProgression pourcent={suivi.pourcent} teinte="sur-violet" className="absolute inset-x-0 bottom-0 h-[3px] rounded-b-[10px] bg-sur-couleur/25" />
        ) : null}
      </button>
      <HistoriqueDePublication projectId={projectId} />
    </>
  );
}

/** SUR TÉLÉPHONE, LES MÊMES DEUX LISTES MONTENT DU BAS (la feuille commune), depuis « Publier » du haut. */
export function FeuillePublier({ projectId, ouvert, onFermer }: { projectId: string | null; ouvert: boolean; onFermer: () => void }) {
  const { permis, regroupement } = usePublication(projectId ?? '');
  if (!projectId || !permis || regroupement) return null;
  return (
    <Drawer feuille open={ouvert} onClose={onFermer}>
      <EnteteDeFeuille titre={t('Publier')} droite={null} />
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-6" data-feuille-publier>
        {ouvert ? <ContenuPublier projectId={projectId} onFini={onFermer} /> : null}
      </div>
    </Drawer>
  );
}

/**
 * LE CONTENU DU MENU « PUBLIER » (menu sur ordinateur, feuille sur téléphone). Selon `vueDuMenuPublier` : la liste
 * d'étapes d'une publication ou d'une préparation qui tourne (maquette #625e), sinon les deux listes à cocher — avec,
 * au-dessus, l'encadré d'une publication restée bloquée.
 */
function ContenuPublier({ projectId, onFini }: { projectId: string; onFini: () => void }) {
  const suivi = useSuiviDePublication(projectId, true);
  if (suivi.vue.genre === 'ordinaire') {
    return (
      <>
        {suivi.bloquee && suivi.run ? <EncadreDeBlocage run={suivi.run} onFini={onFini} /> : null}
        <ListesAPublier projectId={projectId} onFini={onFini} />
      </>
    );
  }
  return <SuiviDansLeMenu projectId={projectId} onFini={onFini} />;
}

/** LE MENU PENDANT UN TRAVAIL : la liste d'étapes, puis ce qui attend la production, puis l'historique. */
function SuiviDansLeMenu({ projectId, onFini }: { projectId: string; onFini: () => void }) {
  const state = useApp();
  const suivi = useSuiviDePublication(projectId, true);
  const aProduire = useAProduire(projectId);
  const run = suivi.run;
  const titres =
    suivi.vue.genre === 'preparation' || !run
      ? []
      : (run.taches?.length ? run.taches.map((tache) => tache.titre) : run.cardIds.map((id) => state.cards[id]?.title ?? '')).filter(Boolean);
  const sousTitre = [suivi.projet?.name, titres.join(', ')].filter(Boolean).join(' · ');
  const deploiement = suivi.vue.genre !== 'preparation' && suivi.vue.genre !== 'ordinaire' && suivi.vue.cible === 'dev';
  return (
    <div className="flex min-h-0 flex-col" data-suivi-publier={suivi.vue.genre}>
      <EnteteDuSuivi titre={suivi.titre} sousTitre={sousTitre} pourcent={suivi.pourcent} />
      <ZoneDefilement classeEnveloppe="flex-initial">
        <ListeDEtapes lignes={suivi.lignes} />
      </ZoneDefilement>
      {suivi.question && suivi.vue.genre === 'preparation' ? (
        /* LE SEUL CAS OÙ LE FIL DE L'AGENT S'OUVRE : il attend une réponse. */
        <div className="mx-1 mt-1.5 flex items-center gap-2 rounded-[10px] bg-surface px-3 py-2.5" data-question-de-preparation>
          <p className="min-w-0 flex-1 text-[13px] text-text">{t('Une question vous attend.')}</p>
          <button
            type="button"
            className="h-8 shrink-0 rounded-[9px] bg-teinte-plein px-3 text-[13px] font-medium text-sur-couleur transition-opacity hover:opacity-90"
            onClick={() => {
              onFini();
              ouvrirAgentDeConfiguration(projectId, suivi.vue.genre === 'preparation' ? suivi.vue.cible : 'dev');
            }}
            data-repondre-a-la-preparation
          >
            {t('Répondre')}
          </button>
        </div>
      ) : null}
      {deploiement ? (
        <>
          <div className="mx-2 my-1.5 h-px shrink-0 bg-border" />
          <div className="flex shrink-0 items-center gap-2 px-2.5 pb-1 pt-1">
            <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">{t('Déployées, pas encore en production')}</h3>
            {aProduire?.length ? <span className="shrink-0 text-[12.5px] text-faint">{aProduire.length}</span> : null}
          </div>
          <button
            type="button"
            disabled
            title={t('La mise en production se lance une fois ce déploiement terminé.')}
            className="mx-1 mt-1 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-raised text-[13.5px] font-medium text-faint"
            data-production-apres-deploiement
          >
            {t('Mise en production à la fin de ce déploiement')}
          </button>
        </>
      ) : null}
      <div className="mx-2 my-1.5 h-px shrink-0 bg-border" />
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-0.5 text-[12.5px] text-muted" data-pied-publier>
        <span className="flex-1" />
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-raised hover:text-text"
          data-historique-de-publication
          onClick={() => {
            onFini();
            ouvrirHistoriqueDePublication(projectId);
          }}
        >
          <History className="h-3.5 w-3.5" />
          {t('Historique')}
        </button>
      </div>
    </div>
  );
}

/**
 * « INITIALISER LE DÉPLOIEMENT / LA MISE EN PRODUCTION » (maquette #ad2d) : une phrase, un bouton violet. Le clic
 * LANCE l'agent de configuration EN SILENCE — aucun tiroir : sa préparation se suit dans ce même menu. Un agent qui a
 * déjà une conversation ne se relance jamais seul (DEC-256) : son fil s'ouvre alors, pour lui répondre.
 */
function InitialiserLEtape({ projectId, cible, onFini }: { projectId: string; cible: CiblePublication; onFini: () => void }) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const agentId = agentDeConfiguration(projet, cible);
  const enCours = !!state.procedures[`${projectId}:${cible}`]?.enCours;
  const [envoi, setEnvoi] = React.useState(false);
  const lancer = () => {
    if (agentId) {
      onFini();
      ouvrirAgentDeConfiguration(projectId, cible);
      return;
    }
    if (enCours || envoi) return;
    setEnvoi(true);
    void client
      .call<{ etat?: EtatProcedure }>({ type: 'procedure.tour', projectId, cible })
      .then((res) => {
        if (res?.etat) client.majProcedure(projectId, cible, res.etat);
        if (res?.etat?.raison && !res.etat.enCours) client.pushToast('error', res.etat.raison);
      })
      .catch((err: unknown) => client.pushToast('error', err instanceof Error ? err.message : String(err)))
      .finally(() => setEnvoi(false));
  };
  return (
    <div className="flex flex-col" data-initialiser={cible}>
      <p className="px-2.5 pb-1 pt-1 text-[13px] leading-snug text-faint">
        {cible === 'dev'
          ? t('Ce projet n’a pas encore de déploiement. Un agent l’étudie, écrit la marche à suivre et fait un essai, sans rien mettre en ligne — trois à cinq minutes.')
          : t('La mise en production n’est pas encore préparée. Un agent écrit la marche à suivre jusque chez le client et fait un essai, sans rien y envoyer.')}
      </p>
      <button
        type="button"
        className="mx-1 mt-1.5 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-teinte-plein text-[13.5px] font-medium text-sur-couleur transition-opacity hover:opacity-90 disabled:opacity-40"
        disabled={envoi}
        onClick={lancer}
        data-initialiser-etape={cible}
        data-bouton-violet
      >
        {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {cible === 'dev' ? t('Initialiser le déploiement') : t('Initialiser la mise en production')}
      </button>
    </div>
  );
}

/**
 * UNE PUBLICATION RESTÉE BLOQUÉE (après ses trois réparations) : l'étape en rouge, la phrase « rien n'a changé en
 * ligne », et le DÉPANNAGE (17/11/2026 : plus de carte de réparation) — le dépanneur s'ouvre seul à la chute, et la
 * publication reprend à la fin de son tour ; le bouton ouvre son fil, ou le lance s'il n'y en a pas.
 */
function EncadreDeBlocage({ run, onFini }: { run: DeployRun; onFini: () => void }) {
  const lignes = lignesDeLaPublication(run, run.endedAt ?? Date.now()).filter((ligne) => ligne.etat !== 'todo');
  const taches = run.taches?.length ?? run.cardIds.length;
  const state = useApp();
  const depanneur = run.depannage?.agentId ? state.agents[run.depannage.agentId] : undefined;
  const enCours = depanneurVivant(depanneur) && !depanneur?.attendReponse;
  return (
    <div className="flex shrink-0 flex-col pb-1" data-publication-bloquee={run.id}>
      <EnteteDuSuivi
        titre={run.cible === 'production' ? t('Mise en production bloquée') : t('Déploiement bloqué')}
        sousTitre=""
        pourcent={null}
      />
      <ListeDEtapes lignes={lignes} />
      <div className="mx-1 mt-1 rounded-[10px] bg-raised px-3 py-2.5 text-[13px] leading-snug text-text" data-encadre-de-blocage>
        <p>
          {run.cible === 'production'
            ? t('Rien n’a changé chez le client.')
            : taches > 1
              ? t('Rien n’a changé en ligne, les {v0} tâches restent à déployer.', { v0: taches })
              : t('Rien n’a changé en ligne, la tâche reste à déployer.')}{' '}
          {enCours ? t('Un agent la dépanne : elle reprendra d’elle-même à la fin de son travail.') : null}
        </p>
        {/* DEUX GESTES, TOUJOURS (19/11/2026) : relancer tout de suite — le dépannage en cours s'arrête d'abord —, ou
            ouvrir le dépannage pour voir ce qu'il fait. Même hauteur, côte à côte. */}
        <div className="mt-2 flex items-center gap-1.5">
          <BoutonRelancerLaPublication run={run} />
          <button
            type="button"
            onClick={() => {
              onFini();
              void ouvrirLeDepannage(run);
            }}
            className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-[9px] bg-surface px-3 text-[13px] font-medium text-text transition-colors hover:bg-fond-survol"
            data-ouvrir-le-depannage={run.id}
          >
            <span className="truncate">{t('Ouvrir le dépannage')}</span>
          </button>
        </div>
      </div>
      <div className="mx-2 mt-2 h-px shrink-0 bg-border" />
    </div>
  );
}

/** LES DEUX LISTES À COCHER ET LEURS BOUTONS, montées à l'ouverture seulement (menu sur ordinateur, feuille sur téléphone). */
function ListesAPublier({ projectId, onFini }: { projectId: string; onFini: () => void }) {
  const suivi = useSuiviDePublication(projectId);
  const state = useApp();
  const { projet } = usePublication(projectId);
  const aDeployer = useADeployer(projectId);
  const aProduire = useAProduire(projectId);
  const [nonDeployees, setNonDeployees] = React.useState<Set<string>>(new Set());
  const [nonProduites, setNonProduites] = React.useState<Set<string>>(new Set());
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [envoi, setEnvoi] = React.useState<'dev' | 'production' | null>(null);
  const enCours = state.deploys[projectId]?.state === 'running';
  /* Le lot entier, pas seulement les cartes déjà reçues : cocher ce qui est là laisserait le reste. */
  React.useEffect(() => {
    void client.chargerToutesLesCartes(projectId, 'to_deploy').catch(() => undefined);
  }, [projectId]);

  /* L'ESSAI À BLANC de la sélection de production, dès qu'une case change. */
  const choisiesProduction = (aProduire ?? []).filter((tache) => !nonProduites.has(tache.cardId)).map((tache) => tache.cardId);
  const toutesProduction = !!aProduire?.length && choisiesProduction.length === aProduire.length;
  const signature = choisiesProduction.join(',');
  React.useEffect(() => {
    if (!aProduire?.length || toutesProduction || !choisiesProduction.length) {
      setVerdict(null);
      return;
    }
    let vivant = true;
    const minuteur = window.setTimeout(() => {
      void client
        .call<{ verdict: Verdict }>({ type: 'deploy.verifierProduction', projectId, selectedCardIds: choisiesProduction }, 30000)
        .then((r) => vivant && setVerdict(r.verdict))
        .catch(() => vivant && setVerdict(null));
    }, 250);
    return () => {
      vivant = false;
      window.clearTimeout(minuteur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, projectId, aProduire?.length]);

  const choisiesDeploiement = aDeployer.filter((card) => !nonDeployees.has(card.id)).map((card) => card.id);
  const titreDe = (id: string) => aProduire?.find((tache) => tache.cardId === id)?.titre ?? state.cards[id]?.title ?? id;
  const premierManque = verdict && !verdict.ok ? verdict.manques[0] : null;

  const deployer = async () => {
    setEnvoi('dev');
    try {
      await client.call({
        type: 'deploy.start',
        projectId,
        cible: 'dev',
        selectedCardIds: choisiesDeploiement.length === aDeployer.length ? undefined : choisiesDeploiement,
      });
      /* LE MENU RESTE OUVERT (décision du 13/11/2026) : il bascule seul sur la liste d'étapes du suivi, et ne se
         ferme que sur un clic dehors. */
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('publication impossible'));
    } finally {
      setEnvoi(null);
    }
  };
  const produire = async () => {
    setEnvoi('production');
    try {
      await client.call({
        type: 'deploy.start',
        projectId,
        cible: 'production',
        selectedCardIds: toutesProduction ? undefined : choisiesProduction,
      });
      /* Même règle que le déploiement : le menu reste ouvert sur le suivi. */
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('publication impossible'));
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <>
      <Section
        titre={t('À déployer')}
        compte={aDeployer.length ? pluriel(aDeployer.length) : null}
        repere="deployer"
        droite={
          /* L'INTERRUPTEUR « AUTOMATIQUE » EN HAUT À DROITE DE « À DÉPLOYER », sans libellé : son infobulle l'explique
             (décision du 13/11/2026, maquette #ec66). Le nombre de tâches se pose juste à sa gauche. */
          <InterrupteurDeploiementAuto projectId={projectId} actif={!!projet?.deploiementAutomatique} sansLibelle />
        }
      >
        {aDeployer.length ? (
          <ListeBornee repere="deployer">
          {aDeployer.map((card) => (
            <LigneACocher
              key={card.id}
              id={card.id}
              titre={card.title}
              detail={t('Terminée {v0}', { v0: quand(card.updatedAt ?? Date.now()) })}
              coche={!nonDeployees.has(card.id)}
              onCoche={(coche) =>
                setNonDeployees((avant) => {
                  const suite = new Set(avant);
                  if (coche) suite.delete(card.id);
                  else suite.add(card.id);
                  return suite;
                })
              }
              repere="deployer"
            />
          ))}
          </ListeBornee>
        ) : (
          <p className="px-2.5 py-2 text-[13px] text-faint" data-rien-a-deployer>
            {t('Rien à déployer : aucune tâche terminée n’attend.')}
          </p>
        )}
        {!suivi.procedureDev ? (
          <InitialiserLEtape projectId={projectId} cible="dev" onFini={onFini} />
        ) : aDeployer.length ? (
          <button
            type="button"
            className="mx-1 mt-1.5 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-accent text-[13.5px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
            disabled={!choisiesDeploiement.length || enCours || envoi !== null}
            onClick={() => void deployer()}
            data-deployer-selection
          >
            {envoi === 'dev' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
            {t('Déployer {v0}', { v0: pluriel(choisiesDeploiement.length) })}
          </button>
        ) : null}
      </Section>
      <div className="mx-2 my-1.5 h-px shrink-0 bg-border" />
      {!suivi.procedureDev || !suivi.procedureProduction ? (
        /* LA MISE EN PRODUCTION N'A PAS ENCORE SA MARCHE À SUIVRE (maquette #ad2d) : elle se prépare une fois le
           déploiement prêt — bouton gris éteint d'ici là, violet ensuite. */
        <Section titre={t('Mise en production')} compte={null} repere="production">
          {!suivi.procedureDev ? (
            <>
              <p className="px-2.5 pb-1 text-[13px] leading-snug text-faint" data-production-attend-le-deploiement>
                {t('Se prépare une fois le déploiement prêt.')}
              </p>
              <button
                type="button"
                disabled
                className="mx-1 mt-1 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-raised text-[13.5px] font-medium text-faint"
                data-initialiser-etape="production"
                data-eteint
              >
                <Sparkles className="h-4 w-4" />
                {t('Initialiser la mise en production')}
              </button>
            </>
          ) : (
            <InitialiserLEtape projectId={projectId} cible="production" onFini={onFini} />
          )}
        </Section>
      ) : (
      <Section
          titre={t('Déployées, pas encore en production')}
          compte={aProduire?.length ? String(aProduire.length) : null}
          repere="production"
        >
          {aProduire === null ? (
            <div className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('Lecture…')}
            </div>
          ) : aProduire.length ? (
            <ListeBornee repere="production">
            {aProduire.map((tache) => (
              <LigneACocher
                key={tache.cardId}
                id={tache.cardId}
                titre={tache.titre}
                detail={t('Déployée {v0}', { v0: quand(tache.deployeeLe) })}
                coche={!nonProduites.has(tache.cardId)}
                onCoche={(coche) =>
                  setNonProduites((avant) => {
                    const suite = new Set(avant);
                    if (coche) suite.delete(tache.cardId);
                    else suite.add(tache.cardId);
                    return suite;
                  })
                }
                repere="production"
              />
            ))}
            </ListeBornee>
          ) : (
            <p className="px-2.5 py-2 text-[13px] text-faint" data-rien-a-produire>
              {t('Tout ce qui a été déployé est déjà en production.')}
            </p>
          )}
          {premierManque ? (
            <div className="mx-1 mt-1 flex gap-2 rounded-[10px] bg-surface px-3 py-2.5 text-[12.5px] leading-snug" data-dependance-de-production>
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teinte" />
              <p className="min-w-0">
                {premierManque.besoinDe.length
                  ? t('« {v0} » s’appuie sur « {v1} », qui n’est pas cochée.', {
                      v0: titreDe(premierManque.cardId),
                      v1: premierManque.besoinDe.map(titreDe).join(' », « '),
                    })
                  : t('« {v0} » ne peut pas partir seule.', { v0: titreDe(premierManque.cardId) })}{' '}
                {premierManque.besoinDe.length ? (
                  <button
                    type="button"
                    className="text-teinte underline-offset-2 hover:underline"
                    data-cocher-les-deux
                    onClick={() =>
                      setNonProduites((avant) => {
                        const suite = new Set(avant);
                        for (const id of premierManque.besoinDe) suite.delete(id);
                        return suite;
                      })
                    }
                  >
                    {t('Cocher les deux')}
                  </button>
                ) : null}
              </p>
            </div>
          ) : null}
          {aProduire?.length ? (
            <button
              type="button"
              className="mx-1 mt-1.5 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-teinte-plein text-[13.5px] font-medium text-sur-couleur transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={!choisiesProduction.length || !!premierManque || enCours || envoi !== null}
              onClick={() => void produire()}
              data-produire-selection
            >
              {envoi === 'production' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {t('Mettre {v0} en production', { v0: pluriel(choisiesProduction.length) })}
            </button>
          ) : null}
        </Section>
      )}
      <div className="mx-2 my-1.5 h-px shrink-0 bg-border" />
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-0.5 text-[12.5px] text-muted" data-pied-publier>
        <span className="flex-1" />
        {suivi.procedureDev ? (
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-raised hover:text-text"
          data-procedure-de-publication
          onClick={() => {
            onFini();
            ouvrirRubriqueDeLEtape(projectId, 'dev');
          }}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {t('Procédure')}
        </button>
        ) : null}
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-raised hover:text-text"
          data-historique-de-publication
          onClick={() => {
            onFini();
            ouvrirHistoriqueDePublication(projectId);
          }}
        >
          <History className="h-3.5 w-3.5" />
          {t('Historique')}
        </button>
      </div>
    </>
  );
}

function Section({
  titre,
  compte,
  repere,
  droite,
  children,
}: {
  titre: string;
  compte: string | null;
  repere: string;
  /** Posé tout à droite de l'en-tête, après le compte (l'interrupteur « Automatique »). */
  droite?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col" data-section-publier={repere}>
      <div className="flex shrink-0 items-center gap-2 px-2.5 pb-1 pt-2">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">{titre}</h3>
        {compte ? <span className="shrink-0 text-[12.5px] text-faint">{compte}</span> : null}
        {droite}
      </div>
      {children}
    </section>
  );
}

/** Au-delà de cinq tâches, une liste défile en elle-même : ses boutons restent sous les yeux (capture #49e5). */
export const LIGNES_VISIBLES_DE_PUBLIER = 5;

/**
 * UNE LISTE BORNÉE À CINQ LIGNES. La borne se MESURE sur les vraies lignes (l'écart entre la première et la sixième),
 * jamais une hauteur recopiée : une ligne sur deux lignes de titre compte pour ce qu'elle occupe. La liste reste
 * aussi compressible quand l'écran est trop bas pour cinq lignes — les boutons, eux, ne rétrécissent jamais.
 */
function ListeBornee({ repere, children }: { repere: string; children: React.ReactNode }) {
  const zone = React.useRef<HTMLDivElement>(null);
  const [plafond, setPlafond] = React.useState<number | undefined>(undefined);
  React.useLayoutEffect(() => {
    const noeud = zone.current;
    if (!noeud) return;
    const lignes = noeud.querySelectorAll<HTMLElement>(':scope > [data-ligne-publier]');
    const borne =
      lignes.length > LIGNES_VISIBLES_DE_PUBLIER
        ? lignes[LIGNES_VISIBLES_DE_PUBLIER].offsetTop - lignes[0].offsetTop
        : undefined;
    setPlafond((avant) => (avant === borne ? avant : borne));
  });
  return (
    <ZoneDefilement
      ref={zone}
      classeEnveloppe="flex-initial"
      style={plafond ? { maxHeight: plafond } : undefined}
      data-liste-publier={repere}
    >
      {children}
    </ZoneDefilement>
  );
}

function LigneACocher({
  id,
  titre,
  detail,
  coche,
  onCoche,
  repere,
}: {
  id: string;
  titre: string;
  detail: string;
  coche: boolean;
  onCoche: (coche: boolean) => void;
  repere: string;
}) {
  return (
    <div
      className="flex cursor-pointer items-start gap-3 rounded-[9px] px-2.5 py-2 transition-colors hover:bg-surface"
      onClick={() => onCoche(!coche)}
      data-ligne-publier={repere}
      data-carte={id}
    >
      <CaseACocher checked={coche} onCheckedChange={onCoche} className="mt-0.5" aria-label={titre} data-case-publier={id} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-[13.5px] leading-snug', coche ? 'text-text' : 'text-muted')}>{titre}</p>
        <p className="mt-0.5 text-[12px] text-faint">{detail}</p>
      </div>
    </div>
  );
}
