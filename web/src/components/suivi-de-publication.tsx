/*
 * LE SUIVI D'UNE PUBLICATION, DANS LE MENU « PUBLIER » (13/11/2026 — maquette #625e validée).
 *
 * Plus de grand volet : un déploiement, une mise en production ou la préparation d'une étape se lisent en une liste
 * d'étapes cochées une à une — titre, projet et tâches embarquées, pourcentage violet, barre fine, puis chaque étape :
 * rond plein coché quand elle est faite, roue violette quand elle tourne, cercle vide à venir, croix rouge quand elle
 * a résisté à ses réparations. Une réparation silencieuse se dit en une phrase grise sous l'étape. Les libellés
 * viennent des données partagées (`libelleCourtDeLEtape`), jamais d'ici.
 *
 * La même liste sert l'historique (`ListeDEtapes`), sans encadré technique ni journal horodaté.
 */
import * as React from 'react';
import { Check, Loader2, X } from '@/components/ui/icones';
import {
  PHRASE_REPARATION_ABANDONNEE,
  PHRASE_REPARATION_SILENCIEUSE,
  agentDeConfiguration,
  agentTientSonTour,
  avancementDuFlux,
  etapesDuParcours,
  jalonsDePreparation,
  libelleCourtDeLEtape,
  pourcentDePreparation,
  procedureEnPlace,
  publicationBloquee,
  titreDuSuivi,
  vueDuMenuPublier,
  type CiblePublication,
  type DeployRun,
  type VueDuMenuPublier,
} from '@beluga/shared';
import { BarreProgression } from '@/components/barre-progression';
import { EtatVide, LigneDeListe, SilhouetteDeListe } from '@/components/modeles';
import { BoutonAgrandirLaFenetre, CLASSE_FENETRE_AGRANDIE, useFenetreAgrandie } from '@/components/fenetre-de-service';
import { CLASSE_GROUPE_DE_LIGNES, Dialog, DialogContent, DialogHeader, DialogTitle, Drawer, EnteteDeFeuille, ZoneDefilement } from '@/components/ui';
import { useTelephone } from '@/lib/telephone';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

export type EtatDeLigne = 'done' | 'running' | 'todo' | 'failed';

export interface LigneDEtape {
  cle: string;
  libelle: string;
  etat: EtatDeLigne;
  /** La phrase grise sous l'étape (réparation silencieuse, réparation abandonnée). */
  sous?: string;
  /** La durée à droite, en mots (« 4 s », « 1 min 20 s »). */
  duree?: string;
}

/** « 4 s », « 38 s », « 1 min 20 s ». */
export function dureeCourte(ms: number): string {
  const secondes = Math.max(0, Math.round(ms / 1000));
  if (secondes < 60) return t('{v0} s', { v0: secondes });
  const minutes = Math.floor(secondes / 60);
  const reste = secondes % 60;
  return reste ? t('{v0} min {v1} s', { v0: minutes, v1: reste }) : t('{v0} min', { v0: minutes });
}

/** Les lignes d'une publication réelle : ses six étapes (les sautées disparaissent), dans l'ordre du parcours. */
export function lignesDeLaPublication(run: DeployRun, maintenant: number): LigneDEtape[] {
  const cible: CiblePublication = run.cible ?? 'dev';
  const taches = run.taches?.length ?? run.cardIds.length;
  return etapesDuParcours(cible)
    .map((description): LigneDEtape | null => {
      const step = run.steps.find((s) => s.key === description.cle);
      if (step?.state === 'skipped') return null;
      const etat: EtatDeLigne =
        step?.state === 'done' ? 'done' : step?.state === 'running' ? 'running' : step?.state === 'failed' ? 'failed' : 'todo';
      /* Une publication tombée ailleurs qu'ici laisse ses étapes « à venir » : elles le restent. */
      const sous = step?.blocage
        ? t(PHRASE_REPARATION_ABANDONNEE)
        : (step?.reparation?.essais ?? 0) > 0 && etat !== 'failed'
          ? t(PHRASE_REPARATION_SILENCIEUSE)
          : undefined;
      const duree =
        step?.startedAt && (etat === 'done' || etat === 'running' || etat === 'failed')
          ? dureeCourte((step.endedAt ?? maintenant) - step.startedAt)
          : undefined;
      /* Le nombre de tâches se pose APRÈS la traduction : la clé du dictionnaire garde son trou « {n} ». */
      const libelle =
        description.cle === 'merge' && cible !== 'production' && taches > 1
          ? t('Réunir le travail des {n} tâches', { n: taches })
          : t(libelleCourtDeLEtape(description.cle, cible, taches));
      return { cle: description.cle, libelle, etat, sous, duree };
    })
    .filter((ligne): ligne is LigneDEtape => ligne !== null);
}

