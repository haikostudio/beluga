/**
 * LES SUGGESTIONS D'UN PLAN — elles viennent du PLAN, plus d'un catalogue.
 *
 * Il y avait, sous chaque plan, quelques relances toutes prêtes (« Plus
 * simple », « Une autre approche », « Livrer par étapes »…). Personne ne les
 * comprenait : elles proposaient des AXES DE RÉFLEXION que le plan n'avait pas
 * demandés, écrites d'avance, sans rapport avec ce qui venait d'être lu. Elles
 * sont retirées — qui veut un autre angle le dit dans son message.
 *
 * Ce qui les remplace était déjà là, dans le plan lui-même : la partie
 * AMÉLIORATIONS APPORTÉES, devenue une LISTE d'idées à ajouter. Elle
 * s'affiche cliquable, exactement comme les « Évolutions possibles » d'une
 * réponse d'agent (`web/src/lib/markdown.tsx`) : un clic dépose l'idée dans la
 * barre d'écriture, où elle se complète, et RIEN ne part tant que
 * l'utilisateur n'envoie pas.
 *
 * Une seule règle tient le module : UN CLIC N'ENVOIE JAMAIS RIEN. Le geste qui
 * dépense, c'est l'envoi, et il appartient à l'utilisateur — c'est aussi ce que
 * fait le bouton « Refuser ».
 */

/**
 * LE TITRE DE LA PARTIE CLIQUABLE d'un plan. Les tournures acceptées sont
 * celles que `PARTIES_DU_PLAN` reconnaît déjà (`shared/src/plan-complet.ts`) :
 * un plan écrit « Améliorations apportées », mais un moteur abrège parfois.
 */
export const TITRE_DES_SUGGESTIONS = /am[ée]liorations?(\s+apport[ée]es?)?\s*$/i;

/**
 * CETTE SECTION EST-ELLE LA LISTE CLIQUABLE ? Le titre est nettoyé de sa
 * numérotation et de son icône avant d'être comparé — « ## 4. 🎯 Améliorations
 * apportées » doit compter comme « Améliorations apportées ».
 */
export function estTitreDesSuggestions(titre: string): boolean {
  const nu = (titre ?? '')
    .replace(/^[\s#]*\d+[.)]?\s*/, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return TITRE_DES_SUGGESTIONS.test(nu);
}

/**
 * LE REFUS, PRÉPARÉ SANS ÊTRE ENVOYÉ.
 *
 * « Refuser » ne relance rien tout seul (§ mode plan) : il pose cette phrase
 * dans le champ de saisie. Elle dit l'essentiel, et laisse la place à ce que
 * l'utilisateur veut ajouter — un refus muet ne fait que faire deviner le chef.
 */
export const REFUS_A_COMPLETER =
  'Je refuse ce plan : réfléchis à une autre approche.';

/**
 * CE QUI SE DÉPOSE DANS LE CHAMP quand il contient déjà quelque chose.
 *
 * Un clic n'écrase JAMAIS ce qui est écrit — on ne perd pas une phrase en
 * cours pour une pastille. Les relances s'empilent donc l'une sous l'autre,
 * et une même suggestion cliquée deux fois ne se recopie pas.
 */
export function texteApresInsertion(actuel: string, ajout: string): string {
  const avant = (actuel ?? '').trim();
  const suite = (ajout ?? '').trim();
  if (!suite) return actuel ?? '';
  if (!avant) return suite;
  if (avant.split('\n').some((ligne) => ligne.trim() === suite)) return actuel ?? '';
  return `${avant}\n${suite}`;
}
