/**
 * UN MODULE NATIF COMPILÉ POUR UNE AUTRE VERSION DE NODE.
 *
 * `better-sqlite3` n'est pas du JavaScript : c'est une bibliothèque compilée
 * pour UNE version précise de Node. Qu'un binaire compilé ailleurs arrive dans
 * `node_modules` — copie de travail, cache, installation faite sous un autre
 * Node — et TOUT ce qui ouvre la base refuse de démarrer, d'un coup :
 * 87 contrôles tombés le 14/08/2026, dont les 5 seulement que la publication
 * nomme (`ECHECS_NOMMES_MAX`), au point de faire chercher la panne dans le code
 * des cartes alors que pas une ligne n'était en cause.
 *
 * La panne se reconnaît à son message, et se répare en recompilant depuis les
 * SOURCES — jamais en reprenant un binaire tout fait, qui est justement ce qui
 * a échoué. Ces règles sont pures : elles ne lisent ni base ni disque, seulement
 * le texte rendu par la commande.
 */

/** Le module natif dont le démon dépend, et qu'il faut donc savoir réparer. */
export const MODULE_NATIF = 'better-sqlite3';

/**
 * La sortie dit-elle qu'un module natif est compilé pour une autre version de
 * Node ? Deux formes possibles selon la version de Node : le message long qui
 * cite `NODE_MODULE_VERSION`, et le code d'erreur `ERR_DLOPEN_FAILED` posé sur
 * un `.node`.
 */
export function moduleNatifMalCompile(sortie: string): boolean {
  const texte = sortie ?? '';
  if (/NODE_MODULE_VERSION/.test(texte)) return true;
  return /ERR_DLOPEN_FAILED/.test(texte) && /\.node\b/.test(texte);
}

/** La commande qui vérifie qu'un module natif se charge vraiment. */
export function commandeDEssaiDuModuleNatif(module = MODULE_NATIF): string {
  return `node -e "require('${module}')"`;
}

/**
 * La commande qui répare. `--build-from-source` est le fond de l'affaire :
 * sans lui, l'installation reprend un binaire tout prêt, celui-là même dont on
 * vient de constater qu'il ne se charge pas.
 */
export function commandeDeRecompilation(module = MODULE_NATIF): string {
  return `npm rebuild ${module} --build-from-source`;
}

/** Ce que la publication écrit dans son détail, selon l'issue de la réparation. */
export function recitDeRecompilation(reussie: boolean, module = MODULE_NATIF): string {
  return reussie
    ? `Bibliothèque « ${module} » compilée pour une autre version de Node : recompilée depuis ses sources avant de continuer.\n\n`
    : `Bibliothèque « ${module} » compilée pour une autre version de Node, et sa recompilation a échoué : tout ce qui ouvre la base va tomber.\n\n`;
}
