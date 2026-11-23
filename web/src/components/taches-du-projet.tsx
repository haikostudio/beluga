/*
 * LES TÂCHES SOUS UN PROJET, DANS LA COLONNE DE GAUCHE : un flux unique, de la plus
 * récemment modifiée à la plus ancienne. Les ARCHIVES sont cachées (14/11/2026) : le premier
 * « Voir plus » les montre, puis cinq de plus à chaque « Voir plus », par le même curseur que la liste unique
 * (`shared/src/liste-par-date.ts`). La tâche ouverte et celles qui attendent une
 * réponse restent visibles à leur rang de date (`fluxDeLaColonne`) ; les actives
 * viennent d'une lecture dédiée (`tachesDeLaColonne`), `cards` ne portant que les
 * projets visités. AUCUNE SILHOUETTE ICI : un indicateur à côté du chevron dit que
 * la lecture du projet n'est pas encore arrivée (`FlecheDesTaches`).
 */
import * as React from 'react';
import { BranchesDArbre } from '@/components/branches-d-arbre';
import { LignesDesAgentsSansCarte, LignesDesChefsAuTravail } from '@/components/chefs-au-travail';
import { ChevronRight, Loader2 } from '@/components/ui/icones';
import {
  TACHES_DE_LA_COLONNE_PAR_PAQUET,
  carteCacheeDesListes,
  cleDeLecture,
  entreesDeLaColonne,
  estTacheDeLaColonne,
  etatArchive,
  fluxMele,
  sansLesFillesRangees,
  separerActives,
  trierParDate,
  type Card,
} from '@beluga/shared';
import {
  LigneEtFilles,
  entreeActive,
  useCartesAvecAgentActif,
  useLignesDAgents,
  type Ligne,
} from '@/components/liste-des-agents';
import { LigneDeMiseEnLigne, useMisesEnLigneParDate } from '@/components/mises-en-ligne';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/** Les lignes de la colonne, rangées par projet. `null` tant que la première lecture n'est pas arrivée. */
export function useTachesParProjet(): Map<string, Ligne[]> | null {
  const state = useApp();
  const pret = state.pret;
  const chargees = !!state.tachesDeLaColonne;
  const actives = useCartesAvecAgentActif();
  React.useEffect(() => {
    if (pret && !chargees) void client.chargerLesTachesDeLaColonne();
  }, [pret, chargees]);
  const cartes = React.useMemo(
    () =>
      trierParDate(
        Object.values(state.tachesDeLaColonne ?? {})
          .map((card) => {
            const connue = state.cards[card.id];
            return connue && connue.updatedAt >= card.updatedAt ? connue : card;
          })
          .filter((card) => estTacheDeLaColonne(card, actives.has(card.id)) && !carteCacheeDesListes(card, actives.has(card.id))),
      ),
    [state.tachesDeLaColonne, state.cards, actives],
  );
  const lignes = useLignesDAgents(cartes);
  return React.useMemo(() => {
    if (!chargees) return null;
    const parProjet = new Map<string, Ligne[]>();
    for (const ligne of lignes) {
      // Une carte rangée terminée et pas encore ouverte est ACTIVE (`ligneActive`) : elle reste sous son projet.
      if (etatArchive(ligne.etat) && !ligne.active) continue;
      const liste = parProjet.get(ligne.carte.projectId);
      if (liste) liste.push(ligne);
      else parProjet.set(ligne.carte.projectId, [ligne]);
    }
    return parProjet;
  }, [lignes, chargees]);
}

/** La flèche à droite d'une ligne de projet, comme celle d'un dossier. */
export function FlecheDesTaches({ projectId, ouvert, basculer }: { projectId: string; ouvert: boolean; basculer: () => void }) {
  const state = useApp();
  const enLecture = ouvert && !state.lecturesParDate[cleDeLecture({ projectId })]?.charge;
  return (
    <>
    {enLecture ? <Loader2 data-chargement-taches={projectId} aria-hidden className="h-3 w-3 shrink-0 animate-spin text-faint motion-reduce:animate-none" /> : null}
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={basculer}
      aria-expanded={ouvert}
      data-deplier-taches={projectId}
      className="flex h-[34px] w-[29px] shrink-0 items-center justify-center rounded-md text-faint hover:text-text sm:h-7 sm:w-6"
      title={ouvert ? t('Replier les tâches') : t('Déplier les tâches')}
    >
      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', ouvert && 'rotate-90')} />
    </button>
    </>
  );
}

