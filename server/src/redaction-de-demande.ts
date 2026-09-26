/**
 * RÉDIGER LA TÂCHE NÉE D'UNE DEMANDE — ET LE DIRE QUAND ÇA RATE.
 *
 * Une demande convertie en tâche garde délibérément le titre et le texte du
 * client : c'est ce qui la rend utilisable à la seconde où l'on clique. Un agent
 * de cadrage est ensuite lancé pour les réécrire. Ce second temps avait TROIS
 * points d'échec, tous muets : aucun agent de cadrage disponible, une erreur en
 * route, et — jamais détecté — un tour parti qui ne rend aucun titre. À quoi
 * s'ajoutait le refus pour quota : un appel interne (`silent`) n'entre pas dans
 * la file d'attente ordinaire, la demande était donc simplement perdue.
 *
 * Tout passe désormais par ici, et l'issue est ÉCRITE SUR LA CARTE
 * (`card.redaction`, `shared/src/redaction-de-demande.ts`) :
 *
 *   - le tour rend un titre neuf            → « faite », la mention disparaît ;
 *   - panne passagère ou quota, essais restants → « en-attente », on rejoue seul ;
 *   - tout le reste, ou les essais épuisés  → « echouee », avec sa raison.
 *
 * LES ESSAIS NE SONT PAS UNE SECONDE DÉBROUILLE : le nombre d'essais et les
 * attentes croissantes sont ceux de `shared/src/panne-passagere.ts`, les mêmes
 * qui rattrapent déjà les tours de tâche tombés sur une 500.
 *
 * RIEN N'EST RECRÉÉ À LA RELANCE : la carte, ses pièces et son fil ne bougent
 * pas. Seul le tour de rédaction repart, avec exactement la même demande —
 * reconstruite à partir de la demande d'origine, jamais recopiée à côté.
 */

import {
  ESSAIS_MAX,
  attenteAvantNouvelEssai,
  causeEnClair,
  demandeDeCadrageDUneDemande,
  motifDePannePassagere,
  raisonDeRedaction,
  type Card,
} from '@beluga/shared';
import * as store from './store.js';
import * as espace from './espace-client.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { ouvrirLeCadrage } from './cadrage.js';
import { sendPrompt } from './runtime.js';

/** Les nouveaux essais programmés, pour ne pas en lancer deux sur la même carte. */
const essaisProgrammes = new Map<string, NodeJS.Timeout>();

/**
 * LES DEUX SEULES CHOSES QUI TOUCHENT UN MOTEUR — ouvrir le cadrage, et lui
 * envoyer la demande. Elles sont passées en paramètre pour qu'un contrôle
 * puisse rejouer TOUTE la mécanique (échec passager rejoué seul, échec
 * définitif écrit sur la carte, relance à la main) sans dépenser un jeton ni
 * lancer un processus. Rien d'autre n'est simulé : la base, la carte, la
 * demande et les états sont les vrais.
 */
export interface OutilsDeRedaction {
  ouvrirLeCadrage: (carteId: string) => Promise<{ id: string } | null>;
  sendPrompt: typeof sendPrompt;
}

const OUTILS_REELS: OutilsDeRedaction = { ouvrirLeCadrage, sendPrompt };

/**
 * TOUTES LES PIÈCES DU FIL, PAS SEULEMENT CELLES DE LA DEMANDE. Une capture
 * envoyée trois messages plus loin est souvent la seule chose qui montre le
 * problème. La même liste sert à la carte et au prompt : elle se calcule ici,
 * une fois, pour que la relance ne puisse pas en oublier.
 */
export function fichiersDeLaDemande(demandeId: string, fichiersDeLaFiche: readonly string[]): string[] {
  const messages = espace.messagesDeLaDemande(demandeId);
  return [...new Set([...fichiersDeLaFiche, ...messages.flatMap((m) => m.fichiers)])];
}

/** Écrit l'état de la rédaction sur la carte et l'envoie aux écrans. */
function poser(carteId: string, redaction: NonNullable<Card['redaction']>): void {
  const carte = store.getCard(carteId);
  if (!carte) return;
  const suite = store.saveCard({ ...carte, redaction });
  bus.emit({ type: 'card.upsert', card: suite });
}

/**
 * LA DERNIÈRE ERREUR DITE PAR LE TOUR. Le refus pour quota, la panne définitive
 * du moteur et les pannes internes écrivent toutes un message porteur d'un
 * `error` : c'est là qu'on lit ce qui s'est passé, plutôt que de le deviner.
 */
function derniereErreurDuTour(agentId: string): { error: string; contenu: string } | null {
  const messages = store.listMessages(agentId, 12);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.error) return { error: message.error, contenu: message.content ?? '' };
  }
  return null;
}

/**
 * LE TOUR A-T-IL VRAIMENT RÉDIGÉ ? La carte est née avec le titre du client :
 * s'il n'a pas bougé et qu'aucune synthèse n'a été posée, le tour n'a rien
 * rendu — quoi qu'en dise son code de sortie. C'est le troisième point d'échec,
 * celui que personne ne voyait.
 */
function aRedige(carteId: string, titreDOrigine: string, briefingDOrigine = ''): boolean {
  const carte = store.getCard(carteId);
  if (!carte) return false;
  /*
   * LA CARTE NAÎT DÉJÀ AVEC UNE DEMANDE — celle composée depuis la demande du
   * client (`demandeDeNaissance`, MEM-3555). Seule une synthèse DIFFÉRENTE de
   * celle-là prouve que le tour a rédigé.
   */
  const synthese = carte.briefing?.trim() ?? '';
  if (synthese && synthese !== briefingDOrigine.trim()) return true;
  return carte.title.trim() !== titreDOrigine.trim() && !carte.titreProvisoire;
}

