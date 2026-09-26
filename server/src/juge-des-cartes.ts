import {
  COLONNES_AVANT_LE_TRAVAIL,
  type Card,
  type EchangesDeLaCarte,
  type Message,
  dossierAJuger,
  signatureDuDossier,
} from '@beluga/shared';
import { bus } from './bus.js';
import { empreinte, jugerLUrgence, jugerLaComprehension, usageDuJugeAllume } from './jugement-rapide.js';
import * as store from './store.js';
import { log } from './logger.js';

/**
 * LE JUGE, BRANCHÉ SUR LES CARTES — SANS TOUCHER À AUCUN CHEMIN EXISTANT.
 *
 * UN SEUL AVIS PORTE ENCORE SUR LA CARTE : ce que l'agent de cadrage a COMPRIS
 * suffit-il à lancer le travail ? Il doit être PRÊT AVANT le clic de lancement
 * — une note qui arrive après le départ ne sert à personne — et il ne doit
 * ajouter la moindre attente à aucun geste de l'utilisateur.
 *
 * D'où ce guetteur : il écoute les cartes qui passent sur le bus, et juge EN
 * ARRIÈRE-PLAN celles dont la compréhension vient de changer. Rien n'est inséré
 * dans `startCard`, ni dans les outils du cadrage, ni dans la porte d'écriture
 * des cartes : les invariants « RIEN NE PART AU MOTEUR AVANT LE LANCEMENT » (ce
 * service n'est pas un moteur et ne consomme aucun quota) et « UN LANCEMENT
 * RÉPOND DÈS QUE LE TOUR EST PARTI » tiennent tels quels.
 *
 * LA NOTE SUIT LA DISCUSSION, PAS SEULEMENT LA COMPRÉHENSION. Elle attendait
 * une compréhension rendue avant de juger : la jauge restait absente pendant
 * tout le début de l'échange. Elle est maintenant redonnée à CHAQUE ÉCHANGE —
 * un message de l'utilisateur, une question tranchée, une compréhension
 * rendue —, et se remplit à mesure que la discussion avance.
 *
 * QUATRE GARDES, pour que ça ne parte jamais en boucle :
 *  0. RIEN AVANT LA PREMIÈRE DEMANDE : une carte neuve, sans message ni
 *     compréhension, n'a pas de dossier — la jauge y reste vide.
 *  1. Seules les cartes ENCORE AVANT LE TRAVAIL sont jugées — une carte lancée,
 *     terminée ou archivée n'a plus rien à gagner à une note.
 *  2. LA SIGNATURE DU DOSSIER est rangée avec le verdict : un déplacement, un
 *     changement d'étiquette ou une relecture ne rejugent rien, et l'écriture du
 *     verdict lui-même ne déclenche pas un second tour.
 *  3. UN JUGEMENT À LA FOIS PAR CARTE — et un échange arrivé PENDANT un
 *     jugement n'est pas perdu : la carte est rejugée juste après.
 */

const enCours = new Set<string>();
const aRejuger = new Set<string>();

/** Le repos laissé aux messages qui arrivent en rafale avant de juger. */
const REPOS_APRES_UN_MESSAGE_MS = 1500;
const reposEnCours = new Map<string, ReturnType<typeof setTimeout>>();

/** La carte est-elle encore à un moment où une note sert à quelque chose ? */
function vautLaPeine(carte: Card): boolean {
  return COLONNES_AVANT_LE_TRAVAIL.includes(carte.column);
}

/**
 * CE QUE LA DISCUSSION A PRODUIT HORS DE LA CARTE : les messages de
 * l'utilisateur et les questions de l'agent qui ont reçu leur réponse. Lus sur
 * le dernier agent de la carte — l'agent de cadrage tant qu'elle se discute.
 */
export function echangesDeLaCarte(cardId: string): EchangesDeLaCarte {
  const agent = store.getLastAgentByCard(cardId);
  if (!agent) return {};
  const messages = store.listMessages(agent.id);
  return {
    demandes: messages.filter((m) => m.role === 'user').map((m) => m.content ?? ''),
    questions: messages.flatMap((m) =>
      (m.questions ?? [])
        .filter((q) => q.answer?.trim())
        .map((q) => ({ question: q.question, reponse: q.answer ?? '' })),
    ),
  };
}

/**
 * LA NOTE DE COMPRÉHENSION, EN ARRIÈRE-PLAN.
 *
 * Jugée sur la DERNIÈRE version seulement, une fois par version : un nouvel
 * échange redonne une note, relire la carte n'en redemande aucune.
 */