function LignesDeTaches({
  lignes,
  carteOuverte,
  onOuvrir,
}: {
  lignes: Ligne[];
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
}) {
  const [menuPour, setMenuPour] = React.useState<string | null>(null);
  return (
    <>
      {lignes.map((ligne) => (
        <LigneEtFilles
          key={ligne.carte.id}
          carteOuverte={carteOuverte}
          onOuvrirFille={onOuvrir}
          ligne={ligne}
          compacte
          ouverte={carteOuverte === ligne.carte.id}
          menuOuvert={menuPour === ligne.carte.id}
          onMenu={(ouvert) => setMenuPour(ouvert ? ligne.carte.id : null)}
          onOuvrir={() => onOuvrir(ligne.carte)}
        />
      ))}
    </>
  );
}

/** Les tâches qu'une recherche a trouvées sous un projet, et elles seules. */
export function TachesTrouvees({
  projectId,
  cartes,
  carteOuverte,
  onOuvrir,
}: {
  projectId: string;
  cartes: Card[];
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
}) {
  const lignes = useLignesDAgents(cartes);
  return (
    <div role="list" className="mb-1.5 ml-3 flex flex-col gap-1 pl-1" data-taches-du-projet={projectId} data-taches-trouvees={projectId}>
      <LignesDeTaches lignes={lignes} carteOuverte={carteOuverte} onOuvrir={onOuvrir} />
    </div>
  );
}

/**
 * Le bloc déplié sous une ligne de projet : un seul flux par dernière modification.
 * La géométrie du rangement l'englobe (`releverGeometrie`). La lecture part au
 * dépliage et se tient ensuite à jour par les événements (`listesApresCarte`).
 */
/** Le parent des tâches : l'icône de la ligne de projet posée juste avant la liste. */
function iconeDeLaLigneDuDessus(conteneur: HTMLElement): Element | null {
  return conteneur.previousElementSibling?.querySelector('[data-icone-de-branche]') ?? null;
}

