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
      data-carte-flip={`bandeau-${clefDuGroupe(groupe)}`}
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
 * une barre vide. Ce décor montre les VRAIES cartes qui suivent (leur titre,
 * en réduit) : jusqu'à deux épaisseurs, jamais plus, pour qu'un groupe de
 * vingt cartes ne dessine pas une tour. Purement visuel (`aria-hidden`,
 * aucun clic) : le geste d'ouverture vit sur le titre du bandeau, la carte du
 * dessus garde le sien (l'ouvrir elle-même).
 *
 * Avec la carte de devant (posée à 80% par `envelopper`), les trois
 * épaisseurs de la pile suivent le même dégradé progressif : 80 % → 50 % →
 * 20 %, chacune un peu plus reculée et un peu plus effacée que la
 * précédente.
 *
 * GÉOMÉTRIE — deux pièges déjà payés, à ne pas refaire :
 * — le décor épouse la boîte ENTIÈRE de la carte de devant (`inset-0`), sinon
 *   ses épaisseurs ont une hauteur nulle et rien ne se voit ;
 * — il passe derrière par l'ORDRE des calques (la carte est relevée en
 *   `z-10`), jamais par un `z-index` négatif, qui la ferait plonger sous le
 *   fond de la colonne.
 * Le décalage sort donc sous la carte : `envelopper` réserve la place en bas
 * pour que la pile ne morde pas sur le groupe suivant.
 */
const PROFONDEURS_PILE = [
  { decalage: 7, echelle: 0.98, opacite: 0.5 },
  { decalage: 14, echelle: 0.96, opacite: 0.2 },
];

/** Ce que la pile dépasse sous la carte de devant, en pixels. */
export const DEBORD_PILE = 16;

/** `cartes` : celles qui suivent la première du groupe, dans l'ordre — la
 *  plus proche du dessus en tête. */
export function PileDeGroupe({ cartes }: { cartes: Card[] }) {
  const couches = Math.min(cartes.length, PROFONDEURS_PILE.length);
  return (
    <div className="pointer-events-none absolute inset-0" data-pile-groupe={cartes.length} aria-hidden>
      {PROFONDEURS_PILE.slice(0, couches).map(({ decalage, echelle, opacite }, i) => (
        <span
          key={cartes[i].id}
          className="absolute inset-0 flex items-center overflow-hidden rounded-lg border border-border bg-raised px-2.5 transition-all duration-200 ease-out"
          style={{
            transform: `translateY(${decalage}px) scale(${echelle})`,
            transformOrigin: 'top center',
            opacity: opacite,
          }}
        >
          <span className="truncate text-[11px] font-medium text-text">{cartes[i].title}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * LE VRAI GLISSEMENT — technique FLIP (First / Last / Invert / Play).
 *
 * L'ancienne version animait une HAUTEUR (`grid-template-rows` de `0fr` à
 * `1fr`) : ça ressemble à une boîte qui s'agrandit, pas à une pile qui glisse.
 * Ici, la carte apparaît ou disparaît d'un coup dans la mise en page (aucune
 * hauteur animée) ; c'est CE hook, posé sur le conteneur de la colonne, qui
 * fait tout le travail visuel : il mesure la position de chaque ligne AVANT
 * le rendu suivant, la compare à sa position APRÈS, et rejoue la différence
 * comme une simple translation. Toutes les cartes en dessous du groupe qui
 * s'ouvre ou se referme glissent donc réellement, poussées par lui.
 *
 * Chaque ligne suivie porte l'attribut `data-carte-flip` (un identifiant
 * stable) — bandeau de groupe, première carte, carte membre, carte hors
 * groupe : toutes, sinon elles sautent d'un coup au lieu de glisser.
 */
export function useFlipColonne(
  conteneur: React.RefObject<HTMLElement | null>,
  deps: React.DependencyList,
) {
  const positionsAvant = React.useRef<Map<string, number>>(new Map());

  React.useLayoutEffect(() => {
    const racine = conteneur.current;
    if (!racine) return;
    const noeuds = racine.querySelectorAll<HTMLElement>('[data-carte-flip]');
    const positionsApres = new Map<string, number>();
    noeuds.forEach((noeud) => {
      const id = noeud.dataset.carteFlip;
      if (id) positionsApres.set(id, noeud.getBoundingClientRect().top);
    });
    noeuds.forEach((noeud) => {
      const id = noeud.dataset.carteFlip;
      if (!id) return;
      const avant = positionsAvant.current.get(id);
      const apres = positionsApres.get(id);
      if (avant === undefined || apres === undefined) return;
      const delta = avant - apres;
      if (Math.abs(delta) < 1) return;
      noeud.style.transition = 'none';
      noeud.style.transform = `translateY(${delta}px)`;
      /* Force le reflow avant de relâcher, sinon le navigateur fusionne les
         deux affectations et ne voit jamais l'état de départ. */
      void noeud.getBoundingClientRect();
      requestAnimationFrame(() => {
        noeud.style.transition = 'transform 260ms ease';
        noeud.style.transform = 'translateY(0)';
      });
    });
    positionsAvant.current = positionsApres;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** UN MEMBRE (NON PREMIER) D'UN GROUPE : présent ou absent, sans animation de
 *  hauteur — c'est `useFlipColonne` qui fait glisser tout ce qu'il y a
 *  autour. Un léger fondu accompagne sa propre apparition. */
function MembreDeGroupe({
  flipId,
  plie,
  children,
}: {
  flipId: string;
  plie: boolean;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = React.useState(!plie);
  React.useEffect(() => {
    if (plie) {
      setVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [plie]);
  if (plie) return null;
  return (
    <div
      data-carte-flip={flipId}
      className="mt-1.5"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 200ms ease' }}
    >
      {children}
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
    /** Change à chaque pli/dépli — la dépendance qui déclenche `useFlipColonne`. */
    depliesKey: Array.from(depliés).sort().join('|'),
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
          <div
            data-carte-flip={`premiere-${clef}`}
            /* Le décalage réservé sous la pile change d'un coup — pas
               d'animation ici : `useFlipColonne` traduit lui-même l'écart de
               position que ce changement provoque sur tout ce qu'il y a
               dessous, en une vraie translation. */
            style={{ paddingBottom: enPile ? `${DEBORD_PILE}px` : '0px' }}
          >
            <div className="relative">
              {enPile ? <PileDeGroupe cartes={premiere.cartes.slice(1)} /> : null}
              <div
                className="relative z-10 transition-opacity duration-200 ease-out"
                style={{ opacity: enPile ? 0.8 : 1 }}
              >
                {node}
              </div>
            </div>
          </div>
        );
      }
      const groupe = groupeDeLaCarte.get(cardId);
      if (groupe && groupe.cartes[0]?.id !== cardId) {
        const clef = clefDuGroupe(groupe);
        return (
          <MembreDeGroupe flipId={`membre-${cardId}`} plie={!depliés.has(clef)}>
            {node}
          </MembreDeGroupe>
        );
      }
      return (
        <div data-carte-flip={`carte-${cardId}`}>{node}</div>
      );
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
