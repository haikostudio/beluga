import { bus } from './bus.js';
import { jugerLUrgence, usageDuJugeAllume } from './jugement-rapide.js';
import * as store from './store.js';
import { log } from './logger.js';

/**
 * LE JUGE, BRANCHÉ SUR LES CARTES — SANS TOUCHER À AUCUN CHEMIN EXISTANT.
 *
 * IL NE RESTE QU'UN AVIS POSÉ SUR LA CARTE : l'URGENCE d'une demande arrivée
 * sans l'utilisateur. La note de compréhension qui alimentait la jauge à trois
 * barres de la barre d'écriture, et le guetteur qui la redonnait à chaque
 * échange, sont retirés depuis le 24/11/2026 (carte « Champ d'écriture
 * allégé ») : la jauge ne servait à rien selon l'utilisateur. Une ancienne note
 * restée dans le JSON d'une carte est ignorée à la lecture (Zod l'écarte).
 */

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
 * de suite. Sans clé Jev au coffre, il ne fait rien du tout.
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
