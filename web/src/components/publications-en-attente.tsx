/*
 * LES PUBLICATIONS EN ATTENTE, EN TÊTE DES « TABLEAUX DE BORD » (décision de l'utilisateur du 16/11/2026, maquette
 * #d979 : « un tableau qui liste les projets nécessitant un déploiement avec le nombre de tâches à déployer, les dates,
 * etc., et aussi pour la mise en production en attente » — puis « pas en deux colonnes, d'abord le déploiement, ensuite
 * la mise en production »).
 *
 * Deux tableaux communs, L'UN SOUS L'AUTRE, chacun sur toute la largeur et caché tant qu'il est vide. La lecture vient
 * du démon (`deploy.enAttente`, en base seulement — `server/src/deploy.ts`), avec les règles du menu « Publier » : le
 * nombre d'une ligne est celui du bouton « Publier » du projet. Un clic sur la LIGNE ouvre le projet et son menu
 * « Publier » ; seul le bouton de la colonne « Actions » lance une étape (voir `ActionDePublication`).
 */
import * as React from 'react';
import { DUREE_DU_FINI_DANS_LE_MENU_MS, type CiblePublication, type LigneADeployer, type LigneAProduire, type Project, type PublicationsEnAttente } from '@beluga/shared';
import { HorsDeLaRangeeDeLaPage } from '@/components/fenetre-de-service';
import { ouvrirLePublierDuProjet } from '@/components/mises-en-ligne';
import { PastilleProjet } from '@/components/pastille-projet';
import { BarreProgression } from '@/components/barre-progression';
import { useSuiviDePublication } from '@/components/suivi-de-publication';
import { Badge, Button, ConfirmDialog } from '@/components/ui';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { client } from '@/lib/client';
import { aLeNiveauSurLeProjet } from '@/lib/mes-droits';
import { formatRegional, t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';

/** « 14 nov., 09:12 » ; « — » sans date. */
function dateCourte(at: number | null): string {
  if (!at) return '—';
  return new Date(at).toLocaleString(formatRegional(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * LA LECTURE, refaite quand une publication change d'état ou qu'une tâche entre dans « À déployer » (pour les projets
 * chargés), et au retour sur l'onglet. `null` tant qu'elle n'est pas arrivée ; un refus (compte sans ce droit) ne
 * montre rien.
 */
function usePublicationsEnAttente(): (PublicationsEnAttente & { refuse?: boolean }) | null {
  const state = useApp();
  const signature = React.useMemo(
    () =>
      Object.values(state.deploys)
        .map((run) => `${run?.id}:${run?.state}`)
        .join(',') +
      '|' +
      Object.values(state.cards).filter((c) => c.column === 'to_deploy').length,
    [state.deploys, state.cards],
  );
  const [lu, setLu] = React.useState<(PublicationsEnAttente & { refuse?: boolean }) | null>(null);
  const [retour, setRetour] = React.useState(0);
  React.useEffect(() => {
    const revenir = () => document.visibilityState === 'visible' && setRetour((n) => n + 1);
    document.addEventListener('visibilitychange', revenir);
    return () => document.removeEventListener('visibilitychange', revenir);
  }, []);
  React.useEffect(() => {
    let vivant = true;
    void client
      .call<PublicationsEnAttente>({ type: 'deploy.enAttente' }, 20000)
      .then((r) => vivant && setLu({ aDeployer: r.aDeployer ?? [], aProduire: r.aProduire ?? [] }))
      .catch(() => vivant && setLu({ aDeployer: [], aProduire: [], refuse: true }));
    return () => {
      vivant = false;
    };
  }, [signature, retour]);
  return lu;
}

function CelluleProjet({ projet }: { projet: Project | undefined }) {
  return projet ? (
    <span className="flex min-w-0 items-center gap-2">
      <PastilleProjet project={projet} taille={16} />
      <span className="min-w-0 truncate text-text">{projet.name}</span>
    </span>
  ) : null;
}

const pluriel = (n: number) => (n > 1 ? t('{v0} tâches', { v0: n }) : t('{v0} tâche', { v0: n }));

/**
 * LES LIGNES VISIBLES DE CE COMPTE : seuls les projets qu'il voit, et où il a le droit de publier. `charge` dit si la
 * lecture est arrivée ; `permis` si ce compte peut publier quelque part (sinon, rien de tout cela ne s'affiche).
 */
export function usePublicationsEnAttenteVisibles(): {
  charge: boolean;
  permis: boolean;
  aDeployer: LigneADeployer[];
  aProduire: LigneAProduire[];
} {
  const state = useApp();
  const lu = usePublicationsEnAttente();
  const projets = React.useMemo(() => new Map(state.projects.filter((p) => !p.archived).map((p) => [p.id, p])), [state.projects]);
  const visible = React.useCallback(
    (projectId: string) => projets.has(projectId) && aLeNiveauSurLeProjet(state, projectId, 'deployer'),
    [projets, state],
  );
  const permis = React.useMemo(() => [...projets.keys()].some((id) => aLeNiveauSurLeProjet(state, id, 'deployer')), [projets, state]);
  const aDeployerLus = React.useMemo(() => (lu?.aDeployer ?? []).filter((l) => visible(l.projectId)), [lu, visible]);
  const aProduireLus = React.useMemo(() => (lu?.aProduire ?? []).filter((l) => visible(l.projectId)), [lu, visible]);
  const aDeployer = useLignesGardeesPendantLaPublication(aDeployerLus, 'dev');
  const aProduire = useLignesGardeesPendantLaPublication(aProduireLus, 'production');
  return { charge: !!lu, permis: permis && !lu?.refuse, aDeployer, aProduire };
}

/**
 * UNE LIGNE LANCÉE DEPUIS LE TABLEAU Y RESTE JUSQU'AU BOUT (16/11/2026, colonne « Actions ») : dès le lancement, les
 * cartes quittent « À déployer » et la relecture retirerait la ligne — avec elle, la barre de progression. Tant que la
 * publication de CETTE étape tourne (ou vient de finir, `vueDuMenuPublier` → « fini »), la dernière ligne connue du
 * projet est gardée à sa place.
 */
function useLignesGardeesPendantLaPublication<L extends { projectId: string }>(lues: L[], cible: CiblePublication): L[] {
  const state = useApp();
  const connues = React.useRef(new Map<string, L>());
  const [, relire] = React.useState(0);
  for (const l of lues) connues.current.set(l.projectId, l);
  const presents = new Set(lues.map((l) => l.projectId));
  const gardees: L[] = [];
  let finProchaine: number | null = null;
  const maintenant = Date.now();
  for (const [projectId, ligne] of connues.current) {
    if (presents.has(projectId)) continue;
    const run = state.deploys[projectId];
    const memeCible = (run?.cible ?? 'dev') === cible;
    const tourne = run?.state === 'running';
    const finiDepuis = run?.state === 'success' && run.endedAt ? maintenant - run.endedAt : null;
    if (memeCible && (tourne || (finiDepuis !== null && finiDepuis < DUREE_DU_FINI_DANS_LE_MENU_MS))) {
      gardees.push(ligne);
      if (finiDepuis !== null) {
        const reste = DUREE_DU_FINI_DANS_LE_MENU_MS - finiDepuis;
        finProchaine = finProchaine === null ? reste : Math.min(finProchaine, reste);
      }
    } else if (!tourne) connues.current.delete(projectId);
  }
  /* Le « Terminé » s'efface seul : un minuteur relit la liste quand il expire. */
  React.useEffect(() => {
    if (finProchaine === null) return;
    const minuteur = window.setTimeout(() => relire((n) => n + 1), finProchaine + 50);
    return () => window.clearTimeout(minuteur);
  }, [finProchaine]);
  return gardees.length ? [...lues, ...gardees] : lues;
}

/**
 * LA COLONNE « ACTIONS » (décision de l'utilisateur du 16/11/2026) : au repos, le bouton qui lance l'étape ; pendant
 * la publication, la MÊME barre et le MÊME pourcentage que le menu « Publier » et la ligne « Déploiement » de la
 * colonne de gauche (`useSuiviDePublication`, jamais recalculé ici). Le déploiement part tout de suite ; la mise en
 * production demande d'abord une confirmation. Le clic ne remonte pas à la ligne (qui ouvre le menu « Publier »).
 */
function ActionDePublication({ projectId, cible, taches }: { projectId: string; cible: CiblePublication; taches: number }) {
  const { projet, vue, pourcent, bloquee, run } = useSuiviDePublication(projectId, true);
  const [confirmer, setConfirmer] = React.useState(false);
  const lancer = () =>
    client.call({ type: 'deploy.start', projectId, cible }).catch((err: any) => {
      client.pushToast('error', err?.message ?? t('publication impossible'));
      throw err;
    });
  const occupe = vue.genre === 'suivi' || vue.genre === 'preparation';
  const surCetteEtape = vue.genre !== 'ordinaire' && vue.cible === cible;
  const arreter = (e: React.SyntheticEvent) => e.stopPropagation();

  if (surCetteEtape && (vue.genre === 'suivi' || vue.genre === 'preparation')) {
    return (
      <span className="flex w-full min-w-0 items-center gap-2" data-action-de-publication={projectId} data-etat-action="en-cours">
        <BarreProgression pourcent={pourcent} teinte="violet" className="h-1 min-w-0 flex-1 rounded-full" />
        <span className="shrink-0 text-[13px] font-medium tabular-nums text-teinte">{pourcent === null ? '…' : t('{v0} %', { v0: pourcent })}</span>
      </span>
    );
  }
  if (surCetteEtape && vue.genre === 'fini') {
    return (
      <span className="text-[13px] font-medium text-success" data-action-de-publication={projectId} data-etat-action="fini">
        {t('Terminé')}
      </span>
    );
  }
  const echecIci = run?.state === 'failed' && (run.cible ?? 'dev') === cible && !run.masquee;
  return (
    <span className="flex items-center justify-end gap-2" onClick={arreter} onKeyDown={arreter} data-action-de-publication={projectId} data-etat-action={echecIci ? 'echec' : 'repos'}>
      {echecIci ? <span className="text-[13px] font-medium text-danger">{t('Échec')}</span> : null}
      <Button
        variant="contraste"
        size="sm"
        disabled={occupe || bloquee}
        title={bloquee ? t('La dernière publication est bloquée : ouvrez le menu « Publier » pour la reprendre.') : occupe ? t('Une publication tourne déjà sur ce projet.') : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (cible === 'production') {
            setConfirmer(true);
            return;
          }
          return lancer();
        }}
        data-bouton-action-de-publication={cible}
      >
        {cible === 'production' ? t('Mettre en production') : t('Déployer')}
      </Button>
      {cible === 'production' ? (
        <ConfirmDialog
          open={confirmer}
          title={t('Mettre en production {v0} ?', { v0: projet?.name ?? '' })}
          description={taches > 1 ? t('{v0} tâches partiront sur le site en ligne.', { v0: taches }) : t('{v0} tâche partira sur le site en ligne.', { v0: taches })}
          confirmLabel={t('Mettre en production')}
          onConfirm={() => void lancer().catch(() => undefined)}
          onClose={() => setConfirmer(false)}
        />
      ) : null}
    </span>
  );
}

/**
 * SUR TÉLÉPHONE, UNE RANGÉE EMPILÉE (`pile` du tableau commun) : le projet et son nombre de tâches à gauche, l'action
 * à droite, toujours visible — en tableau défilant, la colonne « Actions » tombait hors de l'écran.
 */
function RangeeEmpilee({ projet, taches, echec, action }: { projet: Project | undefined; taches: number; echec?: boolean; action: React.ReactNode }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <CelluleProjet projet={projet} />
          {echec ? (
            <Badge tone="danger" data-echec-de-production>
              {t('Échec')}
            </Badge>
          ) : null}
        </span>
        <span className="pl-6 text-[12.5px] tabular-nums text-muted">{pluriel(taches)}</span>
      </span>
      <span className="flex w-[150px] shrink-0 justify-end">{action}</span>
    </>
  );
}

function useProjetsEnService(): Map<string, Project> {
  const state = useApp();
  return React.useMemo(() => new Map(state.projects.filter((p) => !p.archived).map((p) => [p.id, p])), [state.projects]);
}

/** Le tableau « À déployer » : une ligne par projet ; un clic ouvre son menu « Publier », rien ne part. */
export function TableauADeployer({ lignes }: { lignes: LigneADeployer[] }) {
  const projets = useProjetsEnService();
  const colonnes = React.useMemo<ColonneDuTableauCommun<LigneADeployer>[]>(
    () => [
      { cle: 'projet', libelle: t('Projet'), valeur: (l) => projets.get(l.projectId)?.name ?? '', rendu: (l) => <CelluleProjet projet={projets.get(l.projectId)} /> },
      { cle: 'taches', libelle: t('Tâches à déployer'), largeur: 170, valeur: (l) => l.taches, rendu: (l) => <span className="tabular-nums text-text">{pluriel(l.taches)}</span> },
      { cle: 'depuis', libelle: t('En attente depuis'), largeur: 170, masqueSurTelephone: true, valeur: (l) => l.depuis, rendu: (l) => <span className="tabular-nums text-muted">{dateCourte(l.depuis)}</span> },
      {
        cle: 'deploiement',
        libelle: t('Dernier déploiement'),
        largeur: 170,
        droite: true,
        masqueSurTelephone: true,
        valeur: (l) => l.dernierDeploiement ?? 0,
        rendu: (l) => <span className="tabular-nums text-muted">{dateCourte(l.dernierDeploiement)}</span>,
      },
      { cle: 'actions', libelle: t('Actions'), largeur: 190, droite: true, rendu: (l) => <ActionDePublication projectId={l.projectId} cible="dev" taches={l.taches} /> },
    ],
    [projets],
  );
  return (
    <Tableau
      repere="projets-a-deployer"
      lignes={lignes}
      colonnes={colonnes}
      cle={(l) => l.projectId}
      onLigne={(l) => ouvrirLePublierDuProjet(l.projectId)}
      pile={(l) => <RangeeEmpilee projet={projets.get(l.projectId)} taches={l.taches} action={<ActionDePublication projectId={l.projectId} cible="dev" taches={l.taches} />} />}
      recherche={false}
      pied="jamais"
      aere
      attributsLigne={(l) => ({ 'data-projet-a-deployer': l.projectId })}
    />
  );
}

/** Le tableau « Mise en production en attente » : un échec y porte son badge. */
export function TableauAProduire({ lignes }: { lignes: LigneAProduire[] }) {
  const projets = useProjetsEnService();
  const colonnes = React.useMemo<ColonneDuTableauCommun<LigneAProduire>[]>(
    () => [
      {
        cle: 'projet',
        libelle: t('Projet'),
        valeur: (l) => projets.get(l.projectId)?.name ?? '',
        rendu: (l) => (
          <span className="flex min-w-0 items-center gap-2">
            <CelluleProjet projet={projets.get(l.projectId)} />
            {l.echec ? (
              <Badge tone="danger" data-echec-de-production>
                {t('Échec')}
              </Badge>
            ) : null}
          </span>
        ),
      },
      { cle: 'taches', libelle: t('Tâches en attente'), largeur: 170, valeur: (l) => l.taches, rendu: (l) => <span className="tabular-nums text-text">{pluriel(l.taches)}</span> },
      {
        cle: 'deploiement',
        libelle: t('Dernier déploiement'),
        largeur: 170,
        masqueSurTelephone: true,
        valeur: (l) => l.dernierDeploiement ?? 0,
        rendu: (l) => <span className="tabular-nums text-muted">{dateCourte(l.dernierDeploiement)}</span>,
      },
      {
        cle: 'production',
        libelle: t('Dernière mise en production'),
        largeur: 210,
        droite: true,
        masqueSurTelephone: true,
        valeur: (l) => l.derniereProduction ?? 0,
        rendu: (l) => <span className="tabular-nums text-muted">{dateCourte(l.derniereProduction)}</span>,
      },
      { cle: 'actions', libelle: t('Actions'), largeur: 210, droite: true, rendu: (l) => <ActionDePublication projectId={l.projectId} cible="production" taches={l.taches} /> },
    ],
    [projets],
  );
  return (
    <Tableau
      repere="projets-production-en-attente"
      lignes={lignes}
      colonnes={colonnes}
      cle={(l) => l.projectId}
      onLigne={(l) => ouvrirLePublierDuProjet(l.projectId)}
      pile={(l) => (
        <RangeeEmpilee projet={projets.get(l.projectId)} taches={l.taches} echec={l.echec} action={<ActionDePublication projectId={l.projectId} cible="production" taches={l.taches} />} />
      )}
      recherche={false}
      pied="jamais"
      aere
      attributsLigne={(l) => ({ 'data-projet-production-en-attente': l.projectId })}
    />
  );
}

export function PublicationsEnAttenteDesProjets({ titreDeLaSuite }: { titreDeLaSuite?: string } = {}) {
  const { aDeployer, aProduire } = usePublicationsEnAttenteVisibles();
  if (!aDeployer.length && !aProduire.length) return null;
  return (
    /* Leurs outils restent à eux : ils ne montent pas dans la rangée du titre de la page. */
    <HorsDeLaRangeeDeLaPage>
      <div className="flex flex-col gap-6 pb-6" data-publications-en-attente>
        {aDeployer.length ? (
          <section className="flex min-w-0 flex-col gap-2" data-projets-a-deployer={aDeployer.length}>
            <h2 className="text-[15px] font-semibold text-text">{t('À déployer')}</h2>
            <TableauADeployer lignes={aDeployer} />
          </section>
        ) : null}
        {aProduire.length ? (
          <section className="flex min-w-0 flex-col gap-2" data-projets-production-en-attente={aProduire.length}>
            <h2 className="text-[15px] font-semibold text-text">{t('Mise en production en attente')}</h2>
            <TableauAProduire lignes={aProduire} />
          </section>
        ) : null}
        {/* Sous les deux tableaux, la liste de la page reprend un petit titre à elle (« Toutes les tâches »). */}
        {titreDeLaSuite ? <h2 className="-mb-3 text-[15px] font-semibold text-text">{titreDeLaSuite}</h2> : null}
      </div>
    </HorsDeLaRangeeDeLaPage>
  );
}
