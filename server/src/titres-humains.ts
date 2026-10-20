import {
  LOT_DE_TITRES_HUMAINS,
  MODELE_LLM_PAR_DEFAUT,
  demandeDeTitresHumains,
  lireTitresHumains,
  type DemandeLlm,
} from '@beluga/shared';
import { compterSansTitreHumain, poserTitreHumain, quandUneUniteEstEcrite, unitesSansTitreHumain } from './connaissances.js';
import { log } from './logger.js';
import { relayerDemandeLlm, type ReponseRelais } from './relais-llm.js';

/**
 * LES TITRES CLAIRS DE LA MÉMOIRE, ÉCRITS EN TÂCHE DE FOND.
 *
 * Une unité sans titre clair (ni donné par l'agent qui l'a proposée, ni encore
 * écrit) en reçoit un d'un PETIT modèle, par le relais du démon (OpenRouter,
 * modèle léger par défaut) : par lots de `LOT_DE_TITRES_HUMAINS`, un appel par
 * lot, les plus importantes d'abord. Rien ne bloque un tour d'agent : le
 * travail part après une pause, une passe à la fois, et s'arrête au premier
 * refus du fournisseur (il reprendra au prochain réveil).
 *
 * REPRENABLE : seules les unités sans titre clair sont lues, et `poserTitreHumain`
 * n'écrase jamais un titre posé. Une unité dont le modèle n'a rendu aucun titre
 * acceptable est écartée pour la durée du processus (pas de boucle sur elle).
 *
 * Le réveil : au démarrage (après deux minutes), puis une minute après chaque
 * écriture de la porte. Le script `scripts/titres-humains-memoire.mjs` lance
 * la même passe à la main.
 */

const PAUSE_APRES_ECRITURE_MS = 60_000;
const PAUSE_AU_DEMARRAGE_MS = 120_000;
const PAUSE_ENTRE_DEUX_LOTS_MS = 1_500;

type Appel = (demande: DemandeLlm) => Promise<ReponseRelais>;

const ecartees = new Set<string>();
let enCours: Promise<RapportDesTitres> | null = null;

export interface RapportDesTitres {
  poses: number;
  lots: number;
  restants: number;
  /** La raison d'un arrêt avant la fin, ou `null`. */
  arret: string | null;
}

function texteDeLaReponse(corps: unknown): string {
  const choix = (corps as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof choix === 'string') return choix;
  if (Array.isArray(choix)) return choix.map((m) => (typeof m === 'string' ? m : String((m as { text?: unknown })?.text ?? ''))).join('');
  return '';
}

/**
 * Une passe : des lots jusqu'à épuisement (ou `maxLots`). Une seule passe à la
 * fois : un second appel attend la même.
 */
export function remplirLesTitresHumains(
  options: { maxLots?: number; lot?: number; modele?: string; /** Un faux modèle, pour les tests. */ appel?: Appel } = {},
): Promise<RapportDesTitres> {
  if (enCours) return enCours;
  enCours = (async () => {
    const rapport: RapportDesTitres = { poses: 0, lots: 0, restants: 0, arret: null };
    const taille = Math.max(1, Math.min(options.lot ?? LOT_DE_TITRES_HUMAINS, 100));
    try {
      while (options.maxLots === undefined || rapport.lots < options.maxLots) {
        const unites = unitesSansTitreHumain(taille, ecartees);
        if (!unites.length) break;
        rapport.lots += 1;
        const reponse = await (options.appel ?? relayerDemandeLlm)({
          modele: options.modele ?? MODELE_LLM_PAR_DEFAUT,
          messages: demandeDeTitresHumains(unites),
          temperature: 0.2,
          maxTokens: 60 * unites.length + 200,
        });
        if (!reponse.ok) {
          rapport.arret = reponse.raison;
          break;
        }
        const titres = lireTitresHumains(texteDeLaReponse(reponse.corps), new Set(unites.map((u) => u.id)));
        for (const u of unites) {
          const titre = titres.get(u.id);
          if (titre && poserTitreHumain(u.id, titre)) rapport.poses += 1;
          else ecartees.add(u.id);
        }
        if (unites.length < taille) break;
        await new Promise((r) => setTimeout(r, PAUSE_ENTRE_DEUX_LOTS_MS));
      }
    } catch (err) {
      rapport.arret = (err as Error).message;
    }
    rapport.restants = compterSansTitreHumain();
    if (rapport.lots) {
      log.info(
        `titres clairs de la mémoire : ${rapport.poses} posé(s) en ${rapport.lots} lot(s), ${rapport.restants} restant(s)${rapport.arret ? ` — arrêt : ${rapport.arret}` : ''}`,
      );
    }
    return rapport;
  })().finally(() => {
    enCours = null;
  });
  return enCours;
}

/**
 * Branche la tâche de fond : un réveil au démarrage, puis après chaque écriture.
 * Rend de quoi l'arrêter. Rien sous les tests (`NODE_TEST_CONTEXT`).
 */
export function veillerSurLesTitresHumains(): () => void {
  if (process.env.NODE_TEST_CONTEXT) return () => {};
  let minuteur: NodeJS.Timeout | null = null;
  const reveiller = (delai: number) => {
    if (minuteur) return;
    minuteur = setTimeout(() => {
      minuteur = null;
      void remplirLesTitresHumains();
    }, delai);
    minuteur.unref?.();
  };
  reveiller(PAUSE_AU_DEMARRAGE_MS);
  const desabonner = quandUneUniteEstEcrite(() => reveiller(PAUSE_APRES_ECRITURE_MS));
  return () => {
    desabonner();
    if (minuteur) clearTimeout(minuteur);
  };
}
