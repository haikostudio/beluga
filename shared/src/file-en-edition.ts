/**
 * UNE DEMANDE EN ATTENTE QU'ON MODIFIE NE PART PAS (demande du 12/10/2026 :
 * « quand j'édite un prompt en attente, ça ne doit pas le lancer »).
 *
 * L'écran pose `enEditionDepuis` sur la demande ouverte dans la barre
 * d'écriture ; la file s'arrête DEVANT elle — les suivantes attendent aussi,
 * l'ordre ne se croise jamais.
 *
 * PLUS AUCUNE PÉREMPTION (décision de l'utilisateur du 04/11/2026, après la
 * perte d'un long message) : une modification ouverte ne se ferme QUE par
 * « Enregistrer » ou « Annuler ». Quitter la conversation, changer d'écran,
 * fermer l'onglet, perdre le canal ou redémarrer le serveur ne la ferment pas,
 * ne l'envoient pas et ne l'effacent pas. Le repère est en base : il survit à
 * tout, et l'écran rouvre la modification au retour sur l'agent. Les dix
 * minutes d'avant (et le maintien par canal vivant du 23/10/2026) ont disparu.
 *
 * Seul « Envoyer maintenant » lève aussi le repère : c'est un geste explicite.
 */

/** Cette demande est-elle retenue, parce qu'on la modifie en ce moment ? */
export function retenueParUneEdition(demande: { enEditionDepuis?: number }): boolean {
  return !!demande.enEditionDepuis;
}

/** Le délai de frappe avant que le texte en cours de modification soit gardé par le serveur. */
export const BROUILLON_EDITION_TEMPORISE_MS = 1_000;

/**
 * LA PHRASE D'UNE CARTE QU'UN MESSAGE EN ATTENTE RETIENT. Le tour est fini,
 * mais un message attend encore derrière l'agent (ouvert en modification, ou
 * pas encore parti) : la carte reste en « En cours » au lieu de se ranger et de
 * partir au déploiement. Elle dit pourquoi, et ce qui la fera repartir.
 */
export const RAISON_FILE_EN_ATTENTE = 'Un message attend derrière l’agent : la carte reste ouverte jusqu’à son envoi.';

/** La raison écrite sur le bouton de déploiement éteint quand une carte du lot a encore un message en attente. */
export function raisonFileEnAttenteAuDeploiement(titres: string[]): string {
  const liste = titres.map((t) => `« ${t} »`).join(', ');
  return titres.length > 1
    ? `Des messages attendent encore derrière les agents de ${liste} : envoyez-les ou retirez-les avant de déployer.`
    : `Un message attend encore derrière l’agent de ${liste} : envoyez-le ou retirez-le avant de déployer.`;
}
