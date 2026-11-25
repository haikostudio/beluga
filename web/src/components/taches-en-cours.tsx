/*
 * LA ZONE « EN COURS » DE LA COLONNE DE GAUCHE (demande du 01/11/2026), entre « Nouvel agent »
 * et le groupe « Local » : tout ce qui tourne, TOUS PROJETS CONFONDUS, d'un coup d'œil.
 *
 * La règle vit dans `shared/src/taches-en-cours.ts` : toute tâche pas encore archivée qui a bougé
 * dans les dernières 24 h (13/11/2026), plus celles où un agent travaille ou qui attendent une
 * réponse (`decisionsParCarte`), quel que soit leur âge, et les tâches DÉPLOYÉES pas encore
 * ouvertes depuis, en gras (`deployeeNonVue`) — les ouvrir les retire. La source est la lecture déjà faite pour
 * la colonne (`tachesDeLaColonne`, tous projets, quelques dizaines de cartes) : aucun projet n'a
 * besoin d'être ouvert, ni ses cartes chargées.
 *
 * Chaque ligne est celle de la colonne (`LigneEtFilles`, compacte) avec la pastille de son projet.
 * Elle ne porte JAMAIS le repère de l'élément ouvert : il reste dans l'arbre des projets, et un
 * seul repère se voit à la fois. Le titre se replie, et son état est retenu en base.
 */
