/**
 * CE QUI EST UN OUTIL DU MOTEUR, ET CE QUI VIENT D'AILLEURS.
 *
 * Le contrôle de complétude veut qu'un outil ajouté demain par une mise à jour
 * du moteur soit CLASSÉ — autorisé ou interdit au chef d'orchestre — au lieu de
 * passer discrètement. Pour cela il interroge le vrai moteur et compare sa
 * liste aux deux listes natives.
 *
 * Seulement, cette liste vivante ne contient pas que les outils du moteur :
 * elle porte aussi ceux des serveurs branchés sur le COMPTE de l'utilisateur
 * (calendrier, maquettes, hébergeur…), qui apparaissent et disparaissent au gré
 * de leur connexion. Le contrôle tombait donc au hasard, sur des outils que les
 * listes natives n'ont jamais eu vocation à couvrir — et un contrôle qui tombe
 * au hasard ne protège plus de rien : il bloquait la publication.
 *
 * Règles pures : aucun disque, aucune base.
 */

/** Les outils de plomberie des serveurs branchés : ils ne sont pas non plus du moteur. */
export const PLOMBERIE_SERVEURS = [
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'ReadMcpResourceDirTool',
];

/**
 * Vrai quand l'outil vient d'un serveur branché, pas du moteur lui-même.
 *
 * Deux formes, et deux seulement : le préfixe `mcp__<serveur>__<outil>`, et les
 * quelques outils de plomberie nommés ci-dessus. Les outils du projet
 * (`mcp__beluga__…`) en font partie : ils sont classés ailleurs, par leur
 * propre liste.
 */
export function outilDUnServeurBranche(nom: string): boolean {
  return nom.startsWith('mcp__') || PLOMBERIE_SERVEURS.includes(nom);
}