/**
 * LANCER (OU REJOUER) LA RÉDACTION D'UNE CARTE NÉE DE LA MESSAGERIE.
 *
 * Ne rend jamais d'erreur : tout ce qui rate s'écrit sur la carte. L'appelant
 * la lance sans l'attendre — la carte est déjà rendue à l'écran.
 */
/** La demande avec laquelle chaque carte est née, gardée d'un essai à l'autre. */
const briefingsDeNaissance = new Map<string, string>();

export async function redigerLaTache(
  entree: { carteId: string; demandeId: string },
  essai = 0,
  outils: OutilsDeRedaction = OUTILS_REELS,
): Promise<void> {
  const { carteId, demandeId } = entree;
  essaisProgrammes.delete(carteId);
  const carte = store.getCard(carteId);
  const demande = espace.laDemande(demandeId);
  if (!carte || !demande) {
    log.warn(`rédaction impossible : carte ou demande introuvable (${carteId})`);
    return;
  }
  const titreDOrigine = demande.titre;
  const briefingDOrigine = essai === 0 ? (carte.briefing ?? '') : (briefingsDeNaissance.get(carteId) ?? '');
  briefingsDeNaissance.set(carteId, briefingDOrigine);
  poser(carteId, { etat: 'en-cours', essais: essai, a: Date.now() });

  /** Ce qu'on a appris du tour, pour juger ensuite. */
  let sortie: { ok: boolean; texte: string } | null = null;
  let erreurJetee: string | undefined;
  let agentId: string | undefined;

  try {
    const cadrage = await outils.ouvrirLeCadrage(carteId);
    if (!cadrage) throw new Error("aucun agent de cadrage n'a pu être ouvert pour cette tâche");
    agentId = cadrage.id;
    const projet = store.getProject(demande.projectId);
    const messages = espace.messagesDeLaDemande(demandeId);
    const fichiers = fichiersDeLaDemande(demandeId, demande.fichiers);
    await outils.sendPrompt(
      cadrage.id,
      demandeDeCadrageDUneDemande({
        titre: demande.titre,
        description: demande.description,
        auteurNom: demande.auteurNom,
        nomDuProjet: projet?.name ?? demande.projectId,
        messages: messages.map((m) => ({ auteurNom: m.auteurNom, texte: m.texte, creeLe: m.creeLe })),
        pieces: fichiers.map((id) => store.getAttachment(id)?.name).filter((nom): nom is string => Boolean(nom)),
      }),
      {
        template: 'none',
        silent: true,
        attachments: fichiers,
        onComplete: (texte, ok) => {
          sortie = { ok, texte };
        },
      },
    );
  } catch (err) {
    erreurJetee = err instanceof Error ? err.message : String(err);
    log.error(`rédaction de « ${carte.title} » : le tour a échoué`, err);
  }

  /* LE VERDICT SE LIT SUR LA CARTE, PAS SUR LE CODE DE SORTIE. */
  if (aRedige(carteId, titreDOrigine, briefingDOrigine)) {
    briefingsDeNaissance.delete(carteId);
    poser(carteId, { etat: 'faite', essais: essai, a: Date.now() });
    return;
  }

  const finDeTour = sortie as { ok: boolean; texte: string } | null;
  const incident = agentId ? derniereErreurDuTour(agentId) : null;
  const quota = incident?.error === 'quota';
  const motif = motifDePannePassagere({
    ok: false,
    erreur: erreurJetee ?? incident?.contenu,
    texte: finDeTour?.texte,
  });
  const passagere = quota || Boolean(motif);
  const raison = raisonDeRedaction(
    quota
      ? 'aucun compte n’avait de quota disponible pour rédiger cette tâche'
      : motif
        ? causeEnClair(motif)
        : (erreurJetee ??
          (incident?.contenu || 'le tour de rédaction s’est terminé sans écrire de titre ni de synthèse')),
  );

  if (passagere && essai < ESSAIS_MAX) {
    const attente = attenteAvantNouvelEssai(essai + 1);
    poser(carteId, {
      etat: 'en-attente',
      raison,
      essais: essai + 1,
      a: Date.now(),
      prochainEssaiA: Date.now() + attente,
    });
    const minuteur = setTimeout(() => {
      void redigerLaTache(entree, essai + 1, outils);
    }, attente);
    // Un nouvel essai ne retient JAMAIS l'arrêt du démon : la carte porte déjà
    // son échéance, et la mention bascule toute seule passé sa marge.
    minuteur.unref?.();
    essaisProgrammes.set(carteId, minuteur);
    log.info(
      'espace client',
      `rédaction de « ${carte.title} » à refaire (${raison}) — essai ${essai + 1}/${ESSAIS_MAX} dans ${Math.round(attente / 1000)} s`,
    );
    return;
  }

  poser(carteId, { etat: 'echouee', raison, essais: essai, a: Date.now() });
  log.warn(`rédaction de « ${carte.title} » abandonnée : ${raison}`);
}

/**
 * REFAIRE LA RÉDACTION À LA MAIN, depuis le bouton de la carte. On repart de la
 * demande liée : rien n'est recréé, et le compteur d'essais repart à zéro
 * puisque c'est un geste neuf.
 */
export async function relancerLaRedaction(carteId: string, outils: OutilsDeRedaction = OUTILS_REELS): Promise<void> {
  const enCours = essaisProgrammes.get(carteId);
  if (enCours) {
    clearTimeout(enCours);
    essaisProgrammes.delete(carteId);
  }
  const demande = espace.demandesDeLaCarte(carteId)[0];
  if (!demande) throw new Error('cette tâche ne vient pas de la messagerie : rien à rédiger');
  await redigerLaTache({ carteId, demandeId: demande.id }, 0, outils);
}