import { LignesDesAgentsSansCarte, LignesDesChefsAuTravail, useAgentsSansCarteAuTravail, useChefsAuTravail } from '@/components/chefs-au-travail';
import * as React from 'react';
import { ChevronRight } from '@/components/ui/icones';
import { carteCacheeDesListes, decisionsParCarte, deployeeNonVue, estChefDeLArbre, miseEnLigneAfficheeActive, racinesEnCours, sansEchecsRemplaces, sansLesFillesRangees, tachesEnCours, type Card } from '@beluga/shared';
import { ArbreDesSousAgents } from '@/components/sous-agents';
import { LignesDesTravauxDeService, useLignesDesServices } from '@/components/travaux-des-services';
import { LigneDeMiseEnLigne, useMisesEnLigneParDate } from '@/components/mises-en-ligne';
import { LigneEtFilles, useCartesAvecAgentActif, useLignesDAgents } from '@/components/liste-des-agents';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { usePref, writePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

export const CLE_TACHES_EN_COURS_REPLIEES = 'sidebar.tachesEnCoursRepliees';

/** Les cartes de la zone, tous projets confondus, la plus récente en tête. */
function useCartesEnCours(): Card[] {
  const state = useApp();
  const actives = useCartesAvecAgentActif();
  const pret = state.pret;
  const chargees = !!state.tachesDeLaColonne;
  React.useEffect(() => {
    if (pret && !chargees) void client.chargerLesTachesDeLaColonne();
  }, [pret, chargees]);
  /* La minute qui passe fait sortir ce qui atteint 24 h sans activité, sans rechargement. */
  const [maintenant, setMaintenant] = React.useState(() => Date.now());
  React.useEffect(() => {
    const minuterie = window.setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => window.clearInterval(minuterie);
  }, []);
  return React.useMemo(() => {
    const visibles = new Set(state.projects.filter((p) => !p.archived).map((p) => p.id));
    const cartes = Object.values(state.tachesDeLaColonne ?? {})
      .map((card) => {
        const connue = state.cards[card.id];
        return connue && connue.updatedAt >= card.updatedAt ? connue : card;
      })
      .filter((card) => visibles.has(card.projectId) && !carteCacheeDesListes(card, actives.has(card.id)));
    const decisions = new Set(Object.keys(decisionsParCarte(state.decisions)));
    return sansLesFillesRangees(tachesEnCours(cartes, actives, maintenant, decisions));
  }, [state.tachesDeLaColonne, state.cards, state.projects, state.decisions, actives, maintenant]);
}

export function TachesEnCours({ onOuvrir, carteOuverte = null }: { onOuvrir: (card: Card) => void; carteOuverte?: string | null }) {
  const state = useApp();
  const cartes = useCartesEnCours();
  const lignes = useLignesDAgents(cartes);
  const [repliee] = usePref<boolean>(CLE_TACHES_EN_COURS_REPLIEES, false);
  const [menuPour, setMenuPour] = React.useState<string | null>(null);
  const projets = React.useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  /* LES AGENTS SANS CARTE QUI TRAVAILLENT AUSSI (04/11/2026) : configuration d'un déploiement ou d'une mise en
     production, chefs de Communication. Ils comptent dans la zone et y paraissent en tête. */
  /* LES CHEFS DE COMMUNICATION EN ARBRE (24/11/2026, décision de l'utilisateur) : une ligne par RACINE de famille —
     le chef général —, repliée par défaut, ses sous-agents dessous en tirets quand on est dedans. Un sous-agent ne
     paraît plus en ligne autonome (la « fausse carte » de la capture #34197). Les agents de campagne gardent leur ligne. */
  const chefs = useChefsAuTravail();
  const tousLesAgents = state.agents;
  const racines = React.useMemo(() => racinesEnCours(chefs.filter(estChefDeLArbre), Object.values(tousLesAgents)), [chefs, tousLesAgents]);
  const chefsHorsArbre = chefs.filter((a) => !estChefDeLArbre(a)).length;
  /* LES AGENTS DES SERVICES ET LEURS TRAVAUX DE FOND (25/11/2026) : une ligne chacun, l'agent qui répond fondu dans le
     travail du même écran ; les finis restent en gras jusqu'à l'ouverture du service. */
  const services = useLignesDesServices();
  const sansCarte = useAgentsSansCarteAuTravail().length + chefsHorsArbre + racines.length + services.length;
  /* …ET LES MISES EN LIGNE QUI TOURNENT (04/11/2026, capture #8a35 : « Déploiement · HaikoBill · 50 % » au tableau de
     bord, rien dans la colonne). Un déploiement ou une mise en production n'est ni une carte ni un agent : la zone ne
     le voyait pas. Même ligne que sous le projet (`LigneDeMiseEnLigne`), avec la pastille de son projet. */
  const { runs } = useMisesEnLigneParDate();
  const misesEnLigne = React.useMemo(() => {
    const visibles = new Set(state.projects.filter((p) => !p.archived).map((p) => p.id));
    // Une mise en ligne TOMBÉE reste en cours, rouge, jusqu'à son dépannage (17/11/2026) — sauf dépassée par une plus récente.
    return sansEchecsRemplaces(runs).filter((run) => miseEnLigneAfficheeActive(run) && visibles.has(run.projectId));
  }, [runs, state.projects]);
  const total = lignes.length + sansCarte + misesEnLigne.length;
  if (!total) return null;
  const basculer = () => {
    /* Jamais avant les réglages du serveur : on repartirait d'un défaut (`liste-de-la-colonne.ts`). */
    if (!state.pret || state.copieLocale) return;
    writePref(CLE_TACHES_EN_COURS_REPLIEES, !repliee);
  };
  return (
    <div className="mb-1" data-taches-en-cours-colonne data-repliee={repliee ? '' : undefined}>
      <button
        type="button"
        onClick={basculer}
        aria-expanded={!repliee}
        data-tete-taches-en-cours
        className="flex h-[34px] w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-[12px] text-faint transition-colors hover:text-text sm:h-7"
      >
        <span className="min-w-0 truncate font-medium">{t('En cours')}</span>
        <span className="shrink-0 tabular-nums" data-nombre-taches-en-cours={total}>
          {total}
        </span>
        <ChevronRight className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform', !repliee && 'rotate-90')} />
      </button>
      {repliee ? null : (
        <div role="list" className="flex flex-col gap-1" data-liste-taches-en-cours>
          {misesEnLigne.map((run) => (
            <div key={run.id} data-mise-en-ligne-en-cours={run.id}>
              <LigneDeMiseEnLigne run={run} compacte avecProjet projet={projets.get(run.projectId)} />
            </div>
          ))}
          <LignesDesTravauxDeService lignes={services} />
          <LignesDesAgentsSansCarte avecProjet />
          {racines.map((racine) => (
            <div key={racine} data-famille-en-cours={racine}>
              <ArbreDesSousAgents racineId={racine} />
            </div>
          ))}
          <LignesDesChefsAuTravail compacte horsArbre />
          {lignes.map((ligne) => {
            const deployee = deployeeNonVue(ligne.carte);
            return (
              <div key={ligne.carte.id} data-tache-en-cours={ligne.carte.id} data-deployee-non-vue={deployee ? '' : undefined}>
                <LigneEtFilles
                  carteOuverte={carteOuverte}
                  onOuvrirFille={onOuvrir}
                  /* Déployée et pas encore ouverte : EN GRAS, comme une carte non lue. */
                  ligne={deployee ? { ...ligne, nonLue: true } : ligne}
                  compacte
                  zoneEnCours
                  avecProjet
                  projet={projets.get(ligne.carte.projectId)}
                  /* L'AGENT OUVERT SE VOIT AUSSI ICI (demande du 01/11/2026, capture #10c2) : son fond léger. */
                  ouverte={carteOuverte === ligne.carte.id}
                  menuOuvert={menuPour === ligne.carte.id}
                  onMenu={(ouvert) => setMenuPour(ouvert ? ligne.carte.id : null)}
                  onOuvrir={() => onOuvrir(ligne.carte)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