async function jugerLaCarte(cardId: string): Promise<void> {
  if (!usageDuJugeAllume('comprehension-carte')) return;
  if (enCours.has(cardId)) {
    aRejuger.add(cardId);
    return;
  }
  const carte = store.getCard(cardId);
  if (!carte || !vautLaPeine(carte)) return;
  const dossier = dossierAJuger(carte, echangesDeLaCarte(cardId));
  if (!dossier) return;
  const signature = empreinte(signatureDuDossier(dossier));
  if (carte.jugements?.comprehension?.empreinte === signature) return;

  enCours.add(cardId);
  try {
    const verdict = await jugerLaComprehension(carte, dossier);
    if (!verdict) return;
    /*
     * ON RELIT LA CARTE AVANT D'ÉCRIRE : entre l'envoi et la réponse, elle a pu
     * être lancée, déplacée ou recadrée. Une note posée sur un dossier qui
     * n'est plus là mentirait — la carte est alors rejugée sur le nouveau.
     */
    const fraiche = store.getCard(cardId);
    if (!fraiche || !vautLaPeine(fraiche)) return;
    const depuis = dossierAJuger(fraiche, echangesDeLaCarte(cardId));
    if (!depuis || empreinte(signatureDuDossier(depuis)) !== signature) {
      aRejuger.add(cardId);
      return;
    }
    const ecrite = store.saveCard({
      ...fraiche,
      jugements: { ...(fraiche.jugements ?? {}), comprehension: verdict },
    });
    bus.emit({ type: 'card.upsert', card: ecrite });
  } catch (err) {
    // UN AVIS QUI RATE NE FAIT RIEN RATER : la carte reste exactement ce qu'elle était.
    log.warn('juge rapide : note de compréhension impossible', err);
  } finally {
    enCours.delete(cardId);
    if (aRejuger.delete(cardId)) void jugerLaCarte(cardId);
  }
}

/** Un message qui compte pour la note : une demande, ou une question qui vient d'être tranchée. */
function messageQuiCompte(message: Message): boolean {
  if (message.role === 'user') return !message.streaming;
  return message.role === 'assistant' && (message.questions ?? []).some((q) => q.answer?.trim());
}

/** Juger après un court repos : une rafale de messages ne coûte qu'une note. */
function jugerApresRepos(cardId: string): void {
  const avant = reposEnCours.get(cardId);
  if (avant) clearTimeout(avant);
  reposEnCours.set(
    cardId,
    setTimeout(() => {
      reposEnCours.delete(cardId);
      void jugerLaCarte(cardId);
    }, REPOS_APRES_UN_MESSAGE_MS),
  );
}

/* ------------------------------------------------------------------ */
/* L'URGENCE D'UNE DEMANDE ENTRANTE                                    */
/* ------------------------------------------------------------------ */

/**
 * L'ORIGINE D'UNE CARTE ARRIVÉE SANS L'UTILISATEUR, dite en clair au juge : ce
 * n'est pas un détail, une panne détectée et une demande d'un service extérieur
 * ne pressent pas de la même façon.
 */
export const ORIGINES_SANS_UTILISATEUR = {
  'porte-externe': 'Un service extérieur a posé cette demande par la porte d’API, avec une clé nommée.',
  'panne-de-site': 'Le surveillant a vu un site tomber plusieurs contrôles de suite et a ouvert cette enquête seul.',
} as const;

export type OrigineSansUtilisateur = keyof typeof ORIGINES_SANS_UTILISATEUR;

/**
 * CETTE DEMANDE ENTRANTE PRESSE-T-ELLE ?
 *
 * Posé sur les cartes qui naissent SANS geste de l'utilisateur : la porte d'API
 * et l'enquête ouverte seule après une panne répétée. L'avis sert à ORDONNER ce
 * qui attend — il ne lance rien, ne change aucune colonne et ne saute aucune
 * validation. Rien n'est attendu : l'appel part et la réponse HTTP repart tout
 * de suite. Sans Laya installé, il ne fait rien du tout.
 */
export function jugerLUrgenceEnFond(cardId: string, origine: OrigineSansUtilisateur): void {
  if (!usageDuJugeAllume('urgence-demande')) return;
  const carte = store.getCard(cardId);
  if (!carte) return;
  void (async () => {
    try {
      const verdict = await jugerLUrgence(
        {
          titre: carte.title,
          description: carte.description ?? '',
          origine: ORIGINES_SANS_UTILISATEUR[origine],
        },
        { cardId, projectId: carte.projectId },
      );
      if (!verdict) return;
      const fraiche = store.getCard(cardId);
      if (!fraiche) return;
      const ecrite = store.saveCard({
        ...fraiche,
        jugements: { ...(fraiche.jugements ?? {}), urgence: verdict },
      });
      bus.emit({ type: 'card.upsert', card: ecrite });
    } catch (err) {
      // UN AVIS QUI RATE NE FAIT RIEN RATER : la carte est déjà posée, telle quelle.
      log.warn('juge rapide : avis d’urgence impossible', err);
    }
  })();
}


/**
 * BRANCHE LE GUETTEUR. Rend la fonction qui le débranche — le démon s'en sert
 * à l'arrêt, et les contrôles pour repartir d'un état propre.
 */
export function veillerSurLesCartes(): () => void {
  return bus.subscribe((event) => {
    if (event.type === 'message.upsert') {
      if (!messageQuiCompte(event.message)) return;
      const cardId = store.getAgent(event.message.agentId)?.cardId;
      if (cardId) jugerApresRepos(cardId);
      return;
    }
    if (event.type !== 'card.upsert') return;
    /*
     * LA COMPRÉHENSION SE JUGE SANS REPOS ET SANS ATTENDRE : elle est rendue
     * d'un coup par `rendre_comprehension`, elle ne s'écrit pas caractère par
     * caractère — l'ancien délai de repos de quatre secondes visait une
     * description tapée à la main, il n'a plus d'objet. Le jugement part donc
     * tout de suite, EN ARRIÈRE-PLAN : l'affichage de la compréhension, lui,
     * n'attend rien.
     */
    void jugerLaCarte(event.card.id);
  });
}
