/*
 * CHAQUE DÉPLOIEMENT ET CHAQUE MISE EN PRODUCTION EST UNE LIGNE DU FLUX DE SON PROJET (décision du 31/10/2026) :
 * « le processus doit activer une ligne comme si c'était un agent ». Un lancement crée une nouvelle ligne, rangée à sa
 * date parmi les tâches (colonne de gauche, page du projet, tableaux de bord) : encadrée avec sa barre d'avancement
 * pendant le travail, archivée ensuite, et elle défile avec les autres. Plus aucun groupe « Mises en ligne » en tête.
 * Les règles pures vivent dans `shared/src/mises-en-ligne-du-flux.ts`. Les boutons « Déployer » et « Mettre en
 * production » gardent leur nom.
 */
import * as React from 'react';
import {
  construireFragment,
  MISES_EN_LIGNE_PAR_PAQUET,
  comparerMisesEnLigne,
  dateDeLaMiseEnLigne,
  depanneurVivant,
  miseEnLigneActive,
  misesEnLigneApres,
  suiviDeLaPublication,
  type DeployRun,
  type Project,
} from '@beluga/shared';
import { BarreProgression } from '@/components/barre-progression';
import { BadgeDEtatDAgent, DateDeLAgent, IconeDeLAgent } from '@/components/liste-des-agents';
import { client } from '@/lib/client';
import { Loader2, RotateCcw } from '@/components/ui/icones';
import { naviguerVers } from '@/components/ui/lien-interne';
import { EVENEMENT_OUVRIR_PUBLIER } from '@/lib/evenements-publier';
import { ouvrirUnAgent } from '@/lib/ouvrir-un-agent';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * LE CLIC : LE PROJET S'OUVRE, PUIS SON MENU « PUBLIER » (13/11/2026) — plus le grand volet. Une publication qui
 * tourne s'y lit en étapes cochées ; une publication finie y laisse le menu ordinaire, et l'historique est au pied.
 */
export function ouvrirMiseEnLigne(run: DeployRun): void {
  if (run.state === 'failed' && !run.masquee) {
    void ouvrirLeDepannage(run);
    return;
  }
  ouvrirLePublierDuProjet(run.projectId);
}

/**
 * UNE MISE EN LIGNE TOMBÉE S'OUVRE SUR SON DÉPANNAGE (décision de l'utilisateur, 17/11/2026 : « quand on clique dessus,
 * ça doit ouvrir le volet de debug ») : le fil du dépanneur déjà au travail ; sans dépanneur (pas de quota au moment de
 * la chute, ou deux dépannages déjà essayés), le clic en lance un — le bouton le dit dès le clic — puis ouvre son fil.
 */
export async function ouvrirLeDepannage(run: DeployRun): Promise<void> {
  const agentId = run.depannage?.agentId;
  const agent = agentId ? client.lireEtat().agents[agentId] : undefined;
  const ouvrir = (id: string) => {
    if (client.lireEtat().agents[id]) {
      ouvrirUnAgent(id);
      return;
    }
    naviguerVers(construireFragment({ vue: 'projet', projectId: run.projectId }));
    window.setTimeout(() => {
      if (run.cible === 'production') client.demanderProduction({ projectId: run.projectId, agentId: id, run });
      else client.demanderDeploiement({ projectId: run.projectId, agentId: id, run });
    }, 250);
  };
  if (agentId && (depanneurVivant(agent) || (!run.depannage?.enAttenteDeVous && !run.depannage?.refusAuto))) {
    ouvrir(agentId);
    return;
  }
  const rendu = await client.geste<{ agentId: string }>({ type: 'deploy.depanner', runId: run.id }, t('Dépanner'));
  if (rendu?.agentId) ouvrir(rendu.agentId);
}

/**
 * « RELANCER » UNE PUBLICATION BLOQUÉE (19/11/2026) — le même bouton dans le menu « Publier » et dans la conversation
 * du dépanneur. Toujours offert sur la dernière publication tombée : le démon arrête d'abord un dépannage en cours,
 * puis reprend la MÊME publication à l'étape tombée (`deploy.relancer`). La roue tourne dès le clic.
 */
