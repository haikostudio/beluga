import type { DemarcheDeMarque } from './communication-demarche.js';

/**
 * LES TROIS COMMANDES AU-DESSUS DU CHAMP DU CHEF DE MARQUE (refonte de Communication, 04/11/2026) :
 * « Plan marketing », « Configurer les canaux », « Nouvelle campagne ». Chacune envoie au chef une demande cadrée —
 * jamais un formulaire : une campagne naît toujours du chef (MEM-6848). Leur ÉTAT se lit sur la démarche de la
 * marque (`demarcheDeLaMarque`), rien sur une déclaration :
 *
 *   - non configuré : rien n'est encore fait (aucune analyse, aucun compte relié) ;
 *   - à compléter   : entamé, mais il manque une part (objectifs non retenus, réseaux retenus pas tous reliés) ;
 *   - en cours      : une analyse tourne, une campagne se prépare ;
 *   - disponible    : en place — la commande reste là pour une mise à jour.
 *
 * « Nouvelle campagne » ne disparaît JAMAIS, même une fois une campagne lancée : on en crée autant qu'on veut.
 *
 * UN SEUL BOUTON À LA FOIS (carte « Planification des publications », capture #077d3) : `commandeVisible` choisit
 * l'étape suivante — le plan d'abord, puis les canaux, puis la campagne, qui RESTE dès sa première apparition (drapeau
 * gardé sur la marque, en base, pour tenir d'un appareil à l'autre) ou dès qu'une campagne existe.
 */
export const COMMANDES_DE_MARQUE = ['plan', 'canaux', 'campagne'] as const;
export type CommandeDeMarque = (typeof COMMANDES_DE_MARQUE)[number];
export type EtatDeCommande = 'non_configure' | 'a_completer' | 'en_cours' | 'disponible';

/**
 * LA COMMANDE À MONTRER, UNE SEULE : « plan » tant que le plan n'est pas en place, puis « canaux » tant que tous les
 * comptes ne sont pas reliés, puis « campagne ». `campagneAcquise` (déjà montrée une fois, ou une campagne existe)
 * l'emporte sur tout : le bouton « Nouvelle campagne » ne disparaît plus une fois apparu.
 */
export function commandeVisible(etats: Record<CommandeDeMarque, EtatDeCommande>, campagneAcquise: boolean): CommandeDeMarque {
  if (campagneAcquise) return 'campagne';
  if (etats.plan !== 'disponible') return 'plan';
  if (etats.canaux !== 'disponible') return 'canaux';
  return 'campagne';
}
