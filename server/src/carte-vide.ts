/**
 * RANGER UNE CARTE VRAIMENT VIDE — jugée sur la BASE, jamais sur un écran.
 *
 * Avant ce fichier, l'application cliente supprimait seule la carte du bouton
 * robo à la fermeture du tiroir, d'après son état local (messages pas encore
 * chargés, brouillon tenu sous une autre clé, texte pas encore poussé). Une
 * carte en cours de rédaction pouvait ainsi disparaître. Le client demande
 * maintenant au serveur (`card.supprimerSiVide`) et c'est lui qui tranche.
 */
import { carteDeCadrageEstVide } from '@beluga/shared';
import { log } from './logger.js';
import { supprimerLaCarte } from './suppression-carte.js';
import * as store from './store.js';

const STATUTS_AU_TRAVAIL = ['running', 'starting'];

export function supprimerLaCarteSiVide(cardId: string): { supprimee: boolean; raison?: string } {
  const carte = store.getCard(cardId);
  if (!carte) return { supprimee: false, raison: 'introuvable' };

  const agents = store.agentsDeLaCarte(cardId);
  const prefs = store.readPreferences();
  const brouillons = [
    ...agents.map((a) => prefs[`draft.${a.id}`] as string | undefined),
    // Écrit avant que l'agent existe : on ne sait pas à quelle carte il va.
    prefs['draft.aucun'] as string | undefined,
  ];
  const jointesEnAttente = agents.reduce((n, a) => {
    const liste = prefs[`draftAttachments.${a.id}`];
    return n + (Array.isArray(liste) ? liste.length : 0);
  }, 0);
  const jointesAucun = prefs['draftAttachments.aucun'];
  const nbMessages = agents.reduce((n, a) => n + store.listMessages(a.id, 1).length, 0);
  const commentaires = store.listCardComments(cardId).length;

  const vide = carteDeCadrageEstVide({
    nbMessages: nbMessages + commentaires,
    brouillons,
    nbPiecesJointes:
      (carte.attachments?.length ?? 0) + jointesEnAttente + (Array.isArray(jointesAucun) ? jointesAucun.length : 0),
    titre: carte.title,
    description: carte.description,
    agentAuTravail: agents.some((a) => STATUTS_AU_TRAVAIL.includes(a.status)),
  });
  if (!vide) {
    log.info(`rangement de la carte ${cardId} refusé : elle n'est pas vide`);
    return { supprimee: false, raison: 'non vide' };
  }
  supprimerLaCarte(cardId, 'rangement-carte-vide');
  return { supprimee: true };
}