export function BoutonRelancerLaPublication({ run, className, onFait }: { run: DeployRun; className?: string; onFait?: () => void }) {
  const [envoi, setEnvoi] = React.useState(false);
  const relancer = async () => {
    if (envoi) return;
    setEnvoi(true);
    try {
      const rendu = await client.geste({ type: 'deploy.relancer', runId: run.id }, t('Relancer'), 60000);
      if (rendu) onFait?.();
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <button
      type="button"
      disabled={envoi}
      onClick={() => void relancer()}
      className={cn(
        'flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-teinte-plein px-3 text-[13px] font-medium text-sur-couleur transition-opacity hover:opacity-90 disabled:opacity-60',
        className,
      )}
      data-relancer-la-publication={run.id}
    >
      {envoi ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{t('Relancer')}</span>
    </button>
  );
}

/** Ouvrir un projet, puis son menu « Publier » — sans rien lancer (ses deux listes : à déployer, puis à produire). */
export function ouvrirLePublierDuProjet(projectId: string): void {
  const run = { projectId };
  naviguerVers(construireFragment({ vue: 'projet', projectId: run.projectId }));
  /* Le bouton « Publier » du projet n'est monté qu'une fois le projet affiché, et seul le bouton VISIBLE ouvre son
     menu : un second essai couvre un projet plus long à s'afficher, sans jamais ouvrir deux menus. */
  const ouvrir = () => window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_PUBLIER, { detail: { projectId: run.projectId } }));
  window.setTimeout(ouvrir, 250);
  window.setTimeout(() => {
    if (!document.querySelector('[data-menu-publier]')) ouvrir();
  }, 900);
}

/** Ce que la lecture par date garde entre deux montages : la colonne se replie et se rouvre sans tout relire. */
const memoire = new Map<string, { runs: DeployRun[]; reste: boolean }>();
/** Les listes montées, prévenues quand une AUTRE liste a lu une version plus avancée d'une de leurs lignes. */
const abonnes = new Set<() => void>();

/** Délai entre deux relectures tant qu'une ligne tourne : le filet d'un événement de fin perdu. */
const RELECTURE_PENDANT_UN_LANCEMENT_MS = 15_000;

/**
 * UNE LECTURE FAIT FOI POUR TOUTES LES LISTES (capture #ebdf du 04/11/2026). La colonne d'un projet, « En cours » et
 * les tableaux de bord gardent chacune leur copie (`memoire`, une clé par projet et `*`) : celle qui vient de lire le
 * démon reporte la version la plus avancée de chaque ligne dans les copies qui la portent déjà, puis réveille les
 * listes montées. Sans ça, la liste montée pendant le redémarrage d'une publication gardait « 50 % » pendant que
 * les tableaux de bord, ouverts après, la disaient terminée.
 */
function reporterDansLesAutresCopies(cle: string, lus: readonly DeployRun[]): void {
  for (const [autre, copie] of memoire) {
    if (autre === cle) continue;
    let runs = copie.runs;
    for (const run of lus) if (runs.some((r) => r.id === run.id)) runs = misesEnLigneApres(runs, run);
    if (runs !== copie.runs) memoire.set(autre, { runs, reste: copie.reste });
  }
  /* Toutes les listes montées se réveillent, celles de la MÊME clé aussi : « En cours » et les tableaux de bord
     lisent tous deux la clé `*`, et celle qui n'a pas lu doit suivre l'autre. */
  for (const reveil of abonnes) reveil();
}

/**
 * LES MISES EN LIGNE D'UN PROJET (ou de tous), PAR DATE : un paquet à l'ouverture, la suite sur demande, et les
 * événements en direct (`state.deploys`, `state.deploiements`, `state.productions`) fondus dedans sans doublon.
 * Relue à chaque retour de coupure (`state.reprises`), et toutes les 15 s tant qu'une de ses lignes tourne.
 */