export function TachesDuProjet({
  projectId,
  taches,
  carteOuverte,
  onOuvrir,
}: {
  projectId: string;
  taches: Ligne[] | null;
  carteOuverte?: string | null;
  onOuvrir: (card: Card) => void;
}) {
  const state = useApp();
  const [nombre, setNombre] = React.useState(TACHES_DE_LA_COLONNE_PAR_PAQUET);
  const [enCours, setEnCours] = React.useState(false);
  const portee = React.useMemo(() => ({ projectId }), [projectId]);
  const lecture = state.lecturesParDate[cleDeLecture(portee)];
  const dejaLue = !!lecture?.charge;
  const actives = useCartesAvecAgentActif();
  React.useEffect(() => {
    if (!dejaLue) void client.chargerParDate(portee, TACHES_DE_LA_COLONNE_PAR_PAQUET);
  }, [portee, dejaLue]);
  const ouverte = carteOuverte ? state.cards[carteOuverte] : undefined;
  /* Les actives portent les tâches qui attendent une réponse, même très anciennes ;
     la tâche ouverte peut n'être connue que de la fiche affichée. Une seule ligne
     par identifiant, la version la plus récente l'emporte. */
  const cartes = React.useMemo(() => {
    const parId = new Map<string, Card>();
    const ajouter = (card: Card) => {
      if (card.projectId !== projectId || carteCacheeDesListes(card, actives.has(card.id))) return;
      const connue = parId.get(card.id);
      if (!connue || card.updatedAt >= connue.updatedAt) parId.set(card.id, card);
    };
    Object.values(lecture?.cartes ?? {}).forEach(ajouter);
    taches?.forEach((ligne) => ajouter(ligne.carte));
    if (ouverte) ajouter(ouverte);
    // Une fille dont la mère est sous le même projet se range sous elle (`sansLesFillesRangees`).
    return sansLesFillesRangees(trierParDate([...parId.values()]));
  }, [lecture?.cartes, taches, ouverte, projectId, actives]);
  const lignes = useLignesDAgents(cartes);
  const lues = React.useMemo(
    () => new Set(Object.values(lecture?.cartes ?? {}).filter((card) => !carteCacheeDesListes(card, actives.has(card.id))).map((card) => card.id)),
    [lecture?.cartes, actives],
  );
  /* CHAQUE DÉPLOIEMENT ET CHAQUE MISE EN PRODUCTION EST UNE LIGNE, à sa date parmi les tâches (`fluxMele`). */
  const misesEnLigne = useMisesEnLigneParDate(projectId);
  /* Les actives d'abord, puis les rangées (demande du 01/11/2026) : aucune active sous « Voir plus ». PLUS DE TRAIT
     « Archivé » DANS LA COLONNE (carte du 04/11/2026, capture #2271) : les rangées se disent par leur effacement
     (`rangee` : 30 %, nettes au survol). La liste en pleine page garde son séparateur. */
  const { entrees: fluxComplet } = separerActives(
    fluxMele(lignes, lues, misesEnLigne.runs, nombre, (ligne) => ligne.carte.id === carteOuverte || ligne.active),
    entreeActive,
  );
  /* LES ARCHIVES CACHÉES (14/11/2026) : seules les actives et la tâche ouverte restent visibles ; le premier « Voir
     plus » montre les archives, les suivants en chargent d'autres. */
  const [archivesMontrees, setArchivesMontrees] = React.useState(false);
  const { visibles: flux, cachees } = entreesDeLaColonne(
    fluxComplet,
    archivesMontrees,
    (entree) => entreeActive(entree) || entree.id === carteOuverte,
  );
  const voirPlus = () => {
    if (!archivesMontrees) {
      setArchivesMontrees(true);
      /* Des archives déjà lues attendaient : les montrer suffit. Sinon on lit la suite tout de suite. */
      if (cachees > 0) return;
    }
    const voulu = nombre + TACHES_DE_LA_COLONNE_PAR_PAQUET;
    setNombre(voulu);
    misesEnLigne.chargerLaSuite(voulu);
    if (lues.size >= voulu || !lecture?.reste) return;
    setEnCours(true);
    void client.chargerLaSuiteParDate(portee, TACHES_DE_LA_COLONNE_PAR_PAQUET).finally(() => setEnCours(false));
  };
  const [menuPour, setMenuPour] = React.useState<string | null>(null);
  return (
    <div role="list" className="relative mb-1.5 ml-3 flex flex-col gap-1 pl-4" data-taches-du-projet={projectId}>
      {/* L'ARBRE EN TIRETS (23/11/2026) : de l'icône du projet, juste au-dessus, vers chaque tâche. */}
      <BranchesDArbre trouverLeParent={iconeDeLaLigneDuDessus} />
      {/* LES CHEFS DE COMMUNICATION DE CE PROJET, au travail ou qui attendent une réponse (03/11/2026). */}
      <LignesDesChefsAuTravail projectId={projectId} compacte />
      {/* …ET SES AGENTS SANS CARTE AU TRAVAIL : la configuration du déploiement ou de la mise en production (04/11/2026). */}
      <LignesDesAgentsSansCarte projectId={projectId} />
      {flux.map((entree) => (
        <React.Fragment key={entree.id}>
        {entree.genre === 'mise-en-ligne' ? (
          <LigneDeMiseEnLigne run={entree.run} compacte rangee={!entreeActive(entree)} />
        ) : (
          <LigneEtFilles
            rangee={!entreeActive(entree)}
            carteOuverte={carteOuverte}
            onOuvrirFille={onOuvrir}
            ligne={entree.ligne}
            compacte
            ouverte={carteOuverte === entree.id}
            menuOuvert={menuPour === entree.id}
            onMenu={(ouvert) => setMenuPour(ouvert ? entree.id : null)}
            onOuvrir={() => onOuvrir(entree.ligne.carte)}
          />
        )}
        </React.Fragment>
      ))}
      {cachees > 0 || lues.size + misesEnLigne.runs.length > nombre || lecture?.reste || misesEnLigne.reste ? (
        <button
          type="button"
          data-voir-plus={projectId}
          disabled={enCours}
          onClick={voirPlus}
          className="flex h-[34px] w-full min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-[12.5px] text-faint transition-colors hover:bg-raised hover:text-text sm:h-7"
        >
          <span className="min-w-0 truncate">{t('Voir plus')}</span>
          {enCours ? <Loader2 className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        </button>
      ) : null}
    </div>
  );
}
