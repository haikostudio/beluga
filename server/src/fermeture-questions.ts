/**
 * FERMER LES QUESTIONS D'UNE CARTE — d'office quand elle est rangée, à la main
 * quand on clique « Annuler » sur la carte du tableau.
 *
 * La règle (quelles colonnes ferment, et pourquoi) vit dans
 * `shared/src/fermeture-questions.ts` ; ici il n'y a que le geste : parcourir
 * les messages de la carte, éteindre ce qui attend encore, libérer le tour resté
 * suspendu, et diffuser.
 *
 * Quatre choses attendent une réponse sur une carte, et les quatre sont
 * coupées :
 *  - une question de l'outil `ask_user` (`message.questions`) ;
 *  - une question écrite en TEXTE ORDINAIRE (`message.texteLibreAnnulee`) ;
 *  - un choix de REPRISE DE COMPTE resté ouvert (`repriseCompte.abandonnee`) —
 *    oublié jusqu'au 23/08/2026, c'est lui qui rallumait « Répondre / Annuler »
 *    sur des cartes rangées depuis des semaines ;
 *  - l'attente du tour lui-même (`annulerLAttente`), sans quoi le moteur
 *    resterait arrêté sur un appel d'outil qui ne répondrait jamais.
 */
import { colonneFermeLesQuestions, texteQuestionFermeeAvecLaCarte } from '@haikodev/shared';
import { annulerLAttente } from './attente-question.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * Ferme toutes les questions encore ouvertes de cette carte. Rend le nombre de
 * questions réellement éteintes — zéro quand il n'y avait rien à fermer, ce qui
 * est le cas courant.
 */
export function fermerLesQuestionsDeLaCarte(cardId: string): number {
  let fermees = 0;
  const maintenant = Date.now();
  const messages = store.listCardMessages(cardId);
  /*
   * Une question en TEXTE ORDINAIRE ne se lit jamais que sur le DERNIER message
   * de la carte (`decisionEnTexteLibre`) : c'est donc le seul à éteindre. On ne
   * relit pas la règle de reconnaissance ici — poser le drapeau sur un message
   * qui n'était pas une question ne change rien, et cela évite qu'un texte jugé
   * question demain ressorte sur une carte close.
   */
  const dernier = messages[messages.length - 1];

  for (const message of messages) {
    const questionsOuvertes = message.questions.some((q) => !q.answer && !q.cancelled);
    const texteLibreAEteindre =
      message.id === dernier?.id && message.role === 'assistant' && !message.texteLibreAnnulee;
    /*
     * Le choix de reprise, lui, se lit sur N'IMPORTE QUEL message du fil : un
     * tour coupé par une limite de quota laisse sa bulle où elle est tombée,
     * puis d'autres tours écrivent par-dessus. Le chercher sur le seul dernier
     * message l'aurait manqué dans exactement le cas qui pose problème.
     */
    const repriseAEteindre = Boolean(
      message.repriseCompte && !message.repriseCompte.choisi && !message.repriseCompte.abandonnee,
    );
    if (!questionsOuvertes && !texteLibreAEteindre && !repriseAEteindre) continue;

    const frais = store.saveMessage({
      ...message,
      questions: message.questions.map((q) =>
        q.answer || q.cancelled ? q : { ...q, cancelled: true, answeredAt: maintenant },
      ),
      texteLibreAnnulee: texteLibreAEteindre ? true : message.texteLibreAnnulee,
      repriseCompte:
        repriseAEteindre && message.repriseCompte
          ? { ...message.repriseCompte, abandonnee: true, abandonneeA: maintenant }
          : message.repriseCompte,
    });
    bus.emit({ type: 'message.upsert', message: frais });

    if (repriseAEteindre) fermees += 1;

    for (const question of message.questions) {
      if (question.answer || question.cancelled) continue;
      fermees += 1;
      // Le tour qui attendait cette réponse repart en sachant que la carte a été
      // rangée ; s'il n'existe plus, l'appel ne fait rien.
      annulerLAttente(question.id, texteQuestionFermeeAvecLaCarte());
    }
  }

  if (fermees) log.info(`carte ${cardId} : ${fermees} question(s) fermée(s) sans réponse`);
  bus.emit({ type: 'attention', ...store.signalAttention() });
  return fermees;
}

/**
 * LA CARTE VIENT D'ÊTRE RANGÉE. Appelé par TOUS les chemins qui déplacent une
 * carte (dépôt à la main, archivage, publication, déploiement automatique) :
 * seule l'arrivée dans une colonne close déclenche la fermeture, le reste ne
 * coûte rien.
 *
 * Ce geste ne doit JAMAIS faire échouer un déplacement ni une mise en ligne :
 * il est de la comptabilité, il vient après, et son incident se dit dans le
 * journal.
 */
export function fermerLesQuestionsSiCarteRangee(cardId: string, colonne: string | undefined): void {
  if (!colonneFermeLesQuestions(colonne)) return;
  try {
    fermerLesQuestionsDeLaCarte(cardId);
  } catch (err) {
    log.warn(`fermeture des questions impossible sur la carte ${cardId}`, err);
  }
}