export function useMisesEnLigneParDate(projectId?: string): {
  runs: DeployRun[];
  reste: boolean;
  charge: boolean;
  chargerLaSuite: (voulu: number) => void;
} {
  const state = useApp();
  const cle = projectId ?? '*';
  const [lecture, setLecture] = React.useState<{ runs: DeployRun[]; reste: boolean } | null>(() => memoire.get(cle) ?? null);
  const enLecture = React.useRef(false);
  React.useEffect(() => {
    const reveil = () => {
      const copie = memoire.get(cle);
      if (copie) setLecture((l) => (l && l.runs === copie.runs ? l : copie));
    };
    abonnes.add(reveil);
    return () => {
      abonnes.delete(reveil);
    };
  }, [cle]);
  const lire = React.useCallback(
    async (avant: DeployRun | undefined, limite: number) => {
      if (enLecture.current) return;
      enLecture.current = true;
      try {
        const reponse = await client.call<{ runs?: DeployRun[]; reste?: boolean }>({
          type: 'deploys.parDate',
          projectId,
          avant: avant ? { at: dateDeLaMiseEnLigne(avant), id: avant.id } : undefined,
          limit: limite,
        });
        const lus = reponse?.runs ?? [];
        /* LA COPIE S'ÉCRIT TOUT DE SUITE, PAS DANS UN `setLecture((avant) => …)` : la mise à jour différée passait
           APRÈS le réveil des listes de la même clé, qui reposaient l'ancienne copie par-dessus — « 50 % » restait. */
        const precedente = memoire.get(cle)?.runs ?? [];
        let runs = avant ? precedente : precedente.filter((r) => r.state === 'running');
        for (const run of lus) runs = misesEnLigneApres(runs, run);
        const suite = { runs, reste: !!reponse?.reste };
        memoire.set(cle, suite);
        setLecture(suite);
        reporterDansLesAutresCopies(cle, lus);
      } catch {
        /* Une lecture qui échoue laisse la liste des cartes seule : rien à afficher en plus. */
        setLecture((l) => l ?? { runs: [], reste: false });
      } finally {
        enLecture.current = false;
      }
    },
    [projectId, cle],
  );
  React.useEffect(() => {
    if (!state.pret) return;
    void lire(undefined, Math.max(MISES_EN_LIGNE_PAR_PAQUET, memoire.get(cle)?.runs.length ?? 0));
  }, [state.pret, state.reprises, lire, cle]);
  /* LE DIRECT : un lancement neuf ou une étape franchie se fond dans la liste, à sa place de date. */
  const enDirect = React.useMemo(() => {
    const vus = [
      ...Object.values(state.deploys ?? {}),
      ...Object.values(state.deploiements ?? {}),
      ...Object.values(state.productions ?? {}),
    ] as DeployRun[];
    return vus.filter((run) => !!run && (!projectId || run.projectId === projectId));
  }, [state.deploys, state.deploiements, state.productions, projectId]);
  const runs = React.useMemo(() => {
    let liste = lecture?.runs ?? [];
    for (const run of enDirect) liste = misesEnLigneApres(liste, run);
    return liste;
  }, [lecture, enDirect]);
  React.useEffect(() => {
    if (lecture) memoire.set(cle, { runs, reste: lecture.reste });
  }, [runs, lecture, cle]);
  /* LE FILET : tant qu'une ligne tourne, la liste se relit — un événement de fin perdu ne la fige plus à « 50 % ». */
  const unLancementTourne = runs.some(miseEnLigneActive);
  React.useEffect(() => {
    if (!unLancementTourne || !state.pret) return;
    const minuterie = window.setInterval(() => {
      void lire(undefined, Math.max(MISES_EN_LIGNE_PAR_PAQUET, memoire.get(cle)?.runs.length ?? 0));
    }, RELECTURE_PENDANT_UN_LANCEMENT_MS);
    return () => window.clearInterval(minuterie);
  }, [unLancementTourne, state.pret, lire, cle]);
  const chargerLaSuite = React.useCallback(
    (voulu: number) => {
      if (!lecture?.reste || (lecture.runs.length >= voulu)) return;
      const tries = [...lecture.runs].sort(comparerMisesEnLigne);
      void lire(tries[tries.length - 1], Math.max(MISES_EN_LIGNE_PAR_PAQUET, voulu - lecture.runs.length));
    },
    [lecture, lire],
  );
  return { runs, reste: !!lecture?.reste, charge: !!lecture, chargerLaSuite };
}

/**
 * LA LIGNE D'UN LANCEMENT, comme celle d'un agent. En cours : un VRAI CADRE de 1 px violet (`border-teinte`, rouge
 * `border-danger` sur échec), l'avancement à droite et la barre posée au bas du cadre. Finie : l'icône et le badge
 * d'une carte archivée, sans cadre ni barre, à 60 %. Le cadre est un calque absolu (`data-cadre-mise-en-ligne`) posé
 * PAR-DESSUS la ligne : il ne change ni sa hauteur (38 / 32 px), ni la place de la barre, et le survol du bouton ne
 * le recouvre pas (demande du 01/11/2026).
 */
