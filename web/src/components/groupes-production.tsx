/*
 * LES CARTES MISES EN LIGNE ENSEMBLE, RANGÉES ENSEMBLE — ET LEUR HISTORIQUE À
 * UN CLIC.
 *
 * La colonne « En production » alignait ses cartes par date : rien ne disait
 * plus lesquelles étaient parties du même coup, ni par quel déploiement. Le fil
 * de ce déploiement existait pourtant, rangé avec la publication — il n'y avait
 * simplement aucun chemin depuis les cartes pour y revenir.
 *
 * Ce fichier tient les DEUX bouts : il va chercher les publications passées du
 * projet (lecture seule, en base ; voir `deploy.historique`), et il pose au-
 * dessus de chaque paquet de cartes un bandeau qui NOMME sa publication et
 * rouvre son tiroir.
 *
 * Le RANGEMENT lui-même, lui, n'est pas ici : c'est une règle pure
 * (`shared/src/groupes-de-production.ts`), testable sans écran.
 */

import * as React from 'react';
import { History } from 'lucide-react';
import {
  Card,
  DeployRun,
  compteDuGroupe,
  groupesDeProduction,
  grouperVautLaPeine,
  type GroupeDeProduction,
} from '@haikodev/shared';
import { TiroirDeploiement } from '@/components/tiroir-deploiement';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LES PUBLICATIONS PASSÉES DU PROJET OUVERT.
 *
 * Demandées UNE FOIS par projet, et seulement quand la colonne « En
 * production » a des cartes à ranger : une colonne vide n'a rien à grouper, et
 * la question ne se pose pas.
 *
 * Elles se rafraîchissent quand une publication du projet CHANGE D'ÉTAT — la
 * fin d'un déploiement crée précisément le groupe qu'on veut voir apparaître.
 * On ne suit pas la publication pas à pas : son avancement est déjà à l'écran
 * dans son propre tiroir, et redemander l'historique à chaque étape serait une
 * question par seconde pour rien.
 */
export function useHistoriquePublications(projectId: string, actif: boolean, etatCourant?: string) {
  const [runs, setRuns] = React.useState<DeployRun[]>([]);

  React.useEffect(() => {
    if (!actif) return;
    let vivant = true;
    /* `call` et non `send` : on ATTEND la réponse. `send` ne rend rien — il
       poste et oublie. */
    void client
      .call<{ runs?: DeployRun[] }>({ type: 'deploy.historique', projectId })
      .then((res) => {
        if (!vivant) return;
        if (Array.isArray(res?.runs)) setRuns(res.runs);
      })
      /* Une lecture d'historique qui échoue n'est PAS un incident à afficher :
         la colonne retombe sur son affichage d'avant, sans groupes. */
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [projectId, actif, etatCourant]);

  return runs;
}

/**
 * LE BANDEAU D'UN GROUPE : ce qui l'a mis en ligne, quand, et de quoi rouvrir
 * son fil.
 *
 * Le bouton n'est là que si une publication le revendique — un groupe sans
 * publication (carte posée à la main, mise en ligne d'avant cette règle) n'a
 * aucun historique à montrer, et le dire vaut mieux qu'un bouton qui ouvre du
 * vide.
 */
export function BandeauDeGroupe({
  groupe,
  onOuvrir,
}: {
  groupe: GroupeDeProduction<Card>;
  onOuvrir?: () => void;
}) {
  const contenu = (
    <>
      <span className="min-w-0 flex-1 truncate">{groupe.titre}</span>
      <span className="shrink-0 text-faint">{compteDuGroupe(groupe.cartes.length)}</span>
      {groupe.runId ? <History className="h-3 w-3 shrink-0 text-faint" /> : null}
    </>
  );

  const classe = 'flex w-full items-center gap-1.5 px-1.5 pt-2 pb-1 text-left text-[11.5px] text-muted';

  return groupe.runId && onOuvrir ? (
    <button
      type="button"
      onClick={onOuvrir}
      data-groupe-production={groupe.runId}
      /* UN REPÈRE TECHNIQUE NE CHANGE JAMAIS DE LANGUE : les contrôles en
         navigateur désignent ce bouton par lui. */
      aria-label="Voir l’historique de ce déploiement"
      className={cn(classe, 'rounded-md transition-colors hover:bg-raised hover:text-text')}
    >
      {contenu}
    </button>
  ) : (
    <div className={classe} data-groupe-production="aucun">
      {contenu}
    </div>
  );
}

/**
 * CE QU'IL FAUT À LA COLONNE POUR SE RANGER PAR GROUPE.
 *
 * Elle rend trois choses, et rien de plus : les cartes RÉORDONNÉES (un groupe
 * d'un seul tenant, sinon les paquets de vingt le couperaient en deux), le
 * bandeau à poser DEVANT une carte donnée, et le tiroir à monter une fois.
 *
 * Tant que grouper n'apprend rien (`grouperVautLaPeine`), la colonne garde
 * exactement l'affichage qu'elle avait : mêmes cartes, même ordre, aucun
 * bandeau.
 */
export function useGroupesDeProduction(projectId: string, cartes: Card[], actif: boolean, etatCourant?: string) {
  const runs = useHistoriquePublications(projectId, actif && cartes.length > 0, etatCourant);
  const [ouvert, setOuvert] = React.useState<string | null>(null);

  const groupes = React.useMemo(() => (actif ? groupesDeProduction(cartes, runs) : []), [actif, cartes, runs]);
  const grouper = groupes.length > 0 && grouperVautLaPeine(groupes);

  /* La carte qui OUVRE chaque groupe : c'est devant elle, et devant elle seule,
     que le bandeau se pose. */
  const bandeaux = React.useMemo(() => {
    const index = new Map<string, GroupeDeProduction<Card>>();
    if (!grouper) return index;
    for (const groupe of groupes) if (groupe.cartes.length) index.set(groupe.cartes[0].id, groupe);
    return index;
  }, [grouper, groupes]);

  const rangees = React.useMemo(
    () => (grouper ? groupes.flatMap((groupe) => groupe.cartes) : cartes),
    [grouper, groupes, cartes],
  );

  const run = ouvert ? runs.find((r) => r.id === ouvert) : undefined;

  return {
    /** Les cartes de la colonne, un groupe après l'autre. */
    cartes: rangees,
    /** Le bandeau à poser devant cette carte, s'il y en a un. */
    bandeau: (cardId: string) => {
      const groupe = bandeaux.get(cardId);
      if (!groupe) return null;
      return <BandeauDeGroupe groupe={groupe} onOuvrir={groupe.runId ? () => setOuvert(groupe.runId) : undefined} />;
    },
    /** Le tiroir d'historique, monté une seule fois pour toute la colonne. */
    tiroir: (
      <TiroirDeploiement
        open={!!run}
        onClose={() => setOuvert(null)}
        run={run}
        sousTitre={
          run
            ? t('{v0} tâche(s) mise(s) en ligne par ce déploiement — historique complet, en lecture.', {
                v0: run.cardIds.length,
              })
            : undefined
        }
      />
    ),
  };
}
