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
import { ChevronDown, History } from 'lucide-react';
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

/** Le groupe sans publication n'a pas de `runId` : une clé stable pour lui quand même. */
const CLEF_SANS_PUBLICATION = '__sans-publication__';

function clefDuGroupe(groupe: GroupeDeProduction<Card>): string {
  return groupe.runId ?? CLEF_SANS_PUBLICATION;
}

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
 * Le TITRE (la date de la publication) plie et déplie le groupe — c'est lui
 * qui porte le geste demandé. L'icône d'historique, elle, GARDE son geste
 * d'avant : un bouton à elle, qui rouvre le fil complet sans toucher au
 * repli. Un groupe sans publication (carte posée à la main, mise en ligne
 * d'avant cette règle) n'a aucun historique à montrer — pas d'icône, mais le
 * titre plie quand même sa pile.
 */
export function BandeauDeGroupe({
  groupe,
  plie,
  onBasculer,
  onOuvrir,
}: {
  groupe: GroupeDeProduction<Card>;
  plie: boolean;
  onBasculer: () => void;
  onOuvrir?: () => void;
}) {
  return (
    <div
      className="flex w-full items-center gap-1.5 px-1.5 pt-2 pb-1 text-[11.5px] text-muted"
      data-groupe-production={groupe.runId ?? 'aucun'}
    >
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={!plie}
        data-basculer-groupe={groupe.runId ?? 'aucun'}
        data-groupe-plie={plie ? 'oui' : 'non'}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-md py-0.5 text-left transition-colors hover:text-text"
      >
        <ChevronDown className={cn('h-3 w-3 shrink-0 text-faint transition-transform', plie && '-rotate-90')} />
        <span className="min-w-0 flex-1 truncate">{groupe.titre}</span>
        <span className="shrink-0 text-faint">{compteDuGroupe(groupe.cartes.length)}</span>
      </button>
      {groupe.runId && onOuvrir ? (
        <button
          type="button"
          onClick={onOuvrir}
          data-historique-groupe={groupe.runId}
          /* UN REPÈRE TECHNIQUE NE CHANGE JAMAIS DE LANGUE : les contrôles en
             navigateur désignent ce bouton par lui. */
          aria-label="Voir l’historique de ce déploiement"
          className="shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-raised hover:text-text"
        >
          <History className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * LE DÉCOR DE PILE : posé DERRIÈRE la vraie première carte d'un groupe
 * REPLIÉ, jamais à sa place — un groupe replié montre sa première carte, pas
 * une barre vide. Ce décor ne fait que suggérer les cartes qui suivent :
 * jusqu'à deux épaisseurs, jamais plus, pour qu'un groupe de vingt cartes ne
 * dessine pas une tour. Purement visuel (`aria-hidden`, aucun clic) : le
 * geste d'ouverture vit sur le titre du bandeau, la carte du dessus garde le
 * sien (l'ouvrir elle-même).
 *
 * Avec la carte de devant (posée à 80% par `envelopper`), les trois
 * épaisseurs de la pile suivent le même dégradé progressif : 80 % → 50 % →
 * 20 %, chacune un peu plus reculée et un peu plus effacée que la
 * précédente.
 */
const PROFONDEURS_PILE = [
  { decalage: 6, echelle: 0.985, opacite: 0.5 },
  { decalage: 12, echelle: 0.97, opacite: 0.2 },
];

export function PileDeGroupe({ nombre }: { nombre: number }) {
  const couches = Math.min(Math.max(nombre - 1, 1), 2);
  return (
    <div className="pointer-events-none absolute inset-x-1.5 top-0" data-pile-groupe={nombre} aria-hidden>
      {PROFONDEURS_PILE.slice(0, couches).map(({ decalage, echelle, opacite }, i) => (
        <span
          key={i}
          className="absolute inset-x-0 top-0 h-full rounded-md border border-border bg-raised transition-all duration-200 ease-out"
          style={{
            transform: `translateY(${decalage}px) scale(${echelle})`,
            zIndex: -(i + 1),
            opacity: opacite,
          }}
        />
      ))}
    </div>
  );
}

/**
 * UN MEMBRE (NON PREMIER) D'UN GROUPE : plié, replié — dans les deux sens,
 * animé.
 *
 * La technique : une ligne de grille dont la hauteur (`grid-template-rows`)
 * passe de `0fr` à `1fr`, ce que les navigateurs savent transitionner en
 * douceur même quand le contenu a une hauteur inconnue à l'avance (titre,
 * étiquettes… qui varient d'une carte à l'autre).
 *
 * Le contenu reste MONTÉ pendant la fermeture (l'animation a besoin de le
 * voir), et ne se démonte qu'une fois la transition FINIE — sinon un script
 * qui compte les cartes visibles verrait un groupe "replié" qui en garde
 * encore une pleine liste dans la page.
 */
function MembreDeGroupe({ plie, children }: { plie: boolean; children: React.ReactNode }) {
  const [monte, setMonte] = React.useState(!plie);
  React.useEffect(() => {
    if (!plie) setMonte(true);
  }, [plie]);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: !plie && monte ? '1fr' : '0fr',
        marginTop: !plie ? '0.375rem' : '0px',
        transition: 'grid-template-rows 220ms ease, margin-top 220ms ease, opacity 220ms ease',
        opacity: !plie ? 1 : 0,
      }}
      onTransitionEnd={(event) => {
        if (event.propertyName === 'grid-template-rows' && plie) setMonte(false);
      }}
    >
      <div className="overflow-hidden">{monte ? children : null}</div>
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
  /*
   * LES GROUPES DÉPLIÉS. Un groupe absent de cet ensemble est REPLIÉ — c'est le
   * défaut demandé, et il n'a besoin d'aucune liste à part : une clé qui
   * n'apparaît jamais encore (nouveau groupe, ou premier rendu) est donc
   * repliée sans code supplémentaire.
   */
  const [depliés, setDepliés] = React.useState<Set<string>>(() => new Set());

  const groupes = React.useMemo(() => (actif ? groupesDeProduction(cartes, runs) : []), [actif, cartes, runs]);
  const grouper = groupes.length > 0 && grouperVautLaPeine(groupes);

  /* Deux index construits en un seul passage : la carte qui OUVRE chaque
     groupe (le bandeau se pose devant elle, et elle seule), et le groupe de
     CHAQUE carte (pour savoir si elle doit s'effacer derrière la pile). */
  const { bandeaux, groupeDeLaCarte } = React.useMemo(() => {
    const bandeaux = new Map<string, GroupeDeProduction<Card>>();
    const groupeDeLaCarte = new Map<string, GroupeDeProduction<Card>>();
    if (!grouper) return { bandeaux, groupeDeLaCarte };
    for (const groupe of groupes) {
      if (!groupe.cartes.length) continue;
      bandeaux.set(groupe.cartes[0].id, groupe);
      for (const carte of groupe.cartes) groupeDeLaCarte.set(carte.id, groupe);
    }
    return { bandeaux, groupeDeLaCarte };
  }, [grouper, groupes]);

  const rangees = React.useMemo(
    () => (grouper ? groupes.flatMap((groupe) => groupe.cartes) : cartes),
    [grouper, groupes, cartes],
  );

  const run = ouvert ? runs.find((r) => r.id === ouvert) : undefined;

  const basculer = (clef: string) =>
    setDepliés((avant) => {
      const suivant = new Set(avant);
      if (suivant.has(clef)) suivant.delete(clef);
      else suivant.add(clef);
      return suivant;
    });

  return {
    /** Les cartes de la colonne, un groupe après l'autre. */
    cartes: rangees,
    /** Le bandeau à poser devant cette carte, s'il y en a un. */
    bandeau: (cardId: string) => {
      const groupe = bandeaux.get(cardId);
      if (!groupe) return null;
      const clef = clefDuGroupe(groupe);
      return (
        <BandeauDeGroupe
          groupe={groupe}
          plie={!depliés.has(clef)}
          onBasculer={() => basculer(clef)}
          onOuvrir={groupe.runId ? () => setOuvert(groupe.runId) : undefined}
        />
      );
    },
    /**
     * CE QU'IL FAUT AUTOUR DE CETTE CARTE POUR QU'ELLE VIVE DANS SON GROUPE.
     *
     * La PREMIÈRE carte d'un groupe reste TOUJOURS visible, repliée ou non —
     * un groupe replié montre sa première carte, pas une barre vide. Repliée,
     * elle porte juste un décor de pile derrière elle. Les cartes SUIVANTES,
     * elles, se plient et se déplient avec une animation, dans les deux sens.
     * Une carte hors de tout groupe traverse sans y toucher.
     */
    envelopper: (cardId: string, node: React.ReactNode) => {
      const premiere = bandeaux.get(cardId);
      if (premiere) {
        const clef = clefDuGroupe(premiere);
        const plie = !depliés.has(clef);
        const enPile = plie && premiere.cartes.length > 1;
        return (
          <div className="relative">
            {enPile ? <PileDeGroupe nombre={premiere.cartes.length} /> : null}
            <div
              className="transition-opacity duration-200 ease-out"
              style={{ opacity: enPile ? 0.8 : 1 }}
            >
              {node}
            </div>
          </div>
        );
      }
      const groupe = groupeDeLaCarte.get(cardId);
      if (groupe && groupe.cartes[0]?.id !== cardId) {
        const clef = clefDuGroupe(groupe);
        return <MembreDeGroupe plie={!depliés.has(clef)}>{node}</MembreDeGroupe>;
      }
      return node;
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