export function LigneDeMiseEnLigne({
  run,
  compacte,
  pleinePage,
  avecProjet,
  projet,
  onChoose,
  rangee = false,
}: {
  run: DeployRun;
  /** Rangée dans la colonne de gauche (terminée) : 30 %, nette au survol — comme une carte rangée (carte du 04/11/2026). */
  rangee?: boolean;
  compacte?: boolean;
  pleinePage?: boolean;
  avecProjet?: boolean;
  projet?: Project;
  onChoose?: () => void;
}) {
  const state = useApp();
  const suivi = suiviDeLaPublication(run);
  const enCours = suivi.etat === 'en-cours';
  const tombee = suivi.etat === 'en-echec';
  const etape = run.cible === 'production' ? t('Mise en production') : t('Déploiement');
  const leProjet = projet ?? state.projects.find((p) => p.id === run.projectId);
  const nom = leProjet?.name ?? t('Projet inconnu');
  const resultat = enCours ? `${suivi.pourcent} %` : tombee ? t('échec') : suivi.etat === 'reussie' ? t('terminé') : t('arrêtée');
  /* CE QUE FAIT LE DÉPANNAGE D'UNE LIGNE TOMBÉE (17/11/2026), dit sous son titre. */
  const depanneur = run.depannage?.agentId ? state.agents[run.depannage.agentId] : undefined;
  const etatDuDepannage = !tombee
    ? null
    : depanneur?.attendReponse || run.depannage?.enAttenteDeVous
      ? t('échec · en attente de vous')
      : depanneurVivant(depanneur)
        ? t('dépannage en cours')
        : run.depannage?.refusAuto
          ? t('aucun quota pour dépanner')
          : t('échec');
  return (
    <div
      role="listitem"
      className={cn(
        'relative flex items-center rounded-lg',
        enCours || tombee
          ? 'overflow-hidden bg-surface'
          : rangee
            ? 'opacity-30 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100 active:opacity-100 motion-reduce:transition-none'
            : 'opacity-60',
      )}
      data-ligne-rangee={rangee && !enCours && !tombee ? '' : undefined}
      data-ligne-mise-en-ligne={run.cible === 'production' ? 'production' : 'deploiement'}
      data-mise-en-ligne={run.id}
      data-etat-mise-en-ligne={suivi.etat}
    >
      <button
        type="button"
        title={`${etape} · ${nom} · ${resultat}`}
        onClick={() => {
          ouvrirMiseEnLigne(run);
          onChoose?.();
        }}
        className={cn(
          'flex w-full min-w-0 items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-raised',
          pleinePage ? 'px-3 py-3' : compacte ? 'min-h-[38px] px-2 py-1 sm:min-h-8' : 'px-2.5 py-2',
          'group-data-[bande]/colonne:justify-center group-data-[bande]/colonne:px-0',
        )}
      >
        {/* TOMBÉE : le logo du projet, toujours, avec un POINT ROUGE au coin (maquette #fbdfc, 17/11/2026). */}
        <IconeDeLAgent etat={enCours ? 'travail' : tombee ? 'echec' : 'archive'} projet={avecProjet || tombee ? leProjet : undefined} />
        <span className="min-w-0 flex-1 leading-tight group-data-[bande]/colonne:sr-only">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('min-w-0 flex-1 truncate text-text', pleinePage ? 'text-[15px]' : compacte ? 'text-[13.5px]' : 'text-[14px]')} data-titre-agent>
              {etape}
            </span>
            {compacte ? (
              <span
                className={cn('shrink-0 text-[11px] tabular-nums', enCours ? 'font-semibold text-en-cours' : tombee ? 'text-danger' : 'text-faint')}
                data-avancement-mise-en-ligne={suivi.pourcent}
              >
                {enCours ? resultat : tombee ? (etatDuDepannage ?? resultat) : <DateDeLAgent at={dateDeLaMiseEnLigne(run)} courte />}
              </span>
            ) : null}
          </span>
          {compacte ? null : (
            /* LA MÊME SOUS-LIGNE QU'UNE CARTE D'AGENT (`data-branche-agent`) : chasse fixe, 10,5 px. */
            <span className="mt-0.5 block truncate font-mono text-[10.5px] text-faint" data-sous-ligne-mise-en-ligne>{avecProjet ? `${nom} · ${etatDuDepannage ?? resultat}` : (etatDuDepannage ?? resultat)}</span>
          )}
        </span>
        {compacte ? null : (
          <span className="flex shrink-0 flex-col items-end gap-1 group-data-[bande]/colonne:hidden" data-etat-et-date>
            {enCours ? (
              <span className="text-[11px] font-semibold tabular-nums text-en-cours" data-avancement-mise-en-ligne={suivi.pourcent}>
                {resultat}
              </span>
            ) : tombee ? (
              <span className="text-[11px] text-danger">{resultat}</span>
            ) : (
              <BadgeDEtatDAgent etat="archive" />
            )}
            <DateDeLAgent at={dateDeLaMiseEnLigne(run)} />
          </span>
        )}
      </button>
      {enCours || tombee ? <BarreProgression className="absolute inset-x-0 bottom-0" pourcent={suivi.pourcent} erreur={tombee} teinte="en-cours" /> : null}
      {enCours || tombee ? (
        <span
          aria-hidden
          data-cadre-mise-en-ligne={tombee ? 'echec' : 'en-cours'}
          className={cn('pointer-events-none absolute inset-0 rounded-lg border', tombee ? 'border-danger' : 'border-teinte')}
        />
      ) : null}
    </div>
  );
}
