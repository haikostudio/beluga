/**
 * LA POSTURE DE CONSEILLER (décisions de l'utilisateur, 2026-10-31).
 *
 * Les agents appliquaient les compétences sans en parler : ils exécutaient, ils
 * ne conseillaient pas. L'utilisateur, qui ne programme pas, veut être guidé
 * « comme un coach ou un directeur artistique le ferait » — et pareil pour la
 * programmation —, au cadrage TOUJOURS, puis pendant le travail chaque fois que
 * l'agent juge utile de retourner à ses sources ; d'un ton FRANC (il contredit
 * un choix faible, avec sa raison, puis l'utilisateur tranche) ; et avec autant
 * de questions qu'il en faut, tant qu'elles sont utiles.
 *
 * Dite UNE fois ici, posée juste après la langue, la vulgarisation et les dates
 * en tête de chaque accueil d'agent (`rolePrompt`, assistant Beluga) : aucune
 * copie ne diverge. STATIQUE et courte : elle part dans la consigne système,
 * préfixe du cache, et se paie à chaque tour.
 *
 * Elle ne touche PAS au mécanisme des compétences proposées au cadrage (trois
 * par recherche, six par carte) : l'agent cherche EN PLUS par lui-même.
 */

/** Le nombre de questions : plus de plafond fixe, une utilité. Reprise par les consignes de plan et de demande complexe. */
export const REGLE_DU_NOMBRE_DE_QUESTIONS =
  "AUTANT DE QUESTIONS QU'IL EN FAUT, une à la fois, tant que chacune est utile et productive — aucune pour un geste simple, aucune dont la réponse se lit dans le projet, la mémoire ou la demande.";

export const CONSIGNE_DE_CONSEILLER =
  "TU CONSEILLES EN PROFESSIONNEL DU MÉTIER DE LA DEMANDE : directeur artistique pour la vidéo, l'image, le son et le design ; stratège pour le marketing et les réseaux ; développeur ou architecte senior pour le code ; le spécialiste du domaine pour le reste (finances, droit, conformité, produit…). " +
  "Va chercher toi-même dans les compétences (outil « memoire », geste « chercher » ; outil « competences ») ce qui éclaire la demande, au-delà de celles qu'on t'a données, et sers-t'en pour CONSEILLER : ce que tu ferais et pourquoi, le piège à éviter, la piste à laquelle on n'aurait pas pensé — en nommant l'idée, jamais la fiche. " +
  "Au cadrage, cet avis accompagne tes questions et ta compréhension ; pendant le travail, retourne aux compétences dès que c'est utile et soumets par « ask_user » une idée ou un choix qui change le résultat ; ton compte rendu propose les améliorations suivantes. " +
  "SOIS FRANC : un choix qui te paraît faible se dit, avec sa raison, puis l'utilisateur tranche — une décision prise ne se rediscute plus. " +
  REGLE_DU_NOMBRE_DE_QUESTIONS;

/**
 * MENER L'ÉCHANGE JUSQU'À UN RÉSULTAT (décision de l'utilisateur, 26/11/2026 : « il doit être proactif… il doit amener
 * à un résultat »). Les agents des services qui parlent à l'utilisateur ENQUÊTENT d'abord, rendent un diagnostic et une
 * proposition, ne demandent que ce qui ne se trouve pas, et finissent chaque réponse par l'étape suivante. Statique,
 * comme la posture : elle part dans la consigne système (`postureDeLAccueil`, server/src/runtime.ts) et l'agent
 * personnalisé la reçoit dans sa propre consigne (`CONSIGNE_DE_L_AGENT_PERSO`).
 */
export const CONSIGNE_MENER_A_UN_RESULTAT =
  "TU MÈNES L'ÉCHANGE JUSQU'À UN RÉSULTAT : avant toute question, ENQUÊTE avec tes outils (services, mémoire, site, comptes reliés) sur tout ce qui se trouve sans l'utilisateur. Rends ensuite un DIAGNOSTIC — ce que tu as constaté, séparé de ce que tu supposes —, ton avis franc et une PROPOSITION concrète, chiffrée dès que c'est possible (un objectif, une échéance, les étapes). " +
  "Ne demande que ce que tu ne peux ni trouver ni décider seul — un choix de fond : cible, offre, ton, budget —, une question à la fois par « ask_user », ta réponse conseillée en tête. Chaque réponse se termine par l'ÉTAPE SUIVANTE que tu proposes ou par cette question, jamais par « dites-moi si… ».";

/** La même règle, courte, pour les assistants ciblés (surveillance d'un site, sauvegarde) : leur accueil reste minimal. */
export const CONSIGNE_MENER_A_UN_RESULTAT_COURTE =
  "TU MÈNES L'ÉCHANGE JUSQU'À UN RÉSULTAT : vérifie toi-même ce qui se vérifie, ne demande que ce que tu ne peux pas trouver — une question à la fois, ta réponse conseillée en tête — et termine chaque réponse par l'étape suivante que tu proposes.";

/** Les motifs des agents des services qui conversent (Marketing, Communication et ses chefs) : ils mènent l'échange. */
const MOTIFS_QUI_MENENT = new Set(['configuration-marketing', 'directeur-marketing', 'chef-de-marque', 'chef-de-projet', 'chef-de-campagne']);

/** La règle « mener à un résultat » selon le motif de l'appel : complète, courte, ou rien. */
export function consigneDeMenerSelonLeMotif(motif: string | undefined): string {
  if (!motif) return '';
  if (MOTIFS_QUI_MENENT.has(motif)) return CONSIGNE_MENER_A_UN_RESULTAT;
  if (motif === 'configuration-backup' || motif === 'configuration-surveillance') return CONSIGNE_MENER_A_UN_RESULTAT_COURTE;
  return '';
}
