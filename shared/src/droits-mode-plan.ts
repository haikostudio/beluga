/**
 * LE MODE PLAN NE RETIRE PLUS SES OUTILS AU CHEF D'ORCHESTRE.
 *
 * Le mode plan avait été posé comme un mode de PERMISSION du moteur : Claude
 * recevait `--permission-mode plan`, Codex un bac à sable en lecture seule. Sur
 * un agent de tâche, c'est exactement ce qu'on veut — il prépare sans toucher au
 * dépôt. Sur le CHEF, c'était un contresens :
 *
 *  - le chef ne peut de toute façon PAS écrire le projet : son bac à sable le
 *    monte en lecture seule (`bridage-chef.ts`), et ses outils d'édition lui sont
 *    interdits. Le mode plan n'ajoutait donc aucune sécurité ;
 *  - il lui retirait en revanche ses OUTILS DU DÉMON — écrire son plan
 *    (`write_document`), poser une question (`ask_user`). Le chef répondait alors
 *    « aucun outil d'écriture ne m'est ouvert en mode plan », recopiait son plan
 *    entier dans le fil, et tranchait par défaut au lieu de demander.
 *
 * D'où la règle, sans base ni disque, donc rejouable seule : le mode plan ferme
 * l'écriture pour tous les rôles SAUF le chef d'orchestre, dont la frontière est
 * déjà posée ailleurs — et bien mieux. Ce que le mode plan lui interdit, ce n'est
 * pas d'écrire : c'est de proposer une CARTE (refus posé dans l'outil,
 * `server/src/tools.ts`).
 */

/** Les rôles d'agent, tels que le démon les nomme. */
export type RoleDAgent = 'task' | 'orchestrator' | 'analysis' | 'deploy';

/** Le mode d'une conversation, tel que le composeur le règle. */
export type ModeDeConversation = 'direct' | 'plan';

/**
 * Le mode plan doit-il fermer l'écriture au niveau du MOTEUR pour ce tour ?
 *
 * Vrai pour un agent qui travaille dans le dépôt (tâche, analyse, publication) :
 * il prépare sans rien modifier. Faux pour le chef d'orchestre, déjà tenu par
 * son bac à sable : lui retirer ses outils ne protège rien et le prive de son
 * plan écrit et de ses questions.
 */
export function modePlanFermeLEcriture(mode: ModeDeConversation | undefined, role?: RoleDAgent): boolean {
  return mode === 'plan' && role !== 'orchestrator';
}
