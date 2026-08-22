/**
 * « La carte est close, et sa question attend toujours. »
 *
 * Une question posée par un agent — celle de l'outil `ask_user` comme celle
 * écrite en texte ordinaire — allume un triangle orange sur sa carte et compte
 * comme une décision attendue. Rien, en revanche, ne l'éteignait quand la carte
 * QUITTAIT le travail : archivée, passée dans « À déployer » ou « En
 * production », elle continuait d'annoncer « Répondre » sur un travail depuis
 * longtemps rangé — et le tour qui l'avait posée n'existait même plus.
 *
 * La règle tient en une phrase : **une carte qui entre dans une colonne close
 * ferme d'office toutes ses questions ouvertes**. Elle vit ici, sans base ni
 * réseau, pour que le serveur (qui les annule) et l'interface (qui cesse de les
 * compter) la lisent au même endroit.
 */

/**
 * LES COLONNES QUI FERMENT LES QUESTIONS. « En cours » et « Terminé » en sont
 * exclues à dessein : le travail y est encore vivant — une carte terminée peut
 * être reprise, et sa question garde un sens. Dès qu'on la range plus loin, la
 * décision n'a plus d'objet.
 */
export const COLONNES_QUI_FERMENT_LES_QUESTIONS = ['to_deploy', 'in_production', 'archived'] as const;

/** Cette colonne ferme-t-elle les questions ? Sans colonne connue, on ne présume rien. */
export function colonneFermeLesQuestions(colonne: string | undefined): boolean {
  return colonne
    ? (COLONNES_QUI_FERMENT_LES_QUESTIONS as readonly string[]).includes(colonne)
    : false;
}

/**
 * Le déplacement qui doit couper les questions : la carte n'était pas dans une
 * colonne close, elle y arrive. Le cas « close → close » ne relance rien (il
 * n'y a plus rien à couper), et le retour en arrière ne rouvre jamais une
 * question fermée.
 */
export function fermetureDesQuestions(avant: string | undefined, apres: string | undefined): boolean {
  return !colonneFermeLesQuestions(avant) && colonneFermeLesQuestions(apres);
}

/**
 * Ce que l'agent lit si son tour attendait encore cette réponse. Il ne devine
 * pas à la place de l'utilisateur : la carte a été rangée, il n'y a plus rien à
 * trancher.
 */
export function texteQuestionFermeeAvecLaCarte(): string {
  return (
    "La carte a été rangée (archivée ou passée au déploiement) : la question est fermée sans " +
    "réponse. Arrête-toi ici, ne tranche rien à la place de l'utilisateur et rends la main."
  );
}