/** LA LISTE D'ÉTAPES : ronds de 20 px, libellé, durée à droite. */
export function ListeDEtapes({ lignes, className }: { lignes: LigneDEtape[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col', className)} data-liste-d-etapes>
      {lignes.map((ligne) => (
        <li key={ligne.cle} className="flex items-start gap-3 px-2.5 py-1.5" data-etape-publier={ligne.cle} data-etat={ligne.etat}>
          <RondDEtape etat={ligne.etat} />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-[13.5px] leading-5',
                ligne.etat === 'running' && 'font-medium text-teinte',
                ligne.etat === 'failed' && 'font-medium text-danger',
                ligne.etat === 'done' && 'text-text',
                ligne.etat === 'todo' && 'text-muted',
              )}
            >
              {ligne.libelle}
            </p>
            {ligne.sous ? (
              <p className="mt-0.5 text-[12px] leading-snug text-faint" data-phrase-de-reparation>
                {ligne.sous}
              </p>
            ) : null}
          </div>
          {ligne.duree ? <span className="shrink-0 pt-px text-[12px] tabular-nums text-faint">{ligne.duree}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function RondDEtape({ etat }: { etat: EtatDeLigne }) {
  if (etat === 'done')
    return (
      <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-text text-bg">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  if (etat === 'running') return <Loader2 className="mt-px h-5 w-5 shrink-0 animate-spin text-teinte" />;
  if (etat === 'failed')
    return (
      <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-sur-couleur">
        <X className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  return <span className="mt-px h-5 w-5 shrink-0 rounded-full border-[1.5px] border-faint" />;
}

/** Une horloge à la seconde, seulement tant que `actif` (un menu ouvert sur un travail qui tourne). */
function useMaintenant(actif: boolean): number {
  const [maintenant, setMaintenant] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!actif) return;
    const minuteur = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(minuteur);
  }, [actif]);
  return maintenant;
}

/**
 * CE QUE LE MENU ET LE BOUTON « PUBLIER » LISENT D'UN PROJET : la vue (`vueDuMenuPublier`), le pourcentage, les lignes
 * d'étapes, et le blocage éventuel. Un seul hook pour les deux, pour que le bouton et le menu ne se contredisent pas.
 */
export function useSuiviDePublication(projectId: string, horloge = false) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const run = state.deploys[projectId] as DeployRun | undefined;
  const agentDev = state.agents[agentDeConfiguration(projet, 'dev') ?? ''];
  const agentProd = state.agents[agentDeConfiguration(projet, 'production') ?? ''];
  const procDev = state.procedures[`${projectId}:dev`];
  const procProd = state.procedures[`${projectId}:production`];
  const prepare = (agent: typeof agentDev, proc: typeof procDev) => !!proc?.enCours || (!!agent && agentTientSonTour(agent)) || agent?.attendReponse === true || !!proc?.question;
  const preparationDev = prepare(agentDev, procDev);
  const preparationProduction = prepare(agentProd, procProd);
  const maintenantBrut = useMaintenant(horloge && (run?.state === 'running' || preparationDev || preparationProduction || run?.state === 'success'));
  const maintenant = Math.max(maintenantBrut, Date.now() - 1000);
  const vue: VueDuMenuPublier = vueDuMenuPublier({ run, preparationDev, preparationProduction, maintenant });

  let pourcent: number | null = null;
  let lignes: LigneDEtape[] = [];
  let question = false;
  let agentId: string | undefined;
  if ((vue.genre === 'suivi' || vue.genre === 'fini') && run) {
    pourcent = vue.genre === 'fini' ? 100 : (avancementDuFlux({ state: run.state, steps: run.steps, taches: run.taches })?.pourcent ?? 0);
    lignes = lignesDeLaPublication(run, maintenant);
  } else if (vue.genre === 'preparation') {
    const agent = vue.cible === 'production' ? agentProd : agentDev;
    const proc = vue.cible === 'production' ? procProd : procDev;
    const fait = agent?.todos?.done ?? 0;
    const total = agent?.todos?.total ?? 0;
    pourcent = pourcentDePreparation(fait, total);
    question = agent?.attendReponse === true || !!proc?.question;
    agentId = agent?.id ?? proc?.agentId;
    lignes = jalonsDePreparation(fait, total).map((jalon, i) => ({
      cle: `jalon-${i}`,
      libelle: t(jalon.libelle),
      etat: jalon.etat,
      sous: jalon.etat === 'running' && agent?.etapeEnCours ? agent.etapeEnCours : undefined,
    }));
  }

  const bloquee = publicationBloquee(run) && vue.genre === 'ordinaire';
  return {
    projet,
    run,
    vue,
    pourcent,
    lignes,
    question,
    agentId,
    bloquee,
    procedureDev: procedureEnPlace(projet, 'dev'),
    procedureProduction: procedureEnPlace(projet, 'production'),
    titre: titreDuSuivi(vue),
  };
}

/** L'EN-TÊTE DU SUIVI : titre, pourcentage violet, projet et tâches, barre fine. */
export function EnteteDuSuivi({ titre, sousTitre, pourcent }: { titre: string; sousTitre: string; pourcent: number | null }) {
  return (
    <div className="shrink-0 px-2.5 pb-2 pt-2" data-entete-du-suivi>
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text">{t(titre)}</h3>
        {pourcent !== null ? (
          <span className="shrink-0 text-[14px] font-medium tabular-nums text-teinte" data-pourcent-du-suivi={pourcent}>
            {t('{v0} %', { v0: pourcent })}
          </span>
        ) : null}
      </div>
      {sousTitre ? <p className="mt-0.5 truncate text-[12.5px] text-faint">{sousTitre}</p> : null}
      {/* Sans chiffre (publication bloquée), pas de barre : une barre animée dirait « ça avance ». */}
      {pourcent !== null ? <BarreProgression pourcent={pourcent} teinte="violet" className="mt-2 h-1 rounded-full" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* L'HISTORIQUE, EN LISTES D'ÉTAPES SIMPLES                            */
/* ------------------------------------------------------------------ */

/** Demander l'historique des publications d'un projet (le pied du menu « Publier »). */
export const EVENEMENT_HISTORIQUE_PUBLICATION = 'beluga:historique-publication';
export function ouvrirHistoriqueDePublication(projectId: string): void {
  window.dispatchEvent(new CustomEvent(EVENEMENT_HISTORIQUE_PUBLICATION, { detail: { projectId } }));
}

function issueDeLaPublication(run: DeployRun): string {
  if (run.state === 'running') return t('En cours');
  if (run.state === 'success') return run.cible === 'production' ? t('En production') : t('En ligne');
  if (run.state === 'stopped') return t('Arrêtée');
  return t('Échec');
}

/**
 * L'HISTORIQUE (13/11/2026) : la liste des publications passées du projet. Chacune se déplie en la MÊME liste
 * d'étapes que le menu — sans encadré technique, sans journal horodaté, sans « Relancer ». Lecture en base seulement
 * (`deploy.historique`).
 *
 * UNE FENÊTRE CENTRALE, PLUS UNE PAGE (13/11/2026, captures #5d071 et #81b6 : la liste s'ouvrait en bande collée au
 * bord droit, devant un écran vide qui chargeait) : titre « Historique » centré, croix à droite, bouton agrandir /
 * réduire à côté ; silhouette pendant le chargement. Sur téléphone, la feuille commune qui monte du bas.
 */
export function HistoriqueDePublication({ projectId }: { projectId: string }) {
  const telephone = useTelephone();
  const [ouvert, setOuvert] = React.useState(false);
  const [runs, setRuns] = React.useState<DeployRun[] | null>(null);
  const [deplie, setDeplie] = React.useState<string | null>(null);
  const [agrandie, basculerAgrandie] = useFenetreAgrandie('historique-de-publication');
  React.useEffect(() => {
    const ecoute = (event: Event) => {
      const demande = event as CustomEvent<{ projectId?: string; prise?: boolean }>;
      /* UNE SEULE FENÊTRE PAR DEMANDE : le bouton « Publier » de l'ordinateur et celui du téléphone montent chacun leur
         historique ; le premier qui l'entend la prend, l'autre se tait (sinon deux fenêtres s'empilaient). */
      if (demande.detail?.projectId !== projectId || demande.detail.prise) return;
      demande.detail.prise = true;
      setOuvert(true);
    };
    window.addEventListener(EVENEMENT_HISTORIQUE_PUBLICATION, ecoute);
    return () => window.removeEventListener(EVENEMENT_HISTORIQUE_PUBLICATION, ecoute);
  }, [projectId]);
  React.useEffect(() => {
    if (!ouvert) return;
    let vivant = true;
    setRuns(null);
    void client
      .call<{ runs?: DeployRun[] }>({ type: 'deploy.historique', projectId, limite: 30 })
      .then((res) => vivant && setRuns(Array.isArray(res?.runs) ? res.runs : []))
      .catch(() => vivant && setRuns([]));
    return () => {
      vivant = false;
    };
  }, [ouvert, projectId]);

  const contenu =
    runs === null ? (
      <SilhouetteDeListe />
    ) : runs.length === 0 ? (
      <EtatVide titre={t('Aucune publication pour l’instant.')} detail={t('Les déploiements et mises en production de ce projet s’afficheront ici.')} />
    ) : (
      <div className={CLASSE_GROUPE_DE_LIGNES}>
        {runs.map((run) => {
          const ouvertIci = deplie === run.id;
          const quand = new Date(run.startedAt).toLocaleString('fr-CH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          const taches = run.taches?.length ?? run.cardIds.length;
          return (
            <div key={run.id} className="flex flex-col" data-publication-passee={run.id} data-etat={run.state}>
              <LigneDeListe
                titre={run.cible === 'production' ? t('Mise en production') : t('Déploiement')}
                detail={taches ? t('{v0} · {v1}', { v0: quand, v1: taches > 1 ? t('{v0} tâches', { v0: taches }) : t('1 tâche') }) : quand}
                fin={<span className={cn(run.state === 'failed' && 'text-danger', run.state === 'running' && 'text-teinte')}>{issueDeLaPublication(run)}</span>}
                actif={ouvertIci}
                onClick={() => setDeplie(ouvertIci ? null : run.id)}
                data-deplier-publication={run.id}
              />
              {ouvertIci ? <ListeDEtapes lignes={lignesDeLaPublication(run, run.endedAt ?? Date.now())} className="pb-2 pl-1" /> : null}
            </div>
          );
        })}
      </div>
    );

  if (telephone) {
    return (
      <Drawer feuille hauteurFixe open={ouvert} onClose={() => setOuvert(false)}>
        <EnteteDeFeuille titre={t('Historique')} />
        <ZoneDefilement fond="hsl(var(--surface))" classeEnveloppe="min-h-0 flex-1" className="px-4 pb-6" data-historique-publication="feuille">
          {contenu}
        </ZoneDefilement>
      </Drawer>
    );
  }
  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && setOuvert(false)}>
      <DialogContent
        className={cn('sm:w-[min(640px,100%)]', agrandie && CLASSE_FENETRE_AGRANDIE)}
        data-historique-publication="fenetre"
        data-fenetre-agrandie={agrandie ? '' : undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader droite={<BoutonAgrandirLaFenetre agrandie={agrandie} onBasculer={basculerAgrandie} />}>
          <DialogTitle>{t('Historique')}</DialogTitle>
        </DialogHeader>
        {contenu}
      </DialogContent>
    </Dialog>
  );
}
